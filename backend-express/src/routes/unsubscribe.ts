import { Router } from 'express';
import { appDb } from '@/lib/core/db';
import { setMarketingOptIn, validUnsubscribeToken } from '@/lib/core/consent';
import { errorResponse } from '@/lib/http/apiError';
import { handle, queryParams, send } from '@/lib/http/reply';
import { limitByIp } from '@/lib/http/rateLimit';
import { deliver, notify } from '@/lib/email/notify';
import { unsubscribedEmail } from '@/lib/email/templates';
import { emailForUser } from '@/lib/email/recipients';

export const router = Router();

// Public (links in emails), so limited per IP against signature guessing.
const unsubscribeLimit = limitByIp({ name: 'unsubscribe', limit: 20, windowMs: 60 * 60 * 1000 });

// ---- /api/unsubscribe ----------------------------------------------------------

// Signed out on purpose: the link in a marketing email (?u=<uid>&t=<hmac>,
// see lib/core/consent.ts) must work in one step. The HMAC proves the link
// was sent to that account, so nobody can unsubscribe someone else.

function linkParams(req: Parameters<typeof queryParams>[0]) {
  const q = queryParams(req);
  return { uid: q.get('u') ?? '', token: q.get('t') ?? '' };
}

const BAD_LINK = "This unsubscribe link isn't valid. Open the latest email again, or turn off Marketing emails in Profile.";

// GET /api/unsubscribe?u=&t= — whether the link is valid and the account is
// still subscribed. Changes nothing (mail scanners open links on their own).
router.get('/unsubscribe', unsubscribeLimit, handle(async (req, res) => {
  try {
    const { uid, token } = linkParams(req);
    if (!validUnsubscribeToken(uid, token)) return res.status(400).json({ error: BAD_LINK });
    const therapist = await appDb.profileTherapist.findUnique({ where: { userId: uid }, select: { marketingOptIn: true } });
    if (!therapist) return res.status(404).json({ error: 'This account no longer exists, so it gets no emails from us.' });
    return res.json({ subscribed: therapist.marketingOptIn });
  } catch (error: any) {
    return send(res, errorResponse(error, 'unsubscribe GET'));
  }
}));

// POST /api/unsubscribe?u=&t= — turn marketing emails off. Used by the
// /unsubscribe page and by mail providers' one-click unsubscribe (RFC 8058,
// body "List-Unsubscribe=One-Click", which is ignored).
router.post('/unsubscribe', unsubscribeLimit, handle(async (req, res) => {
  try {
    const { uid, token } = linkParams(req);
    if (!validUnsubscribeToken(uid, token)) return res.status(400).json({ error: BAD_LINK });
    const therapist = await appDb.profileTherapist.findUnique({ where: { userId: uid }, select: { marketingOptIn: true, firstName: true } });
    if (!therapist) return res.status(404).json({ error: 'This account no longer exists, so it gets no emails from us.' });
    // Record only a real change: repeated clicks don't add consent rows, and
    // only the first one sends a confirmation.
    if (therapist.marketingOptIn) {
      await setMarketingOptIn(req, uid, false);
      await deliver(notify('account', await emailForUser(uid), unsubscribedEmail({ firstName: therapist.firstName })));
    }
    return res.json({ subscribed: false });
  } catch (error: any) {
    return send(res, errorResponse(error, 'unsubscribe POST'));
  }
}));
