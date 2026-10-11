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

// ─── Expiry + access helpers (admin subscriptions page, daily cron) ─────────

// Tool access with no current term: the ProfileTherapist column defaults
// (every tool allowed, no explicit list).
export const FREE_TIER_ACCESS = { allModulesAllowed: true, moduleAccess: [] as string[] };

// Tool access granted by a term: unlimited plans allow everything.
export function termAccess(toolQuota: number | null, moduleAccess: string[]) {
  return toolQuota == null
    ? { allModulesAllowed: true, moduleAccess: [] as string[] }
    : { allModulesAllowed: false, moduleAccess };
}

// Calendar-day maths in India time (users are in IST; servers run in UTC).
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 864e5;
const istDay = (d: Date) => Math.floor((d.getTime() + IST_OFFSET_MS) / DAY_MS);

// Whole calendar days from `now` until `end` (0 = ends today, negative = past).
export function daysUntil(end: Date, now: Date = new Date()): number {
  return istDay(end) - istDay(now);
}

export const EXPIRING_SOON_DAYS = 7;

export type SubscriptionState = 'active' | 'expiring' | 'expired' | 'cancelled' | 'none';

// Admin-facing status for a therapist from their current + most recent term.
export function subscriptionState(
  current: { currentPeriodEnd: Date } | null,
  latest: { status: string } | null,
  now: Date = new Date()
): SubscriptionState {
  if (current) return daysUntil(current.currentPeriodEnd, now) <= EXPIRING_SOON_DAYS ? 'expiring' : 'active';
  if (!latest) return 'none';
  return latest.status === 'CANCELLED' ? 'cancelled' : 'expired';
}

// Validate the admin-written plan card bullets. undefined = not sent;
// a string = the error to show; else the cleaned list (empties dropped).
export const MAX_PLAN_FEATURES = 10;
export const MAX_PLAN_FEATURE_LENGTH = 120;
export function parseFeatures(raw: unknown): string[] | string | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return [];
  if (!Array.isArray(raw)) return 'features must be a list of text lines.';
  const list = raw.map((f) => String(f ?? '').trim()).filter(Boolean);
  if (list.length > MAX_PLAN_FEATURES) return `A plan can list at most ${MAX_PLAN_FEATURES} features.`;
  if (list.some((f) => f.length > MAX_PLAN_FEATURE_LENGTH)) {
    return `Each feature must be ${MAX_PLAN_FEATURE_LENGTH} characters or fewer.`;
  }
  return list;
}
