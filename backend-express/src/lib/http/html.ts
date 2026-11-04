/** Escapes text for HTML element content and quoted attribute values (emails). */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** An http(s) URL safe to put in an href, escaped; '' for anything else
 *  (javascript:, data:, relative junk). */
export function safeHref(url: unknown): string {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' || u.protocol === 'http:' ? escapeHtml(u.toString()) : '';
  } catch {
    return '';
  }
}
