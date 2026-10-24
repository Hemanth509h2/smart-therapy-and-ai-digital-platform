import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/db';
import { withTherapists } from '@/lib/core/links';
import { requireActivePlan } from '@/lib/billing/subscriptions';
import { provisionSessionDocs } from '@/lib/sessions/session-provisioning';
import { markSessionEnded } from '@/lib/sessions/session-provisioning';
import { sendSessionLinkWhatsApp } from '@/lib/sessions/session-whatsapp';
import { errorResponse } from '@/lib/http/apiError';

// GET /api/sessions/[sessionId] — fetch a single session (with client + therapist).
export async function GET(
  _request: Request,
  { params }: { params: { sessionId: string } }
) {
  try {
    const found = await prisma.session.findUnique({
      where: { id: params.sessionId },
      include: { client: true },
    });
    if (!found) {
      return NextResponse.json({ error: 'This session no longer exists. It may have been deleted.' }, { status: 404 });
    }
    const [session] = await withTherapists([found]);
    return NextResponse.json({ session });
  } catch (error: any) {
    return errorResponse(error, 'Session GET error');
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
      return NextResponse.json({ error: "We couldn't tell what to do with this session. Refresh the page and try again." }, { status: 400 });
    }

    const existing = await prisma.session.findUnique({
      where: { id: params.sessionId },
    });
    if (!existing) {
      return NextResponse.json({ error: 'This session no longer exists. It may have been deleted.' }, { status: 404 });
    }

    // No plan: no new or rescheduled sessions. Cancelling and ending stay open
    // so existing bookings can be wound down, and a call already live can be
    // rejoined.
    if (finalAction === 'reschedule' || (finalAction === 'start' && existing.status !== 'ACTIVE')) {
      const noPlan = await requireActivePlan(
        { therapistId: existing.therapistId },
        finalAction === 'reschedule' ? 'reschedule a session' : 'start a session'
      );
      if (noPlan) return noPlan;
    }

    const now = new Date();
    let data: Record<string, unknown> | null = null;

    // Scheduling actions only touch Postgres — the live room isn't involved, so
    // they return before Firestore provisioning.
    //   - 'cancel':     SCHEDULED -> CANCELLED
    //   - 'reschedule': SCHEDULED/CANCELLED -> SCHEDULED at the new `scheduledAt`
    if (finalAction === 'cancel' || finalAction === 'reschedule') {
      if (finalAction === 'cancel' && existing.status !== 'SCHEDULED') {
        return NextResponse.json({ error: 'This session has already started, ended or been cancelled, so it can no longer be cancelled.' }, { status: 409 });
      }
      if (finalAction === 'reschedule') {
        if (existing.status !== 'SCHEDULED' && existing.status !== 'CANCELLED') {
          return NextResponse.json({ error: 'This session has already started or ended, so it can no longer be rescheduled.' }, { status: 409 });
        }
        if (!finalScheduledAt || Number.isNaN(new Date(finalScheduledAt).getTime())) {
          return NextResponse.json({ error: 'Choose a valid new date and time for the session.' }, { status: 400 });
        }
      }
      const updated = await prisma.session.update({
        where: { id: params.sessionId },
        data:
          finalAction === 'cancel'
            ? { status: 'CANCELLED' }
            : { status: 'SCHEDULED', scheduledAt: new Date(finalScheduledAt) },
        include: { client: true },
      });
      const [session] = await withTherapists([updated]);
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
        await provisionSessionDocs(params.sessionId, {
          reopen: finalAction === 'start' && existing.status !== 'COMPLETED' && existing.status !== 'CANCELLED',
        });
      } catch (e) {
        // Surfaced, not swallowed: without provisioning the participants will
        // be locked out of their own session by the rules.
        console.error('Session provisioning failed:', e);
        return NextResponse.json(
          { error: "We couldn't open the session room. Please try again in a moment." },
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
        { error: "We couldn't tell what to do with this session. Refresh the page and try again." },
        { status: 400 }
      );
    }

    // Nothing to change (e.g. 'start' on an already active/completed session).
    if (!data) {
      return NextResponse.json({ session: existing });
    }

    const [session] = await withTherapists([
      await prisma.session.update({
        where: { id: params.sessionId },
        data,
        include: { client: true },
      }),
    ]);

    // Send the patient join link when the session starts. Skipped if the
    // "Start a new session" dialog already sent it for this session.
    const whatsapp =
      finalAction === 'start' && session.status === 'ACTIVE'
        ? await sendSessionLinkWhatsApp(session.id, request)
        : undefined;

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

    return NextResponse.json({ session, whatsapp });
  } catch (error: any) {
    return errorResponse(error, 'Session PATCH error');
  }
}
