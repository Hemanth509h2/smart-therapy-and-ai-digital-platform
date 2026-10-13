import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/clients access control. The real requireAuth / requireTherapist
// helpers run; only Firebase token verification and Prisma are faked. All
// records are synthetic.

const verifyIdToken = vi.hoisted(() => vi.fn())
vi.mock('@/lib/firebaseAdmin', () => ({ adminAuth: () => ({ verifyIdToken }) }))

const future = new Date(Date.now() + 7 * 24 * 3600 * 1000)
const past = new Date(Date.now() - 7 * 24 * 3600 * 1000)

const db = vi.hoisted(() => ({
  users: [] as any[],
  clients: [] as any[],
  sessions: [] as any[],
}))

function seed() {
  db.users = [
    { id: 'uid-t1', email: 't1@example.test', role: 'THERAPIST', therapist: { id: 't1', userId: 'uid-t1' } },
    { id: 'uid-t2', email: 't2@example.test', role: 'THERAPIST', therapist: { id: 't2', userId: 'uid-t2' } },
    { id: 'uid-t3', email: 't3@example.test', role: 'THERAPIST', therapist: null }, // no profile yet
    { id: 'uid-admin', email: 'admin@example.test', role: 'ADMIN', therapist: null },
    { id: 'uid-client', email: 'parent@example.test', role: 'CLIENT', therapist: null },
    { id: 'uid-c1', email: 'c1@example.test', role: 'CLIENT', therapist: null },
    { id: 'uid-c2', email: 'c2@example.test', role: 'CLIENT', therapist: null },
    { id: 'uid-c3', email: 'c3@example.test', role: 'CLIENT', therapist: null },
  ]
  db.clients = [
    // Added directly by t1.
    { id: 'c1', userId: 'uid-c1', firstName: 'Test', lastName: 'ChildOne', diagnosis: ['ADHD'], therapistId: 't1' },
    // No direct owner; linked to t1 through a session (invite flow).
    { id: 'c2', userId: 'uid-c2', firstName: 'Test', lastName: 'ChildTwo', diagnosis: [], therapistId: null },
    // Belongs to t2 only.
    { id: 'c3', userId: 'uid-c3', firstName: 'Other', lastName: 'TherapistsChild', diagnosis: ['Anxiety'], therapistId: 't2' },
  ]
  db.sessions = [
    { id: 's1', therapistId: 't1', clientId: 'c2', status: 'SCHEDULED', scheduledAt: future },
    { id: 's2', therapistId: 't1', clientId: 'c1', status: 'COMPLETED', scheduledAt: past },
    { id: 's3', therapistId: 't2', clientId: 'c3', status: 'COMPLETED', scheduledAt: past },
  ]
}

// Minimal in-memory Prisma that honours the `where` shapes the route uses, so a
// mis-scoped query would return the wrong rows rather than pass silently.
function matches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) =>
    k === 'OR'
      ? (v as any[]).some((w) => matches(row, w))
      : v && typeof v === 'object' && 'in' in v
        ? v.in.includes(row[k])
        : row[k] === v
  )
}

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  session: { findMany: vi.fn() },
  profileClient: { findMany: vi.fn() },
  profileTherapist: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ prisma: prismaMock }))

function installPrismaFakes() {
  prismaMock.user.findUnique.mockImplementation(async ({ where }: any) => {
    const u = db.users.find((x) => x.id === where.id)
    return u ? { ...u } : null
  })
  prismaMock.session.findMany.mockImplementation(async ({ where, distinct }: any) => {
    let rows = db.sessions.filter((s) => matches(s, where))
    if (distinct) rows = rows.filter((s, i) => rows.findIndex((r) => r.clientId === s.clientId) === i)
    return rows.map((s) => ({ ...s }))
  })
  prismaMock.profileClient.findMany.mockImplementation(async ({ where, include, select }: any) => {
    const rows = db.clients.filter((c) => matches(c, where))
    if (select) return rows.map((c) => ({ id: c.id }))
    return rows.map((c) => {
      if (!include?.user) return { ...c }
      const user = db.users.find((u) => u.id === c.userId)
      // Mirror Prisma: `user: true` returns the whole row, a select only those fields.
      const projected = include.user === true ? { ...user, therapist: undefined } : { email: user.email }
      return { ...c, user: projected }
    })
  })
}

const TOKENS: Record<string, string> = {
  't1-token': 'uid-t1',
  't3-token': 'uid-t3',
  'admin-token': 'uid-admin',
  'client-token': 'uid-client',
}

