-- Plan approval before payment (app database, DATABASE_URL).
--
-- Apply with:  npx prisma db execute --schema prisma/app/schema.prisma --file scripts/maintenance/app-db-plan-approval.sql
--
-- Do NOT use `prisma db push` on the app database: it still holds the old
-- patient tables from before the HIPAA split and the feedback board's tables,
-- which are not in prisma/app/schema.prisma, so a push would drop them.
-- These statements only add: two request statuses, nullable columns, indexes
-- and a foreign key. Safe to run once; re-running fails on the existing objects.

ALTER TYPE "SubRequestStatus" ADD VALUE 'AWAITING_PAYMENT';
ALTER TYPE "SubRequestStatus" ADD VALUE 'CANCELLED';
ALTER TABLE "Payment" ADD COLUMN     "requestId" TEXT;

ALTER TABLE "SubscriptionRequest" ADD COLUMN     "couponCode" TEXT,
ADD COLUMN     "couponId" TEXT,
ADD COLUMN     "discount" INTEGER,
ADD COLUMN     "subtotal" INTEGER,
ADD COLUMN     "total" INTEGER;

CREATE INDEX "Payment_requestId_idx" ON "Payment"("requestId");
CREATE INDEX "SubscriptionRequest_couponId_idx" ON "SubscriptionRequest"("couponId");
ALTER TABLE "SubscriptionRequest" ADD CONSTRAINT "SubscriptionRequest_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;
