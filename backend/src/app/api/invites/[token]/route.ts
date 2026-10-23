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
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
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
