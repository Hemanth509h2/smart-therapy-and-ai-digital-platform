import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'crypto'

// The backend transcript readers (getSessionTranscript for the copilot/RAG,
// getReportInputs for reports) must return readable text for both encrypted
// ('v1:...') and legacy plain-text lines, and never crash on a line that
// cannot be decrypted. Firestore is faked; keys are generated per run.

const sessionDoc = vi.hoisted(() => ({ exists: true, data: {} as Record<string, unknown> }))
vi.mock('@/lib/core/firebaseAdmin', () => ({
  adminDb: () => ({
    collection: () => ({
      doc: () => ({ get: async () => ({ exists: sessionDoc.exists, data: () => sessionDoc.data }) }),
    }),
  }),
}))

import { getSessionTranscript } from '@/lib/ai/rag/transcript-store'
import { getReportInputs } from '@/lib/ai/report/session-data'
import { encryptText } from '../transcript-crypto'

const PLAIN = 'legacy plain-text line from before encryption'
const SECRET = 'synthetic utterance about feeling worried at school'
const HINDI = 'मुझे स्कूल में डर लगता है'

const line = (text: string, minute = 1) => ({
  text,
  speaker: 'client',
  timestamp: 1_760_000_000_000 + minute,
  sessionMinute: minute,
})

const readers = [
  ['getSessionTranscript', (id: string) => getSessionTranscript(id)],
  ['getReportInputs', async (id: string) => (await getReportInputs(id)).transcript],
] as const

let consoleWarn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.stubEnv('TRANSCRIPT_ENCRYPTION_KEY', randomBytes(32).toString('base64'))
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  sessionDoc.exists = true
  sessionDoc.data = {}
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe.each(readers)('%s', (_name, read) => {
  it('decrypts encrypted lines and leaves legacy plain text unchanged', async () => {
    sessionDoc.data = { transcript: [line(PLAIN, 1), line(encryptText(SECRET), 2), line(encryptText(HINDI), 3)] }
    expect(await read('s1')).toEqual([line(PLAIN, 1), line(SECRET, 2), line(HINDI, 3)])
    expect(consoleWarn).not.toHaveBeenCalled()
  })

  it('returns an all-legacy transcript exactly as stored', async () => {
    sessionDoc.data = { transcript: [line(PLAIN, 1), line('another old line', 2)] }
    expect(await read('s1')).toEqual([line(PLAIN, 1), line('another old line', 2)])
  })

  it('skips a line encrypted with a different key and warns without the text', async () => {
    const foreign = encryptText(SECRET)
    vi.stubEnv('TRANSCRIPT_ENCRYPTION_KEY', randomBytes(32).toString('base64'))
    sessionDoc.data = { transcript: [line(PLAIN, 1), line(foreign, 2)] }

    expect(await read('s1')).toEqual([line(PLAIN, 1)])
    expect(consoleWarn).toHaveBeenCalledOnce()
    const logged = JSON.stringify(consoleWarn.mock.calls)
    expect(logged).not.toContain(SECRET)
    expect(logged).not.toContain(foreign)
  })

  it('skips encrypted lines (no crash) when the key is missing', async () => {
    const encrypted = encryptText(SECRET)
    vi.stubEnv('TRANSCRIPT_ENCRYPTION_KEY', '')
    sessionDoc.data = { transcript: [line(encrypted, 1), line(PLAIN, 2)] }
    expect(await read('s1')).toEqual([line(PLAIN, 2)])
  })

  it('skips a tampered line', async () => {
    const parts = encryptText(SECRET).split(':')
    const data = Buffer.from(parts[3], 'base64')
    data[0] ^= 0xff
    parts[3] = data.toString('base64')
    sessionDoc.data = { transcript: [line(parts.join(':'), 1)] }
    expect(await read('s1')).toEqual([])
  })

  it('returns an empty list when there is no transcript', async () => {
    sessionDoc.data = {}
    expect(await read('s1')).toEqual([])
  })
})

it('getSessionTranscript returns [] for a missing session doc', async () => {
  sessionDoc.exists = false
  expect(await getSessionTranscript('missing')).toEqual([])
})
