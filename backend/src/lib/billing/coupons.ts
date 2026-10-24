// Coupon (discount code) rules for paid plan checkout. Admins manage coupons
// at /admin/coupons; therapists enter a code in the plan checkout dialog.
//
// A redemption is a PAID Payment with the coupon attached (a ₹0 purchase gets
// a PAID ₹0 Payment too). A request an admin approved but that isn't paid yet
// holds a use as well, so approvals can't promise more uses than a code has.
// Pending checkouts don't count: two therapists paying at the same moment can
// both get the last use of a limited code — acceptable for discount codes, and
// an abandoned checkout never burns a use.
import type { Coupon, CouponType, Plan } from '.prisma/app-client';
import { appDb } from '@/lib/core/db';

export const MAX_CODE_LENGTH = 32;

export const normalizeCode = (code: unknown) =>
  String(code ?? '').trim().toUpperCase().replace(/\s+/g, '');

/**
 * Rupees off an order of `subtotal`, at most the whole order. A ₹0 total skips
 * Cashfree; any other total is a whole number of rupees, so at least its ₹1
 * minimum.
 */
export function couponDiscount(coupon: Pick<Coupon, 'type' | 'discountValue'>, subtotal: number) {
  const raw =
    coupon.type === 'PERCENT'
      ? Math.round((subtotal * coupon.discountValue) / 100)
      : coupon.discountValue;
  return Math.max(0, Math.min(raw, subtotal));
}

/**
 * Checks `code` against a purchase of `plan` for `months` by `therapistId`.
 * Returns the coupon and the priced order, or a message to show the therapist.
 */
export async function applyCoupon(
  code: unknown,
  opts: { plan: Plan; months: number; therapistId: string; excludeRequestId?: string }
): Promise<
  | { ok: true; coupon: Coupon; subtotal: number; discount: number; total: number }
  | { ok: false; error: string }
> {
  const normalized = normalizeCode(code);
  if (!normalized) return { ok: false, error: 'Enter a coupon code.' };

  const coupon = await appDb.coupon.findUnique({ where: { code: normalized } });
  const now = new Date();
  if (!coupon || !coupon.isActive || (coupon.startsAt && coupon.startsAt > now)) {
    return { ok: false, error: 'That coupon code is not valid.' };
  }
  if (coupon.expiresAt && coupon.expiresAt <= now) {
    return { ok: false, error: 'That coupon has expired.' };
  }
  if (coupon.planIds.length && !coupon.planIds.includes(opts.plan.id)) {
    return { ok: false, error: `That coupon can't be used for the ${opts.plan.name} plan.` };
  }
  if (opts.months < coupon.minMonths) {
    return { ok: false, error: `That coupon needs a term of at least ${coupon.minMonths} months.` };
  }

  // Paid uses plus approved requests still waiting for payment (except the one being priced).
  const held = { couponId: coupon.id, status: 'AWAITING_PAYMENT' as const, ...(opts.excludeRequestId ? { id: { not: opts.excludeRequestId } } : {}) };
  const [paid, heldByApprovals, paidByTherapist, heldForTherapist] = await Promise.all([
    coupon.maxRedemptions != null
      ? appDb.payment.count({ where: { couponId: coupon.id, orderStatus: 'PAID' } })
      : Promise.resolve(0),
    coupon.maxRedemptions != null ? appDb.subscriptionRequest.count({ where: held }) : Promise.resolve(0),
    coupon.oncePerTherapist
      ? appDb.payment.count({
          where: { couponId: coupon.id, orderStatus: 'PAID', therapistId: opts.therapistId },
        })
      : Promise.resolve(0),
    coupon.oncePerTherapist
      ? appDb.subscriptionRequest.count({ where: { ...held, therapistId: opts.therapistId } })
      : Promise.resolve(0),
  ]);
  const used = paid + heldByApprovals;
  const usedByTherapist = paidByTherapist + heldForTherapist;
  if (coupon.maxRedemptions != null && used >= coupon.maxRedemptions) {
    return { ok: false, error: 'That coupon has been fully used.' };
  }
  if (usedByTherapist > 0) {
    return { ok: false, error: "You've already used that coupon." };
  }

  const subtotal = opts.plan.priceMonthly * opts.months;
  const discount = couponDiscount(coupon, subtotal);
  return { ok: true, coupon, subtotal, discount, total: subtotal - discount };
}

/**
 * Validates an admin create/edit body. `partial` (PATCH) only checks the
 * fields present. Returns Prisma data or an error message.
 */
export function parseCouponBody(body: any, partial = false): Record<string, any> | string {
  const data: Record<string, any> = {};
  const has = (k: string) => body[k] !== undefined;

  if (!partial || has('code')) {
    const code = normalizeCode(body.code);
    if (!/^[A-Z0-9_-]{3,}$/.test(code) || code.length > MAX_CODE_LENGTH) {
      return `Code must be 3–${MAX_CODE_LENGTH} letters, numbers, - or _.`;
    }
    data.code = code;
  }
  if (has('description')) data.description = String(body.description ?? '').trim() || null;

  if (!partial || has('type')) {
    const type = String(body.type || 'PERCENT') as CouponType;
    if (type !== 'PERCENT' && type !== 'FLAT') return 'Type must be PERCENT or FLAT.';
    data.type = type;
  }
  if (!partial || has('discountValue')) {
    const v = Number(body.discountValue);
    if (!Number.isInteger(v) || v < 1) return 'Discount must be a whole number of at least 1.';
    data.discountValue = v;
  }
  if (has('planIds')) {
    if (!Array.isArray(body.planIds)) return 'planIds must be a list.';
    data.planIds = Array.from(new Set(body.planIds.map(String)));
  }
  if (has('minMonths')) {
    const v = Number(body.minMonths);
    if (!Number.isInteger(v) || v < 1 || v > 36) return 'Minimum term must be 1–36 months.';
    data.minMonths = v;
  }
  if (has('maxRedemptions')) {
    const v = body.maxRedemptions;
    if (v === null || v === '') data.maxRedemptions = null;
    else if (!Number.isInteger(Number(v)) || Number(v) < 1) return 'Usage limit must be at least 1, or blank for unlimited.';
    else data.maxRedemptions = Number(v);
  }
  if (has('oncePerTherapist')) data.oncePerTherapist = Boolean(body.oncePerTherapist);
  if (has('isActive')) data.isActive = Boolean(body.isActive);
  for (const k of ['startsAt', 'expiresAt'] as const) {
    if (!has(k)) continue;
    if (body[k] === null || body[k] === '') {
      data[k] = null;
      continue;
    }
    const d = new Date(body[k]);
    if (Number.isNaN(d.getTime())) return `${k === 'startsAt' ? 'Start' : 'Expiry'} date is not valid.`;
    data[k] = d;
  }
  return data;
}

/** Cross-field checks once a create/edit is merged with what's stored. */
export function checkCoupon(c: { type: CouponType; discountValue: number; startsAt: Date | null; expiresAt: Date | null }) {
  if (c.type === 'PERCENT' && c.discountValue > 100) {
    return 'A percentage discount must be 1–100%.';
  }
  if (c.startsAt && c.expiresAt && c.expiresAt <= c.startsAt) return 'Expiry must be after the start date.';
  return null;
}
