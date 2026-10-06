'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { Track, RoomEvent } from 'livekit-client'
import type { FaceLandmarker } from '@mediapipe/tasks-vision'
import { useSessionRoom } from '@/components/StaadVideo'
import { appendAttentionEntry } from '@/lib/session-diary'
import {
  parseRole,
  resolveClientParticipant,
  isForwardFacing,
  computeAttentionScore,
  type AttentionSample,
} from '@/lib/attention-scoring'

/**
 * Attention scoring — runs ONLY in the therapist's browser, analysing ONLY the
 * client's incoming video track.
 *
 * ── Privacy contract ────────────────────────────────────────────────────────
 * 1. Never attaches to the therapist's own camera. The track is chosen by a
 *    POSITIVE role match on signed participant metadata (`role === 'client'`),
 *    never by "whoever isn't me". If the role cannot be confirmed, or more than
 *    one client is present, the landmarker is never constructed.
 * 2. Never starts without consent. Gated by the same `bothConsented` signal
 *    that gates transcription — one source of truth for AI analysis.
 * 3. No video leaves the browser. Detection is fully client-side against
 *    self-hosted WASM + model; only the numeric score is persisted.
 *
 * Deliberately NOT wired into <RemoteVideoArea>: that component picks its track
 * with `!participant.isLocal`, and it is reused by /session/preview where the
 * role is a toggle — so in preview its "remote" feed can be the THERAPIST. Any
 * analysis living inside it would follow it there. This hook resolves the track
 * itself, from role, and is the only thing permitted to attach.
 */

/** How often a frame is sampled. Step 4 calls for every 1-2s. */
const SAMPLE_INTERVAL_MS = 1500
/** How often the current score is persisted. Step 5 calls for every 5-10s. */
const WRITE_INTERVAL_MS = 7_000

export type AttentionStatus =
  | 'idle'            // consent absent, or not the therapist's browser
  | 'awaiting-client' // running, but no role-confirmed client track yet
  | 'loading'         // landmarker initialising
  | 'active'
  | 'error'

export interface AttentionState {
  status: AttentionStatus
  /** null until the rolling window holds at least one sample. */
  score: number | null
  faceDetected: boolean
  /** Identity of the track under analysis. Surfaced so the binding is auditable. */
  analyzedIdentity: string | null
  error: string | null
}

interface Options {
  sessionId: string
  /** Pass the SAME consent signal that gates transcription (bothConsented). */
  enabled: boolean
  userRole: 'therapist' | 'client'
}

