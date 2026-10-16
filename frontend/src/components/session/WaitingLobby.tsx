'use client'

// Client waiting lobby, shown by <StaadVideo> while the backend withholds the
// video token because the therapist is not in the room yet. The client joins
// automatically once they are (StaadVideo keeps polling).
//
// The camera preview lets the client check how they look before the call. Its
// stream is stopped on unmount so LiveKit can take the camera when they join.

import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff } from 'lucide-react'
import { RC } from './roomTheme'

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
    <div
      style={{
        // StaadVideo is the session page's root, so take the whole viewport.
        minHeight: '100vh',
        width: '100%',
        background: RC.pageBg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 880,
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
            aspectRatio: '4 / 3',
            borderRadius: 20,
            overflow: 'hidden',
            background: '#1f2427',
            boxShadow: '0 12px 32px rgba(20,30,40,0.12)',
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
            <span
              style={{
                position: 'absolute',
                left: 12,
                bottom: 12,
                padding: '3px 10px',
                borderRadius: 10,
                background: 'rgba(255,255,255,0.92)',
                color: RC.ink,
                fontSize: 12.5,
                fontWeight: 600,
              }}
            >
              {selfName} (you)
            </span>
          )}
          <button
            onClick={() => setCameraOn((v) => !v)}
            title={cameraOn ? 'Turn camera off' : 'Turn camera on'}
            style={{
              position: 'absolute',
              right: 12,
              bottom: 12,
              width: 40,
              height: 40,
              borderRadius: '50%',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              background: cameraOn ? 'rgba(255,255,255,0.92)' : RC.red,
              color: cameraOn ? RC.ink : '#fff',
            }}
          >
            {cameraOn ? <Camera size={18} /> : <CameraOff size={18} />}
          </button>
        </div>

        {/* Status */}
        <div
          style={{
            background: RC.panel,
            border: `1px solid ${RC.border}`,
            borderRadius: 20,
            padding: 28,
            boxShadow: '0 6px 18px rgba(20,30,40,0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ position: 'relative', width: 12, height: 12 }}>
              <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: RC.green, animation: 'lobbyPing 1.6s ease-out infinite' }} />
              <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: RC.green }} />
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: RC.greenDark }}>
              Waiting room
            </span>
          </div>

          <h1 style={{ margin: 0, fontSize: 22, lineHeight: 1.3, fontWeight: 700, color: RC.ink }}>
            {title ?? `Waiting for ${who} to join`}
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.55, color: RC.inkMuted }}>
            {message ?? "You'll be connected automatically as soon as they arrive. Please keep this page open."}
          </p>

          <div
            style={{
              marginTop: 18,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              borderRadius: 999,
              background: RC.tile,
              color: RC.ink,
              fontSize: 13,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            Waiting {mm}:{ss}
          </div>

          <ul style={{ margin: '22px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {TIPS.map((tip) => (
              <li key={tip} style={{ display: 'flex', gap: 10, fontSize: 13, lineHeight: 1.5, color: RC.ink }}>
                <span style={{ marginTop: 6, width: 6, height: 6, flexShrink: 0, borderRadius: '50%', background: RC.green }} />
                {tip}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <style>{`
        @keyframes lobbyPing {
          0% { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(2.6); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
