'use client'
import { doc, updateDoc, arrayUnion, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'

// A single meaningful thing the client/therapist did inside a therapy module.
// These accumulate on the persistent `sessions/{id}` doc (alongside the
// transcript) so the end-of-session report generator can describe what
// actually happened in each activity — not just what was said.
export interface ModuleEvent {
  module: string // module id, e.g. 'virtual-shop'
  type: string // short machine label, e.g. 'purchase_completed'
  detail: string // human-readable summary for the report
  timestamp: number
}

// Append one event to the session timeline. Fire-and-forget: a logging failure
// must never break the live module, so errors are swallowed (warned only).
// Call this from the single browser that performs the action (the actor's
// handler) to avoid duplicate entries from the synced participant.
export async function logModuleEvent(
  sessionId: string,
  event: Omit<ModuleEvent, 'timestamp'>
): Promise<void> {
  if (!sessionId) return
  try {
    await updateDoc(doc(db, 'sessions', sessionId), {
      moduleEvents: arrayUnion({ ...event, timestamp: Date.now() }),
      moduleEventsLastUpdated: serverTimestamp(),
    })
  } catch (e) {
    console.warn('[sessionEvents] Failed to log module event:', e)
  }
}
