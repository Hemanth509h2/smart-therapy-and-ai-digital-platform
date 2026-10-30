import type { RemoteParticipant } from 'livekit-client'

/**
 * Pure logic behind attention scoring — role resolution, head pose, and the
 * rolling-window score.
 *
 * Deliberately free of React and of any browser/LiveKit runtime import so the
 * privacy-critical decisions here are directly unit-testable. The stateful
 * wiring lives in src/hooks/useAttentionScoring.ts.
 */

/** Rolling window the score is computed over. Step 4 calls for 10-15s. */
export const WINDOW_MS = 12_000

/**
 * Head-pose tolerance for "forward-facing", in degrees. Generous on purpose:
 * this measures rough engagement, and a child glancing down at a worksheet or
 * shifting in their seat is not inattentive. Better to under-report distraction
 * than to hand a therapist a score that punishes normal movement.
 */
export const MAX_YAW_DEG = 25
export const MAX_PITCH_DEG = 20

export interface AttentionSample {
  t: number
  attentive: boolean
}

/** Read the signed role claim published as LiveKit participant metadata. */
export function parseRole(metadata?: string): string | null {
  if (!metadata) return null
  try {
    const parsed = JSON.parse(metadata) as { role?: unknown }
    return typeof parsed.role === 'string' ? parsed.role : null
  } catch {
    return null
  }
}

/**
 * Resolve the one participant positively confirmed as the client.
 *
 * Returns null — meaning "do not run" — when the role is missing, unparseable,
 * or ambiguous. Ambiguity is treated as failure rather than picking a
 * candidate: with a supervisor or a second joiner in the room, guessing wrong
 * means analysing someone who did not consent to it.
 */
export function resolveClientParticipant(
  participants: RemoteParticipant[]
): { participant: RemoteParticipant | null; reason: string } {
  const clients = participants.filter((p) => parseRole(p.metadata) === 'client')

  if (clients.length === 0) {
    const seen = participants.length
      ? participants
          .map((p) => `${p.identity}:${parseRole(p.metadata) ?? 'no-role'}`)
          .join(', ')
      : 'none'
    return { participant: null, reason: `no role-confirmed client (remotes: ${seen})` }
  }
  if (clients.length > 1) {
    return {
      participant: null,
      reason: `ambiguous: ${clients.length} participants claim role=client`,
    }
  }
  return { participant: clients[0], reason: 'ok' }
}

/**
 * Head pose from the Face Landmarker's facial transformation matrix — the
 * model's own built-in pose estimate, not geometry derived by hand.
 *
 * MediaPipe returns a COLUMN-major 4x4, so the element at (row r, col c) is
 * data[c * 4 + r].
 */
export function isForwardFacing(matrix: ArrayLike<number>): boolean {
  const r20 = matrix[2]
  const r21 = matrix[6]
  const r22 = matrix[10]

  const yaw = Math.atan2(-r20, Math.hypot(r21, r22)) * (180 / Math.PI)
  const pitch = Math.atan2(r21, r22) * (180 / Math.PI)

  // Pitch wraps near ±180° when the matrix is expressed with an inverted
  // forward axis; fold it back so an upright head reads as ~0.
  const foldedPitch = Math.abs(pitch) > 90 ? 180 - Math.abs(pitch) : Math.abs(pitch)

  return Math.abs(yaw) <= MAX_YAW_DEG && foldedPitch <= MAX_PITCH_DEG
}

/**
 * Percentage of samples in the trailing window where a face was present AND
 * forward-facing. Returns the surviving window alongside the score so the
 * caller can prune in the same pass.
 *
 * Null score means "not enough data yet" — distinct from 0, which is a real
 * observation that the client was not attentive.
 */
export function computeAttentionScore(
  samples: AttentionSample[],
  now: number,
  windowMs: number = WINDOW_MS
): { score: number | null; window: AttentionSample[] } {
  const window = samples.filter((s) => s.t >= now - windowMs)
  if (window.length === 0) return { score: null, window }
  const attentive = window.filter((s) => s.attentive).length
  return { score: Math.round((attentive / window.length) * 100), window }
}
