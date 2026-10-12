import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { provisionSessionDocs } from '@/lib/session-provisioning';
import { markSessionEnded } from '@/lib/session-provisioning';
import { sendSessionLinkWhatsApp } from '@/lib/session-whatsapp';

// GET /api/sessions/[sessionId] — fetch a single session (with client + therapist).
export async function GET(
  _request: Request,
  { params }: { params: { sessionId: string } }
) {
  try {
    const session = await prisma.session.findUnique({
      where: { id: params.sessionId },
      include: { client: true, therapist: true },
    });
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    return NextResponse.json({ session });
  } catch (error: any) {
    console.error('Session GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/sessions/[sessionId] — transition a session's lifecycle status.
// Body: { action: 'start' | 'end' }
//   - 'start': SCHEDULED -> ACTIVE, records startedAt (no-op if already started/ended)
//   - 'end':   -> COMPLETED, records endedAt (and startedAt if it was never set).
// Idempotent: ending an already-completed session preserves the original endedAt.
export async function PATCH(
  request: Request,
  { params }: { params: { sessionId: string } }
) {
  try {
    const { action, scheduledAt } = await request.json().catch(() => ({ action: undefined, scheduledAt: undefined })) ?? {};
    // Browsers silently drop the body of PATCH requests sent with
    // `keepalive: true` (e.g. the end-call handler). Accept action/scheduledAt
    // from the query string as a fallback so those calls still work.
    const queryAction = new URL(request.url).searchParams.get('action') ?? undefined;
    const queryScheduledAt = new URL(request.url).searchParams.get('scheduledAt') ?? undefined;
    const finalAction = action ?? queryAction;
    const finalScheduledAt = scheduledAt ?? queryScheduledAt;
    if (!finalAction) {
      return NextResponse.json({ error: 'Missing action' }, { status: 400 });
    }

    const existing = await prisma.session.findUnique({
      where: { id: params.sessionId },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const now = new Date();
    let data: Record<string, unknown> | null = null;

    // Scheduling actions only touch Postgres — the live room isn't involved, so
    // they return before Firestore provisioning.
    //   - 'cancel':     SCHEDULED -> CANCELLED
    //   - 'reschedule': SCHEDULED/CANCELLED -> SCHEDULED at the new `scheduledAt`
    if (finalAction === 'cancel' || finalAction === 'reschedule') {
      if (finalAction === 'cancel' && existing.status !== 'SCHEDULED') {
        return NextResponse.json({ error: 'Only scheduled sessions can be cancelled' }, { status: 409 });
      }
      if (finalAction === 'reschedule') {
        if (existing.status !== 'SCHEDULED' && existing.status !== 'CANCELLED') {
          return NextResponse.json({ error: 'Only scheduled or cancelled sessions can be rescheduled' }, { status: 409 });
        }
        if (!finalScheduledAt || Number.isNaN(new Date(finalScheduledAt).getTime())) {
          return NextResponse.json({ error: 'A valid scheduledAt is required' }, { status: 400 });
        }
      }
      const session = await prisma.session.update({
        where: { id: params.sessionId },
        data:
          finalAction === 'cancel'
            ? { status: 'CANCELLED' }
            : { status: 'SCHEDULED', scheduledAt: new Date(finalScheduledAt) },
        include: { client: true, therapist: true },
      });
      return NextResponse.json({ session });
    }

    // Mirror session entitlement into Firestore before anything else. The
    // security rules authorise every session-scoped read/write against
    // `liveSessions/{id}.allowedUids`, and only the server may write it, so
    // this must succeed before either participant can touch the room.
    //
    // Runs on 'start' and 'end' alike, and is idempotent: 'start' is a no-op in
    // Prisma once a session is already ACTIVE, but a rejoin still needs the
    // documents to exist and the entitlement to be current.
    if (finalAction === 'start' || finalAction === 'end') {
      try {
        await provisionSessionDocs(params.sessionId);
      } catch (e) {
        // Surfaced, not swallowed: without provisioning the participants will
        // be locked out of their own session by the rules.
        console.error('Session provisioning failed:', e);
        return NextResponse.json(
          { error: 'Could not provision session room' },
          { status: 500 }
        );
      }
    }

    if (finalAction === 'start') {
      // Only promote a session that hasn't started or ended yet.
      if (existing.status === 'SCHEDULED') {
        data = {
          status: 'ACTIVE',
          startedAt: existing.startedAt ?? now,
        };
      }
    } else if (finalAction === 'end') {
      // Mark complete; keep the first endedAt if it was already set.
      data = {
        status: 'COMPLETED',
        startedAt: existing.startedAt ?? now,
        endedAt: existing.endedAt ?? now,
      };
    } else {
      return NextResponse.json(
        { error: "Invalid action. Use 'start' or 'end'." },
        { status: 400 }
      );
    }

    // Nothing to change (e.g. 'start' on an already active/completed session).
    if (!data) {
      return NextResponse.json({ session: existing });
    }

    const session = await prisma.session.update({
      where: { id: params.sessionId },
      data,
      include: { client: true, therapist: true },
    });

    // Send the patient join link when the session starts. Skipped if the
    // "Start a new session" dialog already sent it for this session.
    if (finalAction === 'start' && session.status === 'ACTIVE') {
      await sendSessionLinkWhatsApp(session.id, request);
    }

    // When the therapist ends the call, expire the invite link(s) that led to
    // this client so the link can never be used to rejoin after the session,
    // and flag the room as ended so the other participant's screen exits too.
    if (finalAction === 'end') {
      await prisma.invite
        .updateMany({
          where: {
            therapistId: existing.therapistId,
            claimedClientId: existing.clientId,
            status: 'CLAIMED',
          },
          data: { status: 'EXPIRED', expiresAt: now },
        })
        .catch((e) => console.warn('Invite expiry on session end failed:', e));

      if (existing.status !== 'COMPLETED') {
        await markSessionEnded(params.sessionId);
      }
    }

    return NextResponse.json({ session });
  } catch (error: any) {
    console.error('Session PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
