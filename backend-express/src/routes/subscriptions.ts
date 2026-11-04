import { Router } from 'express';
import { prisma, appDb } from '@/lib/core/db';
import { requireAuth } from '@/lib/http/apiAuth';
import { resolveCurrent, serializeSubscription } from '@/lib/billing/subscriptions';
import { errorResponse, logError, notYourProfile } from '@/lib/http/apiError';
import { getSetting } from '@/lib/core/settings';
import { ALL_MODULE_IDS } from '@/lib/modules/modules';
import { pricePurchase } from '@/lib/billing/purchase';
import { handle, queryParams, send } from '@/lib/http/reply';
import { optStr, strList } from '@/lib/http/validate';
import { alertAdmins, deliver, notify } from '@/lib/email/notify';
import { planCancelledEmail, planRequestReceivedEmail } from '@/lib/email/templates';
import { planCancelledAlert, planRequestAlert } from '@/lib/email/alerts';

export const router = Router();

// ---- /api/subscriptions --------------------------------------------------------

// The caller must own the therapist profile or be an ADMIN.
async function mayAccessTherapist(uid: string, therapistId: string) {
  const [therapist, user] = await Promise.all([
    appDb.profileTherapist.findUnique({ where: { id: therapistId }, select: { userId: true } }),
    prisma.user.findUnique({ where: { id: uid }, select: { role: true } }),
  ]);
  return therapist?.userId === uid || user?.role === 'ADMIN';
}

// GET /api/subscriptions?therapistId= — a therapist's current plan (or null for
// free tier), any open request (waiting for an admin, or approved and waiting
// for payment, with its price), whether plans need approval before payment,
// and their term history.

router.get('/subscriptions', handle(async (req, res) => {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return send(res, auth.response);

    const searchParams = queryParams(req);
    const therapistId = searchParams.get('therapistId');
    if (!therapistId) {
      return res.status(400).json({ error: "Your therapist profile hasn't loaded yet. Refresh the page and try again." });
    }
    if (!(await mayAccessTherapist(auth.uid, therapistId))) {
      return send(res, notYourProfile("this therapist's plan"));
    }

    const [subs, pending, approvalRequired] = await Promise.all([
      appDb.subscription.findMany({
        where: { therapistId },
        include: { plan: true },
        orderBy: { startedAt: 'desc' },
      }),
      appDb.subscriptionRequest.findFirst({
        where: { therapistId, status: { in: ['PENDING', 'AWAITING_PAYMENT'] } },
        include: { plan: true },
        orderBy: { createdAt: 'desc' },
      }),
      getSetting('billing.approvalBeforePayment'),
    ]);

    const current = resolveCurrent(subs);

    return res.json({
      current: serializeSubscription(current),
      pendingRequest: pending
        ? {
            id: pending.id,
            planId: pending.planId,
            planName: pending.plan.name,
            months: pending.months,
            modules: pending.modules,
            status: pending.status,
            couponCode: pending.couponCode,
            subtotal: pending.subtotal ?? pending.plan.priceMonthly * pending.months,
            discount: pending.discount ?? 0,
            total: pending.total ?? pending.plan.priceMonthly * pending.months,
            createdAt: pending.createdAt,
            reviewedAt: pending.reviewedAt,
          }
        : null,
      approvalRequired,
      history: subs.map((s) => serializeSubscription({ ...s })),
    });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Subscriptions GET error'));
  }
}));

// ---- /api/subscriptions/cancel -------------------------------------------------

// POST /api/subscriptions/cancel — the signed-in therapist cancels (or undoes
// cancelling) their current plan. Body: { undo?: boolean }
//
// Cancelling does not end access: the term was paid for, so it stays ACTIVE
// until currentPeriodEnd and simply isn't renewed. No refund is issued.
// (An admin "cancel" in /api/admin/subscriptions/[id] still ends it at once.)
router.post('/subscriptions/cancel', handle(async (req, res) => {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return send(res, auth.response);

    const { undo } = req.body;

    const therapist = await appDb.profileTherapist.findUnique({ where: { userId: auth.uid } });
    if (!therapist) {
      return res.status(403).json({ error: 'Only therapists have plans.' });
    }

    const subs = await appDb.subscription.findMany({
      where: { therapistId: therapist.id },
      include: { plan: true },
    });
    const current = resolveCurrent(subs);
    if (!current) {
      return res.status(404).json({ error: 'You have no active plan to cancel.' });
    }

    const updated = await appDb.subscription.update({
      where: { id: current.id },
      data: { cancelledAt: undo ? null : current.cancelledAt ?? new Date() },
      include: { plan: true },
    });

    // Email only on a real change (cancelling twice, or undoing nothing, is silent).
    const changed = undo ? current.cancelledAt != null : current.cancelledAt == null;
    if (changed) {
      const undone = Boolean(undo);
      const name = `${therapist.firstName} ${therapist.lastName}`.trim();
      await deliver([
        notify('billing', auth.email, planCancelledEmail({ firstName: therapist.firstName, planName: updated.plan.name, endsAt: updated.currentPeriodEnd, undone })),
        alertAdmins('billing', planCancelledAlert({ therapistName: name, planName: updated.plan.name, endsAt: updated.currentPeriodEnd, undone })),
      ]);
    }

    return res.json({ current: serializeSubscription(updated) });
  } catch (error: any) {
    logError('Subscription cancel error', error);
    return res.status(500).json({ error: "We couldn't update your plan cancellation. Please try again." });
  }
}));

