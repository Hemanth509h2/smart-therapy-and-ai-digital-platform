import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// /api/session-report access control (GET, POST, PATCH). The real requireAuth /
// requireTherapist helpers run; Firebase token verification, Prisma, the LLM
// report generator and Firestore stats are faked. All records are synthetic.

const verifyIdToken = vi.hoisted(() => vi.fn())
vi.mock('@/lib/firebaseAdmin', () => ({ adminAuth: () => ({ verifyIdToken }) }))

const generateSessionReport = vi.hoisted(() => vi.fn())
const getReportStats = vi.hoisted(() => vi.fn())
vi.mock('@/lib/report/generate', () => ({ generateSessionReport }))
vi.mock('@/lib/report/session-data', () => ({ getReportStats }))

const db = vi.hoisted(() => ({ users: [] as any[], sessions: [] as any[], reports: [] as any[], clients: [] as any[] }))

const OWN_HIDDEN = 'T1 hidden narrative: synthetic risk note'
const OWN_RELEASED = 'T1 released summary for parent'
const OTHER = 'T2 confidential narrative'

function seed() {
  db.users = [
    { id: 'uid-t1', role: 'THERAPIST', therapist: { id: 't1', userId: 'uid-t1' }, client: null },
    { id: 'uid-t2', role: 'THERAPIST', therapist: { id: 't2', userId: 'uid-t2' }, client: null },
    { id: 'uid-t3', role: 'THERAPIST', therapist: null, client: null }, // no therapist profile
    { id: 'uid-c1', role: 'CLIENT', therapist: null, client: { id: 'c1' } },
    { id: 'uid-c3', role: 'CLIENT', therapist: null, client: { id: 'c3' } },
    { id: 'uid-admin', role: 'ADMIN', therapist: null, client: null },
  ]
  db.clients = [
    { id: 'c1', firstName: 'Test', lastName: 'ChildOne', dateOfBirth: new Date('2016-01-01'), diagnosis: ['ADHD'] },
    { id: 'c3', firstName: 'Other', lastName: 'ChildThree', dateOfBirth: new Date('2015-01-01'), diagnosis: [] },
  ]
  db.sessions = [
    { id: 's1', therapistId: 't1', clientId: 'c1', createdAt: new Date('2026-01-01') },
    { id: 's2', therapistId: 't1', clientId: 'c1', createdAt: new Date('2026-02-01') },
    { id: 's3', therapistId: 't2', clientId: 'c3', createdAt: new Date('2026-03-01') },
    { id: 's4', therapistId: 't1', clientId: 'c1', createdAt: new Date('2026-04-01') }, // no report yet
  ]
  db.reports = [
    { id: 'r1', sessionId: 's1', therapistId: 't1', clientId: 'c1', content: OWN_HIDDEN, visibleToClient: false },
    { id: 'r2', sessionId: 's2', therapistId: 't1', clientId: 'c1', content: OWN_RELEASED, visibleToClient: true },
    { id: 'r3', sessionId: 's3', therapistId: 't2', clientId: 'c3', content: OTHER, visibleToClient: true },
  ]
}

// Where-clause matcher supporting the shapes the route uses, including the
// `session` relation filter on SessionReport.
function matches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (k === 'session') return matches(db.sessions.find((s) => s.id === row.sessionId), v)
    return row?.[k] === v
  })
}

const notFound = () =>
  new Prisma.PrismaClientKnownRequestError('Record to update not found.', { code: 'P2025', clientVersion: '6.19.3' })

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  session: { findFirst: vi.fn(), count: vi.fn() },
  sessionReport: { findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ prisma: prismaMock }))

function installPrismaFakes() {
  prismaMock.user.findUnique.mockImplementation(async ({ where }: any) => {
    const u = db.users.find((x) => x.id === where.id)
    return u ? { ...u } : null
  })
  prismaMock.session.findFirst.mockImplementation(async ({ where, include }: any) => {
    const s = db.sessions.find((x) => matches(x, where))
    if (!s) return null
    return include?.client ? { ...s, client: db.clients.find((c) => c.id === s.clientId) } : { ...s }
  })
  prismaMock.session.count.mockResolvedValue(1)
  prismaMock.sessionReport.findFirst.mockImplementation(async ({ where }: any) => {
    const r = db.reports.find((x) => matches(x, where))
    return r ? { ...r } : null
  })
  prismaMock.sessionReport.upsert.mockImplementation(async ({ where, create, update }: any) => {
    const existing = db.reports.find((r) => r.sessionId === where.sessionId)
    if (existing) return Object.assign(existing, update)
    const row = { id: `r-${create.sessionId}`, visibleToClient: false, ...create }
    db.reports.push(row)
    return { ...row }
  })
  prismaMock.sessionReport.update.mockImplementation(async ({ where, data }: any) => {
    const r = db.reports.find((x) => matches(x, where))
    if (!r) throw notFound()
    return { ...Object.assign(r, data) }
  })
}

