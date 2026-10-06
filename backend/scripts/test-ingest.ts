import 'dotenv/config'
import path from 'path'
import fs from 'fs'
import { neon } from '@neondatabase/serverless'
import {
  deleteDocument,
  listDocuments,
} from '../src/lib/rag/ingest'
import { chunkText, extractTextFromString } from '../src/lib/rag/chunker'
import { generateEmbedding } from '../src/lib/rag/nvidia-client'

const sql = neon(process.env.DATABASE_URL!)
const TEST_THERAPIST = 'test-therapist-ingest-001'

async function testIngest() {
  console.log('Testing document ingestion pipeline...\n')

  // ── TEST 1: Ingest a text file as document ──────
  console.log('Test 1: Ingest sample SLD document')

  const testFilePath = path.join(
    __dirname, 'test-docs', 'sample-sld.txt'
  )

  if (!fs.existsSync(testFilePath)) {
    console.error('  ✗ Test file not found:', testFilePath)
    process.exit(1)
  }

  const rawText = fs.readFileSync(testFilePath, 'utf-8')
  const chunks = chunkText(extractTextFromString(rawText))

  console.log(`  ✓ File read: ${rawText.split(/\s+/).length} words`)
  console.log(`  ✓ Chunks created: ${chunks.length}`)
  console.log(`  ✓ First chunk preview: "${chunks[0].text.slice(0, 80)}..."`)

  // ── TEST 2: Embed and store chunks manually ──────
  console.log('\nTest 2: Embed and store chunks in pgvector')

  await sql`
    DELETE FROM document_chunks
    WHERE therapist_id = ${TEST_THERAPIST}
  `

  let stored = 0
  for (const chunk of chunks) {
    const embedding = await generateEmbedding(chunk.text, 'passage')
    await sql`
      INSERT INTO document_chunks
        (id, therapist_id, file_name, chunk_index, chunk_text, embedding)
      VALUES (
        gen_random_uuid(),
        ${TEST_THERAPIST},
        ${'sample-sld.txt'},
        ${chunk.index},
        ${chunk.text},
        ${JSON.stringify(embedding)}::vector
      )
    `
    stored++
    process.stdout.write(`  Storing chunks: ${stored}/${chunks.length}\r`)
  }

  console.log(`\n  ✓ All ${stored} chunks stored in pgvector`)

  // ── TEST 3: Similarity search on stored chunks ──
  console.log('\nTest 3: Retrieve relevant chunks via similarity search')

  const query = 'child struggles with reading and letter sounds'
  const queryEmbedding = await generateEmbedding(query, 'query')

  const results = await sql`
    SELECT
      chunk_text,
      chunk_index,
      1 - (embedding <=> ${JSON.stringify(queryEmbedding)}::vector)
        AS similarity
    FROM document_chunks
    WHERE therapist_id = ${TEST_THERAPIST}
    ORDER BY embedding <=> ${JSON.stringify(queryEmbedding)}::vector
    LIMIT 3
  `

  console.log(`  ✓ Query: "${query}"`)
  console.log(`  ✓ Top 3 results:`)
  results.forEach((r, i) => {
    console.log(`\n    [${i + 1}] Similarity: ${Number(r.similarity).toFixed(4)}`)
    console.log(`        Preview: "${String(r.chunk_text).slice(0, 100)}..."`)
  })

  if (results.length === 0) {
    console.error('  ✗ No results returned')
    process.exit(1)
  }

  console.log(`\n  ✓ Top-3 results returned — no threshold filter applied`)

  // ── TEST 4: List documents ───────────────────────
  console.log('\nTest 4: List stored documents')
  const docs = await listDocuments(TEST_THERAPIST)
  console.log(`  ✓ Documents found: ${docs.length}`)
  docs.forEach(d => {
    console.log(`    - ${d.fileName}: ${d.chunkCount} chunks`)
  })

  // ── TEST 5: Delete document ──────────────────────
  console.log('\nTest 5: Delete document')
  const deleted = await deleteDocument(TEST_THERAPIST, 'sample-sld.txt')
  console.log(`  ✓ Deleted ${deleted} chunks`)

  const remaining = await sql`
    SELECT COUNT(*) as count
    FROM document_chunks
    WHERE therapist_id = ${TEST_THERAPIST}
  `
  const count = Number(remaining[0].count)
  if (count !== 0) {
    console.error(`  ✗ Expected 0 chunks remaining, found ${count}`)
    process.exit(1)
  }
  console.log(`  ✓ Verified: 0 chunks remaining`)

  console.log('\n✅ ALL TESTS PASSED — Document ingestion pipeline ready')
}

testIngest().catch(e => {
  console.error('\n❌ TEST FAILED:', e)
  process.exit(1)
})
