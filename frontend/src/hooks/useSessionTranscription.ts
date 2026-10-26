'use client'
import { useEffect, useRef, useCallback, useState } from 'react'
import { Track, RoomEvent, RemoteParticipant, RemoteTrack } from 'livekit-client'
import { doc, updateDoc, arrayUnion, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firestore'
import { useSessionRoom } from '@/components/StaadVideo'
import type { TranscriptChunk } from '@/lib/rag/types'
import { apiFetch } from '@/lib/api';
import { apiErrorMessage, caughtErrorMessage } from '@/lib/apiError';
import {
  STT_SAMPLE_RATE,
  STT_STREAM_PARAMS,
  buildAudioMessage,
  buildCaptionAttributes,
  parseSarvamMessage,
} from '@/lib/stt/sarvam'

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
  track: MediaStreamTrack
  speaker: TranscriptChunk['speaker']
  closing: boolean
  openedAt: number
}

// The STT relay in the Python AI service (ai/, stt package; port 4100 locally). It holds the Sarvam
// key and checks the signed token minted by the backend's /api/stt-token.
const STT_RELAY_URL = process.env.NEXT_PUBLIC_STT_RELAY_URL || 'http://localhost:4100'

function buildProxyUrl(sessionId: string, speaker: string, token: string): string {
  const url = new URL('/sarvam-stream', STT_RELAY_URL)
  // Ensure wss:// or ws://
  url.protocol = url.protocol.replace('http', 'ws')
  
  for (const [k, v] of Object.entries(STT_STREAM_PARAMS)) url.searchParams.set(k, v)
  url.searchParams.set('sid', sessionId)
  url.searchParams.set('speaker', speaker)
  if (token) url.searchParams.set('token', token)
  
  return url.toString()
}

// A slow relay (deploy/restart, network, Sarvam handshake) or a failed token
// request must not end transcription for the rest of the call. Each connect
// attempt gets a deadline, and a pipe that fails or drops keeps retrying
// (capped backoff) for as long as transcription is on.
const CONNECT_TIMEOUT_MS = 20_000
const MAX_BACKOFF_MS = 15_000
// A pipe that stayed open this long was healthy; its next drop retries from 1s.
const STABLE_PIPE_MS = 30_000

