import { Router } from 'express';
import { randomUUID } from 'crypto';
import { prisma, appDb } from '@/lib/core/db';
import { requireAuth } from '@/lib/http/apiAuth';
import { requireActivePlan } from '@/lib/billing/subscriptions';
import { requireTherapist } from '@/lib/http/progressAuth';
import { normalizePhoneNumber } from '@/lib/core/phone';
import { errorResponse, notYourProfile } from '@/lib/http/apiError';
import { handle, queryParams, send } from '@/lib/http/reply';

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
