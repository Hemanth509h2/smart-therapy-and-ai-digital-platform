'use client'

// Therapist-only EN / हिं / తె switch for module voice output.
// Same interaction and styling family as the EN/हिं/Both text toggle already used
// by the Skill Development modules; this one drives SPEECH, not on-screen text.

import { VOICE_LANGUAGES, setVoiceLanguage } from '@/lib/voice/useVoiceLanguage'
import { staadCancel, type VoiceLanguage } from '@/lib/voice/staadVoice'

const DEVANAGARI = "'Noto Sans Devanagari', 'DM Sans', sans-serif"
const TELUGU = "'Noto Sans Telugu', 'DM Sans', sans-serif"

export default function VoiceLanguageToggle({
  sessionId,
  language,
  title = 'Voice language',
}: {
  sessionId: string
  language: VoiceLanguage
  title?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }} title={title}>
      <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: 0.3 }}>
        VOICE
      </span>
      <div style={{ display: 'flex', background: 'rgba(255,255,255,0.06)', borderRadius: 999, padding: 2 }}>
        {VOICE_LANGUAGES.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => {
              // Drop anything mid-sentence in the old language.
              staadCancel()
              setVoiceLanguage(sessionId, key)
            }}
            style={{
              border: 'none',
              cursor: 'pointer',
              borderRadius: 999,
              padding: '3px 8px',
              fontSize: 9,
              fontWeight: 800,
              fontFamily: key === 'hi-IN' ? DEVANAGARI : key === 'te-IN' ? TELUGU : undefined,
              background: language === key ? 'rgba(74,124,111,0.35)' : 'transparent',
              color: language === key ? '#cfe6df' : 'rgba(255,255,255,0.45)',
              transition: 'all 0.15s',
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
