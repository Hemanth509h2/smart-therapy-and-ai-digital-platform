import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import mammoth from 'mammoth'
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { nvidiaClient } from '../../src/lib/ai/rag/nvidia-client'

// Ingests the STAAD therapy-module reports (.docx) into module_report_chunks
// for RAG. Each report has numbered sections ("1. Module overview" ...
// "13. Advantages ..."), so every section becomes one chunk, prefixed with the
// module name and category so it still makes sense on its own.
//
//   npx tsx scripts/maintenance/ingest-module-reports.ts <folder> [--dry-run]
//
// <folder> holds one sub-folder per category (adhd, sld, "cbt, act", ...)
// with the .docx files inside. Re-running replaces a file's chunks.

// nvidia/nv-embedqa-e5-v5 (EMBEDDING_MODEL in nvidia-client.ts) reached end of
// life on 2026-08-25 and now returns 410. This model supports 1024-dimension
// output, matching document_chunks. Queries against this table must be
// embedded with the same model and dimensions, using input_type 'query'.
const MODULE_EMBEDDING_MODEL = 'nvidia/llama-nemotron-embed-vl-1b-v2'
const EMBEDDING_DIMENSIONS = 1024
const EMBED_BATCH_SIZE = 16
const MAX_RETRIES = 5

const CATEGORY_LABELS: Record<string, string> = {
  'adhd': 'ADHD',
  'anxiety and depression': 'Anxiety & Depression',
  'cbt, act': 'CBT & ACT',
  'id': 'Intellectual Disability',
  'skill development': 'Skill Development',
  'sld': 'SLD',
}

interface Section {
  number: number
  title: string
  body: string
}

interface ReportChunk {
  fileName: string
  moduleName: string
  category: string
  sectionNumber: number
  sectionTitle: string
  chunkIndex: number
  chunkText: string
  wordCount: number
}

function findDocxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__MACOSX' ? [] : findDocxFiles(full)
    return entry.name.endsWith('.docx') && !entry.name.startsWith('~$') ? [full] : []
  })
}

function categoryFor(filePath: string): string {
  const folder = path.basename(path.dirname(filePath))
  return CATEGORY_LABELS[folder.toLowerCase()] ?? folder
}

// Titles vary: "STAAD — Worry Box", "STAAD – Simon Says Module Report", or a
// generic "STAAD | SLD THERAPY MODULE" line followed by "Pixel Art Coding".
function moduleNameFor(preamble: string[], filePath: string): string {
  for (const line of preamble) {
    const name = line
      .replace(/^STAAD\s*[—–-]\s*/, '')
      .replace(/\s*(Final\s+)?Module Report$/i, '')
      .trim()
    if (name && !/^STAAD\b/.test(name) && !/[|:]/.test(name) && !/report$/i.test(name)) {
      return name
    }
  }
  return path
    .basename(filePath, '.docx')
    .replace(/^STAAD_/, '')
    .replace(/_(Concise|Reaudited|Section|RAG|Module|Final|Verified|Report|Numbering|Corrected).*$/, '')
    .replace(/_/g, ' ')
}

// Splits on headings numbered 1, 2, 3 ... in order, so a body paragraph that
// happens to start with a number isn't mistaken for a heading.
function splitSections(paragraphs: string[]): { preamble: string[]; sections: Section[] } {
  const preamble: string[] = []
  const sections: Section[] = []
  for (const para of paragraphs) {
    const heading = para.match(/^(\d{1,2})\.\s+(.{3,80})$/)
    if (heading && Number(heading[1]) === sections.length + 1) {
      sections.push({ number: Number(heading[1]), title: para, body: '' })
    } else if (sections.length === 0) {
      preamble.push(para)
    } else {
      const current = sections[sections.length - 1]
      current.body = current.body ? `${current.body}\n${para}` : para
    }
  }
  return { preamble, sections }
}

async function chunkReport(filePath: string): Promise<{ chunks: ReportChunk[]; warnings: string[] }> {
  const { value } = await mammoth.extractRawText({ path: filePath })
  const paragraphs = value.split('\n').map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const { preamble, sections } = splitSections(paragraphs)

  const fileName = path.basename(filePath)
  const moduleName = moduleNameFor(preamble, filePath)
  const category = categoryFor(filePath)
  const warnings: string[] = []
  if (sections.length !== 13) warnings.push(`expected 13 sections, found ${sections.length}`)

  // The preamble's classification line (category | focus | duration) is useful
  // context, so it goes into the overview chunk.
  const details = preamble.filter(p => /[|:]/.test(p) && !/^STAAD\s*\|/.test(p))

  const chunks = sections.map((section, i) => {
    const body = i === 0 && details.length ? `${details.join('\n')}\n${section.body}` : section.body
    if (!body) warnings.push(`section ${section.number} is empty`)
    const chunkText = [
      `Module: ${moduleName}`,
      `Category: ${category}`,
      `Section: ${section.title}`,
      '',
      body,
    ].join('\n')
    return {
      fileName,
      moduleName,
      category,
      sectionNumber: section.number,
      sectionTitle: section.title.replace(/^\d+\.\s+/, ''),
      chunkIndex: i,
      chunkText,
      wordCount: chunkText.split(/\s+/).length,
    }
  })
  return { chunks, warnings }
}

