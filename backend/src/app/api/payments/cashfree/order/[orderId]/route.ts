import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/http/apiAuth';
import { prisma } from '@/lib/core/db';
import { cashfreeConfigured, syncCashfreeOrder } from '@/lib/billing/cashfree';

export const dynamic = 'force-dynamic';

// GET /api/payments/cashfree/order/:orderId — re-sync the order from Cashfree
// (the source of truth; never trust the browser's checkout result) and return
// it with its payment attempts. Only the user who created the order may read it.
export async function GET(request: Request, { params }: { params: { orderId: string } }) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;

    if (!cashfreeConfigured()) {
      return NextResponse.json({ error: 'Cashfree is not configured' }, { status: 503 });
    }

    const payment = await prisma.payment.findUnique({ where: { id: params.orderId } });
    if (!payment || payment.userId !== auth.uid) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const { order, payments } = await syncCashfreeOrder(params.orderId);
    const saved = await prisma.payment.findUnique({ where: { id: params.orderId } });

    return NextResponse.json({
      orderId: order.order_id,
      orderStatus: saved?.orderStatus ?? order.order_status,
      orderAmount: order.order_amount,
      orderCurrency: order.order_currency,
      // For plan purchases: true once the paid plan has been activated.
      planActivated: Boolean(saved?.subscriptionId),
      payments: payments.map((p: any) => ({
        cfPaymentId: p.cf_payment_id,
        status: p.payment_status,
        amount: p.payment_amount,
        method: p.payment_group,
        message: p.payment_message,
        time: p.payment_time,
      })),
    });
  } catch (error: any) {
    console.error('Cashfree get order error:', error.details || error);
    return NextResponse.json(
      { error: error.message, details: error.details },
      { status: error.status === 404 ? 404 : 500 }
    );
  }
}
