import { NextResponse } from 'next/server';
import { prisma, appDb } from '@/lib/core/db';
import { therapistIdForUser, withTherapists } from '@/lib/core/links';
import { requireActivePlan } from '@/lib/billing/subscriptions';
import { requireAuth } from '@/lib/http/apiAuth';
import { sendSessionBookedWhatsApp } from '@/lib/sessions/session-whatsapp';
import { errorResponse } from '@/lib/http/apiError';

// The caller must own the referenced therapist/client profile or be an ADMIN.
async function mayAccess(uid: string, ref: { therapistId?: string | null; clientId?: string | null }) {
  const [therapist, client, user] = await Promise.all([
    ref.therapistId
      ? appDb.profileTherapist.findUnique({ where: { id: ref.therapistId }, select: { userId: true } })
      : null,
    ref.clientId
      ? prisma.profileClient.findUnique({ where: { id: ref.clientId }, select: { userId: true } })
      : null,
    prisma.user.findUnique({ where: { id: uid }, select: { role: true } }),
  ]);
  if (user?.role === 'ADMIN') return true;
  return ref.therapistId ? therapist?.userId === uid : client?.userId === uid;
}

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const therapistId = searchParams.get('therapistId');
    const clientId = searchParams.get('clientId');

    if (therapistId) {
      const owner = await appDb.profileTherapist.findUnique({ where: { id: therapistId }, select: { userId: true } });
      if (!owner || owner.userId !== auth.uid) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
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
      const client = await prisma.profileClient.findUnique({
        where: { id: clientId },
        select: { userId: true, therapistId: true },
      });
      if (
        !client ||
        (client.userId !== auth.uid &&
          (!client.therapistId || client.therapistId !== (await therapistIdForUser(auth.uid))))
      ) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const sessions = await prisma.session.findMany({
        where: { clientId },
        orderBy: { scheduledAt: 'desc' },
      });
      return NextResponse.json({ sessions: await withTherapists(sessions) });
    }

    return NextResponse.json({ error: 'Missing filter parameter' }, { status: 400 });
  } catch (error: any) {
    return errorResponse(error, 'Sessions GET error');
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    const { therapistId, clientId, scheduledAt, booking } = await request.json();
    if (!therapistId || !(await mayAccess(auth.uid, { therapistId }))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const noPlan = await requireActivePlan({ therapistId });
    if (noPlan) return noPlan;

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

    const created = await prisma.session.create({
      data: {
        therapistId,
        clientId: finalClientId,
        scheduledAt: new Date(scheduledAt),
        status: 'SCHEDULED',
      },
      include: {
        client: true,
      },
    });
    const [session] = await withTherapists([created]);

    // A booking gets a date/time confirmation (no link). Instant sessions get
    // nothing here — the join link is sent when the session is started.
    if (booking) await sendSessionBookedWhatsApp(session.id);

    return NextResponse.json({ session });
  } catch (error: any) {
    return errorResponse(error, 'Session creation error');
  }
}
