import { normalizeWhatsAppNumber } from './whatsapp-cloud-api'

// Messages are delivered by the self-hosted Baileys bot (whatapps/), which
// exposes POST /send guarded by the shared x-bot-secret header.
async function sendViaBot(to: string, text: string): Promise<WhatsAppMessageResult> {
  const url = process.env.WHATSAPP_BOT_URL
  const secret = process.env.WHATSAPP_BOT_SECRET
  if (!url || !secret) {
    throw new Error('WhatsApp bot not configured. Set WHATSAPP_BOT_URL and WHATSAPP_BOT_SECRET')
  }

  const res = await fetch(`${url.replace(/\/+$/, '')}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bot-secret': secret },
    body: JSON.stringify({ to, text }),
    signal: AbortSignal.timeout(15_000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `WhatsApp bot responded ${res.status}`)
  return { id: data.id ?? '', status: 'sent', to }
}

export interface WhatsAppInviteInput {
  to: string
  patientName: string
  inviteLink: string
  therapistName?: string
}

export interface WhatsAppMessageResult {
  id: string
  status: string
  to: string
}

export interface SessionLinkInput {
  to: string
  patientName: string
  sessionLink: string
  scheduledAt: Date
  therapistName?: string
}

export interface SessionStartedInput {
  to: string
  patientName: string
  sessionLink: string
  therapistName?: string
}

/**
 * Send a WhatsApp invite message (free-form text)
 * Works within 24-hour customer service window
 * For first-time invites outside the window, use a template instead
 */
export async function sendWhatsAppInvite(input: WhatsAppInviteInput): Promise<WhatsAppMessageResult> {
  const to = normalizeWhatsAppNumber(input.to)
  const name = input.patientName || 'there'
  const invitedBy = input.therapistName ? `${input.therapistName} has invited you` : "You've been invited"
  const text = `Hi ${name}! 👋

${invitedBy} to a therapy session on *STAAD*.

Tap the link below to join — no sign-up needed:
👉 ${input.inviteLink}

See you there. 🌿`

  return sendViaBot(to, text)
}

/**
 * Send session scheduled notification
 * Best sent as a template message (works outside 24h window)
 * Template example: "session_scheduled" with variables: {{1}} patientName, {{2}} therapistName, {{3}} dateTime, {{4}} sessionLink
 */
export async function sendSessionScheduledMessage(input: SessionLinkInput): Promise<WhatsAppMessageResult> {
  const to = normalizeWhatsAppNumber(input.to)
  const name = input.patientName || 'there'
  const when = input.scheduledAt.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  const withWhom = input.therapistName ? `with ${input.therapistName}` : ''
  const text = `Hi ${name}! 🗓️

Your STAAD session ${withWhom} is confirmed for *${when}*.

Tap the link below when it's time to join:
👉 ${input.sessionLink}

Take a deep breath — we'll see you there. 🌿`

  return sendViaBot(to, text)
}

/**
 * Send session started notification
 * Best sent as free-form text (within 24h window after scheduled message)
 * Template example: "session_started" with variables: {{1}} patientName, {{2}} therapistName, {{3}} sessionLink
 */
export async function sendSessionStartedMessage(input: SessionStartedInput): Promise<WhatsAppMessageResult> {
  const to = normalizeWhatsAppNumber(input.to)
  const name = input.patientName || 'there'
  const withWhom = input.therapistName ? `with ${input.therapistName}` : ''
  const text = `Hi ${name}! 🎬

Your STAAD session ${withWhom} has *started now*.

Tap to join immediately:
👉 ${input.sessionLink}

We're ready when you are. 🌿`

  return sendViaBot(to, text)
}