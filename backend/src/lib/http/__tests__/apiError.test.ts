import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { PublicError, errorResponse, logError, safeErrorSummary } from '../apiError'

// Shaped like the real thing: Prisma validation errors print the failing query,
// including argument values such as a child's name and clinical notes.
const PATIENT_NAME = 'Aarav Sharma'
const NOTE = 'Disclosed bullying at school; sleep disturbance'
const validationError = () =>
  new Prisma.PrismaClientValidationError(
    `Invalid \`prisma.progressNote.create()\` invocation:\n{ data: { content: "${NOTE}", client: "${PATIENT_NAME}" } }\nArgument \`clientId\` is missing.`,
    { clientVersion: '6.19.3' }
  )

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const loggedText = () => JSON.stringify(consoleError.mock.calls)

describe('errorResponse in production', () => {
  beforeEach(() => vi.stubEnv('NODE_ENV', 'production'))

  it('returns a generic 500 without the exception message or stack', async () => {
    const res = errorResponse(validationError(), 'Progress notes POST')
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body).toEqual({ error: 'Internal server error' })
    const raw = JSON.stringify(body)
    expect(raw).not.toContain(PATIENT_NAME)
    expect(raw).not.toContain(NOTE)
    expect(raw).not.toContain('prisma')
  })

  it('does not pass patient values or stacks to the log', () => {
    errorResponse(validationError(), 'Progress notes POST')

    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError.mock.calls[0][0]).toBe('[Progress notes POST]')
    expect(loggedText()).toContain('PrismaClientValidationError')
    expect(loggedText()).not.toContain(PATIENT_NAME)
    expect(loggedText()).not.toContain(NOTE)
    expect(loggedText()).not.toContain('stack')
  })

  it('hides provider/infrastructure details such as hosts and env var names', async () => {
    const err = new Error(
      "Can't reach database server at `ep-cool-db.neon.tech:5432` (OPENROUTER_API_KEY is not set in .env)"
    )
    const body = await errorResponse(err, 'x').json()
    expect(JSON.stringify(body)).not.toMatch(/neon\.tech|OPENROUTER_API_KEY/)
    expect(loggedText()).not.toMatch(/neon\.tech|OPENROUTER_API_KEY/)
  })

  it('uses the route-specific fallback message when given', async () => {
    const body = await errorResponse(new Error('smtp 535 user@x'), 'support', 'Failed to send ticket').json()
    expect(body).toEqual({ error: 'Failed to send ticket' })
  })

  it('keeps PublicError messages and statuses intact without logging them as failures', async () => {
    const res = errorResponse(new PublicError('Enter a valid WhatsApp number with country code', 400), 'clients POST')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Enter a valid WhatsApp number with country code' })
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('maps known Prisma codes to 404/409 with generic messages and schema-only log metadata', async () => {
    const notFound = new Prisma.PrismaClientKnownRequestError(
      `Record to update not found. ${PATIENT_NAME}`,
      { code: 'P2025', clientVersion: '6.19.3', meta: { modelName: 'SessionReport' } }
    )
    const res = errorResponse(notFound, 'session-report save')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
    expect(consoleError.mock.calls[0][1]).toEqual({
      name: 'PrismaClientKnownRequestError',
      code: 'P2025',
      modelName: 'SessionReport',
    })

    const conflict = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '6.19.3',
      meta: { target: ['email'] },
    })
    const res2 = errorResponse(conflict, 'x')
    expect(res2.status).toBe(409)
    expect(await res2.json()).toEqual({ error: 'Conflict' })
  })

  it('treats malformed JSON bodies as 400 without echoing the body', async () => {
    let parseError: unknown
    try {
      await new Request('http://x', { method: 'POST', body: `{"firstName": "${PATIENT_NAME}"` }).json()
    } catch (e) {
      parseError = e
    }
    const res = errorResponse(parseError, 'clients POST')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid request body' })
  })

  it('returns a generic 500 for non-Error throwables', async () => {
    const res = errorResponse({ token: 'secret-token' }, 'x')
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret-token')
    expect(loggedText()).not.toContain('secret-token')
  })
})

describe('errorResponse outside production', () => {
  beforeEach(() => vi.stubEnv('NODE_ENV', 'development'))

  it('adds the original message as `detail` and logs message + stack for debugging', async () => {
    const res = errorResponse(new Error('column "foo" does not exist'), 'dev')
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.error).toBe('Internal server error')
    expect(body.detail).toBe('column "foo" does not exist')
    expect(body).not.toHaveProperty('stack')
    expect(consoleError.mock.calls[0][1]).toMatchObject({
      message: 'column "foo" does not exist',
      stack: expect.any(String),
    })
  })
})

describe('safeErrorSummary / logError', () => {
  it('never includes Prisma meta values beyond schema names', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const err = new Prisma.PrismaClientKnownRequestError('x', {
      code: 'P2003',
      clientVersion: '6.19.3',
      meta: { field_name: 'clientId', cause: `client ${PATIENT_NAME}` },
    })
    expect(safeErrorSummary(err)).toEqual({
      name: 'PrismaClientKnownRequestError',
      code: 'P2003',
      field_name: 'clientId',
    })
    logError('ctx', err)
    expect(loggedText()).not.toContain(PATIENT_NAME)
  })
})
