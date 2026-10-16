import { describe, it, expect } from 'vitest'
import type { RemoteParticipant } from 'livekit-client'
import {
  parseRole,
  resolveClientParticipant,
  isForwardFacing,
  computeAttentionScore,
} from '../attention-scoring'

// Minimal stand-in — resolveClientParticipant only ever reads identity+metadata.
const participant = (identity: string, metadata?: string) =>
  ({ identity, metadata }) as unknown as RemoteParticipant

const THERAPIST = JSON.stringify({ role: 'therapist' })
const CLIENT = JSON.stringify({ role: 'client' })

/**
 * Builds a column-major 4x4 with a yaw (Y-axis) and pitch (X-axis) rotation,
 * matching the layout MediaPipe's facialTransformationMatrixes uses.
 */
function poseMatrix(yawDeg: number, pitchDeg: number): number[] {
  const y = (yawDeg * Math.PI) / 180
  const p = (pitchDeg * Math.PI) / 180
  const cy = Math.cos(y), sy = Math.sin(y)
  const cp = Math.cos(p), sp = Math.sin(p)

  // R = Ry * Rx, row-major
  const r = [
    [cy, sy * sp, sy * cp],
    [0, cp, -sp],
    [-sy, cy * sp, cy * cp],
  ]
  // Flatten to column-major: data[c * 4 + r]
  const m = new Array(16).fill(0)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) m[col * 4 + row] = r[row][col]
  }
  m[15] = 1
  return m
}

describe('parseRole', () => {
  it('reads a well-formed role claim', () => {
    expect(parseRole(CLIENT)).toBe('client')
    expect(parseRole(THERAPIST)).toBe('therapist')
  })

  it('returns null for absent, malformed, or non-string roles', () => {
    expect(parseRole(undefined)).toBeNull()
    expect(parseRole('')).toBeNull()
    expect(parseRole('not json')).toBeNull()
    expect(parseRole('{}')).toBeNull()
    expect(parseRole(JSON.stringify({ role: 42 }))).toBeNull()
  })
})

describe('resolveClientParticipant — the privacy gate', () => {
  it('selects the participant positively confirmed as the client', () => {
    const client = participant('Riya Sharma', CLIENT)
    const { participant: got } = resolveClientParticipant([
      participant('Dr Mehta', THERAPIST),
      client,
    ])
    expect(got).toBe(client)
  })

  it('REFUSES when the only remote is a therapist', () => {
    // The critical case: a naive `!isLocal` filter would return this person.
    const { participant: got, reason } = resolveClientParticipant([
      participant('Dr Mehta', THERAPIST),
    ])
    expect(got).toBeNull()
    expect(reason).toContain('no role-confirmed client')
  })

  it('REFUSES when the remote carries no role metadata at all', () => {
    const { participant: got } = resolveClientParticipant([
      participant('Unknown Joiner'),
    ])
    expect(got).toBeNull()
  })

  it('REFUSES when role metadata is malformed', () => {
    const { participant: got } = resolveClientParticipant([
      participant('Corrupt', '{broken'),
    ])
    expect(got).toBeNull()
  })

  it('REFUSES when two participants both claim to be the client', () => {
    const { participant: got, reason } = resolveClientParticipant([
      participant('Child A', CLIENT),
      participant('Child B', CLIENT),
    ])
    expect(got).toBeNull()
    expect(reason).toContain('ambiguous')
  })

  it('still resolves the client when a supervising therapist is present', () => {
    const client = participant('Riya Sharma', CLIENT)
    const { participant: got } = resolveClientParticipant([
      participant('Dr Mehta', THERAPIST),
      participant('Supervisor', THERAPIST),
      client,
    ])
    expect(got).toBe(client)
  })

  it('REFUSES in an empty room', () => {
    expect(resolveClientParticipant([]).participant).toBeNull()
  })
})

describe('isForwardFacing', () => {
  it('counts a head looking straight at the camera as forward', () => {
    expect(isForwardFacing(poseMatrix(0, 0))).toBe(true)
  })

  it('tolerates small natural movement', () => {
    expect(isForwardFacing(poseMatrix(15, 0))).toBe(true)
    expect(isForwardFacing(poseMatrix(-15, 0))).toBe(true)
    expect(isForwardFacing(poseMatrix(0, 12))).toBe(true)
  })

  it('counts a head turned away as not forward', () => {
    expect(isForwardFacing(poseMatrix(45, 0))).toBe(false)
    expect(isForwardFacing(poseMatrix(-60, 0))).toBe(false)
    expect(isForwardFacing(poseMatrix(90, 0))).toBe(false)
  })

  it('counts a head tilted well down or up as not forward', () => {
    expect(isForwardFacing(poseMatrix(0, 40))).toBe(false)
    expect(isForwardFacing(poseMatrix(0, -40))).toBe(false)
  })
})

describe('computeAttentionScore', () => {
  const now = 1_000_000

  it('is null before any sample lands — distinct from a real score of 0', () => {
    expect(computeAttentionScore([], now).score).toBeNull()
  })

  it('is 100 when every sample is attentive', () => {
    const s = [0, 1, 2, 3].map((i) => ({ t: now - i * 1500, attentive: true }))
    expect(computeAttentionScore(s, now).score).toBe(100)
  })

  it('is 0 when the face is never forward', () => {
    const s = [0, 1, 2, 3].map((i) => ({ t: now - i * 1500, attentive: false }))
    expect(computeAttentionScore(s, now).score).toBe(0)
  })

  it('rounds a partial window to a whole percentage', () => {
    const s = [
      { t: now, attentive: true },
      { t: now - 1500, attentive: true },
      { t: now - 3000, attentive: false },
    ]
    expect(computeAttentionScore(s, now).score).toBe(67)
  })

  it('drops samples older than the window and returns the pruned window', () => {
    const s = [
      { t: now, attentive: true },
      { t: now - 30_000, attentive: false }, // stale, must not count
    ]
    const { score, window } = computeAttentionScore(s, now)
    expect(score).toBe(100)
    expect(window).toHaveLength(1)
  })

  it('always yields a whole number in 0-100', () => {
    for (let n = 1; n <= 15; n++) {
      for (let a = 0; a <= n; a++) {
        const s = Array.from({ length: n }, (_, i) => ({ t: now, attentive: i < a }))
        const score = computeAttentionScore(s, now).score!
        expect(Number.isInteger(score)).toBe(true)
        expect(score).toBeGreaterThanOrEqual(0)
        expect(score).toBeLessThanOrEqual(100)
      }
    }
  })
})
