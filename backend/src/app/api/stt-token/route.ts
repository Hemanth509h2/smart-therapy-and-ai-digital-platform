import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/apiAuth';
import { prisma } from '@/lib/db';
import { mintSttToken } from '@/lib/stt-token';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }

    // Verify therapist is part of the session
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { therapist: true },
    });

    if (!session || session.therapist.userId !== auth.uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const secret = process.env.STT_TOKEN_SECRET;
    if (!secret) {
      return NextResponse.json({ error: 'STT_TOKEN_SECRET not configured' }, { status: 503 });
    }

    const sttToken = mintSttToken(sessionId, secret);
    return NextResponse.json({ token: sttToken });
  } catch (error: any) {
    console.error('[stt-token]', error);
    return NextResponse.json({ error: 'Failed to mint token' }, { status: 500 });
  }
}
