import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'crypto'

// POST /api/sessions/[sessionId]/transcript. The real route, requireAuth /
// requireTherapist and transcript-crypto run; only the service boundaries are
// faked: Firebase token verification, Prisma, admin settings and the Firestore
// transcript store. All data and keys are synthetic.

const verifyIdToken = vi.hoisted(() => vi.fn())
vi.mock('@/lib/core/firebaseAdmin', () => ({ adminAuth: () => ({ verifyIdToken }) }))

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  session: { findFirst: vi.fn() },
}))
vi.mock('@/lib/core/db', () => ({ prisma: prismaMock }))

const getSetting = vi.hoisted(() => vi.fn())
vi.mock('@/lib/core/settings', () => ({ getSetting }))

const store = vi.hoisted(() => ({
  checkAIConsent: vi.fn(),
  appendTranscriptChunk: vi.fn(),
}))
vi.mock('@/lib/ai/rag/transcript-store', () => store)

import { decryptText } from '@/lib/sessions/transcript-crypto'

const USERS: Record<string, any> = {
  'uid-t1': { id: 'uid-t1', role: 'THERAPIST', therapist: { id: 't1', userId: 'uid-t1' } },
  'uid-t2': { id: 'uid-t2', role: 'THERAPIST', therapist: { id: 't2', userId: 'uid-t2' } },
  'uid-c1': { id: 'uid-c1', role: 'CLIENT', therapist: null },
}
const SESSIONS = [
  { id: 's1', therapistId: 't1' },
  { id: 's3', therapistId: 't2' },
]
const TOKENS: Record<string, string> = {
  't1-token': 'uid-t1',
  't2-token': 'uid-t2',
  'c1-token': 'uid-c1',
}

const UTTERANCE = 'synthetic utterance about feeling worried at school'

const validBody = (overrides: Record<string, unknown> = {}) => ({
  text: UTTERANCE,
  speaker: 'client',
  timestamp: 1_760_000_000_000,
  sessionMinute: 3,
  ...overrides,
})

