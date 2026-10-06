import 'dotenv/config'
import { runAnalysis } from '../src/lib/rag/analysis'
import { appendTranscriptChunk, deleteSessionTranscript } from '../src/lib/rag/transcript-store'
import { generateEmbedding } from '../src/lib/rag/nvidia-client'
import { neon } from '@neondatabase/serverless'
import type { TranscriptChunk } from '../src/lib/rag/types'
import type { ClientProfile } from '../src/lib/rag/retrieval'

const sql = neon(process.env.DATABASE_URL!)

const TEST_SESSION_ID = `test-analysis-${Date.now()}`
const THERAPIST_ID = 'test-analysis-therapist'
const CLIENT_ID = 'test-analysis-client'

const clientProfile: ClientProfile = {
  clientId: CLIENT_ID,
  name: 'Test Client',
  age: 28,
  conditions: ['Anxiety', 'Social difficulty'],
  sessionNumber: 3,
  therapistId: THERAPIST_ID,
}

const sampleChunks: TranscriptChunk[] = [
  {
    text: "Hi, welcome back. How has your week been?",
    speaker: 'therapist',
    timestamp: Date.now() - 300000,
    sessionMinute: 0,
    isFinal: true,
  },
  {
    text: "It's been okay, I guess. I had a few moments where I felt really anxious, especially at work.",
    speaker: 'client',
    timestamp: Date.now() - 290000,
    sessionMinute: 0,
    isFinal: true,
  },
  {
    text: "Can you tell me more about what happened at work?",
    speaker: 'therapist',
    timestamp: Date.now() - 280000,
    sessionMinute: 0,
    isFinal: true,
  },
  {
    text: "My manager asked me to present in front of the team and I just froze. I felt my heart racing and I couldn't breathe properly.",
    speaker: 'client',
    timestamp: Date.now() - 270000,
    sessionMinute: 1,
    isFinal: true,
  },
  {
    text: "That sounds really difficult. What did you do in that moment?",
    speaker: 'therapist',
    timestamp: Date.now() - 260000,
    sessionMinute: 1,
    isFinal: true,
  },
  {
    text: "I tried the breathing exercise we practiced last time. It helped a little but I still felt really shaky afterward.",
    speaker: 'client',
    timestamp: Date.now() - 250000,
    sessionMinute: 1,
    isFinal: true,
  },
  {
    text: "That's good that you tried the breathing exercise. Let's work on some other grounding techniques today that might help you in those moments.",
    speaker: 'therapist',
    timestamp: Date.now() - 240000,
    sessionMinute: 2,
    isFinal: true,
  },
  {
    text: "I'd like that. Sometimes I feel like I'm the only one going through this and it gets overwhelming.",
    speaker: 'client',
    timestamp: Date.now() - 230000,
    sessionMinute: 2,
    isFinal: true,
  },
  {
    text: "You're definitely not alone. Many people experience these feelings. Let's explore some tools that can help you feel more in control.",
    speaker: 'therapist',
    timestamp: Date.now() - 220000,
    sessionMinute: 3,
    isFinal: true,
  },
]

async function seedTestData(): Promise<void> {
  console.log('=== Seeding test data ===\n')

  for (const chunk of sampleChunks) {
    await appendTranscriptChunk(TEST_SESSION_ID, chunk)
  }
  console.log(`✓ Seeded ${sampleChunks.length} transcript chunks`)

  const testStudyText = `Cognitive-behavioral techniques for social anxiety include:
1. Cognitive restructuring - identifying and challenging negative automatic thoughts
2. Exposure therapy - gradual, systematic exposure to feared social situations
3. Behavioral experiments - testing anxious predictions in real-world settings
4. Social skills training - practicing conversation skills and assertiveness
5. Relaxation techniques - progressive muscle relaxation and diaphragmatic breathing

Grounding techniques are particularly effective for acute anxiety episodes:
- 5-4-3-2-1 technique: identify 5 things you see, 4 you can touch, 3 you hear, 2 you smell, 1 you taste
- Deep breathing: inhale for 4 counts, hold for 4, exhale for 6
- Physical grounding: pressing feet into the floor, holding a textured object`

  const embedding = await generateEmbedding(testStudyText, 'passage')
  await sql`
    INSERT INTO document_chunks
      (id, therapist_id, session_id, file_name,
       chunk_index, chunk_text, embedding, metadata)
    VALUES (
      gen_random_uuid(),
      ${THERAPIST_ID},
      ${TEST_SESSION_ID},
      'anxiety-techniques.pdf',
      0,
      ${testStudyText},
      ${JSON.stringify(embedding)}::vector,
      ${JSON.stringify({ wordCount: testStudyText.split(/\s+/).length, chunkSize: 1 })}::jsonb
    )
  `
  console.log('✓ Seeded study material chunk')
  console.log('')
}

