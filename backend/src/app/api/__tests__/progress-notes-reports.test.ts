import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// POST /api/progress/notes, POST /api/progress/reports, GET /api/progress/reports.
// The real routes, requireAuth / requireTherapist and findAccessibleClient run;
// Firebase token verification and Prisma are faked (in-memory, honouring the
// where-clauses used). Synthetic data only; no live database or Firebase.

const verifyIdToken = vi.hoisted(() => vi.fn())
vi.mock('@/lib/firebaseAdmin', () => ({ adminAuth: () => ({ verifyIdToken }) }))

const db = vi.hoisted(() => ({
  users: [] as any[],
  clients: [] as any[],
  sessions: [] as any[],
  reports: [] as any[],
  notes: [] as any[],
  metrics: [] as any[],
}))

const T1_NOTE = 'T1 synthetic note about sleep routine'
const T2_INJECTED = 'T2 synthetic note injected into T1 report'
const SUMMARY = 'Synthetic summary: steady improvement in self-regulation'

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
  db.reports = [
    { id: 'r1', therapistId: 't1', clientId: 'c1', title: 'Progress Report', summary: 'r1' },
    { id: 'r2', therapistId: 't1', clientId: 'c2', title: 'Progress Report', summary: 'r2' },
    { id: 'r3', therapistId: 't2', clientId: 'c3', title: 'Progress Report', summary: 'r3' },
  ]
  db.notes = [
    { id: 'n1', therapistId: 't1', clientId: 'c1', reportId: 'r1', content: T1_NOTE, isPrivate: true },
    // Pre-existing bad row: t2's note linked to t1's report.
    { id: 'nX', therapistId: 't2', clientId: 'c1', reportId: 'r1', content: T2_INJECTED, isPrivate: true },
  ]
  db.metrics = [
    { id: 'm1', therapistId: 't1', clientId: 'c1', metricType: 'MOOD_SCORE', value: 7, recordedAt: new Date('2026-03-05T00:00:00Z') },
    // t2's metric for the shared client in the same period — must not enter t1's snapshot.
    { id: 'm2', therapistId: 't2', clientId: 'c1', metricType: 'ANXIETY_LEVEL', value: 42, recordedAt: new Date('2026-03-06T00:00:00Z') },
    // t1's metric outside the period.
    { id: 'm3', therapistId: 't1', clientId: 'c1', metricType: 'MOOD_SCORE', value: 9, recordedAt: new Date('2026-05-01T00:00:00Z') },
  ]
}

function matches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (k === 'OR') return v.some((w: any) => matches(row, w))
    if (k === 'sessions') return db.sessions.some((s) => s.clientId === row.id && matches(s, v.some))
    if (v instanceof Object && ('gte' in v || 'lte' in v)) {
      return (!v.gte || row[k] >= v.gte) && (!v.lte || row[k] <= v.lte)
    }
    return row[k] === v
  })
}

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  profileClient: { findFirst: vi.fn(), findUnique: vi.fn() },
  progressReport: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  progressNote: { create: vi.fn() },
  progressMetric: { findMany: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ prisma: prismaMock }))

function installPrismaFakes() {
  prismaMock.user.findUnique.mockImplementation(async ({ where }: any) => db.users.find((u) => u.id === where.id) ?? null)
  prismaMock.profileClient.findFirst.mockImplementation(async ({ where, select }: any) => {
    const c = db.clients.find((x) => matches(x, where))
    return c ? Object.fromEntries(Object.keys(select).map((k) => [k, c[k]])) : null
  })
  prismaMock.progressReport.findFirst.mockImplementation(async ({ where }: any) => {
    const r = db.reports.find((x) => matches(x, where))
    return r ? { id: r.id } : null
  })
  prismaMock.progressReport.findMany.mockImplementation(async ({ where, include }: any) =>
    db.reports
      .filter((r) => matches(r, where))
      .map((r) => {
        const pn = include?.progressNotes
        const notes = db.notes.filter((n) => n.reportId === r.id && (pn === true || matches(n, pn?.where)))
        return { ...r, progressNotes: notes.map((n) => ({ ...n })) }
      })
  )
  prismaMock.progressReport.create.mockImplementation(async ({ data }: any) => ({ id: 'r-new', ...data }))
  prismaMock.progressNote.create.mockImplementation(async ({ data }: any) => ({ id: 'n-new', ...data }))
  prismaMock.progressMetric.findMany.mockImplementation(async ({ where }: any) =>
    db.metrics.filter((m) => matches(m, where)).map((m) => ({ ...m }))
  )
}

const TOKENS: Record<string, string> = {
  't1-token': 'uid-t1',
  't3-token': 'uid-t3',
  'c1-token': 'uid-c1',
  'admin-token': 'uid-admin',
}

