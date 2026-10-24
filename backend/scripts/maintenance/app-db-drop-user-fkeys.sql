-- Drop the profile -> "User" foreign keys left over from before the database
-- split (app database, DATABASE_URL).
--
-- Apply with:  npx prisma db execute --schema prisma/app/schema.prisma --file scripts/maintenance/app-db-drop-user-fkeys.sql
--
-- Do NOT use `prisma db push` on the app database (see app-db-plan-approval.sql).
-- Users now live only in the HIPAA database, so these constraints made every new
-- therapist/admin profile fail with P2003 ("refers to a record that no longer
-- exists"). The app schema links profiles to users by plain id. Safe to re-run.

ALTER TABLE "ProfileTherapist" DROP CONSTRAINT IF EXISTS "ProfileTherapist_userId_fkey";
ALTER TABLE "ProfileAdmin" DROP CONSTRAINT IF EXISTS "ProfileAdmin_userId_fkey";
