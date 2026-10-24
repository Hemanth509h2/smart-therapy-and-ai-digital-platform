'use client'
import {
  LiveKitRoom,
  RoomAudioRenderer,
} from '@livekit/components-react'
import { apiFetch } from '@/lib/api';
import { toast } from '@/components/practice/ui';
import '@livekit/components-styles'
import { Room, RoomEvent, Track, VideoPresets, type LocalTrackPublication, type RoomOptions } from 'livekit-client'
import { useEffect, useRef, useState, useMemo, useCallback, createContext, useContext } from 'react'

// Video quality policy (see Smart_Therapy_Video_Quality_Report):
//  - Capture and publish at most 720p / 30fps. A 1080p camera is capped to 720p;
//    a 480p camera sends what it has (we never upscale).
//  - Simulcast publishes 720p + 360p + 180p layers so each viewer can get the
//    one that fits their network and tile size.
//  - adaptiveStream: each viewer only downloads the layer matching how big the
//    video is on screen (the small participants popup no longer pulls full 720p),
//    and pauses video that isn't visible.
//  - dynacast: the sender stops encoding layers nobody is watching, saving CPU
//    and upload bandwidth on the patient's device.
// These are written out explicitly so a livekit-client upgrade can't silently
// change them.
const ROOM_OPTIONS: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
  videoCaptureDefaults: {
    resolution: VideoPresets.h720.resolution, // 1280x720 @ 30fps (ideal, browser may give less)
  },
  publishDefaults: {
    simulcast: true,
    // 720p top layer at 2.5 Mbps (LiveKit's preset is 1.7 Mbps). Webcams in
    // indoor/low light produce noisy frames that eat bitrate; the extra headroom
    // keeps faces sharp on the doctor's large screen. Simulcast + adaptiveStream
    // still drop to the 360p/180p layers when a network can't carry it.
    videoEncoding: { maxBitrate: 2_500_000, maxFramerate: 30 },
    videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
    // When bandwidth/CPU is short, lower the frame rate before the resolution:
    // in therapy a clear face matters more than perfectly smooth motion.
    degradationPreference: 'maintain-resolution',
  },
}

// Logs what the camera can do vs. what was actually captured, so a blurry
// video can be traced to the device (e.g. a 480p webcam) rather than the network.
function logCameraCapture(pub: LocalTrackPublication) {
  if (pub.source !== Track.Source.Camera) return
  const mst = pub.track?.mediaStreamTrack
  if (!mst) return
  const s = mst.getSettings()
  const caps = typeof mst.getCapabilities === 'function' ? mst.getCapabilities() : undefined
  const maxW = caps?.width && 'max' in caps.width ? caps.width.max : undefined
  const maxH = caps?.height && 'max' in caps.height ? caps.height.max : undefined
  console.info(
    `[video] camera capture ${s.width}x${s.height} @ ${Math.round(s.frameRate ?? 0)}fps` +
      (maxW && maxH ? ` (camera max ${maxW}x${maxH})` : '') +
      ((s.height ?? 0) < 720 ? ' — below 720p: device/browser limit, not upscaled' : '')
  )
}

interface StaadVideoProps {
  sessionId: string
  userName: string
  role: 'therapist' | 'client'
  /** Language this participant SPEAKS — selects the STT model for their audio. */
  sourceLang?: string
  /** Language this participant READS — the language their captions arrive in. */
  targetLang?: string
  /** Shown to a client while the therapist hasn't joined yet. */
  waitingScreen?: React.ReactNode
  children: React.ReactNode
}

interface RoomContextValue {
  disconnect: () => void
  room: Room | null
}

const RoomCtx = createContext<RoomContextValue>({ disconnect: () => {}, room: null })

export const useSessionRoom = () => useContext(RoomCtx)

