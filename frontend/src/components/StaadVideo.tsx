'use client'
import {
  LiveKitRoom,
  RoomAudioRenderer,
} from '@livekit/components-react'
import { apiFetch } from '@/lib/api';
import '@livekit/components-styles'
import { Room } from 'livekit-client'
import { useEffect, useState, useMemo, useCallback, createContext, useContext } from 'react'

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

  const room = useMemo(() => new Room(), [])
  const [connected, setConnected] = useState(false)

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