export function useAttentionScoring({ sessionId, enabled, userRole }: Options) {
  const { room } = useSessionRoom()

  // Hard gate. Face tracking is a therapist-side observation of the incoming
  // client feed; it must never initialise anywhere else.
  const shouldRun = enabled && userRole === 'therapist'

  const [state, setState] = useState<AttentionState>({
    status: 'idle',
    score: null,
    faceDetected: false,
    analyzedIdentity: null,
    error: null,
  })

  // Which client we're bound to. Drives re-attachment when they rejoin.
  const [clientKey, setClientKey] = useState<string | null>(null)

  const samplesRef = useRef<AttentionSample[]>([])
  const scoreRef = useRef<number | null>(null)

  const computeScore = useCallback((): number | null => {
    const { score, window } = computeAttentionScore(samplesRef.current, Date.now())
    samplesRef.current = window
    return score
  }, [])

  // Track which client is present. Re-evaluated on every membership change so
  // a late join, a rejoin, or a departure is picked up.
  useEffect(() => {
    if (!shouldRun || !room) {
      setClientKey(null)
      return
    }

    const evaluate = () => {
      const remotes = Array.from(room.remoteParticipants.values())
      const { participant, reason } = resolveClientParticipant(remotes)
      if (!participant) {
        setClientKey(null)
        setState((s) => ({
          ...s,
          status: 'awaiting-client',
          score: null,
          faceDetected: false,
          analyzedIdentity: null,
        }))
        console.log(`[Attention] Not attaching — ${reason}`)
        return
      }
      setClientKey(participant.identity)
    }

    evaluate()

    const events = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.ParticipantMetadataChanged,
    ] as const
    events.forEach((e) => room.on(e, evaluate))
    return () => events.forEach((e) => room.off(e, evaluate))
  }, [shouldRun, room])

  // The analysis loop itself.
  useEffect(() => {
    if (!shouldRun || !room || !clientKey) return

    let cancelled = false
    let landmarker: FaceLandmarker | null = null
    let sampleTimer: ReturnType<typeof setInterval> | null = null
    let writeTimer: ReturnType<typeof setInterval> | null = null
    let videoEl: HTMLVideoElement | null = null

    const start = async () => {
      // Re-resolve at attach time rather than trusting the identity we were
      // handed — this is the last checkpoint before a frame is ever read.
      const remotes = Array.from(room.remoteParticipants.values())
      const { participant, reason } = resolveClientParticipant(remotes)
      if (!participant || participant.identity !== clientKey) {
        console.warn(`[Attention] Aborting attach — ${reason}`)
        return
      }

      const pub = participant.getTrackPublication(Track.Source.Camera)
      const mediaTrack = pub?.track?.mediaStreamTrack
      if (!mediaTrack) {
        setState((s) => ({ ...s, status: 'awaiting-client' }))
        return
      }

      // ── ATTACH-TIME ROLE ASSERTION ──────────────────────────────────────
      // The primary proof that the correct feed is under analysis. Belt and
      // braces over resolveClientParticipant: if this ever fires, something
      // upstream changed and we stop instead of analysing the wrong person.
      const confirmedRole = parseRole(participant.metadata)
      if (confirmedRole !== 'client') {
        console.error(
          `[Attention] REFUSING TO ATTACH: role="${confirmedRole}" for "${participant.identity}" — expected "client".`
        )
        setState((s) => ({
          ...s,
          status: 'error',
          error: 'Could not confirm the client role for this video track.',
        }))
        return
      }
      if (participant.isLocal) {
        console.error('[Attention] REFUSING TO ATTACH: target is the local participant.')
        return
      }

      console.log(
        `[Attention] ✓ Attaching to identity="${participant.identity}" role="${confirmedRole}" ` +
          `trackSid="${pub?.trackSid}" isLocal=${participant.isLocal}. ` +
          `Therapist's own camera is NOT analysed.`
      )

      setState((s) => ({
        ...s,
        status: 'loading',
        analyzedIdentity: participant.identity,
        error: null,
      }))

      // Build our own element from the role-verified track, rather than
      // querying a rendered <video> out of the DOM. Provenance is then
      // guaranteed by construction — there is no selector that could drift
      // onto the therapist's PiP.
      videoEl = document.createElement('video')
      videoEl.muted = true
      videoEl.playsInline = true
      videoEl.srcObject = new MediaStream([mediaTrack])

      try {
        await videoEl.play()

        // Loaded lazily, on purpose. The face-tracking library is ~1MB and is
        // only fetched once consent is confirmed AND a client track is bound —
        // so in a session without consent the detection code never even
        // reaches the browser, let alone runs.
        const { FaceLandmarker: Landmarker, FilesetResolver } = await import(
          '@mediapipe/tasks-vision'
        )
        if (cancelled) return

        const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
        if (cancelled) return

        landmarker = await Landmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: '/mediapipe/face_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          // The model's built-in head-pose output; drives forward-facing.
          outputFacialTransformationMatrixes: true,
          outputFaceBlendshapes: false,
        })
        if (cancelled) {
          landmarker.close()
          landmarker = null
          return
        }

        setState((s) => ({ ...s, status: 'active' }))

        sampleTimer = setInterval(() => {
          if (!landmarker || !videoEl || videoEl.readyState < 2) return
          try {
            const result = landmarker.detectForVideo(videoEl, performance.now())
            const faceDetected = result.faceLandmarks.length > 0
            const matrix = result.facialTransformationMatrixes?.[0]?.data
            const attentive =
              faceDetected && !!matrix && isForwardFacing(matrix)

            samplesRef.current.push({ t: Date.now(), attentive })
            const score = computeScore()
            scoreRef.current = score
            setState((s) => ({ ...s, score, faceDetected }))
          } catch (e) {
            console.warn('[Attention] Detection frame failed:', e)
          }
        }, SAMPLE_INTERVAL_MS)

        writeTimer = setInterval(() => {
          const score = scoreRef.current
          if (score === null) return
          appendAttentionEntry(sessionId, score).catch((e) => {
            // Surfaced rather than swallowed: a silent failure here means the
            // therapist's diary is quietly missing data.
            console.warn('[Attention] Firestore write failed:', e)
          })
        }, WRITE_INTERVAL_MS)
      } catch (e) {
        if (cancelled) return
        console.error('[Attention] Initialisation failed:', e)
        setState((s) => ({
          ...s,
          status: 'error',
          error: e instanceof Error ? e.message : 'Attention scoring failed to start',
        }))
      }
    }

    start()

    // Full teardown: nothing may outlive the session view.
    return () => {
      cancelled = true
      if (sampleTimer) clearInterval(sampleTimer)
      if (writeTimer) clearInterval(writeTimer)
      landmarker?.close()
      landmarker = null
      if (videoEl) {
        // Detach only. Never stop() the MediaStreamTrack — it belongs to the
        // LiveKit call, and stopping it would kill the client's live video.
        videoEl.pause()
        videoEl.srcObject = null
        videoEl = null
      }
      samplesRef.current = []
      scoreRef.current = null
      console.log('[Attention] Stopped and cleaned up')
    }
  }, [shouldRun, room, clientKey, sessionId, computeScore])

  // Consent revoked mid-session, or the gate was never open: drop any state.
  useEffect(() => {
    if (shouldRun) return
    samplesRef.current = []
    scoreRef.current = null
    setState({
      status: 'idle',
      score: null,
      faceDetected: false,
      analyzedIdentity: null,
      error: null,
    })
  }, [shouldRun])

  return state
}
