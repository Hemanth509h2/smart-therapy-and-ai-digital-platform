import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// Route-level checks that real handlers no longer echo exception details.
// Prisma and auth are mocked; no database or Firebase access happens here.

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  sessionReport: { update: vi.fn() },
  profileTherapist: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}))

vi.mock('@/lib/core/db', () => ({ prisma: prismaMock }))
vi.mock('@/lib/http/apiAuth', () => ({
  requireAuth: vi.fn(async () => ({ ok: true, uid: 'therapist-uid', email: null })),
}))
// Imported transitively by session-report; irrelevant to PATCH.
vi.mock('@/lib/ai/report/generate', () => ({ generateSessionReport: vi.fn() }))
vi.mock('@/lib/ai/report/session-data', () => ({ getReportStats: vi.fn() }))

const REPORT_TEXT = 'Child disclosed self-harm thoughts during session 4'

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  // session-report requires a therapist (requireTherapist looks the user up).
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'therapist-uid',
    role: 'THERAPIST',
    therapist: { id: 't1', userId: 'therapist-uid' },
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const jsonRequest = (method: string, body: unknown) =>
  new Request('http://localhost/api/x', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('PATCH /api/session-report', () => {
  it('does not return or log clinical report content when the database write fails', async () => {
    prismaMock.sessionReport.update.mockRejectedValue(
      new Prisma.PrismaClientValidationError(
        `Invalid \`prisma.sessionReport.update()\` invocation:\n{ data: { content: "${REPORT_TEXT}" } }`,
        { clientVersion: '6.19.3' }
      )
    )
    const { PATCH } = await import('../session-report/route')

    const res = await PATCH(jsonRequest('PATCH', { sessionId: 's1', content: REPORT_TEXT }) as any)
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body).toEqual({ error: 'Save failed' })
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(REPORT_TEXT)
  })

  it('returns 404 when the report does not exist', async () => {
    prismaMock.sessionReport.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
        code: 'P2025',
        clientVersion: '6.19.3',
      })
    )
    const { PATCH } = await import('../session-report/route')

    const res = await PATCH(jsonRequest('PATCH', { sessionId: 'missing', content: 'x' }) as any)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
  })

  it('keeps the existing validation response', async () => {
    const { PATCH } = await import('../session-report/route')
    const res = await PATCH(jsonRequest('PATCH', { sessionId: 's1' }) as any)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'sessionId and content are required' })
  })
})

describe('POST /api/clients', () => {
  beforeEach(() => {
    prismaMock.profileTherapist.findUnique.mockResolvedValue({ userId: 'therapist-uid' })
  })

  it('returns the phone-number validation message as a 400', async () => {
    prismaMock.$transaction.mockImplementation(async (fn: any) =>
      fn({
        user: { create: vi.fn(async () => ({ id: 'client:1' })) },
        profileClient: { create: vi.fn() },
      })
    )
    const { POST } = await import('../clients/route')

    const res = await POST(
      jsonRequest('POST', { therapistId: 't1', firstName: 'Aarav', phoneNumber: '123' })
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Enter a valid phone number with country code' })
  })

  it('returns a generic 500 without the patient values Prisma embeds in its error', async () => {
    prismaMock.$transaction.mockRejectedValue(
      new Prisma.PrismaClientValidationError(
        'Invalid `tx.profileClient.create()` invocation: { firstName: "Aarav", diagnosis: ["ADHD"] }',
        { clientVersion: '6.19.3' }
      )
    )
    const { POST } = await import('../clients/route')

    const res = await POST(jsonRequest('POST', { therapistId: 't1', firstName: 'Aarav' }))
    const raw = JSON.stringify(await res.json())

    expect(res.status).toBe(500)
    expect(raw).not.toMatch(/Aarav|ADHD|profileClient/)
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/Aarav|ADHD/)
  })
})
