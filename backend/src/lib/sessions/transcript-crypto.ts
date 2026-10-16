import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

// Encrypts session transcripts at rest (AES-256-GCM) before they are stored in
// Firestore. HIPAA work, PR 1: this helper is NOT wired into the app yet —
// nothing imports it, so app behaviour is unchanged.
//
// Stored format: 'v1:<iv base64>:<authTag base64>:<ciphertext base64>'.
// Values without the 'v1:' prefix are treated as legacy plain text.
//
// Never log plaintext, ciphertext, or the key from this module.

const PREFIX = 'v1:'
const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12
const AUTH_TAG_BYTES = 16

// Messages are fixed strings: they must never contain the key or the text.
export class TranscriptCryptoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TranscriptCryptoError'
  }
}

export function isTranscriptEncryptionEnabled(): boolean {
  return process.env.TRANSCRIPT_ENCRYPTION_ENABLED === 'true'
}

export function isEncryptedText(value: string): boolean {
  return value.startsWith(PREFIX)
}

// Read lazily (not at import time) so a missing key can never crash startup.
function getKey(): Buffer {
  const raw = process.env.TRANSCRIPT_ENCRYPTION_KEY
  if (!raw) {
    throw new TranscriptCryptoError('TRANSCRIPT_ENCRYPTION_KEY is not set')
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new TranscriptCryptoError(
      `TRANSCRIPT_ENCRYPTION_KEY must be base64 that decodes to exactly ${KEY_BYTES} bytes`
    )
  }
  return key
}

export function encryptText(plain: string): string {
  const key = getKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`
}

export function decryptText(value: string): string {
  if (!isEncryptedText(value)) return value

  const key = getKey()
  const parts = value.slice(PREFIX.length).split(':')
  if (parts.length !== 3) {
    throw new TranscriptCryptoError('Encrypted transcript has an invalid format')
  }
  const [ivB64, tagB64, dataB64] = parts
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(tagB64, 'base64')
  const ciphertext = Buffer.from(dataB64, 'base64')
  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new TranscriptCryptoError('Encrypted transcript has an invalid format')
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES })
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    // Wrong key or tampered data. Don't wrap the original error: keep the message fixed.
    throw new TranscriptCryptoError('Failed to decrypt transcript (wrong key or data was tampered with)')
  }
}
