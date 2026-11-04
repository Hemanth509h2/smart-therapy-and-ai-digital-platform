-- Client consent confirmation and guardian details (HIPAA database, DATABASE_URL_2).
--
-- Apply with:  npx prisma db execute --schema prisma/schema.prisma --file scripts/maintenance/hipaa-db-client-consent.sql
-- (or `npx prisma db push`, which is allowed on the HIPAA database).
--
-- Adds three nullable columns to ProfileClient. Existing clients keep NULL:
-- they were added before the therapist was asked to confirm consent.
-- Safe to re-run.

ALTER TABLE "ProfileClient" ADD COLUMN IF NOT EXISTS "consentConfirmedAt" TIMESTAMP(3);
ALTER TABLE "ProfileClient" ADD COLUMN IF NOT EXISTS "guardianName" TEXT;
ALTER TABLE "ProfileClient" ADD COLUMN IF NOT EXISTS "guardianConsentAt" TIMESTAMP(3);
