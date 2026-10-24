import { NextResponse } from 'next/server';
import type { Plan } from '.prisma/app-client';
import { requireAuth } from '@/lib/http/apiAuth';
import { appDb } from '@/lib/core/db';
import { cashfreeConfigured, createCashfreeOrder } from '@/lib/billing/cashfree';
import { cleanPlanModules } from '@/lib/billing/subscriptions';
import { activateFreePurchase, pricePurchase, type Priced } from '@/lib/billing/purchase';
import { getSetting } from '@/lib/core/settings';

export const dynamic = 'force-dynamic';

// POST /api/payments/cashfree/subscription — start checkout for a plan.
//   Pay for an approved request: { requestId, customerPhone, returnUrl? }
//   Buy directly (only while 'billing.approvalBeforePayment' is off):
//     { planId, months, modules?, customerPhone, returnUrl?, couponCode? }
//
// The therapist comes from the verified token and the amount from the
// approved request or the plan (priceMonthly × months, less any coupon),
// never from the request body. A ₹0 total starts the plan at once without
// Cashfree and answers { activated: true }. Otherwise nothing is activated
// here: the plan starts only once Cashfree reports the order PAID (webhook or
// the order status route), in syncCashfreeOrder.
export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    const { requestId, planId, months, modules, customerPhone, returnUrl, couponCode } = await request.json();

    const therapist = await appDb.profileTherapist.findUnique({ where: { userId: auth.uid } });
    if (!therapist) {
      return NextResponse.json({ error: 'Only therapists can buy a plan.' }, { status: 403 });
    }

    let purchase: { plan: Plan; months: number; modules: string[]; priced: Priced; requestId?: string };

    if (requestId) {
      const req = await appDb.subscriptionRequest.findUnique({ where: { id: String(requestId) }, include: { plan: true } });
      if (!req || req.therapistId !== therapist.id) {
        return NextResponse.json({ error: "We couldn't find that plan request. It may have been withdrawn." }, { status: 404 });
      }
      if (req.status !== 'AWAITING_PAYMENT' || req.total == null) {
        return NextResponse.json(
          { error: req.status === 'PENDING' ? "An admin hasn't approved this plan request yet. You can pay once it's approved." : 'This plan request is no longer waiting for payment. Check its status on the Plans page.' },
          { status: 409 }
        );
      }
      const alreadyPaid = await appDb.payment.count({ where: { requestId: req.id, orderStatus: 'PAID' } });
      if (alreadyPaid) return NextResponse.json({ error: 'This plan request has already been paid. Refresh the page to see your plan.' }, { status: 409 });
      purchase = {
        plan: req.plan,
        months: req.months,
        modules: req.modules,
        requestId: req.id,
        // The price the admin approved.
        priced: {
          subtotal: req.subtotal ?? req.total,
          discount: req.discount ?? 0,
          total: req.total,
          coupon: req.couponId && req.couponCode ? { couponId: req.couponId, couponCode: req.couponCode } : null,
        },
      };
    } else {
      if (await getSetting('billing.approvalBeforePayment')) {
        return NextResponse.json(
          { error: 'Plans need an admin’s approval first. Send a request; you can pay once it is approved.' },
          { status: 403 }
        );
      }
      // A pending admin request doesn't block paying; activation closes it.
      const plan = planId ? await appDb.plan.findUnique({ where: { id: String(planId) } }) : null;
      if (!plan || !plan.isActive) {
        return NextResponse.json({ error: 'That plan is no longer available. Choose another plan on the Plans page.' }, { status: 404 });
      }
      if (plan.priceMonthly <= 0) {
        return NextResponse.json({ error: "This plan is free, so there's nothing to pay. Send a request for it instead." }, { status: 400 });
      }
      const tools = cleanPlanModules(plan, modules);
      if (!tools.ok) return NextResponse.json({ error: tools.error }, { status: 400 });
      const months_ = Math.max(1, Math.min(36, Number(months) || plan.durationMonths || 1));
      const price = await pricePurchase({ plan, months: months_, therapistId: therapist.id, couponCode });
      if (!price.ok) return NextResponse.json({ error: price.error }, { status: 400 });
      purchase = { plan, months: months_, modules: tools.modules, priced: price.priced };
    }

    const { plan, months: months_, priced } = purchase;

    // Nothing to pay: start the plan without Cashfree.
    if (priced.total <= 0) {
      await appDb.$transaction((tx) =>
        activateFreePurchase(tx, {
          therapistId: therapist.id,
          userId: auth.uid,
          plan,
          months: months_,
          modules: purchase.modules,
          priced,
          requestId: purchase.requestId,
        })
      );
      return NextResponse.json({ activated: true });
    }

    if (!cashfreeConfigured()) {
      return NextResponse.json({ error: 'Payments are not available right now. Please try again later or contact support.' }, { status: 503 });
    }
    const phone = String(customerPhone || '').replace(/\D/g, '').slice(-10);
    if (phone.length !== 10) {
      return NextResponse.json({ error: 'Please enter a 10-digit phone number.' }, { status: 400 });
    }

    const order = await createCashfreeOrder({
      prefix: 'sub',
      uid: auth.uid,
      amount: priced.total,
      phone,
      customerName: `${therapist.firstName} ${therapist.lastName}`.trim(),
      customerEmail: auth.email,
      returnUrl: returnUrl ? String(returnUrl) : undefined,
      note: `${plan.name} plan, ${months_} month${months_ === 1 ? '' : 's'}${priced.coupon ? `, coupon ${priced.coupon.couponCode}` : ''}`,
      plan: { planId: plan.id, therapistId: therapist.id, months: months_, modules: purchase.modules, requestId: purchase.requestId },
      coupon: priced.coupon ? { ...priced.coupon, discount: priced.discount } : undefined,
    });

    return NextResponse.json(order);
  } catch (error: any) {
    console.error('Cashfree subscription checkout error:', error.details || error);
    return NextResponse.json(
      {
        error:
          error.status && error.status < 500
            ? 'The payment provider rejected this payment. Check your phone number and try again.'
            : "We couldn't start the payment. Please try again in a few minutes.",
        details: error.details,
      },
      { status: error.status && error.status < 500 ? 400 : 500 }
    );
  }
}
