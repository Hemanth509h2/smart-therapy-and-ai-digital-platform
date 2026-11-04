import { escapeHtml, safeHref } from '@/lib/http/html';

/**
 * One layout for every service email, rendered as both HTML and plain text.
 *
 * Templates (templates.ts, alerts.ts) return an EmailContent; nothing in it is
 * HTML. Every value is escaped here, and links are kept only when they are
 * http(s). No images, tracking pixels or marketing.
 */

export type EmailAudience = 'account' | 'session' | 'admin';

export interface EmailContent {
  /** Short label for logs, e.g. 'billing.receipt'. Never contains personal data. */
  tag: string;
  subject: string;
  /** "Hi Asha," — omitted when null. */
  greeting?: string | null;
  paragraphs: string[];
  /** Label / value rows, e.g. [['Plan', 'Pro'], ['Amount', '₹999.00']]. */
  details?: Array<[string, string]>;
  /** Main call to action. Left out when url is null or not http(s). */
  button?: { label: string; url: string | null };
  /** Extra links shown under the button as "label: url". */
  links?: Array<{ label: string; url: string | null }>;
  /** Smaller grey note at the end, e.g. "If this wasn't you…". */
  footnote?: string;
  audience: EmailAudience;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const C = { accent: '#8B6340', ink: '#2C1F0E', bg: '#f6f0e3', muted: '#5b4632', line: '#e4d9c4', white: '#ffffff' };

function footerLine(audience: EmailAudience, supportEmail: string): string {
  if (audience === 'admin') return 'This is an automated alert for STAAD administrators.';
  return `STAAD · ${supportEmail} · This is a service email about your ${audience === 'session' ? 'session' : 'account'}.`;
}

/** Subjects go into a mail header: one line, no control characters, capped. */
function cleanSubject(subject: string): string {
  return subject.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
}

export function renderEmail(content: EmailContent, supportEmail: string): RenderedEmail {
  const subject = cleanSubject(content.subject);
  const button = content.button && safeHref(content.button.url) ? content.button : null;
  const links = (content.links ?? []).filter((l) => safeHref(l.url));
  const footer = footerLine(content.audience, supportEmail);

  // ── Plain text ──────────────────────────────────────────────────────────────
  const text = [
    ...(content.greeting ? [content.greeting, ''] : []),
    ...content.paragraphs.flatMap((p) => [p, '']),
    ...(content.details?.length ? [...content.details.map(([k, v]) => `${k}: ${v}`), ''] : []),
    ...(button ? [`${button.label}: ${button.url}`, ''] : []),
    ...(links.length ? [...links.map((l) => `${l.label}: ${l.url}`), ''] : []),
    ...(content.footnote ? [content.footnote, ''] : []),
    '— Team STAAD',
    '',
    footer,
  ].join('\n');

  // ── HTML ────────────────────────────────────────────────────────────────────
  const p = (s: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${C.ink}">${escapeHtml(s)}</p>`;
  const detailsHtml = content.details?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:4px 0 18px;font-size:14px">${content.details
        .map(
          ([k, v]) =>
            `<tr><td style="padding:7px 12px 7px 0;color:${C.muted};border-top:1px solid ${C.line};white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td><td style="padding:7px 0;color:${C.ink};border-top:1px solid ${C.line};font-weight:600">${escapeHtml(v)}</td></tr>`
        )
        .join('')}</table>`
    : '';
  const buttonHtml = button
    ? `<p style="margin:6px 0 18px"><a href="${safeHref(button.url)}" style="display:inline-block;background:${C.accent};color:${C.white};padding:11px 20px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px">${escapeHtml(button.label)}</a></p>`
    : '';
  const linksHtml = links.length
    ? `<p style="margin:0 0 14px;font-size:14px;line-height:1.7">${links
        .map((l) => `<a href="${safeHref(l.url)}" style="color:${C.accent}">${escapeHtml(l.label)}</a>`)
        .join(' · ')}</p>`
    : '';

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${C.white};border:1px solid ${C.line};border-radius:14px">
<tr><td style="padding:22px 26px 6px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;letter-spacing:3px;color:${C.accent}">STAAD</td></tr>
<tr><td style="padding:10px 26px 8px;font-family:Arial,Helvetica,sans-serif">
${content.greeting ? p(content.greeting) : ''}
${content.paragraphs.map(p).join('\n')}
${detailsHtml}
${buttonHtml}
${linksHtml}
${content.footnote ? `<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:${C.muted}">${escapeHtml(content.footnote)}</p>` : ''}
<p style="margin:0 0 18px;font-size:15px;color:${C.ink}">— Team STAAD</p>
</td></tr>
<tr><td style="padding:14px 26px 20px;border-top:1px solid ${C.line};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:${C.muted}">${escapeHtml(footer)}</td></tr>
</table></td></tr></table>
</body></html>`;

  return { subject, html, text };
}
