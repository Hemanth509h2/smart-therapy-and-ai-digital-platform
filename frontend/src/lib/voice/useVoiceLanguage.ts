'use client'

// Therapist-controlled voice language for module speech.
//
// Lives in liveSessions/{id}.moduleState.voiceLanguage, matching how every other
// per-module setting is stored and synced. Defaults to 'en-IN'. This is the only
// Firestore field this feature adds.

import { useEffect, useState } from 'react'
import { doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { VoiceLanguage } from './staadVoice'

export const VOICE_LANGUAGES: { key: VoiceLanguage; label: string }[] = [
  { key: 'en-IN', label: 'EN' },
  { key: 'hi-IN', label: 'हिं' },
  { key: 'te-IN', label: 'తె' },
]

function isVoiceLanguage(v: unknown): v is VoiceLanguage {
  return v === 'en-IN' || v === 'hi-IN' || v === 'te-IN'
}

/** Live voice language for this session. Every module reads it through this. */
export function useVoiceLanguage(sessionId: string): VoiceLanguage {
  const [language, setLanguage] = useState<VoiceLanguage>('en-IN')

  useEffect(() => {
    if (!sessionId) return
    const unsub = onSnapshot(doc(db, 'liveSessions', sessionId), (snap) => {
      if (!snap.exists()) return
      const v = snap.data()?.moduleState?.voiceLanguage
      if (isVoiceLanguage(v)) setLanguage(v)
    })
    return () => unsub()
  }, [sessionId])

  return language
}

/** Therapist-only write. Best-effort, same as every other moduleState write. */
export async function setVoiceLanguage(sessionId: string, language: VoiceLanguage): Promise<void> {
  try {
    await updateDoc(doc(db, 'liveSessions', sessionId), {
      'moduleState.voiceLanguage': language,
      'timestamps.updatedAt': new Date().toISOString(),
    })
  } catch (err) {
    // A silent failure here is exactly what hid the fact that the language was
    // never persisting during earlier testing.
    console.warn('[staadVoice] Failed to persist voiceLanguage', err)
  }
}
