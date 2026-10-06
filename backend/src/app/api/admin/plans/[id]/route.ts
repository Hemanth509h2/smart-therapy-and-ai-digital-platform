import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// PATCH /api/admin/plans/[id] — update a plan (name, pricing, quota, active flag).
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const data: any = {};

    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.description !== undefined) data.description = body.description?.trim() || null;
    if (body.priceMonthly !== undefined) data.priceMonthly = Math.max(0, Number(body.priceMonthly) || 0);
    if (body.durationMonths !== undefined) data.durationMonths = Math.max(1, Number(body.durationMonths) || 1);
    if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder) || 0;
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    if (body.toolQuota !== undefined) {
      const q = body.toolQuota;
      data.toolQuota = q === null || q === '' ? null : Math.max(1, Number(q));
    }

    const plan = await prisma.plan.update({ where: { id: params.id }, data });
    return NextResponse.json({ plan });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'A plan with that name already exists.' }, { status: 409 });
    }
    if (error.code === 'P2025') {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }
    console.error('Admin plan PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/admin/plans/[id] — remove a plan if unused, else soft-disable it so
// existing subscriptions/requests that reference it remain valid.
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const [subs, reqs] = await Promise.all([
      prisma.subscription.count({ where: { planId: params.id } }),
      prisma.subscriptionRequest.count({ where: { planId: params.id } }),
    ]);

    if (subs > 0 || reqs > 0) {
      const plan = await prisma.plan.update({
        where: { id: params.id },
        data: { isActive: false },
      });
      return NextResponse.json({ plan, softDeleted: true });
    }

    await prisma.plan.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.code === 'P2025') {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }
    console.error('Admin plan DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
