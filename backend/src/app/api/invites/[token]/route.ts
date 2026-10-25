import { NextResponse } from 'next/server';
import { appDb, prisma } from '@/lib/core/db';
import { errorResponse } from '@/lib/http/apiError';

// GET /api/invites/[token] — fetch invite details for the signup banner + onboarding prefill.
export async function GET(request: Request, { params }: { params: { token: string } }) {
  try {
    const { token } = params;

    const invite = await prisma.invite.findUnique({
      where: { token },
    });

    if (!invite) {
      return NextResponse.json({ error: 'That invite link is not valid. Ask your therapist for a new invite.' }, { status: 404 });
    }

    // Expired, or its session already ended: say so before the patient sees a
    // "Join session" button that can only fail (the join route rejects it too).
    let expired = invite.status === 'EXPIRED' || (invite.expiresAt !== null && invite.expiresAt < new Date());
    if (!expired && invite.status === 'CLAIMED') {
      const session = await prisma.session.findFirst({
        where: { clientId: invite.claimedClientId ?? '__none__', therapistId: invite.therapistId },
        orderBy: { createdAt: 'desc' },
        select: { status: true },
      });
      expired = session?.status === 'COMPLETED' || session?.status === 'CANCELLED';
    }
    if (expired) {
      return NextResponse.json({ error: 'This session has ended and its link can no longer be used. Ask your therapist for a new link.' }, { status: 410 });
    }

    const therapist = await appDb.profileTherapist.findUnique({
      where: { id: invite.therapistId },
      select: { firstName: true, lastName: true },
    });

    return NextResponse.json({
      invite: {
        token: invite.token,
        firstName: invite.firstName,
        lastName: invite.lastName,
        diagnosis: invite.diagnosis,
        status: invite.status,
        therapistName: therapist ? `${therapist.firstName} ${therapist.lastName}`.trim() : '',
      },
    });
  } catch (error: any) {
    return errorResponse(error, 'invites/[token] GET');
  }
}
