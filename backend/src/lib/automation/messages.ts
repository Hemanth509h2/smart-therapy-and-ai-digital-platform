import { dateLabel, dateTimeLabel } from './time'
import type { SessionRow } from './sessions'

/** The morning digest for a doctor, ready for n8n to send as WhatsApp text. */
export function dailyScheduleMessage(doctorName: string, date: string, sessions: SessionRow[]): string {
  const list = sessions.map((s, i) => `${i + 1}. ${s.time} - ${s.client.name}`).join('\n')
  const count = `${sessions.length} session${sessions.length === 1 ? '' : 's'} today`
  return `Good morning, ${doctorName}! 🌅

Your STAAD schedule for *${dateLabel(date)}*:

${list}

${count}. Have a good day. 🌿`
}

/** Reminder to a patient about an upcoming session (no join link; that comes when it starts). */
export function reminderMessage(patientFirstName: string, doctorName: string, scheduledAt: Date): string {
  const withWhom = doctorName ? ` with ${doctorName}` : ''
  return `Hi ${patientFirstName || 'there'}! ⏰

A reminder that your STAAD session${withWhom} is on *${dateTimeLabel(scheduledAt)}*.

We'll send you the link to join when your session starts. 🌿`
}

/** The join-link message for a patient. */
export function joinLinkMessage(patientFirstName: string, doctorName: string, link: string): string {
  const invitedBy = doctorName ? `${doctorName} has invited you` : "You've been invited"
  return `Hi ${patientFirstName || 'there'}! 👋

${invitedBy} to a therapy session on *STAAD*.

Tap the link below to join, no sign-up needed:
👉 ${link}

See you there. 🌿`
}
