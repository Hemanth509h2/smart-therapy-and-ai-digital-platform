import {
  normalizeWhatsAppNumber,
  sendCloudApiText,
  sendCloudApiTemplate,
  isCloudApiConfigured,
} from './whatsapp-cloud-api'

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

${invitedBy} to join *STAAD* — a calm, supportive space for your therapy sessions.

Setting up your account takes less than a minute:
👉 ${input.inviteLink}

We're glad you're here. 🌿`

  if (!isCloudApiConfigured()) {
    throw new Error('WhatsApp Cloud API not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID')
  }

  return sendCloudApiText(to, text)
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

  if (!isCloudApiConfigured()) {
    throw new Error('WhatsApp Cloud API not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID')
  }

  // Try template first (works outside 24h window), fallback to text
  const templateName = process.env.WHATSAPP_TEMPLATE_SESSION_SCHEDULED || 'session_scheduled'
  
  try {
    return await sendCloudApiTemplate(to, templateName, 'en', [
      { type: 'body', parameters: [
        { type: 'text', text: name },
        { type: 'text', text: withWhom },
        { type: 'text', text: when },
        { type: 'text', text: input.sessionLink },
      ]}
    ])
  } catch (templateError) {
    console.warn('Template send failed, falling back to text message:', templateError)
    return sendCloudApiText(to, text)
  }
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

  if (!isCloudApiConfigured()) {
    throw new Error('WhatsApp Cloud API not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID')
  }

  // Try template first, fallback to text
  const templateName = process.env.WHATSAPP_TEMPLATE_SESSION_STARTED || 'session_started'
  
  try {
    return await sendCloudApiTemplate(to, templateName, 'en', [
      { type: 'body', parameters: [
        { type: 'text', text: name },
        { type: 'text', text: withWhom },
        { type: 'text', text: input.sessionLink },
      ]}
    ])
  } catch (templateError) {
    console.warn('Template send failed, falling back to text message:', templateError)
    return sendCloudApiText(to, text)
  }
}