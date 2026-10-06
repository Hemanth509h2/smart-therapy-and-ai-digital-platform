import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// GET /api/invites/[token] — fetch invite details for the signup banner + onboarding prefill.
export async function GET(request: Request, { params }: { params: { token: string } }) {
  try {
    const { token } = params;

    const invite = await prisma.invite.findUnique({
      where: { token },
      include: {
        therapist: { select: { firstName: true, lastName: true } },
      },
    });

    if (!invite) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
    }

    return NextResponse.json({
      invite: {
        token: invite.token,
        firstName: invite.firstName,
        lastName: invite.lastName,
        diagnosis: invite.diagnosis,
        status: invite.status,
        therapistName: `${invite.therapist.firstName} ${invite.therapist.lastName}`.trim(),
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
