// Shared subscription helpers used by the therapist, admin and payment routes.
import type { Prisma, Subscription, Plan } from '@prisma/client';
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
