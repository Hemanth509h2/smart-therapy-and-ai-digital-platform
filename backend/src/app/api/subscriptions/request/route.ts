import { NextResponse } from 'next/server';
import { prisma, appDb } from '@/lib/core/db';
import { requireAuth } from '@/lib/http/apiAuth';
import { ALL_MODULE_IDS } from '@/lib/modules/modules';
import { errorResponse, notYourProfile } from '@/lib/http/apiError';
import { pricePurchase } from '@/lib/billing/purchase';

// The caller must own the therapist profile or be an ADMIN.
async function mayAccessTherapist(uid: string, therapistId: string) {
  const [therapist, user] = await Promise.all([
    appDb.profileTherapist.findUnique({ where: { id: therapistId }, select: { userId: true } }),
    prisma.user.findUnique({ where: { id: uid }, select: { role: true } }),
  ]);
  return therapist?.userId === uid || user?.role === 'ADMIN';
}

// POST /api/subscriptions/request — a therapist requests a plan (pending admin
// approval). Body: { therapistId, planId, months?, modules?, note?, couponCode? }
// `modules` are the specific tools the therapist wants; capped by the plan's
// toolQuota (ignored for unlimited plans). The price (with any coupon) is
// stored for the admin to see; approval re-prices it and fixes what is paid.
export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    const { therapistId, planId, months, modules, note, couponCode } = await request.json();

    if (!therapistId || !planId) {
      return NextResponse.json(
        {
          error: !planId
            ? 'Choose a plan first.'
            : "Your therapist profile hasn't loaded yet. Refresh the page and try again.",
        },
        { status: 400 }
      );
    }
    if (!(await mayAccessTherapist(auth.uid, therapistId))) {
      return notYourProfile('this therapist profile');
    }

    const [therapist, plan, existingPending] = await Promise.all([
      appDb.profileTherapist.findUnique({ where: { id: therapistId } }),
      appDb.plan.findUnique({ where: { id: planId } }),
      appDb.subscriptionRequest.findFirst({ where: { therapistId, status: { in: ['PENDING', 'AWAITING_PAYMENT'] } } }),
    ]);

    if (!therapist) return NextResponse.json({ error: "We couldn't find your therapist profile. Refresh the page or sign in again." }, { status: 404 });
    if (!plan || !plan.isActive) {
      return NextResponse.json({ error: 'That plan is no longer available. Choose another plan on the Plans page.' }, { status: 404 });
    }
    if (existingPending) {
      return NextResponse.json(
        {
          error:
            existingPending.status === 'AWAITING_PAYMENT'
              ? 'You have an approved plan waiting for payment. Pay for it or withdraw it first.'
              : 'You already have a pending request awaiting admin approval.',
        },
        { status: 409 }
      );
    }

    // Keep only known module ids.
    const cleaned = Array.isArray(modules)
      ? Array.from(new Set(modules.filter((m: string) => ALL_MODULE_IDS.includes(m))))
      : [];

    // Enforce the plan's tool quota (null = unlimited, tool selection ignored).
    if (plan.toolQuota != null) {
      if (cleaned.length === 0) {
        return NextResponse.json({ error: 'Select at least one tool for this plan.' }, { status: 400 });
      }
      if (cleaned.length > plan.toolQuota) {
        return NextResponse.json(
          { error: `This plan includes up to ${plan.toolQuota} tools. Remove some tools or choose a bigger plan.` },
          { status: 400 }
        );
      }
    }

    const months_ = Math.max(1, Math.min(36, Number(months) || plan.durationMonths || 1));

    const price = await pricePurchase({ plan, months: months_, therapistId, couponCode });
    if (!price.ok) return NextResponse.json({ error: price.error }, { status: 400 });
    const { priced } = price;

    const created = await appDb.subscriptionRequest.create({
      data: {
        therapistId,
        planId,
        months: months_,
        modules: plan.toolQuota == null ? [] : cleaned,
        note: note?.trim() || null,
        couponId: priced.coupon?.couponId ?? null,
        couponCode: priced.coupon?.couponCode ?? null,
        subtotal: priced.subtotal,
        discount: priced.discount,
        total: priced.total,
      },
    });

    return NextResponse.json({ success: true, request: created });
  } catch (error: any) {
    return errorResponse(error, 'Subscription request POST error');
  }
}
