'use client'

// "Before you join": the participant decides whether STAAD may use their
// camera and microphone for this session BEFORE anything touches a device.
// Nothing in the session flow calls getUserMedia or publishes a LiveKit track
// until a choice exists here:
//   - <StaadVideo> shows this screen instead of connecting the room, then
//     connects with exactly the devices chosen (video/audio props).
//   - <GuestAdmissionGate> shows it before the waiting room.
//   - <WaitingLobby> only starts its camera preview if the camera was chosen
//     (or the person presses the preview button themselves).
// The browser's own permission prompt therefore appears only after a click.
// The choice is remembered for this session in this tab only (sessionStorage),
// so a reload doesn't ask again; devices can be turned on or off later from
// the call controls either way.

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { Camera, Mic, VideoOff } from 'lucide-react'

export interface DeviceChoice {
  camera: boolean
  mic: boolean
}

interface DeviceConsentValue {
  choice: DeviceChoice | null
  choose: (choice: DeviceChoice) => void
}

const Ctx = createContext<DeviceConsentValue>({ choice: null, choose: () => {} })

const storageKey = (sessionId: string) => `staad.devices.${sessionId}`

function readStored(sessionId: string): DeviceChoice | null {
  try {
    const raw = sessionStorage.getItem(storageKey(sessionId))
    if (!raw) return null
    const v = JSON.parse(raw)
    if (typeof v?.camera === 'boolean' && typeof v?.mic === 'boolean') return { camera: v.camera, mic: v.mic }
  } catch {
    // Storage blocked or corrupt: ask again.
  }
  return null
}

export function DeviceConsentProvider({ sessionId, children }: { sessionId: string; children: React.ReactNode }) {
  const [choice, setChoice] = useState<DeviceChoice | null>(() =>
    typeof window === 'undefined' ? null : readStored(sessionId))

  const choose = useCallback(
    (next: DeviceChoice) => {
      setChoice(next)
      try {
        sessionStorage.setItem(storageKey(sessionId), JSON.stringify(next))
      } catch {
        // Not remembered across reloads; the call still works.
      }
    },
    [sessionId]
  )

  const value = useMemo(() => ({ choice, choose }), [choice, choose])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** The participant's device choice for this session, or null before they choose. */
export function useDeviceChoice() {
  return useContext(Ctx)
}

const OPTIONS: { label: string; hint: string; choice: DeviceChoice; icon: React.ReactNode }[] = [
  {
    label: 'Join with camera and microphone',
    hint: 'They can see and hear you.',
    choice: { camera: true, mic: true },
    icon: <Camera size={18} aria-hidden />,
  },
  {
    label: 'Join with microphone only',
    hint: 'They can hear you but not see you.',
    choice: { camera: false, mic: true },
    icon: <Mic size={18} aria-hidden />,
  },
  {
    label: 'Join without camera or microphone',
    hint: 'You can still see and hear them.',
    choice: { camera: false, mic: false },
    icon: <VideoOff size={18} aria-hidden />,
  },
]

export function DeviceConsentScreen({ peerName }: { peerName?: string }) {
  const { choose } = useDeviceChoice()
  const who = peerName && peerName !== 'Therapist' && peerName !== 'Participant' ? peerName : 'the other participant'

  return (
    <main
      className="staad-ui"
      style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}
    >
      <section
        className="card"
        aria-labelledby="device-consent-title"
        style={{ transform: 'none', width: '100%', maxWidth: 520, padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <span className="eyebrow">Before you join</span>
        <h1
          id="device-consent-title"
          style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 24, lineHeight: 1.25, fontWeight: 500, color: 'var(--ink)' }}
        >
          Camera and microphone
        </h1>
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: 'var(--ink)' }}>
          STAAD will use your camera and microphone for this live session with {who}. Video and audio go to the
          other participant live and are not recorded. Your browser will ask for permission after you choose.
        </p>

        <div role="group" aria-label="How do you want to join?" style={{ display: 'grid', gap: 10 }}>
          {OPTIONS.map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => choose(o.choice)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                padding: '12px 14px',
                borderRadius: 14,
                border: '1px solid var(--line)',
                background: 'var(--surface-2)',
                color: 'var(--ink)',
                textAlign: 'left',
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              <span style={{ display: 'flex', flex: 'none' }}>{o.icon}</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: 14.5 }}>{o.label}</span>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>{o.hint}</span>
              </span>
            </button>
          ))}
        </div>

        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>
          You can turn your camera and microphone on or off at any time from the call controls. AI features such as
          captions are a separate choice, asked in the call.{' '}
          <a href="/privacy" target="_blank" rel="noopener" style={{ color: 'var(--ink)', textDecoration: 'underline' }}>
            Privacy Policy
          </a>
        </p>
      </section>
    </main>
  )
}
