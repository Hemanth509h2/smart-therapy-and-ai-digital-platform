import { Router } from 'express';
import type { Prisma } from '.prisma/app-client';
import { appDb, prisma } from '@/lib/core/db';
import { usersById } from '@/lib/core/links';
import { requireAdmin } from '@/lib/http/apiAuth';
import { listParams } from '@/lib/admin/adminList';
import { daysUntil, resolveCurrent, serializeSubscription, subscriptionState, FREE_TIER_ACCESS, addMonths, termAccess } from '@/lib/billing/subscriptions';
import { errorResponse, PublicError } from '@/lib/http/apiError';
import { audit } from '@/lib/admin/audit';
import { ALL_MODULE_IDS } from '@/lib/modules/modules';
import { activateFreePurchase, pricePurchase } from '@/lib/billing/purchase';
import { handle, send } from '@/lib/http/reply';
import { deliver, notify } from '@/lib/email/notify';
import { planRequestApprovedEmail, planRequestDeclinedEmail } from '@/lib/email/templates';
import { emailForUser } from '@/lib/email/recipients';

export const router = Router();

// ---- /api/admin/subscriptions --------------------------------------------------

// GET /api/admin/subscriptions — every professional with their current plan
// (months / period end / renewed) plus all pending plan requests to review.
// Filters: ?status=active|expiring7|expiring30|expired|none, ?planId= (current
// plan), ?q= (therapist name/email), ?sort=name|ends|joined. Paginated
// (?page=&pageSize=, adds `total`) only when `page` is passed; without it every
// professional is returned, as before.
router.get('/admin/subscriptions', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'billing.read');
    if (!auth.ok) return send(res, auth.response);

    const { sp, skip, take, sort, dir, q } = listParams(req, { sortable: ['name', 'ends', 'joined'], defaultSort: 'joined' });
    const status = sp.get('status') || '';
    const planId = sp.get('planId') || '';
    const paginate = sp.has('page');

    // Emails live in the HIPAA database: match them there, then filter by userId.
    const emailMatches = q
      ? await prisma.user.findMany({ where: { email: { contains: q, mode: 'insensitive' } }, select: { id: true } })
      : [];
    const where: Prisma.ProfileTherapistWhereInput = q
      ? {
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { userId: { in: emailMatches.map((u) => u.id) } },
          ],
        }
      : {};

    const [therapists, requests] = await Promise.all([
      appDb.profileTherapist.findMany({
        where,
        include: {
          subscriptions: { include: { plan: true }, orderBy: { startedAt: 'desc' } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      appDb.subscriptionRequest.findMany({
        where: { status: { in: ['PENDING', 'AWAITING_PAYMENT'] } },
        include: { plan: true, therapist: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const users = await usersById([...therapists, ...requests.map((r) => r.therapist)].map((t) => t.userId), { email: true });

    const now = new Date();
    let professionals = therapists.map((t) => {
      const current = resolveCurrent(t.subscriptions, now);
      // Most recent term of any status — what renew/reactivate act on when
      // there is no current one.
      const latest = t.subscriptions[0] ?? null;
      return {
        therapistId: t.id,
        name: `${t.firstName} ${t.lastName}`.trim(),
        email: users.get(t.userId)?.email ?? '',
        allModulesAllowed: t.allModulesAllowed,
        moduleAccessCount: t.moduleAccess.length,
        current: serializeSubscription(current),
        latest: current ? null : serializeSubscription(latest),
        state: subscriptionState(current, latest, now),
        daysLeft: current ? daysUntil(current.currentPeriodEnd, now) : null,
        termCount: t.subscriptions.length,
        joinedAt: t.createdAt,
      };
    });

    professionals = professionals.filter((p) => {
      if (planId && p.current?.planId !== planId) return false;
      switch (status) {
        case 'active': return !!p.current;
        case 'expiring7': return p.daysLeft != null && p.daysLeft <= 7;
        case 'expiring30': return p.daysLeft != null && p.daysLeft <= 30;
        case 'expired': return p.state === 'expired' || p.state === 'cancelled';
        case 'none': return p.state === 'none';
        default: return true;
      }
    });

    if (sort !== 'joined' || dir === 'desc') {
      const key = (p: (typeof professionals)[number]): number | string =>
        sort === 'name'
          ? p.name.toLowerCase()
          : sort === 'ends'
            ? new Date(p.current?.currentPeriodEnd ?? p.latest?.currentPeriodEnd ?? 0).getTime()
            : new Date(p.joinedAt).getTime();
      const sign = dir === 'asc' ? 1 : -1;
      professionals.sort((a, b) => (key(a) < key(b) ? -sign : key(a) > key(b) ? sign : 0));
    }

    const total = professionals.length;
    if (paginate) professionals = professionals.slice(skip, skip + take);

    const pending = requests.map((r) => ({
      id: r.id,
      therapistId: r.therapistId,
      therapistName: `${r.therapist.firstName} ${r.therapist.lastName}`.trim(),
      email: users.get(r.therapist.userId)?.email ?? '',
      planId: r.planId,
      planName: r.plan.name,
      toolQuota: r.plan.toolQuota,
      months: r.months,
      modules: r.modules,
      note: r.note,
      status: r.status,
      priceMonthly: r.plan.priceMonthly,
      couponCode: r.couponCode,
      subtotal: r.subtotal ?? r.plan.priceMonthly * r.months,
      discount: r.discount ?? 0,
      total: r.total ?? r.plan.priceMonthly * r.months,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt,
    }));

    return res.json({ professionals, total, requests: pending });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin subscriptions GET error'));
  }
}));

// ---- /api/admin/subscriptions/history/:therapistId -----------------------------

// How a closed request shows in the timeline. A paid request moves from
// AWAITING_PAYMENT to APPROVED, so its approval time is when it was approved.
const REVIEWED: Record<string, { kind: string; title: string }> = {
  AWAITING_PAYMENT: { kind: 'approved', title: 'Request approved — waiting for payment' },
  APPROVED: { kind: 'approved', title: 'Request approved' },
  REJECTED: { kind: 'rejected', title: 'Request rejected' },
  CANCELLED: { kind: 'withdrawn', title: 'Request withdrawn' },
};

// GET /api/admin/subscriptions/history/[therapistId] — every term and plan
// request for one professional, plus a merged newest-first `events` timeline.
router.get('/admin/subscriptions/history/:therapistId', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'billing.read');
    if (!auth.ok) return send(res, auth.response);

    const therapist = await appDb.profileTherapist.findUnique({
      where: { id: req.params.therapistId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        allModulesAllowed: true,
        moduleAccess: true,
        userId: true,
        subscriptions: { include: { plan: true }, orderBy: { startedAt: 'desc' } },
        subscriptionRequests: { include: { plan: { select: { name: true } } }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!therapist) return res.status(404).json({ error: "We couldn't find this professional. Their account may have been removed." });
    const user = await prisma.user.findUnique({ where: { id: therapist.userId }, select: { email: true } });

    const now = new Date();
    const current = resolveCurrent(therapist.subscriptions, now);
    const terms = therapist.subscriptions.map((s) => ({ ...serializeSubscription(s)!, current: s.id === current?.id }));
    const requests = therapist.subscriptionRequests.map((r) => ({
      id: r.id,
      planId: r.planId,
      planName: r.plan.name,
      months: r.months,
      modules: r.modules,
      status: r.status,
      note: r.note,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt,
    }));

    // One row per thing that happened, newest first.
    type Event = { at: Date; kind: string; title: string; detail?: string; refId: string };
    const events: Event[] = [];
    for (const r of therapist.subscriptionRequests) {
      const coupon = r.couponCode ? ` · coupon ${r.couponCode}` : '';
      events.push({ at: r.createdAt, kind: 'req', title: `Requested ${r.plan.name}`, detail: `${r.months} mo${coupon}${r.note ? ` · “${r.note}”` : ''}`, refId: r.id });
      if (r.reviewedAt && r.status !== 'PENDING') {
        const reviewed = REVIEWED[r.status];
        const price = r.total != null ? ` · ₹${r.total.toLocaleString('en-IN')}` : '';
        events.push({ at: r.reviewedAt, kind: reviewed.kind, title: reviewed.title, detail: `${r.plan.name}${price}`, refId: r.id });
      }
    }
    for (const s of therapist.subscriptions) {
      events.push({ at: s.startedAt, kind: 'term', title: `${s.plan.name} term started`, detail: `${s.months} mo · ${s.status.toLowerCase()}`, refId: s.id });
      if (s.renewedAt) {
        events.push({ at: s.renewedAt, kind: 'renewed', title: `${s.plan.name} renewed`, detail: `${s.renewalCount} renewal${s.renewalCount === 1 ? '' : 's'} total`, refId: s.id });
      }
      if (s.currentPeriodEnd.getTime() <= now.getTime() || s.status !== 'ACTIVE') {
        events.push({
          // Cancelled or superseded early: the row's last update is when it stopped.
          at: s.status !== 'ACTIVE' && s.updatedAt < s.currentPeriodEnd ? s.updatedAt : s.currentPeriodEnd,
          kind: s.status === 'CANCELLED' ? 'cancelled' : 'ended',
          title: `${s.plan.name} ${s.status === 'CANCELLED' ? 'cancelled' : 'ended'}`,
          refId: s.id,
        });
      }
    }
    events.sort((a, b) => b.at.getTime() - a.at.getTime());

    return res.json({
      therapist: {
        id: therapist.id,
        name: `${therapist.firstName} ${therapist.lastName}`.trim(),
        email: user?.email ?? '',
        allModulesAllowed: therapist.allModulesAllowed,
        moduleAccess: therapist.moduleAccess,
        state: subscriptionState(current, therapist.subscriptions[0] ?? null, now),
      },
      terms,
      requests,
      events,
    });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin subscription history GET error', "We couldn't load this professional's plan history. Please try again."));
  }
}));

// ---- /api/admin/subscriptions/requests/:id -------------------------------------

// POST /api/admin/subscriptions/requests/[id] — approve or reject a plan request.
// Body: { action: 'approve' | 'reject', modules?, months?, removeCoupon? }
// On approve the request is re-priced (term, plan price, coupon) and:
//  - total ₹0 (free plan, or a coupon covering it all): the plan starts now —
//    any prior ACTIVE term is expired, a new Subscription is created and the
//    therapist's module access is set from the (admin-confirmable) tool list;
//    unlimited plans grant all tools. No Cashfree.
//  - otherwise: the request becomes AWAITING_PAYMENT at that fixed price, and
//    the plan starts when the therapist pays (lib/billing/cashfree.ts).
// Reject also revokes an approval that hasn't been paid yet.
router.post('/admin/subscriptions/requests/:id', handle(async (request, res) => {
  try {
    const auth = await requireAdmin(request, 'billing.write');
    if (!auth.ok) return send(res, auth.response);
    const { action, modules, months, removeCoupon } = request.body;

    const req = await appDb.subscriptionRequest.findUnique({
      where: { id: request.params.id },
      include: { plan: true, therapist: { select: { userId: true, firstName: true } } },
    });
    if (!req) return res.status(404).json({ error: "We couldn't find this plan request. The professional may have withdrawn it." });
    const target = { type: 'SubscriptionRequest', id: req.id };
    const before = {
      status: req.status,
      planId: req.planId,
      planName: req.plan.name,
      months: req.months,
      modules: req.modules,
      couponCode: req.couponCode,
      total: req.total,
    };

    if (action === 'reject') {
      // Conditional, so a payment activating it at the same moment wins.
      const { count } = await appDb.subscriptionRequest.updateMany({
        where: { id: req.id, status: { in: ['PENDING', 'AWAITING_PAYMENT'] } },
        data: { status: 'REJECTED', reviewedAt: new Date() },
      });
      if (!count) return res.status(409).json({ error: 'This plan request is already closed. Refresh the page to see its current status.' });
      await audit(request, auth, 'subscription_request.reject', target, { before, after: { status: 'REJECTED' } });
      await deliver(notify('billing', await emailForUser(req.therapist.userId),
        planRequestDeclinedEmail({ firstName: req.therapist.firstName, planName: req.plan.name })));
      return res.json({ success: true });
    }
    if (req.status !== 'PENDING') {
      return res.status(409).json({ error: 'This plan request has already been reviewed. Refresh the page to see its current status.' });
    }

    if (action !== 'approve') {
      return res.status(400).json({ error: "We couldn't tell what to do. Refresh the page and try again." });
    }

    const plan = req.plan;
    const unlimited = plan.toolQuota == null;

    // Admin may tweak the granted tools at approval time; default to requested.
    const requested = Array.isArray(modules) && modules.length ? modules : req.modules;
    const cleaned = Array.from(
      new Set((requested as string[]).filter((m) => ALL_MODULE_IDS.includes(m)))
    );

    if (!unlimited) {
      if (cleaned.length === 0) {
        return res.status(400).json({ error: 'Select at least one tool to grant.' });
      }
      if (plan.toolQuota != null && cleaned.length > plan.toolQuota) {
        return res.status(400).json({ error: `This plan includes up to ${plan.toolQuota} tools. Select fewer tools.` });
      }
    }

    const months_ = Math.max(1, Math.min(36, Number(months) || req.months || 1));
    const grant = unlimited ? [] : cleaned;

    const price = await pricePurchase({
      plan,
      months: months_,
      therapistId: req.therapistId,
      couponCode: removeCoupon ? null : req.couponCode,
      excludeRequestId: req.id,
    });
    if (!price.ok) {
      return res.status(400).json({ error: req.couponCode ? `Coupon ${req.couponCode}: ${price.error} Approve without the coupon, or reject.` : price.error });
    }
    const { priced } = price;
    const pricing = {
      couponId: priced.coupon?.couponId ?? null,
      couponCode: priced.coupon?.couponCode ?? null,
      subtotal: priced.subtotal,
      discount: priced.discount,
      total: priced.total,
    };

    if (priced.total > 0) {
      const { count } = await appDb.subscriptionRequest.updateMany({
        where: { id: req.id, status: 'PENDING' },
        data: { status: 'AWAITING_PAYMENT', reviewedAt: new Date(), months: months_, modules: grant, ...pricing },
      });
      if (!count) return res.status(409).json({ error: 'This plan request has already been reviewed. Refresh the page to see its current status.' });
      await audit(request, auth, 'subscription_request.approve', target, {
        before,
        after: { status: 'AWAITING_PAYMENT', months: months_, modules: grant, unlimited, ...pricing },
      });
      await deliver(notify('billing', await emailForUser(req.therapist.userId), planRequestApprovedEmail({
        firstName: req.therapist.firstName, planName: plan.name, months: months_, total: Number(priced.total), awaitingPayment: true,
      })));
      return res.json({ success: true, status: 'AWAITING_PAYMENT', total: priced.total });
    }

    const created = await appDb.$transaction(async (tx) => {
      // Recorded for the audit log; activateFreePurchase supersedes them.
      const superseded = await tx.subscription.findMany({
        where: { therapistId: req.therapistId, status: 'ACTIVE' },
        select: { id: true },
      });
      // Claim the request, so two admins approving at once can't both activate it.
      const { count } = await tx.subscriptionRequest.updateMany({ where: { id: req.id, status: 'PENDING' }, data: pricing });
      if (!count) throw new PublicError('This plan request has already been reviewed. Refresh the page to see its current status.', 409);
      const { subscription: sub, grantedModules } = await activateFreePurchase(tx, {
        therapistId: req.therapistId,
        userId: req.therapist.userId,
        plan,
        months: months_,
        modules: grant,
        priced,
        requestId: req.id,
      });
      return { sub, grantedModules, superseded: superseded.map((s) => s.id) };
    });

    await audit(request, auth, 'subscription_request.approve', target, {
      before,
      after: {
        status: 'APPROVED',
        months: months_,
        modules: created.grantedModules,
        unlimited,
        ...pricing,
        subscriptionId: created.sub.id,
        currentPeriodEnd: created.sub.currentPeriodEnd,
        supersededSubscriptionIds: created.superseded,
      },
    });

    await deliver(notify('billing', await emailForUser(req.therapist.userId), planRequestApprovedEmail({
      firstName: req.therapist.firstName, planName: plan.name, months: months_, total: 0, awaitingPayment: false,
    })));

    return res.json({ success: true, status: 'APPROVED', total: 0 });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Subscription request review error'));
  }
}));

// ---- /api/admin/subscriptions/:id ----------------------------------------------

const snapshot = (s: { status: string; months: number; currentPeriodEnd: Date; renewalCount: number }) => ({
  status: s.status,
  months: s.months,
  currentPeriodEnd: s.currentPeriodEnd,
  renewalCount: s.renewalCount,
});

// PATCH /api/admin/subscriptions/[id] — manage an existing term.
// Body: { action: 'renew' | 'cancel' | 'reactivate', months? }
// renew: extends currentPeriodEnd by `months`, bumps renewalCount, marks renewed.
// Tool access follows: a term that becomes current again re-applies its tools;
// cancelling the therapist's last current term reverts them to the free tier.
router.patch('/admin/subscriptions/:id', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'billing.write');
    if (!auth.ok) return send(res, auth.response);
    const { action, months } = req.body;

    const sub = await appDb.subscription.findUnique({ where: { id: req.params.id }, include: { plan: true } });
    if (!sub) return res.status(404).json({ error: "We couldn't find this plan term. It may have been deleted." });
    const target = { type: 'Subscription', id: sub.id };

    if (action === 'cancel') {
      const updated = await appDb.$transaction(async (tx) => {
        const row = await tx.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED' } });
        const others = await tx.subscription.findMany({ where: { therapistId: sub.therapistId, status: 'ACTIVE' }, include: { plan: true } });
        if (!resolveCurrent(others)) {
          await tx.profileTherapist.update({ where: { id: sub.therapistId }, data: FREE_TIER_ACCESS });
        }
        return row;
      });
      await audit(req, auth, 'subscription.cancel', target, { before: snapshot(sub), after: snapshot(updated) });
      return res.json({ subscription: updated });
    }

    // Only one term may be current: don't revive an old one alongside it.
    if (action === 'renew' || action === 'reactivate') {
      const active = await appDb.subscription.findMany({ where: { therapistId: sub.therapistId, status: 'ACTIVE' }, include: { plan: true } });
      const current = resolveCurrent(active);
      if (current && current.id !== sub.id) {
        return res.status(409).json({ error: 'This professional already has a different current term.' });
      }
    }

    if (action === 'renew') {
      const addMo = Math.max(1, Math.min(36, Number(months) || sub.months || 1));
      const now = new Date();
      // Extend from the later of now / current end so renewals don't lose time.
      const base = sub.currentPeriodEnd.getTime() > now.getTime() ? sub.currentPeriodEnd : now;
      const updated = await appDb.$transaction(async (tx) => {
        const row = await tx.subscription.update({
          where: { id: sub.id },
          data: {
            status: 'ACTIVE',
            months: addMo,
            currentPeriodEnd: addMonths(base, addMo),
            renewedAt: now,
            renewalCount: { increment: 1 },
            cancelledAt: null, // renewing undoes a therapist's cancellation
          },
        });
        await tx.profileTherapist.update({ where: { id: sub.therapistId }, data: termAccess(sub.plan.toolQuota, sub.moduleAccess) });
        return row;
      });
      await audit(req, auth, 'subscription.renew', target, { before: snapshot(sub), after: { ...snapshot(updated), addedMonths: addMo } });
      return res.json({ subscription: updated });
    }

    if (action === 'reactivate') {
      if (sub.currentPeriodEnd.getTime() <= Date.now()) {
        return res.status(400).json({ error: 'This term has already ended — renew it instead.' });
      }
      const updated = await appDb.$transaction(async (tx) => {
        const row = await tx.subscription.update({ where: { id: sub.id }, data: { status: 'ACTIVE', cancelledAt: null } });
        await tx.profileTherapist.update({ where: { id: sub.therapistId }, data: termAccess(sub.plan.toolQuota, sub.moduleAccess) });
        return row;
      });
      await audit(req, auth, 'subscription.reactivate', target, { before: snapshot(sub), after: snapshot(updated) });
      return res.json({ subscription: updated });
    }

    return res.status(400).json({ error: "We couldn't tell what to do. Refresh the page and try again." });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Subscription PATCH error'));
  }
}));
