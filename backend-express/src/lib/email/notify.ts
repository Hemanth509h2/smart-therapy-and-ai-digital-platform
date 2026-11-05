import { mailConfigured, sendMail, type MailKind } from '@/lib/core/mail';
import { getSetting, SETTING_DEFAULTS } from '@/lib/core/settings';
import { logError } from '@/lib/http/apiError';
import { hit } from '@/lib/http/rateLimit';
import { renderEmail, type EmailContent } from './layout';

/**
 * Sending service emails without ever breaking the action that caused them.
 *
 * notify() and alertAdmins() never throw and never reject: a missing SMTP
 * setup, a bad address or a Zoho error is logged (with a safe summary and the
 * email's tag, never the recipient) and the request carries on.
 *
 * Routes await the returned promise through deliver(), which caps the wait.
 * On Vercel a function can be frozen as soon as the response is sent, so an
 * email started after res.json() might never leave; waiting a few seconds
 * before responding is the reliable way without a waitUntil() helper.
 */

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

/** A plausible single email address (no display names, no lists). */
export function isEmailAddress(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value.trim());
}

async function supportEmail(): Promise<string> {
  try {
    return String(await getSetting('support.email')) || SETTING_DEFAULTS['support.email'];
  } catch {
    return SETTING_DEFAULTS['support.email'];
  }
}

/**
 * Sends one service email and throws when it can't: for actions whose whole
 * point is the email (e.g. "Send by email"), so the user hears it failed.
 * Callers check mailConfigured() and the address first.
 */
export async function sendServiceEmail(kind: MailKind, to: string, content: EmailContent): Promise<void> {
  const message = renderEmail(content, await supportEmail());
  await sendMail(kind, { to: to.trim(), subject: message.subject, html: message.html, text: message.text });
}

/** Sends one service email. Resolves (never rejects) once sent, skipped or failed. */
export async function notify(kind: MailKind, to: string | null | undefined, content: EmailContent): Promise<void> {
  try {
    if (!mailConfigured()) return;
    if (!isEmailAddress(to)) return;
    await sendServiceEmail(kind, to, content);
  } catch (e) {
    logError(`email ${content.tag} not sent`, e);
  }
}

/**
 * Waits for emails to finish, but never longer than `timeoutMs`. Emails still
 * sending after that are left to finish in the background (best effort).
 */
export async function deliver(promises: Promise<void> | Array<Promise<void> | null | undefined | false>, timeoutMs = 4000): Promise<void> {
  const list = (Array.isArray(promises) ? promises : [promises]).filter(Boolean) as Promise<void>[];
  if (!list.length) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled(list),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
  ]);
  if (timer) clearTimeout(timer);
}

// ── Admin alerts ──────────────────────────────────────────────────────────────

export type AlertArea = 'billing' | 'support' | 'safety' | 'system';

function addressList(value: string | undefined): string[] {
  return (value ?? '').split(',').map((s) => s.trim()).filter(isEmailAddress);
}

/** Who gets alerts for an area: ADMIN_ALERT_EMAILS_<AREA> → ADMIN_ALERT_EMAILS → support email setting. */
export async function alertRecipients(area: AlertArea): Promise<string[]> {
  const specific = addressList(process.env[`ADMIN_ALERT_EMAILS_${area.toUpperCase()}`]);
  if (specific.length) return specific;
  const general = addressList(process.env.ADMIN_ALERT_EMAILS);
  if (general.length) return general;
  const fallback = await supportEmail();
  return isEmailAddress(fallback) ? [fallback.trim()] : [];
}

const ALERT_THROTTLE = { name: 'admin-alert', limit: 1, windowMs: 10 * 60 * 1000 };

/**
 * Emails an alert to the admins for an area. The same alert (tag + subject)
 * goes out at most once per 10 minutes per server instance, so a burst of
 * identical events can't flood the inbox. Never rejects.
 */
export async function alertAdmins(area: AlertArea, content: EmailContent): Promise<void> {
  try {
    if (!mailConfigured()) return;
    if (hit(ALERT_THROTTLE, `${content.tag}|${content.subject}`).limited) return;
    const recipients = await alertRecipients(area);
    await Promise.all(recipients.map((to) => notify('alerts', to, content)));
  } catch (e) {
    logError(`admin alert ${content.tag} not sent`, e);
  }
}
