// Cashfree Payment Gateway (PG) REST client.
// Docs: https://www.cashfree.com/docs/payments/online/web/redirect
//       https://www.cashfree.com/docs/api-reference/payments/latest/overview
//       https://www.cashfree.com/docs/payments/online/webhooks/signature-verification
//
// The secret key stays on the server. The browser only ever receives the
// short-lived payment_session_id, which it hands to Cashfree's JS checkout.

import { createHmac, timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/db';

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
  }

  return { order, payments, existing };
}
