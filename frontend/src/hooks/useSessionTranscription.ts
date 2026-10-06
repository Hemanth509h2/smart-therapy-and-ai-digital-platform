'use client'
import { useEffect, useRef, useCallback, useState } from 'react'
import { Track, RoomEvent, RemoteParticipant, RemoteTrack } from 'livekit-client'
import { doc, updateDoc, arrayUnion, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useSessionRoom } from '@/components/StaadVideo'
import type { TranscriptChunk } from '@/lib/rag/types'
import { apiFetch } from '@/lib/api';

const TRANSCRIPTION_TOPIC = 'lk.transcription'

interface UseSessionTranscriptionOptions {
  sessionId: string
  enabled: boolean
  userRole: 'therapist' | 'client'
}

interface TranscriptionState {
  isRecording: boolean
  error: string | null
  chunkCount: number
}

// One independent Sarvam pipeline per participant audio track. Because each
// track belongs to a known participant, we tag the speaker directly instead of
// relying on probabilistic diarization.
interface Pipe {
  ws: WebSocket
  ctx: AudioContext
  source: MediaStreamAudioSourceNode
  processor: ScriptProcessorNode
}

const STT_RELAY_URL = process.env.NEXT_PUBLIC_STT_RELAY_URL

// With NEXT_PUBLIC_STT_RELAY_URL set we connect to the external relay (Fly.io)
// using a signed token. Without it we fall back to the same-origin proxy in
// server.js (local dev / self-hosted Node).
function buildProxyUrl(sessionId: string, speaker: string, token: string): string {
  const url = STT_RELAY_URL
    ? new URL('/sarvam-stream', STT_RELAY_URL)
    : new URL('/api/sarvam-stream', window.location.origin)
  // Ensure wss:// or ws://
  url.protocol = url.protocol.replace('http', 'ws')
  
  url.searchParams.set('model', 'saaras:v3')
  url.searchParams.set('mode', 'translate')
  url.searchParams.set('high_vad_sensitivity', 'true')
  url.searchParams.set('vad_signals', 'true')
  url.searchParams.set('sid', sessionId)
  url.searchParams.set('speaker', speaker)
  if (token) url.searchParams.set('token', token)
  
  return url.toString()
}

// Sarvam streaming audio chunks are base64-encoded PCM (s16le) wrapped in JSON.
function pcmToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer)
  let binary = ''
  const block = 0x8000
  for (let i = 0; i < bytes.length; i += block) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + block) as unknown as number[]
    )
  }
  return btoa(binary)
}

