import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/http/apiAuth';
import { cashfreeConfigured, createCashfreeOrder } from '@/lib/billing/cashfree';

export const dynamic = 'force-dynamic';

// POST /api/payments/cashfree/order — create a Cashfree order for an arbitrary
// amount and return the payment_session_id for the browser checkout. Used by
// the hidden /payment-test page; real plan purchases go through
// /api/payments/cashfree/subscription.
export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    if (!cashfreeConfigured()) {
      return NextResponse.json(
        { error: 'Cashfree is not configured. Set CASHFREE_APP_ID and CASHFREE_SECRET_KEY.' },
        { status: 503 }
      );
    }

    const { amount, customerName, customerEmail, customerPhone, returnUrl } = await request.json();

    const orderAmount = Number(amount);
    if (!Number.isFinite(orderAmount) || orderAmount < 1) {
      return NextResponse.json({ error: 'Amount must be at least ₹1' }, { status: 400 });
    }
    const phone = String(customerPhone || '').replace(/\D/g, '').slice(-10);
    if (phone.length !== 10) {
      return NextResponse.json({ error: 'A 10-digit phone number is required' }, { status: 400 });
    }

    const order = await createCashfreeOrder({
      prefix: 'test',
      uid: auth.uid,
      amount: orderAmount,
      phone,
      customerName,
      customerEmail: customerEmail || auth.email,
      returnUrl: returnUrl ? String(returnUrl) : undefined,
      note: 'STAAD payment integration test',
    });

    return NextResponse.json(order);
  } catch (error: any) {
    console.error('Cashfree create order error:', error.details || error);
    return NextResponse.json(
      { error: error.message, details: error.details },
      { status: error.status && error.status < 500 ? 400 : 500 }
    );
  }
}