// ---- /api/subscriptions/request ------------------------------------------------

// POST /api/subscriptions/request — a therapist requests a plan (pending admin
// approval). Body: { therapistId, planId, months?, modules?, note?, couponCode? }
// `modules` are the specific tools the therapist wants; capped by the plan's
// toolQuota (ignored for unlimited plans). The price (with any coupon) is
// stored for the admin to see; approval re-prices it and fixes what is paid.
router.post('/subscriptions/request', handle(async (req, res) => {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return send(res, auth.response);

    const { therapistId, planId, months, modules, note, couponCode } = req.body;
    optStr(note, 'The note', 1_000);
    optStr(couponCode, 'The coupon code', 40);
    strList(modules, 'Modules', 100, 100);

    if (!therapistId || !planId) {
      return res.status(400).json({
          error: !planId
            ? 'Choose a plan first.'
            : "Your therapist profile hasn't loaded yet. Refresh the page and try again.",
        });
    }
    if (!(await mayAccessTherapist(auth.uid, therapistId))) {
      return send(res, notYourProfile('this therapist profile'));
    }

    const [therapist, plan, existingPending] = await Promise.all([
      appDb.profileTherapist.findUnique({ where: { id: therapistId } }),
      appDb.plan.findUnique({ where: { id: planId } }),
      appDb.subscriptionRequest.findFirst({ where: { therapistId, status: { in: ['PENDING', 'AWAITING_PAYMENT'] } } }),
    ]);

    if (!therapist) return res.status(404).json({ error: "We couldn't find your therapist profile. Refresh the page or sign in again." });
    if (!plan || !plan.isActive) {
      return res.status(404).json({ error: 'That plan is no longer available. Choose another plan on the Plans page.' });
    }
    if (existingPending) {
      return res.status(409).json({
          error:
            existingPending.status === 'AWAITING_PAYMENT'
              ? 'You have an approved plan waiting for payment. Pay for it or withdraw it first.'
              : 'You already have a pending req awaiting admin approval.',
        });
    }

    // Keep only known module ids.
    const cleaned = Array.isArray(modules)
      ? Array.from(new Set(modules.filter((m: string) => ALL_MODULE_IDS.includes(m))))
      : [];

    // Enforce the plan's tool quota (null = unlimited, tool selection ignored).
    if (plan.toolQuota != null) {
      if (cleaned.length === 0) {
        return res.status(400).json({ error: 'Select at least one tool for this plan.' });
      }
      if (cleaned.length > plan.toolQuota) {
        return res.status(400).json({ error: `This plan includes up to ${plan.toolQuota} tools. Remove some tools or choose a bigger plan.` });
      }
    }

    const months_ = Math.max(1, Math.min(36, Number(months) || plan.durationMonths || 1));

    const price = await pricePurchase({ plan, months: months_, therapistId, couponCode });
    if (!price.ok) return res.status(400).json({ error: price.error });
    const { priced } = price;

    const created = await appDb.subscriptionRequest.create({
      data: {
        therapistId,
        planId,
        months: months_,
        modules: plan.toolQuota == null ? [] : cleaned,
        note: note?.trim() || null,
        couponId: priced.coupon?.couponId ?? null,
        couponCode: priced.coupon?.couponCode ?? null,
        subtotal: priced.subtotal,
        discount: priced.discount,
        total: priced.total,
      },
    });

    const needsApproval = Boolean(await getSetting('billing.approvalBeforePayment').catch(() => true));
    const total = Number(priced.total);
    await deliver([
      notify('billing', auth.email, planRequestReceivedEmail({ firstName: therapist.firstName, planName: plan.name, months: months_, total, needsApproval })),
      alertAdmins('billing', planRequestAlert({
        therapistName: `${therapist.firstName} ${therapist.lastName}`.trim(),
        planName: plan.name, months: months_, total, needsApproval,
      })),
    ]);

    return res.json({ success: true, req: created });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Subscription req POST error'));
  }
}));

// ---- /api/subscriptions/request/:id --------------------------------------------

// DELETE /api/subscriptions/request/:id — the therapist withdraws their own
// request, while it waits for an admin or for payment. A Cashfree order
// already started for it still activates the plan if it gets paid.
router.delete('/subscriptions/request/:id', handle(async (request, res) => {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return send(res, auth.response);

    const therapist = await appDb.profileTherapist.findUnique({ where: { userId: auth.uid }, select: { id: true } });
    const req = await appDb.subscriptionRequest.findUnique({ where: { id: request.params.id }, select: { therapistId: true } });
    if (!therapist || !req || req.therapistId !== therapist.id) {
      return res.status(404).json({ error: "We couldn't find that plan request. It may already have been withdrawn." });
    }

    const { count } = await appDb.subscriptionRequest.updateMany({
      where: { id: request.params.id, status: { in: ['PENDING', 'AWAITING_PAYMENT'] } },
      data: { status: 'CANCELLED', reviewedAt: new Date() },
    });
    if (!count) return res.status(409).json({ error: 'This plan request has already been approved, rejected or withdrawn.' });
    return res.json({ success: true });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Subscription request withdraw error'));
  }
}));
