import { NextResponse } from 'next/server';
import { RoomServiceClient } from 'livekit-server-sdk';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/apiAuth';
import { errorResponse } from '@/lib/apiError';
import { isTranslationLanguage } from '@/lib/translationLanguages';

// POST /api/sessions/[sessionId]/translation — push the caption languages to
// everyone already in the LiveKit room, without a reconnect.
//
// The languages used to be signed into the access token only, so every toggle
// or language change minted a new token and remounted the whole call. Now the
// token carries them for the initial join, and changes mid-call are applied
// here as participant attributes via the server API. Still server-side, so a
// participant cannot redirect someone else's audio to a different model.
//
// Body: { enabled: boolean, therapist: string, client: string } — the
// language each side SPEAKS. Therapist-only, like the setting itself.
export async function POST(request: Request, { params }: { params: { sessionId: string } }) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    const session = await prisma.session.findUnique({
      where: { id: params.sessionId },
      include: { therapist: { select: { userId: true } } },
    });
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (session.therapist.userId !== auth.uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const enabled = body.enabled === true;
    const therapist = isTranslationLanguage(body.therapist) ? body.therapist : null;
    const client = isTranslationLanguage(body.client) ? body.client : null;
    if (enabled && (!therapist || !client)) {
      return NextResponse.json({ error: 'Invalid languages' }, { status: 400 });
    }

    const url = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL;
    if (!url) {
      return NextResponse.json({ error: 'LIVEKIT_URL not set' }, { status: 500 });
    }
    const svc = new RoomServiceClient(
      url.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:'),
      process.env.LIVEKIT_API_KEY!,
      process.env.LIVEKIT_API_SECRET!,
    );

    let people;
    try {
      people = await svc.listParticipants(params.sessionId);
    } catch {
      // Room not created yet — nobody to update; the next token carries them.
      return NextResponse.json({ updated: 0 });
    }

    // You SPEAK your own language and READ the other side's. An empty value
    // deletes the attribute, which is the agent's off switch.
    let updated = 0;
    for (const p of people) {
      const role = p.attributes?.role;
      if (role !== 'therapist' && role !== 'client') continue;
      const source = role === 'therapist' ? therapist : client;
      const target = role === 'therapist' ? client : therapist;
      await svc.updateParticipant(params.sessionId, p.identity, {
        attributes: {
          source_lang: enabled ? source! : '',
          target_lang: enabled ? target! : '',
        },
      });
      updated++;
    }

    return NextResponse.json({ updated });
  } catch (error: any) {
    return errorResponse(error, 'Translation update error');
  }
}
