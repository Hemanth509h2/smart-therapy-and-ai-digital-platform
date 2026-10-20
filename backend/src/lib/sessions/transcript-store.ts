import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/core/firebaseAdmin'

// Session data on the persistent `sessions/{id}` Firestore doc that the AI
// features read (the AI work itself runs in the Python AI service, see
// lib/ai-service.ts): the live transcript, consent, module activity and in-call
// notes, plus the copilot's audit trail.

// One transcript line, as written by the therapist's browser
// (frontend/src/hooks/useSessionTranscription.ts).
export interface TranscriptChunk {
  text: string
  speaker: 'therapist' | 'client' | 'unknown'
  timestamp: number
  sessionMinute: number
}

export async function getSessionTranscript(
  sessionId: string
): Promise<TranscriptChunk[]> {
  const ref = adminDb().collection('sessions').doc(sessionId)
  const doc = await ref.get()
  if (!doc.exists) return []
  return (doc.data()?.transcript ?? []) as TranscriptChunk[]
}

export async function checkAIConsent(
  sessionId: string
): Promise<boolean> {
  const ref = adminDb().collection('sessions').doc(sessionId)
  const doc = await ref.get()
  if (!doc.exists) return false
  const consent = doc.data()?.aiConsent
  return consent?.therapist === true && consent?.client === true
}

export interface SessionActivity {
  // Human-readable summaries of what happened inside therapy modules this session.
  moduleEvents: string[]
  // The therapist's in-call typed notes (optional — often empty).
  inCallNotes: string[]
}

// Pull the in-session activity timeline + in-call notes from the same persistent
// `sessions/{id}` doc the transcript lives on. Feeds the copilot so suggestions
// account for what was actually DONE, not just what was said.
export async function getSessionActivity(
  sessionId: string
): Promise<SessionActivity> {
  const doc = await adminDb().collection('sessions').doc(sessionId).get()
  const d = doc.exists ? doc.data() ?? {} : {}
  const moduleEvents = Array.isArray(d.moduleEvents)
    ? (d.moduleEvents as Array<{ detail?: unknown }>)
        .map(e => (typeof e?.detail === 'string' ? e.detail : ''))
        .filter(Boolean)
    : []
  const inCallNotes = Array.isArray(d.therapistNotes)
    ? (d.therapistNotes as Array<{ content?: unknown }>)
        .map(n => (typeof n?.content === 'string' ? n.content : ''))
        .filter(Boolean)
    : []
  return { moduleEvents, inCallNotes }
}

export interface CopilotEventLog {
  timestamp: number
  summary: string
  module: string
  riskFlag: boolean
  riskLevel: string
  riskDetail: string
}

// Lightweight audit trail of every copilot suggestion the therapist requested.
// Append-only on the session doc so it survives alongside the transcript and can
// later feed the end-of-session report ("copilot flagged a concern at 14:32").
// Fire-and-forget: a logging failure must never break the live copilot.
export async function appendCopilotEvent(
  sessionId: string,
  event: CopilotEventLog
): Promise<void> {
  try {
    await adminDb().collection('sessions').doc(sessionId).set(
      {
        copilotEvents: FieldValue.arrayUnion(event),
        copilotEventsLastUpdated: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
  } catch (e) {
    console.warn('[transcript-store] Failed to log copilot event:', e)
  }
}
