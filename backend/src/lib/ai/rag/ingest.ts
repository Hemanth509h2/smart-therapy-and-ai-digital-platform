import fs from 'fs'
import { PDFParse } from 'pdf-parse'
import { neon } from '@neondatabase/serverless'
import { generateEmbedding } from './nvidia-client'
import { chunkText, extractTextFromString } from './chunker'

const sql = neon(process.env.DATABASE_URL!)

export interface IngestOptions {
  therapistId: string
  sessionId?: string
  filePath: string
  fileName: string
}

export interface IngestResult {
  fileName: string
  totalChunks: number
  totalWords: number
  chunksStored: number
  errors: string[]
  durationMs: number
}

export async function ingestDocument(
  options: IngestOptions
): Promise<IngestResult> {
  const start = Date.now()
  const errors: string[] = []

  console.log(`\nIngesting: ${options.fileName}`)
  console.log(`Therapist: ${options.therapistId}`)

  await sql`
    DELETE FROM document_chunks
    WHERE therapist_id = ${options.therapistId}
    AND file_name = ${options.fileName}
  `
  console.log('  ✓ Cleared existing chunks for this file')

  let rawText: string
  try {
    const buffer = fs.readFileSync(options.filePath)
    const parser = new PDFParse({ data: buffer })
    const result = await parser.getText()
    parser.destroy()
    rawText = extractTextFromString(result.text)
    console.log(`  ✓ PDF parsed — ${rawText.split(/\s+/).length} words extracted`)
  } catch (e) {
    throw new Error(`Failed to parse PDF: ${e}`)
  }

  const chunks = chunkText(rawText)
  const totalWords = rawText.split(/\s+/).length
  console.log(`  ✓ Text chunked — ${chunks.length} chunks of ~400 words each`)

  let chunksStored = 0
  const BATCH_SIZE = 5

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE)

    await Promise.all(
      batch.map(async (chunk) => {
        try {
          const embedding = await generateEmbedding(chunk.text, 'passage')

          await sql`
            INSERT INTO document_chunks
              (id, therapist_id, session_id, file_name,
               chunk_index, chunk_text, embedding, metadata)
            VALUES (
              gen_random_uuid(),
              ${options.therapistId},
              ${options.sessionId ?? null},
              ${options.fileName},
              ${chunk.index},
              ${chunk.text},
              ${JSON.stringify(embedding)}::vector,
              ${JSON.stringify({
                wordCount: chunk.wordCount,
                chunkSize: chunks.length,
              })}::jsonb
            )
          `
          chunksStored++
        } catch (e) {
          const msg = `Chunk ${chunk.index} failed: ${e}`
          errors.push(msg)
          console.error(`  ✗ ${msg}`)
        }
      })
    )

    const progress = Math.min(i + BATCH_SIZE, chunks.length)
    process.stdout.write(
      `  Embedding chunks: ${progress}/${chunks.length}\r`
    )

    if (i + BATCH_SIZE < chunks.length) {
      await new Promise(r => setTimeout(r, 200))
    }
  }

  console.log(`\n  ✓ Stored ${chunksStored}/${chunks.length} chunks`)

  const result: IngestResult = {
    fileName: options.fileName,
    totalChunks: chunks.length,
    totalWords,
    chunksStored,
    errors,
    durationMs: Date.now() - start,
  }

  return result
}

export async function deleteDocument(
  therapistId: string,
  fileName: string
): Promise<number> {
  const result = await sql`
    DELETE FROM document_chunks
    WHERE therapist_id = ${therapistId}
    AND file_name = ${fileName}
    RETURNING id
  `
  return result.length
}

export async function listDocuments(
  therapistId: string
): Promise<Array<{ fileName: string; chunkCount: number; createdAt: Date }>> {
  const rows = await sql`
    SELECT
      file_name,
      COUNT(*) as chunk_count,
      MIN(created_at) as created_at
    FROM document_chunks
    WHERE therapist_id = ${therapistId}
    GROUP BY file_name
    ORDER BY MIN(created_at) DESC
  `
  return rows.map(r => ({
    fileName: r.file_name as string,
    chunkCount: Number(r.chunk_count),
    createdAt: new Date(r.created_at as string),
  }))
}
