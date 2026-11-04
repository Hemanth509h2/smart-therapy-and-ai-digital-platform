'use client'
import { useState } from 'react'
import type React from 'react'
import { Sparkles } from 'lucide-react'

// AI session consent gate.
//
// VISUAL RESTRUCTURE ONLY (top strip banner -> centred modal over a blurred
// backdrop). The consent contract is untouched: same props, same
// onConsent(boolean) call, same "waiting for the other party" state. The caller
// still owns the Firestore write (aiConsent.therapist / aiConsent.client) and
// the gating of transcription.
interface AIConsentBannerProps {
  userRole: 'therapist' | 'client'
  onConsent: (given: boolean) => void
  otherPartyConsented: boolean
}

const choiceButton: React.CSSProperties = {
  minWidth: 140,
  fontSize: 12.5,
  fontWeight: 600,
  padding: '10px 18px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.45)',
  background: 'rgba(255,255,255,0.1)',
  color: '#ffffff',
  cursor: 'pointer',
  fontFamily: '"DM Sans", sans-serif',
}

export default function AIConsentBanner({
  userRole,
  onConsent,
  otherPartyConsented,
}: AIConsentBannerProps) {
  const [decided, setDecided] = useState(false)
  const [choice, setChoice] = useState<boolean | null>(null)

  function handleChoice(given: boolean) {
    setChoice(given)
    setDecided(true)
    onConsent(given)
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 110,
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          width: 'min(92vw, 420px)',
          background: 'rgba(28, 28, 28, 0.72)',
          backdropFilter: 'blur(20px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
          border: '1px solid rgba(255, 255, 255, 0.14)',
          borderRadius: 20,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25)',
          padding: '26px 26px 22px',
          textAlign: 'center',
        }}
      >
        {/* Icon */}
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: 14,
            margin: '0 auto 14px',
            background: 'rgba(107,92,231,0.2)',
            border: '1px solid rgba(107,92,231,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#a89ae8',
          }}
        >
          <Sparkles size={22} />
        </div>

        <div style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginBottom: 8 }}>
          AI Session Consent
        </div>

        {/* Plain, neutral wording: what runs, where the audio goes, how long the
            transcript is kept. Nothing here nudges toward "yes". */}
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.82)', lineHeight: 1.6, marginBottom: 6 }}>
          {userRole === 'therapist'
            ? 'Turns on live captions and a transcript, AI insights shown only to you, and an AI-drafted session report. Audio is sent live to our speech-to-text provider and is not recorded. Transcripts are deleted automatically, by default within 48 hours.'
            : 'Your therapist would like to use AI in this session for live captions, a transcript and notes that only your therapist sees. Audio is sent live to our speech-to-text provider and is not recorded. Transcripts are deleted automatically, by default within 48 hours.'}
        </p>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.74)', lineHeight: 1.6, marginBottom: 20 }}>
          AI can make mistakes. It only observes and summarises, makes no clinical decisions, and
          your therapist reviews what it produces. Saying no doesn&apos;t change anything else in
          the session.{' '}
          <a href="/privacy#ai" target="_blank" rel="noopener" style={{ color: '#a89ae8', textDecoration: 'underline' }}>
            How AI uses session data
          </a>
        </p>

        {!decided ? (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            {/* Both choices look the same, so neither is the "obvious" one. */}
            <button type="button" onClick={() => handleChoice(false)} style={choiceButton}>
              No, don&apos;t use AI
            </button>
            <button type="button" onClick={() => handleChoice(true)} style={choiceButton}>
              Yes, use AI
            </button>
          </div>
        ) : (
          <div role="status" style={{ fontSize: 11, color: choice ? '#7fdcb0' : 'rgba(255,255,255,0.74)' }}>
            {choice
              ? otherPartyConsented
                ? 'Both parties consented — AI features active'
                : `Waiting for ${userRole === 'therapist' ? 'client' : 'therapist'} to consent...`
              : 'You said no. AI features stay off for this session.'}
          </div>
        )}
      </div>
    </div>
  )
}
