-- Query indexes (app database, DATABASE_URL).
--
-- Apply with:  npx prisma db execute --schema prisma/app/schema.prisma --file scripts/maintenance/app-db-query-indexes.sql
--
-- Do NOT use `prisma db push` on the app database (see app-db-plan-approval.sql).
-- Matches the @@index changes in prisma/app/schema.prisma. Covers the cron
-- expiry/renewal scans and current-plan lookups on Subscription, the per-
-- therapist pending-request check, paid-in-period revenue on Payment, and the
-- date-ranged usage dashboards on UsageEvent. Each dropped index is a leading
-- prefix of a new composite one, so nothing loses coverage. Creates run before
-- drops, and every statement is guarded, so it is safe to re-run.

-- Subscription: (therapistId, status, currentPeriodEnd) replaces (therapistId);
-- (status, currentPeriodEnd) replaces (status); planId backs the plan FK.
CREATE INDEX IF NOT EXISTS "Subscription_therapistId_status_currentPeriodEnd_idx" ON "Subscription"("therapistId", "status", "currentPeriodEnd");
CREATE INDEX IF NOT EXISTS "Subscription_status_currentPeriodEnd_idx" ON "Subscription"("status", "currentPeriodEnd");
CREATE INDEX IF NOT EXISTS "Subscription_planId_idx" ON "Subscription"("planId");
DROP INDEX IF EXISTS "Subscription_therapistId_idx";
DROP INDEX IF EXISTS "Subscription_status_idx";

-- SubscriptionRequest: (therapistId, status) replaces (therapistId); planId backs the plan FK.
CREATE INDEX IF NOT EXISTS "SubscriptionRequest_therapistId_status_idx" ON "SubscriptionRequest"("therapistId", "status");
CREATE INDEX IF NOT EXISTS "SubscriptionRequest_planId_idx" ON "SubscriptionRequest"("planId");
DROP INDEX IF EXISTS "SubscriptionRequest_therapistId_idx";

-- Payment: (orderStatus, paidAt) replaces (orderStatus).
CREATE INDEX IF NOT EXISTS "Payment_orderStatus_paidAt_idx" ON "Payment"("orderStatus", "paidAt");
DROP INDEX IF EXISTS "Payment_orderStatus_idx";

-- UsageEvent: (therapistId, createdAt) and (type, createdAt) replace the
-- single-column ones; (createdAt) serves the all-therapist date-range charts.
CREATE INDEX IF NOT EXISTS "UsageEvent_therapistId_createdAt_idx" ON "UsageEvent"("therapistId", "createdAt");
CREATE INDEX IF NOT EXISTS "UsageEvent_type_createdAt_idx" ON "UsageEvent"("type", "createdAt");
CREATE INDEX IF NOT EXISTS "UsageEvent_createdAt_idx" ON "UsageEvent"("createdAt");
DROP INDEX IF EXISTS "UsageEvent_therapistId_idx";
DROP INDEX IF EXISTS "UsageEvent_type_idx";
