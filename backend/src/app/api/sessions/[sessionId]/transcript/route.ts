import { NextResponse } from 'next/server'
import { prisma } from '@/lib/core/db'
import { requireTherapist } from '@/lib/http/progressAuth'
import { getSetting } from '@/lib/core/settings'
import { errorResponse } from '@/lib/http/apiError'
import { appendTranscriptChunk, checkAIConsent } from '@/lib/ai/rag/transcript-store'
import type { TranscriptChunk } from '@/lib/ai/rag/types'
import {
  TranscriptCryptoError,
  encryptText,
  isTranscriptEncryptionEnabled,
} from '@/lib/sessions/transcript-crypto'

// POST /api/sessions/[sessionId]/transcript — save one final transcript chunk
// server-side, encrypted when TRANSCRIPT_ENCRYPTION_ENABLED is 'true'.
//
// HIPAA work, step 2: the browser still writes transcripts straight to
// Firestore (useSessionTranscription.writeChunk). Nothing calls this route
// yet; step 3 switches the browser over. Encryption happens here, not in the
// browser, so the key never leaves the server.
//
// Body: { text, speaker: 'therapist' | 'client', timestamp, sessionMinute }.
// Never log the transcript text.

const MAX_TEXT_LENGTH = 10_000
const SPEAKERS = ['therapist', 'client'] as const

export async function POST(request: Request, { params }: { params: { sessionId: string } }) {
  try {
    const auth = await requireTherapist(request)
    if (!auth.ok) return auth.response

    // Ownership check before consent, body parsing or writes. Non-owned and
    // non-existent sessions get the same 404.
    const sessionId = params.sessionId
    const session = await prisma.session.findFirst({
      where: { id: sessionId, therapistId: auth.therapist.id },
      select: { id: true },
    })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    if (!(await getSetting('features.transcription'))) {
      return NextResponse.json({ error: 'Transcription is turned off by an admin.' }, { status: 503 })
    }

    // Same non-production test-mode bypass as /api/ai-insight.
    const sttTestMode =
      process.env.NEXT_PUBLIC_STT_TEST_MODE === 'true' &&
      process.env.NODE_ENV !== 'production'
    if (!(await checkAIConsent(sessionId)) && !sttTestMode) {
      return NextResponse.json(
        {
          error: 'Transcription not consented',
          detail: 'Both therapist and client must consent to AI analysis',
        },
        { status: 403 }
      )
    }

    const body = await request.json().catch(() => null)
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    const { speaker, timestamp, sessionMinute } = body ?? {}
    if (
      !text ||
      text.length > MAX_TEXT_LENGTH ||
      !SPEAKERS.includes(speaker) ||
      !Number.isFinite(timestamp) ||
      timestamp <= 0 ||
      !Number.isInteger(sessionMinute) ||
      sessionMinute < 0
    ) {
      return NextResponse.json({ error: 'Invalid transcript chunk' }, { status: 400 })
    }

    let stored = text
    if (isTranscriptEncryptionEnabled()) {
      try {
        stored = encryptText(text)
      } catch (e) {
        // Encryption is on but the key is missing or invalid. Refuse to save
        // rather than fall back to plain text.
        if (e instanceof TranscriptCryptoError) {
          console.warn('[transcript] Encryption is enabled but the key is unusable; chunk not saved')
          return NextResponse.json({ error: 'Transcript storage unavailable' }, { status: 503 })
        }
        throw e
      }
    }

    const chunk: TranscriptChunk = {
      text: stored,
      speaker: speaker as TranscriptChunk['speaker'],
      timestamp,
      sessionMinute,
      isFinal: true,
    }
    await appendTranscriptChunk(sessionId, chunk)

    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error, 'Transcript POST')
  }
}
