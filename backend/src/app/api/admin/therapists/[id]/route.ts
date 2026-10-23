import { NextResponse } from 'next/server';
import { prisma, appDb } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { ALL_MODULE_IDS } from '@/lib/modules/modules';
import { daysAgo } from '@/lib/admin/adminList';
import { resolveCurrent, serializeSubscription } from '@/lib/billing/subscriptions';
import { errorResponse } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

const USAGE_TYPES = ['AI_ANALYSIS', 'TRANSCRIPTION', 'MODULE_LAUNCH'] as const;
const USAGE_DAYS = 90;

// Client PHI stays hidden here: names are reduced to initials and clinical
// fields are left out. The full record comes from ./phi (audited).
const initial = (s: string | null | undefined) => (s?.trim() ? `${s.trim()[0].toUpperCase()}.` : '');
const maskName = (first: string, last: string) => [initial(first), initial(last)].filter(Boolean).join(' ') || '—';

// GET /api/admin/therapists/[id]
// Full detail view for one therapist: profile + account status, clients and
// sessions (client names masked), invite history, subscription history and
// pending request, usage stats and a 90-day daily usage series per type.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin(request, 'people.read');
    if (!auth.ok) return auth.response;
    const { id } = params;

    const therapist = await appDb.profileTherapist.findUnique({ where: { id } });

    if (!therapist) {
      return NextResponse.json({ error: 'Therapist not found' }, { status: 404 });
    }

    const since = daysAgo(USAGE_DAYS - 1);
    since.setHours(0, 0, 0, 0);

    const [user, sessions, invites, docCount, usage, moduleUsage, subscriptions, pendingRequest, recentUsage] = await Promise.all([
      prisma.user.findUnique({
        where: { id: therapist.userId },
        select: { email: true, createdAt: true, status: true, suspendedAt: true, suspendReason: true, lastSeenAt: true },
      }),
      prisma.session.findMany({
        where: { therapistId: id },
        include: { client: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { scheduledAt: 'desc' },
      }),
      prisma.invite.findMany({
        where: { therapistId: id },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.documentChunk.count({ where: { therapistId: id } }),
      appDb.usageEvent.groupBy({ by: ['type'], where: { therapistId: id }, _sum: { count: true } }),
      appDb.usageEvent.groupBy({
        by: ['label'],
        where: { therapistId: id, type: 'MODULE_LAUNCH' },
        _sum: { count: true },
      }),
      appDb.subscription.findMany({
        where: { therapistId: id },
        include: { plan: true },
        orderBy: { startedAt: 'desc' },
      }),
      appDb.subscriptionRequest.findFirst({
        where: { therapistId: id, status: 'PENDING' },
        include: { plan: { select: { id: true, name: true, toolQuota: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      appDb.usageEvent.findMany({
        where: { therapistId: id, type: { in: [...USAGE_TYPES] }, createdAt: { gte: since } },
        select: { type: true, count: true, createdAt: true },
      }),
    ]);

    // Clients seen in sessions plus clients the therapist added directly.
    const linked = await prisma.profileClient.findMany({
      where: { therapistId: id },
      select: { id: true, firstName: true, lastName: true },
    });
    const clientMap = new Map<string, { id: string; firstName: string; lastName: string }>();
    for (const s of sessions) {
      if (s.client && !clientMap.has(s.client.id)) clientMap.set(s.client.id, s.client);
    }
    for (const c of linked) if (!clientMap.has(c.id)) clientMap.set(c.id, c);
    const sessionCounts = new Map<string, { count: number; last: Date | null }>();
    for (const s of sessions) {
      const e = sessionCounts.get(s.clientId) ?? { count: 0, last: null };
      e.count++;
      if (!e.last || s.scheduledAt > e.last) e.last = s.scheduledAt;
      sessionCounts.set(s.clientId, e);
    }
    const clients = Array.from(clientMap.values()).map((c) => ({
      id: c.id,
      name: maskName(c.firstName, c.lastName),
      firstName: initial(c.firstName),
      lastName: initial(c.lastName),
      masked: true,
      sessions: sessionCounts.get(c.id)?.count ?? 0,
      lastSession: sessionCounts.get(c.id)?.last ?? null,
    }));

    // Daily usage buckets (local days), oldest first, zero-filled.
    const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const days: string[] = [];
    for (let i = 0; i < USAGE_DAYS; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      days.push(dayKey(d));
    }
    const usageDaily: Record<string, { date: string; count: number }[]> = {};
    for (const type of USAGE_TYPES) {
      const byDay = new Map<string, number>();
      for (const e of recentUsage) {
        if (e.type === type) byDay.set(dayKey(e.createdAt), (byDay.get(dayKey(e.createdAt)) ?? 0) + e.count);
      }
      usageDaily[type] = days.map((date) => ({ date, count: byDay.get(date) ?? 0 }));
    }

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
        email: user?.email ?? '',
        specialty: therapist.specialty,
        qualification: therapist.qualification,
        experience: therapist.experience,
        bio: therapist.bio,
        joinedAt: user?.createdAt ?? therapist.createdAt,
        status: user?.status ?? 'ACTIVE',
        suspendedAt: user?.suspendedAt ?? null,
        suspendReason: user?.suspendReason ?? null,
        lastSeenAt: user?.lastSeenAt ?? null,
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
      billing: {
        current: serializeSubscription(resolveCurrent(subscriptions)),
        history: subscriptions.map((s) => ({
          id: s.id,
          planId: s.planId,
          planName: s.plan.name,
          toolQuota: s.plan.toolQuota,
          status: s.status,
          months: s.months,
          startedAt: s.startedAt,
          currentPeriodEnd: s.currentPeriodEnd,
          renewedAt: s.renewedAt,
          renewalCount: s.renewalCount,
          moduleAccess: s.moduleAccess,
        })),
        pendingRequest: pendingRequest
          ? {
              id: pendingRequest.id,
              planId: pendingRequest.planId,
              planName: pendingRequest.plan.name,
              toolQuota: pendingRequest.plan.toolQuota,
              months: pendingRequest.months,
              modules: pendingRequest.modules,
              note: pendingRequest.note,
              createdAt: pendingRequest.createdAt,
            }
          : null,
      },
      usageDaily,
      sessions: sessions.map((s) => ({
        id: s.id,
        status: s.status,
        scheduledAt: s.scheduledAt,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        durationMinutes:
          s.startedAt && s.endedAt ? Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 60000) : null,
        client: s.client
          ? {
              id: s.client.id,
              name: maskName(s.client.firstName, s.client.lastName),
              firstName: initial(s.client.firstName),
              lastName: initial(s.client.lastName),
            }
          : null,
      })),
      invites: invites.map((i) => ({
        id: i.id,
        name: maskName(i.firstName, i.lastName),
        firstName: initial(i.firstName),
        lastName: initial(i.lastName),
        status: i.status,
        createdAt: i.createdAt,
      })),
    });
  } catch (error: any) {
    return errorResponse(error, 'Admin therapist detail error');
  }
}
