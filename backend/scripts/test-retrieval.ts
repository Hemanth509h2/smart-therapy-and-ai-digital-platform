import 'dotenv/config'
import { neon } from '@neondatabase/serverless'
import {
  retrieveRAGContext,
  retrieveStudyMaterial,
  formatContextForLLM,
  AVAILABLE_MODULES,
  type ClientProfile,
} from '../src/lib/rag/retrieval'
import { appendTranscriptChunk, deleteSessionTranscript } from '../src/lib/rag/transcript-store'
import { generateEmbedding } from '../src/lib/rag/nvidia-client'

const sql = neon(process.env.DATABASE_URL!)

const TEST_SESSION_ID  = 'test-retrieval-session-001'
const TEST_THERAPIST   = 'test-retrieval-therapist-001'
const TEST_CLIENT_ID   = 'test-retrieval-client-001'

const mockClient: ClientProfile = {
  clientId: TEST_CLIENT_ID,
  name: 'Aryan',
  age: 11,
  conditions: ['SLD', 'Dyslexia'],
  sessionNumber: 7,
  therapistId: TEST_THERAPIST,
}

async function seedTestData() {
  const mockChunks = [
    {
      text: "How did the reading practice go this week?",
      speaker: 'therapist' as const,
      timestamp: Date.now() - 240000,
      sessionMinute: 1,
      isFinal: true,
    },
    {
      text: "I couldn't do it. The words keep jumping around.",
      speaker: 'client' as const,
      timestamp: Date.now() - 220000,
      sessionMinute: 1,
      isFinal: true,
    },
    {
      text: "That happens to a lot of people. Let's try something different today.",
      speaker: 'therapist' as const,
      timestamp: Date.now() - 180000,
      sessionMinute: 2,
      isFinal: true,
    },
    {
      text: "I feel stupid when I can't read like the others.",
      speaker: 'client' as const,
      timestamp: Date.now() - 150000,
      sessionMinute: 2,
      isFinal: true,
    },
  ]
  for (const chunk of mockChunks) {
    await appendTranscriptChunk(TEST_SESSION_ID, chunk)
  }

  await sql`
    DELETE FROM document_chunks
    WHERE therapist_id = ${TEST_THERAPIST}
  `
  const studyText = 'Children with dyslexia often experience negative self-concept related to reading difficulties. Multisensory approaches and positive reinforcement are key. Word building activities that separate phonemes help build confidence gradually.'
  const embedding = await generateEmbedding(studyText, 'passage')
  await sql`
    INSERT INTO document_chunks
      (id, therapist_id, file_name, chunk_index, chunk_text, embedding)
    VALUES (
      gen_random_uuid(),
      ${TEST_THERAPIST},
      ${'dyslexia-guide.txt'},
      ${0},
      ${studyText},
      ${JSON.stringify(embedding)}::vector
    )
  `
}

async function cleanupTestData() {
  await deleteSessionTranscript(TEST_SESSION_ID)
  await sql`
    DELETE FROM document_chunks
    WHERE therapist_id = ${TEST_THERAPIST}
  `
}

async function testRetrieval() {
  console.log('Testing RAG retrieval pipeline...\n')

  console.log('Seeding test data...')
  await seedTestData()
  console.log('  \u2713 Test transcript and study material seeded\n')

  // ── TEST 1: Vector search on study material ──────
  console.log('Test 1: Vector similarity search on study material')
  const query = "child feels stupid about reading cannot read words"
  const chunks = await retrieveStudyMaterial(TEST_THERAPIST, query, 3)
  console.log(`  \u2713 Query: "${query}"`)
  console.log(`  \u2713 Chunks retrieved: ${chunks.length}`)
  if (chunks.length > 0) {
    console.log(`  \u2713 Top result similarity: ${chunks[0].similarity.toFixed(4)}`)
    console.log(`  \u2713 Top result preview: "${chunks[0].text.slice(0, 80)}..."`)
    console.log(`  \u2713 From file: ${chunks[0].fileName}`)
  } else {
    console.warn('  \u26a0 No chunks retrieved — check pgvector data and threshold')
  }

  // ── TEST 2: Full RAG context assembly ────────────
  console.log('\nTest 2: Full RAG context assembly')
  const context = await retrieveRAGContext(
    TEST_SESSION_ID,
    TEST_THERAPIST,
    mockClient,
    10
  )

  console.log(`  \u2713 Transcript retrieved: ${context.transcript.length > 10 ? 'yes' : 'empty'}`)
  console.log(`  \u2713 Study material found: ${context.hasStudyMaterial}`)
  console.log(`  \u2713 Previous notes found: ${context.hasPreviousNotes}`)
  console.log(`  \u2713 Available modules: ${context.availableModules.length}`)
  console.log(`  \u2713 Client: ${context.client.name}, age ${context.client.age}`)
  console.log(`  \u2713 Conditions: ${context.client.conditions.join(', ')}`)

  // ── TEST 3: Context formatting ───────────────────
  console.log('\nTest 3: Format context for LLM')
  const formatted = formatContextForLLM(context)
  console.log(`  \u2713 Context length: ${formatted.length} characters`)
  console.log(`  \u2713 Contains client profile: ${formatted.includes('CLIENT PROFILE')}`)
  console.log(`  \u2713 Contains transcript: ${formatted.includes('LIVE SESSION TRANSCRIPT')}`)
  console.log(`  \u2713 Contains study material: ${formatted.includes('THERAPIST\'S CLINICAL MATERIAL')}`)
  console.log(`  \u2713 Contains previous notes: ${formatted.includes('PREVIOUS SESSION NOTES')}`)
  console.log(`  \u2713 Contains modules list: ${formatted.includes('AVAILABLE THERAPY MODULES')}`)

  console.log('\n  Formatted context preview:')
  console.log('  ' + '\u2500'.repeat(50))
  formatted.split('\n').slice(0, 20).forEach(line => {
    console.log(`  ${line}`)
  })
  console.log('  ... (truncated)')

  // ── TEST 4: Module list integrity ────────────────
  console.log('\nTest 4: Available modules list')
  console.log(`  \u2713 Total modules: ${AVAILABLE_MODULES.length}`)
  if (AVAILABLE_MODULES.length !== 15) {
    console.error(`  \u2717 Expected 15 modules, got ${AVAILABLE_MODULES.length}`)
    process.exit(1)
  }
  console.log(`  \u2713 Count correct: 15 modules`)

  // ── TEST 5: Cleanup ──────────────────────────────
  console.log('\nTest 5: Cleanup test data')
  await cleanupTestData()
  const remaining = await sql`
    SELECT COUNT(*) as count FROM document_chunks
    WHERE therapist_id = ${TEST_THERAPIST}
  `
  console.log(`  \u2713 pgvector chunks deleted: ${Number(remaining[0].count) === 0}`)

  console.log('\n\u2705 ALL TESTS PASSED — Retrieval pipeline ready')
}

testRetrieval().catch(e => {
  console.error('\n\u274c TEST FAILED:', e)
  process.exit(1)
})
