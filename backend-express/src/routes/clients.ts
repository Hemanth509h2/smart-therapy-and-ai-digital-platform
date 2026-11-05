import { Router } from 'express';
import { randomUUID } from 'crypto';
import { prisma, appDb } from '@/lib/core/db';
import { requireAuth } from '@/lib/http/apiAuth';
import { requireActivePlan } from '@/lib/billing/subscriptions';
import { requireTherapist } from '@/lib/http/progressAuth';
import { normalizePhoneNumber } from '@/lib/core/phone';
import { errorResponse, notYourProfile } from '@/lib/http/apiError';
import { handle, queryParams, reply, send } from '@/lib/http/reply';
import { adminDb } from '@/lib/core/firebaseAdmin';
import { audit } from '@/lib/admin/audit';
import type { Prisma } from '@prisma/client';

export const router = Router();

/** Under 18 on today's date. The browser sends YYYY-MM-DD, which parses as
 *  UTC midnight, so compare in UTC. */
function isMinor(dob: Date) {
  const eighteenth = Date.UTC(dob.getUTCFullYear() + 18, dob.getUTCMonth(), dob.getUTCDate());
  return eighteenth > Date.now();
}

// ---- /api/clients --------------------------------------------------------------

// POST /api/clients — therapist adds a client directly (name + diagnosis +
// phone). No invite link, no session/video room is created — the therapist
// books or starts a session explicitly later.
//
// The therapist must confirm they have consent to store the client's data
// (`consentConfirmed: true`). The date of birth is required so a minor can be
// recognised: for a client under 18 the consent must come from a parent or
// lawful guardian (DPDP Act s.9), whose name is recorded (`guardianName`).
router.post('/clients', handle(async (req, res) => {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return send(res, auth.response);

    const { therapistId, firstName, lastName, diagnosis, phoneNumber, dateOfBirth, email, gender, consentConfirmed, guardianName } = req.body;
    if (!therapistId || !firstName) {
      return res.status(400).json({
          error: !firstName
            ? "Enter the client's first name."
            : "Your therapist profile hasn't loaded yet. Refresh the page and try again.",
        });
    }

    const contactEmail = typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      return res.status(400).json({ error: 'Enter a valid email address, like name@example.com.' });
    }
    const dob = dateOfBirth ? new Date(dateOfBirth) : null;
    if (!dob) {
      return res.status(400).json({ error: "Enter the client's date of birth. It tells STAAD whether a parent or guardian's consent is needed." });
    }
    if (Number.isNaN(dob.getTime()) || dob.getTime() > Date.now()) {
      return res.status(400).json({ error: 'Enter a valid date of birth. It cannot be in the future.' });
    }
    const minor = isMinor(dob);
    const guardian = typeof guardianName === 'string' ? guardianName.trim().slice(0, 200) : '';
    if (minor && !guardian) {
      return res.status(400).json({ error: "This client is under 18. Enter the name of the parent or guardian who gave consent." });
    }
    if (consentConfirmed !== true) {
      return res.status(400).json({
        error: minor
          ? "Confirm that you have verifiable consent from this child's parent or lawful guardian."
          : "Confirm that you have this client's consent to store their information in STAAD.",
      });
    }

    const therapist = await appDb.profileTherapist.findUnique({
      where: { id: therapistId },
      select: { userId: true },
    });
    if (!therapist || therapist.userId !== auth.uid) {
      return send(res, notYourProfile('this therapist profile'));
    }
    const noPlan = await requireActivePlan({ therapistId }, 'add a client');
    if (noPlan) return send(res, noPlan);

    const client = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: `client:${randomUUID()}`,
          email: `client-${randomUUID()}@client.staad.local`,
          role: 'CLIENT',
        },
      });
      return tx.profileClient.create({
        data: {
          userId: user.id,
          therapistId,
          firstName: String(firstName).trim(),
          lastName: String(lastName || '').trim(),
          diagnosis: Array.isArray(diagnosis) ? diagnosis : [],
          phoneNumber:
            typeof phoneNumber === 'string' && phoneNumber.trim()
              ? normalizePhoneNumber(phoneNumber)
              : null,
          dateOfBirth: dob,
          gender: typeof gender === 'string' && gender.trim() ? gender.trim() : null,
          consentConfirmedAt: new Date(),
          guardianName: minor ? guardian : null,
          guardianConsentAt: minor ? new Date() : null,
          // The client has no login yet (placeholder account), so the contact
          // address lives here — it's what the client profile shows as Email.
          parentEmail: contactEmail,
        },
      });
    });

    return res.status(201).json({ client });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Client create error'));
  }
}));