async function cleanUp(): Promise<void> {
  console.log('\n=== Cleaning up test data ===\n')

  await deleteSessionTranscript(TEST_SESSION_ID)

  await sql`DELETE FROM document_chunks WHERE therapist_id = ${THERAPIST_ID}`
  console.log('✓ Deleted document chunks')

  await sql`DELETE FROM "TherapistNote" WHERE "sessionId" = ${TEST_SESSION_ID}`
  await sql`DELETE FROM "Session" WHERE "id" = ${TEST_SESSION_ID}`

  console.log('✓ Cleanup complete\n')
}

async function main(): Promise<void> {
  console.log('='.repeat(60))
  console.log('Analysis Pipeline Test')
  console.log('='.repeat(60))
  console.log(`Session: ${TEST_SESSION_ID}`)
  console.log(`Therapist: ${THERAPIST_ID}`)
  console.log(`Client: ${CLIENT_ID}\n`)

  await seedTestData()

  try {
    console.log('Running analysis...\n')
    const insight = await runAnalysis({
      sessionId: TEST_SESSION_ID,
      therapistId: THERAPIST_ID,
      clientProfile,
      transcriptWindowMinutes: 10,
    })

    console.log('\n' + '-'.repeat(40))
    console.log('ANALYSIS RESULT:')
    console.log('-'.repeat(40))
    console.log(`Emotions:     [${insight.emotions.join(', ')}]`)
    console.log(`Summary:      ${insight.summary}`)
    console.log(`Steps:        [${insight.steps.map(s => `"${s}"`).join(', ')}]`)
    console.log(`Module:       ${insight.module}`)
    console.log(`Risk flag:    ${insight.riskFlag}`)
    console.log(`Generated at: ${new Date(insight.generatedAt).toISOString()}`)
    console.log(`Window:       ${insight.transcriptWindowMinutes} min`)
    console.log('-'.repeat(40))

    let passed = 0
    let failed = 0

    const check = (name: string, condition: boolean): void => {
      if (condition) {
        console.log(`  ✓ ${name}`)
        passed++
      } else {
        console.log(`  ✗ ${name}`)
        failed++
      }
    }

    console.log('\nVALIDATION:')
    check('emotions is an array with 2-4 entries',
      Array.isArray(insight.emotions) &&
      insight.emotions.length >= 2 &&
      insight.emotions.length <= 4)
    check('summary is a non-empty string',
      typeof insight.summary === 'string' && insight.summary.length > 10)
    check('steps is a non-empty array',
      Array.isArray(insight.steps) && insight.steps.length >= 1)
    check('module is a non-empty string',
      typeof insight.module === 'string' && insight.module.length > 0)
    check('riskFlag is false for this session', insight.riskFlag === false)
    check('generatedAt is a recent timestamp',
      typeof insight.generatedAt === 'number' &&
      insight.generatedAt > Date.now() - 120000)

    console.log(`\n${'='.repeat(40)}`)
    console.log(`Results: ${passed} passed, ${failed} failed`)
    console.log(`${'='.repeat(40)}`)

    if (failed > 0) {
      process.exit(1)
    }
  } finally {
    await cleanUp()
  }
}

main().catch((e) => {
  console.error('Test failed:', e)
  cleanUp().catch(() => {})
  process.exit(1)
})
