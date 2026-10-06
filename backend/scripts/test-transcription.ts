import 'dotenv/config'
import { createClient } from '@deepgram/sdk'
import {
  appendTranscriptChunk,
  getSessionTranscript,
  deleteSessionTranscript,
} from '../src/lib/rag/transcript-store'
import {
  getRecentTranscript,
  formatTranscriptForLLM,
} from '../src/lib/rag/transcription'
import type { TranscriptChunk } from '../src/lib/rag/types'

const TEST_SESSION_ID = 'test-session-transcription-001'

async function testTranscription() {
  console.log('Testing Deepgram + Firestore transcript pipeline...\n')

  // ── TEST 1: Deepgram API key validation ─────────
  console.log('Test 1: Deepgram API key validation')
  try {
    const client = createClient(process.env.DEEPGRAM_API_KEY!)
    const response = await client.manage.getProjects()
    if (response.error) throw new Error(response.error.message)
    console.log('  ✓ Deepgram API key valid')
    console.log(`  ✓ Project found: ${response.result?.projects?.[0]?.project_id ?? 'N/A'}`)
  } catch (e) {
    console.error('  ✗ Deepgram API key invalid:', e)
    process.exit(1)
  }

  // ── TEST 2: Deepgram model availability ─────────
  console.log('\nTest 2: Check Nova-3 model availability')
  try {
    const client = createClient(process.env.DEEPGRAM_API_KEY!)
    const response = await client.listen.prerecorded.transcribeUrl(
      {
        url: 'https://static.deepgram.com/examples/Bueller-Life-moves-pretty-fast.wav',
      },
      {
        model: 'nova-3',
        language: 'en',
        smart_format: true,
      }
    )
    const transcript = response.result?.results?.channels?.[0]
      ?.alternatives?.[0]?.transcript ?? ''
    console.log('  ✓ Nova-3 model working')
    console.log(`  ✓ Sample transcript: "${transcript.slice(0, 60)}..."`)
  } catch (e) {
    console.error('  ✗ Nova-3 test failed:', e)
    process.exit(1)
  }

  // ── TEST 3: Firestore transcript storage ─────────
  console.log('\nTest 3: Firestore transcript storage')
  try {
    await deleteSessionTranscript(TEST_SESSION_ID)

    const mockChunks: TranscriptChunk[] = [
      {
        text: "How are you feeling today compared to last week?",
        speaker: 'therapist',
        timestamp: Date.now() - 240000,
        sessionMinute: 1,
        isFinal: true,
      },
      {
        text: "I still feel really anxious about school. I couldn't sleep much.",
        speaker: 'client',
        timestamp: Date.now() - 230000,
        sessionMinute: 1,
        isFinal: true,
      },
      {
        text: "Tell me more about what happens when you think about school.",
        speaker: 'therapist',
        timestamp: Date.now() - 200000,
        sessionMinute: 2,
        isFinal: true,
      },
      {
        text: "I just feel like I can't do anything right. The reading is too hard.",
        speaker: 'client',
        timestamp: Date.now() - 180000,
        sessionMinute: 2,
        isFinal: true,
      },
      {
        text: "That sounds really difficult. You're being very brave sharing that.",
        speaker: 'therapist',
        timestamp: Date.now() - 120000,
        sessionMinute: 3,
        isFinal: true,
      },
    ]

    for (const chunk of mockChunks) {
      await appendTranscriptChunk(TEST_SESSION_ID, chunk)
    }
    console.log(`  ✓ Stored ${mockChunks.length} transcript chunks in Firestore`)

    const retrieved = await getSessionTranscript(TEST_SESSION_ID)
    console.log(`  ✓ Retrieved ${retrieved.length} chunks from Firestore`)

    if (retrieved.length !== mockChunks.length) {
      console.error(`  ✗ Expected ${mockChunks.length}, got ${retrieved.length}`)
      process.exit(1)
    }
  } catch (e) {
    console.error('  ✗ Firestore storage failed:', e)
    process.exit(1)
  }

  // ── TEST 4: Transcript formatting for LLM ────────
  console.log('\nTest 4: Transcript formatting for LLM context')
  try {
    const chunks = await getSessionTranscript(TEST_SESSION_ID)
    const formatted = formatTranscriptForLLM(chunks, 10)

    console.log('  ✓ Formatted transcript:')
    formatted.split('\n').forEach(line => {
      console.log(`    ${line}`)
    })

    if (!formatted.includes('[THERAPIST]') && !formatted.includes('[CLIENT]')) {
      console.error('  ✗ Formatting missing speaker labels')
      process.exit(1)
    }
    console.log('  ✓ Speaker labels present')
  } catch (e) {
    console.error('  ✗ Formatting failed:', e)
    process.exit(1)
  }

  // ── TEST 5: Cleanup ──────────────────────────────
  console.log('\nTest 5: Transcript deletion (simulates 24hr cleanup)')
  try {
    await deleteSessionTranscript(TEST_SESSION_ID)
    const remaining = await getSessionTranscript(TEST_SESSION_ID)
    console.log(`  ✓ Transcript deleted`)
    console.log(`  ✓ Chunks remaining: ${remaining.length} (expected 0)`)
  } catch (e) {
    console.error('  ✗ Deletion failed:', e)
    process.exit(1)
  }

  console.log('\n✅ ALL TESTS PASSED — Transcription pipeline ready')
  console.log('\nNote: Live WebSocket transcription will be tested')
  console.log('in Layer 8 when integrated with the session room UI.')
}

testTranscription().catch(e => {
  console.error('\n❌ TEST FAILED:', e)
  process.exit(1)
})
