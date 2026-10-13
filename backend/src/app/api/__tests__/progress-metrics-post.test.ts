import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// POST /api/progress/metrics. The real route, requireAuth / requireTherapist
// and findAccessibleClient run; Firebase token verification and Prisma are
// faked (in-memory, honouring the where-clauses used). Synthetic data only;
// this does not exercise a live database or Firebase project.

const verifyIdToken = vi.hoisted(() => vi.fn())
vi.mock('@/lib/firebaseAdmin', () => ({ adminAuth: () => ({ verifyIdToken }) }))

const db = vi.hoisted(() => ({ users: [] as any[], clients: [] as any[], sessions: [] as any[] }))

function seed() {
  db.users = [
    { id: 'uid-t1', role: 'THERAPIST', therapist: { id: 't1', userId: 'uid-t1' } },
    { id: 'uid-t2', role: 'THERAPIST', therapist: { id: 't2', userId: 'uid-t2' } },
    { id: 'uid-t3', role: 'THERAPIST', therapist: null }, // no therapist profile
    { id: 'uid-c1', role: 'CLIENT', therapist: null },
    { id: 'uid-admin', role: 'ADMIN', therapist: null },
  ]
  db.clients = [
    { id: 'c1', therapistId: 't1', firstName: 'Test', lastName: 'ChildOne' }, // direct
    { id: 'c2', therapistId: null, firstName: 'Test', lastName: 'ChildTwo' }, // session-linked
    { id: 'c3', therapistId: 't2', firstName: 'Other', lastName: 'ChildThree' }, // t2 only
  ]
  db.sessions = [
    { id: 's1', therapistId: 't1', clientId: 'c1' },
    { id: 's2', therapistId: 't1', clientId: 'c2' },
    { id: 's3', therapistId: 't2', clientId: 'c3' },
  ]
}

function matches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (k === 'OR') return v.some((w: any) => matches(row, w))
    if (k === 'sessions') return db.sessions.some((s) => s.clientId === row.id && matches(s, v.some))
    return row[k] === v
  })
}

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  profileClient: { findFirst: vi.fn(), findUnique: vi.fn() },
  session: { findFirst: vi.fn() },
  progressMetric: { create: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ prisma: prismaMock }))

function installPrismaFakes() {
  prismaMock.user.findUnique.mockImplementation(async ({ where }: any) => db.users.find((u) => u.id === where.id) ?? null)
  prismaMock.profileClient.findFirst.mockImplementation(async ({ where, select }: any) => {
    const c = db.clients.find((x) => matches(x, where))
    return c ? Object.fromEntries(Object.keys(select).map((k) => [k, c[k]])) : null
  })
  prismaMock.session.findFirst.mockImplementation(async ({ where }: any) => {
    const s = db.sessions.find((x) => matches(x, where))
    return s ? { id: s.id } : null
  })
  prismaMock.progressMetric.create.mockImplementation(async ({ data }: any) => ({ id: 'm-new', ...data }))
}

const TOKENS: Record<string, string> = {
  't1-token': 'uid-t1',
  't3-token': 'uid-t3',
  'c1-token': 'uid-c1',
  'admin-token': 'uid-admin',
}

const NOTE = 'Synthetic note: child reported panic episodes at school'

const body = (overrides: Record<string, unknown> = {}) => ({
  clientId: 'c1',
  metricType: 'MOOD_SCORE',
  value: 7,
  unit: 'scale_1_10',
  ...overrides,
})

