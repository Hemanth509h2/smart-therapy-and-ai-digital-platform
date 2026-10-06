import { describe, expect, it } from 'vitest'
import { normalizeWhatsAppAddress } from '../twilio-whatsapp'

describe('normalizeWhatsAppAddress', () => {
  it('preserves an E.164 number', () => {
    expect(normalizeWhatsAppAddress('+919876543210')).toBe('whatsapp:+919876543210')
  })

  it('adds the Indian country code to a ten-digit local number', () => {
    expect(normalizeWhatsAppAddress('98765 43210')).toBe('whatsapp:+919876543210')
  })

  it('accepts an existing WhatsApp prefix', () => {
    expect(normalizeWhatsAppAddress('whatsapp:+1 (415) 555-2671')).toBe(
      'whatsapp:+14155552671'
    )
  })

  it('rejects malformed numbers', () => {
    expect(() => normalizeWhatsAppAddress('123')).toThrow('valid WhatsApp number')
  })
})
