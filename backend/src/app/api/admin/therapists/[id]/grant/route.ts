import { NextResponse } from 'next/server';
import { appDb } from '@/lib/core/db';
import { requireAdmin } from '@/lib/http/apiAuth';
import { audit } from '@/lib/admin/audit';
import { ALL_MODULE_IDS } from '@/lib/modules/modules';
import { addMonths } from '@/lib/billing/subscriptions';
import { errorResponse } from '@/lib/http/apiError';

export const dynamic = 'force-dynamic';

// POST /api/admin/therapists/[id]/grant — give a therapist a plan without a
// request or payment (comps, sales deals, support credits).
// Body: { planId, months (1-36), modules? }
// Same effect as approving a request: active terms are expired, a new
// Subscription is created and the plan's tool access is applied to the
// therapist (unlimited plans grant all tools; quota plans need 1..quota tools).
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdmin(request, 'billing.write');
    if (!auth.ok) return auth.response;
    const { planId, months, modules } = await request.json();

    const therapist = await appDb.profileTherapist.findUnique({
      where: { id: params.id },
      select: { id: true, allModulesAllowed: true, moduleAccess: true },
    });
    if (!therapist) return NextResponse.json({ error: "We couldn't find this professional. Their account may have been removed." }, { status: 404 });

    const plan = planId ? await appDb.plan.findUnique({ where: { id: String(planId) } }) : null;
    if (!plan) return NextResponse.json({ error: "We couldn't find this plan. It may have been deleted." }, { status: 404 });

    const months_ = Number(months);
    if (!Number.isInteger(months_) || months_ < 1 || months_ > 36) {
      return NextResponse.json({ error: 'Enter a number of months from 1 to 36.' }, { status: 400 });
    }

    const unlimited = plan.toolQuota == null;
    const cleaned = Array.from(
      new Set((Array.isArray(modules) ? modules : []).filter((m: unknown): m is string => typeof m === 'string' && ALL_MODULE_IDS.includes(m)))
    );
    if (!unlimited) {
      if (cleaned.length === 0) {
        return NextResponse.json({ error: 'Select at least one tool to grant.' }, { status: 400 });
      }
      if (cleaned.length > plan.toolQuota!) {
        return NextResponse.json({ error: `This plan includes up to ${plan.toolQuota} tools. Select fewer tools.` }, { status: 400 });
      }
    }

    const now = new Date();
    const grantedModules = unlimited ? [] : cleaned;

    const subscription = await appDb.$transaction(async (tx) => {
      // Supersede any existing active terms.
      await tx.subscription.updateMany({
        where: { therapistId: therapist.id, status: 'ACTIVE' },
        data: { status: 'EXPIRED' },
      });

      const created = await tx.subscription.create({
        data: {
          therapistId: therapist.id,
          planId: plan.id,
          months: months_,
          startedAt: now,
          currentPeriodEnd: addMonths(now, months_),
          moduleAccess: grantedModules,
        },
      });

      // Apply tool access to the therapist (the in-session gate reads these).
      await tx.profileTherapist.update({
        where: { id: therapist.id },
        data: { allModulesAllowed: unlimited, moduleAccess: grantedModules },
      });

      return created;
    });

    await audit(request, auth, 'subscription.grant', { type: 'ProfileTherapist', id: therapist.id }, {
      before: { allModulesAllowed: therapist.allModulesAllowed, moduleAccess: therapist.moduleAccess },
      after: { subscriptionId: subscription.id, planId: plan.id, planName: plan.name, months: months_, moduleAccess: grantedModules },
    });

    return NextResponse.json({ success: true, subscription });
  } catch (error: any) {
    return errorResponse(error, 'Admin grant plan error', "We couldn't grant this plan. Please try again.");
  }
}
