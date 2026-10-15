import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))
import { checkCoupon, couponDiscount, normalizeCode, parseCouponBody } from '../coupons'

describe('couponDiscount', () => {
  it('takes a rounded percentage off', () => {
    expect(couponDiscount({ type: 'PERCENT', discountValue: 15 }, 999)).toBe(150)
  })
  it('takes flat rupees off', () => {
    expect(couponDiscount({ type: 'FLAT', discountValue: 200 }, 999)).toBe(200)
  })
  it('never brings the total under ₹1', () => {
    expect(couponDiscount({ type: 'FLAT', discountValue: 5000 }, 999)).toBe(998)
  })
})

describe('parseCouponBody', () => {
  it('normalises the code and fills required fields', () => {
    expect(parseCouponBody({ code: ' welcome 10 ', type: 'PERCENT', discountValue: 10 })).toEqual({
      code: 'WELCOME10',
      type: 'PERCENT',
      discountValue: 10,
    })
    expect(normalizeCode('abc-1')).toBe('ABC-1')
  })
  it('rejects bad codes and values', () => {
    expect(typeof parseCouponBody({ code: 'a!', discountValue: 10 })).toBe('string')
    expect(typeof parseCouponBody({ code: 'OK10', discountValue: 0 })).toBe('string')
    expect(typeof parseCouponBody({ maxRedemptions: 0 }, true)).toBe('string')
  })
  it('treats blank limits and dates as unset on edit', () => {
    expect(parseCouponBody({ maxRedemptions: '', expiresAt: '' }, true)).toEqual({ maxRedemptions: null, expiresAt: null })
  })
})

describe('checkCoupon', () => {
  it('caps percentages at 99 and orders dates', () => {
    expect(checkCoupon({ type: 'PERCENT', discountValue: 100, startsAt: null, expiresAt: null })).toMatch(/1–99/)
    expect(checkCoupon({ type: 'FLAT', discountValue: 100, startsAt: new Date(2), expiresAt: new Date(1) })).toMatch(/after/)
    expect(checkCoupon({ type: 'FLAT', discountValue: 5000, startsAt: null, expiresAt: null })).toBeNull()
  })
})