const post = (payload: unknown, token?: string) =>
  new Request('http://localhost/api/progress/metrics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  })

let POST: (req: Request) => Promise<Response>
let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  vi.stubEnv('AUTH_DISABLED', '')
  vi.stubEnv('NODE_ENV', 'production')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  seed()
  installPrismaFakes()
  verifyIdToken.mockImplementation(async (token: string) => {
    const uid = TOKENS[token]
    if (!uid) throw Object.assign(new Error('Decoding Firebase ID token failed.'), { code: 'auth/argument-error' })
    return { uid, email: `${uid}@example.test` }
  })
  ;({ POST } = await import('../progress/metrics/route'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const expectNothingWritten = () => expect(prismaMock.progressMetric.create).not.toHaveBeenCalled()

describe('rejected callers', () => {
  it.each([
    ['missing token', undefined, 401],
    ['invalid token', 'forged-token', 401],
    ['CLIENT account', 'c1-token', 403],
    ['ADMIN account', 'admin-token', 403],
    ['THERAPIST without a profile', 't3-token', 403],
  ])('%s is rejected before any client lookup or write', async (_label, token, status) => {
    const res = await POST(post(body({ notes: NOTE }), token))
    expect(res.status).toBe(status)
    expect(await res.json()).not.toHaveProperty('metric')
    expect(prismaMock.profileClient.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.session.findFirst).not.toHaveBeenCalled()
    expectNothingWritten()
  })

  it('an auth-helper database failure is a generic 500 with nothing written', async () => {
    prismaMock.user.findUnique.mockRejectedValue(new Error("Can't reach database server at ep-x.neon.tech:5432"))
    const res = await POST(post(body(), 't1-token'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('neon.tech')
    expectNothingWritten()
  })
})

describe('client ownership', () => {
  it('creates a metric for a directly assigned client, with exact data', async () => {
    const before = Date.now()
    const res = await POST(post(body(), 't1-token'))
    expect(res.status).toBe(201)
    expect((await res.json()).metric).toMatchObject({ clientId: 'c1', therapistId: 't1', value: 7 })

    expect(prismaMock.progressMetric.create).toHaveBeenCalledTimes(1)
    const { data } = prismaMock.progressMetric.create.mock.calls[0][0]
    expect(data).toEqual({
      clientId: 'c1',
      therapistId: 't1',
      sessionId: null,
      metricType: 'MOOD_SCORE',
      value: 7,
      unit: 'scale_1_10',
      notes: null,
      recordedAt: expect.any(Date),
    })
    // Omitted recordedAt keeps the existing default of "now".
    expect(data.recordedAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(data.recordedAt.getTime()).toBeLessThanOrEqual(Date.now())
    // No session check when no sessionId is supplied (existing behaviour).
    expect(prismaMock.session.findFirst).not.toHaveBeenCalled()
  })

  it('creates a metric for a session-linked client', async () => {
    const res = await POST(post(body({ clientId: 'c2' }), 't1-token'))
    expect(res.status).toBe(201)
    expect(prismaMock.progressMetric.create.mock.calls[0][0].data).toMatchObject({ clientId: 'c2', therapistId: 't1' })
  })

  it("another therapist's client and a nonexistent client get identical 404s and nothing is written", async () => {
    const other = await POST(post(body({ clientId: 'c3', notes: NOTE }), 't1-token'))
    const missing = await POST(post(body({ clientId: 'does-not-exist' }), 't1-token'))
    expect(other.status).toBe(404)
    expect(missing.status).toBe(404)
    const otherBody = await other.json()
    expect(otherBody).toEqual({ error: 'Client not found' })
    expect(await missing.json()).toEqual(otherBody)
    expectNothingWritten()
  })

  it('uses the shared ownership query for the verified therapist (not an existence-only lookup)', async () => {
    await POST(post(body({ clientId: 'c3' }), 't1-token'))
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'uid-t1' } }))
    expect(prismaMock.profileClient.findFirst).toHaveBeenCalledWith({
      where: { id: 'c3', OR: [{ therapistId: 't1' }, { sessions: { some: { therapistId: 't1' } } }] },
      select: { id: true, firstName: true, lastName: true },
    })
    expect(prismaMock.profileClient.findUnique).not.toHaveBeenCalled()
  })

  it('ignores a forged therapistId in the body', async () => {
    const res = await POST(post(body({ therapistId: 't2' }), 't1-token'))
    expect(res.status).toBe(201)
    expect(prismaMock.progressMetric.create.mock.calls[0][0].data.therapistId).toBe('t1')
  })
})

describe('optional sessionId', () => {
  it("accepts the therapist's own session with this client", async () => {
    const res = await POST(post(body({ sessionId: 's1' }), 't1-token'))
    expect(res.status).toBe(201)
    expect(prismaMock.session.findFirst).toHaveBeenCalledWith({
      where: { id: 's1', therapistId: 't1', clientId: 'c1' },
      select: { id: true },
    })
    expect(prismaMock.progressMetric.create.mock.calls[0][0].data.sessionId).toBe('s1')
  })

  it.each([
    ["another therapist's session", 's3'],
    ['own session but with a different client', 's2'],
    ['nonexistent session', 'does-not-exist'],
  ])('rejects %s with 404 and writes nothing', async (_label, sessionId) => {
    const res = await POST(post(body({ sessionId }), 't1-token'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Session not found' })
    expectNothingWritten()
  })
})

describe('recordedAt and existing validation', () => {
  it('rejects an invalid recordedAt with 400 before any lookup or write', async () => {
    const res = await POST(post(body({ recordedAt: 'not-a-date' }), 't1-token'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'recordedAt must be a valid date' })
    expect(prismaMock.profileClient.findFirst).not.toHaveBeenCalled()
    expectNothingWritten()
  })

  it('accepts a valid ISO recordedAt as before', async () => {
    const res = await POST(post(body({ recordedAt: '2026-03-10T10:00:00.000Z' }), 't1-token'))
    expect(res.status).toBe(201)
    expect(prismaMock.progressMetric.create.mock.calls[0][0].data.recordedAt).toEqual(new Date('2026-03-10T10:00:00.000Z'))
  })

  it('keeps the existing 400 responses', async () => {
    const missing = await POST(post({ clientId: 'c1', metricType: 'MOOD_SCORE' }, 't1-token'))
    expect(missing.status).toBe(400)
    expect(await missing.json()).toEqual({ error: 'clientId, metricType and value are required' })

    const notNumber = await POST(post(body({ value: '7' }), 't1-token'))
    expect(notNumber.status).toBe(400)
    expect(await notNumber.json()).toEqual({ error: 'value must be a number' })
    expectNothingWritten()
  })
})

describe('errors and logging', () => {
  it('a failed write is a generic 500; production logs contain no note text or values', async () => {
    prismaMock.progressMetric.create.mockRejectedValue(
      new Prisma.PrismaClientValidationError(
        `Invalid \`prisma.progressMetric.create()\` invocation: { notes: "${NOTE}", value: 7.25, client: "Test ChildOne" }`,
        { clientVersion: '6.19.3' }
      )
    )
    const res = await POST(post(body({ value: 7.25, notes: NOTE }), 't1-token'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
    const logged = JSON.stringify(consoleError.mock.calls)
    expect(logged).toContain('PrismaClientValidationError')
    expect(logged).not.toMatch(/panic episodes|7\.25|ChildOne/)
  })
})

describe('request ID validation', () => {
  const noLookupOrWrite = () => {
    expect(prismaMock.profileClient.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.session.findFirst).not.toHaveBeenCalled()
    expectNothingWritten()
  }

  it('a missing clientId keeps the existing required-field 400', async () => {
    const { clientId: _omit, ...rest } = body()
    const res = await POST(post(rest, 't1-token'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'clientId, metricType and value are required' })
    noLookupOrWrite()
  })

  it.each([
    ['empty string', '', 'clientId, metricType and value are required'],
    ['whitespace-only', '   ', 'clientId must be a non-empty string'],
    ['number', 123, 'clientId must be a non-empty string'],
    ['array', ['c1'], 'clientId must be a non-empty string'],
    ['object (Prisma filter)', { startsWith: '' }, 'clientId must be a non-empty string'],
  ])('clientId as %s is a 400 with no lookup or write', async (_label, clientId, error) => {
    const res = await POST(post(body({ clientId }), 't1-token'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error })
    noLookupOrWrite()
  })

  it.each([
    ['empty string', ''],
    ['whitespace-only', '   '],
    ['number', 42],
    ['array', ['s1']],
    ['object (Prisma filter)', { not: '' }],
  ])('sessionId as %s is a 400 with no lookup or write', async (_label, sessionId) => {
    const res = await POST(post(body({ sessionId }), 't1-token'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'sessionId must be a non-empty string when provided' })
    noLookupOrWrite()
  })

  it('a null sessionId is treated as omitted (existing behaviour)', async () => {
    const res = await POST(post(body({ sessionId: null }), 't1-token'))
    expect(res.status).toBe(201)
    expect(prismaMock.session.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.progressMetric.create.mock.calls[0][0].data.sessionId).toBeNull()
  })

  it('a valid ID is passed through unchanged (not trimmed or transformed)', async () => {
    await POST(post(body({ clientId: ' c1 ' }), 't1-token'))
    expect(prismaMock.profileClient.findFirst.mock.calls[0][0].where.id).toBe(' c1 ')
  })
})
