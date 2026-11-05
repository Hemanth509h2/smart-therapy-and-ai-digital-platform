import { Router } from 'express';
import { adminAuth } from '@/lib/core/firebaseAdmin';
import { appDb } from '@/lib/core/db';
import { mailConfigured } from '@/lib/core/mail';
import { errorResponse, logError } from '@/lib/http/apiError';
import { handle, send } from '@/lib/http/reply';
import { hit, limitByIp } from '@/lib/http/rateLimit';
import { emailBaseUrl } from '@/lib/email/format';
import { isEmailAddress, sendServiceEmail } from '@/lib/email/notify';
import { passwordResetEmail } from '@/lib/email/templates';

export const router = Router();

// ---- /api/auth/password-reset --------------------------------------------------

// POST /api/auth/password-reset { email } — "Forgot password". Firebase makes
// the single-use reset code; the email goes out through our own mail (Zoho,
// events@staad.in) and links to the website's /reset-password page instead of
// Firebase's default page and sender.
//
// The answer is the same whether or not an account exists, so the form can't
// be used to find out who is registered. Open to signed-out visitors, so
// limited per IP and per address.
const ipLimit = limitByIp(
  { name: 'password-reset', limit: 10, windowMs: 60 * 60 * 1000 },
  'Too many reset requests from this network. Wait a while and try again.'
);
const PER_EMAIL = { name: 'password-reset-email', limit: 3, windowMs: 60 * 60 * 1000 };

router.post('/auth/password-reset', ipLimit, handle(async (req, res) => {
  try {
    const raw = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!isEmailAddress(raw)) {
      return res.status(400).json({ error: 'Enter a valid email address, like name@example.com.' });
    }
    const base = emailBaseUrl();
    if (!mailConfigured() || !base) {
      logError('Password reset email not configured', new Error(!base ? 'APP_URL missing' : 'SMTP missing'));
      return res.status(503).json({ error: "Password reset emails aren't available right now. Please contact support." });
    }
    const ok = { ok: true };
    // Quietly stop repeat requests for one address (the answer stays the same).
    if (hit(PER_EMAIL, raw).limited) return res.json(ok);

    const auth = adminAuth();
    const user = await auth.getUserByEmail(raw).catch((e: any) => {
      if (e?.code === 'auth/user-not-found') return null;
      throw e;
    });
    if (!user || user.disabled) return res.json(ok);

    // Firebase's link points at its own page; keep only the one-time code and
    // send people to ours.
    const firebaseLink = await auth.generatePasswordResetLink(raw);
    const oobCode = new URL(firebaseLink).searchParams.get('oobCode');
    if (!oobCode) throw new Error('Firebase reset link had no oobCode');
    const url = `${base}/reset-password?oobCode=${encodeURIComponent(oobCode)}`;

    const therapist = await appDb.profileTherapist
      .findUnique({ where: { userId: user.uid }, select: { firstName: true } })
      .catch(() => null);
    const providers = user.providerData.map((p) => p.providerId);
    const googleOnly = providers.includes('google.com') && !providers.includes('password');

    await sendServiceEmail('account', raw, passwordResetEmail({
      firstName: therapist?.firstName ?? user.displayName?.split(' ')[0] ?? null,
      url,
      googleOnly,
    }));
    return res.json(ok);
  } catch (error: any) {
    return send(res, errorResponse(error, 'Password reset error', "We couldn't send the reset email. Please try again, or contact support."));
  }
}));
