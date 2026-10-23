import { NextResponse } from 'next/server';
import { prisma, appDb } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { can } from '@/lib/admin/adminRoles';
import { dateRange, listParams } from '@/lib/admin/adminList';
import { moduleName } from '@/lib/modules/modules';
import { resolveCurrent } from '@/lib/billing/subscriptions';
import { therapistsById, usersById } from '@/lib/core/links';

export const dynamic = 'force-dynamic';

const MAX_ROWS = 20000;
const TYPES = ['therapists', 'clients', 'sessions', 'usage', 'audit', 'monthly'] as const;
type ReportType = (typeof TYPES)[number];

// GET /api/admin/reports?type=<therapists|clients|sessions|usage|audit|monthly>
// Flat rows for CSV export (capped at 20k), or ?type=monthly&month=YYYY-MM for
// the monthly business report. Optional &from=&to= limit dated reports.
// Client names are masked; no contact details or diagnoses are exported.
export async function GET(request: Request) {
  try {
    const { sp, from, to } = listParams(request, { sortable: [], defaultSort: '' });
    const type = sp.get('type') as ReportType;
    if (!TYPES.includes(type)) return NextResponse.json({ error: `type must be one of ${TYPES.join(', ')}` }, { status: 400 });

    const auth = await requireAdmin(request, type === 'audit' ? 'audit.read' : 'people.read');
    if (!auth.ok) return auth.response;
    const billing = can(auth.adminRole, 'billing.read');
    const range = dateRange(from, to);

    if (type === 'therapists') {
      const list = await appDb.profileTherapist.findMany({
        where: range ? { createdAt: range } : {},
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
        include: {
          ...(billing ? { subscriptions: { include: { plan: { select: { name: true } } } } } : {}),
        },
      });
      const ids = list.map((t) => t.id);
      const [users, clientCounts, sessionCounts] = await Promise.all([
        usersById(list.map((t) => t.userId), { email: true, status: true, lastSeenAt: true }),
        prisma.profileClient.groupBy({ by: ['therapistId'], _count: true, where: { therapistId: { in: ids } } }),
        prisma.session.groupBy({ by: ['therapistId'], _count: true, where: { therapistId: { in: ids } } }),
      ]);
      const clientsOf = new Map(clientCounts.map((g) => [g.therapistId, g._count]));
      const sessionsOf = new Map(sessionCounts.map((g) => [g.therapistId, g._count]));
      const rows = list.map((t: any) => ({
        id: t.id,
        name: `${t.firstName} ${t.lastName}`.trim(),
        email: users.get(t.userId)?.email ?? '',
        status: users.get(t.userId)?.status ?? '',
        specialty: t.specialty.join('; '),
        clients: clientsOf.get(t.id) ?? 0,
        sessions: sessionsOf.get(t.id) ?? 0,
        ...(billing ? { plan: resolveCurrent(t.subscriptions ?? [])?.plan.name ?? '' } : {}),
        joinedAt: t.createdAt,
        lastSeenAt: users.get(t.userId)?.lastSeenAt ?? null,
      }));
      return NextResponse.json({ rows });
    }

    if (type === 'clients') {
      const list = await prisma.profileClient.findMany({
        where: range ? { createdAt: range } : {},
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          createdAt: true,
          therapistId: true,
          user: { select: { status: true } },
          _count: { select: { sessions: true } },
        },
      });
      const therapists = await therapistsById(list.map((c) => c.therapistId), { firstName: true, lastName: true });
      const rows = list.map((c) => ({
        id: c.id,
        name: maskName(c.firstName, c.lastName),
        therapist: therapistName(therapists.get(c.therapistId ?? '')),
        status: c.user.status,
        sessions: c._count.sessions,
        joinedAt: c.createdAt,
      }));
      return NextResponse.json({ rows });
    }

    if (type === 'sessions') {
      const list = await prisma.session.findMany({
        where: range ? { scheduledAt: range } : {},
        orderBy: { scheduledAt: 'desc' },
        take: MAX_ROWS,
        select: {
          id: true,
          status: true,
          scheduledAt: true,
          startedAt: true,
          endedAt: true,
          therapistId: true,
          client: { select: { firstName: true, lastName: true } },
        },
      });
      const therapists = await therapistsById(list.map((s) => s.therapistId), { firstName: true, lastName: true });
      const rows = list.map((s) => ({
        id: s.id,
        therapist: therapistName(therapists.get(s.therapistId)),
        client: maskName(s.client.firstName, s.client.lastName),
        status: s.status,
        scheduledAt: s.scheduledAt,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        durationMin: s.startedAt && s.endedAt ? Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 60000) : null,
      }));
      return NextResponse.json({ rows });
    }

    if (type === 'usage') {
      const list = await appDb.usageEvent.findMany({
        where: range ? { createdAt: range } : {},
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
        include: { therapist: { select: { firstName: true, lastName: true } } },
      });
      const rows = list.map((u) => ({
        createdAt: u.createdAt,
        therapistId: u.therapistId,
        therapist: `${u.therapist.firstName} ${u.therapist.lastName}`.trim(),
        type: u.type,
        module: u.type === 'MODULE_LAUNCH' && u.label ? moduleName(u.label) : u.label ?? '',
        count: u.count,
        sessionId: u.sessionId ?? '',
      }));
      return NextResponse.json({ rows });
    }

    if (type === 'audit') {
      const list = await prisma.auditLog.findMany({ where: range ? { createdAt: range } : {}, orderBy: { createdAt: 'desc' }, take: MAX_ROWS });
      const rows = list.map((a) => ({
        createdAt: a.createdAt,
        actor: a.actorEmail ?? a.actorUid,
        action: a.action,
        targetType: a.targetType,
        targetId: a.targetId ?? '',
        ip: a.ip ?? '',
        before: a.before == null ? '' : JSON.stringify(a.before),
        after: a.after == null ? '' : JSON.stringify(a.after),
      }));
      return NextResponse.json({ rows });
    }

    return NextResponse.json(await monthly(sp.get('month'), billing));
  } catch (error: any) {
    console.error('Admin reports error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

const therapistName = (t: { firstName: string; lastName: string } | undefined) =>
  t ? `${t.firstName} ${t.lastName}`.trim() : '';

// "Riya Sharma" -> "R*** S."
function maskName(first: string, last: string) {
  const f = (first || '').trim();
  const l = (last || '').trim();
  return `${f ? `${f[0]}***` : '***'}${l ? ` ${l[0]}.` : ''}`;
}

// KPIs for one calendar month (server local time), defaulting to the current one.
async function monthly(month: string | null, billing: boolean) {
  const m = /^(\d{4})-(\d{2})$/.exec(month || '');
  const now = new Date();
  const start = m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  const inMonth = { gte: start, lt: end };

  const [therapists, newTherapists, clients, newClients, sessionsByStatus, completed, activeTherapists, usage, modules] = await Promise.all([
    appDb.profileTherapist.count({ where: { createdAt: { lt: end } } }),
    appDb.profileTherapist.count({ where: { createdAt: inMonth } }),
    prisma.profileClient.count({ where: { createdAt: { lt: end } } }),
    prisma.profileClient.count({ where: { createdAt: inMonth } }),
    prisma.session.groupBy({ by: ['status'], where: { scheduledAt: inMonth }, _count: true }),
    prisma.session.findMany({
      where: { scheduledAt: inMonth, startedAt: { not: null }, endedAt: { not: null } },
      select: { startedAt: true, endedAt: true },
    }),
    prisma.session.findMany({ where: { scheduledAt: inMonth, status: { not: 'CANCELLED' } }, distinct: ['therapistId'], select: { therapistId: true } }),
    appDb.usageEvent.groupBy({ by: ['type'], where: { createdAt: inMonth }, _sum: { count: true } }),
    appDb.usageEvent.groupBy({
      by: ['label'],
      where: { type: 'MODULE_LAUNCH', label: { not: null }, createdAt: inMonth },
      _sum: { count: true },
      orderBy: { _sum: { count: 'desc' } },
      take: 10,
    }),
  ]);

  const sessionsTotal = sessionsByStatus.reduce((s, g) => s + g._count, 0);
  const cancelled = sessionsByStatus.find((g) => g.status === 'CANCELLED')?._count ?? 0;
  const minutes = completed.reduce((s, x) => s + (x.endedAt!.getTime() - x.startedAt!.getTime()) / 60000, 0);
  const sumOf = (t: string) => usage.find((u) => u.type === t)?._sum.count ?? 0;

  const out: Record<string, unknown> = {
    month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
    from: start,
    to: end,
    generatedAt: new Date(),
    people: {
      therapists,
      newTherapists,
      activeTherapists: activeTherapists.length,
      clients,
      newClients,
    },
    sessions: {
      scheduled: sessionsTotal - cancelled,
      cancelled,
      held: completed.length,
      hours: Math.round((minutes / 60) * 10) / 10,
      byStatus: sessionsByStatus.map((g) => ({ status: g.status, count: g._count })),
    },
    usage: {
      aiAnalyses: sumOf('AI_ANALYSIS'),
      transcriptSegments: sumOf('TRANSCRIPTION'),
      moduleLaunches: sumOf('MODULE_LAUNCH'),
      topModules: modules.map((x) => ({ name: moduleName(x.label!), launches: x._sum.count ?? 0 })),
    },
  };

  if (billing) {
    // Terms that were running at the end of the month.
    const subs = await appDb.subscription.findMany({
      where: { startedAt: { lt: end }, currentPeriodEnd: { gte: end }, status: { not: 'CANCELLED' } },
      include: { plan: { select: { name: true, priceMonthly: true } } },
    });
    const newSubs = await appDb.subscription.count({ where: { createdAt: inMonth } });
    const byTherapist = new Map<string, typeof subs>();
    for (const s of subs) byTherapist.set(s.therapistId, [...(byTherapist.get(s.therapistId) ?? []), s]);
    const current = Array.from(byTherapist.values()).map((l) => l.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0]);
    const mix = new Map<string, number>();
    for (const s of current) mix.set(s.plan.name, (mix.get(s.plan.name) ?? 0) + 1);
    out.billing = {
      subscribed: current.length,
      newTerms: newSubs,
      listMrr: current.reduce((sum, s) => sum + s.plan.priceMonthly, 0),
      planMix: Array.from(mix, ([plan, count]) => ({ plan, count })).sort((a, b) => b.count - a.count),
    };
  }
  return out;
}