const get = (query = '', token?: string) =>
  new Request(`http://localhost/api/clients${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

let GET: (req: Request) => Promise<Response>

beforeEach(async () => {
  vi.stubEnv('AUTH_DISABLED', '')
  vi.stubEnv('NODE_ENV', 'production')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  seed()
  installPrismaFakes()
  verifyIdToken.mockImplementation(async (token: string) => {
    const uid = TOKENS[token]
    if (!uid) throw Object.assign(new Error('Decoding Firebase ID token failed.'), { code: 'auth/argument-error' })
    return { uid, email: `${uid}@example.test` }
  })
  ;({ GET } = await import('../clients/route'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const noClientDataQueried = () => {
  expect(prismaMock.profileClient.findMany).not.toHaveBeenCalled()
  expect(prismaMock.session.findMany).not.toHaveBeenCalled()
}

describe('GET /api/clients — authentication', () => {
  it('rejects a request with no Authorization header', async () => {
    const res = await GET(get('?therapistId=t1'))
    expect(res.status).toBe(401)
    expect(await res.json()).not.toHaveProperty('clients')
    expect(verifyIdToken).not.toHaveBeenCalled()
    noClientDataQueried()
  })

  it('rejects an invalid token', async () => {
    const res = await GET(get('?therapistId=t1', 'forged-token'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid or expired authentication token' })
    noClientDataQueried()
  })

  it('no longer returns every client to an unauthenticated caller without therapistId', async () => {
    const res = await GET(get())
    expect(res.status).toBe(401)
    expect(JSON.stringify(await res.json())).not.toMatch(/ChildOne|ChildTwo|TherapistsChild/)
    noClientDataQueried()
  })
})

describe('GET /api/clients — ownership', () => {
  it("returns the therapist's direct and session-linked clients, and nobody else's", async () => {
    const res = await GET(get('?therapistId=t1', 't1-token'))
    expect(res.status).toBe(200)
    const { clients } = await res.json()

    expect(clients.map((c: any) => c.id).sort()).toEqual(['c1', 'c2'])
    expect(JSON.stringify(clients)).not.toContain('TherapistsChild')

    const c2 = clients.find((c: any) => c.id === 'c2')
    expect(c2.sessionCount).toBe(1)
    expect(c2.nextSession).toEqual({ id: 's1', scheduledAt: future.toISOString() })
    const c1 = clients.find((c: any) => c.id === 'c1')
    expect(c1.lastSession).toBe(past.toISOString())
  })

  it('returns only user.email from the related User record', async () => {
    const { clients } = await (await GET(get('', 't1-token'))).json()
    for (const c of clients) expect(c.user).toEqual({ email: expect.any(String) })
  })

  it("rejects a therapistId belonging to another therapist and queries none of their data", async () => {
    const res = await GET(get('?therapistId=t2', 't1-token'))
    expect(res.status).toBe(403)
    const raw = JSON.stringify(await res.json())
    expect(raw).not.toMatch(/c3|TherapistsChild/)
    noClientDataQueried()
  })

  it.each([
    ['omitted', ''],
    ['empty (progress page before profile loads)', '?therapistId='],
  ])('therapistId %s returns only the authenticated therapist’s clients', async (_label, query) => {
    const res = await GET(get(query, 't1-token'))
    expect(res.status).toBe(200)
    const { clients } = await res.json()
    expect(clients.map((c: any) => c.id).sort()).toEqual(['c1', 'c2'])
  })

  it('scopes every database query to the verified therapist', async () => {
    await GET(get('', 't1-token'))

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'uid-t1' } })
    )
    for (const [args] of prismaMock.session.findMany.mock.calls) {
      expect(args.where.therapistId).toBe('t1')
    }
    const clientCalls = prismaMock.profileClient.findMany.mock.calls.map(([args]) => args)
    // Never an unfiltered findMany (the old return-all fallback).
    for (const args of clientCalls) expect(args.where).toBeTruthy()
    // Direct clients OR session-linked ones, in a single query scoped to t1.
    expect(clientCalls).toHaveLength(1)
    expect(clientCalls[0]).toEqual({
      where: { OR: [{ therapistId: 't1' }, { id: { in: expect.arrayContaining(['c1', 'c2']) } }] },
      include: { user: { select: { email: true } } },
    })
    const inIds = clientCalls[0].where.OR[1].id.in
    expect(inIds).not.toContain('c3')
  })
})

describe('GET /api/clients — non-therapist accounts', () => {
  it.each([
    ['CLIENT', 'client-token'],
    ['ADMIN', 'admin-token'],
    ['THERAPIST without a therapist profile', 't3-token'],
  ])('%s is refused', async (_label, token) => {
    const res = await GET(get('?therapistId=t1', token))
    expect(res.status).toBe(403)
    expect(await res.json()).not.toHaveProperty('clients')
    noClientDataQueried()
  })
})

describe('GET /api/clients — errors', () => {
  it('a database failure returns a generic 500 with no patient or internal details', async () => {
    prismaMock.profileClient.findMany.mockRejectedValue(
      new Error('Invalid `prisma.profileClient.findMany()` invocation: firstName "Test" lastName "ChildOne" at ep-x.neon.tech')
    )
    const res = await GET(get('', 't1-token'))
    const raw = JSON.stringify(await res.json())

    expect(res.status).toBe(500)
    expect(raw).toBe(JSON.stringify({ error: 'Internal server error' }))
    expect(JSON.stringify((console.error as any).mock.calls)).not.toMatch(/ChildOne|neon\.tech/)
  })

  it('a failure while resolving the therapist also returns a generic 500', async () => {
    prismaMock.user.findUnique.mockRejectedValue(new Error("Can't reach database server at ep-x.neon.tech:5432"))
    const res = await GET(get('', 't1-token'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
    noClientDataQueried()
  })
})
