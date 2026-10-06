import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { ALL_MODULE_IDS } from '@/lib/modules';

// POST /api/subscriptions/request — a therapist requests a plan (pending admin
// approval). Body: { therapistId, planId, months?, modules?, note? }
// `modules` are the specific tools the therapist wants; capped by the plan's
// toolQuota (ignored for unlimited plans).
export async function POST(request: Request) {
  try {
    const { therapistId, planId, months, modules, note } = await request.json();

    if (!therapistId || !planId) {
      return NextResponse.json({ error: 'therapistId and planId are required' }, { status: 400 });
    }

    const [therapist, plan, existingPending] = await Promise.all([
      prisma.profileTherapist.findUnique({ where: { id: therapistId } }),
      prisma.plan.findUnique({ where: { id: planId } }),
      prisma.subscriptionRequest.findFirst({ where: { therapistId, status: 'PENDING' } }),
    ]);

    if (!therapist) return NextResponse.json({ error: 'Therapist not found' }, { status: 404 });
    if (!plan || !plan.isActive) {
      return NextResponse.json({ error: 'Plan not available' }, { status: 404 });
    }
    if (existingPending) {
      return NextResponse.json(
        { error: 'You already have a pending request awaiting admin approval.' },
        { status: 409 }
      );
    }

    // Keep only known module ids.
    const cleaned = Array.isArray(modules)
      ? Array.from(new Set(modules.filter((m: string) => ALL_MODULE_IDS.includes(m))))
      : [];

    // Enforce the plan's tool quota (null = unlimited, tool selection ignored).
    if (plan.toolQuota != null) {
      if (cleaned.length === 0) {
        return NextResponse.json({ error: 'Please select at least one tool.' }, { status: 400 });
      }
      if (cleaned.length > plan.toolQuota) {
        return NextResponse.json(
          { error: `This plan allows up to ${plan.toolQuota} tools.` },
          { status: 400 }
        );
      }
    }

    const months_ = Math.max(1, Math.min(36, Number(months) || plan.durationMonths || 1));

    const created = await prisma.subscriptionRequest.create({
      data: {
        therapistId,
        planId,
        months: months_,
        modules: plan.toolQuota == null ? [] : cleaned,
        note: note?.trim() || null,
      },
    });

    return NextResponse.json({ success: true, request: created });
  } catch (error: any) {
    console.error('Subscription request POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
