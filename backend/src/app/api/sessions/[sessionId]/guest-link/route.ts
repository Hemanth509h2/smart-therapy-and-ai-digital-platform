import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/apiAuth';

// POST /api/sessions/[sessionId]/guest-link — create (or reuse) a patient
// join link for an already-created session. The invite is marked CLAIMED
// with claimedClientId = session.clientId, so opening the link lands the
// patient in THIS session's room (no new session is created on join).
export async function POST(request: Request, { params }: { params: { sessionId: string } }) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    const session = await prisma.session.findUnique({
      where: { id: params.sessionId },
      include: { client: true, therapist: { select: { userId: true } } },
    });
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (session.therapist.userId !== auth.uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const client = session.client;

    // Reuse a live link if one already exists for this client + therapist.
    let invite = await prisma.invite.findFirst({
      where: {
        therapistId: session.therapistId,
        claimedClientId: session.clientId,
        status: 'CLAIMED',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!invite) {
      invite = await prisma.invite.create({
        data: {
          token: randomUUID(),
          therapistId: session.therapistId,
          firstName: client.firstName,
          lastName: client.lastName,
          diagnosis: client.diagnosis,
          phoneNumber: client.phoneNumber,
          scheduledAt: session.scheduledAt,
          status: 'CLAIMED',
          claimedClientId: client.id,
        },
      });
    }

    return NextResponse.json({ token: invite.token });
  } catch (error: any) {
    console.error('Guest link error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
