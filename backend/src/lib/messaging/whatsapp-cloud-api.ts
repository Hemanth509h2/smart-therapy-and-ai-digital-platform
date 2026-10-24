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

import { PublicError } from '@/lib/http/apiError'

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

/** The server has no Cloud API credentials. The message (env var names) is
 *  for logs and the admin message log; users get `publicReason`. */
export class WhatsAppNotConfiguredError extends Error {
  readonly publicReason = "WhatsApp isn't set up on the server yet. An admin needs to add the WhatsApp Business account details."
  constructor() {
    super('WhatsApp Cloud API not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID')
    this.name = 'WhatsAppNotConfiguredError'
  }
}

/** Meta refused the message. `message` keeps Meta's text for logs; `publicReason`
 *  is a plain explanation for the therapist. */
export class WhatsAppSendError extends Error {
  constructor(message: string, readonly publicReason: string, readonly metaCode?: number) {
    super(message)
    this.name = 'WhatsAppSendError'
  }
}

// Common Graph API error codes → what they mean for the person sending.
function explainMetaError(code?: number): string {
  if (code === 190) return "the server's WhatsApp access token has expired or is invalid. An admin needs to renew it"
  if (code === 131026) return "this number isn't on WhatsApp or can't receive messages right now"
  if (code === 131047)
    return "WhatsApp only allows a first message through an approved template, and none is set up. An admin needs to add the message template"
  if (code === 132001) return "the WhatsApp message template isn't approved or doesn't exist. An admin needs to check the template name"
  if (code === 131030) return "this number isn't on the WhatsApp test account's allowed list. An admin needs to add it, or switch to a live number"
  if (code === 131056 || code === 130429 || code === 80007) return 'too many WhatsApp messages were sent in a short time. Try again in a few minutes'
  if (code === 100) return 'WhatsApp rejected the message details. An admin needs to check the WhatsApp setup'
  return 'WhatsApp rejected the message'
}

/** What to tell a user about any WhatsApp send error. */
export function whatsAppPublicReason(error: unknown): string {
  if (error instanceof WhatsAppNotConfiguredError || error instanceof WhatsAppSendError) return error.publicReason
  if (error instanceof PublicError) return error.message
  return "WhatsApp couldn't be reached"
}

function getCloudApiConfig(): CloudApiConfig {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID

  if (!accessToken || !phoneNumberId) throw new WhatsAppNotConfiguredError()

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
    throw new PublicError('Enter a valid WhatsApp number, including the country code (for example +91 98765 43210).', 400)
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
    throw new WhatsAppSendError(
      payload.error?.message || 'Cloud API could not send the message',
      explainMetaError(payload.error?.code),
      payload.error?.code
    )
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
    throw new WhatsAppSendError(
      payload.error?.message || 'Cloud API could not send template message',
      explainMetaError(payload.error?.code),
      payload.error?.code
    )
  }

  return {
    id: payload.messages[0].id,
    status: 'sent',
    to,
  }
}

/**
 * Send an interactive message (buttons / list) via Cloud API
 */
export async function sendCloudApiInteractive(
  toNumber: string,
  interactive: Record<string, unknown>
): Promise<WhatsAppMessageResult> {
  const { accessToken, phoneNumberId } = getCloudApiConfig()
  const to = normalizeWhatsAppNumber(toNumber)

  const response = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'interactive', interactive }),
    cache: 'no-store',
  })
  const payload = (await response.json().catch(() => ({}))) as {
    messages?: Array<{ id: string }>
    error?: { message: string; code?: number }
  }
  if (!response.ok || !payload.messages?.[0]?.id) {
    throw new WhatsAppSendError(
      payload.error?.message || 'Cloud API could not send the interactive message',
      explainMetaError(payload.error?.code),
      payload.error?.code
    )
  }
  return { id: payload.messages[0].id, status: 'sent', to }
}

/**
 * Check if Cloud API is configured
 */
export function isCloudApiConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID)
}