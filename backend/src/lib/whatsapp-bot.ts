import {
  normalizeWhatsAppNumber,
  sendCloudApiText,
  sendCloudApiTemplate,
} from './whatsapp-cloud-api'

// Messages go out through the official WhatsApp Business Cloud API (Meta).
// Free-form text only reaches people who messaged us in the last 24 hours, so
// set WHATSAPP_INVITE_TEMPLATE / WHATSAPP_SCHEDULED_TEMPLATE to approved
// template names to reach patients cold. Without them we fall back to text.
const TEMPLATE_LANG = () => process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en'

function bodyParams(values: string[]) {
  return [{ type: 'body', parameters: values.map((text) => ({ type: 'text', text })) }]
}

export async function sendViaBot(to: string, text: string): Promise<WhatsAppMessageResult> {
  return sendCloudApiText(to, text)
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
 * Send the patient invite on WhatsApp
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

  const template = process.env.WHATSAPP_INVITE_TEMPLATE
  if (template) {
    // Template body variables: {{1}} patient name, {{2}} therapist, {{3}} link
    return sendCloudApiTemplate(
      to,
      template,
      TEMPLATE_LANG(),
      bodyParams([name, input.therapistName || 'Your therapist', input.inviteLink])
    )
  }
  return sendViaBot(to, text)
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

  const template = process.env.WHATSAPP_SCHEDULED_TEMPLATE
  if (template) {
    // Template body variables: {{1}} patient name, {{2}} therapist, {{3}} date/time
    return sendCloudApiTemplate(
      to,
      template,
      TEMPLATE_LANG(),
      bodyParams([name, input.therapistName || 'your therapist', when])
    )
  }
  return sendViaBot(to, text)
}
