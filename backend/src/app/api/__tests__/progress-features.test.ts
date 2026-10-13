import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

// GET /api/progress-features/measurement/[clientId] and .../reports/[clientId].
// The real route files, controllers, services, requireAuth / requireTherapist
// run; Firebase token verification, Prisma and jsPDF are faked. jsPDF is
// replaced by a recorder so the exact text placed into the PDF can be checked.
// All data is synthetic. These are mocked tests: they do not exercise a live
// database or Firebase project.

const verifyIdToken = vi.hoisted(() => vi.fn())
vi.mock('@/lib/firebaseAdmin', () => ({ adminAuth: () => ({ verifyIdToken }) }))

const pdf = vi.hoisted(() => ({ texts: [] as string[], constructed: 0 }))
vi.mock('jspdf', () => ({
  jsPDF: class {
    constructor() {
      pdf.constructed++
    }
    text(t: unknown) {
      pdf.texts.push(String(t))
    }
    setFontSize() {}
    setFont() {}
    addPage() {}
    output() {
      return new TextEncoder().encode('%PDF-synthetic').buffer
    }
  },
}))

const db = vi.hoisted(() => ({ users: [] as any[], clients: [] as any[], sessions: [] as any[], metrics: [] as any[] }))

const past = new Date('2026-03-10T10:00:00Z')
const past2 = new Date('2026-03-20T10:00:00Z')
const future = new Date(Date.now() + 14 * 24 * 3600 * 1000)

function seed() {
  db.users = [
    { id: 'uid-t1', role: 'THERAPIST', therapist: { id: 't1', userId: 'uid-t1' } },
    { id: 'uid-t2', role: 'THERAPIST', therapist: { id: 't2', userId: 'uid-t2' } },
    { id: 'uid-t3', role: 'THERAPIST', therapist: null }, // no therapist profile
    { id: 'uid-c1', role: 'CLIENT', therapist: null },
    { id: 'uid-admin', role: 'ADMIN', therapist: null },
  ]
  db.clients = [
    // Added directly by t1, but also seen by t2 (shared client).
    { id: 'c1', therapistId: 't1', firstName: 'Test', lastName: 'ChildOne' },
    // No direct owner; linked to t1 only through a session.
    { id: 'c2', therapistId: null, firstName: 'Test', lastName: 'ChildTwo' },
    // t2's client only.
    { id: 'c3', therapistId: 't2', firstName: 'Other', lastName: 'ChildThree' },
  ]
  db.sessions = [
    { id: 's1', clientId: 'c1', therapistId: 't1', status: 'COMPLETED', confirmedByPatient: true, scheduledAt: past, startedAt: past, endedAt: new Date(past.getTime() + 45 * 60000) },
    // t2's session with the shared client — must never reach t1.
    { id: 's2', clientId: 'c1', therapistId: 't2', status: 'CANCELLED', confirmedByPatient: false, scheduledAt: past2, startedAt: null, endedAt: null },
    { id: 's3', clientId: 'c2', therapistId: 't1', status: 'SCHEDULED', confirmedByPatient: false, scheduledAt: future, startedAt: null, endedAt: null },
    { id: 's4', clientId: 'c3', therapistId: 't2', status: 'COMPLETED', confirmedByPatient: true, scheduledAt: past, startedAt: null, endedAt: null },
  ]
  db.metrics = [
    { id: 'm1', clientId: 'c1', therapistId: 't1', metricType: 'MOOD_SCORE', value: 7, recordedAt: past },
    // t2's metric on the shared client — distinctive type and value.
    { id: 'm2', clientId: 'c1', therapistId: 't2', metricType: 'ANXIETY_LEVEL', value: 42, recordedAt: past2 },
  ]
}

// Where-clause evaluation for the shapes these endpoints use, including the
// ownership OR / relation filter, so a mis-scoped query returns the wrong rows.
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
  session: { findMany: vi.fn() },
  progressMetric: { findMany: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ prisma: prismaMock }))