const request = (method: string, url: string, payload?: unknown, token?: string) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
  })

const noteBody = (o: Record<string, unknown> = {}) => ({ clientId: 'c1', content: T1_NOTE, ...o })
const reportBody = (o: Record<string, unknown> = {}) => ({
  clientId: 'c1',
  periodStart: '2026-03-01T00:00:00.000Z',
  periodEnd: '2026-03-31T23:59:59.000Z',
  summary: SUMMARY,
  ...o,
})

let notes: typeof import('../progress/notes/route')
let reports: typeof import('../progress/reports/route')
let consoleError: ReturnType<typeof vi.spyOn>

const postNote = (payload: unknown, token?: string) => notes.POST(request('POST', '/api/progress/notes', payload, token))
const postReport = (payload: unknown, token?: string) => reports.POST(request('POST', '/api/progress/reports', payload, token))
const getReports = (clientId: string, token?: string) =>
  reports.GET(request('GET', `/api/progress/reports?clientId=${clientId}`, undefined, token))

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
  notes = await import('../progress/notes/route')
  reports = await import('../progress/reports/route')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const noDataWork = () => {
  expect(prismaMock.profileClient.findFirst).not.toHaveBeenCalled()
  expect(prismaMock.profileClient.findUnique).not.toHaveBeenCalled()
  expect(prismaMock.progressReport.findFirst).not.toHaveBeenCalled()
  expect(prismaMock.progressMetric.findMany).not.toHaveBeenCalled()
  expect(prismaMock.progressNote.create).not.toHaveBeenCalled()
  expect(prismaMock.progressReport.create).not.toHaveBeenCalled()
}

const ownershipQuery = (clientId: string) => ({
  where: { id: clientId, OR: [{ therapistId: 't1' }, { sessions: { some: { therapistId: 't1' } } }] },
  select: { id: true, firstName: true, lastName: true },
})

const posts = [
  ['notes POST', (token?: string) => postNote(noteBody(), token)],
  ['reports POST', (token?: string) => postReport(reportBody(), token)],
] as const

describe.each(posts)('%s — rejected callers', (_name, call) => {
  it.each([
    ['missing token', undefined, 401],
    ['invalid token', 'forged-token', 401],
    ['CLIENT account', 'c1-token', 403],
    ['ADMIN account', 'admin-token', 403],
    ['THERAPIST without a profile', 't3-token', 403],
  ])('%s is rejected with no client lookup or write', async (_label, token, status) => {
    const res = await call(token)
    expect(res.status).toBe(status)
    expect(JSON.stringify(await res.json())).not.toMatch(/synthetic/i)
    noDataWork()
  })

  it('an auth-helper database failure is a generic 500, not an uncaught exception', async () => {
    prismaMock.user.findUnique.mockRejectedValue(new Error("Can't reach database server at ep-x.neon.tech:5432"))
    const res = await call('t1-token')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('neon.tech')
    noDataWork()
  })
})

