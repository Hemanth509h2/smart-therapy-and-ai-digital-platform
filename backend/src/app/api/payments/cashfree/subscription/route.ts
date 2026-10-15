import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/apiAuth';
import { prisma } from '@/lib/db';
import { cashfreeConfigured, createCashfreeOrder } from '@/lib/cashfree';
import { cleanPlanModules } from '@/lib/subscriptions';
import { applyCoupon } from '@/lib/coupons';

export const dynamic = 'force-dynamic';

// POST /api/payments/cashfree/subscription — start checkout for a paid plan.
// Body: { planId, months, modules?, customerPhone, returnUrl?, couponCode? }
//
// The therapist comes from the verified token and the amount from the plan
// (priceMonthly × months, less any coupon), never from the request. Nothing is activated here:
// the plan starts only once Cashfree reports the order PAID (webhook or the
// order status route), in syncCashfreeOrder.
export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    if (!cashfreeConfigured()) {
      return NextResponse.json({ error: 'Payments are not available right now.' }, { status: 503 });
    }

    const { planId, months, modules, customerPhone, returnUrl, couponCode } = await request.json();

    const therapist = await prisma.profileTherapist.findUnique({ where: { userId: auth.uid } });
    if (!therapist) {
      return NextResponse.json({ error: 'Only therapists can buy a plan.' }, { status: 403 });
    }

    // A pending admin request doesn't block paying; activation closes it.
    const plan = planId ? await prisma.plan.findUnique({ where: { id: String(planId) } }) : null;
    if (!plan || !plan.isActive) {
      return NextResponse.json({ error: 'Plan not available' }, { status: 404 });
    }
    if (plan.priceMonthly <= 0) {
      return NextResponse.json({ error: 'This plan is free — request it instead.' }, { status: 400 });
    }

    const tools = cleanPlanModules(plan, modules);
    if (!tools.ok) return NextResponse.json({ error: tools.error }, { status: 400 });

    const phone = String(customerPhone || '').replace(/\D/g, '').slice(-10);
    if (phone.length !== 10) {
      return NextResponse.json({ error: 'Please enter a 10-digit phone number.' }, { status: 400 });
    }

    const months_ = Math.max(1, Math.min(36, Number(months) || plan.durationMonths || 1));

    let amount = plan.priceMonthly * months_;
    let coupon: { couponId: string; couponCode: string; discount: number } | undefined;
    if (couponCode && String(couponCode).trim()) {
      const priced = await applyCoupon(couponCode, { plan, months: months_, therapistId: therapist.id });
      if (!priced.ok) return NextResponse.json({ error: priced.error }, { status: 400 });
      amount = priced.total;
      coupon = { couponId: priced.coupon.id, couponCode: priced.coupon.code, discount: priced.discount };
    }

    const order = await createCashfreeOrder({
      prefix: 'sub',
      uid: auth.uid,
      amount,
      phone,
      customerName: `${therapist.firstName} ${therapist.lastName}`.trim(),
      customerEmail: auth.email,
      returnUrl: returnUrl ? String(returnUrl) : undefined,
      note: `${plan.name} plan, ${months_} month${months_ === 1 ? '' : 's'}${coupon ? `, coupon ${coupon.couponCode}` : ''}`,
      plan: { planId: plan.id, therapistId: therapist.id, months: months_, modules: tools.modules },
      coupon,
    });

    return NextResponse.json(order);
  } catch (error: any) {
    console.error('Cashfree subscription checkout error:', error.details || error);
    return NextResponse.json(
      { error: error.message, details: error.details },
      { status: error.status && error.status < 500 ? 400 : 500 }
    );
  }
}
