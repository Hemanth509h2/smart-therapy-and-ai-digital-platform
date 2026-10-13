import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/progress/notes, /api/progress/reports and /api/progress/metrics.
// The real routes and requireAuth / requireTherapist run; Firebase token
// verification and Prisma are faked (in-memory, honouring the where-clauses
// used, including the nested progressNotes filter). Synthetic data only; these
// mocked tests do not establish real database behaviour.

const verifyIdToken = vi.hoisted(() => vi.fn())
vi.mock('@/lib/firebaseAdmin', () => ({ adminAuth: () => ({ verifyIdToken }) }))

const db = vi.hoisted(() => ({ users: [] as any[], reports: [] as any[], notes: [] as any[], metrics: [] as any[] }))

function seed() {
  db.users = [
    { id: 'uid-t1', role: 'THERAPIST', therapist: { id: 't1', userId: 'uid-t1' } },
    { id: 'uid-t2', role: 'THERAPIST', therapist: { id: 't2', userId: 'uid-t2' } },
    { id: 'uid-t3', role: 'THERAPIST', therapist: null }, // no therapist profile
    { id: 'uid-c1', role: 'CLIENT', therapist: null },
    { id: 'uid-admin', role: 'ADMIN', therapist: null },
  ]
  db.reports = [
    { id: 'r1', therapistId: 't1', clientId: 'c1', summary: 'T1 report on c1' },
    { id: 'r2', therapistId: 't1', clientId: 'c2', summary: 'T1 report on c2' },
    { id: 'r3', therapistId: 't2', clientId: 'c1', summary: 'T2 report on shared client c1' },
  ]
  db.notes = [
    { id: 'n1', therapistId: 't1', clientId: 'c1', reportId: 'r1', content: 'T1 note on c1 (r1)' },
    { id: 'n4', therapistId: 't1', clientId: 'c1', reportId: null, content: 'T1 unlinked note on c1' },
    // Pre-existing bad rows linked to t1's report r1:
    { id: 'nX', therapistId: 't2', clientId: 'c1', reportId: 'r1', content: 'T2 cross-therapist note' },
    { id: 'nC', therapistId: 't1', clientId: 'c2', reportId: 'r1', content: 'T1 note about c2 linked to c1 report' },
    // t2's own note on its own report.
    { id: 'n3', therapistId: 't2', clientId: 'c1', reportId: 'r3', content: 'T2 private note' },
  ]
  db.metrics = [
    { id: 'm1', therapistId: 't1', clientId: 'c1', metricType: 'MOOD_SCORE', value: 7, recordedAt: new Date('2026-03-05T00:00:00Z') },
    { id: 'm5', therapistId: 't1', clientId: 'c1', metricType: 'FOCUS_SCORE', value: 5, recordedAt: new Date('2026-04-05T00:00:00Z') },
    { id: 'm2', therapistId: 't2', clientId: 'c1', metricType: 'MOOD_SCORE', value: 42, recordedAt: new Date('2026-03-06T00:00:00Z') },
  ]
}

function matches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (v instanceof Object && !(v instanceof Date) && ('gte' in v || 'lte' in v)) {
      return (!v.gte || row[k] >= v.gte) && (!v.lte || row[k] <= v.lte)
    }
    return row[k] === v
  })
}

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  progressNote: { findMany: vi.fn() },
  progressReport: { findMany: vi.fn() },
  progressMetric: { findMany: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ prisma: prismaMock }))