describe('notes POST', () => {
  it('creates a note for a directly assigned client with exact, verified data', async () => {
    const res = await postNote(noteBody({ therapistId: 't2' }), 't1-token')
    expect(res.status).toBe(201)
    expect(prismaMock.profileClient.findFirst).toHaveBeenCalledWith(ownershipQuery('c1'))
    expect(prismaMock.profileClient.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.progressNote.create).toHaveBeenCalledWith({
      data: { clientId: 'c1', therapistId: 't1', reportId: null, content: T1_NOTE, isPrivate: true },
    })
    expect(prismaMock.progressReport.findFirst).not.toHaveBeenCalled() // no reportId supplied
  })

  it('creates a note for a session-linked client', async () => {
    const res = await postNote(noteBody({ clientId: 'c2' }), 't1-token')
    expect(res.status).toBe(201)
    expect(prismaMock.progressNote.create.mock.calls[0][0].data).toMatchObject({ clientId: 'c2', therapistId: 't1' })
  })

  it('keeps isPrivate defaulting to true and honours an explicit false', async () => {
    await postNote(noteBody(), 't1-token')
    await postNote(noteBody({ isPrivate: false }), 't1-token')
    expect(prismaMock.progressNote.create.mock.calls[0][0].data.isPrivate).toBe(true)
    expect(prismaMock.progressNote.create.mock.calls[1][0].data.isPrivate).toBe(false)
  })

  it("another therapist's client and a nonexistent client get identical 404s with no write", async () => {
    const other = await postNote(noteBody({ clientId: 'c3' }), 't1-token')
    const missing = await postNote(noteBody({ clientId: 'does-not-exist' }), 't1-token')
    expect(other.status).toBe(404)
    expect(missing.status).toBe(404)
    const otherBody = await other.json()
    expect(otherBody).toEqual({ error: 'Client not found' })
    expect(await missing.json()).toEqual(otherBody)
    expect(prismaMock.progressNote.create).not.toHaveBeenCalled()
  })

  it("accepts the therapist's own report for the same client", async () => {
    const res = await postNote(noteBody({ reportId: 'r1' }), 't1-token')
    expect(res.status).toBe(201)
    expect(prismaMock.progressReport.findFirst).toHaveBeenCalledWith({
      where: { id: 'r1', therapistId: 't1', clientId: 'c1' },
      select: { id: true },
    })
    expect(prismaMock.progressNote.create.mock.calls[0][0].data.reportId).toBe('r1')
  })

  it.each([
    ["another therapist's report", 'r3'],
    ['own report for a different client', 'r2'],
    ['nonexistent report (no foreign-key 500)', 'does-not-exist'],
  ])('rejects %s with 404 Report not found and no write', async (_label, reportId) => {
    const res = await postNote(noteBody({ reportId }), 't1-token')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Report not found' })
    expect(prismaMock.progressNote.create).not.toHaveBeenCalled()
  })

  it.each([
    ['a number', 123],
    ['an object', { text: 'x' }],
  ])('rejects non-string content (%s) with 400 before any lookup', async (_label, content) => {
    const res = await postNote(noteBody({ content }), 't1-token')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'content must be a string' })
    noDataWork()
  })

  it('keeps the existing required-field 400', async () => {
    const res = await postNote({ clientId: 'c1' }, 't1-token')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'clientId and content are required' })
    noDataWork()
  })

  it('a failed write is a generic 500; production logs contain no note content', async () => {
    prismaMock.progressNote.create.mockRejectedValue(
      new Prisma.PrismaClientValidationError(`Invalid invocation: { content: "${T1_NOTE}" }`, { clientVersion: '6.19.3' })
    )
    const res = await postNote(noteBody(), 't1-token')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('sleep routine')
  })
})

describe('reports POST', () => {
  it('creates a report for a directly assigned client from therapist-scoped metrics only', async () => {
    const res = await postReport(reportBody({ therapistId: 't2' }), 't1-token')
    expect(res.status).toBe(201)

    expect(prismaMock.profileClient.findFirst).toHaveBeenCalledWith(ownershipQuery('c1'))
    expect(prismaMock.profileClient.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.progressMetric.findMany).toHaveBeenCalledWith({
      where: {
        clientId: 'c1',
        therapistId: 't1',
        recordedAt: { gte: new Date('2026-03-01T00:00:00.000Z'), lte: new Date('2026-03-31T23:59:59.000Z') },
      },
    })
    expect(prismaMock.progressReport.create).toHaveBeenCalledWith({
      data: {
        clientId: 'c1',
        therapistId: 't1', // forged body therapistId ignored
        title: 'Progress Report',
        periodStart: new Date('2026-03-01T00:00:00.000Z'),
        periodEnd: new Date('2026-03-31T23:59:59.000Z'),
        summary: SUMMARY,
        status: 'DRAFT',
        // Only t1's in-period metric: not t2's ANXIETY_LEVEL 42, not the May reading.
        metricsSnapshot: { MOOD_SCORE: { average: 7, count: 1 } },
      },
    })
  })

  it('creates a report for a session-linked client', async () => {
    const res = await postReport(reportBody({ clientId: 'c2' }), 't1-token')
    expect(res.status).toBe(201)
    expect(prismaMock.progressReport.create.mock.calls[0][0].data).toMatchObject({ clientId: 'c2', therapistId: 't1' })
  })

  it('keeps title default and forced DRAFT/FINAL status', async () => {
    await postReport(reportBody({ status: 'FINAL', title: 'Term review' }), 't1-token')
    await postReport(reportBody({ status: 'PUBLISHED' }), 't1-token')
    expect(prismaMock.progressReport.create.mock.calls[0][0].data).toMatchObject({ status: 'FINAL', title: 'Term review' })
    expect(prismaMock.progressReport.create.mock.calls[1][0].data).toMatchObject({ status: 'DRAFT', title: 'Progress Report' })
  })

  it("another therapist's client and a nonexistent client get identical 404s, with no snapshot read or write", async () => {
    const other = await postReport(reportBody({ clientId: 'c3' }), 't1-token')
    const missing = await postReport(reportBody({ clientId: 'does-not-exist' }), 't1-token')
    expect(other.status).toBe(404)
    expect(missing.status).toBe(404)
    const otherBody = await other.json()
    expect(otherBody).toEqual({ error: 'Client not found' })
    expect(await missing.json()).toEqual(otherBody)
    expect(prismaMock.progressMetric.findMany).not.toHaveBeenCalled()
    expect(prismaMock.progressReport.create).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid periodStart', { periodStart: 'not-a-date' }, 'periodStart and periodEnd must be valid dates'],
    ['invalid periodEnd', { periodEnd: 'not-a-date' }, 'periodStart and periodEnd must be valid dates'],
    ['periodStart after periodEnd', { periodStart: '2026-04-01T00:00:00Z', periodEnd: '2026-03-01T00:00:00Z' }, 'periodStart must not be after periodEnd'],
  ])('%s is a 400 before any client, metric or report query', async (_label, overrides, error) => {
    const res = await postReport(reportBody(overrides), 't1-token')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error })
    noDataWork()
  })

  it('accepts periodStart equal to periodEnd', async () => {
    const res = await postReport(reportBody({ periodStart: '2026-03-05T00:00:00Z', periodEnd: '2026-03-05T00:00:00Z' }), 't1-token')
    expect(res.status).toBe(201)
  })

  it('keeps the existing required-field 400', async () => {
    const res = await postReport({ clientId: 'c1', periodStart: '2026-03-01' }, 't1-token')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'clientId, periodStart, periodEnd and summary are required' })
    noDataWork()
  })

  it('a failed write is a generic 500; production logs contain no summary or metric values', async () => {
    prismaMock.progressReport.create.mockRejectedValue(
      new Prisma.PrismaClientValidationError(
        `Invalid invocation: { summary: "${SUMMARY}", metricsSnapshot: { MOOD_SCORE: { average: 7.75 } } }`,
        { clientVersion: '6.19.3' }
      )
    )
    const res = await postReport(reportBody(), 't1-token')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/self-regulation|7\.75/)
  })
})

