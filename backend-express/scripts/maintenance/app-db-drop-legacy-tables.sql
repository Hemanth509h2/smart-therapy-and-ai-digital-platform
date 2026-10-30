-- Drop the old patient tables from the app database (DATABASE_URL).
--
-- Apply with:  npx prisma db execute --schema prisma/app/schema.prisma --file scripts/maintenance/app-db-drop-legacy-tables.sql
--
-- Before the HIPAA split everything lived in this database. Patient data moved
-- to the HIPAA database (DATABASE_URL_2), but the old copies stayed here, unused:
-- nothing in the backend, AI service or feedback board reads them, and no kept
-- table has a foreign key into them. Also drops their enum types and the
-- migration history from that era (the app database is not migrated by Prisma).
--
-- Kept: the tables in prisma/app/schema.prisma (module_report_chunks included),
-- document_chunks, the feedback board's tables (feedback-board/schema.sql) and
-- the n8n schema.
-- One transaction: if any drop fails (e.g. a new dependency), nothing changes.
-- Safe to re-run.

BEGIN;

DROP TABLE IF EXISTS
  "AuditLog",
  "Booking",
  "Invite",
  "ProfileClient",
  "ProgressMetric",
  "ProgressNote",
  "ProgressReport",
  "RiskFlag",
  "Session",
  "SessionReport",
  "SupportReply",
  "SupportTicket",
  "TherapistNote",
  "User",
  "WhatsAppMessage",
  _prisma_migrations;

DROP TYPE IF EXISTS
  "InviteStatus",
  "Role",
  "SessionStatus",
  "TicketStatus",
  "UserStatus",
  "WhatsAppMessageStatus",
  "WhatsAppMessageType";

COMMIT;
