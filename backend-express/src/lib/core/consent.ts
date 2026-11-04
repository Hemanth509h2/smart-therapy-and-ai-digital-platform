// Recording consent (Terms + Privacy acceptance, marketing emails) and the
// signed unsubscribe links in marketing emails.
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { appDb } from '@/lib/core/db';
import { CONSENT_MARKETING } from '@/lib/core/legal';

/** Adds a ConsentRecord row: who agreed (or withdrew) to what, when and from where. */
export async function recordConsent(
  req: Request | null,
  userId: string,
  kind: string,
  granted: boolean,
  version: string | null = null
) {
  await appDb.consentRecord.create({
    data: {
      userId,
      kind,
      granted,
      version,
      ip: req?.ip ?? null,
      userAgent: req?.get('user-agent')?.slice(0, 500) ?? null,
    },
  });
}

/** Turns marketing emails on or off for a therapist and records it. */
export async function setMarketingOptIn(req: Request | null, userId: string, granted: boolean) {
  const updated = await appDb.profileTherapist.updateMany({
    where: { userId },
    data: { marketingOptIn: granted, marketingOptInAt: new Date() },
  });
  if (updated.count === 0) return false;
  await recordConsent(req, userId, CONSENT_MARKETING, granted);
  return true;
}

// Unsubscribe links carry the uid and an HMAC of it, so they work signed out
// (one click from the email) but can't be forged for someone else. A secret of
// its own is best; STT_TOKEN_SECRET (always set where AI runs) is the fallback,
// separated by the "unsubscribe:" prefix.
function unsubscribeSecret() {
  return process.env.UNSUBSCRIBE_SECRET || process.env.STT_TOKEN_SECRET || '';
}

export function unsubscribeConfigured() {
  return unsubscribeSecret().length > 0;
}

export function unsubscribeToken(userId: string) {
  return createHmac('sha256', unsubscribeSecret()).update(`unsubscribe:${userId}`).digest('base64url');
}

export function validUnsubscribeToken(userId: string, token: string) {
  if (!unsubscribeConfigured() || !userId || !token) return false;
  const expected = Buffer.from(unsubscribeToken(userId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
