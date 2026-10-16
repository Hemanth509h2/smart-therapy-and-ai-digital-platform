import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'crypto'
import {
  TranscriptCryptoError,
  decryptText,
  encryptText,
  isEncryptedText,
  isTranscriptEncryptionEnabled,
} from '../transcript-crypto'

// Throwaway keys generated per run — never a real key.
const newKey = () => randomBytes(32).toString('base64')

const HINDI = 'नमस्ते, आज आप कैसा महसूस कर रहे हैं? 😊'
const NOTE = 'Disclosed bullying at school; sleep disturbance'

beforeEach(() => {
  vi.stubEnv('TRANSCRIPT_ENCRYPTION_KEY', newKey())
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('encryptText / decryptText round trip', () => {
  it.each([
    ['plain English', NOTE],
    ['an empty string', ''],
    ['Hindi/Unicode text', HINDI],
    ['a long text', 'Therapist: How was your week?\nClient: Okay.\n'.repeat(5000)],
  ])('returns the original for %s', (_label, text) => {
    expect(decryptText(encryptText(text))).toBe(text)
  })

  it('produces different output for the same text (random IV)', () => {
    expect(encryptText(NOTE)).not.toBe(encryptText(NOTE))
  })

  it('outputs the v1 format, detected by isEncryptedText', () => {
    const encrypted = encryptText(NOTE)
    expect(encrypted.startsWith('v1:')).toBe(true)
    expect(encrypted.split(':')).toHaveLength(4)
    expect(encrypted).not.toContain(NOTE)
    expect(isEncryptedText(encrypted)).toBe(true)
    expect(isEncryptedText(NOTE)).toBe(false)
  })
})

describe('decryptText with legacy plain text', () => {
  it('returns non-v1 text unchanged', () => {
    expect(decryptText(NOTE)).toBe(NOTE)
    expect(decryptText('')).toBe('')
    expect(decryptText(HINDI)).toBe(HINDI)
  })

  it('does not need a key for legacy text', () => {
    vi.stubEnv('TRANSCRIPT_ENCRYPTION_KEY', '')
    expect(decryptText(NOTE)).toBe(NOTE)
  })
})

describe('decryptText failures', () => {
  it('throws TranscriptCryptoError on tampered ciphertext', () => {
    const [prefix, iv, tag, data] = encryptText(NOTE).split(':')
    const bytes = Buffer.from(data, 'base64')
    bytes[0] ^= 0xff
    const tampered = [prefix, iv, tag, bytes.toString('base64')].join(':')
    expect(() => decryptText(tampered)).toThrow(TranscriptCryptoError)
  })

  it('throws TranscriptCryptoError on a tampered auth tag', () => {
    const [prefix, iv, tag, data] = encryptText(NOTE).split(':')
    const bytes = Buffer.from(tag, 'base64')
    bytes[0] ^= 0xff
    const tampered = [prefix, iv, bytes.toString('base64'), data].join(':')
    expect(() => decryptText(tampered)).toThrow(TranscriptCryptoError)
  })

  it('throws TranscriptCryptoError when decrypting with a different key', () => {
    const encrypted = encryptText(NOTE)
    vi.stubEnv('TRANSCRIPT_ENCRYPTION_KEY', newKey())
    expect(() => decryptText(encrypted)).toThrow(TranscriptCryptoError)
  })

  it.each([
    ['too few parts', 'v1:abc:def'],
    ['too many parts', 'v1:a:b:c:d'],
    ['bad IV length', 'v1:AAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA'],
  ])('throws TranscriptCryptoError on a malformed value (%s)', (_label, value) => {
    expect(() => decryptText(value)).toThrow(TranscriptCryptoError)
  })

  it('never includes the key or the text in the error message', () => {
    const key = process.env.TRANSCRIPT_ENCRYPTION_KEY!
    const encrypted = encryptText(NOTE)
    vi.stubEnv('TRANSCRIPT_ENCRYPTION_KEY', newKey())
    try {
      decryptText(encrypted)
      expect.unreachable()
    } catch (err) {
      const message = (err as Error).message
      expect(message).not.toContain(key)
      expect(message).not.toContain(NOTE)
      expect(message).not.toContain(encrypted)
    }
  })
})

describe('key validation', () => {
  it('throws TranscriptCryptoError when the key is missing', () => {
    vi.stubEnv('TRANSCRIPT_ENCRYPTION_KEY', undefined)
    expect(() => encryptText(NOTE)).toThrow(TranscriptCryptoError)
    expect(() => decryptText('v1:a:b:c')).toThrow(TranscriptCryptoError)
  })

  it('throws TranscriptCryptoError when the key is empty', () => {
    vi.stubEnv('TRANSCRIPT_ENCRYPTION_KEY', '')
    expect(() => encryptText(NOTE)).toThrow(TranscriptCryptoError)
  })

  it.each([16, 31, 33, 64])('throws TranscriptCryptoError for a %i-byte key', (bytes) => {
    const key = randomBytes(bytes).toString('base64')
    vi.stubEnv('TRANSCRIPT_ENCRYPTION_KEY', key)
    expect(() => encryptText(NOTE)).toThrow(TranscriptCryptoError)
    try {
      encryptText(NOTE)
    } catch (err) {
      expect((err as Error).message).not.toContain(key)
      expect((err as Error).message).not.toContain(NOTE)
    }
  })
})

describe('isTranscriptEncryptionEnabled', () => {
  it('is false by default', () => {
    vi.stubEnv('TRANSCRIPT_ENCRYPTION_ENABLED', undefined)
    expect(isTranscriptEncryptionEnabled()).toBe(false)
  })

  it('is true only when the env var is exactly "true"', () => {
    vi.stubEnv('TRANSCRIPT_ENCRYPTION_ENABLED', 'true')
    expect(isTranscriptEncryptionEnabled()).toBe(true)

    for (const value of ['false', 'TRUE', 'True', '1', 'yes', ' true', '']) {
      vi.stubEnv('TRANSCRIPT_ENCRYPTION_ENABLED', value)
      expect(isTranscriptEncryptionEnabled()).toBe(false)
    }
  })
})
