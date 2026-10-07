'use client'

// Live "what am I actually receiving" readout for a remote video, read from
// WebRTC stats every 2s: resolution · fps · bitrate. Shown on hover so it's out
// of the way, and it answers "why is the video blurry?" at a glance:
//   - low resolution + amber/red quality bars  -> network (LiveKit lowered the layer)
//   - low resolution + green bars             -> the sender's camera is low-res
//   - 1280x720 but still soft                 -> lighting / camera optics
import type { RemoteVideoTrack, Track } from 'livekit-client'
import { useEffect, useRef, useState, type CSSProperties } from 'react'

interface Stats {
  w: number
  h: number
  fps: number
  kbps: number
}

export default function VideoStatsBadge({ track, style }: { track?: Track; style?: CSSProperties }) {
  const [stats, setStats] = useState<Stats | null>(null)
  const prev = useRef<{ bytes: number; t: number } | null>(null)
  const warned = useRef(false)

  useEffect(() => {
    if (!track) return
    let stopped = false
    const poll = async () => {
      try {
        const report = await (track as RemoteVideoTrack).getRTCStatsReport()
        if (!report || stopped) return
        report.forEach((s) => {
          if (s.type !== 'inbound-rtp' || s.kind !== 'video') return
          const now = s.timestamp as number
          const bytes = (s.bytesReceived as number) ?? 0
          const p = prev.current
          const kbps = p && now > p.t ? ((bytes - p.bytes) * 8) / (now - p.t) : 0
          prev.current = { bytes, t: now }
          const next = {
            w: (s.frameWidth as number) ?? 0,
            h: (s.frameHeight as number) ?? 0,
            fps: Math.round((s.framesPerSecond as number) ?? 0),
            kbps: Math.max(0, Math.round(kbps)),
          }
          setStats(next)
          if (!warned.current && next.h > 0 && next.h < 540) {
            warned.current = true
            console.info(
              `[video] receiving only ${next.w}x${next.h} @ ${next.fps}fps (${next.kbps} kbps): ` +
                'sender camera is low-res or the network forced a lower layer'
            )
          }
        })
      } catch {
        /* stats are best-effort */
      }
    }
    poll()
    const id = setInterval(poll, 2000)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [track])

  if (!stats || !stats.h) return null
  const mbps = stats.kbps >= 1000 ? `${(stats.kbps / 1000).toFixed(1)} Mbps` : `${stats.kbps} kbps`
  return (
    <div
      style={{
        padding: '3px 8px',
        borderRadius: 6,
        background: 'rgba(0,0,0,0.55)',
        color: '#fff',
        fontSize: 11.5,
        fontFamily: 'monospace',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {stats.w}×{stats.h} · {stats.fps}fps · {mbps}
    </div>
  )
}
