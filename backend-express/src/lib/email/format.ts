// Formatting shared by every email: IST dates, rupee amounts and absolute
// links to the frontend.

const IST = 'Asia/Kolkata';

function parts(date: Date, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-IN', { ...options, timeZone: IST }).formatToParts(date)) {
    out[p.type] = p.value;
  }
  return out;
}

/** "Tue, 5 Nov 2026, 4:30 pm IST" */
export function formatDateTimeIST(value: Date | string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const p = parts(date, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} ${(p.dayPeriod ?? '').toLowerCase()} IST`;
}

/** "5 November 2026" */
export function formatDateIST(value: Date | string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const p = parts(date, { day: 'numeric', month: 'long', year: 'numeric' });
  return `${p.day} ${p.month} ${p.year}`;
}

/** "₹1,234.00" */
export function formatInr(amount: number | string | null | undefined): string {
  const n = Number(amount ?? 0);
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Number.isFinite(n) ? n : 0);
}

/**
 * The frontend's public address for links in emails, without a request (cron
 * jobs and webhooks have none). APP_URL, else the first non-localhost entry of
 * ALLOWED_ORIGINS, else (outside production only) the first entry. Null when
 * nothing is configured: emails then leave the link out instead of guessing.
 */
export function emailBaseUrl(): string | null {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const origins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  const real = origins.find((o) => !/^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(o));
  if (real) return real;
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) return null;
  return origins[0] ?? null;
}

/** Absolute link to a frontend path, or null when the address isn't known. */
export function emailLink(path: string): string | null {
  const base = emailBaseUrl();
  return base ? `${base}${path.startsWith('/') ? path : `/${path}`}` : null;
}