function installPrismaFakes() {
  prismaMock.user.findUnique.mockImplementation(async ({ where }: any) => db.users.find((u) => u.id === where.id) ?? null)
  prismaMock.profileClient.findFirst.mockImplementation(async ({ where, select }: any) => {
    const c = db.clients.find((x) => matches(x, where))
    if (!c) return null
    return select ? Object.fromEntries(Object.keys(select).map((k) => [k, c[k]])) : { ...c }
  })
  prismaMock.session.findMany.mockImplementation(async ({ where }: any) =>
    db.sessions.filter((s) => matches(s, where)).map((s) => ({ ...s }))
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

const req = (token?: string) =>
  new Request('http://localhost/api/progress-features/x', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

type Handler = (r: Request, ctx: { params: { clientId: string } }) => Promise<Response>
let measurement: Handler
let report: Handler
let consoleError: ReturnType<typeof vi.spyOn>

const callMeasurement = (clientId: string, token?: string) => measurement(req(token), { params: { clientId } })
const callReport = (clientId: string, token?: string) => report(req(token), { params: { clientId } })

beforeEach(async () => {
  vi.stubEnv('AUTH_DISABLED', '')
  vi.stubEnv('NODE_ENV', 'production')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  seed()
  installPrismaFakes()
  pdf.texts = []
  pdf.constructed = 0
  verifyIdToken.mockImplementation(async (token: string) => {
    const uid = TOKENS[token]
    if (!uid) throw Object.assign(new Error('Decoding Firebase ID token failed.'), { code: 'auth/argument-error' })
    return { uid, email: `${uid}@example.test` }
  })
  measurement = (await import('../progress-features/measurement/[clientId]/route.js')).GET as unknown as Handler
  report = (await import('../progress-features/reports/[clientId]/route.js')).GET as unknown as Handler
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

/** No client data was read and no PDF was built. */
function expectNoSensitiveWork() {
  expect(prismaMock.session.findMany).not.toHaveBeenCalled()
  expect(prismaMock.progressMetric.findMany).not.toHaveBeenCalled()
  expect(pdf.constructed).toBe(0)
  expect(prismaMock.profileClient.findUnique).not.toHaveBeenCalled() // the old unscoped lookup
}

const endpoints = [
  ['measurement', callMeasurement],
  ['reports', callReport],
] as const

describe.each(endpoints)('%s — rejected callers', (_name, call) => {
  it.each([
    ['missing token', undefined, 401],
    ['invalid token', 'forged-token', 401],
    ['CLIENT account', 'c1-token', 403],
    ['ADMIN account', 'admin-token', 403],
    ['THERAPIST without a profile', 't3-token', 403],
  ])('%s is rejected with no client lookup, metrics, sessions or PDF', async (_label, token, status) => {
    const res = await call('c1', token)
    expect(res.status).toBe(status)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(JSON.stringify(await res.json())).not.toMatch(/ChildOne|MOOD_SCORE/)
    expect(prismaMock.profileClient.findFirst).not.toHaveBeenCalled()
    expectNoSensitiveWork()
  })

  it("another therapist's client and a nonexistent client get identical 404s, with no data work", async () => {
    const other = await call('c3', 't1-token')
    const missing = await call('does-not-exist', 't1-token')
    expect(other.status).toBe(404)
    expect(missing.status).toBe(404)
    const otherBody = await other.json()
    expect(otherBody).toEqual({ error: 'Client not found' })
    expect(await missing.json()).toEqual(otherBody)
    expectNoSensitiveWork()
  })

  it('runs the exact ownership query for the verified therapist', async () => {
    await call('c3', 't1-token')
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'uid-t1' } }))
    expect(prismaMock.profileClient.findFirst).toHaveBeenCalledWith({
      where: { id: 'c3', OR: [{ therapistId: 't1' }, { sessions: { some: { therapistId: 't1' } } }] },
      select: { id: true, firstName: true, lastName: true },
    })
  })
})

describe('measurement — authorized therapist', () => {
  it('returns metrics for a directly assigned client, scoped to the therapist (shared client)', async () => {
    const res = await callMeasurement('c1', 't1-token')
    expect(res.status).toBe(200)
    const { metrics } = await res.json()

    // Same response shape as before.
    expect(Object.keys(metrics).sort()).toEqual(
      ['averagePerformanceScore', 'attendancePercent', 'clientId', 'completedSessions', 'dueSessions', 'history', 'monthly', 'taskCompletionRate', 'totalSessions'].sort()
    )
    expect(metrics).toMatchObject({
      clientId: 'c1',
      totalSessions: 1, // t2's CANCELLED session excluded
      dueSessions: 1,
      completedSessions: 1,
      attendancePercent: 100,
      taskCompletionRate: 100,
      averagePerformanceScore: 7, // not the mean with t2's 42
    })
    expect(metrics.history).toEqual([{ date: past.toISOString(), metricType: 'MOOD_SCORE', value: 7 }])
    expect(metrics.monthly).toEqual([{ month: '2026-03', total: 1, completed: 1, confirmed: 1 }])
    expect(JSON.stringify(metrics)).not.toMatch(/ANXIETY_LEVEL|42/)
  })

  it('returns metrics for a session-linked client', async () => {
    const res = await callMeasurement('c2', 't1-token')
    expect(res.status).toBe(200)
    const { metrics } = await res.json()
    expect(metrics).toMatchObject({ clientId: 'c2', totalSessions: 1, dueSessions: 0, averagePerformanceScore: null })
  })

  it('scopes every session and metric query to the verified therapist', async () => {
    await callMeasurement('c1', 't1-token')
    expect(prismaMock.session.findMany).toHaveBeenCalledWith({ where: { clientId: 'c1', therapistId: 't1' }, orderBy: { scheduledAt: 'asc' } })
    expect(prismaMock.progressMetric.findMany).toHaveBeenCalledWith({ where: { clientId: 'c1', therapistId: 't1' }, orderBy: { recordedAt: 'asc' } })
    for (const [args] of [...prismaMock.session.findMany.mock.calls, ...prismaMock.progressMetric.findMany.mock.calls]) {
      expect(args.where.therapistId).toBe('t1')
    }
  })
})

describe('reports — authorized therapist', () => {
  it('builds the PDF from the therapist-scoped data only (shared client)', async () => {
    const res = await callReport('c1', 't1-token')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="progress-report-c1.pdf"')
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe('%PDF-synthetic')

    expect(pdf.constructed).toBe(1)
    const text = pdf.texts.join('\n')
    expect(text).toContain('Client: Test ChildOne')
    expect(text).toContain('Attendance: 100%  (1/1 due sessions completed)')
    expect(text).toContain('Average performance score: 7')
    expect(text).toContain('COMPLETED')
    expect(text).toContain('45m')
    // Nothing from t2's session or metric.
    expect(text).not.toContain('CANCELLED')
    expect(text).not.toContain('42')
    expect(text).not.toContain('24.5')
  })

  it('builds a PDF for a session-linked client', async () => {
    const res = await callReport('c2', 't1-token')
    expect(res.status).toBe(200)
    expect(pdf.texts.join('\n')).toContain('Client: Test ChildTwo')
  })

  it('scopes both PDF session queries and the metric query to the verified therapist', async () => {
    await callReport('c1', 't1-token')
    expect(prismaMock.session.findMany).toHaveBeenCalledWith({
      where: { clientId: 'c1', therapistId: 't1' },
      orderBy: { scheduledAt: 'desc' },
      take: 50,
    })
    expect(prismaMock.progressMetric.findMany).toHaveBeenCalledWith({ where: { clientId: 'c1', therapistId: 't1' }, orderBy: { recordedAt: 'asc' } })
    for (const [args] of prismaMock.session.findMany.mock.calls) expect(args.where.therapistId).toBe('t1')
  })
})

describe('errors', () => {
  const dbError = () => new Error('Invalid `prisma.session.findMany()` invocation: firstName "Test" lastName "ChildOne" value 7 at ep-x.neon.tech')

  it.each(endpoints)('%s: a database failure is a generic 500; logs carry no names or values', async (_name, call) => {
    prismaMock.session.findMany.mockRejectedValue(dbError())
    const res = await call('c1', 't1-token')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/ChildOne|neon\.tech|value 7/)
  })

  it('keeps the existing 400 for an empty clientId (after authentication)', async () => {
    const res = await callMeasurement('', 't1-token')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'clientId is required' })
  })

  it('getClientMetrics refuses to run without a therapist scope', async () => {
    const { getClientMetrics } = await import('@/progress_features/backend/measurement/measurementService.js')
    await expect(getClientMetrics(prismaMock, 'c1', undefined as any)).rejects.toThrow('therapistId scope')
    expect(prismaMock.session.findMany).not.toHaveBeenCalled()
  })
})

// The frontend has no component-test setup (no tracked vitest config or DOM
// library), so this is a static check of the three callers' source.
describe('frontend callers (static source check)', () => {
  const dir = path.resolve(process.cwd(), '../frontend/src/progress_features/frontend/components')
  it.each([
    ['MeasurementDashboard.jsx', '/api/progress-features/measurement/${clientId}'],
    ['ProgressCharts.jsx', '/api/progress-features/measurement/${clientId}'],
    ['ReportDownload.jsx', '/api/progress-features/reports/${clientId}'],
  ])('%s calls the API through apiFetch, not bare fetch', (file, url) => {
    const src = fs.readFileSync(path.join(dir, file), 'utf8')
    expect(src).toContain("import { apiFetch } from '@/lib/api';")
    expect(src).toContain('apiFetch(`' + url + '`)')
    expect(src).not.toMatch(/(^|[^\w.])fetch\(/m)
  })
})
