-- AuditLog table + query indexes (HIPAA database, DATABASE_URL_2).
--
-- Apply with:  npx prisma db execute --schema prisma/schema.prisma --file scripts/maintenance/hipaa-db-audit-log-and-indexes.sql
--
-- The HIPAA database was created with `db push` and has no _prisma_migrations
-- history, so `prisma migrate deploy` would re-run every migration and fail.
-- The 20261014000000_admin_portal migration's AuditLog table never reached it:
-- audit() in src/lib/admin/audit.ts swallowed the error, so nothing was
-- recorded and the admin Audit log page failed. This creates that table and
-- applies the 20261102000000_add_query_indexes changes. Leaves the legacy
-- "admins" table alone. Every statement is guarded, so it is safe to re-run.

CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUid" TEXT NOT NULL,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_actorUid_idx" ON "AuditLog"("actorUid");
CREATE INDEX IF NOT EXISTS "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");
CREATE INDEX IF NOT EXISTS "AuditLog_action_idx" ON "AuditLog"("action");
CREATE INDEX IF NOT EXISTS "Invite_therapistId_createdAt_idx" ON "Invite"("therapistId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProgressMetric_clientId_recordedAt_idx" ON "ProgressMetric"("clientId", "recordedAt");
CREATE INDEX IF NOT EXISTS "ProgressNote_clientId_createdAt_idx" ON "ProgressNote"("clientId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProgressNote_therapistId_idx" ON "ProgressNote"("therapistId");
CREATE INDEX IF NOT EXISTS "ProgressReport_clientId_createdAt_idx" ON "ProgressReport"("clientId", "createdAt");
CREATE INDEX IF NOT EXISTS "RiskFlag_therapistId_idx" ON "RiskFlag"("therapistId");
CREATE INDEX IF NOT EXISTS "Session_scheduledAt_idx" ON "Session"("scheduledAt");
CREATE INDEX IF NOT EXISTS "Session_status_scheduledAt_idx" ON "Session"("status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "Session_startedAt_idx" ON "Session"("startedAt");
CREATE INDEX IF NOT EXISTS "SessionReport_therapistId_generatedAt_idx" ON "SessionReport"("therapistId", "generatedAt");
CREATE INDEX IF NOT EXISTS "SessionReport_generatedAt_idx" ON "SessionReport"("generatedAt");
CREATE INDEX IF NOT EXISTS "SupportTicket_userId_idx" ON "SupportTicket"("userId");
CREATE INDEX IF NOT EXISTS "TherapistNote_sessionId_createdAt_idx" ON "TherapistNote"("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "TherapistNote_therapistId_createdAt_idx" ON "TherapistNote"("therapistId", "createdAt");
CREATE INDEX IF NOT EXISTS "User_role_createdAt_idx" ON "User"("role", "createdAt");
CREATE INDEX IF NOT EXISTS "User_lastSeenAt_idx" ON "User"("lastSeenAt");

DROP INDEX IF EXISTS "Invite_therapistId_idx";
DROP INDEX IF EXISTS "ProgressMetric_clientId_idx";
DROP INDEX IF EXISTS "ProgressNote_clientId_idx";
DROP INDEX IF EXISTS "ProgressReport_clientId_idx";
DROP INDEX IF EXISTS "SessionReport_therapistId_idx";
