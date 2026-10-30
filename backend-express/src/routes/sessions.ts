import { Router, type Request } from 'express';
import { prisma, appDb } from '@/lib/core/db';
import { therapistIdForUser, withTherapists } from '@/lib/core/links';
import { requireActivePlan } from '@/lib/billing/subscriptions';
import { requireAuth } from '@/lib/http/apiAuth';
import { errorResponse, notYourProfile } from '@/lib/http/apiError';
import { provisionSessionDocs, markSessionEnded, revokeSessionUid } from '@/lib/sessions/session-provisioning';
import { getOrCreateGuestInvite } from '@/lib/sessions/guest-invite';
import { removeParticipantByUid } from '@/lib/sessions/livekit-room';
import { getLobbyEntry, listLobby, setLobbyStatus, touchLobbyEntry } from '@/lib/sessions/lobby';
import { RoomServiceClient } from 'livekit-server-sdk';
import { isTranslationLanguage } from '@/lib/sessions/translationLanguages';
import { handle, queryParams, send } from '@/lib/http/reply';

export const router = Router();

// ---- /api/sessions -------------------------------------------------------------

// The caller must own the referenced therapist/client profile or be an ADMIN.
async function mayAccess(uid: string, ref: { therapistId?: string | null; clientId?: string | null }) {
  const [therapist, client, user] = await Promise.all([
    ref.therapistId
      ? appDb.profileTherapist.findUnique({ where: { id: ref.therapistId }, select: { userId: true } })
      : null,
    ref.clientId
      ? prisma.profileClient.findUnique({ where: { id: ref.clientId }, select: { userId: true } })
      : null,
    prisma.user.findUnique({ where: { id: uid }, select: { role: true } }),
  ]);
  if (user?.role === 'ADMIN') return true;
  return ref.therapistId ? therapist?.userId === uid : client?.userId === uid;
}


router.get('/sessions', handle(async (req, res) => {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return send(res, auth.response);

    const searchParams = queryParams(req);
    const therapistId = searchParams.get('therapistId');
    const clientId = searchParams.get('clientId');

    if (therapistId) {
      const owner = await appDb.profileTherapist.findUnique({ where: { id: therapistId }, select: { userId: true } });
      if (!owner || owner.userId !== auth.uid) {
        return send(res, notYourProfile('these sessions'));
      }
      // Note count + report presence let the UI flag completed sessions whose
      // documentation is still outstanding ("Notes pending").
      const sessions = await prisma.session.findMany({
        where: { therapistId },
        include: {
          client: true,
          report: { select: { id: true } },
          _count: { select: { notes: true } },
        },
        orderBy: { scheduledAt: 'desc' },
      });
      return res.json({ sessions });
    }

    if (clientId) {
      const client = await prisma.profileClient.findUnique({
        where: { id: clientId },
        select: { userId: true, therapistId: true },
      });
      if (
        !client ||
        (client.userId !== auth.uid &&
          (!client.therapistId || client.therapistId !== (await therapistIdForUser(auth.uid))))
      ) {
        return send(res, notYourProfile("this client's sessions"));
      }
      const sessions = await prisma.session.findMany({
        where: { clientId },
        orderBy: { scheduledAt: 'desc' },
      });
      return res.json({ sessions: await withTherapists(sessions) });
    }

    return res.status(400).json({ error: 'Choose whose sessions to show.' });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Sessions GET error'));
  }
}));

router.post('/sessions', handle(async (req, res) => {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return send(res, auth.response);

    const { therapistId, clientId, scheduledAt, booking } = req.body;
    if (!therapistId || !(await mayAccess(auth.uid, { therapistId }))) {
      return send(res, notYourProfile('this therapist profile'));
    }
    const noPlan = await requireActivePlan({ therapistId }, booking ? 'book a session' : 'start a session');
    if (noPlan) return send(res, noPlan);

    // If clientId is a userId (firebase UID), look up the profile ID
    let finalClientId = clientId;
    if (clientId && !clientId.includes('-')) {
      const clientProfile = await prisma.profileClient.findUnique({
        where: { userId: clientId },
      });
      if (clientProfile) {
        finalClientId = clientProfile.id;
      } else {
        return res.status(404).json({ error: "We couldn't find that client. They may have been removed." });
      }
    }

    const created = await prisma.session.create({
      data: {
        therapistId,
        clientId: finalClientId,
        scheduledAt: new Date(scheduledAt),
        status: 'SCHEDULED',
      },
      include: {
        client: true,
      },
    });
    const [session] = await withTherapists([created]);

    return res.json({ session });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Session creation error'));
  }
}));

