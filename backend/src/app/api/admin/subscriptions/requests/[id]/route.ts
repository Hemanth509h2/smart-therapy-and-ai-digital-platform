import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { ALL_MODULE_IDS } from '@/lib/modules/modules';
import { activatePlan } from '@/lib/billing/subscriptions';
import { errorResponse } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

// POST /api/admin/subscriptions/requests/[id] — approve or reject a plan request.
// Body: { action: 'approve' | 'reject', modules?, months? }
// On approve: any prior ACTIVE term is expired, a new Subscription is created,
// and the therapist's module access is set from the (admin-confirmable) tool list
// — unlimited plans grant all tools.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin(request, 'billing.write');
    if (!auth.ok) return auth.response;
    const { action, modules, months } = await request.json();

    const req = await prisma.subscriptionRequest.findUnique({
      where: { id: params.id },
      include: { plan: true },
    });
    if (!req) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    const target = { type: 'SubscriptionRequest', id: req.id };
    const before = { status: req.status, planId: req.planId, planName: req.plan.name, months: req.months, modules: req.modules };
    if (req.status !== 'PENDING') {
      return NextResponse.json({ error: 'Request already reviewed.' }, { status: 409 });
    }

    if (action === 'reject') {
      const updated = await prisma.subscriptionRequest.update({
        where: { id: req.id },
        data: { status: 'REJECTED', reviewedAt: new Date() },
      });
      await audit(request, auth, 'subscription_request.reject', target, { before, after: { status: updated.status } });
      return NextResponse.json({ success: true, request: updated });
    }

    if (action !== 'approve') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const plan = req.plan;
    const unlimited = plan.toolQuota == null;

    // Admin may tweak the granted tools at approval time; default to requested.
    const requested = Array.isArray(modules) && modules.length ? modules : req.modules;
    const cleaned = Array.from(
      new Set((requested as string[]).filter((m) => ALL_MODULE_IDS.includes(m)))
    );

    if (!unlimited) {
      if (cleaned.length === 0) {
        return NextResponse.json({ error: 'Select at least one tool to grant.' }, { status: 400 });
      }
      if (plan.toolQuota != null && cleaned.length > plan.toolQuota) {
        return NextResponse.json(
          { error: `This plan allows up to ${plan.toolQuota} tools.` },
          { status: 400 }
        );
      }
    }

    const months_ = Math.max(1, Math.min(36, Number(months) || req.months || 1));

    const created = await prisma.$transaction(async (tx) => {
      // Recorded for the audit log; activatePlan supersedes them.
      const superseded = await tx.subscription.findMany({
        where: { therapistId: req.therapistId, status: 'ACTIVE' },
        select: { id: true },
      });
      const { subscription: sub, grantedModules } = await activatePlan(tx, {
        therapistId: req.therapistId,
        plan,
        months: months_,
        modules: cleaned,
      });

      await tx.subscriptionRequest.update({
        where: { id: req.id },
        data: { status: 'APPROVED', reviewedAt: new Date(), modules: grantedModules },
      });
      return { sub, grantedModules, superseded: superseded.map((s) => s.id) };
    });

    await audit(request, auth, 'subscription_request.approve', target, {
      before,
      after: {
        status: 'APPROVED',
        months: months_,
        modules: created.grantedModules,
        unlimited,
        subscriptionId: created.sub.id,
        currentPeriodEnd: created.sub.currentPeriodEnd,
        supersededSubscriptionIds: created.superseded,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return errorResponse(error, 'Subscription request review error');
  }
}
