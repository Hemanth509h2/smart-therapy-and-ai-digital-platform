import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/db';
import { requireAuth } from '@/lib/http/apiAuth';
import { requireTherapist } from '@/lib/http/progressAuth';
import { requireActivePlan } from '@/lib/billing/subscriptions';
import { errorResponse } from '@/lib/http/apiError';

// Session notes belong to the session's therapist; admins may read them too.
async function mayAccessSession(uid: string, sessionId: string) {
  const [session, user] = await Promise.all([
    prisma.session.findUnique({ where: { id: sessionId }, select: { therapist: { select: { userId: true } } } }),
    prisma.user.findUnique({ where: { id: uid }, select: { role: true } }),
  ]);
  return session?.therapist.userId === uid || user?.role === 'ADMIN';
}

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const clientId = searchParams.get('clientId');

    // Every session note this therapist wrote for one client (client profile).
    if (clientId) {
      const auth = await requireTherapist(request);
      if (!auth.ok) return auth.response;
      const notes = await prisma.therapistNote.findMany({
        where: { therapistId: auth.therapist.id, session: { clientId } },
        include: { session: { select: { id: true, scheduledAt: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return NextResponse.json({ notes });
    }

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId or clientId is required' }, { status: 400 });
    }
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    if (!(await mayAccessSession(auth.uid, sessionId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const notes = await prisma.therapistNote.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ notes });
  } catch (error: any) {
    return errorResponse(error, 'notes GET');
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    const { sessionId, therapistId, content, isPrivate } = await request.json();
    // Only the session's own therapist may write its notes.
    const session = sessionId
      ? await prisma.session.findUnique({ where: { id: sessionId }, select: { therapistId: true, therapist: { select: { userId: true } } } })
      : null;
    if (!session || session.therapistId !== therapistId || session.therapist.userId !== auth.uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (typeof therapistId === 'string') {
      const noPlan = await requireActivePlan({ therapistId });
      if (noPlan) return noPlan;
    }

    const note = await prisma.therapistNote.create({
      data: {
        sessionId,
        therapistId,
        content,
        isPrivate: isPrivate ?? true,
      },
    });

    return NextResponse.json({ note });
  } catch (error: any) {
    return errorResponse(error, 'notes POST');
  }
}
