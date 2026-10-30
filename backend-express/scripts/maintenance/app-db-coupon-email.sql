-- Coupons reserved for an email address, so a personal code can be made for a
-- professional who hasn't signed up yet (app database, DATABASE_URL).
--
-- Apply with:  npx prisma db execute --schema prisma/app/schema.prisma --file scripts/maintenance/app-db-coupon-email.sql
--
-- Do NOT use `prisma db push` on the app database (see app-db-plan-approval.sql).
-- Only adds a nullable column. Safe to re-run.

ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "email" TEXT;
