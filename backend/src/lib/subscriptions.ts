// Shared subscription helpers used by the therapist, admin and payment routes.
import { NextResponse } from 'next/server';
import type { Prisma, Subscription, Plan } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ALL_MODULE_IDS } from '@/lib/modules';

// Add whole months to a date (term length math). June 15 + 1mo -> July 15.
export function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

export type SubscriptionWithPlan = Subscription & { plan: Plan };

// Keep only known tool ids and enforce the plan's tool quota
// (null = unlimited: every tool, so the selection is ignored).
export function cleanPlanModules(
  plan: Plan,
  modules: unknown
): { ok: true; modules: string[] } | { ok: false; error: string } {
  if (plan.toolQuota == null) return { ok: true, modules: [] };
  const cleaned = Array.isArray(modules)
    ? Array.from(new Set(modules.filter((m): m is string => ALL_MODULE_IDS.includes(m))))
    : [];
  if (cleaned.length === 0) return { ok: false, error: 'Please select at least one tool.' };
  if (cleaned.length > plan.toolQuota) {
    return { ok: false, error: `This plan allows up to ${plan.toolQuota} tools.` };
  }
  return { ok: true, modules: cleaned };
}

// Start a new term on `plan`: expire any active term, create the subscription
// and apply its tool access to the therapist (the in-session gate reads those).
// Run inside a transaction. Used by admin approval and by paid checkout.
export async function activatePlan(
  tx: Prisma.TransactionClient,
  opts: { therapistId: string; plan: Plan; months: number; modules: string[]; subscriptionId?: string }
) {
  const now = new Date();
  const unlimited = opts.plan.toolQuota == null;
  const grantedModules = unlimited ? [] : opts.modules;

  await tx.subscription.updateMany({
    where: { therapistId: opts.therapistId, status: 'ACTIVE' },
    data: { status: 'EXPIRED' },
  });

  const subscription = await tx.subscription.create({
    data: {
      ...(opts.subscriptionId ? { id: opts.subscriptionId } : {}),
      therapistId: opts.therapistId,
      planId: opts.plan.id,
      months: opts.months,
      startedAt: now,
      currentPeriodEnd: addMonths(now, opts.months),
      moduleAccess: grantedModules,
    },
  });

  await tx.profileTherapist.update({
    where: { id: opts.therapistId },
    data: { allModulesAllowed: unlimited, moduleAccess: grantedModules },
  });

  return { subscription, grantedModules };
}

// Pick the "current" subscription from a therapist's rows: the most recent
// ACTIVE term whose period has not ended. Absence ⇒ free tier.
export function resolveCurrent(
  subs: SubscriptionWithPlan[],
  now: Date = new Date()
): SubscriptionWithPlan | null {
  const active = subs
    .filter((s) => s.status === 'ACTIVE' && s.currentPeriodEnd.getTime() > now.getTime())
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  return active[0] ?? null;
}

// True when the therapist (ProfileTherapist.id) has a term that is ACTIVE and
// not past its end date — the same rule as resolveCurrent.
export async function hasActivePlan(therapistId: string): Promise<boolean> {
  const sub = await prisma.subscription.findFirst({
    where: { therapistId, status: 'ACTIVE', currentPeriodEnd: { gt: new Date() } },
    select: { id: true },
  });
  return !!sub;
}

// Without an active plan a therapist can look around but not act. Call this in
// any therapist write route; it returns a 402 to send back, or null to go on.
// Pass the ProfileTherapist id, or the Firebase uid when that's all you have
// (a uid with no therapist profile is not gated). The frontend's apiFetch
// recognises code PLAN_REQUIRED and points the therapist to /plans.
export async function requireActivePlan(
  who: { therapistId: string } | { userId: string }
): Promise<NextResponse | null> {
  let therapistId: string;
  if ('therapistId' in who) {
    therapistId = who.therapistId;
  } else {
    const t = await prisma.profileTherapist.findUnique({ where: { userId: who.userId }, select: { id: true } });
    if (!t) return null;
    therapistId = t.id;
  }
  if (await hasActivePlan(therapistId)) return null;
  return NextResponse.json(
    { error: 'You need an active plan to do this. Choose a plan to continue.', code: 'PLAN_REQUIRED' },
    { status: 402 }
  );
}

// Shape a subscription row for the client UI.
export function serializeSubscription(s: SubscriptionWithPlan | null) {
  if (!s) return null;
  return {
    id: s.id,
    planId: s.planId,
    planName: s.plan.name,
    priceMonthly: s.plan.priceMonthly,
    toolQuota: s.plan.toolQuota,
    status: s.status,
    months: s.months,
    startedAt: s.startedAt,
    currentPeriodEnd: s.currentPeriodEnd,
    renewedAt: s.renewedAt,
    renewalCount: s.renewalCount,
    renewed: s.renewalCount > 0,
    cancelledAt: s.cancelledAt,
    moduleAccess: s.moduleAccess,
  };
}

// Plan usage limits (null = unlimited). See docx/PLANS.md.
export const PLAN_LIMIT_FIELDS = ['maxClients', 'maxSessionsPerMonth', 'maxAiReportsPerMonth'] as const;
export type PlanLimitField = (typeof PLAN_LIMIT_FIELDS)[number];
const PLAN_LIMIT_LABELS: Record<PlanLimitField, string> = {
  maxClients: 'Client limit',
  maxSessionsPerMonth: 'Sessions per month',
  maxAiReportsPerMonth: 'AI reports per month',
};

// Reads the limit fields present in a request body. Blank/null = unlimited.
// Returns the values to save, or an error message.
export function parsePlanLimits(body: Record<string, unknown>): Partial<Record<PlanLimitField, number | null>> | string {
  const out: Partial<Record<PlanLimitField, number | null>> = {};
  for (const field of PLAN_LIMIT_FIELDS) {
    const raw = body[field];
    if (raw === undefined) continue;
    if (raw === null || raw === '') {
      out[field] = null;
      continue;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 100_000) {
      return `${PLAN_LIMIT_LABELS[field]} must be a whole number from 0 to 100000, or blank for unlimited.`;
    }
    out[field] = n;
  }
  return out;
}
