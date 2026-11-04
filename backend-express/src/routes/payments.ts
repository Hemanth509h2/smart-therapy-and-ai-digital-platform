import { Router } from 'express';
import { requireAdmin, requireAuth } from '@/lib/http/apiAuth';
import { logError } from '@/lib/http/apiError';
import { safeReturnUrl } from '@/lib/http/returnUrl';
import { optEmail, optStr } from '@/lib/http/validate';
import { cashfreeConfigured, createCashfreeOrder, syncCashfreeOrder, verifyCashfreeSignature } from '@/lib/billing/cashfree';
import { appDb } from '@/lib/core/db';
import type { Plan } from '.prisma/app-client';
import { cleanPlanModules } from '@/lib/billing/subscriptions';
import { activateFreePurchase, pricePurchase, type Priced } from '@/lib/billing/purchase';
import { getSetting } from '@/lib/core/settings';
import { handle, send } from '@/lib/http/reply';
import { rejectIfLimited } from '@/lib/http/rateLimit';

export const router = Router();

// ---- /api/payments/cashfree/order ----------------------------------------------

// POST /api/payments/cashfree/order — create a Cashfree order for an arbitrary
// amount and return the payment_session_id for the browser checkout. Used by
// the hidden /payment-test page; real plan purchases go through
// /api/payments/cashfree/subscription. The amount comes from the caller, so
// only admins who manage billing may use it.
router.post('/payments/cashfree/order', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'billing.write');
    if (!auth.ok) return send(res, auth.response);

    if (!cashfreeConfigured()) {
      return res.status(503).json({ error: 'Payments are not available right now. An admin needs to finish setting up payments.' });
    }

    const { amount, customerName, customerEmail, customerPhone, returnUrl } = req.body;

    const orderAmount = Number(amount);
    if (!Number.isFinite(orderAmount) || orderAmount < 1 || orderAmount > 100_000) {
      return res.status(400).json({ error: 'Enter an amount between ₹1 and ₹1,00,000.' });
    }
    const name = optStr(customerName, 'The customer name', 100);
    const email = optEmail(customerEmail, 'The customer email');
    const phone = String(customerPhone || '').replace(/\D/g, '').slice(-10);
    if (phone.length !== 10) {
      return res.status(400).json({ error: 'Enter a 10-digit phone number.' });
    }

    const order = await createCashfreeOrder({
      prefix: 'test',
      uid: auth.uid,
      amount: orderAmount,
      phone,
      customerName: name,
      customerEmail: email || auth.email,
      returnUrl: safeReturnUrl(returnUrl),
      note: 'STAAD payment integration test',
    });

    return res.json(order);
  } catch (error: any) {
    // Cashfree's error body can echo customer details: log a summary only.
    logError('Cashfree create order error', error);
    return res.status(error.status && error.status < 500 ? 400 : 500).json({
        error:
          error.status && error.status < 500
            ? 'The payment provider rejected this payment. Check the amount and phone number and try again.'
            : "We couldn't start the payment. Please try again in a few minutes.",
      });
  }
}));

// ---- /api/payments/cashfree/order/:orderId -------------------------------------

