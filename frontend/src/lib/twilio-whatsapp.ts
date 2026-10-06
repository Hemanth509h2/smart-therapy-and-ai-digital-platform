const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01'

export interface WhatsAppInviteInput {
  to: string
  patientName: string
  inviteLink: string
}

export interface WhatsAppMessageResult {
  sid: string
  status: string
  to: string
}

export function normalizeWhatsAppAddress(value: string): string {
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

  return `whatsapp:${withCountryCode}`
}

/** Store phone numbers as E.164 in the database; add Twilio's prefix only at send time. */
export function normalizeWhatsAppNumber(value: string): string {
  return normalizeWhatsAppAddress(value).slice('whatsapp:'.length)
}

export function isTwilioWhatsAppConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_WHATSAPP_FROM
  )
}

function getTwilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const configuredFrom = process.env.TWILIO_WHATSAPP_FROM

  if (!accountSid || !authToken || !configuredFrom) {
    throw new Error('Twilio WhatsApp is not configured')
  }

  return { accountSid, authToken, from: normalizeWhatsAppAddress(configuredFrom) }
}

/**
 * Sends a free-form WhatsApp text. Works in the Twilio Sandbox (recipient must
 * have joined it) and within the 24h customer-service window in production.
 */
export async function sendTwilioWhatsAppText(
  toNumber: string,
  body: string
): Promise<WhatsAppMessageResult> {
  const { accountSid, authToken, from } = getTwilioConfig()
  const to = normalizeWhatsAppAddress(toNumber)
  return postTwilioMessage(accountSid, authToken, new URLSearchParams({ From: from, To: to, Body: body }), to)
}

export async function sendWhatsAppInvite(
  input: WhatsAppInviteInput
): Promise<WhatsAppMessageResult> {
  const { accountSid, authToken, from } = getTwilioConfig()
  const to = normalizeWhatsAppAddress(input.to)
  const params = new URLSearchParams({ From: from, To: to })
  const contentSid = process.env.TWILIO_WHATSAPP_CONTENT_SID

  if (contentSid) {
    params.set('ContentSid', contentSid)
    params.set(
      'ContentVariables',
      JSON.stringify({ '1': input.patientName || 'there', '2': input.inviteLink })
    )
  } else {
    params.set(
      'Body',
      `Hello ${input.patientName || 'there'}, you are invited to a STAAD therapy session. Sign up here: ${input.inviteLink}`
    )
  }

  return postTwilioMessage(accountSid, authToken, params, to)
}

async function postTwilioMessage(
  accountSid: string,
  authToken: string,
  params: URLSearchParams,
  to: string
): Promise<WhatsAppMessageResult> {
  const response = await fetch(
    `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
      cache: 'no-store',
    }
  )

  const payload = (await response.json()) as {
    sid?: string
    status?: string
    to?: string
    message?: string
  }

  if (!response.ok || !payload.sid) {
    throw new Error(payload.message || 'Twilio could not send the WhatsApp message')
  }

  return {
    sid: payload.sid,
    status: payload.status || 'queued',
    to: payload.to || to,
  }
}
