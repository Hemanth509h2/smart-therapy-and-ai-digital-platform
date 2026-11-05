-- HIPAA database: feedback asked from the therapist after each video session.
-- Apply from backend-express/:
--   npx prisma db execute --schema prisma/schema.prisma --file scripts/maintenance/hipaa-db-session-feedback.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS "SessionFeedback" (
  "id"          TEXT         NOT NULL,
  "sessionId"   TEXT         NOT NULL,
  "uid"         TEXT         NOT NULL,
  "role"        TEXT         NOT NULL,
  "rating"      INTEGER      NOT NULL,
  "callQuality" TEXT,
  "comment"     TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SessionFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SessionFeedback_sessionId_uid_key" ON "SessionFeedback"("sessionId", "uid");
CREATE INDEX IF NOT EXISTS "SessionFeedback_createdAt_idx" ON "SessionFeedback"("createdAt");

DO $$ BEGIN
  ALTER TABLE "SessionFeedback" ADD CONSTRAINT "SessionFeedback_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
