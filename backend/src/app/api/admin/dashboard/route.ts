import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma, appDb } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { can } from '@/lib/admin/adminRoles';
import { daysAgo, startOfDay, startOfMonth } from '@/lib/admin/adminList';
import { resolveCurrent } from '@/lib/billing/subscriptions';

export const dynamic = 'force-dynamic';

// GET /api/admin/dashboard — KPIs, trend series and a "needs attention" list
// for the admin home page. Sections the admin's role can't see are omitted.
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    const people = can(auth.adminRole, 'people.read');
    const billing = can(auth.adminRole, 'billing.read');
    const support = can(auth.adminRole, 'support');

    const now = new Date();
    const today = startOfDay(now);
    const monthStart = startOfMonth(now);
    const weekAgo = daysAgo(7);
    const in7Days = new Date(now.getTime() + 7 * 864e5);

    const result: Record<string, unknown> = { generatedAt: now };

    if (people) {
      const [therapists, activeTherapists, clients, sessionsToday, sessionsMonth, signups, sessionsDaily, risk] =
        await Promise.all([
          appDb.profileTherapist.count(),
          countActiveTherapists(weekAgo, now),
          prisma.profileClient.count(),
          prisma.session.count({ where: { scheduledAt: { gte: today }, status: { not: 'CANCELLED' } } }),
          prisma.session.count({ where: { scheduledAt: { gte: monthStart }, status: { not: 'CANCELLED' } } }),
          prisma.$queryRaw<{ bucket: Date; n: number }[]>(Prisma.sql`
            SELECT date_trunc('week', "createdAt") AS bucket, count(*)::int AS n
            FROM "User" WHERE role = 'THERAPIST' AND "createdAt" >= ${daysAgo(7 * 12)}
            GROUP BY 1 ORDER BY 1`),
          prisma.$queryRaw<{ bucket: Date; n: number }[]>(Prisma.sql`
            SELECT date_trunc('day', "scheduledAt") AS bucket, count(*)::int AS n
            FROM "Session" WHERE status <> 'CANCELLED' AND "scheduledAt" >= ${daysAgo(30)} AND "scheduledAt" <= ${now}
            GROUP BY 1 ORDER BY 1`),
          prisma.riskFlag.findMany({
            where: { acknowledgedAt: null },
            orderBy: { raisedAt: 'desc' },
            take: 5,
            select: { id: true, sessionId: true, level: true, raisedAt: true },
          }),
        ]);

      result.people = {
        therapists,
        activeTherapists,
        clients,
        sessionsToday,
        sessionsMonth,
        openRiskFlags: await prisma.riskFlag.count({ where: { acknowledgedAt: null } }),
      };
      result.signupsWeekly = fillWeeks(signups, 12);
      result.sessionsDaily = fillDays(sessionsDaily, 30);
      result.riskFlags = risk;
    }

    if (billing) {
      const [subs, expiring] = await Promise.all([
        appDb.subscription.findMany({ where: { status: 'ACTIVE', currentPeriodEnd: { gt: now } }, include: { plan: true } }),
        appDb.subscription.findMany({
          where: { status: 'ACTIVE', currentPeriodEnd: { gt: now, lte: in7Days } },
          include: { plan: { select: { name: true } }, therapist: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { currentPeriodEnd: 'asc' },
          take: 10,
        }),
      ]);
      // One current term per therapist.
      const byTherapist = new Map<string, typeof subs>();
      for (const s of subs) byTherapist.set(s.therapistId, [...(byTherapist.get(s.therapistId) ?? []), s]);
      const current = Array.from(byTherapist.values()).map((list) => resolveCurrent(list)!).filter(Boolean);
      const planMix = new Map<string, number>();
      for (const s of current) planMix.set(s.plan.name, (planMix.get(s.plan.name) ?? 0) + 1);

      result.billing = {
        subscribed: current.length,
        // Listed price of every current paid term, per month (no payments on this branch).
        listMrr: current.reduce((sum, s) => sum + s.plan.priceMonthly, 0),
        pendingRequests: await appDb.subscriptionRequest.count({ where: { status: 'PENDING' } }),
      };
      result.planMix = Array.from(planMix, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
      result.expiring = expiring.map((s) => ({
        id: s.id,
        therapistId: s.therapist.id,
        therapist: `${s.therapist.firstName} ${s.therapist.lastName}`.trim(),
        plan: s.plan.name,
        endsAt: s.currentPeriodEnd,
      }));
    }

    if (support) {
      const [openTickets, failedMessages] = await Promise.all([
        prisma.supportTicket.count({ where: { status: { not: 'RESOLVED' } } }),
        prisma.whatsAppMessage.count({ where: { status: 'FAILED', updatedAt: { gte: weekAgo } } }),
      ]);
      result.support = { openTickets, failedMessages };
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Admin dashboard error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Therapists seen in the app or with a session since `since`. Users and
// sessions live in the HIPAA database, profiles in the app database.
async function countActiveTherapists(since: Date, now: Date) {
  const [seen, withSessions] = await Promise.all([
    prisma.user.findMany({ where: { lastSeenAt: { gte: since } }, select: { id: true } }),
    prisma.session.findMany({
      where: { OR: [{ startedAt: { gte: since } }, { scheduledAt: { gte: since, lte: now } }] },
      distinct: ['therapistId'],
      select: { therapistId: true },
    }),
  ]);
  return appDb.profileTherapist.count({
    where: {
      OR: [{ userId: { in: seen.map((u) => u.id) } }, { id: { in: withSessions.map((s) => s.therapistId) } }],
    },
  });
}

// Turn sparse date_trunc buckets into a continuous series (missing = 0).
function fillDays(rows: { bucket: Date; n: number }[], days: number) {
  const map = new Map(rows.map((r) => [new Date(r.bucket).toISOString().slice(0, 10), r.n]));
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.now() - (days - 1 - i) * 864e5);
    const key = d.toISOString().slice(0, 10);
    return { label: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), value: map.get(key) ?? 0 };
  });
}

function fillWeeks(rows: { bucket: Date; n: number }[], weeks: number) {
  const map = new Map(rows.map((r) => [new Date(r.bucket).toISOString().slice(0, 10), r.n]));
  // Postgres weeks start on Monday.
  const monday = new Date();
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return Array.from({ length: weeks }, (_, i) => {
    const d = new Date(monday.getTime() - (weeks - 1 - i) * 7 * 864e5);
    return {
      label: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      value: map.get(d.toISOString().slice(0, 10)) ?? 0,
    };
  });
}
