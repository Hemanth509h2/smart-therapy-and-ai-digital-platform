'use client'
import { useState } from 'react'
import { Sparkles, ShieldCheck } from 'lucide-react'

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

        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6, marginBottom: 6 }}>
          {userRole === 'therapist'
            ? 'Enables live transcription and AI insights visible only to you. Audio is deleted within 24 hours.'
            : 'Your therapist uses AI to improve session quality. Audio is transcribed and automatically deleted within 24 hours.'}
        </p>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6, marginBottom: 20 }}>
          The AI only observes and summarises — it makes no clinical decisions. Your privacy is
          protected and you can decline without affecting the session.
        </p>

        {!decided ? (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              onClick={() => handleChoice(false)}
              style={{
                fontSize: 12,
                fontWeight: 500,
                padding: '9px 20px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'transparent',
                color: 'rgba(255,255,255,0.5)',
                cursor: 'pointer',
                fontFamily: 'DM Sans, sans-serif',
              }}
            >
              Decline
            </button>
            <button
              onClick={() => handleChoice(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                fontSize: 12,
                fontWeight: 600,
                padding: '9px 20px',
                borderRadius: 10,
                border: '1px solid rgba(30,53,48,0.25)',
                background: '#A8C9BE',
                color: '#1E3530',
                cursor: 'pointer',
                fontFamily: 'DM Sans, sans-serif',
              }}
            >
              <ShieldCheck size={14} />
              I Consent
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: choice ? '#4caf86' : 'rgba(255,255,255,0.35)' }}>
            {choice
              ? otherPartyConsented
                ? 'Both parties consented — AI features active'
                : `Waiting for ${userRole === 'therapist' ? 'client' : 'therapist'} to consent...`
              : 'Declined'}
          </div>
        )}
      </div>
    </div>
  )
}
