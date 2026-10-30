import { Router } from 'express';
import { appDb } from '@/lib/core/db';
import { requireAdmin, requireRecentLogin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { parseFeatures, parsePlanLimits } from '@/lib/billing/subscriptions';
import { errorResponse } from '@/lib/http/apiError';
import { handle, send } from '@/lib/http/reply';

export const router = Router();

// ---- /api/admin/plans ----------------------------------------------------------

// GET /api/admin/plans — list all plans (active + inactive) for catalog mgmt,
// each with subscriberCount (current active terms), requestCount (all plan
// requests ever) and pendingRequestCount.
router.get('/admin/plans', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'billing.read');
    if (!auth.ok) return send(res, auth.response);
    const now = new Date();
    const [plans, subs, reqs, pending] = await Promise.all([
      appDb.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { priceMonthly: 'asc' }] }),
      appDb.subscription.groupBy({
        by: ['planId'],
        where: { status: 'ACTIVE', currentPeriodEnd: { gt: now } },
        _count: { _all: true },
      }),
      appDb.subscriptionRequest.groupBy({ by: ['planId'], _count: { _all: true } }),
      appDb.subscriptionRequest.groupBy({ by: ['planId'], where: { status: 'PENDING' }, _count: { _all: true } }),
    ]);
    const count = (rows: { planId: string; _count: { _all: number } }[], id: string) =>
      rows.find((r) => r.planId === id)?._count._all ?? 0;

    return res.json({
      plans: plans.map((p) => ({
        ...p,
        subscriberCount: count(subs, p.id),
        requestCount: count(reqs, p.id),
        pendingRequestCount: count(pending, p.id),
      })),
    });
  } catch (error: any) {
    return send(res, errorResponse(error, 'Admin plans GET error'));
  }
}));

// POST /api/admin/plans — create a plan.
// Body: { name, description?, priceMonthly?, durationMonths?, toolQuota?, sortOrder?, features?,
//         maxClients?, maxSessionsPerMonth?, maxAiReportsPerMonth? }
// toolQuota / limits null or empty ⇒ unlimited. features: up to 10 card bullets.
router.post('/admin/plans', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'billing.write');
    if (!auth.ok) return send(res, auth.response);
    const body = req.body;
    const name = String(body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Enter a name for the plan.' });

    const features = parseFeatures(body.features);
    if (typeof features === 'string') return res.status(400).json({ error: features });

    const limits = parsePlanLimits(body);
    if (typeof limits === 'string') return res.status(400).json({ error: limits });

    const quotaRaw = body.toolQuota;
    const toolQuota =
      quotaRaw === null || quotaRaw === '' || quotaRaw === undefined
        ? null
        : Math.max(1, Number(quotaRaw));

    const plan = await appDb.plan.create({
      data: {
        name,
        description: body.description?.trim() || null,
        priceMonthly: Math.max(0, Number(body.priceMonthly) || 0),
        durationMonths: Math.max(1, Number(body.durationMonths) || 1),
        toolQuota,
        sortOrder: Number(body.sortOrder) || 0,
        isActive: body.isActive === undefined ? true : Boolean(body.isActive),
        features: features ?? [],
        ...limits,
      },
    });

    await audit(req, auth, 'plan.create', { type: 'Plan', id: plan.id }, { after: plan });
    return res.json({ plan });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'A plan with that name already exists.' });
    }
    return send(res, errorResponse(error, 'Admin plans POST error'));
  }
}));

// ---- /api/admin/plans/:id ------------------------------------------------------

// PATCH /api/admin/plans/[id] — update a plan (name, pricing, quota, features,
// usage limits, active flag). A body that only flips isActive is audited as archive/unarchive.
router.patch('/admin/plans/:id', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'billing.write');
    if (!auth.ok) return send(res, auth.response);
    const body = req.body;
    const data: any = {};

    if (body.name !== undefined) {
      data.name = String(body.name).trim();
      if (!data.name) return res.status(400).json({ error: 'Enter a name for the plan.' });
    }
    if (body.description !== undefined) data.description = body.description?.trim() || null;
    if (body.priceMonthly !== undefined) data.priceMonthly = Math.max(0, Number(body.priceMonthly) || 0);
    if (body.durationMonths !== undefined) data.durationMonths = Math.max(1, Number(body.durationMonths) || 1);
    if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder) || 0;
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    if (body.toolQuota !== undefined) {
      const q = body.toolQuota;
      data.toolQuota = q === null || q === '' ? null : Math.max(1, Number(q));
    }
    const features = parseFeatures(body.features);
    if (typeof features === 'string') return res.status(400).json({ error: features });
    if (features !== undefined) data.features = features;
    const limits = parsePlanLimits(body);
    if (typeof limits === 'string') return res.status(400).json({ error: limits });
    Object.assign(data, limits);

    const before = await appDb.plan.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: "We couldn't find this plan. It may have been deleted." });

    const plan = await appDb.plan.update({ where: { id: req.params.id }, data });

    const keys = Object.keys(data);
    const action =
      keys.length === 1 && keys[0] === 'isActive' ? (data.isActive ? 'plan.unarchive' : 'plan.archive') : 'plan.update';
    const pick = (p: Record<string, any>) => Object.fromEntries(keys.map((k) => [k, p[k]]));
    await audit(req, auth, action, { type: 'Plan', id: plan.id }, { before: pick(before), after: pick(plan) });

    return res.json({ plan });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'A plan with that name already exists.' });
    }
    if (error.code === 'P2025') {
      return res.status(404).json({ error: "We couldn't find this plan. It may have been deleted." });
    }
    return send(res, errorResponse(error, 'Admin plan PATCH error'));
  }
}));

// DELETE /api/admin/plans/[id] — remove a plan that was never used. Plans with
// any subscription or request are refused (409): archive them instead, so the
// history that references them stays intact.
router.delete('/admin/plans/:id', handle(async (req, res) => {
  try {
    const auth = await requireAdmin(req, 'billing.write');
    if (!auth.ok) return send(res, auth.response);
    const stepUp = requireRecentLogin(auth);
    if (stepUp) return send(res, stepUp);

    const plan = await appDb.plan.findUnique({ where: { id: req.params.id } });
    if (!plan) return res.status(404).json({ error: "We couldn't find this plan. It may have been deleted." });

    const [subs, reqs] = await Promise.all([
      appDb.subscription.count({ where: { planId: req.params.id } }),
      appDb.subscriptionRequest.count({ where: { planId: req.params.id } }),
    ]);
    if (subs > 0 || reqs > 0) {
      const parts = [subs && `${subs} subscription${subs === 1 ? '' : 's'}`, reqs && `${reqs} req${reqs === 1 ? '' : 's'}`].filter(Boolean);
      return res.status(409).json({
          error: `“${plan.name}” has ${parts.join(' and ')} on record, so it can't be deleted. Archive it instead — it will be hidden from therapists and the history stays intact.`,
          code: 'PLAN_IN_USE',
          subscriptionCount: subs,
          requestCount: reqs,
        });
    }

    await appDb.plan.delete({ where: { id: req.params.id } });
    await audit(req, auth, 'plan.delete', { type: 'Plan', id: plan.id }, { before: plan });
    return res.json({ success: true });
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: "We couldn't find this plan. It may have been deleted." });
    }
    return send(res, errorResponse(error, 'Admin plan DELETE error'));
  }
}));
