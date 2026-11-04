-- Terms/Privacy acceptance and marketing consent (app database, DATABASE_URL).
--
-- Apply with:  npx prisma db execute --schema prisma/app/schema.prisma --file scripts/maintenance/app-db-consent-records.sql
--
-- Do NOT use `prisma db push` on the app database (see app-db-plan-approval.sql).
-- Adds four nullable/defaulted columns to ProfileTherapist and the
-- ConsentRecord table. Existing therapists get termsVersion NULL, so they are
-- asked to accept the current Privacy Policy and Terms on their next visit,
-- and marketingOptIn false, so they get no marketing email until they opt in.
-- Safe to re-run.

ALTER TABLE "ProfileTherapist" ADD COLUMN IF NOT EXISTS "termsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "ProfileTherapist" ADD COLUMN IF NOT EXISTS "termsVersion" TEXT;
ALTER TABLE "ProfileTherapist" ADD COLUMN IF NOT EXISTS "marketingOptIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProfileTherapist" ADD COLUMN IF NOT EXISTS "marketingOptInAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ConsentRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" TEXT,
    "granted" BOOLEAN NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ConsentRecord_userId_createdAt_idx" ON "ConsentRecord"("userId", "createdAt");
