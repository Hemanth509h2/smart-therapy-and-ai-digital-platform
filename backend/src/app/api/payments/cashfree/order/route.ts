import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/apiAuth';
import { prisma } from '@/lib/db';
import { cashfreeConfigured, cashfreeEnv, cashfreeRequest } from '@/lib/cashfree';

export const dynamic = 'force-dynamic';

// POST /api/payments/cashfree/order — create a Cashfree order and return the
// payment_session_id for the browser checkout. Used by the hidden
// /payment-test page while the integration is being tested.
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

    // customer_id: 3-50 alphanumerics. order_id: 3-45 of [A-Za-z0-9_-].
    const customerId = `u${auth.uid.replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 50).padEnd(3, '0');
    const orderId = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const amountRounded = Math.round(orderAmount * 100) / 100;

    // Record the order before creating it at Cashfree, so a webhook can never
    // arrive for an order we have no row for. Removed again if Cashfree rejects it.
    await prisma.payment.create({
      data: {
        id: orderId,
        userId: auth.uid,
        amount: amountRounded,
        currency: 'INR',
        orderStatus: 'ACTIVE',
        environment: cashfreeEnv(),
      },
    });

    let order: any;
    try {
      order = await cashfreeRequest('/orders', {
        method: 'POST',
        body: JSON.stringify({
          order_id: orderId,
          order_amount: amountRounded,
          order_currency: 'INR',
          customer_details: {
            customer_id: customerId,
            customer_phone: phone,
            customer_name: customerName || undefined,
            customer_email: customerEmail || auth.email || undefined,
          },
          order_meta: {
            return_url: returnUrl ? `${String(returnUrl)}?order_id=${orderId}` : undefined,
            // Optional per-order webhook URL (must be https). Otherwise the
            // endpoint registered in the Cashfree dashboard is used.
            notify_url: process.env.CASHFREE_NOTIFY_URL || undefined,
          },
          order_note: 'STAAD payment integration test',
        }),
      });
    } catch (err) {
      await prisma.payment.delete({ where: { id: orderId } }).catch(() => {});
      throw err;
    }

    return NextResponse.json({
      orderId: order.order_id,
      paymentSessionId: order.payment_session_id,
      orderStatus: order.order_status,
      environment: cashfreeEnv(),
    });
  } catch (error: any) {
    console.error('Cashfree create order error:', error.details || error);
    return NextResponse.json(
      { error: error.message, details: error.details },
      { status: error.status && error.status < 500 ? 400 : 500 }
    );
  }
}
