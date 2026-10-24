import { NextResponse } from 'next/server';
import { appDb } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { ALL_MODULE_IDS } from '@/lib/modules/modules';
import { activateFreePurchase, pricePurchase } from '@/lib/billing/purchase';
import { PublicError, errorResponse } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

// POST /api/admin/subscriptions/requests/[id] — approve or reject a plan request.
// Body: { action: 'approve' | 'reject', modules?, months?, removeCoupon? }
// On approve the request is re-priced (term, plan price, coupon) and:
//  - total ₹0 (free plan, or a coupon covering it all): the plan starts now —
//    any prior ACTIVE term is expired, a new Subscription is created and the
//    therapist's module access is set from the (admin-confirmable) tool list;
//    unlimited plans grant all tools. No Cashfree.
//  - otherwise: the request becomes AWAITING_PAYMENT at that fixed price, and
//    the plan starts when the therapist pays (lib/billing/cashfree.ts).
// Reject also revokes an approval that hasn't been paid yet.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin(request, 'billing.write');
    if (!auth.ok) return auth.response;
    const { action, modules, months, removeCoupon } = await request.json();

    const req = await appDb.subscriptionRequest.findUnique({
      where: { id: params.id },
      include: { plan: true, therapist: { select: { userId: true } } },
    });
    if (!req) return NextResponse.json({ error: "We couldn't find this plan request. The professional may have withdrawn it." }, { status: 404 });
    const target = { type: 'SubscriptionRequest', id: req.id };
    const before = {
      status: req.status,
      planId: req.planId,
      planName: req.plan.name,
      months: req.months,
      modules: req.modules,
      couponCode: req.couponCode,
      total: req.total,
    };

    if (action === 'reject') {
      // Conditional, so a payment activating it at the same moment wins.
      const { count } = await appDb.subscriptionRequest.updateMany({
        where: { id: req.id, status: { in: ['PENDING', 'AWAITING_PAYMENT'] } },
        data: { status: 'REJECTED', reviewedAt: new Date() },
      });
      if (!count) return NextResponse.json({ error: 'This plan request is already closed. Refresh the page to see its current status.' }, { status: 409 });
      await audit(request, auth, 'subscription_request.reject', target, { before, after: { status: 'REJECTED' } });
      return NextResponse.json({ success: true });
    }
    if (req.status !== 'PENDING') {
      return NextResponse.json({ error: 'This plan request has already been reviewed. Refresh the page to see its current status.' }, { status: 409 });
    }

    if (action !== 'approve') {
      return NextResponse.json({ error: "We couldn't tell what to do. Refresh the page and try again." }, { status: 400 });
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
          { error: `This plan includes up to ${plan.toolQuota} tools. Select fewer tools.` },
          { status: 400 }
        );
      }
    }

    const months_ = Math.max(1, Math.min(36, Number(months) || req.months || 1));
    const grant = unlimited ? [] : cleaned;

    const price = await pricePurchase({
      plan,
      months: months_,
      therapistId: req.therapistId,
      couponCode: removeCoupon ? null : req.couponCode,
      excludeRequestId: req.id,
    });
    if (!price.ok) {
      return NextResponse.json(
        { error: req.couponCode ? `Coupon ${req.couponCode}: ${price.error} Approve without the coupon, or reject.` : price.error },
        { status: 400 }
      );
    }
    const { priced } = price;
    const pricing = {
      couponId: priced.coupon?.couponId ?? null,
      couponCode: priced.coupon?.couponCode ?? null,
      subtotal: priced.subtotal,
      discount: priced.discount,
      total: priced.total,
    };

    if (priced.total > 0) {
      const { count } = await appDb.subscriptionRequest.updateMany({
        where: { id: req.id, status: 'PENDING' },
        data: { status: 'AWAITING_PAYMENT', reviewedAt: new Date(), months: months_, modules: grant, ...pricing },
      });
      if (!count) return NextResponse.json({ error: 'This plan request has already been reviewed. Refresh the page to see its current status.' }, { status: 409 });
      await audit(request, auth, 'subscription_request.approve', target, {
        before,
        after: { status: 'AWAITING_PAYMENT', months: months_, modules: grant, unlimited, ...pricing },
      });
      return NextResponse.json({ success: true, status: 'AWAITING_PAYMENT', total: priced.total });
    }

    const created = await appDb.$transaction(async (tx) => {
      // Recorded for the audit log; activateFreePurchase supersedes them.
      const superseded = await tx.subscription.findMany({
        where: { therapistId: req.therapistId, status: 'ACTIVE' },
        select: { id: true },
      });
      // Claim the request, so two admins approving at once can't both activate it.
      const { count } = await tx.subscriptionRequest.updateMany({ where: { id: req.id, status: 'PENDING' }, data: pricing });
      if (!count) throw new PublicError('This plan request has already been reviewed. Refresh the page to see its current status.', 409);
      const { subscription: sub, grantedModules } = await activateFreePurchase(tx, {
        therapistId: req.therapistId,
        userId: req.therapist.userId,
        plan,
        months: months_,
        modules: grant,
        priced,
        requestId: req.id,
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
        ...pricing,
        subscriptionId: created.sub.id,
        currentPeriodEnd: created.sub.currentPeriodEnd,
        supersededSubscriptionIds: created.superseded,
      },
    });

    return NextResponse.json({ success: true, status: 'APPROVED', total: 0 });
  } catch (error: any) {
    return errorResponse(error, 'Subscription request review error');
  }
}
