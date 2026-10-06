'use client'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'

/**
 * The session diary: `sessions/{sessionId}/rawSessionLog`.
 *
 * A time-series of everything observed during a session, one document per
 * entry, ordered by server timestamp so entries from independent producers
 * (transcription, attention scoring) can be read back interleaved.
 *
 * WHY A SUBCOLLECTION, not an array field on the session doc:
 * the rest of Staad keeps time-series data in arrays on `sessions/{id}`
 * (`transcript`, `moduleEvents`, `therapistNotes`) via `arrayUnion`. That
 * pattern does not extend here. Attention samples land every 5-10s for the
 * whole session, and `arrayUnion` rewrites the ENTIRE document on every write
 * — cost and contention grow with session length, and Firestore's 1MB
 * document ceiling becomes a hard cap on session duration. A subcollection
 * makes each write O(1) and unbounded.
 *
 * CURRENT STATE — only attention entries are written here.
 * Transcript entries still go to the `transcript` array on `sessions/{id}`
 * (see useSessionTranscription.writeChunk / lib/rag/transcript-store.ts) and
 * were deliberately left untouched. So a diary read-back is NOT yet a complete
 * interleaved picture of the session. Dual-writing transcripts into this
 * collection is a tracked follow-up.
 */

export type SessionLogEntryType = 'transcript' | 'attention'

export interface SessionLogEntry {
  /** Server-assigned; the ordering key for interleaving. */
  timestamp: unknown
  type: SessionLogEntryType
  /** string for `transcript`, whole number 0-100 for `attention`. */
  value: string | number
}

/**
 * Append one attention score to the diary.
 *
 * `score` must already be a whole number in 0-100; it is clamped and rounded
 * defensively so a bad sample can never poison the stored series.
 *
 * Only the resulting NUMBER is written. No frame, landmark set, or image data
 * is persisted or transmitted anywhere — that is the privacy contract of this
 * feature, and this function is the only egress point for attention data.
 */
export async function appendAttentionEntry(
  sessionId: string,
  score: number
): Promise<void> {
  const safe = Math.max(0, Math.min(100, Math.round(score)))
  await addDoc(collection(db, 'sessions', sessionId, 'rawSessionLog'), {
    timestamp: serverTimestamp(),
    type: 'attention' satisfies SessionLogEntryType,
    value: safe,
  })
}
