import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/db';
import { requireAuth } from '@/lib/http/apiAuth';
import { errorResponse } from '@/lib/http/apiError';
import { provisionSessionDocs } from '@/lib/sessions/session-provisioning';
import { getLobbyEntry, listWaiting, setLobbyStatus, touchLobbyEntry } from '@/lib/sessions/lobby';

export const dynamic = 'force-dynamic';

// Waiting room for invite-link guests (see lib/sessions/lobby.ts).
//   POST  — guest knocks (polled every few seconds); returns their status
//   GET   — therapist lists who is waiting
//   PATCH — therapist admits or denies one guest: { uid, action: 'admit' | 'deny' }

type Params = { params: { sessionId: string } };

export async function POST(request: Request, { params }: Params) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    const session = await prisma.session.findUnique({
      where: { id: params.sessionId },
      select: { status: true, therapist: { select: { firstName: true, lastName: true } } },
    });
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    // Only a uid that came through this session's invite link has an entry.
    const entry = await getLobbyEntry(params.sessionId, auth.uid);
    if (!entry) return NextResponse.json({ error: 'Not invited to this session' }, { status: 403 });

    if (session.status === 'COMPLETED' || session.status === 'CANCELLED') {
      return NextResponse.json({ status: 'ended' });
    }
    if (entry.status === 'waiting') await touchLobbyEntry(params.sessionId, auth.uid);

    return NextResponse.json({
      status: entry.status,
      therapistName: `${session.therapist.firstName} ${session.therapist.lastName}`.trim(),
    });
  } catch (error) {
    return errorResponse(error, '[lobby knock]');
  }
}

export async function GET(request: Request, { params }: Params) {
  try {
    const owner = await requireSessionTherapist(request, params.sessionId);
    if (!owner.ok) return owner.response;
    return NextResponse.json({ waiting: await listWaiting(params.sessionId) });
  } catch (error) {
    return errorResponse(error, '[lobby list]');
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const owner = await requireSessionTherapist(request, params.sessionId);
    if (!owner.ok) return owner.response;

    const { uid, action } = await request.json().catch(() => ({}));
    if (typeof uid !== 'string' || (action !== 'admit' && action !== 'deny')) {
      return NextResponse.json({ error: "Body must be { uid, action: 'admit' | 'deny' }" }, { status: 400 });
    }
    const entry = await getLobbyEntry(params.sessionId, uid);
    if (!entry) return NextResponse.json({ error: 'Not in the waiting room' }, { status: 404 });

    if (action === 'admit') {
      // Grant Firestore access first, so the guest's room page can read the
      // session as soon as it sees it was admitted.
      await provisionSessionDocs(params.sessionId, { extraUids: [uid] });
      await setLobbyStatus(params.sessionId, uid, 'admitted');
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
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { therapist: { select: { userId: true } } },
  });
  if (!session || session.therapist.userId !== auth.uid) {
    return { ok: false as const, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return auth;
}
