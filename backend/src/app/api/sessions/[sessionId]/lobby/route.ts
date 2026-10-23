import { NextResponse } from 'next/server';
import { appDb, prisma } from '@/lib/core/db';
import { therapistIdForUser } from '@/lib/core/links';
import { requireAuth } from '@/lib/http/apiAuth';
import { errorResponse } from '@/lib/http/apiError';
import { provisionSessionDocs, revokeSessionUid } from '@/lib/sessions/session-provisioning';
import { removeParticipantByUid } from '@/lib/sessions/livekit-room';
import { getLobbyEntry, listLobby, setLobbyStatus, touchLobbyEntry } from '@/lib/sessions/lobby';

export const dynamic = 'force-dynamic';

// Waiting room for invite-link guests (see lib/sessions/lobby.ts).
//   POST  — guest knocks (polled every few seconds); returns their status
//   GET   — therapist lists who is waiting and who is in the call
//   PATCH — therapist admits, denies or removes one guest:
//           { uid, action: 'admit' | 'deny' | 'remove' }
//           'remove' takes an admitted guest out of the call: off the LiveKit
//           room, out of allowedUids, and no new video token. Opening the
//           invite link again puts them back in the waiting room.

type Params = { params: { sessionId: string } };

export async function POST(request: Request, { params }: Params) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    const session = await prisma.session.findUnique({
      where: { id: params.sessionId },
      select: { status: true, therapistId: true },
    });
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    // Only a uid that came through this session's invite link has an entry.
    const entry = await getLobbyEntry(params.sessionId, auth.uid);
    if (!entry) return NextResponse.json({ error: 'Not invited to this session' }, { status: 403 });

    if (session.status === 'COMPLETED' || session.status === 'CANCELLED') {
      return NextResponse.json({ status: 'ended' });
    }
    // Admitted guests keep polling too (to learn if they were removed), which
    // is what keeps them listed under "In the call" for the therapist.
    if (entry.status === 'waiting' || entry.status === 'admitted') await touchLobbyEntry(params.sessionId, entry);

    const therapist = await appDb.profileTherapist.findUnique({
      where: { id: session.therapistId },
      select: { firstName: true, lastName: true },
    });
    return NextResponse.json({
      status: entry.status,
      therapistName: therapist ? `${therapist.firstName} ${therapist.lastName}`.trim() : '',
    });
  } catch (error) {
    return errorResponse(error, '[lobby knock]');
  }
}

export async function GET(request: Request, { params }: Params) {
  try {
    const owner = await requireSessionTherapist(request, params.sessionId);
    if (!owner.ok) return owner.response;
    return NextResponse.json(await listLobby(params.sessionId));
  } catch (error) {
    return errorResponse(error, '[lobby list]');
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const owner = await requireSessionTherapist(request, params.sessionId);
    if (!owner.ok) return owner.response;

    const { uid, action } = await request.json().catch(() => ({}));
    if (typeof uid !== 'string' || !['admit', 'deny', 'remove'].includes(action)) {
      return NextResponse.json({ error: "Body must be { uid, action: 'admit' | 'deny' | 'remove' }" }, { status: 400 });
    }
    const entry = await getLobbyEntry(params.sessionId, uid);
    if (!entry) return NextResponse.json({ error: 'Not in the waiting room' }, { status: 404 });

    if (action === 'admit') {
      // Grant Firestore access first, so the guest's room page can read the
      // session as soon as it sees it was admitted.
      await provisionSessionDocs(params.sessionId, { extraUids: [uid] });
      await setLobbyStatus(params.sessionId, uid, 'admitted');
    } else if (action === 'remove') {
      // Status first: from here on /api/livekit-token refuses this uid, so the
      // guest can't reconnect while being kicked.
      await setLobbyStatus(params.sessionId, uid, 'removed');
      await revokeSessionUid(params.sessionId, uid);
      const kicked = await removeParticipantByUid(params.sessionId, uid, entry.name).catch((e) => {
        console.error('[lobby remove] LiveKit removal failed:', (e as Error).message);
        return 0;
      });
      return NextResponse.json({ ok: true, disconnected: kicked });
    } else {
      await setLobbyStatus(params.sessionId, uid, 'denied');
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, '[lobby decide]');
  }
}

async function requireSessionTherapist(request: Request, sessionId: string) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth;
  const [session, therapistId] = await Promise.all([
    prisma.session.findUnique({ where: { id: sessionId }, select: { therapistId: true } }),
    therapistIdForUser(auth.uid),
  ]);
  if (!session || session.therapistId !== therapistId) {
    return { ok: false as const, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return auth;
}
