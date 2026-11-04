import { Router } from 'express';
import { requireAuth } from '@/lib/http/apiAuth';
import { appDb } from '@/lib/core/db';
import { applyCoupon } from '@/lib/billing/coupons';
import { errorResponse } from '@/lib/http/apiError';
import { handle, send } from '@/lib/http/reply';
import { rejectIfLimited } from '@/lib/http/rateLimit';

export const router = Router();

// ---- /api/coupons/validate -----------------------------------------------------

// POST /api/coupons/validate — price a plan checkout with a coupon, for the
// therapist's checkout dialog. Body: { code, planId, months }.
// Checkout re-checks the code; this is only a preview.
router.post('/coupons/validate', handle(async (req, res) => {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return send(res, auth.response);
    // Stops guessing coupon codes by trying many.
    if (await rejectIfLimited(res, { name: 'coupon-validate', limit: 20, windowMs: 60 * 60 * 1000 }, auth.uid,
      'You have tried many coupon codes. Please wait a while before trying again.')) return;
    const { code, planId, months } = req.body;

    const therapist = await appDb.profileTherapist.findUnique({ where: { userId: auth.uid } });
    if (!therapist) return res.status(403).json({ error: 'Only therapists can use coupons.' });
    const plan = planId ? await appDb.plan.findUnique({ where: { id: String(planId) } }) : null;
    if (!plan || !plan.isActive || plan.priceMonthly <= 0) {
      return res.status(400).json({ error: 'Coupons only apply to paid plans.' });
    }

    const months_ = Math.max(1, Math.min(36, Number(months) || plan.durationMonths || 1));
    const result = await applyCoupon(code, { plan, months: months_, therapistId: therapist.id });
    if (!result.ok) return res.status(400).json({ error: result.error });

    const { coupon, subtotal, discount, total } = result;
    return res.json({
      code: coupon.code,
      description: coupon.description,
      type: coupon.type,
      discountValue: coupon.discountValue,
      subtotal,
      discount,
      total,
    });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Coupon validate error'));
  }
}));
