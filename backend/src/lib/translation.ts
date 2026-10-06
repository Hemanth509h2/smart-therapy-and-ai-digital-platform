'use client'

// Live translation settings for a session.
//
// Separate from `moduleState.voiceLanguage`, which is one session-wide setting
// for module text-to-speech. Translation needs TWO languages at once — what the
// therapist speaks and what the client speaks — so each side can read captions
// in their own language. A single field cannot express that.
//
// Stored at liveSessions/{id}.moduleState.translation, matching how every other
// per-session setting is persisted, and controlled by the therapist.

import { useEffect, useState } from 'react'
import { doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { isTranslationLanguage } from '@/lib/translationLanguages'

export {
  TRANSLATION_LANGUAGES,
  isTranslationLanguage,
  languageLabel,
  languageNative,
  sttSupported,
} from '@/lib/translationLanguages'
export type { TranslationLanguage } from '@/lib/translationLanguages'

export interface TranslationSettings {
  /** Captions are only produced while this is true. */
  enabled: boolean
  /** Language the therapist SPEAKS. */
  therapist: string
  /** Language the client SPEAKS. */
  client: string
}

export const DEFAULT_TRANSLATION: TranslationSettings = {
  enabled: false,
  therapist: 'en',
  client: 'hi',
}

function parse(raw: unknown): TranslationSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_TRANSLATION
  const r = raw as Record<string, unknown>
  return {
    enabled: r.enabled === true,
    therapist: isTranslationLanguage(r.therapist) ? r.therapist : DEFAULT_TRANSLATION.therapist,
    client: isTranslationLanguage(r.client) ? r.client : DEFAULT_TRANSLATION.client,
  }
}

/** Live translation settings for this session. */
export function useTranslationSettings(sessionId: string): TranslationSettings {
  const [settings, setSettings] = useState<TranslationSettings>(DEFAULT_TRANSLATION)

  useEffect(() => {
    if (!sessionId) return
    const unsub = onSnapshot(doc(db, 'liveSessions', sessionId), (snap) => {
      if (!snap.exists()) return
      setSettings(parse(snap.data()?.moduleState?.translation))
    })
    return () => unsub()
  }, [sessionId])

  return settings
}

/** Therapist-only write. Rules already restrict moduleState writes to members. */
export async function writeTranslationSettings(
  sessionId: string,
  patch: Partial<TranslationSettings>
): Promise<void> {
  const update: Record<string, unknown> = { 'timestamps.updatedAt': new Date().toISOString() }
  if (patch.enabled !== undefined) update['moduleState.translation.enabled'] = patch.enabled
  if (patch.therapist !== undefined) update['moduleState.translation.therapist'] = patch.therapist
  if (patch.client !== undefined) update['moduleState.translation.client'] = patch.client
  try {
    await updateDoc(doc(db, 'liveSessions', sessionId), update)
  } catch {
    // Non-fatal: the picker reverts on the next snapshot.
  }
}

/**
 * Resolve one participant's own pair.
 *
 * You SPEAK your own language and READ the other person's, so each side gets
 * captions in the language they understand.
 */
export function pairForRole(
  settings: TranslationSettings,
  role: 'therapist' | 'client'
): { source: string; target: string } {
  return role === 'therapist'
    ? { source: settings.therapist, target: settings.client }
    : { source: settings.client, target: settings.therapist }
}
