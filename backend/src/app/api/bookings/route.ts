import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireActivePlan } from '@/lib/subscriptions';
import { requireAuth } from '@/lib/apiAuth';
import { errorResponse } from '@/lib/apiError';

// The caller must own the referenced therapist/client profile or be an ADMIN.
async function mayAccess(uid: string, ref: { therapistId?: string | null; clientId?: string | null }) {
  const [therapist, client, user] = await Promise.all([
    ref.therapistId
      ? prisma.profileTherapist.findUnique({ where: { id: ref.therapistId }, select: { userId: true } })
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
    if ((therapistId || clientId) && !(await mayAccess(auth.uid, { therapistId, clientId }))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (therapistId) {
      const bookings = await prisma.booking.findMany({
        where: { therapistId },
        include: {
          client: true,
        },
        orderBy: { dateTime: 'asc' },
      });
      return NextResponse.json({ bookings });
    }

    if (clientId) {
      const bookings = await prisma.booking.findMany({
        where: { clientId },
        include: {
          therapist: true,
        },
        orderBy: { dateTime: 'asc' },
      });
      return NextResponse.json({ bookings });
    }

    return NextResponse.json({ error: 'Missing filter parameter' }, { status: 400 });
  } catch (error: any) {
    return errorResponse(error, 'bookings GET');
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    const { therapistId, clientId, dateTime, duration } = await request.json();
    if (!therapistId || !(await mayAccess(auth.uid, { therapistId }))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const noPlan = await requireActivePlan({ therapistId });
    if (noPlan) return noPlan;

    const booking = await prisma.booking.create({
      data: {
        therapistId,
        clientId,
        dateTime: new Date(dateTime),
        duration: duration || 50,
      },
    });

    return NextResponse.json({ booking });
  } catch (error: any) {
    return errorResponse(error, 'bookings POST');
  }
}
