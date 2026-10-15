// Cashfree Payment Gateway (PG) REST client.
// Docs: https://www.cashfree.com/docs/payments/online/web/redirect
//       https://www.cashfree.com/docs/api-reference/payments/latest/overview
//       https://www.cashfree.com/docs/payments/online/webhooks/signature-verification
//
// The secret key stays on the server. The browser only ever receives the
// short-lived payment_session_id, which it hands to Cashfree's JS checkout.

import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/db';
import { activatePlan } from '@/lib/subscriptions';

const API_VERSION = '2026-01-01';

export type CashfreeEnv = 'sandbox' | 'production';

export function cashfreeEnv(): CashfreeEnv {
  return process.env.CASHFREE_ENV === 'production' ? 'production' : 'sandbox';
}

function baseUrl() {
  return cashfreeEnv() === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';
}

export function cashfreeConfigured() {
  return Boolean(process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY);
}

export async function cashfreeRequest<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-api-version': API_VERSION,
      'x-client-id': process.env.CASHFREE_APP_ID || '',
      'x-client-secret': process.env.CASHFREE_SECRET_KEY || '',
      ...init?.headers,
    },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error(data?.message || `Cashfree request failed (${res.status})`);
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data as T;
}

/**
 * Records a Payment row, then creates the matching Cashfree order and returns
 * what the browser checkout needs. The row is written first so a webhook can
 * never arrive for an order we have no row for; it is removed again if
 * Cashfree rejects the order.
 */
export async function createCashfreeOrder(opts: {
  prefix: string; // order_id prefix, e.g. 'test' or 'sub'
  uid: string;
  amount: number; // INR
  phone: string; // 10 digits
  customerName?: string;
  customerEmail?: string | null;
  returnUrl?: string;
  note?: string;
  plan?: { planId: string; therapistId: string; months: number; modules: string[] };
  coupon?: { couponId: string; couponCode: string; discount: number };
}) {
  // customer_id: 3-50 alphanumerics. order_id: 3-45 of [A-Za-z0-9_-].
  const customerId = `u${opts.uid.replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 50).padEnd(3, '0');
  const orderId = `${opts.prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const amount = Math.round(opts.amount * 100) / 100;

  await prisma.payment.create({
    data: {
      id: orderId,
      userId: opts.uid,
      amount,
      currency: 'INR',
      orderStatus: 'ACTIVE',
      environment: cashfreeEnv(),
      ...(opts.plan ?? {}),
      ...(opts.coupon ?? {}),
    },
  });

  let order: any;
  try {
    order = await cashfreeRequest('/orders', {
      method: 'POST',
      body: JSON.stringify({
        order_id: orderId,
        order_amount: amount,
        order_currency: 'INR',
        customer_details: {
          customer_id: customerId,
          customer_phone: opts.phone,
          customer_name: opts.customerName || undefined,
          customer_email: opts.customerEmail || undefined,
        },
        order_meta: {
          return_url: opts.returnUrl ? `${opts.returnUrl}?order_id=${orderId}` : undefined,
          // Optional per-order webhook URL (must be https). Otherwise the
          // endpoint registered in the Cashfree dashboard is used.
          notify_url: process.env.CASHFREE_NOTIFY_URL || undefined,
        },
        order_note: opts.note,
      }),
    });
  } catch (err) {
    await prisma.payment.delete({ where: { id: orderId } }).catch(() => {});
    throw err;
  }

  return {
    orderId: order.order_id as string,
    paymentSessionId: order.payment_session_id as string,
    orderStatus: order.order_status as string,
    environment: cashfreeEnv(),
  };
}

/**
 * Webhook signature: Base64(HMAC-SHA256(timestamp + rawBody, secretKey)).
 * Must be computed over the raw body text — re-serialising parsed JSON can
 * change numbers like 170.00 -> 170 and break the signature.
 */
export function verifyCashfreeSignature(rawBody: string, timestamp: string | null, signature: string | null) {
  const secret = process.env.CASHFREE_SECRET_KEY;
  if (!secret || !timestamp || !signature) return false;
  const expected = createHmac('sha256', secret).update(timestamp + rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Re-reads the order (and its latest payment attempt) from Cashfree and
 * stores it. Cashfree is the source of truth, so this is safe to call any
 * number of times, in any order — duplicate or out-of-order webhooks and
 * browser polls all converge on the same row. A PAID order is never downgraded.
 */
export async function syncCashfreeOrder(orderId: string, opts: { fromWebhook?: boolean } = {}) {
  const id = encodeURIComponent(orderId);
  const [order, payments] = await Promise.all([
    cashfreeRequest(`/orders/${id}`),
    cashfreeRequest<any[]>(`/orders/${id}/payments`).catch(() => [] as any[]),
  ]);

  // Prefer the successful attempt; otherwise the most recent one.
  const sorted = [...payments].sort(
    (x, y) => new Date(y.payment_time || 0).getTime() - new Date(x.payment_time || 0).getTime()
  );
  const latest = sorted.find((p) => p.payment_status === 'SUCCESS') || sorted[0];

  const existing = await prisma.payment.findUnique({ where: { id: orderId } });
  if (existing) {
    const orderStatus = existing.orderStatus === 'PAID' ? 'PAID' : order.order_status;
    await prisma.payment.update({
      where: { id: orderId },
      data: {
        orderStatus,
        cfPaymentId: latest ? String(latest.cf_payment_id) : existing.cfPaymentId,
        paymentStatus: latest?.payment_status ?? existing.paymentStatus,
        paymentMethod: latest?.payment_group ?? existing.paymentMethod,
        paymentMessage: latest?.payment_message ?? existing.paymentMessage,
        paidAt:
          existing.paidAt ??
          (orderStatus === 'PAID'
            ? new Date(latest?.payment_completion_time || latest?.payment_time || Date.now())
            : null),
        ...(opts.fromWebhook ? { lastWebhookAt: new Date() } : {}),
      },
    });
    if (orderStatus === 'PAID') await activatePaidPlan(orderId);
  }

  return { order, payments, existing };
}

/**
 * Activates the plan a PAID order bought. Safe to call repeatedly and
 * concurrently (webhook + browser status check): the conditional update on
 * subscriptionId lets exactly one caller claim the payment; everyone else
 * sees count 0 and returns. Any failure rolls the claim back, so the next
 * webhook retry or status check tries again.
 */
async function activatePaidPlan(orderId: string) {
  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: orderId } });
    if (!payment?.planId || !payment.therapistId || !payment.months || payment.subscriptionId) return;

    const subscriptionId = randomUUID();
    const claimed = await tx.payment.updateMany({
      where: { id: orderId, subscriptionId: null },
      data: { subscriptionId },
    });
    if (claimed.count === 0) return;

    // Honour the purchase even if the plan was deactivated after checkout.
    const plan = await tx.plan.findUnique({ where: { id: payment.planId } });
    if (!plan) throw new Error(`Plan ${payment.planId} for paid order ${orderId} no longer exists`);

    await activatePlan(tx, {
      therapistId: payment.therapistId,
      plan,
      months: payment.months,
      modules: payment.modules,
      subscriptionId,
    });

    // Close any request still waiting for an admin, so approving it later
    // can't replace the plan that was just paid for.
    await tx.subscriptionRequest.updateMany({
      where: { therapistId: payment.therapistId, status: 'PENDING' },
      data: { status: 'REJECTED', reviewedAt: new Date() },
    });
    console.log(`[cashfree] order ${orderId} paid — activated ${plan.name} for therapist ${payment.therapistId}`);
  });
}