const TOKENS: Record<string, string> = {
  't1-token': 'uid-t1',
  't3-token': 'uid-t3',
  'c1-token': 'uid-c1',
  'admin-token': 'uid-admin',
}

const headers = (token?: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
})
const getReq = (query: string, token?: string) =>
  new Request(`http://localhost/api/session-report${query}`, { headers: headers(token) }) as any
const bodyReq = (method: string, body: unknown, token?: string) =>
  new Request('http://localhost/api/session-report', { method, headers: headers(token), body: JSON.stringify(body) }) as any

let route: typeof import('../session-report/route')
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
  generateSessionReport.mockResolvedValue({ content: 'Generated synthetic report', model: 'test-model', stats: { words: 10 } })
  getReportStats.mockResolvedValue({ words: 42 })
  route = await import('../session-report/route')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const noReportDataTouched = () => {
  expect(prismaMock.sessionReport.findFirst).not.toHaveBeenCalled()
  expect(prismaMock.sessionReport.upsert).not.toHaveBeenCalled()
  expect(prismaMock.sessionReport.update).not.toHaveBeenCalled()
  expect(prismaMock.session.findFirst).not.toHaveBeenCalled()
  expect(generateSessionReport).not.toHaveBeenCalled()
  expect(getReportStats).not.toHaveBeenCalled()
}

const unchanged = (id: string, content: string) =>
  expect(db.reports.find((r) => r.id === id)!.content).toBe(content)

describe('authentication', () => {
  it.each([
    ['missing', undefined],
    ['invalid', 'forged-token'],
  ])('%s token is rejected on GET, POST and PATCH without touching report data', async (_label, token) => {
    const responses = [
      await route.GET(getReq('?sessionId=s1', token)),
      await route.POST(bodyReq('POST', { sessionId: 's1' }, token)),
      await route.PATCH(bodyReq('PATCH', { sessionId: 's1', content: 'overwrite' }, token)),
    ]
    for (const res of responses) {
      expect(res.status).toBe(401)
      expect(JSON.stringify(await res.json())).not.toContain(OWN_HIDDEN)
    }
    noReportDataTouched()
    unchanged('r1', OWN_HIDDEN)
  })
})

