import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { ALL_MODULE_IDS } from '@/lib/modules';

// GET /api/admin/therapists/[id]
// Full detail view for one therapist: profile info, every client they've
// seen, every session (with client name/status/duration), invite history,
// and the same usage/AI stats shown on the overview table.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;

    const therapist = await prisma.profileTherapist.findUnique({
      where: { id },
      include: { user: { select: { email: true, createdAt: true } } },
    });

    if (!therapist) {
      return NextResponse.json({ error: 'Therapist not found' }, { status: 404 });
    }

    const [sessions, invites, docCount, usage, moduleUsage] = await Promise.all([
      prisma.session.findMany({
        where: { therapistId: id },
        include: { client: { select: { id: true, firstName: true, lastName: true, diagnosis: true } } },
        orderBy: { scheduledAt: 'desc' },
      }),
      prisma.invite.findMany({
        where: { therapistId: id },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.documentChunk.count({ where: { therapistId: id } }),
      prisma.usageEvent.groupBy({ by: ['type'], where: { therapistId: id }, _sum: { count: true } }),
      prisma.usageEvent.groupBy({
        by: ['label'],
        where: { therapistId: id, type: 'MODULE_LAUNCH' },
        _sum: { count: true },
      }),
    ]);

    const clientMap = new Map<string, { id: string; firstName: string; lastName: string; diagnosis: string[] }>();
    for (const s of sessions) {
      if (s.client && !clientMap.has(s.client.id)) clientMap.set(s.client.id, s.client);
    }
    const clients = Array.from(clientMap.values());

    const total = sessions.length;
    const active = sessions.filter((s) => s.status === 'ACTIVE').length;
    const completed = sessions.filter((s) => s.status === 'COMPLETED').length;
    const scheduled = sessions.filter((s) => s.status === 'SCHEDULED').length;

    let totalMinutes = 0;
    let lastActive: Date | null = null;
    for (const s of sessions) {
      if (s.startedAt && s.endedAt) {
        totalMinutes += Math.max(0, (s.endedAt.getTime() - s.startedAt.getTime()) / 60000);
      }
      if (!lastActive || s.updatedAt > lastActive) lastActive = s.updatedAt;
    }

    const usageByType = (type: string) => usage.find((u) => u.type === type)?._sum.count ?? 0;
    const invitesPending = invites.filter((i) => i.status === 'PENDING').length;
    const invitesClaimed = invites.filter((i) => i.status === 'CLAIMED').length;

    const topModules = moduleUsage
      .map((m) => ({ id: m.label ?? 'unknown', count: m._sum.count ?? 0 }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      therapist: {
        id: therapist.id,
        userId: therapist.userId,
        name: `${therapist.firstName} ${therapist.lastName}`.trim(),
        email: therapist.user?.email ?? '',
        specialty: therapist.specialty,
        qualification: therapist.qualification,
        experience: therapist.experience,
        bio: therapist.bio,
        joinedAt: therapist.user?.createdAt ?? therapist.createdAt,
        access: {
          allModulesAllowed: therapist.allModulesAllowed,
          moduleAccess: therapist.moduleAccess,
          allowedCount: therapist.allModulesAllowed ? ALL_MODULE_IDS.length : therapist.moduleAccess.length,
          totalModules: ALL_MODULE_IDS.length,
        },
      },
      stats: {
        clients: clients.length,
        sessions: { total, active, completed, scheduled },
        totalMinutes: Math.round(totalMinutes),
        invites: { pending: invitesPending, claimed: invitesClaimed },
        documents: docCount,
        ai: {
          analyses: usageByType('AI_ANALYSIS'),
          transcriptLines: usageByType('TRANSCRIPTION'),
          moduleLaunches: usageByType('MODULE_LAUNCH'),
        },
        topModules,
        lastActive,
      },
      clients,
      sessions: sessions.map((s) => ({
        id: s.id,
        status: s.status,
        scheduledAt: s.scheduledAt,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        durationMinutes:
          s.startedAt && s.endedAt ? Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 60000) : null,
        client: s.client ? { id: s.client.id, firstName: s.client.firstName, lastName: s.client.lastName } : null,
      })),
      invites: invites.map((i) => ({
        id: i.id,
        firstName: i.firstName,
        lastName: i.lastName,
        status: i.status,
        createdAt: i.createdAt,
      })),
    });
  } catch (error: any) {
    console.error('Admin therapist detail error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
