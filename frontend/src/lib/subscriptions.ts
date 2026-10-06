// Shared subscription helpers used by the therapist + admin subscription routes.
import type { Subscription, Plan } from '@prisma/client';

// Add whole months to a date (term length math). June 15 + 1mo -> July 15.
export function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

export type SubscriptionWithPlan = Subscription & { plan: Plan };

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
    moduleAccess: s.moduleAccess,
  };
}
