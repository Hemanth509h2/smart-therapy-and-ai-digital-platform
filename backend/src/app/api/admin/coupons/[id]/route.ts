import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/apiAuth';
import { audit } from '@/lib/audit';
import { checkCoupon, parseCouponBody } from '@/lib/coupons';
import { errorResponse } from '@/lib/apiError';

export const dynamic = 'force-dynamic';

// PATCH /api/admin/coupons/[id] — edit any field. A body that only flips
// isActive is audited as enable/disable.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin(request, 'billing.write');
    if (!auth.ok) return auth.response;
    const data = parseCouponBody(await request.json(), true);
    if (typeof data === 'string') return NextResponse.json({ error: data }, { status: 400 });

    const before = await prisma.coupon.findUnique({ where: { id: params.id } });
    if (!before) return NextResponse.json({ error: 'Coupon not found' }, { status: 404 });
    const invalid = checkCoupon({ ...before, ...data } as any);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    const coupon = await prisma.coupon.update({ where: { id: params.id }, data });

    const keys = Object.keys(data);
    const action =
      keys.length === 1 && keys[0] === 'isActive' ? (data.isActive ? 'coupon.enable' : 'coupon.disable') : 'coupon.update';
    const pick = (c: Record<string, any>) => Object.fromEntries(keys.map((k) => [k, c[k]]));
    await audit(request, auth, action, { type: 'Coupon', id: coupon.id }, { before: pick(before), after: pick(coupon) });
    return NextResponse.json({ coupon });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'A coupon with that code already exists.' }, { status: 409 });
    }
    if (error.code === 'P2025') return NextResponse.json({ error: 'Coupon not found' }, { status: 404 });
    return errorResponse(error, 'Admin coupon PATCH error');
  }
}

// DELETE /api/admin/coupons/[id] — remove a coupon no order has used.
// Coupons on any payment are refused (409): disable them instead, so payment
// history keeps its link.
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin(request, 'billing.write');
    if (!auth.ok) return auth.response;

    const coupon = await prisma.coupon.findUnique({ where: { id: params.id } });
    if (!coupon) return NextResponse.json({ error: 'Coupon not found' }, { status: 404 });

    const used = await prisma.payment.count({ where: { couponId: params.id } });
    if (used > 0) {
      return NextResponse.json(
        {
          error: `${coupon.code} is on ${used} order${used === 1 ? '' : 's'}, so it can't be deleted. Disable it instead.`,
          code: 'COUPON_IN_USE',
        },
        { status: 409 }
      );
    }

    await prisma.coupon.delete({ where: { id: params.id } });
    await audit(request, auth, 'coupon.delete', { type: 'Coupon', id: coupon.id }, { before: coupon });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.code === 'P2025') return NextResponse.json({ error: 'Coupon not found' }, { status: 404 });
    return errorResponse(error, 'Admin coupon DELETE error');
  }
}
