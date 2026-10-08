/**
 * Meta WhatsApp Cloud API Integration
 * 
 * Uses the official WhatsApp Business Platform (Cloud API)
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 * 
 * Required Environment Variables:
 * - WHATSAPP_ACCESS_TOKEN: Permanent or temporary access token from Meta
 * - WHATSAPP_PHONE_NUMBER_ID: Phone number ID from Meta Business Manager
 * - WHATSAPP_BUSINESS_ACCOUNT_ID: Business account ID (optional, for webhooks)
 * - WHATSAPP_APP_ID: App ID (optional, for token refresh)
 * - WHATSAPP_APP_SECRET: App Secret (optional, for token refresh)
 */

const GRAPH_API_BASE = 'https://graph.facebook.com/v20.0'

export interface WhatsAppMessageResult {
  id: string
  status: string
  to: string
}

export interface CloudApiConfig {
  accessToken: string
  phoneNumberId: string
}

function getCloudApiConfig(): CloudApiConfig {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID

  if (!accessToken || !phoneNumberId) {
    throw new Error(
      'WhatsApp Cloud API not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID'
    )
  }

  return { accessToken, phoneNumberId }
}

/** Normalize phone number to E.164 format (e.g., +919876543210) */
export function normalizeWhatsAppNumber(value: string): string {
  const raw = value.trim().replace(/^whatsapp:/i, '')
  const compact = raw.replace(/[\s().-]/g, '')
  const withCountryCode = compact.startsWith('+')
    ? compact
    : compact.length === 10
      ? `+91${compact}`
      : `+${compact}`

  if (!/^\+[1-9]\d{7,14}$/.test(withCountryCode)) {
    throw new Error('Enter a valid WhatsApp number with country code')
  }

  return withCountryCode
}

/**
 * Send a free-form text message via Cloud API
 * Works within 24-hour customer service window
 */
export async function sendCloudApiText(
  toNumber: string,
  body: string
): Promise<WhatsAppMessageResult> {
  const { accessToken, phoneNumberId } = getCloudApiConfig()
  const to = normalizeWhatsAppNumber(toNumber)

  const response = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
    cache: 'no-store',
  })

  const payload = (await response.json().catch(() => ({}))) as {
    messages?: Array<{ id: string }>
    error?: { message: string; code: number }
  }

  if (!response.ok || !payload.messages?.[0]?.id) {
    throw new Error(payload.error?.message || 'Cloud API could not send the message')
  }

  return {
    id: payload.messages[0].id,
    status: 'sent',
    to,
  }
}

/**
 * Send a template message via Cloud API
 * Templates must be pre-approved in Meta Business Manager
 * Works outside 24-hour window
 */
export async function sendCloudApiTemplate(
  toNumber: string,
  templateName: string,
  languageCode: string,
  components: Array<{ type: string; parameters: Array<{ type: string; text: string }> }> = []
): Promise<WhatsAppMessageResult> {
  const { accessToken, phoneNumberId } = getCloudApiConfig()
  const to = normalizeWhatsAppNumber(toNumber)

  const response = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    }),
    cache: 'no-store',
  })

  const payload = (await response.json().catch(() => ({}))) as {
    messages?: Array<{ id: string }>
    error?: { message: string; code: number }
  }

  if (!response.ok || !payload.messages?.[0]?.id) {
    throw new Error(payload.error?.message || 'Cloud API could not send template message')
  }

  return {
    id: payload.messages[0].id,
    status: 'sent',
    to,
  }
}

/**
 * Check if Cloud API is configured
 */
export function isCloudApiConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID)
}