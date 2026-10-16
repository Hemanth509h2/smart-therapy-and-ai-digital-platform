import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/db';
import { requireAdmin, requireRecentLogin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { parseFeatures, parsePlanLimits } from '@/lib/billing/subscriptions';
import { errorResponse } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

// PATCH /api/admin/plans/[id] — update a plan (name, pricing, quota, features,
// usage limits, active flag). A body that only flips isActive is audited as archive/unarchive.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin(request, 'billing.write');
    if (!auth.ok) return auth.response;
    const body = await request.json();
    const data: any = {};

    if (body.name !== undefined) {
      data.name = String(body.name).trim();
      if (!data.name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
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
    if (typeof features === 'string') return NextResponse.json({ error: features }, { status: 400 });
    if (features !== undefined) data.features = features;
    const limits = parsePlanLimits(body);
    if (typeof limits === 'string') return NextResponse.json({ error: limits }, { status: 400 });
    Object.assign(data, limits);

    const before = await prisma.plan.findUnique({ where: { id: params.id } });
    if (!before) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

    const plan = await prisma.plan.update({ where: { id: params.id }, data });

    const keys = Object.keys(data);
    const action =
      keys.length === 1 && keys[0] === 'isActive' ? (data.isActive ? 'plan.unarchive' : 'plan.archive') : 'plan.update';
    const pick = (p: Record<string, any>) => Object.fromEntries(keys.map((k) => [k, p[k]]));
    await audit(request, auth, action, { type: 'Plan', id: plan.id }, { before: pick(before), after: pick(plan) });

    return NextResponse.json({ plan });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'A plan with that name already exists.' }, { status: 409 });
    }
    if (error.code === 'P2025') {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }
    return errorResponse(error, 'Admin plan PATCH error');
  }
}

// DELETE /api/admin/plans/[id] — remove a plan that was never used. Plans with
// any subscription or request are refused (409): archive them instead, so the
// history that references them stays intact.
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin(request, 'billing.write');
    if (!auth.ok) return auth.response;
    const stepUp = requireRecentLogin(auth);
    if (stepUp) return stepUp;

    const plan = await prisma.plan.findUnique({ where: { id: params.id } });
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

    const [subs, reqs] = await Promise.all([
      prisma.subscription.count({ where: { planId: params.id } }),
      prisma.subscriptionRequest.count({ where: { planId: params.id } }),
    ]);
    if (subs > 0 || reqs > 0) {
      const parts = [subs && `${subs} subscription${subs === 1 ? '' : 's'}`, reqs && `${reqs} request${reqs === 1 ? '' : 's'}`].filter(Boolean);
      return NextResponse.json(
        {
          error: `“${plan.name}” has ${parts.join(' and ')} on record, so it can't be deleted. Archive it instead — it will be hidden from therapists and the history stays intact.`,
          code: 'PLAN_IN_USE',
          subscriptionCount: subs,
          requestCount: reqs,
        },
        { status: 409 }
      );
    }

    await prisma.plan.delete({ where: { id: params.id } });
    await audit(request, auth, 'plan.delete', { type: 'Plan', id: plan.id }, { before: plan });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.code === 'P2025') {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }
    return errorResponse(error, 'Admin plan DELETE error');
  }
}
