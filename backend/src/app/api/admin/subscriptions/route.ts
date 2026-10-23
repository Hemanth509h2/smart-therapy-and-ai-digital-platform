import { NextResponse } from 'next/server';
import type { Prisma } from '.prisma/app-client';
import { appDb, prisma } from '@/lib/core/db';
import { usersById } from '@/lib/core/links';
import { requireAdmin } from '@/lib/http/apiAuth';
import { listParams } from '@/lib/admin/adminList';
import { daysUntil, resolveCurrent, serializeSubscription, subscriptionState } from '@/lib/billing/subscriptions';
import { errorResponse } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

// GET /api/admin/subscriptions — every professional with their current plan
// (months / period end / renewed) plus all pending plan requests to review.
// Filters: ?status=active|expiring7|expiring30|expired|none, ?planId= (current
// plan), ?q= (therapist name/email), ?sort=name|ends|joined. Paginated
// (?page=&pageSize=, adds `total`) only when `page` is passed; without it every
// professional is returned, as before.
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request, 'billing.read');
    if (!auth.ok) return auth.response;

    const { sp, skip, take, sort, dir, q } = listParams(request, { sortable: ['name', 'ends', 'joined'], defaultSort: 'joined' });
    const status = sp.get('status') || '';
    const planId = sp.get('planId') || '';
    const paginate = sp.has('page');

    // Emails live in the HIPAA database: match them there, then filter by userId.
    const emailMatches = q
      ? await prisma.user.findMany({ where: { email: { contains: q, mode: 'insensitive' } }, select: { id: true } })
      : [];
    const where: Prisma.ProfileTherapistWhereInput = q
      ? {
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { userId: { in: emailMatches.map((u) => u.id) } },
          ],
        }
      : {};

    const [therapists, requests] = await Promise.all([
      appDb.profileTherapist.findMany({
        where,
        include: {
          subscriptions: { include: { plan: true }, orderBy: { startedAt: 'desc' } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      appDb.subscriptionRequest.findMany({
        where: { status: 'PENDING' },
        include: { plan: true, therapist: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const users = await usersById([...therapists, ...requests.map((r) => r.therapist)].map((t) => t.userId), { email: true });

    const now = new Date();
    let professionals = therapists.map((t) => {
      const current = resolveCurrent(t.subscriptions, now);
      // Most recent term of any status — what renew/reactivate act on when
      // there is no current one.
      const latest = t.subscriptions[0] ?? null;
      return {
        therapistId: t.id,
        name: `${t.firstName} ${t.lastName}`.trim(),
        email: users.get(t.userId)?.email ?? '',
        allModulesAllowed: t.allModulesAllowed,
        moduleAccessCount: t.moduleAccess.length,
        current: serializeSubscription(current),
        latest: current ? null : serializeSubscription(latest),
        state: subscriptionState(current, latest, now),
        daysLeft: current ? daysUntil(current.currentPeriodEnd, now) : null,
        termCount: t.subscriptions.length,
        joinedAt: t.createdAt,
      };
    });

    professionals = professionals.filter((p) => {
      if (planId && p.current?.planId !== planId) return false;
      switch (status) {
        case 'active': return !!p.current;
        case 'expiring7': return p.daysLeft != null && p.daysLeft <= 7;
        case 'expiring30': return p.daysLeft != null && p.daysLeft <= 30;
        case 'expired': return p.state === 'expired' || p.state === 'cancelled';
        case 'none': return p.state === 'none';
        default: return true;
      }
    });

    if (sort !== 'joined' || dir === 'desc') {
      const key = (p: (typeof professionals)[number]): number | string =>
        sort === 'name'
          ? p.name.toLowerCase()
          : sort === 'ends'
            ? new Date(p.current?.currentPeriodEnd ?? p.latest?.currentPeriodEnd ?? 0).getTime()
            : new Date(p.joinedAt).getTime();
      const sign = dir === 'asc' ? 1 : -1;
      professionals.sort((a, b) => (key(a) < key(b) ? -sign : key(a) > key(b) ? sign : 0));
    }

    const total = professionals.length;
    if (paginate) professionals = professionals.slice(skip, skip + take);

    const pending = requests.map((r) => ({
      id: r.id,
      therapistId: r.therapistId,
      therapistName: `${r.therapist.firstName} ${r.therapist.lastName}`.trim(),
      email: users.get(r.therapist.userId)?.email ?? '',
      planId: r.planId,
      planName: r.plan.name,
      toolQuota: r.plan.toolQuota,
      months: r.months,
      modules: r.modules,
      note: r.note,
      createdAt: r.createdAt,
    }));

    return NextResponse.json({ professionals, total, requests: pending });
  } catch (error: any) {
    return errorResponse(error, 'Admin subscriptions GET error');
  }
}
