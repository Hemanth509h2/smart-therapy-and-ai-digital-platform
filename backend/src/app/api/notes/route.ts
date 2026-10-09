import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireTherapist } from '@/lib/progressAuth';

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

    const notes = await prisma.therapistNote.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ notes });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { sessionId, therapistId, content, isPrivate } = await request.json();

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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
