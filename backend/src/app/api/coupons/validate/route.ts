import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/apiAuth';
import { prisma } from '@/lib/db';
import { applyCoupon } from '@/lib/coupons';
import { errorResponse } from '@/lib/apiError';

export const dynamic = 'force-dynamic';

// POST /api/coupons/validate — price a plan checkout with a coupon, for the
// therapist's checkout dialog. Body: { code, planId, months }.
// Checkout re-checks the code; this is only a preview.
export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    const { code, planId, months } = await request.json();

    const therapist = await prisma.profileTherapist.findUnique({ where: { userId: auth.uid } });
    if (!therapist) return NextResponse.json({ error: 'Only therapists can use coupons.' }, { status: 403 });
    const plan = planId ? await prisma.plan.findUnique({ where: { id: String(planId) } }) : null;
    if (!plan || !plan.isActive || plan.priceMonthly <= 0) {
      return NextResponse.json({ error: 'Coupons only apply to paid plans.' }, { status: 400 });
    }

    const months_ = Math.max(1, Math.min(36, Number(months) || plan.durationMonths || 1));
    const result = await applyCoupon(code, { plan, months: months_, therapistId: therapist.id });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    const { coupon, subtotal, discount, total } = result;
    return NextResponse.json({
      code: coupon.code,
      description: coupon.description,
      type: coupon.type,
      discountValue: coupon.discountValue,
      subtotal,
      discount,
      total,
    });
  } catch (error: any) {
    return errorResponse(error, 'Coupon validate error');
  }
}
