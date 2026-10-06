'use client'

import { useState, type ReactNode } from 'react'
import { useTracks, useLocalParticipant, VideoTrack } from '@livekit/components-react'
import type { TrackReference } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { Mic, MicOff, Camera, CameraOff, PhoneOff, X } from 'lucide-react'

// Full-canvas layout used ONLY by Skill Development modules. The normal session
// room layout (used by every other module) is untouched — the session page picks
// between the two based on the active module's category.
//
// Note: LiveKit tracks are read from the room context via useTracks() rather than
// passed in as props — that is how RemoteVideoArea/LocalVideoPip already work, and
// this component always renders inside <StaadVideo>'s provider.
interface SkillDevLayoutProps {
  sessionId: string
  userRole: 'therapist' | 'client'
  selfName: string
  otherName: string
  onExit: () => void
  onEndCall: () => void
  children: ReactNode
}

function VideoPill({
  trackRef,
  name,
  align,
  onExpand,
}: {
  trackRef: TrackReference | undefined
  name: string
  align: 'left' | 'right'
  onExpand: () => void
}) {
  const [hover, setHover] = useState(false)

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'absolute',
        top: 16,
        [align]: 16,
        zIndex: 40,
        transform: hover ? 'scale(1.06)' : 'scale(1)',
        transition: 'transform 0.18s ease',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: 96,
          height: 72,
          borderRadius: 12,
          overflow: 'hidden',
          border: '2px solid rgba(255,255,255,0.85)',
          boxShadow: '0 6px 20px rgba(0,0,0,0.3)',
          background: '#1a2a25',
        }}
      >
        {trackRef ? (
          <VideoTrack trackRef={trackRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.75)', fontSize: 20, fontWeight: 700 }}>
            {name?.charAt(0)?.toUpperCase() || '?'}
          </div>
        )}

        {/* Online dot */}
        <span
          style={{
            position: 'absolute', top: 5, right: 5, width: 7, height: 7, borderRadius: '50%',
            background: '#4caf86', border: '1.5px solid #fff',
          }}
        />

        {/* Expand affordance */}
        {hover && (
          <button
            onClick={onExpand}
            title="Expand"
            style={{
              position: 'absolute', top: 4, left: 4, width: 18, height: 18, borderRadius: 5,
              border: 'none', cursor: 'pointer', background: 'rgba(0,0,0,0.55)', color: '#fff',
              fontSize: 10, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ⤢
          </button>
        )}
      </div>
      <div
        style={{
          marginTop: 3, textAlign: 'center', fontSize: 8, fontWeight: 700, color: '#fff',
          textShadow: '0 1px 3px rgba(0,0,0,0.8)',
        }}
      >
        {name}
      </div>
    </div>
  )
}

export default function SkillDevLayout({
  userRole,
  selfName,
  otherName,
  onExit,
  onEndCall,
  children,
}: SkillDevLayoutProps) {
  const [expanded, setExpanded] = useState<null | 'self' | 'other'>(null)
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant()

  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: false }], { onlySubscribed: false })
  const selfTrack = tracks.find((t) => t.participant.isLocal) as TrackReference | undefined
  const otherTrack = tracks.find((t) => !t.participant.isLocal && t.publication?.isSubscribed) as TrackReference | undefined

  // Therapist always sits top-left, client top-right — regardless of who is viewing.
  const selfIsTherapist = userRole === 'therapist'
  const selfAlign: 'left' | 'right' = selfIsTherapist ? 'left' : 'right'
  const otherAlign: 'left' | 'right' = selfIsTherapist ? 'right' : 'left'

  const ctrl = (danger = false): React.CSSProperties => ({
    width: 42, height: 42, borderRadius: '50%', border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: danger ? '#ff5a5f' : 'rgba(255,255,255,0.12)',
    color: '#fff', transition: 'all 0.15s',
  })

  const expandedTrack = expanded === 'self' ? selfTrack : otherTrack
  const expandedName = expanded === 'self' ? selfName : otherName

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', background: '#101b18', display: 'flex', flexDirection: 'column' }}>
      {/* Video PiPs */}
      <VideoPill trackRef={selfTrack} name={selfName} align={selfAlign} onExpand={() => setExpanded('self')} />
      <VideoPill trackRef={otherTrack} name={otherName} align={otherAlign} onExpand={() => setExpanded('other')} />

      {/* Exit activity — therapist only: closing a module is a therapist action,
          so showing this to the client would be a button that does nothing. */}
      {selfIsTherapist && (
        <button
          onClick={onExit}
          style={{
            position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 45,
            padding: '6px 14px', borderRadius: 999, cursor: 'pointer', fontSize: 11, fontWeight: 700,
            background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.22)', color: '#fff',
            backdropFilter: 'blur(8px)',
          }}
        >
          ← Exit activity
        </button>
      )}

      {/* Module canvas */}
      <div style={{ position: 'absolute', inset: 0, paddingTop: 96, paddingBottom: 64, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
          {children}
        </div>
      </div>

      {/* Minimal bottom bar */}
      <div
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 64, zIndex: 45,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
        }}
      >
        <button
          onClick={() => localParticipant?.setMicrophoneEnabled(!isMicrophoneEnabled)}
          title={isMicrophoneEnabled ? 'Mute' : 'Unmute'}
          style={ctrl()}
        >
          {isMicrophoneEnabled ? <Mic size={18} /> : <MicOff size={18} />}
        </button>
        <button
          onClick={() => localParticipant?.setCameraEnabled(!isCameraEnabled)}
          title={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
          style={ctrl()}
        >
          {isCameraEnabled ? <Camera size={18} /> : <CameraOff size={18} />}
        </button>
        <button onClick={onEndCall} title="End call" style={ctrl(true)}>
          <PhoneOff size={18} />
        </button>
      </div>

      {/* Expanded video modal */}
      {expanded && (
        <div
          onClick={() => setExpanded(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.75)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', width: 'min(80vw, 900px)', aspectRatio: '4 / 3', borderRadius: 16, overflow: 'hidden', background: '#1a2a25', border: '2px solid rgba(255,255,255,0.85)' }}>
            {expandedTrack ? (
              <VideoTrack trackRef={expandedTrack} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.7)', fontSize: 48, fontWeight: 700 }}>
                {expandedName?.charAt(0)?.toUpperCase() || '?'}
              </div>
            )}
            <button
              onClick={() => setExpanded(null)}
              style={{
                position: 'absolute', top: 10, right: 10, width: 30, height: 30, borderRadius: 8,
                border: 'none', cursor: 'pointer', background: 'rgba(0,0,0,0.6)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <X size={16} />
            </button>
            <div style={{ position: 'absolute', bottom: 10, left: 12, fontSize: 12, fontWeight: 700, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
              {expandedName}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
