import { Router } from 'express';
import { appDb } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { checkCoupon, parseCouponBody } from '@/lib/billing/coupons';
import { errorResponse } from '@/lib/http/apiError';
import { handle, send } from '@/lib/http/reply';

export const router = Router();

// ---- /api/admin/coupons --------------------------------------------------------

// GET /api/admin/coupons — every coupon, newest first, with redemptionCount
// (PAID orders), discountTotal (₹ given away through it) and therapistName
// (the professional a personal coupon belongs to, else null).
router.get('/admin/coupons', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'billing.read');
    if (!auth.ok) return send(res, auth.response);
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
    return res.json({
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
    return send(res, errorResponse(error, 'Admin coupons GET error'));
  }
}));

// POST /api/admin/coupons — create a coupon.
// Body: { code, type: PERCENT|FLAT, discountValue, description?, planIds?, minMonths?, maxMonths?,
//         maxRedemptions?, oncePerTherapist?, therapistId? | email?, startsAt?, expiresAt?, isActive? }
// email reserves the code for whoever signs up (or has signed up) with that address.
router.post('/admin/coupons', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'billing.write');
    if (!auth.ok) return send(res, auth.response);
    const data = parseCouponBody(req.body);
    if (typeof data === 'string') return res.status(400).json({ error: data });
    const invalid = checkCoupon({ startsAt: null, expiresAt: null, ...data } as any);
    if (invalid) return res.status(400).json({ error: invalid });

    const coupon = await appDb.coupon.create({ data: { ...(data as any), createdBy: auth.uid } });
    await audit(req, auth, 'coupon.create', { type: 'Coupon', id: coupon.id }, { after: coupon });
    return res.json({ coupon });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'A coupon with that code already exists.' });
    }
    if (error.code === 'P2003') return res.status(400).json({ error: 'That professional no longer exists.' });
    return send(res, errorResponse(error, 'Admin coupons POST error'));
  }
}));

// ---- /api/admin/coupons/:id ----------------------------------------------------

// PATCH /api/admin/coupons/[id] — edit any field. A body that only flips
// isActive is audited as enable/disable.
router.patch('/admin/coupons/:id', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'billing.write');
    if (!auth.ok) return send(res, auth.response);
    const data = parseCouponBody(req.body, true);
    if (typeof data === 'string') return res.status(400).json({ error: data });

    const before = await appDb.coupon.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: "We couldn't find this coupon. It may have been deleted." });
    const invalid = checkCoupon({ ...before, ...data } as any);
    if (invalid) return res.status(400).json({ error: invalid });

    const coupon = await appDb.coupon.update({ where: { id: req.params.id }, data });

    const keys = Object.keys(data);
    const action =
      keys.length === 1 && keys[0] === 'isActive' ? (data.isActive ? 'coupon.enable' : 'coupon.disable') : 'coupon.update';
    const pick = (c: Record<string, any>) => Object.fromEntries(keys.map((k) => [k, c[k]]));
    await audit(req, auth, action, { type: 'Coupon', id: coupon.id }, { before: pick(before), after: pick(coupon) });
    return res.json({ coupon });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'A coupon with that code already exists.' });
    }
    if (error.code === 'P2025') return res.status(404).json({ error: "We couldn't find this coupon. It may have been deleted." });
    if (error.code === 'P2003') return res.status(400).json({ error: 'That professional no longer exists.' });
    return send(res, errorResponse(error, 'Admin coupon PATCH error'));
  }
}));

// DELETE /api/admin/coupons/[id] — remove a coupon no order has used.
// Coupons on any payment are refused (409): disable them instead, so payment
// history keeps its link.
router.delete('/admin/coupons/:id', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'billing.write');
    if (!auth.ok) return send(res, auth.response);

    const coupon = await appDb.coupon.findUnique({ where: { id: req.params.id } });
    if (!coupon) return res.status(404).json({ error: "We couldn't find this coupon. It may have been deleted." });

    const used = await appDb.payment.count({ where: { couponId: req.params.id } });
    if (used > 0) {
      return res.status(409).json({
          error: `${coupon.code} is on ${used} order${used === 1 ? '' : 's'}, so it can't be deleted. Disable it instead.`,
          code: 'COUPON_IN_USE',
        });
    }

    await appDb.coupon.delete({ where: { id: req.params.id } });
    await audit(req, auth, 'coupon.delete', { type: 'Coupon', id: coupon.id }, { before: coupon });
    return res.json({ success: true });
  } catch (error: any) {
    if (error.code === 'P2025') return res.status(404).json({ error: "We couldn't find this coupon. It may have been deleted." });
    return send(res, errorResponse(error, 'Admin coupon DELETE error'));
  }
}));
