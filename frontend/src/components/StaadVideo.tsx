'use client'
import {
  LiveKitRoom,
  RoomAudioRenderer,
} from '@livekit/components-react'
import { apiFetch } from '@/lib/api';
import '@livekit/components-styles'
import { Room, RoomEvent, Track, VideoPresets, type LocalTrackPublication, type RoomOptions } from 'livekit-client'
import { useEffect, useState, useMemo, useCallback, createContext, useContext } from 'react'

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
    videoEncoding: VideoPresets.h720.encoding,
    videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
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
  children,
}: StaadVideoProps) {
  const [token, setToken] = useState<string>('')
  const [error, setError] = useState('')

  const room = useMemo(() => new Room(ROOM_OPTIONS), [])
  const [connected, setConnected] = useState(false)

  // Verify the actual capture each time the camera is (re)published.
  useEffect(() => {
    room.on(RoomEvent.LocalTrackPublished, logCameraCapture)
    return () => {
      room.off(RoomEvent.LocalTrackPublished, logCameraCapture)
    }
  }, [room])

  useEffect(() => {
    if (!sessionId || !userName) return
    // Languages are signed into the token as participant attributes, which is
    // how the translation agent learns who speaks and reads what. Changing them
    // mid-session therefore requires a reconnect — the effect re-runs and a
    // fresh token is minted.
    const params = new URLSearchParams({ room: sessionId, name: userName, role })
    if (sourceLang) params.set('sourceLang', sourceLang)
    if (targetLang) params.set('targetLang', targetLang)

    apiFetch(`/api/livekit-token?${params.toString()}`)
      .then(r => r.json())
      .then(d => {
        if (d.token) setToken(d.token)
        else setError('Could not get video token')
      })
      .catch(() => setError('Video connection failed'))
  }, [sessionId, userName, role, sourceLang, targetLang])

  const disconnect = useCallback(() => {
    room.disconnect()
  }, [room])

  const handleConnected = useCallback(() => setConnected(true), [])
  const handleDisconnected = useCallback(() => setConnected(false), [])

  if (error) return (
    <div className="h-full flex items-center justify-center" style={{ color: 'var(--ink-muted)', fontSize: 13 }}>
      {error}
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
