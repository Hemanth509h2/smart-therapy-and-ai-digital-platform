import { createHash, timingSafeEqual } from 'crypto';
import type { Request } from 'express';

/** Constant-time string comparison (hashes first, so lengths don't leak). */
export function secretMatches(given: string | null | undefined, expected: string | null | undefined): boolean {
  if (!given || !expected) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** True when the request carries CRON_SECRET, as `x-cron-secret` or
 *  `Authorization: Bearer <secret>` (how Vercel cron sends it). */
export function hasCronSecret(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  const bearer = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  return secretMatches(req.get('x-cron-secret'), expected) || secretMatches(bearer, expected);
}
