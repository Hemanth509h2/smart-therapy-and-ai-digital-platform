import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { sendSessionBookedWhatsApp } from '@/lib/session-whatsapp';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const therapistId = searchParams.get('therapistId');
    const clientId = searchParams.get('clientId');

    if (therapistId) {
      // Note count + report presence let the UI flag completed sessions whose
      // documentation is still outstanding ("Notes pending").
      const sessions = await prisma.session.findMany({
        where: { therapistId },
        include: {
          client: true,
          report: { select: { id: true } },
          _count: { select: { notes: true } },
        },
        orderBy: { scheduledAt: 'desc' },
      });
      return NextResponse.json({ sessions });
    }

    if (clientId) {
      const sessions = await prisma.session.findMany({
        where: { clientId },
        include: {
          therapist: true,
        },
        orderBy: { scheduledAt: 'desc' },
      });
      return NextResponse.json({ sessions });
    }

    return NextResponse.json({ error: 'Missing filter parameter' }, { status: 400 });
  } catch (error: any) {
    console.error('Sessions GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { therapistId, clientId, scheduledAt, booking } = await request.json();

    // If clientId is a userId (firebase UID), look up the profile ID
    let finalClientId = clientId;
    if (clientId && !clientId.includes('-')) {
      const clientProfile = await prisma.profileClient.findUnique({
        where: { userId: clientId },
      });
      if (clientProfile) {
        finalClientId = clientProfile.id;
      } else {
        return NextResponse.json({ error: 'Client not found' }, { status: 404 });
      }
    }

    const session = await prisma.session.create({
      data: {
        therapistId,
        clientId: finalClientId,
        scheduledAt: new Date(scheduledAt),
        status: 'SCHEDULED',
      },
      include: {
        client: true,
        therapist: true,
      },
    });

    // A booking gets a date/time confirmation (no link). Instant sessions get
    // nothing here — the join link is sent when the session is started.
    if (booking) await sendSessionBookedWhatsApp(session.id);

    return NextResponse.json({ session });
  } catch (error: any) {
    console.error('Session creation error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
