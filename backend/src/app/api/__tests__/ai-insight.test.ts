import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// POST /api/ai-insight access control. The real route, requireAuth /
// requireTherapist, runAnalysis, retrieval and safety code run; only the
// service boundaries are faked: Firebase token verification, Prisma, the
// Firestore transcript store, Firestore Admin writes, Neon SQL, embeddings and
// the OpenRouter chat call. All data is synthetic.

// transcription.ts (imported by retrieval for its transcript formatter) refuses
// to load without a Deepgram key. Placeholder only; no Deepgram call is made.
vi.hoisted(() => {
  process.env.DEEPGRAM_API_KEY ||= 'test-placeholder-not-a-key'
})

const verifyIdToken = vi.hoisted(() => vi.fn())
vi.mock('@/lib/firebaseAdmin', () => ({ adminAuth: () => ({ verifyIdToken }) }))

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  session: { findFirst: vi.fn() },
  profileTherapist: { findUnique: vi.fn() },
  usageEvent: { create: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ prisma: prismaMock }))

// Admin feature switches (Settings → features.aiInsights): on, as by default.
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async () => true) }))

const store = vi.hoisted(() => ({
  checkAIConsent: vi.fn(),
  getSessionTranscript: vi.fn(),
  getSessionActivity: vi.fn(),
  appendCopilotEvent: vi.fn(),
}))
vi.mock('@/lib/rag/transcript-store', () => store)

// Neon tagged-template SQL used by retrieval (previous notes, study material).
const sqlCalls = vi.hoisted(() => [] as { text: string; values: unknown[] }[])
vi.mock('@neondatabase/serverless', () => ({
  neon: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$')
    sqlCalls.push({ text, values })
    return text.includes('COUNT(*)') ? [{ count: 0 }] : []
  },
}))

const generateEmbedding = vi.hoisted(() => vi.fn())
vi.mock('@/lib/rag/nvidia-client', () => ({ generateEmbedding }))

const chatJSON = vi.hoisted(() => vi.fn())
vi.mock('@/lib/report/openrouter-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/report/openrouter-client')>()),
  chatJSON,
}))

const firestoreSet = vi.hoisted(() => vi.fn())
const initializeApp = vi.hoisted(() => vi.fn())
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: () => ({ doc: () => ({ set: firestoreSet }) }) }),
}))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp, cert: vi.fn() }))

// Real runAnalysis, wrapped so calls can be asserted.
vi.mock('@/lib/rag/analysis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rag/analysis')>()
  return { ...actual, runAnalysis: vi.fn(actual.runAnalysis) }
})
import { runAnalysis } from '@/lib/rag/analysis'

const USERS: Record<string, any> = {
  'uid-t1': { id: 'uid-t1', role: 'THERAPIST', therapist: { id: 't1', userId: 'uid-t1' } },
  'uid-t2': { id: 'uid-t2', role: 'THERAPIST', therapist: { id: 't2', userId: 'uid-t2' } },
  'uid-c1': { id: 'uid-c1', role: 'CLIENT', therapist: null },
  'uid-admin': { id: 'uid-admin', role: 'ADMIN', therapist: null },
}
const SESSIONS = [
  { id: 's1', therapistId: 't1', clientId: 'c1' },
  { id: 's3', therapistId: 't2', clientId: 'c3' },
]
const TOKENS: Record<string, string> = {
  't1-token': 'uid-t1',
  'c1-token': 'uid-c1',
  'admin-token': 'uid-admin',
}

const UTTERANCE = 'synthetic utterance about feeling worried at school'
const FORGED_CLIENT = 'forged-client-id'

const validBody = (overrides: Record<string, unknown> = {}) => ({
  sessionId: 's1',
  therapistId: 'uid-t1',
  clientProfile: { clientId: FORGED_CLIENT, name: 'Test Child', age: 9, conditions: ['ADHD'], sessionNumber: 2 },
  ...overrides,
})

