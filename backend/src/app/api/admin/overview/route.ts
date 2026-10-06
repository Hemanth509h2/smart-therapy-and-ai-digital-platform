import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { ALL_MODULE_IDS } from '@/lib/modules';

// GET /api/admin/overview — per-therapist resource usage for the admin dashboard.
export async function GET() {
  try {
    const therapists = await prisma.profileTherapist.findMany({
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const rows = await Promise.all(
      therapists.map(async (t) => {
        const [sessions, clientGroups, invites, docCount, usage, moduleUsage] = await Promise.all([
          prisma.session.findMany({
            where: { therapistId: t.id },
            select: { status: true, startedAt: true, endedAt: true, updatedAt: true },
          }),
          prisma.session.findMany({
            where: { therapistId: t.id },
            select: { clientId: true },
            distinct: ['clientId'],
          }),
          prisma.invite.groupBy({ by: ['status'], where: { therapistId: t.id }, _count: true }),
          prisma.documentChunk.count({ where: { therapistId: t.id } }),
          prisma.usageEvent.groupBy({ by: ['type'], where: { therapistId: t.id }, _sum: { count: true } }),
          prisma.usageEvent.groupBy({
            by: ['label'],
            where: { therapistId: t.id, type: 'MODULE_LAUNCH' },
            _sum: { count: true },
          }),
        ]);

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

        const usageByType = (type: string) =>
          usage.find((u) => u.type === type)?._sum.count ?? 0;

        const invitesPending = invites.find((i) => i.status === 'PENDING')?._count ?? 0;
        const invitesClaimed = invites.find((i) => i.status === 'CLAIMED')?._count ?? 0;

        const topModules = moduleUsage
          .map((m) => ({ id: m.label ?? 'unknown', count: m._sum.count ?? 0 }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);

        return {
          id: t.id,
          userId: t.userId,
          name: `${t.firstName} ${t.lastName}`.trim(),
          email: t.user?.email ?? '',
          specialty: t.specialty,
          clients: clientGroups.length,
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
          access: {
            allModulesAllowed: t.allModulesAllowed,
            moduleAccess: t.moduleAccess,
            allowedCount: t.allModulesAllowed ? ALL_MODULE_IDS.length : t.moduleAccess.length,
            totalModules: ALL_MODULE_IDS.length,
          },
          lastActive,
        };
      })
    );

    return NextResponse.json({ therapists: rows });
  } catch (error: any) {
    console.error('Admin overview error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
