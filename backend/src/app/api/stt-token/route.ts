import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebaseAdmin';
import { prisma } from '@/lib/db';
import { mintSttToken } from '@/lib/stt-token';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const authorization = request.headers.get('authorization');
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const decoded = await adminAuth().verifyIdToken(token);
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

    if (!session || session.therapist.userId !== decoded.uid) {
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