async function embedPassages(texts: string[]): Promise<number[][]> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await nvidiaClient.embeddings.create({
        model: MODULE_EMBEDDING_MODEL,
        input: texts,
        dimensions: EMBEDDING_DIMENSIONS,
        encoding_format: 'float',
        // @ts-ignore — NVIDIA NIM extensions: passage vs query embeddings, and
        // truncate rather than reject inputs over the model's 512 tokens.
        input_type: 'passage',
        truncate: 'END',
      })
      const embeddings = response.data.sort((a, b) => a.index - b.index).map(d => d.embedding)
      for (const e of embeddings) {
        if (e.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(`Expected ${EMBEDDING_DIMENSIONS} dimensions, got ${e.length}`)
        }
      }
      return embeddings
    } catch (e) {
      const status = (e as { status?: number }).status
      const retryable = status === 429 || (status !== undefined && status >= 500)
      if (!retryable || attempt === MAX_RETRIES) throw e
      const delayMs = 2000 * 2 ** (attempt - 1)
      console.log(`  NVIDIA returned ${status}, retrying in ${delayMs / 1000}s`)
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
}

async function setupTable(sql: NeonQueryFunction<false, false>) {
  await sql`CREATE EXTENSION IF NOT EXISTS vector`
  await sql`
    CREATE TABLE IF NOT EXISTS module_report_chunks (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      module_name     TEXT NOT NULL,
      category        TEXT NOT NULL,
      file_name       TEXT NOT NULL,
      section_number  INTEGER NOT NULL,
      section_title   TEXT NOT NULL,
      chunk_index     INTEGER NOT NULL,
      chunk_text      TEXT NOT NULL,
      embedding       vector(1024) NOT NULL,
      metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT module_report_chunks_file_chunk_key UNIQUE (file_name, chunk_index)
    )
  `
  // HNSW rather than document_chunks' IVFFlat: IVFFlat with 100 lists needs
  // far more rows than a few hundred chunks to give good recall.
  await sql`
    CREATE INDEX IF NOT EXISTS module_report_chunks_embedding_idx
      ON module_report_chunks USING hnsw (embedding vector_cosine_ops)
  `
  await sql`
    CREATE INDEX IF NOT EXISTS module_report_chunks_category_idx
      ON module_report_chunks (category)
  `
  await sql`
    CREATE INDEX IF NOT EXISTS module_report_chunks_module_name_idx
      ON module_report_chunks (module_name)
  `
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const folder = args.find(a => !a.startsWith('--'))
  if (!folder || !fs.existsSync(folder)) {
    console.error('Usage: npx tsx scripts/maintenance/ingest-module-reports.ts <folder> [--dry-run]')
    process.exit(1)
  }

  const files = findDocxFiles(folder).sort()
  console.log(`Found ${files.length} .docx reports in ${folder}\n`)

  const reports: ReportChunk[][] = []
  const fileNames = new Set<string>()
  let warningCount = 0
  for (const file of files) {
    const { chunks, warnings } = await chunkReport(file)
    const fileName = path.basename(file)
    if (fileNames.has(fileName)) throw new Error(`Duplicate file name: ${fileName}`)
    fileNames.add(fileName)
    reports.push(chunks)
    warningCount += warnings.length
    const words = chunks.reduce((n, c) => n + c.wordCount, 0)
    console.log(
      `  ${chunks[0]?.category ?? '?'} / ${chunks[0]?.moduleName ?? fileName}: ` +
        `${chunks.length} chunks, ${words} words` +
        (warnings.length ? `  ⚠ ${warnings.join('; ')}` : '')
    )
  }

  const allChunks = reports.flat()
  const sizes = allChunks.map(c => c.wordCount)
  console.log(
    `\n${allChunks.length} chunks total, ${Math.min(...sizes)}–${Math.max(...sizes)} words each` +
      (warningCount ? `, ${warningCount} warnings` : '')
  )

  if (dryRun) {
    console.log('\nDry run: nothing embedded or written. Sample chunk:\n')
    console.log(allChunks[0]?.chunkText)
    return
  }

  const sql = neon(process.env.DATABASE_URL!)
  await setupTable(sql)
  console.log('\n✓ module_report_chunks table and indexes ready')

  let stored = 0
  for (const chunks of reports) {
    if (chunks.length === 0) continue
    const embeddings: number[][] = []
    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
      embeddings.push(...(await embedPassages(chunks.slice(i, i + EMBED_BATCH_SIZE).map(c => c.chunkText))))
    }

    // Replace the file's chunks atomically so a re-run never leaves a mix.
    await sql.transaction([
      sql`DELETE FROM module_report_chunks WHERE file_name = ${chunks[0].fileName}`,
      ...chunks.map((c, i) => sql`
        INSERT INTO module_report_chunks
          (module_name, category, file_name, section_number, section_title,
           chunk_index, chunk_text, embedding, metadata)
        VALUES (
          ${c.moduleName}, ${c.category}, ${c.fileName}, ${c.sectionNumber}, ${c.sectionTitle},
          ${c.chunkIndex}, ${c.chunkText}, ${JSON.stringify(embeddings[i])}::vector,
          ${JSON.stringify({ wordCount: c.wordCount, embeddingModel: MODULE_EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS })}::jsonb
        )
      `),
    ])
    stored += chunks.length
    console.log(`  ✓ ${chunks[0].moduleName}: ${chunks.length} chunks stored (${stored}/${allChunks.length})`)
  }

  const [{ count }] = (await sql`SELECT COUNT(*)::int AS count FROM module_report_chunks`) as { count: number }[]
  console.log(`\n✅ Done: ${stored} chunks stored; module_report_chunks now has ${count} rows`)
}

main().catch(e => {
  console.error('❌ Ingestion failed:', e)
  process.exit(1)
})
