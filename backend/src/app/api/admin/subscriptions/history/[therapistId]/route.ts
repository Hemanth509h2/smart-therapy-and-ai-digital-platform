import { NextResponse } from 'next/server';
import { appDb, prisma } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { resolveCurrent, serializeSubscription, subscriptionState } from '@/lib/billing/subscriptions';

export const dynamic = 'force-dynamic';

// GET /api/admin/subscriptions/history/[therapistId] — every term and plan
// request for one professional, plus a merged newest-first `events` timeline.
export async function GET(request: Request, { params }: { params: { therapistId: string } }) {
  try {
    const auth = await requireAdmin(request, 'billing.read');
    if (!auth.ok) return auth.response;

    const therapist = await appDb.profileTherapist.findUnique({
      where: { id: params.therapistId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        allModulesAllowed: true,
        moduleAccess: true,
        userId: true,
        subscriptions: { include: { plan: true }, orderBy: { startedAt: 'desc' } },
        subscriptionRequests: { include: { plan: { select: { name: true } } }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!therapist) return NextResponse.json({ error: 'Professional not found' }, { status: 404 });
    const user = await prisma.user.findUnique({ where: { id: therapist.userId }, select: { email: true } });

    const now = new Date();
    const current = resolveCurrent(therapist.subscriptions, now);
    const terms = therapist.subscriptions.map((s) => ({ ...serializeSubscription(s)!, current: s.id === current?.id }));
    const requests = therapist.subscriptionRequests.map((r) => ({
      id: r.id,
      planId: r.planId,
      planName: r.plan.name,
      months: r.months,
      modules: r.modules,
      status: r.status,
      note: r.note,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt,
    }));

    // One row per thing that happened, newest first.
    type Event = { at: Date; kind: string; title: string; detail?: string; refId: string };
    const events: Event[] = [];
    for (const r of therapist.subscriptionRequests) {
      events.push({ at: r.createdAt, kind: 'request', title: `Requested ${r.plan.name}`, detail: `${r.months} mo${r.note ? ` · “${r.note}”` : ''}`, refId: r.id });
      if (r.reviewedAt && r.status !== 'PENDING') {
        events.push({ at: r.reviewedAt, kind: r.status === 'APPROVED' ? 'approved' : 'rejected', title: `Request ${r.status === 'APPROVED' ? 'approved' : 'rejected'}`, detail: r.plan.name, refId: r.id });
      }
    }
    for (const s of therapist.subscriptions) {
      events.push({ at: s.startedAt, kind: 'term', title: `${s.plan.name} term started`, detail: `${s.months} mo · ${s.status.toLowerCase()}`, refId: s.id });
      if (s.renewedAt) {
        events.push({ at: s.renewedAt, kind: 'renewed', title: `${s.plan.name} renewed`, detail: `${s.renewalCount} renewal${s.renewalCount === 1 ? '' : 's'} total`, refId: s.id });
      }
      if (s.currentPeriodEnd.getTime() <= now.getTime() || s.status !== 'ACTIVE') {
        events.push({
          // Cancelled or superseded early: the row's last update is when it stopped.
          at: s.status !== 'ACTIVE' && s.updatedAt < s.currentPeriodEnd ? s.updatedAt : s.currentPeriodEnd,
          kind: s.status === 'CANCELLED' ? 'cancelled' : 'ended',
          title: `${s.plan.name} ${s.status === 'CANCELLED' ? 'cancelled' : 'ended'}`,
          refId: s.id,
        });
      }
    }
    events.sort((a, b) => b.at.getTime() - a.at.getTime());

    return NextResponse.json({
      therapist: {
        id: therapist.id,
        name: `${therapist.firstName} ${therapist.lastName}`.trim(),
        email: user?.email ?? '',
        allModulesAllowed: therapist.allModulesAllowed,
        moduleAccess: therapist.moduleAccess,
        state: subscriptionState(current, therapist.subscriptions[0] ?? null, now),
      },
      terms,
      requests,
      events,
    });
  } catch (error: any) {
    console.error('Admin subscription history GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
