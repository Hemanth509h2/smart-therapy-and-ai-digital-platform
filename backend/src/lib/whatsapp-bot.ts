import {
  isTwilioWhatsAppConfigured,
  normalizeWhatsAppNumber,
  sendTwilioWhatsAppText,
} from './twilio-whatsapp'

export interface WhatsAppInviteInput {
  to: string
  patientName: string
  inviteLink: string
  therapistName?: string
}

export interface WhatsAppMessageResult {
  sid: string
  status: string
  to: string
}

/**
 * Picks the WhatsApp transport. `WHATSAPP_PROVIDER=twilio|bot` forces one;
 * otherwise Twilio is used when its credentials are present (works on Vercel),
 * falling back to the self-hosted Baileys bot.
 */
function deliver(to: string, text: string): Promise<WhatsAppMessageResult> {
  const provider = process.env.WHATSAPP_PROVIDER?.trim().toLowerCase()
  const useTwilio = provider ? provider === 'twilio' : isTwilioWhatsAppConfigured()
  return useTwilio ? sendTwilioWhatsAppText(to, text) : sendViaBot(to, text)
}

async function sendViaBot(to: string, text: string): Promise<WhatsAppMessageResult> {
  const botUrl = process.env.WHATSAPP_BOT_URL
  const botSecret = process.env.WHATSAPP_BOT_SECRET

  if (!botUrl || !botSecret) {
    throw new Error('WhatsApp bot is not configured (set WHATSAPP_BOT_URL / WHATSAPP_BOT_SECRET)')
  }

  const response = await fetch(`${botUrl.replace(/\/$/, '')}/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bot-secret': botSecret,
    },
    body: JSON.stringify({ to, text }),
    cache: 'no-store',
  })

  const payload = (await response.json().catch(() => ({}))) as {
    success?: boolean
    id?: string
    error?: string
  }

  if (!response.ok || !payload.success) {
    throw new Error(payload.error || 'WhatsApp bot could not send the message')
  }

  return { sid: payload.id || 'unknown', status: 'sent', to }
}

export async function sendWhatsAppInvite(input: WhatsAppInviteInput): Promise<WhatsAppMessageResult> {
  const to = normalizeWhatsAppNumber(input.to)
  const name = input.patientName || 'there'
  const invitedBy = input.therapistName ? `${input.therapistName} has invited you` : "You've been invited"
  const text = `Hi ${name}! 👋

${invitedBy} to join *STAAD* — a calm, supportive space for your therapy sessions.

Setting up your account takes less than a minute:
👉 ${input.inviteLink}

We're glad you're here. 🌿`
  return deliver(to, text)
}

export interface SessionLinkInput {
  to: string
  patientName: string
  sessionLink: string
  scheduledAt: Date
  therapistName?: string
}

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
  return deliver(to, text)
}

export interface SessionStartedInput {
  to: string
  patientName: string
  sessionLink: string
  therapistName?: string
}

export async function sendSessionStartedMessage(input: SessionStartedInput): Promise<WhatsAppMessageResult> {
  const to = normalizeWhatsAppNumber(input.to)
  const name = input.patientName || 'there'
  const withWhom = input.therapistName ? `with ${input.therapistName}` : ''
  const text = `Hi ${name}! 🎬

Your STAAD session ${withWhom} has *started now*.

Tap to join immediately:
👉 ${input.sessionLink}

We're ready when you are. 🌿`
  return deliver(to, text)
}
