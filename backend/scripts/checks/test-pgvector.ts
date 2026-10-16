import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { neon } from '@neondatabase/serverless'

const prisma = new PrismaClient()

async function testPgVector() {
  console.log('Testing pgvector setup...')

  const sql = neon(process.env.DATABASE_URL!)

  // Test 1: Check extension is enabled
  const result = await sql`
    SELECT extname, extversion
    FROM pg_extension
    WHERE extname = 'vector'
  `
  if (result.length > 0) {
    console.log('✓ pgvector extension:', result[0])
  } else {
    console.error('✗ pgvector extension NOT found')
    process.exit(1)
  }

  // Test 2: Insert a dummy vector row
  const dummyEmbedding = Array(1024).fill(0).map(() =>
    parseFloat(Math.random().toFixed(6))
  )

  await sql`
    INSERT INTO document_chunks
      (id, therapist_id, file_name, chunk_index, chunk_text, embedding)
    VALUES
      (
        gen_random_uuid(),
        'test-therapist-001',
        'test-document.pdf',
        0,
        'This is a test chunk for pgvector validation.',
        ${JSON.stringify(dummyEmbedding)}::vector
      )
  `
  console.log('✓ Dummy vector row inserted')

  // Test 3: Run a cosine similarity search
  const similar = await sql`
    SELECT
      id,
      chunk_text,
      1 - (embedding <=> ${JSON.stringify(dummyEmbedding)}::vector) AS similarity
    FROM document_chunks
    WHERE therapist_id = 'test-therapist-001'
    ORDER BY embedding <=> ${JSON.stringify(dummyEmbedding)}::vector
    LIMIT 3
  `
  console.log('✓ Cosine similarity search result:', similar)

  // Test 4: Clean up test data
  await sql`
    DELETE FROM document_chunks
    WHERE therapist_id = 'test-therapist-001'
  `
  console.log('✓ Test data cleaned up')

  console.log('\n✅ ALL TESTS PASSED — pgvector is ready')
  await prisma.$disconnect()
}

testPgVector().catch(e => {
  console.error('❌ TEST FAILED:', e)
  process.exit(1)
})
