-- Per-therapist usage tracking switch (app database, DATABASE_URL).
--
-- Apply with:  npx prisma db execute --schema prisma/app/schema.prisma --file scripts/maintenance/app-db-track-usage.sql
--
-- Do NOT use `prisma db push` on the app database (see app-db-plan-approval.sql).
-- Only adds one column, on by default, so every existing therapist stays tracked.
-- Safe to re-run.

ALTER TABLE "ProfileTherapist" ADD COLUMN IF NOT EXISTS "trackUsage" BOOLEAN NOT NULL DEFAULT true;
