import { normalizeWhatsAppNumber } from './whatsapp-cloud-api'

// Messages are delivered by the self-hosted Baileys bot (whatapps/), which
// exposes POST /send guarded by the shared x-bot-secret header.
export async function sendViaBot(to: string, text: string): Promise<WhatsAppMessageResult> {
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

export interface SessionScheduledInput {
  to: string
  patientName: string
  scheduledAt: Date
  therapistName?: string
}

/**
 * Send the patient invite by posting it to the n8n webhook, which delivers it on WhatsApp
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

  const url = process.env.N8N_INVITE_WEBHOOK_URL
  if (!url) throw new Error('N8N_INVITE_WEBHOOK_URL is not configured')

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to,
      patientName: input.patientName || '',
      therapistName: input.therapistName || '',
      inviteLink: input.inviteLink,
      text,
    }),
  })
  if (!res.ok) throw new Error(`n8n invite webhook responded ${res.status}`)
  return { id: `n8n-${Date.now()}`, status: 'sent', to }
}

/**
 * Send session booked confirmation. Deliberately carries no join link —
 * the link is only sent when the therapist starts the session.
 */
export async function sendSessionScheduledMessage(input: SessionScheduledInput): Promise<WhatsAppMessageResult> {
  const to = normalizeWhatsAppNumber(input.to)
  const name = input.patientName || 'there'
  const when = input.scheduledAt.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  })
  const withWhom = input.therapistName ? ` with ${input.therapistName}` : ''
  const text = `Hi ${name}! 🗓️

Your STAAD session${withWhom} is booked for *${when}*.

We'll send you the link to join when your session starts.

Take a deep breath — we'll see you there. 🌿`

  return sendViaBot(to, text)
}