const post = (sessionId: string, body: unknown, token?: string) => {
  const req = new Request(`http://localhost/api/sessions/${sessionId}/transcript`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return POST(req, { params: { sessionId } })
}

const savedChunk = () => store.appendTranscriptChunk.mock.calls[0][1]

let POST: (req: Request, ctx: { params: { sessionId: string } }) => Promise<Response>
let consoleWarn: ReturnType<typeof vi.spyOn>
let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  vi.stubEnv('AUTH_DISABLED', '')
  vi.stubEnv('NEXT_PUBLIC_STT_TEST_MODE', '')
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('TRANSCRIPT_ENCRYPTION_ENABLED', '')
  vi.stubEnv('TRANSCRIPT_ENCRYPTION_KEY', '')
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

  verifyIdToken.mockImplementation(async (token: string) => {
    const uid = TOKENS[token]
    if (!uid) throw Object.assign(new Error('Decoding Firebase ID token failed.'), { code: 'auth/argument-error' })
    return { uid, email: `${uid}@example.test` }
  })
  prismaMock.user.findUnique.mockImplementation(async ({ where }: any) => USERS[where.id] ?? null)
  prismaMock.user.update.mockResolvedValue({})
  prismaMock.session.findFirst.mockImplementation(async ({ where }: any) => {
    const s = SESSIONS.find((x) => x.id === where.id && x.therapistId === where.therapistId)
    return s ? { id: s.id } : null
  })
  getSetting.mockResolvedValue(true)
  store.checkAIConsent.mockResolvedValue(true)
  store.appendTranscriptChunk.mockResolvedValue(undefined)
  ;({ POST } = await import('../sessions/[sessionId]/transcript/route'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const loggedText = () => JSON.stringify([...consoleWarn.mock.calls, ...consoleError.mock.calls])

describe('access control', () => {
  it('rejects a request without a token (401)', async () => {
    const res = await post('s1', validBody())
    expect(res.status).toBe(401)
    expect(store.appendTranscriptChunk).not.toHaveBeenCalled()
  })

  it('rejects a non-therapist (403)', async () => {
    const res = await post('s1', validBody(), 'c1-token')
    expect(res.status).toBe(403)
    expect(store.appendTranscriptChunk).not.toHaveBeenCalled()
  })

  it("returns 404 for another therapist's session", async () => {
    const res = await post('s3', validBody(), 't1-token')
    expect(res.status).toBe(404)
    expect(store.checkAIConsent).not.toHaveBeenCalled()
    expect(store.appendTranscriptChunk).not.toHaveBeenCalled()
  })

  it('returns 404 for a session that does not exist', async () => {
    const res = await post('nope', validBody(), 't1-token')
    expect(res.status).toBe(404)
    expect(store.appendTranscriptChunk).not.toHaveBeenCalled()
  })

  it('returns 503 when an admin has turned transcription off', async () => {
    getSetting.mockResolvedValue(false)
    const res = await post('s1', validBody(), 't1-token')
    expect(res.status).toBe(503)
    expect(store.appendTranscriptChunk).not.toHaveBeenCalled()
  })
})

describe('consent', () => {
  it('returns 403 without both-party consent', async () => {
    store.checkAIConsent.mockResolvedValue(false)
    const res = await post('s1', validBody(), 't1-token')
    expect(res.status).toBe(403)
    expect(store.appendTranscriptChunk).not.toHaveBeenCalled()
  })

  it('allows the test-mode bypass outside production', async () => {
    store.checkAIConsent.mockResolvedValue(false)
    vi.stubEnv('NEXT_PUBLIC_STT_TEST_MODE', 'true')
    vi.stubEnv('NODE_ENV', 'development')
    const res = await post('s1', validBody(), 't1-token')
    expect(res.status).toBe(200)
    expect(store.appendTranscriptChunk).toHaveBeenCalledOnce()
  })

  it('ignores the test-mode bypass in production', async () => {
    store.checkAIConsent.mockResolvedValue(false)
    vi.stubEnv('NEXT_PUBLIC_STT_TEST_MODE', 'true')
    const res = await post('s1', validBody(), 't1-token')
    expect(res.status).toBe(403)
    expect(store.appendTranscriptChunk).not.toHaveBeenCalled()
  })
})

describe('body validation', () => {
  it.each([
    ['missing text', validBody({ text: undefined })],
    ['empty text', validBody({ text: '' })],
    ['whitespace-only text', validBody({ text: '   ' })],
    ['non-string text', validBody({ text: 42 })],
    ['text over 10000 chars', validBody({ text: 'a'.repeat(10_001) })],
    ['unknown speaker', validBody({ speaker: 'unknown' })],
    ['missing speaker', validBody({ speaker: undefined })],
    ['non-numeric timestamp', validBody({ timestamp: '2026-01-01' })],
    ['zero timestamp', validBody({ timestamp: 0 })],
    ['negative sessionMinute', validBody({ sessionMinute: -1 })],
    ['fractional sessionMinute', validBody({ sessionMinute: 1.5 })],
    ['non-object body', 'not json'],
  ])('rejects %s (400)', async (_label, body) => {
    const res = await post('s1', body, 't1-token')
    expect(res.status).toBe(400)
    expect(store.appendTranscriptChunk).not.toHaveBeenCalled()
  })

  it('accepts text of exactly 10000 chars', async () => {
    const res = await post('s1', validBody({ text: 'a'.repeat(10_000) }), 't1-token')
    expect(res.status).toBe(200)
  })
})

describe('saving', () => {
  it('saves plain text when encryption is off (default)', async () => {
    const res = await post('s1', validBody(), 't1-token')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(store.appendTranscriptChunk).toHaveBeenCalledWith('s1', {
      text: UTTERANCE,
      speaker: 'client',
      timestamp: 1_760_000_000_000,
      sessionMinute: 3,
      isFinal: true,
    })
  })

  it('trims the text before saving', async () => {
    await post('s1', validBody({ text: `  ${UTTERANCE}  ` }), 't1-token')
    expect(savedChunk().text).toBe(UTTERANCE)
  })

  it('saves encrypted text when encryption is on', async () => {
    vi.stubEnv('TRANSCRIPT_ENCRYPTION_ENABLED', 'true')
    vi.stubEnv('TRANSCRIPT_ENCRYPTION_KEY', randomBytes(32).toString('base64'))
    const res = await post('s1', validBody({ speaker: 'therapist' }), 't1-token')
    expect(res.status).toBe(200)

    const chunk = savedChunk()
    expect(chunk.text.startsWith('v1:')).toBe(true)
    expect(chunk.text).not.toContain(UTTERANCE)
    expect(decryptText(chunk.text)).toBe(UTTERANCE)
    expect(chunk).toMatchObject({ speaker: 'therapist', timestamp: 1_760_000_000_000, sessionMinute: 3, isFinal: true })
  })

  it.each([
    ['missing', ''],
    ['wrong length', randomBytes(16).toString('base64')],
  ])('refuses to save (503) when encryption is on but the key is %s', async (_label, key) => {
    vi.stubEnv('TRANSCRIPT_ENCRYPTION_ENABLED', 'true')
    vi.stubEnv('TRANSCRIPT_ENCRYPTION_KEY', key)
    const res = await post('s1', validBody(), 't1-token')
    expect(res.status).toBe(503)
    expect(store.appendTranscriptChunk).not.toHaveBeenCalled()
    expect(loggedText()).not.toContain(UTTERANCE)
  })

  it('returns a generic 500 without the text when the store fails', async () => {
    store.appendTranscriptChunk.mockRejectedValue(new Error('Firestore unavailable'))
    const res = await post('s1', validBody(), 't1-token')
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain(UTTERANCE)
    expect(loggedText()).not.toContain(UTTERANCE)
  })
})