// GET /api/clients — the authenticated therapist's clients. The therapist is
// derived from the verified ID token; `therapistId` in the query is optional
// and must match it (it can never widen access).
router.get('/clients', handle(async (req, res) => {
  try {
    const auth = await requireTherapist(req);
    if (!auth.ok) return send(res, auth.response);
    const therapistId = auth.therapist.id;

    const requested = queryParams(req).get('therapistId');
    if (requested && requested !== therapistId) {
      return send(res, notYourProfile('these clients'));
    }

    // One query for every session of this therapist; everything else is
    // derived in memory (was: 3 queries + one per client).
    const sessions = await prisma.session.findMany({
      where: { therapistId },
      orderBy: { scheduledAt: 'desc' },
      select: { id: true, clientId: true, scheduledAt: true, status: true },
    });

    // Clients of this therapist: directly added ones PLUS any linked via sessions.
    const sessionClientIds = [...new Set(sessions.map((s) => s.clientId))];
    const clients = await prisma.profileClient.findMany({
      where: { OR: [{ therapistId }, { id: { in: sessionClientIds } }] },
      include: { user: { select: { email: true } } },
    });

    const byClient = new Map<string, typeof sessions>();
    for (const s of sessions) {
      const list = byClient.get(s.clientId);
      if (list) list.push(s);
      else byClient.set(s.clientId, [s]);
    }

    // Attach session count, last held session and next scheduled session per client
    const now = new Date();
    const clientsWithMeta = clients.map((client) => {
      const clientSessions = byClient.get(client.id) ?? [];
      const held = clientSessions.filter(
        (s) => s.status !== 'CANCELLED' && (s.status !== 'SCHEDULED' || s.scheduledAt <= now)
      );
      const next = clientSessions
        .filter((s) => s.status === 'SCHEDULED' && s.scheduledAt > now)
        .at(-1);
      return {
        ...client,
        sessionCount: clientSessions.length,
        lastSession: held[0]?.scheduledAt || null,
        nextSession: next ? { id: next.id, scheduledAt: next.scheduledAt } : null,
      };
    });

    return res.json({ clients: clientsWithMeta });
  } catch (error: any) {
    return send(res, errorResponse(error, 'clients GET'));
  }
}));

// ---- /api/clients/:clientId ----------------------------------------------------

/** Placeholder accounts: clients the therapist added (`client:`) or invite
 *  guests (`guest:`). Anyone else signed up themselves and owns their profile. */
const isPlaceholder = (userId: string) => userId.startsWith('client:') || userId.startsWith('guest:');

/** The client, when it is on this therapist's caseload (added by them, or seen
 *  in one of their sessions) and the therapist may change it. Otherwise the
 *  error response to send. */
async function editableClient(clientId: string, therapistId: string, action: string) {
  const client = await prisma.profileClient.findUnique({ where: { id: clientId } });
  const onCaseload =
    client &&
    (client.therapistId === therapistId ||
      (await prisma.session.count({ where: { clientId, therapistId } })) > 0);
  if (!client || !onCaseload) return { error: notYourProfile('this client') };
  if (!isPlaceholder(client.userId)) {
    return {
      error: reply(
        { error: `This client signed up with their own account, so only they can ${action} it.` },
        403
      ),
    };
  }
  return { client };
}