// GET /api/payments/cashfree/order/:orderId — re-sync the order from Cashfree
// (the source of truth; never trust the browser's checkout result) and return
// it with its payment attempts. Only the user who created the order may read it.
router.get('/payments/cashfree/order/:orderId', handle(async (req, res) => {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return send(res, auth.response);

    if (!cashfreeConfigured()) {
      return res.status(503).json({ error: 'Payments are not available right now. An admin needs to finish setting up payments.' });
    }

    const payment = await appDb.payment.findUnique({ where: { id: req.params.orderId } });
    if (!payment || payment.userId !== auth.uid) {
      return res.status(404).json({ error: "We couldn't find that payment. If money was taken, contact support with your order ID." });
    }

    const { order, payments } = await syncCashfreeOrder(req.params.orderId);
    const saved = await appDb.payment.findUnique({ where: { id: req.params.orderId } });

    return res.json({
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
    // Cashfree's error body can echo customer details: log a summary only.
    logError('Cashfree get order error', error);
    return res.status(error.status === 404 ? 404 : 500).json({
        error:
          error.status === 404
            ? "We couldn't find that payment. If money was taken, contact support with your order ID."
            : "We couldn't check this payment's status. Refresh the page in a minute.",
      });
  }
}));

// ---- /api/payments/cashfree/subscription ---------------------------------------

// POST /api/payments/cashfree/subscription — start checkout for a plan.
//   Pay for an approved request: { requestId, customerPhone, returnUrl? }
//   Buy directly (only while 'billing.approvalBeforePayment' is off):
//     { planId, months, modules?, customerPhone, returnUrl?, couponCode? }
//
// The therapist comes from the verified token and the amount from the
// approved request or the plan (priceMonthly × months, less any coupon),
// never from the request body. A ₹0 total starts the plan at once without
// Cashfree and answers { activated: true }. Otherwise nothing is activated
// here: the plan starts only once Cashfree reports the order PAID (webhook or
// the order status route), in syncCashfreeOrder.
router.post('/payments/cashfree/subscription', handle(async (request, res) => {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return send(res, auth.response);
    if (await rejectIfLimited(res, { name: 'payment-create', limit: 10, windowMs: 60 * 60 * 1000 }, auth.uid,
      'You have started several payments in the last hour. Please wait a little and try again.')) return;

    const { requestId, planId, months, modules, customerPhone, returnUrl, couponCode } = request.body;

    const therapist = await appDb.profileTherapist.findUnique({ where: { userId: auth.uid } });
    if (!therapist) {
      return res.status(403).json({ error: 'Only therapists can buy a plan.' });
    }

    let purchase: { plan: Plan; months: number; modules: string[]; priced: Priced; requestId?: string };

    if (requestId) {
      const req = await appDb.subscriptionRequest.findUnique({ where: { id: String(requestId) }, include: { plan: true } });
      if (!req || req.therapistId !== therapist.id) {
        return res.status(404).json({ error: "We couldn't find that plan request. It may have been withdrawn." });
      }
      if (req.status !== 'AWAITING_PAYMENT' || req.total == null) {
        return res.status(409).json({ error: req.status === 'PENDING' ? "An admin hasn't approved this plan request yet. You can pay once it's approved." : 'This plan request is no longer waiting for payment. Check its status on the Plans page.' });
      }
      const alreadyPaid = await appDb.payment.count({ where: { requestId: req.id, orderStatus: 'PAID' } });
      if (alreadyPaid) return res.status(409).json({ error: 'This plan request has already been paid. Refresh the page to see your plan.' });
      purchase = {
        plan: req.plan,
        months: req.months,
        modules: req.modules,
        requestId: req.id,
        // The price the admin approved.
        priced: {
          subtotal: req.subtotal ?? req.total,
          discount: req.discount ?? 0,
          total: req.total,
          coupon: req.couponId && req.couponCode ? { couponId: req.couponId, couponCode: req.couponCode } : null,
        },
      };
    } else {
      if (await getSetting('billing.approvalBeforePayment')) {
        return res.status(403).json({ error: 'Plans need an admin’s approval first. Send a request; you can pay once it is approved.' });
      }
      // A pending admin request doesn't block paying; activation closes it.
      const plan = planId ? await appDb.plan.findUnique({ where: { id: String(planId) } }) : null;
      if (!plan || !plan.isActive) {
        return res.status(404).json({ error: 'That plan is no longer available. Choose another plan on the Plans page.' });
      }
      if (plan.priceMonthly <= 0) {
        return res.status(400).json({ error: "This plan is free, so there's nothing to pay. Send a request for it instead." });
      }
      const tools = cleanPlanModules(plan, modules);
      if (!tools.ok) return res.status(400).json({ error: tools.error });
      const months_ = Math.max(1, Math.min(36, Number(months) || plan.durationMonths || 1));
      const price = await pricePurchase({ plan, months: months_, therapistId: therapist.id, couponCode });
      if (!price.ok) return res.status(400).json({ error: price.error });
      purchase = { plan, months: months_, modules: tools.modules, priced: price.priced };
    }

    const { plan, months: months_, priced } = purchase;

    // Nothing to pay: start the plan without Cashfree.
    if (priced.total <= 0) {
      await appDb.$transaction((tx) =>
        activateFreePurchase(tx, {
          therapistId: therapist.id,
          userId: auth.uid,
          plan,
          months: months_,
          modules: purchase.modules,
          priced,
          requestId: purchase.requestId,
        })
      );
      return res.json({ activated: true });
    }

    if (!cashfreeConfigured()) {
      return res.status(503).json({ error: 'Payments are not available right now. Please try again later or contact support.' });
    }
    const phone = String(customerPhone || '').replace(/\D/g, '').slice(-10);
    if (phone.length !== 10) {
      return res.status(400).json({ error: 'Please enter a 10-digit phone number.' });
    }

    const order = await createCashfreeOrder({
      prefix: 'sub',
      uid: auth.uid,
      amount: priced.total,
      phone,
      customerName: `${therapist.firstName} ${therapist.lastName}`.trim(),
      customerEmail: auth.email,
      returnUrl: safeReturnUrl(returnUrl),
      note: `${plan.name} plan, ${months_} month${months_ === 1 ? '' : 's'}${priced.coupon ? `, coupon ${priced.coupon.couponCode}` : ''}`,
      plan: { planId: plan.id, therapistId: therapist.id, months: months_, modules: purchase.modules, requestId: purchase.requestId },
      coupon: priced.coupon ? { ...priced.coupon, discount: priced.discount } : undefined,
    });

    return res.json(order);
  } catch (error: any) {
    // Cashfree's error body can echo customer details: log a summary only.
    logError('Cashfree subscription checkout error', error);
    return res.status(error.status && error.status < 500 ? 400 : 500).json({
        error:
          error.status && error.status < 500
            ? 'The payment provider rejected this payment. Check your phone number and try again.'
            : "We couldn't start the payment. Please try again in a few minutes.",
      });
  }
}));

