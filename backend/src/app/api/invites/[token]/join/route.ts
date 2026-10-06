import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { provisionSessionDocs } from '@/lib/session-provisioning';

export const dynamic = 'force-dynamic';

/**
 * POST /api/invites/[token]/join — GUEST join, no account required.
 *
 * The invite token itself is the credential (an unguessable UUID that was
 * delivered only to the patient). The browser signs in to Firebase
 * anonymously and sends that uid as `guestUid`; it is used ONLY to grant the
 * guest access to the session's Firestore docs (liveSessions.allowedUids) —
 * the database rows use their own synthetic ids so one browser can claim
 * many invites over time.
 *
 * Idempotent: a PENDING invite is claimed (guest client + session created);
 * an already-CLAIMED invite simply returns the existing session again, so
 * refreshes and rejoins from the same link keep working.
 */
export async function POST(request: Request, { params }: { params: { token: string } }) {
  try {
    const body = await request.json().catch(() => ({}));
    const guestUid = typeof body.guestUid === 'string' ? body.guestUid : '';
    if (guestUid.length < 8 || guestUid.length > 128) {
      return NextResponse.json({ error: 'guestUid is required' }, { status: 400 });
    }

    const invite = await prisma.invite.findUnique({
      where: { token: params.token },
      include: { therapist: { select: { id: true, userId: true, firstName: true, lastName: true } } },
    });

    if (!invite) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
    }
    if (invite.status === 'EXPIRED' || (invite.expiresAt && invite.expiresAt < new Date())) {
      return NextResponse.json({ error: 'This invite has expired. Ask your therapist for a new link.' }, { status: 410 });
    }

    let sessionId: string;

    if (invite.status === 'PENDING') {
      // First join: create the guest client + session and claim the invite,
      // all in one transaction. The guest User id is synthetic — the real
      // (anonymous) Firebase uid only appears in Firestore allowedUids.
      const session = await prisma.$transaction(async (tx) => {
        const guestUser = await tx.user.create({
          data: {
            id: `guest:${randomUUID()}`,
            email: `guest-${randomUUID()}@guest.staad.local`,
            role: 'CLIENT',
          },
        });
        const profile = await tx.profileClient.create({
          data: {
            userId: guestUser.id,
            firstName: invite.firstName || 'Guest',
            lastName: invite.lastName || '',
            dateOfBirth: new Date(),
            diagnosis: invite.diagnosis || [],
            phoneNumber: invite.phoneNumber,
          },
        });
        const s = await tx.session.create({
          data: {
            therapistId: invite.therapistId,
            clientId: profile.id,
            scheduledAt: invite.scheduledAt,
            status: 'SCHEDULED',
          },
        });
        await tx.invite.update({
          where: { id: invite.id },
          data: { status: 'CLAIMED', claimedClientId: profile.id },
        });
        return s;
      });
      sessionId = session.id;
    } else {
      // CLAIMED — rejoin the session created on the first join.
      const session = await prisma.session.findFirst({
        where: { clientId: invite.claimedClientId ?? '__none__', therapistId: invite.therapistId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (!session) {
        return NextResponse.json({ error: 'Session for this invite no longer exists' }, { status: 409 });
      }
      sessionId = session.id;
    }

    // Grant Firestore access (liveSessions.allowedUids += guestUid) so the
    // guest can read/write session state. Best-effort: the Admin SDK needs
    // outbound access to Google, which some dev networks block — never fail
    // the join over it; the LiveKit call itself does not depend on it.
    try {
      await provisionSessionDocs(sessionId, { extraUids: [guestUid] });
    } catch (e) {
      console.warn('[invites/join] Firestore provisioning failed (non-fatal):', (e as Error).message);
    }

    return NextResponse.json({
      sessionId,
      clientName: `${invite.firstName} ${invite.lastName}`.trim() || 'Guest',
      therapistName: `${invite.therapist.firstName} ${invite.therapist.lastName}`.trim(),
    });
  } catch (error: any) {
    console.error('[invites/join]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
