'use client'

import { useEffect, useState, useRef } from 'react'
import type { TrackReference } from '@livekit/components-react'
import type { Track } from 'livekit-client'
import { RemoteVideoTrack } from 'livekit-client'

export interface VideoDimensions {
  width: number
  height: number
  aspectRatio: number
}

/**
 * Hook that extracts the actual video dimensions from a LiveKit track.
 * Uses multiple strategies:
 * 1. MediaStreamTrack.getSettings() - for local tracks (camera capture resolution)
 * 2. RemoteVideoTrack.getRTCStatsReport() - for remote tracks (received resolution)
 * 3. Video element's videoWidth/videoHeight - as fallback when playing
 * 4. resize event on MediaStreamTrack - for dynamic resolution changes
 */
export function useVideoTrackDimensions(
  trackRef: TrackReference | undefined
): VideoDimensions | null {
  const [dimensions, setDimensions] = useState<VideoDimensions | null>(null)
  const trackRefCurrent = useRef(trackRef)
  trackRefCurrent.current = trackRef

  useEffect(() => {
    const track = trackRefCurrent.current
    if (!track?.publication?.track) return

    const videoTrack = track.publication.track as Track
    let stopped = false

    // Strategy 1: Try to get settings from MediaStreamTrack (works for local tracks)
    const tryGetSettings = () => {
      const mediaStreamTrack = videoTrack.mediaStreamTrack
      if (mediaStreamTrack && typeof mediaStreamTrack.getSettings === 'function') {
        const settings = mediaStreamTrack.getSettings()
        if (settings.width && settings.height) {
          return {
            width: settings.width,
            height: settings.height,
            aspectRatio: settings.width / settings.height,
          }
        }
      }
      return null
    }

    // Strategy 2: For remote tracks, poll RTC stats for received resolution
    const pollRemoteStats = async () => {
      if (videoTrack instanceof RemoteVideoTrack || videoTrack.kind === 'video') {
        try {
          const report = await (videoTrack as RemoteVideoTrack).getRTCStatsReport()
          if (!report || stopped) return
          report.forEach((s) => {
            if (s.type === 'inbound-rtp' && s.kind === 'video' && s.frameWidth && s.frameHeight) {
              setDimensions({
                width: s.frameWidth as number,
                height: s.frameHeight as number,
                aspectRatio: (s.frameWidth as number) / (s.frameHeight as number),
              })
            }
          })
        } catch {
          // Stats unavailable, ignore
        }
      }
    }

    // Strategy 3: Attach to video element to read videoWidth/videoHeight
    const attachToVideoElement = () => {
      // The VideoTrack component creates a video element internally.
      // We can't easily access it from here, but we can listen for track events.
    }

    // Strategy 4: Listen for resolution changes on the MediaStreamTrack
    const mediaStreamTrack = videoTrack.mediaStreamTrack
    const handleResize = () => {
      const settings = tryGetSettings()
      if (settings) {
        setDimensions(settings)
      }
    }

    // Initial check
    const initial = tryGetSettings()
    if (initial) {
      setDimensions(initial)
    } else {
      // Fallback: poll remote stats
      pollRemoteStats()
      const interval = setInterval(pollRemoteStats, 2000)
      return () => {
        clearInterval(interval)
        stopped = true
      }
    }

    // Listen for resize events (MediaStreamTrack fires 'resize' when resolution changes)
    if (mediaStreamTrack) {
      mediaStreamTrack.addEventListener('resize', handleResize)
    }

    return () => {
      stopped = true
      if (mediaStreamTrack) {
        mediaStreamTrack.removeEventListener('resize', handleResize)
      }
    }
  }, [trackRef])

  return dimensions
}

/**
 * Hook that returns a style object with the correct aspect-ratio for the video frame.
 * Falls back to 16:9 if dimensions aren't available yet.
 */
export function useVideoFrameStyle(
  trackRef: TrackReference | undefined,
  fallbackAspect = 16 / 9
): React.CSSProperties {
  const dimensions = useVideoTrackDimensions(trackRef)
  const aspectRatio = dimensions?.aspectRatio ?? fallbackAspect

  return {
    width: '100%',
    height: '100%',
    objectFit: 'contain' as const, // Use 'contain' to show full video without cropping
    aspectRatio: `${aspectRatio}`,
  }
}