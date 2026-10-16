import { NextResponse } from 'next/server';
import { cashfreeConfigured, syncCashfreeOrder, verifyCashfreeSignature } from '@/lib/billing/cashfree';

export const dynamic = 'force-dynamic';

// POST /api/payments/cashfree/webhook — Cashfree payment webhooks
// (PAYMENT_SUCCESS_WEBHOOK, PAYMENT_FAILED_WEBHOOK, PAYMENT_USER_DROPPED_WEBHOOK).
// Register this URL in Cashfree Dashboard > Developers > Webhooks, or set
// CASHFREE_NOTIFY_URL so it is sent per order as order_meta.notify_url.
//
// Delivery is at-least-once with retries until we answer 200, so handling is
// idempotent: we verify the signature, then re-sync the order from Cashfree
// rather than trusting the payload's status.
export async function POST(request: Request) {
  if (!cashfreeConfigured()) {
    return NextResponse.json({ error: 'Cashfree is not configured' }, { status: 503 });
  }

  const rawBody = await request.text();
  const valid = verifyCashfreeSignature(
    rawBody,
    request.headers.get('x-webhook-timestamp'),
    request.headers.get('x-webhook-signature')
  );
  if (!valid) {
    console.warn('[cashfree] webhook rejected: bad signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const orderId = event?.data?.order?.order_id;
  console.log(
    `[cashfree] webhook ${event?.type} order=${orderId} payment=${event?.data?.payment?.payment_status}` +
      ` idempotency=${request.headers.get('x-idempotency-key') ?? '-'}`
  );

  // Charges webhooks etc. carry nothing we store; acknowledge so they stop retrying.
  if (!orderId || event?.type === 'PAYMENT_CHARGES_WEBHOOK') {
    return NextResponse.json({ ok: true });
  }

  try {
    const { existing } = await syncCashfreeOrder(String(orderId), { fromWebhook: true });
    if (!existing) console.warn(`[cashfree] webhook for unknown order ${orderId}`);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    // Non-200 makes Cashfree retry later, which is what we want for a
    // transient DB/network failure.
    console.error('[cashfree] webhook processing failed:', error.details || error);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
