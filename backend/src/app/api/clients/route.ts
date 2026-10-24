import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma, appDb } from '@/lib/core/db';
import { requireAuth } from '@/lib/http/apiAuth';
import { requireActivePlan } from '@/lib/billing/subscriptions';
import { requireTherapist } from '@/lib/http/progressAuth';
import { normalizePhoneNumber } from '@/lib/core/phone';
import { errorResponse, notYourProfile } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

// POST /api/clients — therapist adds a client directly (name + diagnosis +
// phone). No invite link, no session/video room is created — the therapist
// books or starts a session explicitly later.
export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    const { therapistId, firstName, lastName, diagnosis, phoneNumber, dateOfBirth, email, gender } = await request.json();
    if (!therapistId || !firstName) {
      return NextResponse.json(
        {
          error: !firstName
            ? "Enter the client's first name."
            : "Your therapist profile hasn't loaded yet. Refresh the page and try again.",
        },
        { status: 400 }
      );
    }

    const contactEmail = typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      return NextResponse.json({ error: 'Enter a valid email address, like name@example.com.' }, { status: 400 });
    }
    const dob = dateOfBirth ? new Date(dateOfBirth) : null;
    if (dob && (Number.isNaN(dob.getTime()) || dob.getTime() > Date.now())) {
      return NextResponse.json({ error: 'Enter a valid date of birth. It cannot be in the future.' }, { status: 400 });
    }

    const therapist = await appDb.profileTherapist.findUnique({
      where: { id: therapistId },
      select: { userId: true },
    });
    if (!therapist || therapist.userId !== auth.uid) {
      return notYourProfile('this therapist profile');
    }
    const noPlan = await requireActivePlan({ therapistId }, 'add a client');
    if (noPlan) return noPlan;

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
          dateOfBirth: dob ?? new Date(),
          gender: typeof gender === 'string' && gender.trim() ? gender.trim() : null,
          // The client has no login yet (placeholder account), so the contact
          // address lives here — it's what the client profile shows as Email.
          parentEmail: contactEmail,
        },
      });
    });

    return NextResponse.json({ client }, { status: 201 });
  } catch (error: any) {
    return errorResponse(error, 'Client create error');
  }
}

// GET /api/clients — the authenticated therapist's clients. The therapist is
// derived from the verified ID token; `therapistId` in the query is optional
// and must match it (it can never widen access).
export async function GET(request: Request) {
  try {
    const auth = await requireTherapist(request);
    if (!auth.ok) return auth.response;
    const therapistId = auth.therapist.id;

    const requested = new URL(request.url).searchParams.get('therapistId');
    if (requested && requested !== therapistId) {
      return notYourProfile('these clients');
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

    return NextResponse.json({ clients: clientsWithMeta });
  } catch (error: any) {
    return errorResponse(error, 'clients GET');
  }
}
