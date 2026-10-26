'use client'

// "Live captions on video": whether the subtitle bar shows at the bottom of the
// call. One switch for the whole session, set by the therapist in the Captions
// popup, and followed by both the therapist's and the client's screens.
//
// It only hides the subtitles. Transcription keeps running underneath (the AI
// Notes transcript, insights and the Call Plan need it), and the therapist's
// caption log keeps filling.
//
// Stored at liveSessions/{id}.moduleState.captionsOnVideo, like the translation
// settings (lib/translation.ts). Missing = on, so clients see captions unless
// the therapist turns them off.

import { useEffect, useState } from 'react'
import { doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firestore'

export function useCaptionsOnVideo(sessionId: string): boolean {
  const [on, setOn] = useState(true)

  useEffect(() => {
    if (!sessionId) return
    const unsub = onSnapshot(doc(db, 'liveSessions', sessionId), (snap) => {
      if (!snap.exists()) return
      setOn(snap.data()?.moduleState?.captionsOnVideo !== false)
    })
    return () => unsub()
  }, [sessionId])

  return on
}

/** Therapist-only write. Rules already restrict moduleState writes to members. */
export async function writeCaptionsOnVideo(sessionId: string, on: boolean): Promise<void> {
  try {
    await updateDoc(doc(db, 'liveSessions', sessionId), {
      'moduleState.captionsOnVideo': on,
      'timestamps.updatedAt': new Date().toISOString(),
    })
  } catch {
    // Non-fatal: the switch reverts on the next snapshot.
  }
}