const post = (body: unknown, token?: string) =>
  new Request('http://localhost/api/ai-insight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })

let POST: (req: Request) => Promise<Response>
let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  vi.stubEnv('AUTH_DISABLED', '')
  vi.stubEnv('NEXT_PUBLIC_STT_TEST_MODE', '')
  vi.stubEnv('NODE_ENV', 'production')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  sqlCalls.length = 0

  verifyIdToken.mockImplementation(async (token: string) => {
    const uid = TOKENS[token]
    if (!uid) throw Object.assign(new Error('Decoding Firebase ID token failed.'), { code: 'auth/argument-error' })
    return { uid, email: `${uid}@example.test` }
  })
  prismaMock.user.findUnique.mockImplementation(async ({ where }: any) => USERS[where.id] ?? null)
  prismaMock.session.findFirst.mockImplementation(async ({ where }: any) => {
    const s = SESSIONS.find((x) => x.id === where.id && x.therapistId === where.therapistId)
    return s ? { id: s.id, clientId: s.clientId } : null
  })
  prismaMock.profileTherapist.findUnique.mockImplementation(async ({ where }: any) =>
    where.userId === 'uid-t1' ? { id: 't1' } : null
  )
  prismaMock.usageEvent.create.mockResolvedValue({})

  store.checkAIConsent.mockResolvedValue(true)
  store.getSessionTranscript.mockResolvedValue([
    { text: UTTERANCE, speaker: 'client', timestamp: Date.now(), sessionMinute: 1, isFinal: true },
  ])
  store.getSessionActivity.mockResolvedValue({ moduleEvents: [], inCallNotes: [] })
  store.appendCopilotEvent.mockResolvedValue(undefined)

  // Safety scan uses maxTokens 256; the copilot pass uses the default.
  chatJSON.mockImplementation(async (_model: string, _sys: string, _user: string, maxTokens?: number) =>
    maxTokens === 256
      ? '{"level":"none","cue":"","rationale":""}'
      : '{"emotions":["worried"],"summary":"Synthetic summary","steps":["Validate feelings"],"module":"","riskFlag":false}'
  )
  ;({ POST } = await import('../ai-insight/route'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

/** Nothing sensitive was read, sent to an LLM, or written. */
function expectNoSensitiveWork() {
  expect(store.checkAIConsent).not.toHaveBeenCalled()
  expect(store.getSessionTranscript).not.toHaveBeenCalled()
  expect(store.getSessionActivity).not.toHaveBeenCalled()
  expect(runAnalysis).not.toHaveBeenCalled()
  expect(sqlCalls).toHaveLength(0) // previous notes + study material
  expect(generateEmbedding).not.toHaveBeenCalled()
  expect(chatJSON).not.toHaveBeenCalled()
  expect(firestoreSet).not.toHaveBeenCalled()
  expect(store.appendCopilotEvent).not.toHaveBeenCalled()
  expect(prismaMock.usageEvent.create).not.toHaveBeenCalled()
  expect(prismaMock.profileTherapist.findUnique).not.toHaveBeenCalled()
}

describe('authentication and role', () => {
  it.each([
    ['missing token', undefined, 401],
    ['invalid token', 'forged-token', 401],
    ['CLIENT account', 'c1-token', 403],
    ['ADMIN account', 'admin-token', 403],
  ])('%s is rejected before any session lookup or sensitive work', async (_label, token, status) => {
    const res = await POST(post(validBody(), token))
    expect(res.status).toBe(status)
    expect(await res.json()).not.toHaveProperty('insight')
    expect(prismaMock.session.findFirst).not.toHaveBeenCalled()
    expectNoSensitiveWork()
  })

  it('authenticates before validating the body (unauthenticated garbage is a 401, not a 400)', async () => {
    const res = await POST(post({}, undefined))
    expect(res.status).toBe(401)
  })
})

describe('forged identifiers and ownership', () => {
  it("rejects a body therapistId that is not the caller's uid", async () => {
    const res = await POST(post(validBody({ therapistId: 'uid-t2' }), 't1-token'))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
    expect(prismaMock.session.findFirst).not.toHaveBeenCalled()
    expectNoSensitiveWork()
  })

  it("returns the same 404 for another therapist's session and a nonexistent one", async () => {
    const other = await POST(post(validBody({ sessionId: 's3' }), 't1-token'))
    const otherBody = await other.json()
    expectNoSensitiveWork()

    const missing = await POST(post(validBody({ sessionId: 'does-not-exist' }), 't1-token'))
    expect(other.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(otherBody).toEqual({ error: 'Session not found' })
    expect(await missing.json()).toEqual(otherBody)
    expectNoSensitiveWork()
  })

  it('scopes the ownership query to the verified therapist profile', async () => {
    await POST(post(validBody({ sessionId: 's3' }), 't1-token'))
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'uid-t1' } }))
    expect(prismaMock.session.findFirst).toHaveBeenCalledWith({
      where: { id: 's3', therapistId: 't1' },
      select: { id: true, clientId: true },
    })
  })
})