// ---- /api/payments/cashfree/webhook --------------------------------------------

// POST /api/payments/cashfree/webhook — Cashfree payment webhooks
// (PAYMENT_SUCCESS_WEBHOOK, PAYMENT_FAILED_WEBHOOK, PAYMENT_USER_DROPPED_WEBHOOK).
// Register this URL in Cashfree Dashboard > Developers > Webhooks, or set
// CASHFREE_NOTIFY_URL so it is sent per order as order_meta.notify_url.
//
// Delivery is at-least-once with retries until we answer 200, so handling is
// idempotent: we verify the signature, then re-sync the order from Cashfree
// rather than trusting the payload's status.
router.post('/payments/cashfree/webhook', handle(async (req, res) => {
  if (!cashfreeConfigured()) {
    return res.status(503).json({ error: 'Cashfree is not configured' });
  }

  // app.ts parses this route's body as text (the exact bytes Cashfree signed).
  const rawBody = typeof req.body === 'string' ? req.body : '';
  const valid = verifyCashfreeSignature(
    rawBody,
    req.get('x-webhook-timestamp') ?? null,
    req.get('x-webhook-signature') ?? null
  );
  if (!valid) {
    console.warn('[cashfree] webhook rejected: bad signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const orderId = event?.data?.order?.order_id;
  console.log(
    `[cashfree] webhook ${event?.type} order=${orderId} payment=${event?.data?.payment?.payment_status}` +
      ` idempotency=${req.get('x-idempotency-key') ?? '-'}`
  );

  // Charges webhooks etc. carry nothing we store; acknowledge so they stop retrying.
  if (!orderId || event?.type === 'PAYMENT_CHARGES_WEBHOOK') {
    return res.json({ ok: true });
  }

  try {
    const { existing } = await syncCashfreeOrder(String(orderId), { fromWebhook: true });
    if (!existing) console.warn(`[cashfree] webhook for unknown order ${orderId}`);
    return res.json({ ok: true });
  } catch (error: any) {
    // Non-200 makes Cashfree retry later, which is what we want for a
    // transient DB/network failure.
    // Cashfree's error body can echo customer details: log a summary only.
    logError('[cashfree] webhook processing failed', error);
    return res.status(500).json({ error: 'Processing failed' });
  }
}));
