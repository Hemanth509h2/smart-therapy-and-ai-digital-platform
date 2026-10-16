'use client'

// Client waiting lobby: shown while the guest waits for the therapist to let
// them in (<GuestAdmissionGate>), and by <StaadVideo> while the backend
// withholds the video token. Styled with the website's STAAD design system
// (.staad-ui tokens), so it follows the site's light/dark theme.
//
// The camera preview lets the client check how they look before the call. Its
// stream is stopped on unmount so LiveKit can take the camera when they join.

import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff } from 'lucide-react'

const TIPS = [
  'Find a quiet, private place for your session.',
  'Headphones help the therapist hear you clearly.',
  'Keep your face well lit and in view of the camera.',
]

export default function WaitingLobby({
  therapistName,
  selfName,
  title,
  message,
}: {
  therapistName?: string
  selfName?: string
  /** Override the default "Waiting for … to join" copy (e.g. the admission waiting room). */
  title?: string
  message?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameraOn, setCameraOn] = useState(true)
  const [cameraError, setCameraError] = useState('')
  const [waited, setWaited] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setWaited((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const stop = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (!cameraOn) {
      stop()
      return
    }
    let cancelled = false
    navigator.mediaDevices
      ?.getUserMedia({ video: true, audio: false })
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop())
        streamRef.current = stream
        setCameraError('')
        if (videoRef.current) videoRef.current.srcObject = stream
      })
      .catch(() => {
        if (!cancelled) setCameraError('Camera is blocked or unavailable. You can still join with audio.')
      })
    return () => {
      cancelled = true
      stop()
    }
  }, [cameraOn])

  const mm = String(Math.floor(waited / 60)).padStart(2, '0')
  const ss = String(waited % 60).padStart(2, '0')
  const who = therapistName && therapistName !== 'Therapist' ? therapistName : 'your therapist'

  return (
    <main
      className="staad-ui"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 920,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 20,
          alignItems: 'center',
        }}
      >
        {/* Self preview */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            // Grid items default to min-width:auto, and the <video>'s intrinsic
            // width would then push this column into the status card.
            minWidth: 0,
            aspectRatio: '4 / 3',
            borderRadius: 32,
            overflow: 'hidden',
            background: 'var(--panel)',
            border: '1px solid var(--line)',
          }}
        >
          {cameraOn && !cameraError ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
            />
          ) : (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                padding: 20,
                textAlign: 'center',
                color: 'rgba(255,255,255,0.7)',
                fontSize: 13,
              }}
            >
              <CameraOff size={28} />
              {cameraError || 'Camera is off'}
            </div>
          )}
          {selfName && (
            <span className="badge" style={{ position: 'absolute', left: 14, bottom: 14, background: 'var(--surface-2)', color: 'var(--ink)', fontWeight: 600 }}>
              {selfName} (you)
            </span>
          )}
          <button
            type="button"
            onClick={() => setCameraOn((v) => !v)}
            title={cameraOn ? 'Turn camera off' : 'Turn camera on'}
            aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
            style={{
              position: 'absolute',
              right: 14,
              bottom: 14,
              width: 42,
              height: 42,
              borderRadius: '50%',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              background: cameraOn ? 'var(--surface-2)' : 'var(--red)',
              color: cameraOn ? 'var(--ink)' : '#fff',
            }}
          >
            {cameraOn ? <Camera size={18} /> : <CameraOff size={18} />}
          </button>
        </div>

        {/* Status */}
        <section className="card" style={{ transform: 'none', padding: 32, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <span style={{ position: 'relative', width: 10, height: 10 }}>
              <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--ok)', animation: 'lobbyPing 1.6s ease-out infinite' }} />
              <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--ok)' }} />
            </span>
            <span className="eyebrow">Waiting room</span>
          </div>

          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontSize: 26,
              lineHeight: 1.25,
              fontWeight: 500,
              letterSpacing: '-0.4px',
              color: 'var(--ink)',
            }}
          >
            {title ?? `Waiting for ${who} to join`}
          </h1>
          <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.6, color: 'var(--muted)' }}>
            {message ?? "You'll be connected automatically as soon as they arrive. Please keep this page open."}
          </p>

          <div>
            <span className="badge badge--neutral" style={{ marginTop: 20, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
              Waiting {mm}:{ss}
            </span>
          </div>

          <ul style={{ margin: '24px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {TIPS.map((tip) => (
              <li key={tip} style={{ display: 'flex', gap: 10, fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink)' }}>
                <span style={{ marginTop: 6, width: 6, height: 6, flexShrink: 0, borderRadius: '50%', background: 'var(--ok)' }} />
                {tip}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <style>{`
        @keyframes lobbyPing {
          0% { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(2.6); opacity: 0; }
        }
      `}</style>
    </main>
  )
}
