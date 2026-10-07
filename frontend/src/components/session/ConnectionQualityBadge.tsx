'use client'

// Small Good / Fair / Poor dot for a participant's network, using LiveKit's own
// connection-quality score. Lets the therapist see that a blurry or frozen feed
// is the network (LiveKit lowering quality to keep the call stable), not the app.
import { useConnectionQualityIndicator } from '@livekit/components-react'
import { ConnectionQuality, type Participant } from 'livekit-client'
import type { CSSProperties } from 'react'

const LOOK: Record<ConnectionQuality, { color: string; label: string; bars: number }> = {
  [ConnectionQuality.Excellent]: { color: '#3fae6a', label: 'Excellent connection', bars: 3 },
  [ConnectionQuality.Good]: { color: '#3fae6a', label: 'Good connection', bars: 2 },
  [ConnectionQuality.Poor]: { color: '#e0a526', label: 'Poor connection: video quality may drop', bars: 1 },
  [ConnectionQuality.Lost]: { color: '#e05252', label: 'Connection lost: reconnecting…', bars: 0 },
  [ConnectionQuality.Unknown]: { color: '#9aa0a6', label: 'Checking connection…', bars: 0 },
}

export default function ConnectionQualityBadge({
  participant,
  style,
}: {
  participant?: Participant
  style?: CSSProperties
}) {
  const { quality } = useConnectionQualityIndicator(participant ? { participant } : undefined)
  const look = LOOK[quality] ?? LOOK[ConnectionQuality.Unknown]

  return (
    <div
      title={look.label}
      aria-label={look.label}
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 2,
        padding: '3px 5px',
        borderRadius: 6,
        background: 'rgba(0,0,0,0.45)',
        ...style,
      }}
    >
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          style={{
            width: 3,
            height: 3 + i * 3,
            borderRadius: 1,
            background:
              i <= look.bars
                ? look.color
                : quality === ConnectionQuality.Lost
                  ? 'rgba(224,82,82,0.7)'
                  : 'rgba(255,255,255,0.3)',
          }}
        />
      ))}
    </div>
  )
}
