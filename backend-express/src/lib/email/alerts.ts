import type { EmailContent } from './layout';
import { emailLink, formatDateIST, formatDateTimeIST, formatInr } from './format';

/**
 * Alerts emailed to STAAD admins (notify.ts alertAdmins picks recipients and
 * throttles repeats).
 *
 * Admin mailboxes are ordinary email, so alerts never carry patient data:
 * no client names, diagnosis, transcripts, notes, report text or risk details.
 * Therapist names and emails are fine (they are STAAD's own customers).
 */

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

function alert(tag: string, subject: string, paragraphs: string[], details: Array<[string, string]>, button?: { label: string; path: string }): EmailContent {
  return {
    tag,
    audience: 'admin',
    subject: `[STAAD] ${subject}`,
    paragraphs,
    details,
    ...(button ? { button: { label: button.label, url: emailLink(button.path) } } : {}),
  };
}

export function newTherapistAlert(p: { name: string; email: string; at: Date }): EmailContent {
  return alert('alert.new_therapist', `New therapist signed up: ${p.name}`,
    ['A new therapist created a STAAD account.'],
    [['Name', p.name], ['Email', p.email], ['Signed up', formatDateTimeIST(p.at)]],
    { label: 'Open professionals', path: '/admin/professionals' });
}

export function planRequestAlert(p: { therapistName: string; planName: string; months: number; total: number; needsApproval: boolean }): EmailContent {
  return alert('alert.plan_request',
    p.needsApproval ? `Plan request waiting for approval: ${p.therapistName}` : `New plan request: ${p.therapistName}`,
    [p.needsApproval
      ? 'A therapist requested a plan and is waiting for an admin to approve it. They can only pay after approval.'
      : 'A therapist requested a plan.'],
    [['Therapist', p.therapistName], ['Plan', p.planName], ['Term', plural(p.months, 'month')], ['Total', formatInr(p.total)]],
    { label: 'Review requests', path: '/admin/subscriptions' });
}

export function paymentAlert(p: { ok: boolean; therapistName: string; planName: string; amount: number; orderId: string }): EmailContent {
  return alert(p.ok ? 'alert.payment_received' : 'alert.payment_failed',
    p.ok ? `Payment received: ${formatInr(p.amount)} from ${p.therapistName}` : `Payment not completed: ${p.therapistName}`,
    [p.ok ? 'A payment was received and the plan was activated.' : 'A plan payment failed or was abandoned at checkout.'],
    [['Therapist', p.therapistName], ['Plan', p.planName], ['Amount', formatInr(p.amount)], ['Order ID', p.orderId]],
    { label: 'Open subscriptions', path: '/admin/subscriptions' });
}

export function planCancelledAlert(p: { therapistName: string; planName: string; endsAt: Date; undone: boolean }): EmailContent {
  return alert(p.undone ? 'alert.cancel_undone' : 'alert.plan_cancelled',
    p.undone ? `Cancellation undone: ${p.therapistName}` : `Plan cancelled: ${p.therapistName}`,
    [p.undone ? 'A therapist undid their plan cancellation.' : 'A therapist cancelled their plan. They keep access until the end of the paid term.'],
    [['Therapist', p.therapistName], ['Plan', p.planName], ['Term ends', formatDateIST(p.endsAt)]],
    { label: 'Open subscriptions', path: '/admin/subscriptions' });
}

export function plansEndedSummaryAlert(p: { items: Array<{ therapistName: string; planName: string; toFreeTier: boolean }>; at: Date }): EmailContent {
  return alert('alert.plans_ended', `${plural(p.items.length, 'plan')} ended today`,
    [`The daily subscription job ended ${plural(p.items.length, 'plan')} on ${formatDateIST(p.at)}.`],
    p.items.slice(0, 50).map((i) => [i.therapistName, `${i.planName}${i.toFreeTier ? ' · now on free tier' : ' · another plan continues'}`] as [string, string]),
    { label: 'Open subscriptions', path: '/admin/subscriptions' });
}

export function accountDeletedAlert(p: { name: string; email: string; at: Date }): EmailContent {
  return alert('alert.account_deleted', `Account deleted: ${p.name}`,
    ['A therapist deleted their STAAD account and its data. Payment records are kept.'],
    [['Name', p.name], ['Email', p.email], ['Deleted', formatDateTimeIST(p.at)]],
    { label: 'Open audit log', path: '/admin/audit' });
}

/** Severity and therapist name only: never the flag's detail, transcript or client. */
export function safetyFlagAlert(p: { therapistName: string; severity: string; at: Date }): EmailContent {
  return alert('alert.safety_flag', `Safety flag (${p.severity}) raised in a session by ${p.therapistName}`,
    [`A safety flag was raised in a session by ${p.therapistName}, severity ${p.severity}. Details are in the admin console only.`],
    [['Therapist', p.therapistName], ['Severity', p.severity], ['Raised', formatDateTimeIST(p.at)]],
    { label: 'Open risk flags', path: '/admin/sessions?tab=risk' });
}

/** `error` must already be a safe summary (no messages that could hold patient data). */
export function jobFailedAlert(p: { job: string; error: string; at: Date }): EmailContent {
  return alert('alert.job_failed', `Scheduled job failed: ${p.job}`,
    ['A scheduled job failed. It will run again on its next schedule.'],
    [['Job', p.job], ['Failed', formatDateTimeIST(p.at)], ['Error', p.error.slice(0, 300)]],
    { label: 'Open system health', path: '/admin/health' });
}