// ---- /api/sessions/:sessionId --------------------------------------------------

// GET /api/sessions/[sessionId] — fetch a single session (with client + therapist).
router.get('/sessions/:sessionId', handle(async (req, res) => {
  try {
    const found = await prisma.session.findUnique({
      where: { id: req.params.sessionId },
      include: { client: true },
    });
    if (!found) {
      return res.status(404).json({ error: 'This session no longer exists. It may have been deleted.' });
    }
    const [session] = await withTherapists([found]);
    return res.json({ session });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Session GET error'));
  }
}));

// PATCH /api/sessions/[sessionId] — transition a session's lifecycle status.
// Body: { action: 'start' | 'end' }
//   - 'start': SCHEDULED -> ACTIVE, records startedAt (no-op if already started/ended)
//   - 'end':   -> COMPLETED, records endedAt (and startedAt if it was never set).
// Idempotent: ending an already-completed session preserves the original endedAt.
router.patch('/sessions/:sessionId', handle(async (req, res) => {
  try {
    const { action, scheduledAt } = req.body.catch(() => ({ action: undefined, scheduledAt: undefined })) ?? {};
    // Browsers silently drop the body of PATCH requests sent with
    // `keepalive: true` (e.g. the end-call handler). Accept action/scheduledAt
    // from the query string as a fallback so those calls still work.
    const queryAction = queryParams(req).get('action') ?? undefined;
    const queryScheduledAt = queryParams(req).get('scheduledAt') ?? undefined;
    const finalAction = action ?? queryAction;
    const finalScheduledAt = scheduledAt ?? queryScheduledAt;
    if (!finalAction) {
      return res.status(400).json({ error: "We couldn't tell what to do with this session. Refresh the page and try again." });
    }

    const existing = await prisma.session.findUnique({
      where: { id: req.params.sessionId },
    });
    if (!existing) {
      return res.status(404).json({ error: 'This session no longer exists. It may have been deleted.' });
    }

    // No plan: no new or rescheduled sessions. Cancelling and ending stay open
    // so existing bookings can be wound down, and a call already live can be
    // rejoined.
    if (finalAction === 'reschedule' || (finalAction === 'start' && existing.status !== 'ACTIVE')) {
      const noPlan = await requireActivePlan(
        { therapistId: existing.therapistId },
        finalAction === 'reschedule' ? 'reschedule a session' : 'start a session'
      );
      if (noPlan) return send(res, noPlan);
    }

    const now = new Date();
    let data: Record<string, unknown> | null = null;

    // Scheduling actions only touch Postgres — the live room isn't involved, so
    // they return before Firestore provisioning.
    //   - 'cancel':     SCHEDULED -> CANCELLED
    //   - 'reschedule': SCHEDULED/CANCELLED -> SCHEDULED at the new `scheduledAt`
    if (finalAction === 'cancel' || finalAction === 'reschedule') {
      if (finalAction === 'cancel' && existing.status !== 'SCHEDULED') {
        return res.status(409).json({ error: 'This session has already started, ended or been cancelled, so it can no longer be cancelled.' });
      }
      if (finalAction === 'reschedule') {
        if (existing.status !== 'SCHEDULED' && existing.status !== 'CANCELLED') {
          return res.status(409).json({ error: 'This session has already started or ended, so it can no longer be rescheduled.' });
        }
        if (!finalScheduledAt || Number.isNaN(new Date(finalScheduledAt).getTime())) {
          return res.status(400).json({ error: 'Choose a valid new date and time for the session.' });
        }
      }
      const updated = await prisma.session.update({
        where: { id: req.params.sessionId },
        data:
          finalAction === 'cancel'
            ? { status: 'CANCELLED' }
            : { status: 'SCHEDULED', scheduledAt: new Date(finalScheduledAt) },
        include: { client: true },
      });
      const [session] = await withTherapists([updated]);
      return res.json({ session });
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
        await provisionSessionDocs(req.params.sessionId, {
          reopen: finalAction === 'start' && existing.status !== 'COMPLETED' && existing.status !== 'CANCELLED',
        });
      } catch (e) {
        console.error('Session provisioning failed:', e);
        // Surfaced on 'start', not swallowed: without provisioning the
        // participants will be locked out of their own session by the rules.
        // 'end' carries on: completing the session and expiring the patient's
        // link must not depend on Firestore being reachable.
        if (finalAction === 'start') {
          return res.status(500).json({ error: "We couldn't open the session room. Please try again in a moment." });
        }
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
      return res.status(400).json({ error: "We couldn't tell what to do with this session. Refresh the page and try again." });
    }

    // Nothing to change (e.g. 'start' on an already active/completed session).
    if (!data) {
      return res.json({ session: existing });
    }

    const [session] = await withTherapists([
      await prisma.session.update({
        where: { id: req.params.sessionId },
        data,
        include: { client: true },
      }),
    ]);

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
        await markSessionEnded(req.params.sessionId);
      }
    }

    return res.json({ session });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Session PATCH error'));
  }
}));

