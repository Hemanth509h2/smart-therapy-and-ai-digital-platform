'use client'
import { useLocalParticipant, VideoTrack } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { useState, type CSSProperties } from 'react'
import { useAuthStore } from '@/store/useAuthStore'

export default function LocalVideoPip({ docked = false }: { docked?: boolean }) {
  const { localParticipant, cameraTrack } = useLocalParticipant()
  const { profile } = useAuthStore()
  const [pipHover, setPipHover] = useState(false)
  const userName = profile ? `${profile.firstName} ${profile.lastName}` : 'You'
  const hasVideo = localParticipant && (cameraTrack?.isSubscribed || localParticipant.isCameraEnabled)

  // `docked` renders the self-view as a tile in the top strip (replacing the
  // static "You" thumbnail). Default is the floating overlay over the video.
  const positionStyle: CSSProperties = docked
    ? { position: 'relative', width: 200, height: 120, flexShrink: 0 }
    : { position: 'absolute', bottom: 92, left: 18, width: 224, height: 162, zIndex: 18 }

  return (
    <div
      onMouseEnter={() => setPipHover(true)}
      onMouseLeave={() => setPipHover(false)}
      style={{
        ...positionStyle,
        borderRadius: 14,
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #1a2e28, #142420)',
        border: pipHover ? '2px solid #3fae6a' : '2px solid rgba(255,255,255,0.18)',
        boxShadow: '0 8px 22px rgba(0,0,0,0.28)',
        transition: 'border-color 0.2s, transform 0.2s',
        transform: pipHover ? 'scale(1.03)' : 'scale(1)',
      }}
    >
      {hasVideo ? (
        <VideoTrack
          trackRef={{ participant: localParticipant!, source: Track.Source.Camera, publication: cameraTrack! }}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      ) : (
        <div className="flex items-center justify-center h-full">
          <span style={{ fontSize: 30, color: 'rgba(255,255,255,0.6)' }}>
            {userName?.charAt(0)?.toUpperCase() || 'Y'}
          </span>
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          top: 5,
          left: 7,
          fontSize: 10.5,
          color: 'rgba(255,255,255,0.5)',
          background: 'rgba(0,0,0,0.5)',
          padding: '1px 6px',
          borderRadius: 6,
        }}
      >
        You
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 5,
          left: 7,
          fontSize: 12,
          color: 'rgba(255,255,255,0.6)',
        }}
      >
        {userName}
      </div>
    </div>
  )
}