export function useSessionTranscription({
  sessionId,
  enabled,
  userRole,
}: UseSessionTranscriptionOptions) {
  const { room } = useSessionRoom()
  const pipesRef = useRef<Map<string, Pipe>>(new Map())
  const startTimeRef = useRef<number>(0)
  const startedRef = useRef(false)
  const pendingRef = useRef<Set<string>>(new Set())
  const retriesRef = useRef<Map<string, number>>(new Map())
  const retryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const startPipeRef = useRef<((key: string, track: MediaStreamTrack, speaker: TranscriptChunk['speaker']) => Promise<void>) | null>(null)
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
    async (text: string, speaker: TranscriptChunk['speaker'], segmentId: string) => {
      const clean = text.trim()
      if (!clean || !room) return

      const attributes = buildCaptionAttributes(speaker, clean, segmentId)

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
    pendingRef.current.delete(key)
    const pipe = pipesRef.current.get(key)
    if (!pipe) return
    pipe.closing = true
    pipe.processor.onaudioprocess = null
    pipe.ws.onopen = pipe.ws.onmessage = pipe.ws.onerror = pipe.ws.onclose = null
    pipe.track.onended = null
    try { pipe.processor.disconnect() } catch {}
    try { pipe.source.disconnect() } catch {}
    // Closing the context does NOT stop the MediaStreamTrack, which stays
    // owned by LiveKit and keeps feeding the call.
    try { pipe.ctx.close() } catch {}
    try { pipe.ws.close() } catch {}
    pipesRef.current.delete(key)
  }, [])

  // Reopen a pipe after a failed connect or a drop, while transcription is on.
  const scheduleRetry = useCallback(
    (key: string, track: MediaStreamTrack, speaker: TranscriptChunk['speaker']) => {
      if (!startedRef.current || track.readyState === 'ended') {
        setState((s) => ({ ...s, error: 'Transcription disconnected' }))
        return
      }
      const attempt = (retriesRef.current.get(key) ?? 0) + 1
      retriesRef.current.set(key, attempt)
      setState((s) => ({ ...s, error: 'Connecting to the transcription service…' }))
      clearTimeout(retryTimersRef.current.get(key))
      retryTimersRef.current.set(
        key,
        setTimeout(() => {
          retryTimersRef.current.delete(key)
          if (startedRef.current && !pipesRef.current.has(key)) startPipeRef.current?.(key, track, speaker)
        }, Math.min(1000 * 2 ** (attempt - 1), MAX_BACKOFF_MS))
      )
    },
    []
  )

  // Open a Sarvam socket + audio graph for one participant track.
  const startPipe = useCallback(
    async (key: string, track: MediaStreamTrack, speaker: TranscriptChunk['speaker']) => {
      // Reserve the key synchronously: the token fetch below is async, so
      // checking only pipesRef would let two callers race into duplicate pipes.
      if (pipesRef.current.has(key) || pendingRef.current.has(key)) return
      pendingRef.current.add(key)

      // The relay verifies this token when its STT_TOKEN_SECRET is set.
      // Dev without a secret may proceed tokenless; production may not.
      let token = ''
      // 401/403/404 (signed out, not this session's therapist) won't fix
      // themselves; anything else (5xx, timeout, network) is retried.
      let permanent = false
      try {
        const { auth } = await import('@/lib/firebase')
        // After a refresh Firebase restores the login asynchronously; asking
        // for the token before that returns nothing and the request fails.
        await auth.authStateReady?.()
        const idToken = await auth.currentUser?.getIdToken()
        const res = await apiFetch(`/api/stt-token?sessionId=${sessionId}`, {
          headers: { Authorization: `Bearer ${idToken}` },
          // A hung request would leave this pipe pending (and silent) forever.
          signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
        })
        if (!res.ok) {
          permanent = res.status === 401 || res.status === 403 || res.status === 404
          throw new Error(await apiErrorMessage(res, 'start live transcription'))
        }
        const data = await res.json()
        token = data.token
      } catch (err) {
        if (process.env.NODE_ENV === 'production') {
          console.error('[Transcription] Failed to get token:', err)
          // Stopped while the token was being fetched: nothing to retry.
          const wanted = pendingRef.current.delete(key)
          if (wanted && !permanent) scheduleRetry(key, track, speaker)
          else setState((s) => ({ ...s, error: caughtErrorMessage(err, 'start live transcription') }))
          return
        }
        console.warn('[Transcription] No STT token (dev): continuing without one')
      }
      // Stopped (or track ended) while the token was being fetched.
      if (!pendingRef.current.has(key) || track.readyState === 'ended') {
        pendingRef.current.delete(key)
        return
      }
      pendingRef.current.delete(key)

      const ws = new WebSocket(buildProxyUrl(sessionId, speaker, token))
      const ctx = new AudioContext({ sampleRate: STT_SAMPLE_RATE })
      const source = ctx.createMediaStreamSource(new MediaStream([track]))
      const processor = ctx.createScriptProcessor(4096, 1, 1)
      const pipe: Pipe = { ws, ctx, source, processor, track, speaker, closing: false, openedAt: 0 }

      // A handshake that hangs never fires onclose by itself; closing it here
      // does (code 1006), which hands it to the retry below.
      const connectTimer = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          console.warn(`[Transcription] Connect timed out (${speaker})`)
          ws.close()
        }
      }, CONNECT_TIMEOUT_MS)

      processor.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return
        ws.send(buildAudioMessage(e.inputBuffer.getChannelData(0)))
      }

      ws.onopen = () => {
        clearTimeout(connectTimer)
        pipe.openedAt = Date.now()
        if (ctx.state === 'suspended') ctx.resume().catch(() => {})
        source.connect(processor)
        processor.connect(ctx.destination)
        setState((s) => ({ ...s, isRecording: true, error: null }))
        console.log(`[Transcription] Pipe open (${speaker})`)
      }

      ws.onmessage = (event) => {
        const msg = parseSarvamMessage(event.data)
        if (msg.kind === 'error') {
          console.warn(`[Transcription] Service error (${speaker}):`, msg.code ?? '')
          setState((s) => ({ ...s, error: 'Transcription service error' }))
          return
        }
        if (msg.kind !== 'transcript') return
        // Fresh segment id per message. Sarvam's request_id is not documented as
        // unique per utterance, so it must not drive dedupe or the overlay's
        // replace-by-segment-id (that dropped every caption after the first).
        const segmentId = `${speaker}-${Date.now()}-${Math.random().toString(36).slice(2)}`
        console.log(`[Transcription] Caption received (${speaker}, ${msg.text.length} chars)`)
        // Caption first: a Firestore failure must never suppress the UI.
        publishCaption(msg.text, speaker, segmentId)
        writeChunk(msg.text, speaker)
      }

      ws.onerror = () => {
        setState((s) => ({ ...s, error: 'Transcription connection error' }))
      }

      ws.onclose = (ev) => {
        clearTimeout(connectTimer)
        if (pipe.closing) return
        console.log(`[Transcription] Pipe closed (${speaker}) code=${ev.code}`)
        stopPipe(key)
        if (pipesRef.current.size === 0) setState((s) => ({ ...s, isRecording: false }))
        // Auth/config failures will not fix themselves; everything else is retried.
        const reason = ev.reason || ''
        if (/not configured|auth/i.test(reason)) {
          setState((s) => ({ ...s, error: reason }))
          return
        }
        // Reset the backoff only after a stable pipe, so a relay that accepts
        // and then drops at once doesn't retry every second.
        if (pipe.openedAt && Date.now() - pipe.openedAt > STABLE_PIPE_MS) retriesRef.current.delete(key)
        scheduleRetry(key, track, speaker)
      }

      // Track ended (e.g. mic unpublished): tear the pipe down without touching the track.
      track.onended = () => stopPipe(key)

      pipesRef.current.set(key, pipe)
    },
    [writeChunk, publishCaption, sessionId, stopPipe, scheduleRetry]
  )
  startPipeRef.current = startPipe

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
    else console.log('[Transcription] Started; waiting for the local microphone track to publish')
  }, [room, startPipe])

  const stopTranscription = useCallback(() => {
    for (const key of Array.from(pipesRef.current.keys())) stopPipe(key)
    pendingRef.current.clear()
    retriesRef.current.clear()
    for (const timer of Array.from(retryTimersRef.current.values())) clearTimeout(timer)
    retryTimersRef.current.clear()
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
    if (!shouldRun || !room || room.state !== 'connected') {
      console.log(
        `[Transcription] Not starting: consentEnabled=${enabled} role=${userRole} room=${room ? room.state : 'none'}`
      )
      return
    }
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
