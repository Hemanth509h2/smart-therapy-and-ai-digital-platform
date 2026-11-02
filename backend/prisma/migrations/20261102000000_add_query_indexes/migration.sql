-- DropIndex
DROP INDEX "Invite_therapistId_idx";

-- DropIndex
DROP INDEX "SessionReport_therapistId_idx";

-- DropIndex
DROP INDEX "ProgressMetric_clientId_idx";

-- DropIndex
DROP INDEX "ProgressReport_clientId_idx";

-- DropIndex
DROP INDEX "ProgressNote_clientId_idx";

-- CreateIndex
CREATE INDEX "User_role_createdAt_idx" ON "User"("role", "createdAt");

-- CreateIndex
CREATE INDEX "User_lastSeenAt_idx" ON "User"("lastSeenAt");

-- CreateIndex
CREATE INDEX "Invite_therapistId_createdAt_idx" ON "Invite"("therapistId", "createdAt");

-- CreateIndex
CREATE INDEX "Session_scheduledAt_idx" ON "Session"("scheduledAt");

-- CreateIndex
CREATE INDEX "Session_status_scheduledAt_idx" ON "Session"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Session_startedAt_idx" ON "Session"("startedAt");

-- CreateIndex
CREATE INDEX "SessionReport_therapistId_generatedAt_idx" ON "SessionReport"("therapistId", "generatedAt");

-- CreateIndex
CREATE INDEX "SessionReport_generatedAt_idx" ON "SessionReport"("generatedAt");

-- CreateIndex
CREATE INDEX "TherapistNote_sessionId_createdAt_idx" ON "TherapistNote"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "TherapistNote_therapistId_createdAt_idx" ON "TherapistNote"("therapistId", "createdAt");

-- CreateIndex
CREATE INDEX "ProgressMetric_clientId_recordedAt_idx" ON "ProgressMetric"("clientId", "recordedAt");

-- CreateIndex
CREATE INDEX "ProgressReport_clientId_createdAt_idx" ON "ProgressReport"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "ProgressNote_clientId_createdAt_idx" ON "ProgressNote"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "ProgressNote_therapistId_idx" ON "ProgressNote"("therapistId");

-- CreateIndex
CREATE INDEX "RiskFlag_therapistId_idx" ON "RiskFlag"("therapistId");

-- CreateIndex
CREATE INDEX "SupportTicket_userId_idx" ON "SupportTicket"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

