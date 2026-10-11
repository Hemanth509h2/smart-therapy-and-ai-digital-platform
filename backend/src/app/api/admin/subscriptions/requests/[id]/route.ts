import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/apiAuth';
import { ALL_MODULE_IDS } from '@/lib/modules';
import { activatePlan } from '@/lib/subscriptions';

// POST /api/admin/subscriptions/requests/[id] — approve or reject a plan request.
// Body: { action: 'approve' | 'reject', modules?, months? }
// On approve: any prior ACTIVE term is expired, a new Subscription is created,
// and the therapist's module access is set from the (admin-confirmable) tool list
// — unlimited plans grant all tools.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    const { action, modules, months } = await request.json();

    const req = await prisma.subscriptionRequest.findUnique({
      where: { id: params.id },
      include: { plan: true },
    });
    if (!req) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    if (req.status !== 'PENDING') {
      return NextResponse.json({ error: 'Request already reviewed.' }, { status: 409 });
    }

    if (action === 'reject') {
      const updated = await prisma.subscriptionRequest.update({
        where: { id: req.id },
        data: { status: 'REJECTED', reviewedAt: new Date() },
      });
      return NextResponse.json({ success: true, request: updated });
    }

    if (action !== 'approve') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
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
        return NextResponse.json({ error: 'Select at least one tool to grant.' }, { status: 400 });
      }
      if (plan.toolQuota != null && cleaned.length > plan.toolQuota) {
        return NextResponse.json(
          { error: `This plan allows up to ${plan.toolQuota} tools.` },
          { status: 400 }
        );
      }
    }

    const months_ = Math.max(1, Math.min(36, Number(months) || req.months || 1));

    await prisma.$transaction(async (tx) => {
      const { grantedModules } = await activatePlan(tx, {
        therapistId: req.therapistId,
        plan,
        months: months_,
        modules: cleaned,
      });

      await tx.subscriptionRequest.update({
        where: { id: req.id },
        data: { status: 'APPROVED', reviewedAt: new Date(), modules: grantedModules },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Subscription request review error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