export default function StaadVideo({
  sessionId,
  userName,
  role,
  sourceLang,
  targetLang,
  waitingScreen,
  children,
}: StaadVideoProps) {
  const [token, setToken] = useState<string>('')
  const [error, setError] = useState('')
  // Client only: the backend withholds the token until the therapist is in the room.
  const [waiting, setWaiting] = useState(false)

  const room = useMemo(() => new Room(ROOM_OPTIONS), [])
  const [connected, setConnected] = useState(false)

  // Verify the actual capture each time the camera is (re)published.
  useEffect(() => {
    room.on(RoomEvent.LocalTrackPublished, logCameraCapture)
    return () => {
      room.off(RoomEvent.LocalTrackPublished, logCameraCapture)
    }
  }, [room])

  // Languages are signed into the token as participant attributes, which is
  // how the translation agent learns who speaks and reads what. They are read
  // from a ref at fetch time and are NOT effect dependencies: a new token
  // remounts the whole call. Changes mid-call are pushed to the room by the
  // backend instead (POST /api/sessions/[id]/translation).
  const langs = useRef({ sourceLang, targetLang })
  langs.current = { sourceLang, targetLang }

  useEffect(() => {
    if (!sessionId || !userName) return

    let cancelled = false
    let done = false
    let polling = false
    let isWaiting = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const schedule = (ms: number) => {
      clearTimeout(retry)
      retry = setTimeout(fetchToken, ms)
    }
    const fetchToken = () => {
      // One request at a time; a tab-visible wake-up may land mid-request.
      if (cancelled || done || polling) return
      polling = true
      clearTimeout(retry)
      const params = new URLSearchParams({ room: sessionId, name: userName, role })
      if (langs.current.sourceLang) params.set('sourceLang', langs.current.sourceLang)
      if (langs.current.targetLang) params.set('targetLang', langs.current.targetLang)
      // A request that never settles (auth token refresh or the LiveKit lookup
      // hanging on a slow network) would otherwise end the polling for good and
      // strand the client in the waiting room.
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 10_000))
      Promise.race([apiFetch(`/api/livekit-token?${params.toString()}`).then(r => r.json()), timeout])
        .then(d => {
          if (cancelled) return
          if (d.waiting) {
            // Therapist hasn't joined yet — ask again shortly.
            isWaiting = true
            setWaiting(true)
            schedule(3000)
          } else if (d.token) {
            done = true
            setWaiting(false)
            setToken(d.token)
          } else setError('Could not connect to the video call.')
        })
        .catch(() => {
          if (cancelled) return
          // While waiting, a failed poll is just retried.
          if (isWaiting) schedule(3000)
          else setError('Video connection failed. Check your connection and rejoin.')
        })
        .finally(() => { polling = false })
    }
    // Browsers throttle timers in background tabs (down to once a minute), so
    // check right away when the client comes back to the tab.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && isWaiting) fetchToken()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    fetchToken()
    return () => {
      cancelled = true
      clearTimeout(retry)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [sessionId, userName, role])

  const disconnect = useCallback(() => {
    room.disconnect()
  }, [room])

  useEffect(() => {
    if (error) toast(error, 'error')
  }, [error])

  const handleConnected = useCallback(() => setConnected(true), [])
  const handleDisconnected = useCallback(() => setConnected(false), [])

  if (error) return (
    <div className="h-full flex items-center justify-center" style={{ color: 'var(--ink-muted)', fontSize: 13 }}>
      Video unavailable
    </div>
  )

  if (!token && waiting && waitingScreen) return <>{waitingScreen}</>

  if (!token && waiting) return (
    <div className="h-full flex flex-col items-center justify-center gap-2" style={{ color: 'var(--ink-muted)', fontSize: 13 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Waiting for your therapist to join…</div>
      <div>You'll be connected automatically as soon as they arrive.</div>
    </div>
  )

  if (!token) return (
    <div className="h-full flex items-center justify-center" style={{ color: 'var(--ink-muted)', fontSize: 13 }}>
      Connecting video...
    </div>
  )

  return (
    <RoomCtx.Provider value={{ disconnect, room }}>
      <LiveKitRoom
        key={token}
        room={room}
        serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL}
        token={token}
        connect={true}
        video={true}
        audio={true}
        onConnected={handleConnected}
        onDisconnected={handleDisconnected}
        style={{ width: '100%', height: '100%' }}
      >
        <RoomAudioRenderer />
        {children}
      </LiveKitRoom>
    </RoomCtx.Provider>
  )
}
