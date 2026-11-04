import type { Request } from 'express';
import { PublicError } from '@/lib/http/apiError';

/**
 * Public URL of the frontend app. The API runs on its own origin, so links
 * sent to users (join links, invites, set-password links) must not use this
 * request's origin.
 *
 * APP_URL is used when set. In production it should be: request headers
 * (Origin/Host) are chosen by whoever sends the request, so trusting them would
 * let someone make the server send out links to a site of their choosing.
 * Production falls back only to the first non-localhost ALLOWED_ORIGINS entry
 * (also server config), and otherwise throws a 503 PublicError. Local
 * development keeps the old fallback to the calling frontend's Origin.
 */
export function appUrl(request: Request): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');

  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
    const fromAllowList = (process.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .find((o) => o && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(o));
    if (fromAllowList) return fromAllowList;
    throw new PublicError("The server's public address (APP_URL) isn't set, so no link can be made. Ask whoever manages hosting to set it.", 503);
  }

  const base = request.get('origin') || `${request.protocol}://${request.get('host')}`;
  return base.replace(/\/+$/, '');
}
