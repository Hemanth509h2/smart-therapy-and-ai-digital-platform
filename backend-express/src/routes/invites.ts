import { Router } from 'express';
import { randomUUID } from 'crypto';
import { prisma, appDb } from '@/lib/core/db';
import { requireAuth } from '@/lib/http/apiAuth';
import { errorResponse, notYourProfile } from '@/lib/http/apiError';
import { adminAuth } from '@/lib/core/firebaseAdmin';
import { provisionSessionDocs } from '@/lib/sessions/session-provisioning';
import { createLobbyEntry } from '@/lib/sessions/lobby';
import { handle, queryParams, send } from '@/lib/http/reply';
import { limitByIp } from '@/lib/http/rateLimit';

export const router = Router();

// Invite links are opened signed out, so these are limited per IP. Tokens are
// unguessable; this stops scripted guessing and join spam (each join creates
// a guest account).
const inviteLimit = limitByIp({ name: 'invite-token', limit: 30, windowMs: 10 * 60 * 1000 });

// ---- /api/invites --------------------------------------------------------------

// The caller must own the therapist profile or be an ADMIN.
async function mayAccessTherapist(uid: string, therapistId: string) {
  const [therapist, user] = await Promise.all([
    appDb.profileTherapist.findUnique({ where: { id: therapistId }, select: { userId: true } }),
    prisma.user.findUnique({ where: { id: uid }, select: { role: true } }),
  ]);
  return therapist?.userId === uid || user?.role === 'ADMIN';
}

// POST /api/invites (therapist creates a bare invite) was removed: nothing
// called it, and it bypassed the consent and date-of-birth checks that
// POST /api/clients requires. Join links come from
// POST /api/sessions/:sessionId/guest-link and the automation join-link route.

// GET /api/invites?therapistId=... — list a therapist's invites (optional, for dashboard).
router.get('/invites', handle(async (req, res) => {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return send(res, auth.response);

    const searchParams = queryParams(req);
    const therapistId = searchParams.get('therapistId');
    if (!therapistId) {
      return res.status(400).json({ error: "Your therapist profile hasn't loaded yet. Refresh the page and try again." });
    }
    if (!(await mayAccessTherapist(auth.uid, therapistId))) {
      return send(res, notYourProfile('these invites'));
    }

    const invites = await prisma.invite.findMany({
      where: { therapistId },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ invites });
  } catch (error: any) {
    return send(res, errorResponse(error, 'invites GET'));
  }
}));

// ---- /api/invites/:token -------------------------------------------------------

// GET /api/invites/[token] — fetch invite details for the signup banner + onboarding prefill.
router.get('/invites/:token', inviteLimit, handle(async (req, res) => {
  try {
    const { token } = req.params;

    const invite = await prisma.invite.findUnique({
      where: { token },
    });

    if (!invite) {
      return res.status(404).json({ error: 'That invite link is not valid. Ask your therapist for a new invite.' });
    }

    // Expired, or its session already ended: say so before the patient sees a
    // "Join session" button that can only fail (the join route rejects it too).
    let expired = invite.status === 'EXPIRED' || (invite.expiresAt !== null && invite.expiresAt < new Date());
    if (!expired && invite.status === 'CLAIMED') {
      const session = await prisma.session.findFirst({
        where: { clientId: invite.claimedClientId ?? '__none__', therapistId: invite.therapistId },
        orderBy: { createdAt: 'desc' },
        select: { status: true },
      });
      expired = session?.status === 'COMPLETED' || session?.status === 'CANCELLED';
    }
    if (expired) {
      return res.status(410).json({ error: 'This session has ended and its link can no longer be used. Ask your therapist for a new link.' });
    }

    const therapist = await appDb.profileTherapist.findUnique({
      where: { id: invite.therapistId },
      select: { firstName: true, lastName: true },
    });

    return res.json({
      invite: {
        token: invite.token,
        firstName: invite.firstName,
        lastName: invite.lastName,
        status: invite.status,
        therapistName: therapist ? `${therapist.firstName} ${therapist.lastName}`.trim() : '',
      },
    });
  } catch (error: any) {
    return send(res, errorResponse(error, 'invites/[token] GET'));
  }
}));

// ---- /api/invites/:token/join --------------------------------------------------

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
router.post('/invites/:token/join', inviteLimit, handle(async (req, res) => {
  try {
    const body = req.body;
    // Server-generated guest id — never trust a client-supplied uid.
    const guestUid = `guest:${randomUUID()}`;

    const invite = await prisma.invite.findUnique({
      where: { token: req.params.token },
    });

    if (!invite) {
      return res.status(404).json({ error: 'That invite link is not valid. Ask your therapist for a new invite.' });
    }
    if (invite.status === 'EXPIRED' || (invite.expiresAt && invite.expiresAt < new Date())) {
      return res.status(410).json({ error: 'This invite has expired. Ask your therapist for a new link.' });
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
        select: { id: true, status: true },
      });
      if (!session) {
        return res.status(409).json({ error: 'The session for this invite no longer exists. Ask your therapist for a new link.' });
      }
      // Call already ended (or cancelled) — the invite link is dead.
      if (session.status === 'COMPLETED' || session.status === 'CANCELLED') {
        await prisma.invite.update({
          where: { id: invite.id },
          data: { status: 'EXPIRED', expiresAt: new Date() },
        });
        return res.status(410).json({ error: 'This invite has expired. Ask your therapist for a new link.' });
      }
      sessionId = session.id;
    }

    // Make sure the room exists. Best-effort: the Admin SDK needs outbound
    // access to Google, which some dev networks block. The guest is NOT added to
    // allowedUids here: they get Firestore access and a LiveKit token only once
    // the therapist admits them from the waiting room (see lib/sessions/lobby.ts).
    try {
      // The session is open in Postgres (ended ones were rejected above), so a
      // leftover 'ended' flag on the room is stale: clear it, or the guest is
      // bounced straight back out.
      await provisionSessionDocs(sessionId, { reopen: true });
    } catch (e) {
      console.warn('[invites/join] Firestore provisioning failed (non-fatal):', (e as Error).message);
    }

    // Put the guest in the waiting room. Required: without this entry the
    // therapist can never admit them.
    const clientName = `${invite.firstName} ${invite.lastName}`.trim() || 'Guest';
    await createLobbyEntry(sessionId, guestUid, clientName);
    const therapist = await appDb.profileTherapist.findUnique({
      where: { id: invite.therapistId },
      select: { firstName: true, lastName: true },
    });

    return res.json({
      sessionId,
      clientName,
      therapistName: therapist ? `${therapist.firstName} ${therapist.lastName}`.trim() : '',
      guestUid,
      // Custom token lets the patient sign in with signInWithCustomToken —
      // no Anonymous auth provider needed in the Firebase console.
      guestToken: await adminAuth().createCustomToken(guestUid),
    });
  } catch (error: any) {
    return send(res, errorResponse(error, '[invites/join]'));
  }
}));
