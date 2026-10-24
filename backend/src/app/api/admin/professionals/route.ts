import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import type { Prisma as AppPrisma } from '.prisma/app-client';
import { prisma, appDb } from '@/lib/core/db';
import { usersById } from '@/lib/core/links';
import { requireAdmin } from '@/lib/http/apiAuth';
import { dateRange, daysAgo, listParams } from '@/lib/admin/adminList';
import { resolveCurrent } from '@/lib/billing/subscriptions';
import { ALL_MODULE_IDS } from '@/lib/modules/modules';
import { errorResponse } from '@/lib/http/apiError';

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
    const currentTerm: AppPrisma.SubscriptionWhereInput = { status: 'ACTIVE', currentPeriodEnd: { gt: now } };
    const recentSession: Prisma.SessionWhereInput = { OR: [{ startedAt: { gte: cutoff } }, { scheduledAt: { gte: cutoff, lte: now } }] };

    // Users and sessions live in the HIPAA database, so resolve the
    // user-based filters per therapist here and filter therapists by id.
    const [all, recent] = await Promise.all([
      appDb.profileTherapist.findMany({ select: { id: true, userId: true } }),
      prisma.session.groupBy({ by: ['therapistId'], where: recentSession }),
    ]);
    const users = await usersById(all.map((t) => t.userId), {
      email: true, status: true, suspendedAt: true, suspendReason: true, lastSeenAt: true,
    });
    const userIdOf = new Map(all.map((t) => [t.id, t.userId]));
    const userOf = (id: string) => users.get(userIdOf.get(id) ?? '');
    const hadSession = new Set(recent.map((r) => r.therapistId));
    const pick = (test: (id: string, u: NonNullable<ReturnType<typeof userOf>>) => boolean) =>
      all.filter((t) => {
        const u = users.get(t.userId);
        return !!u && test(t.id, u);
      }).map((t) => t.id);
    const seenRecently = (u: { lastSeenAt: Date | null }) => !!u.lastSeenAt && u.lastSeenAt >= cutoff;
    const activeIds = pick((id, u) => u.status === 'ACTIVE' && (seenRecently(u) || hadSession.has(id)));
    const inactiveIds = pick((id, u) => u.status === 'ACTIVE' && !seenRecently(u) && !hadSession.has(id));
    const suspendedIds = pick((_, u) => u.status === 'SUSPENDED');

    const and: AppPrisma.ProfileTherapistWhereInput[] = [];
    if (q) {
      const words = q.split(/\s+/).filter(Boolean);
      and.push(
        ...words.map((w) => ({
          OR: [
            { firstName: { contains: w, mode: 'insensitive' as const } },
            { lastName: { contains: w, mode: 'insensitive' as const } },
            { id: { in: pick((_, u) => u.email.toLowerCase().includes(w.toLowerCase())) } },
          ],
        }))
      );
    }
    const status = sp.get('status');
    if (status === 'suspended') and.push({ id: { in: suspendedIds } });
    else if (status === 'active') and.push({ id: { in: activeIds } });
    else if (status === 'inactive') and.push({ id: { in: inactiveIds } });
    const plan = sp.get('plan');
    if (plan === 'none') and.push({ subscriptions: { none: currentTerm } });
    else if (plan) and.push({ subscriptions: { some: { ...currentTerm, planId: plan } } });
    const created = dateRange(from, to);
    if (created) and.push({ createdAt: created });
    const where: AppPrisma.ProfileTherapistWhereInput = and.length ? { AND: and } : {};

    // name/createdAt sort in the DB and fetch only the page; the computed
    // columns need every matching id, then sort + slice in memory.
    const dbSort = sort === 'name' || sort === 'createdAt';
    const orderBy: AppPrisma.ProfileTherapistOrderByWithRelationInput[] =
      sort === 'name' ? [{ firstName: dir }, { lastName: dir }, { id: 'asc' }] : [{ createdAt: dir }, { id: 'asc' }];

    const [total, idRows, kpiOnPlan, plans] = await Promise.all([
      appDb.profileTherapist.count({ where }),
      appDb.profileTherapist.findMany({ where, select: { id: true }, orderBy, ...(dbSort ? { skip, take } : {}) }),
      appDb.profileTherapist.count({ where: { subscriptions: { some: currentTerm } } }),
      appDb.plan.findMany({ select: { id: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    ]);

    let ids = idRows.map((r) => r.id);
    let stats = await statsFor(ids, now, (id) => userOf(id)?.lastSeenAt ?? null);
    if (!dbSort) {
      const key = (id: string) => {
        const s = stats.get(id)!;
        return sort === 'sessions' ? s.sessionsTotal : sort === 'clients' ? s.clients : s.lastActive?.getTime() ?? 0;
      };
      ids = [...ids].sort((a, b) => (dir === 'asc' ? key(a) - key(b) : key(b) - key(a))).slice(skip, skip + take);
      stats = new Map(ids.map((id) => [id, stats.get(id)!]));
    }

    const [therapists, subs] = await Promise.all([
      appDb.profileTherapist.findMany({ where: { id: { in: ids } } }),
      appDb.subscription.findMany({ where: { therapistId: { in: ids }, ...currentTerm }, include: { plan: true } }),
    ]);
    const byId = new Map(therapists.map((t) => [t.id, t]));

    const professionals = ids
      .map((id) => byId.get(id))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map((t) => {
        const s = stats.get(t.id)!;
        const current = resolveCurrent(subs.filter((x) => x.therapistId === t.id), now);
        const u = userOf(t.id);
        return {
          id: t.id,
          userId: t.userId,
          name: `${t.firstName} ${t.lastName}`.trim(),
          email: u?.email ?? '',
          specialty: t.specialty,
          createdAt: t.createdAt,
          status: u?.status ?? 'ACTIVE',
          suspendedAt: u?.suspendedAt ?? null,
          suspendReason: u?.suspendReason ?? null,
          lastSeenAt: u?.lastSeenAt ?? null,
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
      kpis: { total: all.length, active30d: activeIds.length, suspended: suspendedIds.length, onPlan: kpiOnPlan },
      plans,
    });
  } catch (error: any) {
    return errorResponse(error, 'Admin professionals GET error', "We couldn't load the professionals list. Please try again.");
  }
}

const latest = (a: Date | null | undefined, b: Date | null | undefined) =>
  !a ? b ?? null : !b ? a : a > b ? a : b;

// Session counts, distinct clients (linked or seen in a session) and last
// activity (latest sign-in or session) for a set of therapists, in a handful
// of grouped queries.
async function statsFor(ids: string[], now: Date, lastSeen: (id: string) => Date | null) {
  const out = new Map<string, { sessionsTotal: number; sessionsCompleted: number; clients: number; lastActive: Date | null }>();
  for (const id of ids) out.set(id, { sessionsTotal: 0, sessionsCompleted: 0, clients: 0, lastActive: lastSeen(id) });
  if (!ids.length) return out;

  const [byStatus, started, scheduled, sessionClients, linkedClients] = await Promise.all([
    prisma.session.groupBy({ by: ['therapistId', 'status'], where: { therapistId: { in: ids } }, _count: { _all: true } }),
    prisma.session.groupBy({ by: ['therapistId'], where: { therapistId: { in: ids } }, _max: { startedAt: true } }),
    prisma.session.groupBy({ by: ['therapistId'], where: { therapistId: { in: ids }, scheduledAt: { lte: now } }, _max: { scheduledAt: true } }),
    prisma.session.groupBy({ by: ['therapistId', 'clientId'], where: { therapistId: { in: ids } } }),
    prisma.profileClient.findMany({ where: { therapistId: { in: ids } }, select: { id: true, therapistId: true } }),
  ]);

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
