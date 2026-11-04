import { Router } from 'express';
import { requireAuth } from '@/lib/http/apiAuth';
import { prisma } from '@/lib/core/db';
import { therapistIdForUser } from '@/lib/core/links';
import { mintSttToken } from '@/lib/sessions/stt-token';
import { getSetting } from '@/lib/core/settings';
import { logError, notYourProfile } from '@/lib/http/apiError';
import { handle, queryParams, send } from '@/lib/http/reply';
import { checkAIConsent } from '@/lib/sessions/transcript-store';
import { rejectIfLimited } from '@/lib/http/rateLimit';

export const router = Router();

// ---- /api/stt-token ------------------------------------------------------------

router.get('/stt-token', handle(async (req, res) => {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return send(res, auth.response);
    // A token per session, refetched on reconnects: generous, but bounded.
    if (await rejectIfLimited(res, { name: 'stt-token', limit: 60, windowMs: 10 * 60 * 1000 }, auth.uid)) return;

    if (!(await getSetting('features.transcription'))) {
      return res.status(503).json({ error: 'Transcription is turned off by an admin.' });
    }

    const searchParams = queryParams(req);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return res.status(400).json({ error: "We couldn't tell which session this is for. Refresh the page and try again." });
    }

    // Verify therapist is part of the session
    const [session, therapistId] = await Promise.all([
      prisma.session.findUnique({ where: { id: sessionId } }),
      therapistIdForUser(auth.uid),
    ]);

    if (!session || session.therapistId !== therapistId) {
      return send(res, notYourProfile('this session'));
    }

    // Transcription streams session audio to a third party, so the server
    // checks the consent itself instead of trusting the browser to: both the
    // therapist and the client must have agreed to AI features for this
    // session. Same dev-only bypass as /api/ai-insight, never in production.
    const sttTestMode =
      process.env.NEXT_PUBLIC_STT_TEST_MODE === 'true' &&
      process.env.NODE_ENV !== 'production';
    if (!sttTestMode && !(await checkAIConsent(sessionId))) {
      return res.status(403).json({ error: 'Both you and the client need to allow AI features before transcription can start.' });
    }

    const secret = process.env.STT_TOKEN_SECRET;
    if (!secret) {
      return res.status(503).json({ error: "Transcription isn't set up on the server yet. Ask an admin to finish the transcription setup." });
    }

    const sttToken = mintSttToken(sessionId, secret);
    return res.json({ token: sttToken });
  } catch (error: any) {
    logError('stt-token', error);
    return res.status(500).json({ error: "We couldn't start transcription. Please try again." });
  }
}));
