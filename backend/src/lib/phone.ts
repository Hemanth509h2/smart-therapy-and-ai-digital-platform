import { PublicError } from '@/lib/apiError'

/** Normalize a phone number to E.164 format (e.g., +919876543210) */
export function normalizePhoneNumber(value: string): string {
  const compact = value.trim().replace(/^whatsapp:/i, '').replace(/[\s().-]/g, '')
  const withCountryCode = compact.startsWith('+')
    ? compact
    : compact.length === 10
      ? `+91${compact}`
      : `+${compact}`

  if (!/^\+[1-9]\d{7,14}$/.test(withCountryCode)) {
    throw new PublicError('Enter a valid phone number with country code', 400)
  }

  return withCountryCode
}
