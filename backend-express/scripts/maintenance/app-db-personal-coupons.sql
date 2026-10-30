-- Personal coupons: a coupon can be tied to one therapist (app database, DATABASE_URL).
--
-- Apply with:  npx prisma db execute --schema prisma/app/schema.prisma --file scripts/maintenance/app-db-personal-coupons.sql
--
-- Do NOT use `prisma db push` on the app database (see app-db-plan-approval.sql).
-- Only adds a nullable column, an index and a foreign key. Safe to run once;
-- re-running fails on the existing objects.

ALTER TABLE "Coupon" ADD COLUMN "therapistId" TEXT;

CREATE INDEX "Coupon_therapistId_idx" ON "Coupon"("therapistId");
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_therapistId_fkey" FOREIGN KEY ("therapistId") REFERENCES "ProfileTherapist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
