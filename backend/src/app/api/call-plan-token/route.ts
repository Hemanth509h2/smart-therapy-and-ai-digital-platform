import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/db';
import { requireTherapist } from '@/lib/http/progressAuth';
import { requireActivePlan } from '@/lib/billing/subscriptions';
import { mintSttToken } from '@/lib/sessions/stt-token';
import { checkAIConsent } from '@/lib/sessions/transcript-store';
import { getSetting } from '@/lib/core/settings';
import { errorResponse } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

// Short-lived: the browser asks for a fresh token for each agent request.
const TOKEN_TTL_MS = 10 * 60_000;

// Token for the call-plan AI agent in the Python AI service (ai/call_plan).
// The agent sends the client's previous notes and the call transcript to an
// LLM, so it gets the same gates as /api/ai-insight: the session's own
// therapist, an active plan, AI insights switched on, and both parties' consent.
export async function POST(request: Request) {
  try {
    const auth = await requireTherapist(request);
    if (!auth.ok) return auth.response;

    if (!(await getSetting('features.aiInsights'))) {
      return NextResponse.json({ error: 'AI insights are turned off by an admin.' }, { status: 503 });
    }

    const { sessionId } = await request.json().catch(() => ({}));
    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json({ error: "We couldn't tell which session this is for. Refresh the page and try again." }, { status: 400 });
    }

    const noPlan = await requireActivePlan({ therapistId: auth.therapist.id }, 'use AI assistance in calls');
    if (noPlan) return noPlan;

    const session = await prisma.session.findFirst({
      where: { id: sessionId, therapistId: auth.therapist.id },
      select: { id: true },
    });
    if (!session) {
      return NextResponse.json({ error: 'This session no longer exists. It may have been deleted.' }, { status: 404 });
    }

    // Same dev-only bypass as /api/ai-insight, never in production.
    const sttTestMode =
      process.env.NEXT_PUBLIC_STT_TEST_MODE === 'true' &&
      process.env.NODE_ENV !== 'production';
    if (!sttTestMode && !(await checkAIConsent(sessionId))) {
      return NextResponse.json(
        { error: 'Both you and the client need to allow AI assistance first.' },
        { status: 403 }
      );
    }

    const secret = process.env.STT_TOKEN_SECRET;
    if (!secret) {
      return NextResponse.json({ error: "AI assistance isn't set up on the server yet. Ask an admin to finish the AI setup." }, { status: 503 });
    }

    return NextResponse.json({ token: mintSttToken(sessionId, secret, TOKEN_TTL_MS, 'call-plan') });
  } catch (error: any) {
    return errorResponse(error, 'call-plan-token');
  }
}
