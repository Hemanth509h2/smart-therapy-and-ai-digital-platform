import { Router } from 'express';
import { prisma } from '@/lib/core/db';
import { requireTherapist } from '@/lib/http/progressAuth';
import { requireActivePlan } from '@/lib/billing/subscriptions';
import { mintSttToken } from '@/lib/sessions/stt-token';
import { checkAIConsent } from '@/lib/sessions/transcript-store';
import { getSetting } from '@/lib/core/settings';
import { errorResponse } from '@/lib/http/apiError';
import { handle, send } from '@/lib/http/reply';

export const router = Router();

// ---- /api/call-plan-token ------------------------------------------------------

// Short-lived: the browser asks for a fresh token for each agent request.
const TOKEN_TTL_MS = 10 * 60_000;

// Token for the call-plan AI agent in the Python AI service (ai/call_plan).
// The agent sends the client's previous notes and the call transcript to an
// LLM, so it gets the same gates as /api/ai-insight: the session's own
// therapist, an active plan, AI insights switched on, and both parties' consent.
router.post('/call-plan-token', handle(async (req, res) => {
  try {
    const auth = await requireTherapist(req);
    if (!auth.ok) return send(res, auth.response);

    if (!(await getSetting('features.aiInsights'))) {
      return res.status(503).json({ error: 'AI insights are turned off by an admin.' });
    }

    const { sessionId } = req.body;
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ error: "We couldn't tell which session this is for. Refresh the page and try again." });
    }

    const noPlan = await requireActivePlan({ therapistId: auth.therapist.id }, 'use AI assistance in calls');
    if (noPlan) return send(res, noPlan);

    const session = await prisma.session.findFirst({
      where: { id: sessionId, therapistId: auth.therapist.id },
      select: { id: true },
    });
    if (!session) {
      return res.status(404).json({ error: 'This session no longer exists. It may have been deleted.' });
    }

    // Same dev-only bypass as /api/ai-insight, never in production.
    const sttTestMode =
      process.env.NEXT_PUBLIC_STT_TEST_MODE === 'true' &&
      process.env.NODE_ENV !== 'production';
    if (!sttTestMode && !(await checkAIConsent(sessionId))) {
      return res.status(403).json({ error: 'Both you and the client need to allow AI assistance first.' });
    }

    const secret = process.env.STT_TOKEN_SECRET;
    if (!secret) {
      return res.status(503).json({ error: "AI assistance isn't set up on the server yet. Ask an admin to finish the AI setup." });
    }

    return res.json({ token: mintSttToken(sessionId, secret, TOKEN_TTL_MS, 'call-plan') });
  } catch (error: any) {
    return send(res, errorResponse(error, 'call-plan-token'));
  }
}));