describe('authorized therapist', () => {
  it('runs the analysis and returns { insight } using only verified IDs downstream', async () => {
    const res = await POST(post(validBody(), 't1-token'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body)).toEqual(['insight'])
    expect(body.insight).toMatchObject({ summary: 'Synthetic summary', emotions: ['worried'], riskLevel: 'none' })

    // Ownership verified before the sensitive reads.
    const ownershipOrder = prismaMock.session.findFirst.mock.invocationCallOrder[0]
    expect(ownershipOrder).toBeLessThan(store.checkAIConsent.mock.invocationCallOrder[0])
    expect(ownershipOrder).toBeLessThan(store.getSessionTranscript.mock.invocationCallOrder[0])

    expect(runAnalysis).toHaveBeenCalledWith({
      sessionId: 's1',
      therapistId: 'uid-t1',
      clientProfile: {
        clientId: 'c1', // from the verified session row, not the body
        name: 'Test Child',
        age: 9,
        conditions: ['ADHD'],
        sessionNumber: 2,
        therapistId: 'uid-t1',
      },
      transcriptWindowMinutes: 5,
    })

    // Retrieval SQL received only verified identifiers (uid, as before the fix).
    const notes = sqlCalls.find((c) => c.text.includes('TherapistNote'))!
    expect(notes.values).toEqual(['uid-t1', 'c1', 3])
    const material = sqlCalls.find((c) => c.text.includes('COUNT(*)'))!
    expect(material.values).toEqual(['uid-t1'])

    expect(chatJSON).toHaveBeenCalledTimes(2) // copilot + safety pass
    expect(firestoreSet).toHaveBeenCalledWith(
      expect.objectContaining({ aiInsight: expect.objectContaining({ summary: 'Synthetic summary' }) }),
      { merge: true }
    )
    expect(store.appendCopilotEvent).toHaveBeenCalledWith('s1', expect.objectContaining({ summary: 'Synthetic summary' }))
    expect(prismaMock.profileTherapist.findUnique).toHaveBeenCalledWith({ where: { userId: 'uid-t1' }, select: { id: true } })
    expect(prismaMock.usageEvent.create).toHaveBeenCalledWith({
      data: { therapistId: 't1', sessionId: 's1', type: 'AI_ANALYSIS' },
    })
    expect(initializeApp).not.toHaveBeenCalled() // existing init block untouched (app already exists)
  })

  it('never lets the body-supplied clientId reach retrieval, analysis or persistence', async () => {
    await POST(post(validBody(), 't1-token'))
    const everything = JSON.stringify([
      sqlCalls,
      (runAnalysis as any).mock.calls,
      chatJSON.mock.calls,
      firestoreSet.mock.calls,
      store.appendCopilotEvent.mock.calls,
      prismaMock.usageEvent.create.mock.calls,
    ])
    expect(everything).not.toContain(FORGED_CLIENT)
  })

  it('keeps the consent-denied response and reads no transcript', async () => {
    store.checkAIConsent.mockResolvedValue(false)
    const res = await POST(post(validBody(), 't1-token'))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: 'AI analysis not consented',
      detail: 'Both therapist and client must consent to AI analysis',
    })
    expect(store.checkAIConsent).toHaveBeenCalledWith('s1')
    expect(store.getSessionTranscript).not.toHaveBeenCalled()
    expect(chatJSON).not.toHaveBeenCalled()
    expect(firestoreSet).not.toHaveBeenCalled()
  })

  it('keeps the no-transcript response and runs no analysis', async () => {
    store.getSessionTranscript.mockResolvedValue([])
    const res = await POST(post(validBody(), 't1-token'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'No transcript data found for this session' })
    expect(runAnalysis).not.toHaveBeenCalled()
    expect(chatJSON).not.toHaveBeenCalled()
    expect(prismaMock.usageEvent.create).not.toHaveBeenCalled()
  })

  it('keeps the existing 400 validation responses', async () => {
    const noClient = await POST(post(validBody({ clientProfile: { name: 'x' } }), 't1-token'))
    expect(noClient.status).toBe(400)
    expect(await noClient.json()).toEqual({ error: 'clientProfile.clientId is required' })

    const noTherapist = await POST(post(validBody({ therapistId: undefined }), 't1-token'))
    expect(noTherapist.status).toBe(400)
    expect(await noTherapist.json()).toEqual({ error: 'therapistId is required and must be a string' })
    expectNoSensitiveWork()
  })
})

describe('errors', () => {
  it('an LLM provider failure is a generic 500 and logs no transcript or patient data', async () => {
    chatJSON.mockRejectedValue(
      new Error(`OpenRouter 400: prompt for Test Child contained "${UTTERANCE}" (OPENROUTER_API_KEY sk-xyz)`)
    )
    const res = await POST(post(validBody(), 't1-token'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/Test Child|worried at school|sk-xyz|OPENROUTER_API_KEY/)
    expect(firestoreSet).not.toHaveBeenCalled()
  })

  it('a database failure during the ownership check is a generic 500 with no sensitive work', async () => {
    prismaMock.session.findFirst.mockRejectedValue(new Error("Can't reach database server at ep-x.neon.tech:5432"))
    const res = await POST(post(validBody(), 't1-token'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('neon.tech')
    expectNoSensitiveWork()
  })
})