// ---- /api/sessions/:sessionId/guest-link ---------------------------------------

// POST /api/sessions/[sessionId]/guest-link — create (or reuse) a patient
// join link for an already-created session ("Start a new session"). The
// invite is marked CLAIMED with claimedClientId = session.clientId, so opening
// the link lands the patient in THIS session's room (no new session is
// created on join). The therapist shares it themselves (Copy or WhatsApp).
router.post('/sessions/:sessionId/guest-link', handle(async (req, res) => {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return send(res, auth.response);

    const [session, therapistId] = await Promise.all([
      prisma.session.findUnique({ where: { id: req.params.sessionId } }),
      therapistIdForUser(auth.uid),
    ]);
    if (!session) {
      return res.status(404).json({ error: 'This session no longer exists. It may have been deleted.' });
    }
    if (session.therapistId !== therapistId) {
      return send(res, notYourProfile('this session'));
    }
    const noPlan = await requireActivePlan({ therapistId: session.therapistId }, 'send a session link');
    if (noPlan) return send(res, noPlan);

    const invite = await getOrCreateGuestInvite(session);

    return res.json({ token: invite.token });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Guest link error'));
  }
}));

// ---- /api/sessions/:sessionId/lobby --------------------------------------------

// Waiting room for invite-link guests (see lib/sessions/lobby.ts).
//   POST  — guest knocks (polled every few seconds); returns their status
//   GET   — therapist lists who is waiting and who is in the call
//   PATCH — therapist admits, denies or removes one guest:
//           { uid, action: 'admit' | 'deny' | 'remove' }
//           'remove' takes an admitted guest out of the call: off the LiveKit
//           room, out of allowedUids, and no new video token. Opening the
//           invite link again puts them back in the waiting room.

type Params = { params: { sessionId: string } };

router.post('/sessions/:sessionId/lobby', handle(async (req, res) => {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return send(res, auth.response);

    const session = await prisma.session.findUnique({
      where: { id: req.params.sessionId },
      select: { status: true, therapistId: true },
    });
    if (!session) return res.status(404).json({ error: 'This session no longer exists. It may have been deleted.' });

    // Only a uid that came through this session's invite link has an entry.
    const entry = await getLobbyEntry(req.params.sessionId, auth.uid);
    if (!entry) return res.status(403).json({ error: "You haven't been invited to this session. Open the invite link your therapist sent you." });

    if (session.status === 'COMPLETED' || session.status === 'CANCELLED') {
      return res.json({ status: 'ended' });
    }
    // Admitted guests keep polling too (to learn if they were removed), which
    // is what keeps them listed under "In the call" for the therapist.
    if (entry.status === 'waiting' || entry.status === 'admitted') await touchLobbyEntry(req.params.sessionId, entry);

    const therapist = await appDb.profileTherapist.findUnique({
      where: { id: session.therapistId },
      select: { firstName: true, lastName: true },
    });
    return res.json({
      status: entry.status,
      therapistName: therapist ? `${therapist.firstName} ${therapist.lastName}`.trim() : '',
    });
  } catch (error) {
    return send(res, errorResponse(error, '[lobby knock]'));
  }
}));

router.get('/sessions/:sessionId/lobby', handle(async (req, res) => {
  try {
    const owner = await requireSessionTherapist(req, req.params.sessionId);
    if (!owner.ok) return send(res, owner.response);
    return res.json(await listLobby(req.params.sessionId));
  } catch (error) {
    return send(res, errorResponse(error, '[lobby list]'));
  }
}));

