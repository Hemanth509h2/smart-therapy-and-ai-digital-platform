/**
 * Public URL of the frontend app. The API runs on its own origin, so links
 * sent to users (e.g. the session join link) must not use this request's
 * origin. Prefers APP_URL, then the browser's Origin header (the frontend
 * that made this call).
 */
export function appUrl(request: Request): string {
  const base = process.env.APP_URL || request.headers.get('origin') || new URL(request.url).origin;
  return base.replace(/\/+$/, '');
}
