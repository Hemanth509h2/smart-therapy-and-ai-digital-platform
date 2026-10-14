import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/apiAuth';
import { audit } from '@/lib/audit';
import { ALL_MODULE_IDS } from '@/lib/modules';
import { addMonths } from '@/lib/subscriptions';
import { errorResponse } from '@/lib/apiError';

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
    const now = new Date();
    const grantedModules = unlimited ? [] : cleaned;

    const created = await prisma.$transaction(async (tx) => {
      // Supersede any existing active terms.
      const superseded = await tx.subscription.findMany({
        where: { therapistId: req.therapistId, status: 'ACTIVE' },
        select: { id: true },
      });
      await tx.subscription.updateMany({
        where: { therapistId: req.therapistId, status: 'ACTIVE' },
        data: { status: 'EXPIRED' },
      });

      const sub = await tx.subscription.create({
        data: {
          therapistId: req.therapistId,
          planId: req.planId,
          months: months_,
          startedAt: now,
          currentPeriodEnd: addMonths(now, months_),
          moduleAccess: grantedModules,
        },
      });

      // Apply tool access to the therapist (the in-session gate reads these).
      await tx.profileTherapist.update({
        where: { id: req.therapistId },
        data: {
          allModulesAllowed: unlimited,
          moduleAccess: grantedModules,
        },
      });

      await tx.subscriptionRequest.update({
        where: { id: req.id },
        data: { status: 'APPROVED', reviewedAt: now, modules: grantedModules },
      });
      return { sub, superseded: superseded.map((s) => s.id) };
    });

    await audit(request, auth, 'subscription_request.approve', target, {
      before,
      after: {
        status: 'APPROVED',
        months: months_,
        modules: grantedModules,
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