router.patch('/sessions/:sessionId/lobby', handle(async (req, res) => {
  try {
    const owner = await requireSessionTherapist(req, req.params.sessionId);
    if (!owner.ok) return send(res, owner.response);

    const { uid, action } = req.body;
    if (typeof uid !== 'string' || !['admit', 'deny', 'remove'].includes(action)) {
      return res.status(400).json({ error: "We couldn't tell what to do with this person. Refresh the page and try again." });
    }
    const entry = await getLobbyEntry(req.params.sessionId, uid);
    if (!entry) return res.status(404).json({ error: 'That person is no longer in the waiting room.' });

    if (action === 'admit') {
      // Grant Firestore access first, so the guest's room page can read the
      // session as soon as it sees it was admitted.
      await provisionSessionDocs(req.params.sessionId, { extraUids: [uid] });
      await setLobbyStatus(req.params.sessionId, uid, 'admitted');
    } else if (action === 'remove') {
      // Status first: from here on /api/livekit-token refuses this uid, so the
      // guest can't reconnect while being kicked.
      await setLobbyStatus(req.params.sessionId, uid, 'removed');
      await revokeSessionUid(req.params.sessionId, uid);
      const kicked = await removeParticipantByUid(req.params.sessionId, uid, entry.name).catch((e) => {
        console.error('[lobby remove] LiveKit removal failed:', (e as Error).message);
        return 0;
      });
      return res.json({ ok: true, disconnected: kicked });
    } else {
      await setLobbyStatus(req.params.sessionId, uid, 'denied');
    }
    return res.json({ ok: true });
  } catch (error) {
    return send(res, errorResponse(error, '[lobby decide]'));
  }
}));

async function requireSessionTherapist(request: Request, sessionId: string) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth;
  const [session, therapistId] = await Promise.all([
    prisma.session.findUnique({ where: { id: sessionId }, select: { therapistId: true } }),
    therapistIdForUser(auth.uid),
  ]);
  if (!session || session.therapistId !== therapistId) {
    return { ok: false as const, response: notYourProfile('this session') };
  }
  return auth;
}

// ---- /api/sessions/:sessionId/translation --------------------------------------

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
router.post('/sessions/:sessionId/translation', handle(async (req, res) => {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return send(res, auth.response);

    const [session, therapistId] = await Promise.all([
      prisma.session.findUnique({ where: { id: req.params.sessionId } }),
      therapistIdForUser(auth.uid),
    ]);
    if (!session) {
      return res.status(404).json({ error: 'This session no longer exists. It may have been deleted.' });
    }
    if (session.therapistId !== therapistId) {
      return send(res, notYourProfile('this session'));
    }

    const body = req.body;
    const enabled = body.enabled === true;
    const therapist = isTranslationLanguage(body.therapist) ? body.therapist : null;
    const client = isTranslationLanguage(body.client) ? body.client : null;
    if (enabled && (!therapist || !client)) {
      return res.status(400).json({ error: 'Choose a language for both you and your client.' });
    }

    const url = process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL;
    if (!url) {
      return res.status(500).json({ error: "Live translation isn't set up on the server yet. Ask an admin to configure video calls." });
    }
    const svc = new RoomServiceClient(
      url.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:'),
      process.env.LIVEKIT_API_KEY!,
      process.env.LIVEKIT_API_SECRET!,
    );

    let people;
    try {
      people = await svc.listParticipants(req.params.sessionId);
    } catch {
      // Room not created yet — nobody to update; the next token carries them.
      return res.json({ updated: 0 });
    }

    // You SPEAK your own language and READ the other side's. An empty value
    // deletes the attribute, which is the agent's off switch.
    let updated = 0;
    for (const p of people) {
      const role = p.attributes?.role;
      if (role !== 'therapist' && role !== 'client') continue;
      const source = role === 'therapist' ? therapist : client;
      const target = role === 'therapist' ? client : therapist;
      await svc.updateParticipant(req.params.sessionId, p.identity, {
        attributes: {
          source_lang: enabled ? source! : '',
          target_lang: enabled ? target! : '',
        },
      });
      updated++;
    }

    return res.json({ updated });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Translation update error'));
  }
}));