// PATCH /api/clients/:clientId — therapist edits a client they added. Same
// rules as adding one: a date of birth is required, and a client who is (or
// now turns out to be) under 18 needs a parent or guardian's name and consent.
// Only fields present in the body change.
router.patch('/clients/:clientId', handle(async (req, res) => {
  try {
    const auth = await requireTherapist(req);
    if (!auth.ok) return send(res, auth.response);

    const found = await editableClient(req.params.clientId, auth.therapist.id, 'edit');
    if (found.error) return send(res, found.error);
    const client = found.client;

    const body = req.body ?? {};
    const data: Prisma.ProfileClientUpdateInput = {};

    if ('firstName' in body) {
      const first = String(body.firstName ?? '').trim();
      if (!first) return res.status(400).json({ error: "Enter the client's first name." });
      data.firstName = first;
    }
    if ('lastName' in body) data.lastName = String(body.lastName ?? '').trim();
    if ('diagnosis' in body) {
      data.diagnosis = Array.isArray(body.diagnosis)
        ? body.diagnosis.map((d: unknown) => String(d).trim()).filter(Boolean)
        : [];
    }
    if ('phoneNumber' in body) {
      data.phoneNumber =
        typeof body.phoneNumber === 'string' && body.phoneNumber.trim()
          ? normalizePhoneNumber(body.phoneNumber)
          : null;
    }
    if ('email' in body) {
      const contactEmail = typeof body.email === 'string' && body.email.trim() ? body.email.trim().toLowerCase() : null;
      if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
        return res.status(400).json({ error: 'Enter a valid email address, like name@example.com.' });
      }
      data.parentEmail = contactEmail;
    }
    if ('gender' in body) {
      data.gender = typeof body.gender === 'string' && body.gender.trim() ? body.gender.trim() : null;
    }

    let dob = client.dateOfBirth;
    if ('dateOfBirth' in body) {
      const next = body.dateOfBirth ? new Date(body.dateOfBirth) : null;
      if (!next) {
        return res.status(400).json({ error: "Enter the client's date of birth. It tells STAAD whether a parent or guardian's consent is needed." });
      }
      if (Number.isNaN(next.getTime()) || next.getTime() > Date.now()) {
        return res.status(400).json({ error: 'Enter a valid date of birth. It cannot be in the future.' });
      }
      dob = next;
      data.dateOfBirth = next;
    }

    // A minor needs a guardian on record. When there was no guardian consent
    // yet (the date of birth changed, or the client predates consent records),
    // the therapist must confirm it now.
    if (isMinor(dob)) {
      const guardian =
        'guardianName' in body
          ? (typeof body.guardianName === 'string' ? body.guardianName.trim().slice(0, 200) : '')
          : client.guardianName ?? '';
      if (!guardian) {
        return res.status(400).json({ error: "This client is under 18. Enter the name of the parent or guardian who gave consent." });
      }
      const guardianChanged = guardian !== (client.guardianName ?? '');
      if ((!client.guardianConsentAt || guardianChanged) && body.consentConfirmed !== true) {
        return res.status(400).json({ error: "Confirm that you have verifiable consent from this child's parent or lawful guardian." });
      }
      data.guardianName = guardian;
      if (!client.guardianConsentAt || guardianChanged) data.guardianConsentAt = new Date();
    }

    const updated = await prisma.profileClient.update({ where: { id: client.id }, data });
    await audit(req, { uid: auth.uid }, 'client.update', { type: 'ProfileClient', id: client.id }, {
      after: { fields: Object.keys(data) },
    });
    return res.json({ client: updated });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Client update error'));
  }
}));

// DELETE /api/clients/:clientId — therapist permanently deletes a client they
// added, with everything recorded about them: sessions (and their reports,
// notes, risk flags and Firestore transcripts/room state), bookings, progress
// records, WhatsApp messages, claimed invites and saved quests. A client who
// also sees another therapist is refused, since that therapist's records
// would go too.
router.delete('/clients/:clientId', handle(async (req, res) => {
  try {
    const auth = await requireTherapist(req);
    if (!auth.ok) return send(res, auth.response);
    const therapistId = auth.therapist.id;

    const found = await editableClient(req.params.clientId, therapistId, 'delete');
    if (found.error) return send(res, found.error);
    const client = found.client;

    const otherTherapist = await prisma.session.count({
      where: { clientId: client.id, therapistId: { not: therapistId } },
    });
    if (otherTherapist > 0) {
      return res.status(409).json({
        error: 'This client also has sessions with another therapist, so they cannot be deleted from here. Contact support.',
      });
    }

    const sessions = await prisma.session.findMany({ where: { clientId: client.id }, select: { id: true } });
    const sessionIds = sessions.map((s) => s.id);

    // 1. Firestore: transcripts, session diary, live-room state, saved quests.
    const db = adminDb();
    const warnings: string[] = [];
    for (const id of sessionIds) {
      try {
        await db.recursiveDelete(db.collection('sessions').doc(id));
        await db.recursiveDelete(db.collection('liveSessions').doc(id));
      } catch (e: any) {
        warnings.push(`session ${id}: ${e?.message || e}`);
      }
    }
    try {
      await db.recursiveDelete(db.collection('patients').doc(client.userId));
    } catch (e: any) {
      warnings.push(`patients/${client.userId}: ${e?.message || e}`);
    }
    if (warnings.length) console.warn('[clients] delete left Firestore data behind:', warnings);

    // 2. HIPAA database, all or nothing.
    await prisma.$transaction(async (tx) => {
      await tx.riskFlag.deleteMany({ where: { sessionId: { in: sessionIds } } });
      await tx.booking.deleteMany({ where: { clientId: client.id } });
      await tx.whatsAppMessage.deleteMany({ where: { clientId: client.id } });
      // Cascades session reports, therapist notes and session WhatsApp messages.
      await tx.session.deleteMany({ where: { id: { in: sessionIds } } });
      await tx.invite.deleteMany({ where: { claimedClientId: client.id } });
      // Cascades the client profile and its progress metrics, reports and notes.
      await tx.user.delete({ where: { id: client.userId } });
    }, { timeout: 60_000 });

    await audit(req, { uid: auth.uid }, 'client.delete', { type: 'ProfileClient', id: client.id }, {
      after: { sessions: sessionIds.length },
    });
    return res.json({ deleted: true, sessions: sessionIds.length });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Client delete error'));
  }
}));
