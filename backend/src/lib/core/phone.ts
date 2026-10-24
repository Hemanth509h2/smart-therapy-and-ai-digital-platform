import { PublicError } from '@/lib/http/apiError'

/** Normalize a phone number to E.164 format (e.g., +919876543210) */
export function normalizePhoneNumber(value: string): string {
  const compact = value.trim().replace(/^whatsapp:/i, '').replace(/[\s().-]/g, '')
  const withCountryCode = compact.startsWith('+')
    ? compact
    : compact.length === 10
      ? `+91${compact}`
      : `+${compact}`

  if (!/^\+[1-9]\d{7,14}$/.test(withCountryCode)) {
    throw new PublicError('Enter a valid phone number, including the country code (for example +91 98765 43210).', 400)
  }

  return withCountryCode
}
