import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/apiAuth';
import { getOrCreateGuestInvite, sendSessionLinkWhatsApp } from '@/lib/session-whatsapp';

// POST /api/sessions/[sessionId]/guest-link — create (or reuse) a patient
// join link for an already-created session ("Start a new session"). The
// invite is marked CLAIMED with claimedClientId = session.clientId, so opening
// the link lands the patient in THIS session's room (no new session is
// created on join). The link is also sent to the patient on WhatsApp.
export async function POST(request: Request, { params }: { params: { sessionId: string } }) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    const session = await prisma.session.findUnique({
      where: { id: params.sessionId },
      include: { therapist: { select: { userId: true } } },
    });
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (session.therapist.userId !== auth.uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const invite = await getOrCreateGuestInvite(session);
    await sendSessionLinkWhatsApp(session.id, request);

    return NextResponse.json({ token: invite.token });
  } catch (error: any) {
    console.error('Guest link error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
