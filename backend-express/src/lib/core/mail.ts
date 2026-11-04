import nodemailer, { type SendMailOptions, type Transporter } from 'nodemailer';

/**
 * Every email the backend sends goes through here: one SMTP transport, and a
 * sender address per kind of email so each can later get its own mailbox
 * (e.g. support@, billing@, noreply@) by setting one env var.
 *
 * SMTP:   Zoho Mail. SMTP_HOST (default smtp.zoho.in; smtp.zoho.com for
 *         .com-region accounts), SMTP_PORT (default 465 = implicit TLS; 587 =
 *         STARTTLS), SMTP_USER (events@staad.in), SMTP_PASS (a Zoho
 *         app-specific password when 2FA is on).
 * Sender: MAIL_FROM_<KIND> → MAIL_FROM_DEFAULT → SMTP_FROM (legacy) →
 *         "STAAD <events@staad.in>".
 * Reply-To (optional): MAIL_REPLY_TO_<KIND>, unless the caller sets replyTo
 *         itself (support tickets reply to the person who wrote in).
 *
 * Every From address must be the SMTP_USER mailbox or a "Send mail as" alias
 * added to it in Zoho Mail settings; otherwise Zoho rejects the message
 * (553 Sender not allowed).
 */

export type MailKind = 'support' | 'billing' | 'account' | 'sessions' | 'alerts' | 'marketing' | 'system';

const FALLBACK_FROM = 'STAAD <events@staad.in>';

const KIND_ENV: Record<MailKind, string> = {
  support: 'SUPPORT',
  billing: 'BILLING',
  account: 'ACCOUNT',
  sessions: 'SESSIONS',
  alerts: 'ALERTS',
  marketing: 'MARKETING',
  system: 'SYSTEM',
};

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

/** The sender used when a kind has no address of its own. */
export function defaultMailFrom(): string {
  return process.env.MAIL_FROM_DEFAULT?.trim() || process.env.SMTP_FROM?.trim() || FALLBACK_FROM;
}

/** The sender address used for a kind of email. */
export function mailFrom(kind: MailKind): string {
  return process.env[`MAIL_FROM_${KIND_ENV[kind]}`]?.trim() || defaultMailFrom();
}

function mailReplyTo(kind: MailKind): string | undefined {
  return process.env[`MAIL_REPLY_TO_${KIND_ENV[kind]}`]?.trim() || undefined;
}

function transportOptions(pool: boolean) {
  const port = Number(process.env.SMTP_PORT || 465);
  return {
    ...(pool ? { pool: true as const } : {}),
    host: process.env.SMTP_HOST || 'smtp.zoho.in',
    port,
    secure: port === 465, // 465 = implicit TLS; 587 upgrades with STARTTLS
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  };
}

let cached: { key: string; transport: Transporter } | null = null;

/** The shared transport (rebuilt if the SMTP settings change). Throws when SMTP isn't configured. */
export function mailTransport(): Transporter {
  if (!mailConfigured()) throw new Error('SMTP is not configured (SMTP_USER / SMTP_PASS missing)');
  const key = JSON.stringify(transportOptions(false));
  if (!cached || cached.key !== key) {
    cached?.transport.close();
    cached = { key, transport: nodemailer.createTransport(transportOptions(false)) };
  }
  return cached.transport;
}

/**
 * A pooled transport for sending many emails in a row (broadcasts). The
 * caller must close() it when done.
 */
export function pooledMailTransport(): Transporter {
  if (!mailConfigured()) throw new Error('SMTP is not configured (SMTP_USER / SMTP_PASS missing)');
  return nodemailer.createTransport(transportOptions(true));
}

export type MailOptions = Omit<SendMailOptions, 'from'> & { from?: string };

/** Builds the message: the kind's From (unless given) and default Reply-To. */
export function mailMessage(kind: MailKind, options: MailOptions): SendMailOptions {
  const replyTo = options.replyTo ?? mailReplyTo(kind);
  return { ...options, from: options.from || mailFrom(kind), ...(replyTo ? { replyTo } : {}) };
}

/** Sends one email of the given kind. Throws when SMTP isn't configured or sending fails. */
export async function sendMail(kind: MailKind, options: MailOptions, transport?: Transporter) {
  return (transport ?? mailTransport()).sendMail(mailMessage(kind, options));
}
