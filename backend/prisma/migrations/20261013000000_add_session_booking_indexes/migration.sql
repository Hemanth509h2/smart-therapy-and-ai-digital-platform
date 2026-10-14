-- CreateIndex
CREATE INDEX "Session_therapistId_scheduledAt_idx" ON "Session"("therapistId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Session_clientId_scheduledAt_idx" ON "Session"("clientId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Booking_therapistId_dateTime_idx" ON "Booking"("therapistId", "dateTime");

-- CreateIndex
CREATE INDEX "Booking_clientId_dateTime_idx" ON "Booking"("clientId", "dateTime");