function installPrismaFakes() {
  prismaMock.user.findUnique.mockImplementation(async ({ where }: any) => db.users.find((u) => u.id === where.id) ?? null)
  prismaMock.progressNote.findMany.mockImplementation(async ({ where }: any) =>
    db.notes.filter((n) => matches(n, where)).map((n) => ({ ...n }))
  )
  prismaMock.progressReport.findMany.mockImplementation(async ({ where, include }: any) =>
    db.reports
      .filter((r) => matches(r, where))
      .map((r) => {
        const pn = include?.progressNotes
        const notes = db.notes.filter((n) => n.reportId === r.id && (pn === true || matches(n, pn?.where)))
        return { ...r, progressNotes: notes.map((n) => ({ ...n })) }
      })
  )
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

const get = (url: string, token?: string) =>
  new Request(`http://localhost${url}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })

let notes: typeof import('../progress/notes/route')
let reports: typeof import('../progress/reports/route')
let metrics: typeof import('../progress/metrics/route')
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
  notes = await import('../progress/notes/route')
  reports = await import('../progress/reports/route')
  metrics = await import('../progress/metrics/route')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const handlers = [
  ['notes GET', () => notes.GET, '/api/progress/notes?clientId=c1', 'Progress notes GET error'],
  ['reports GET', () => reports.GET, '/api/progress/reports?clientId=c1', 'Progress reports GET error'],
  ['metrics GET', () => metrics.GET, '/api/progress/metrics?clientId=c1', 'Progress metrics GET error'],
] as const

const noDataQueries = () => {
  expect(prismaMock.progressNote.findMany).not.toHaveBeenCalled()
  expect(prismaMock.progressReport.findMany).not.toHaveBeenCalled()
  expect(prismaMock.progressMetric.findMany).not.toHaveBeenCalled()
}

describe.each(handlers)('%s — authentication', (_name, handler, url, logLabel) => {
  it.each([
    ['missing token', undefined, 401],
    ['invalid token', 'forged-token', 401],
    ['CLIENT account', 'c1-token', 403],
    ['ADMIN account', 'admin-token', 403],
    ['THERAPIST without a profile', 't3-token', 403],
  ])('%s is rejected without running protected queries', async (_label, token, status) => {
    const res = await handler()(get(url, token))
    expect(res.status).toBe(status)
    const body = await res.json()
    expect(body).toHaveProperty('error')
    expect(JSON.stringify(body)).not.toMatch(/note|report on|MOOD_SCORE/i)
    noDataQueries()
  })

  it('an auth-helper database failure returns a generic JSON 500 through the safe logger', async () => {
    prismaMock.user.findUnique.mockRejectedValue(
      Object.assign(new Error("Can't reach database server at ep-x.neon.tech:5432 for user uid-t1"), {
        name: 'PrismaClientInitializationError',
      })
    )
    const res = await handler()(get(url, 't1-token'))
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ error: 'Internal server error' })

    // logError: "[label]" plus a summary without the message in production.
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError.mock.calls[0][0]).toBe(`[${logLabel}]`)
    expect(consoleError.mock.calls[0][1]).toEqual({ name: 'PrismaClientInitializationError' })
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/neon\.tech|uid-t1/)
    noDataQueries()
  })

  it('keeps the existing 400 for a missing clientId (after authentication)', async () => {
    const res = await handler()(get(url.split('?')[0], 't1-token'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'clientId is required' })
    noDataQueries()
  })
})

describe('notes GET — scoping', () => {
  it("returns only the therapist's own notes for the client", async () => {
    const res = await notes.GET(get('/api/progress/notes?clientId=c1', 't1-token'))
    const { notes: list } = await res.json()
    expect(list.map((n: any) => n.id).sort()).toEqual(['n1', 'n4'])
    expect(prismaMock.progressNote.findMany).toHaveBeenCalledWith({
      where: { clientId: 'c1', therapistId: 't1' },
      orderBy: { createdAt: 'desc' },
    })
  })

  it("keeps the therapist filter when a foreign therapist's reportId is supplied", async () => {
    const res = await notes.GET(get('/api/progress/notes?clientId=c1&reportId=r3', 't1-token'))
    expect((await res.json()).notes).toEqual([])
    expect(prismaMock.progressNote.findMany).toHaveBeenCalledWith({
      where: { clientId: 'c1', therapistId: 't1', reportId: 'r3' },
      orderBy: { createdAt: 'desc' },
    })
  })

  it("an own reportId excludes another therapist's note linked to it", async () => {
    const res = await notes.GET(get('/api/progress/notes?clientId=c1&reportId=r1', 't1-token'))
    const { notes: list } = await res.json()
    expect(list.map((n: any) => n.id)).toEqual(['n1'])
    expect(JSON.stringify(list)).not.toContain('cross-therapist')
  })
})

describe('reports GET — scoping', () => {
  it("returns only the therapist's reports, with nested notes limited to that therapist and client", async () => {
    const res = await reports.GET(get('/api/progress/reports?clientId=c1', 't1-token'))
    expect(res.status).toBe(200)
    const { reports: list } = await res.json()

    expect(list.map((r: any) => r.id)).toEqual(['r1']) // not t2's r3 on the shared client
    expect(list[0].progressNotes.map((n: any) => n.id)).toEqual(['n1']) // not nX (t2) or nC (other client)
    expect(JSON.stringify(list)).not.toMatch(/cross-therapist|about c2|T2 private/)

    expect(prismaMock.progressReport.findMany).toHaveBeenCalledWith({
      where: { clientId: 'c1', therapistId: 't1' },
      include: { progressNotes: { where: { therapistId: 't1', clientId: 'c1' } } },
      orderBy: { createdAt: 'desc' },
    })
  })

  it('preserves the response shape', async () => {
    const res = await reports.GET(get('/api/progress/reports?clientId=c1', 't1-token'))
    const body = await res.json()
    expect(Object.keys(body)).toEqual(['reports'])
    expect(body.reports[0]).toMatchObject({ id: 'r1', therapistId: 't1', clientId: 'c1', progressNotes: expect.any(Array) })
  })
})

describe('metrics GET — scoping', () => {
  it("returns only the therapist's metrics with the existing query", async () => {
    const res = await metrics.GET(get('/api/progress/metrics?clientId=c1', 't1-token'))
    const { metrics: list } = await res.json()
    expect(list.map((m: any) => m.id).sort()).toEqual(['m1', 'm5'])
    expect(JSON.stringify(list)).not.toContain('42')
    expect(prismaMock.progressMetric.findMany).toHaveBeenCalledWith({
      where: { clientId: 'c1', therapistId: 't1' },
      orderBy: { recordedAt: 'asc' },
    })
  })

  it('keeps the metricType and from/to filters alongside the therapist scope', async () => {
    const res = await metrics.GET(
      get('/api/progress/metrics?clientId=c1&metricType=MOOD_SCORE&from=2026-03-01T00:00:00Z&to=2026-03-31T00:00:00Z', 't1-token')
    )
    const { metrics: list } = await res.json()
    expect(list.map((m: any) => m.id)).toEqual(['m1'])
    expect(prismaMock.progressMetric.findMany).toHaveBeenCalledWith({
      where: {
        clientId: 'c1',
        therapistId: 't1',
        metricType: 'MOOD_SCORE',
        recordedAt: { gte: new Date('2026-03-01T00:00:00Z'), lte: new Date('2026-03-31T00:00:00Z') },
      },
      orderBy: { recordedAt: 'asc' },
    })
  })
})
