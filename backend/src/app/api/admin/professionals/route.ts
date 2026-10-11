import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/apiAuth';
import { dateRange, daysAgo, listParams } from '@/lib/adminList';
import { resolveCurrent } from '@/lib/subscriptions';
import { ALL_MODULE_IDS } from '@/lib/modules';

export const dynamic = 'force-dynamic';

const SORTABLE = ['name', 'createdAt', 'lastActive', 'sessions', 'clients'];

// GET /api/admin/professionals — searchable, filterable, paginated therapist list.
// ?q=name/email &status=active|inactive|suspended &plan=<planId>|none
// &from/&to=signup date &sort=name|createdAt|lastActive|sessions|clients &dir
// "Active" = signed in or had a session in the last 30 days (and not suspended).
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request, 'people.read');
    if (!auth.ok) return auth.response;
    const { sp, skip, take, sort, dir, q, from, to } = listParams(request, { sortable: SORTABLE, defaultSort: 'createdAt' });

    const now = new Date();
    const cutoff = daysAgo(30);
    const currentTerm: Prisma.SubscriptionWhereInput = { status: 'ACTIVE', currentPeriodEnd: { gt: now } };
    const recentSession: Prisma.SessionWhereInput = { OR: [{ startedAt: { gte: cutoff } }, { scheduledAt: { gte: cutoff, lte: now } }] };
    const recentlyActive: Prisma.ProfileTherapistWhereInput = {
      user: { status: 'ACTIVE' },
      OR: [{ user: { lastSeenAt: { gte: cutoff } } }, { sessions: { some: recentSession } }],
    };
    // Spelled out rather than NOT(recentlyActive): NOT over a NULL lastSeenAt
    // is NULL in SQL and would drop never-seen therapists.
    const inactive: Prisma.ProfileTherapistWhereInput = {
      user: { status: 'ACTIVE', OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: cutoff } }] },
      sessions: { none: recentSession },
    };

    const and: Prisma.ProfileTherapistWhereInput[] = [];
    if (q) {
      const words = q.split(/\s+/).filter(Boolean);
      and.push(
        ...words.map((w) => ({
          OR: [
            { firstName: { contains: w, mode: 'insensitive' as const } },
            { lastName: { contains: w, mode: 'insensitive' as const } },
            { user: { email: { contains: w, mode: 'insensitive' as const } } },
          ],
        }))
      );
    }
    const status = sp.get('status');
    if (status === 'suspended') and.push({ user: { status: 'SUSPENDED' } });
    else if (status === 'active') and.push(recentlyActive);
    else if (status === 'inactive') and.push(inactive);
    const plan = sp.get('plan');
    if (plan === 'none') and.push({ subscriptions: { none: currentTerm } });
    else if (plan) and.push({ subscriptions: { some: { ...currentTerm, planId: plan } } });
    const created = dateRange(from, to);
    if (created) and.push({ createdAt: created });
    const where: Prisma.ProfileTherapistWhereInput = and.length ? { AND: and } : {};

    // name/createdAt sort in the DB and fetch only the page; the computed
    // columns need every matching id, then sort + slice in memory.
    const dbSort = sort === 'name' || sort === 'createdAt';
    const orderBy: Prisma.ProfileTherapistOrderByWithRelationInput[] =
      sort === 'name' ? [{ firstName: dir }, { lastName: dir }, { id: 'asc' }] : [{ createdAt: dir }, { id: 'asc' }];

    const [total, idRows, kpiTotal, kpiActive, kpiSuspended, kpiOnPlan, plans] = await Promise.all([
      prisma.profileTherapist.count({ where }),
      prisma.profileTherapist.findMany({ where, select: { id: true }, orderBy, ...(dbSort ? { skip, take } : {}) }),
      prisma.profileTherapist.count(),
      prisma.profileTherapist.count({ where: recentlyActive }),
      prisma.profileTherapist.count({ where: { user: { status: 'SUSPENDED' } } }),
      prisma.profileTherapist.count({ where: { subscriptions: { some: currentTerm } } }),
      prisma.plan.findMany({ select: { id: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    ]);

    let ids = idRows.map((r) => r.id);
    let stats = await statsFor(ids, now);
    if (!dbSort) {
      const key = (id: string) => {
        const s = stats.get(id)!;
        return sort === 'sessions' ? s.sessionsTotal : sort === 'clients' ? s.clients : s.lastActive?.getTime() ?? 0;
      };
      ids = [...ids].sort((a, b) => (dir === 'asc' ? key(a) - key(b) : key(b) - key(a))).slice(skip, skip + take);
      stats = new Map(ids.map((id) => [id, stats.get(id)!]));
    }

    const [therapists, subs] = await Promise.all([
      prisma.profileTherapist.findMany({
        where: { id: { in: ids } },
        include: { user: { select: { email: true, status: true, suspendedAt: true, suspendReason: true, lastSeenAt: true } } },
      }),
      prisma.subscription.findMany({ where: { therapistId: { in: ids }, ...currentTerm }, include: { plan: true } }),
    ]);
    const byId = new Map(therapists.map((t) => [t.id, t]));

    const professionals = ids
      .map((id) => byId.get(id))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map((t) => {
        const s = stats.get(t.id)!;
        const current = resolveCurrent(subs.filter((x) => x.therapistId === t.id), now);
        return {
          id: t.id,
          userId: t.userId,
          name: `${t.firstName} ${t.lastName}`.trim(),
          email: t.user.email,
          specialty: t.specialty,
          createdAt: t.createdAt,
          status: t.user.status,
          suspendedAt: t.user.suspendedAt,
          suspendReason: t.user.suspendReason,
          lastSeenAt: t.user.lastSeenAt,
          lastActive: s.lastActive,
          clients: s.clients,
          sessions: { total: s.sessionsTotal, completed: s.sessionsCompleted },
          plan: current ? { id: current.planId, name: current.plan.name, endsAt: current.currentPeriodEnd } : null,
          access: {
            allModulesAllowed: t.allModulesAllowed,
            moduleAccess: t.moduleAccess,
            allowedCount: t.allModulesAllowed ? ALL_MODULE_IDS.length : t.moduleAccess.length,
            totalModules: ALL_MODULE_IDS.length,
          },
        };
      });

    return NextResponse.json({
      professionals,
      total,
      kpis: { total: kpiTotal, active30d: kpiActive, suspended: kpiSuspended, onPlan: kpiOnPlan },
      plans,
    });
  } catch (error: any) {
    console.error('Admin professionals GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

const latest = (a: Date | null | undefined, b: Date | null | undefined) =>
  !a ? b ?? null : !b ? a : a > b ? a : b;

// Session counts, distinct clients (linked or seen in a session) and last
// activity (latest sign-in or session) for a set of therapists, in a handful
// of grouped queries.
async function statsFor(ids: string[], now: Date) {
  const out = new Map<string, { sessionsTotal: number; sessionsCompleted: number; clients: number; lastActive: Date | null }>();
  for (const id of ids) out.set(id, { sessionsTotal: 0, sessionsCompleted: 0, clients: 0, lastActive: null });
  if (!ids.length) return out;

  const [seen, byStatus, started, scheduled, sessionClients, linkedClients] = await Promise.all([
    prisma.profileTherapist.findMany({ where: { id: { in: ids } }, select: { id: true, user: { select: { lastSeenAt: true } } } }),
    prisma.session.groupBy({ by: ['therapistId', 'status'], where: { therapistId: { in: ids } }, _count: { _all: true } }),
    prisma.session.groupBy({ by: ['therapistId'], where: { therapistId: { in: ids } }, _max: { startedAt: true } }),
    prisma.session.groupBy({ by: ['therapistId'], where: { therapistId: { in: ids }, scheduledAt: { lte: now } }, _max: { scheduledAt: true } }),
    prisma.session.groupBy({ by: ['therapistId', 'clientId'], where: { therapistId: { in: ids } } }),
    prisma.profileClient.findMany({ where: { therapistId: { in: ids } }, select: { id: true, therapistId: true } }),
  ]);

  for (const t of seen) out.get(t.id)!.lastActive = t.user.lastSeenAt;
  for (const g of byStatus) {
    const s = out.get(g.therapistId)!;
    s.sessionsTotal += g._count._all;
    if (g.status === 'COMPLETED') s.sessionsCompleted += g._count._all;
  }
  for (const g of [...started.map((x) => [x.therapistId, x._max.startedAt] as const), ...scheduled.map((x) => [x.therapistId, x._max.scheduledAt] as const)]) {
    const s = out.get(g[0])!;
    s.lastActive = latest(s.lastActive, g[1]);
  }
  const clientSets = new Map<string, Set<string>>();
  const addClient = (tid: string, cid: string) => {
    if (!clientSets.has(tid)) clientSets.set(tid, new Set());
    clientSets.get(tid)!.add(cid);
  };
  for (const g of sessionClients) addClient(g.therapistId, g.clientId);
  for (const c of linkedClients) if (c.therapistId) addClient(c.therapistId, c.id);
  for (const [tid, set] of clientSets) out.get(tid)!.clients = set.size;
  return out;
}
