// Pricing and ₹0 activation for plan purchases, shared by the therapist
// request, admin approval and checkout routes.
//
// Flow while the 'billing.approvalBeforePayment' setting is on: the therapist
// requests a plan (with any coupon) → an admin approves it → if the total is
// ₹0 the plan starts at once, otherwise the request waits for payment and
// starts when Cashfree reports the order PAID (lib/billing/cashfree.ts).
import { randomUUID } from 'crypto';
import type { Plan, Prisma } from '.prisma/app-client';
import { applyCoupon } from '@/lib/billing/coupons';
import { activatePlan } from '@/lib/billing/subscriptions';

export interface Priced {
  subtotal: number;
  discount: number;
  total: number;
  coupon: { couponId: string; couponCode: string } | null;
}

/** Prices `months` of `plan`, with the coupon if one is given. */
export async function pricePurchase(opts: {
  plan: Plan;
  months: number;
  therapistId: string;
  couponCode?: unknown;
  excludeRequestId?: string;
}): Promise<{ ok: true; priced: Priced } | { ok: false; error: string }> {
  const subtotal = opts.plan.priceMonthly * opts.months;
  if (!opts.couponCode || !String(opts.couponCode).trim()) {
    return { ok: true, priced: { subtotal, discount: 0, total: subtotal, coupon: null } };
  }
  if (subtotal <= 0) return { ok: false, error: 'Coupons only apply to paid plans.' };
  const r = await applyCoupon(opts.couponCode, opts);
  if (!r.ok) return r;
  return {
    ok: true,
    priced: { subtotal: r.subtotal, discount: r.discount, total: r.total, coupon: { couponId: r.coupon.id, couponCode: r.coupon.code } },
  };
}

/**
 * Marks the therapist's other open requests REJECTED, so approving one later
 * can't replace the plan that just started.
 */
export async function closeOpenRequests(tx: Prisma.TransactionClient, therapistId: string, exceptRequestId?: string | null) {
  await tx.subscriptionRequest.updateMany({
    where: {
      therapistId,
      status: { in: ['PENDING', 'AWAITING_PAYMENT'] },
      ...(exceptRequestId ? { id: { not: exceptRequestId } } : {}),
    },
    data: { status: 'REJECTED', reviewedAt: new Date() },
  });
}

/**
 * Starts a plan that costs nothing (a free plan, or a coupon covering the
 * whole order) without Cashfree. A coupon use is recorded as a PAID ₹0
 * Payment so it counts toward the coupon's limits. Run inside a transaction.
 */
export async function activateFreePurchase(
  tx: Prisma.TransactionClient,
  opts: {
    therapistId: string;
    userId: string;
    plan: Plan;
    months: number;
    modules: string[];
    priced: Priced;
    requestId?: string;
  }
) {
  const subscriptionId = randomUUID();
  const { subscription, grantedModules } = await activatePlan(tx, {
    therapistId: opts.therapistId,
    plan: opts.plan,
    months: opts.months,
    modules: opts.modules,
    subscriptionId,
  });

  if (opts.priced.coupon) {
    await tx.payment.create({
      data: {
        id: `free_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId: opts.userId,
        amount: 0,
        currency: 'INR',
        orderStatus: 'PAID',
        environment: 'none',
        paymentMessage: 'No payment needed: ₹0 after coupon',
        paidAt: new Date(),
        planId: opts.plan.id,
        therapistId: opts.therapistId,
        months: opts.months,
        modules: grantedModules,
        subscriptionId,
        requestId: opts.requestId ?? null,
        couponId: opts.priced.coupon.couponId,
        couponCode: opts.priced.coupon.couponCode,
        discount: opts.priced.discount,
      },
    });
  }

  if (opts.requestId) {
    await tx.subscriptionRequest.update({
      where: { id: opts.requestId },
      data: { status: 'APPROVED', reviewedAt: new Date(), modules: grantedModules },
    });
  }
  await closeOpenRequests(tx, opts.therapistId, opts.requestId);
  return { subscription, grantedModules };
}