describe('reports GET', () => {
  it("returns only the therapist's own notes inside each report, even with a cross-therapist note present", async () => {
    const res = await getReports('c1', 't1-token')
    expect(res.status).toBe(200)
    const { reports: list } = await res.json()
    expect(list.map((r: any) => r.id)).toEqual(['r1'])
    expect(list[0].progressNotes.map((n: any) => n.id)).toEqual(['n1'])
    expect(JSON.stringify(list)).not.toContain(T2_INJECTED)

    expect(prismaMock.progressReport.findMany).toHaveBeenCalledWith({
      where: { clientId: 'c1', therapistId: 't1' },
      include: { progressNotes: { where: { therapistId: 't1', clientId: 'c1' } } },
      orderBy: { createdAt: 'desc' },
    })
  })
})

describe('request ID validation', () => {
  const malformed = [
    ['whitespace-only', '   '],
    ['number', 123],
    ['array', ['c1']],
    ['object (Prisma filter)', { startsWith: '' }],
  ] as const

  describe('notes POST', () => {
    it.each([
      ['missing', undefined],
      ['empty string', ''],
    ])('clientId %s keeps the existing required-field 400', async (_label, clientId) => {
      const res = await postNote(noteBody({ clientId }), 't1-token')
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'clientId and content are required' })
      noDataWork()
    })

    it.each(malformed)('clientId as %s is a 400 with no lookup or write', async (_label, clientId) => {
      const res = await postNote(noteBody({ clientId }), 't1-token')
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'clientId must be a non-empty string' })
      noDataWork()
    })

    it.each([['empty string', ''] as const, ...malformed])(
      'reportId as %s is a 400 with no lookup or write',
      async (_label, reportId) => {
        const res = await postNote(noteBody({ reportId }), 't1-token')
        expect(res.status).toBe(400)
        expect(await res.json()).toEqual({ error: 'reportId must be a non-empty string when provided' })
        noDataWork()
      }
    )

    it('a null reportId is treated as omitted (existing behaviour)', async () => {
      const res = await postNote(noteBody({ reportId: null }), 't1-token')
      expect(res.status).toBe(201)
      expect(prismaMock.progressReport.findFirst).not.toHaveBeenCalled()
      expect(prismaMock.progressNote.create.mock.calls[0][0].data.reportId).toBeNull()
    })
  })

  describe('reports POST', () => {
    it.each([
      ['missing', undefined],
      ['empty string', ''],
    ])('clientId %s keeps the existing required-field 400', async (_label, clientId) => {
      const res = await postReport(reportBody({ clientId }), 't1-token')
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'clientId, periodStart, periodEnd and summary are required' })
      noDataWork()
    })

    it.each(malformed)('clientId as %s is a 400 with no lookup, snapshot read or write', async (_label, clientId) => {
      const res = await postReport(reportBody({ clientId }), 't1-token')
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'clientId must be a non-empty string' })
      noDataWork()
    })
  })
})
