'use client'
import { useLocalParticipant, VideoTrack } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { useState, type CSSProperties, useMemo } from 'react'
import { useAuthStore } from '@/store/useAuthStore'
import ConnectionQualityBadge from '@/components/session/ConnectionQualityBadge'
import { viewportFrameCss, TILE_ASPECT, aspectRatioCss } from '@/lib/video-frame'

export default function LocalVideoPip({
  docked = false,
  width = 200,
  height = 120,
}: {
  docked?: boolean
  /** Docked tile size (the participants popup is resizable). */
  width?: number
  height?: number
}) {
  const { localParticipant, cameraTrack } = useLocalParticipant()
  const { profile } = useAuthStore()
  const [pipHover, setPipHover] = useState(false)
  const userName = profile ? `${profile.firstName} ${profile.lastName}` : 'You'
  const hasVideo = localParticipant && (cameraTrack?.isSubscribed || localParticipant.isCameraEnabled)

  // Responsive Design + Viewport-based sizing:
  // - docked (popup tiles): use viewportFrameCss with TILE_ASPECT (5:3)
  // - floating (PiP): responsive max-w, aspect-ratio preserved via CSS
  const pipStyle = useMemo(() => {
    if (docked) {
      // Popup tile: width scales with viewport, capped at design width; height follows 5:3
      return viewportFrameCss({
        maxWidth: width,
        aspect: TILE_ASPECT,
        gutter: '2rem',
        minHeight: 100,
      })
    }
    // Floating PiP over main video: responsive but capped
    return {
      position: 'absolute' as const,
      bottom: 92,
      left: 18,
      zIndex: 18,
      width: `min(${width}px, 30vw)`,
      aspectRatio: aspectRatioCss(width, height),
      maxWidth: '100%',
    }
  }, [docked, width, height])

  return (
    <div
      onMouseEnter={() => setPipHover(true)}
      onMouseLeave={() => setPipHover(false)}
      style={{
        ...pipStyle,
        borderRadius: 14,
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #1a2e28, #142420)',
        border: pipHover ? '2px solid #3fae6a' : '2px solid rgba(255,255,255,0.18)',
        boxShadow: '0 8px 22px rgba(0,0,0,0.28)',
        transition: 'border-color 0.2s, transform 0.2s',
        transform: pipHover ? 'scale(1.03)' : 'scale(1)',
        flexShrink: 0,
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
      {localParticipant && (
        <ConnectionQualityBadge participant={localParticipant} style={{ position: 'absolute', top: 5, right: 7 }} />
      )}
    </div>
  )
}
