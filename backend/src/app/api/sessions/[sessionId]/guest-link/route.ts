import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/db';
import { therapistIdForUser } from '@/lib/core/links';
import { requireAuth } from '@/lib/http/apiAuth';
import { requireActivePlan } from '@/lib/billing/subscriptions';
import { getOrCreateGuestInvite, sendSessionLinkWhatsApp } from '@/lib/sessions/session-whatsapp';
import { errorResponse, notYourProfile } from '@/lib/http/apiError';

// POST /api/sessions/[sessionId]/guest-link — create (or reuse) a patient
// join link for an already-created session ("Start a new session"). The
// invite is marked CLAIMED with claimedClientId = session.clientId, so opening
// the link lands the patient in THIS session's room (no new session is
// created on join). The link is also sent to the patient on WhatsApp, and
// `whatsapp` in the response says whether that worked (see WhatsAppOutcome).
export async function POST(request: Request, { params }: { params: { sessionId: string } }) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    const [session, therapistId] = await Promise.all([
      prisma.session.findUnique({ where: { id: params.sessionId } }),
      therapistIdForUser(auth.uid),
    ]);
    if (!session) {
      return NextResponse.json({ error: 'This session no longer exists. It may have been deleted.' }, { status: 404 });
    }
    if (session.therapistId !== therapistId) {
      return notYourProfile('this session');
    }
    const noPlan = await requireActivePlan({ therapistId: session.therapistId }, 'send a session link');
    if (noPlan) return noPlan;

    const invite = await getOrCreateGuestInvite(session);
    const whatsapp = await sendSessionLinkWhatsApp(session.id, request);

    return NextResponse.json({ token: invite.token, whatsapp });
  } catch (error: any) {
    return errorResponse(error, 'Guest link error');
  }
}
