import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { sendSessionScheduledMessage } from '@/lib/whatsapp-bot';

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
    const { therapistId, clientId, scheduledAt } = await request.json();

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

    // Best-effort WhatsApp notification — a failure here must not fail session
    // creation, so it's logged rather than thrown.
    if (session.client.phoneNumber) {
      const sessionLink = `${new URL(request.url).origin}/session/${session.id}`;
      const now = new Date();
      try {
        const delivery = await prisma.whatsAppMessage.upsert({
          where: { sessionId_messageType: { sessionId: session.id, messageType: 'SESSION_SCHEDULED' } },
          create: {
            id: randomUUID(),
            sessionId: session.id,
            clientId: session.clientId,
            phoneNumber: session.client.phoneNumber,
            generatedLink: sessionLink,
            messageType: 'SESSION_SCHEDULED',
            status: 'SENDING',
            attempts: 1,
            lastAttemptAt: now,
            updatedAt: now,
          },
          update: {
            phoneNumber: session.client.phoneNumber,
            generatedLink: sessionLink,
            status: 'SENDING',
            attempts: { increment: 1 },
            lastAttemptAt: now,
            errorCode: null,
            errorMessage: null,
            updatedAt: now,
          },
        });

        const message = await sendSessionScheduledMessage({
          to: session.client.phoneNumber,
          patientName: session.client.firstName,
          sessionLink,
          scheduledAt: session.scheduledAt,
          therapistName: `${session.therapist.firstName} ${session.therapist.lastName}`.trim(),
        });

        await prisma.whatsAppMessage.update({
          where: { id: delivery.id },
          data: {
            status: 'SENT',
            providerMessageId: message.sid,
            sentAt: new Date(),
            providerStatusAt: new Date(),
            updatedAt: new Date(),
          },
        });
      } catch (error: any) {
        console.error('Session-scheduled WhatsApp notification failed:', error);
        await prisma.whatsAppMessage.updateMany({
          where: { sessionId: session.id, messageType: 'SESSION_SCHEDULED' },
          data: { status: 'FAILED', errorMessage: error?.message || 'WhatsApp send failed', updatedAt: new Date() },
        });
      }
    }

    return NextResponse.json({ session });
  } catch (error: any) {
    console.error('Session creation error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