describe('owning therapist', () => {
  it('can read their report with stats', async () => {
    const res = await route.GET(getReq('?sessionId=s1', 't1-token'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.report.content).toBe(OWN_HIDDEN)
    expect(body.stats).toEqual({ words: 42 })
  })

  it('gets { report: null } for an own session with no report yet (existing contract)', async () => {
    const res = await route.GET(getReq('?sessionId=s4', 't1-token'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ report: null, stats: null })
  })

  it('can generate a report for their session', async () => {
    const res = await route.POST(bodyReq('POST', { sessionId: 's4' }, 't1-token'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.report).toMatchObject({ sessionId: 's4', therapistId: 't1', clientId: 'c1' })
    expect(body.stats).toEqual({ words: 10 })
    expect(generateSessionReport).toHaveBeenCalledWith('s4', expect.objectContaining({ name: 'Test ChildOne' }))
  })

  it('can save edits to their report', async () => {
    const res = await route.PATCH(bodyReq('PATCH', { sessionId: 's1', content: 'Edited by T1' }, 't1-token'))
    expect(res.status).toBe(200)
    expect((await res.json()).report).toMatchObject({ content: 'Edited by T1', editedByTherapist: true })
    unchanged('r1', 'Edited by T1')
  })
})

describe("another therapist's session (IDOR)", () => {
  it('GET returns the same empty response as a non-existent session and never loads stats', async () => {
    const other = await route.GET(getReq('?sessionId=s3&therapistId=t2', 't1-token'))
    const missing = await route.GET(getReq('?sessionId=does-not-exist', 't1-token'))

    expect(other.status).toBe(missing.status)
    const otherBody = await other.json()
    expect(otherBody).toEqual(await missing.json())
    expect(otherBody).toEqual({ report: null, stats: null })
    expect(getReportStats).not.toHaveBeenCalled()
  })

  it('POST is a 404 identical to a missing session; nothing is generated or written', async () => {
    const other = await route.POST(bodyReq('POST', { sessionId: 's3', therapistId: 't2' }, 't1-token'))
    const missing = await route.POST(bodyReq('POST', { sessionId: 'does-not-exist' }, 't1-token'))

    expect(other.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(await other.json()).toEqual(await missing.json())
    expect(generateSessionReport).not.toHaveBeenCalled()
    expect(prismaMock.sessionReport.upsert).not.toHaveBeenCalled()
    unchanged('r3', OTHER)
  })

  it('PATCH is a 404 identical to a missing report; the other report is unchanged', async () => {
    const other = await route.PATCH(
      bodyReq('PATCH', { sessionId: 's3', content: 'tampered', therapistId: 't2' }, 't1-token')
    )
    const missing = await route.PATCH(bodyReq('PATCH', { sessionId: 's4', content: 'x' }, 't1-token'))

    expect(other.status).toBe(404)
    expect(missing.status).toBe(404)
    const otherBody = await other.json()
    expect(otherBody).toEqual(await missing.json())
    expect(JSON.stringify(otherBody)).not.toContain(OTHER)
    unchanged('r3', OTHER)
  })
})

describe('client access (visibleToClient)', () => {
  it('cannot read their own report until it is released', async () => {
    const res = await route.GET(getReq('?sessionId=s1', 'c1-token'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ report: null, stats: null })
    expect(JSON.stringify(body)).not.toContain(OWN_HIDDEN)
    expect(getReportStats).not.toHaveBeenCalled()
  })

  it('can read their own report once visibleToClient is true', async () => {
    const res = await route.GET(getReq('?sessionId=s2', 'c1-token'))
    const body = await res.json()
    expect(body.report.content).toBe(OWN_RELEASED)
    expect(body.stats).toEqual({ words: 42 })
  })

  it("cannot read another client's released report", async () => {
    const res = await route.GET(getReq('?sessionId=s3', 'c1-token'))
    expect(await res.json()).toEqual({ report: null, stats: null })
  })

  it('cannot generate or edit reports', async () => {
    const post = await route.POST(bodyReq('POST', { sessionId: 's2' }, 'c1-token'))
    const patch = await route.PATCH(bodyReq('PATCH', { sessionId: 's2', content: 'parent edit' }, 'c1-token'))
    expect(post.status).toBe(403)
    expect(patch.status).toBe(403)
    expect(generateSessionReport).not.toHaveBeenCalled()
    expect(prismaMock.sessionReport.update).not.toHaveBeenCalled()
    unchanged('r2', OWN_RELEASED)
  })
})

describe('other roles', () => {
  it.each([
    ['ADMIN', 'admin-token'],
    ['THERAPIST without a profile', 't3-token'],
  ])('%s is refused on every method', async (_label, token) => {
    const responses = [
      await route.GET(getReq('?sessionId=s1', token)),
      await route.POST(bodyReq('POST', { sessionId: 's1' }, token)),
      await route.PATCH(bodyReq('PATCH', { sessionId: 's1', content: 'x' }, token)),
    ]
    for (const res of responses) {
      expect(res.status).toBe(403)
      expect(JSON.stringify(await res.json())).not.toContain(OWN_HIDDEN)
    }
    noReportDataTouched()
  })
})

describe('query scoping', () => {
  it('therapist GET filters by session ownership, not just sessionId', async () => {
    await route.GET(getReq('?sessionId=s3', 't1-token'))
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'uid-t1' } }))
    expect(prismaMock.sessionReport.findFirst).toHaveBeenCalledWith({
      where: { sessionId: 's3', session: { therapistId: 't1' } },
    })
  })

  it('client GET filters by their client profile and visibleToClient', async () => {
    await route.GET(getReq('?sessionId=s2', 'c1-token'))
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'uid-c1' } }))
    expect(prismaMock.sessionReport.findFirst).toHaveBeenCalledWith({
      where: { sessionId: 's2', visibleToClient: true, session: { clientId: 'c1' } },
    })
  })

  it('POST loads the session scoped to the verified therapist', async () => {
    await route.POST(bodyReq('POST', { sessionId: 's4' }, 't1-token'))
    expect(prismaMock.session.findFirst).toHaveBeenCalledWith({
      where: { id: 's4', therapistId: 't1' },
      include: { client: true },
    })
  })

  it('PATCH writes only through an ownership-scoped filter', async () => {
    await route.PATCH(bodyReq('PATCH', { sessionId: 's1', content: 'x' }, 't1-token'))
    expect(prismaMock.sessionReport.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionId: 's1', session: { therapistId: 't1' } } })
    )
  })
})

describe('validation and errors', () => {
  it('keeps the existing 400 validation responses for authenticated callers', async () => {
    const get = await route.GET(getReq('', 't1-token'))
    const post = await route.POST(bodyReq('POST', {}, 't1-token'))
    const patch = await route.PATCH(bodyReq('PATCH', { sessionId: 's1' }, 't1-token'))
    expect(get.status).toBe(400)
    expect(await get.json()).toEqual({ error: 'sessionId is required' })
    expect(post.status).toBe(400)
    expect(patch.status).toBe(400)
    expect(await patch.json()).toEqual({ error: 'sessionId and content are required' })
  })

  it('GET database failure is a generic 500', async () => {
    prismaMock.sessionReport.findFirst.mockRejectedValue(
      new Error(`Invalid invocation: content "${OWN_HIDDEN}" at ep-x.neon.tech`)
    )
    const res = await route.GET(getReq('?sessionId=s1', 't1-token'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/synthetic risk note|neon\.tech/)
  })

  it('POST generation failure keeps its fallback message and leaks nothing', async () => {
    generateSessionReport.mockRejectedValue(new Error('OpenRouter 400: prompt contained "Test ChildOne"'))
    const res = await route.POST(bodyReq('POST', { sessionId: 's4' }, 't1-token'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Report generation failed' })
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('ChildOne')
  })
})
