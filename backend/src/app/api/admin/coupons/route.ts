import { NextResponse } from 'next/server';
import { appDb } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { checkCoupon, parseCouponBody } from '@/lib/billing/coupons';
import { errorResponse } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

// GET /api/admin/coupons — every coupon, newest first, with redemptionCount
// (PAID orders), discountTotal (₹ given away through it) and therapistName
// (the professional a personal coupon belongs to, else null).
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request, 'billing.read');
    if (!auth.ok) return auth.response;
    const [coupons, used] = await Promise.all([
      appDb.coupon.findMany({
        orderBy: { createdAt: 'desc' },
        include: { therapist: { select: { firstName: true, lastName: true } } },
      }),
      appDb.payment.groupBy({
        by: ['couponId'],
        where: { couponId: { not: null }, orderStatus: 'PAID' },
        _count: { _all: true },
        _sum: { discount: true },
      }),
    ]);
    return NextResponse.json({
      coupons: coupons.map((c) => {
        const u = used.find((r) => r.couponId === c.id);
        const { therapist, ...rest } = c;
        return {
          ...rest,
          therapistName: therapist ? `${therapist.firstName} ${therapist.lastName}`.trim() : null,
          redemptionCount: u?._count._all ?? 0,
          discountTotal: Number(u?._sum.discount ?? 0),
        };
      }),
    });
  } catch (error: any) {
    return errorResponse(error, 'Admin coupons GET error');
  }
}

// POST /api/admin/coupons — create a coupon.
// Body: { code, type: PERCENT|FLAT, discountValue, description?, planIds?, minMonths?,
//         maxRedemptions?, oncePerTherapist?, therapistId?, startsAt?, expiresAt?, isActive? }
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request, 'billing.write');
    if (!auth.ok) return auth.response;
    const data = parseCouponBody(await request.json());
    if (typeof data === 'string') return NextResponse.json({ error: data }, { status: 400 });
    const invalid = checkCoupon({ startsAt: null, expiresAt: null, ...data } as any);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    const coupon = await appDb.coupon.create({ data: { ...(data as any), createdBy: auth.uid } });
    await audit(request, auth, 'coupon.create', { type: 'Coupon', id: coupon.id }, { after: coupon });
    return NextResponse.json({ coupon });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'A coupon with that code already exists.' }, { status: 409 });
    }
    if (error.code === 'P2003') return NextResponse.json({ error: 'That professional no longer exists.' }, { status: 400 });
    return errorResponse(error, 'Admin coupons POST error');
  }
}
