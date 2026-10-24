import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/http/apiAuth';
import { prisma } from '@/lib/core/db';
import { therapistIdForUser } from '@/lib/core/links';
import { mintSttToken } from '@/lib/sessions/stt-token';
import { getSetting } from '@/lib/core/settings';
import { notYourProfile } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    if (!(await getSetting('features.transcription'))) {
      return NextResponse.json({ error: 'Transcription is turned off by an admin.' }, { status: 503 });
    }

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json({ error: "We couldn't tell which session this is for. Refresh the page and try again." }, { status: 400 });
    }

    // Verify therapist is part of the session
    const [session, therapistId] = await Promise.all([
      prisma.session.findUnique({ where: { id: sessionId } }),
      therapistIdForUser(auth.uid),
    ]);

    if (!session || session.therapistId !== therapistId) {
      return notYourProfile('this session');
    }

    const secret = process.env.STT_TOKEN_SECRET;
    if (!secret) {
      return NextResponse.json({ error: "Transcription isn't set up on the server yet. Ask an admin to finish the transcription setup." }, { status: 503 });
    }

    const sttToken = mintSttToken(sessionId, secret);
    return NextResponse.json({ token: sttToken });
  } catch (error: any) {
    console.error('[stt-token]', error);
    return NextResponse.json({ error: "We couldn't start transcription. Please try again." }, { status: 500 });
  }
}
