import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const therapistId = searchParams.get('therapistId');

    if (therapistId) {
      // Find all clients who have sessions with this therapist
      const sessions = await prisma.session.findMany({
        where: { therapistId },
        select: { clientId: true },
        distinct: ['clientId'],
      });
      const clientIds = sessions.map((s) => s.clientId);

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
