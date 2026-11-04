-- App database: shared rate-limit counters (lib/http/rateLimit.ts).
-- Apply from backend-express/:
--   npx prisma db execute --schema prisma/app/schema.prisma --file scripts/maintenance/app-db-rate-limits.sql
-- Safe to re-run. Until this runs, rate limits still work, per server instance.

CREATE TABLE IF NOT EXISTS "RateLimitBucket" (
  "name"        TEXT         NOT NULL,
  "key"         TEXT         NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "count"       INTEGER      NOT NULL DEFAULT 0,
  CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("name", "key", "windowStart")
);

CREATE INDEX IF NOT EXISTS "RateLimitBucket_windowStart_idx" ON "RateLimitBucket"("windowStart");
