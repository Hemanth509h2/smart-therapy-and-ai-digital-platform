import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { FREE_TIER_ACCESS, addMonths, resolveCurrent, termAccess } from '@/lib/billing/subscriptions';
import { errorResponse } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

const snapshot = (s: { status: string; months: number; currentPeriodEnd: Date; renewalCount: number }) => ({
  status: s.status,
  months: s.months,
  currentPeriodEnd: s.currentPeriodEnd,
  renewalCount: s.renewalCount,
});

// PATCH /api/admin/subscriptions/[id] — manage an existing term.
// Body: { action: 'renew' | 'cancel' | 'reactivate', months? }
// renew: extends currentPeriodEnd by `months`, bumps renewalCount, marks renewed.
// Tool access follows: a term that becomes current again re-applies its tools;
// cancelling the therapist's last current term reverts them to the free tier.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin(request, 'billing.write');
    if (!auth.ok) return auth.response;
    const { action, months } = await request.json();

    const sub = await prisma.subscription.findUnique({ where: { id: params.id }, include: { plan: true } });
    if (!sub) return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
    const target = { type: 'Subscription', id: sub.id };

    if (action === 'cancel') {
      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED' } });
        const others = await tx.subscription.findMany({ where: { therapistId: sub.therapistId, status: 'ACTIVE' }, include: { plan: true } });
        if (!resolveCurrent(others)) {
          await tx.profileTherapist.update({ where: { id: sub.therapistId }, data: FREE_TIER_ACCESS });
        }
        return row;
      });
      await audit(request, auth, 'subscription.cancel', target, { before: snapshot(sub), after: snapshot(updated) });
      return NextResponse.json({ subscription: updated });
    }

    // Only one term may be current: don't revive an old one alongside it.
    if (action === 'renew' || action === 'reactivate') {
      const active = await prisma.subscription.findMany({ where: { therapistId: sub.therapistId, status: 'ACTIVE' }, include: { plan: true } });
      const current = resolveCurrent(active);
      if (current && current.id !== sub.id) {
        return NextResponse.json({ error: 'This professional already has a different current term.' }, { status: 409 });
      }
    }

    if (action === 'renew') {
      const addMo = Math.max(1, Math.min(36, Number(months) || sub.months || 1));
      const now = new Date();
      // Extend from the later of now / current end so renewals don't lose time.
      const base = sub.currentPeriodEnd.getTime() > now.getTime() ? sub.currentPeriodEnd : now;
      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.subscription.update({
          where: { id: sub.id },
          data: {
            status: 'ACTIVE',
            months: addMo,
            currentPeriodEnd: addMonths(base, addMo),
            renewedAt: now,
            renewalCount: { increment: 1 },
            cancelledAt: null, // renewing undoes a therapist's cancellation
          },
        });
        await tx.profileTherapist.update({ where: { id: sub.therapistId }, data: termAccess(sub.plan.toolQuota, sub.moduleAccess) });
        return row;
      });
      await audit(request, auth, 'subscription.renew', target, { before: snapshot(sub), after: { ...snapshot(updated), addedMonths: addMo } });
      return NextResponse.json({ subscription: updated });
    }

    if (action === 'reactivate') {
      if (sub.currentPeriodEnd.getTime() <= Date.now()) {
        return NextResponse.json({ error: 'This term has already ended — renew it instead.' }, { status: 400 });
      }
      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.subscription.update({ where: { id: sub.id }, data: { status: 'ACTIVE', cancelledAt: null } });
        await tx.profileTherapist.update({ where: { id: sub.therapistId }, data: termAccess(sub.plan.toolQuota, sub.moduleAccess) });
        return row;
      });
      await audit(request, auth, 'subscription.reactivate', target, { before: snapshot(sub), after: snapshot(updated) });
      return NextResponse.json({ subscription: updated });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    return errorResponse(error, 'Subscription PATCH error');
  }
}
