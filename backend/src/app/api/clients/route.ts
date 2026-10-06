import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/apiAuth';
import { normalizeWhatsAppNumber } from '@/lib/twilio-whatsapp';

export const dynamic = 'force-dynamic';

// POST /api/clients — therapist adds a client directly (name + diagnosis +
// phone). No invite link, no session/video room is created — the therapist
// books or starts a session explicitly later.
export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    const { therapistId, firstName, lastName, diagnosis, phoneNumber, dateOfBirth } = await request.json();
    if (!therapistId || !firstName) {
      return NextResponse.json({ error: 'therapistId and firstName are required' }, { status: 400 });
    }

    const therapist = await prisma.profileTherapist.findUnique({
      where: { id: therapistId },
      select: { userId: true },
    });
    if (!therapist || therapist.userId !== auth.uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

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
              ? normalizeWhatsAppNumber(phoneNumber)
              : null,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : new Date(),
        },
      });
    });

    return NextResponse.json({ client }, { status: 201 });
  } catch (error: any) {
    console.error('Client create error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const therapistId = searchParams.get('therapistId');

    if (therapistId) {
      // Clients of this therapist: directly added ones PLUS any linked via sessions.
      const sessions = await prisma.session.findMany({
        where: { therapistId },
        select: { clientId: true },
        distinct: ['clientId'],
      });
      const directClients = await prisma.profileClient.findMany({
        where: { therapistId },
        select: { id: true },
      });
      const clientIds = [...new Set([...sessions.map((s) => s.clientId), ...directClients.map((c) => c.id)])];

      const clients = await prisma.profileClient.findMany({
        where: { id: { in: clientIds } },
        include: { user: true },
      });

      // Attach session count, last held session and next scheduled session per client
      const now = new Date();
      const clientsWithMeta = await Promise.all(
        clients.map(async (client) => {
          const clientSessions = await prisma.session.findMany({
            where: { therapistId, clientId: client.id },
            orderBy: { scheduledAt: 'desc' },
            select: { id: true, scheduledAt: true, status: true },
          });
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
        })
      );

      return NextResponse.json({ clients: clientsWithMeta });
    }

    // Backward-compatible: return all clients if no therapistId
    const clients = await prisma.profileClient.findMany({
      include: { user: true },
    });
    return NextResponse.json({ clients });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