function captionAttributes(
  speaker: TranscriptChunk['speaker'],
  original: string,
): Record<string, string> {
  return {
    'lk.segment_id': `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    'lk.transcription_final': 'true',
    'staad.kind': 'translation',
    'staad.speaker_identity': speaker,
    'staad.source_language': speaker,
    'staad.target_language': 'en',
    'staad.original_text': original,
    'staad.source': 'sarvam-browser',
  }
}

export function useSessionTranscription({
  sessionId,
  enabled,
  userRole,
}: UseSessionTranscriptionOptions) {
  const { room } = useSessionRoom()
  const pipesRef = useRef<Map<string, Pipe>>(new Map())
  const startTimeRef = useRef<number>(0)
  const startedRef = useRef(false)
  const [state, setState] = useState<TranscriptionState>({
    isRecording: false,
    error: null,
    chunkCount: 0,
  })
  const shouldRun = enabled && userRole === 'therapist'

  const writeChunk = useCallback(
    async (text: string, speaker: TranscriptChunk['speaker']) => {
      const clean = text.trim()
      if (!clean) return
      const chunk: TranscriptChunk = {
        text: clean,
        speaker,
        timestamp: Date.now(),
        sessionMinute: Math.floor((Date.now() - startTimeRef.current) / 60000),
        isFinal: true,
      }
      try {
        await updateDoc(doc(db, 'sessions', sessionId), {
          transcript: arrayUnion({
            text: chunk.text,
            speaker: chunk.speaker,
            timestamp: chunk.timestamp,
            sessionMinute: chunk.sessionMinute,
          }),
          transcriptLastUpdated: serverTimestamp(),
        })
        setState((s) => ({ ...s, chunkCount: s.chunkCount + 1 }))
      } catch (e) {
        console.warn('[Transcription] Firestore write failed:', e)
      }
    },
    [sessionId]
  )

  const publishCaption = useCallback(
    async (text: string, speaker: TranscriptChunk['speaker']) => {
      const clean = text.trim()
      if (!clean || !room) return

      const attributes = captionAttributes(speaker, clean)

      // Text streams are not looped back to the sender in every LiveKit client
      // path, so update this browser directly and also publish for the peer.
      window.dispatchEvent(
        new CustomEvent('staad:caption', {
          detail: { text: clean, attributes },
        })
      )

      try {
        await room.localParticipant.sendText(clean, {
          topic: TRANSCRIPTION_TOPIC,
          attributes,
        })
      } catch (e) {
        console.warn('[Transcription] Caption publish failed:', e)
      }
    },
    [room]
  )

  const stopPipe = useCallback((key: string) => {
    const pipe = pipesRef.current.get(key)
    if (!pipe) return
    try { pipe.processor.disconnect() } catch {}
    try { pipe.source.disconnect() } catch {}
    try { pipe.ctx.close() } catch {}
    try { pipe.ws.close() } catch {}
    pipesRef.current.delete(key)
  }, [])

  // Open a Sarvam socket + audio graph for one participant track.
  const startPipe = useCallback(
    async (key: string, track: MediaStreamTrack, speaker: TranscriptChunk['speaker']) => {
      if (pipesRef.current.has(key)) return

      let token = ''
      if (STT_RELAY_URL) try {
        const { auth } = await import('@/lib/firebase')
        const idToken = await auth.currentUser?.getIdToken()
        const res = await apiFetch(`/api/stt-token?sessionId=${sessionId}`, {
          headers: { Authorization: `Bearer ${idToken}` }
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to get STT token')
        token = data.token
      } catch (err) {
        console.error('[Transcription] Failed to get token:', err)
        setState((s) => ({ ...s, error: 'Transcription auth error' }))
        return
      }

      // Connect to our proxy (translate mode → English out, multilingual in).
      const ws = new WebSocket(buildProxyUrl(sessionId, speaker, token))

      const ctx = new AudioContext({ sampleRate: 16000 })
      const source = ctx.createMediaStreamSource(new MediaStream([track]))
      const processor = ctx.createScriptProcessor(4096, 1, 1)

      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return
        const float32 = e.inputBuffer.getChannelData(0)
        const int16 = new Int16Array(float32.length)
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]))
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
        }
        ws.send(
          JSON.stringify({
            audio: {
              data: pcmToBase64(int16),
              sample_rate: '16000',
              encoding: 'audio/wav',
            },
          })
        )
      }

      ws.onopen = () => {
        source.connect(processor)
        processor.connect(ctx.destination)
        setState((s) => ({ ...s, isRecording: true, error: null }))
        console.log(`[Transcription] Pipe open (${speaker})`)
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type !== 'data') return
          const text: string = msg.data?.transcript || msg.data?.translation || ''
          if (text.trim()) {
            console.log(`[Transcription] Caption received (${speaker})`)
            writeChunk(text, speaker)
            publishCaption(text, speaker)
          }
        } catch (e) {
          console.warn('[Transcription] Parse error:', e)
        }
      }

      ws.onerror = () => {
        setState((s) => ({ ...s, error: 'Transcription connection error' }))
      }

      ws.onclose = () => {
        console.log(`[Transcription] Pipe closed (${speaker})`)
      }

      pipesRef.current.set(key, { ws, ctx, source, processor })
    },
    [writeChunk, publishCaption, sessionId]
  )

  const addRemoteMic = useCallback(
    (participant: RemoteParticipant) => {
      const track = participant
        .getTrackPublication(Track.Source.Microphone)
        ?.track?.mediaStreamTrack
      if (track) startPipe(participant.identity, track, 'client')
    },
    [startPipe]
  )

  // The local mic (therapist) is published asynchronously by LiveKit, often a
  // beat AFTER room.state flips to 'connected'. So we attach it both at start
  // and whenever it (re)appears; startPipe de-dupes by key, so this is safe.
  const addLocalMic = useCallback(() => {
    if (!room) return
    const track = room.localParticipant
      .getTrackPublication(Track.Source.Microphone)
      ?.track?.mediaStreamTrack
    if (track) startPipe('local', track, 'therapist')
  }, [room, startPipe])

  const stopTranscription = useCallback(() => {
    for (const key of Array.from(pipesRef.current.keys())) stopPipe(key)
    startedRef.current = false
    setState((s) => ({ ...s, isRecording: false }))
    console.log('[Transcription] Stopped')
  }, [stopPipe])

  const startTranscription = useCallback(() => {
    if (!shouldRun || !room || startedRef.current) return
    startedRef.current = true
    startTimeRef.current = Date.now()

    // Local mic = therapist (this hook only runs in the therapist browser). May
    // not be published yet — the LocalTrackPublished listener below catches it.
    addLocalMic()

    // Existing remote mics = client(s).
    room.remoteParticipants.forEach((p) => addRemoteMic(p))
  }, [shouldRun, room, addLocalMic, addRemoteMic])

  // Attach pipes for mics that arrive after we start: remote (client) mics via
  // TrackSubscribed, and the local (therapist) mic via LocalTrackPublished —
  // the latter is the common case, since the mic publishes just after connect.
  useEffect(() => {
    if (!shouldRun || !room) return
    const onSubscribed = (
      track: RemoteTrack,
      _pub: unknown,
      participant: RemoteParticipant
    ) => {
      if (track.source === Track.Source.Microphone && startedRef.current) {
        addRemoteMic(participant)
      }
    }
    const onLocalPublished = (pub: { source?: Track.Source }) => {
      if (pub.source === Track.Source.Microphone && startedRef.current) {
        addLocalMic()
      }
    }
    const onLeft = (participant: RemoteParticipant) => stopPipe(participant.identity)
    room.on(RoomEvent.TrackSubscribed, onSubscribed)
    room.on(RoomEvent.LocalTrackPublished, onLocalPublished)
    room.on(RoomEvent.ParticipantDisconnected, onLeft)
    return () => {
      room.off(RoomEvent.TrackSubscribed, onSubscribed)
      room.off(RoomEvent.LocalTrackPublished, onLocalPublished)
      room.off(RoomEvent.ParticipantDisconnected, onLeft)
    }
  }, [shouldRun, room, addLocalMic, addRemoteMic, stopPipe])

  useEffect(() => {
    if (!shouldRun || !room) return
    if (room.state !== 'connected') return
    startTranscription()
    return () => { stopTranscription() }
  }, [shouldRun, room?.state, startTranscription, stopTranscription])

  useEffect(() => {
    return () => stopTranscription()
  }, [stopTranscription])

  return {
    ...state,
    stop: stopTranscription,
    start: startTranscription,
  }
}
