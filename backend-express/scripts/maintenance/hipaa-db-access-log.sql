-- HIPAA database: security access log (DPDP Rules 2025, rule 6).
-- Apply from backend-express/:
--   npx prisma db execute --schema prisma/schema.prisma --file scripts/maintenance/hipaa-db-access-log.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS "AccessLog" (
  "id"         TEXT         NOT NULL,
  "uid"        TEXT         NOT NULL,
  "method"     TEXT         NOT NULL,
  "route"      TEXT         NOT NULL,
  "resourceId" TEXT,
  "status"     INTEGER      NOT NULL,
  "ip"         TEXT,
  "userAgent"  TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccessLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AccessLog_createdAt_idx" ON "AccessLog"("createdAt");
CREATE INDEX IF NOT EXISTS "AccessLog_uid_createdAt_idx" ON "AccessLog"("uid", "createdAt");
CREATE INDEX IF NOT EXISTS "AccessLog_resourceId_createdAt_idx" ON "AccessLog"("resourceId", "createdAt");
