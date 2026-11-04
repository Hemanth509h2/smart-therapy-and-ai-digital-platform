/**
 * Where a payment provider may send the browser back to. Only our own
 * frontends (APP_URL and ALLOWED_ORIGINS) are accepted, so a checkout can't be
 * turned into a redirect to some other site. Returns undefined otherwise; the
 * caller then lets the provider use its default.
 */
export function safeReturnUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value.length > 2000) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  const allowed = new Set(
    [process.env.APP_URL ?? '', ...(process.env.ALLOWED_ORIGINS ?? '').split(',')]
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean)
      .map((o) => {
        try {
          return new URL(o).origin;
        } catch {
          return '';
        }
      })
      .filter(Boolean)
  );
  if (!allowed.has(url.origin)) return undefined;
  // Cashfree appends ?order_id=…, so drop any query/hash we were given.
  return `${url.origin}${url.pathname}`;
}
