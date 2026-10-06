// reportService.js
//
// Builds a PDF progress report for one client, server-side, using jsPDF.
// Pulls real session history + the same metrics calculated in
// measurementService.js — no dummy data.

import { jsPDF } from 'jspdf';
import { getClientMetrics } from '../measurement/measurementService.js';

export async function generateClientReportPdf(prisma, clientId) {
  const client = await prisma.profileClient.findUnique({ where: { id: clientId } });
  if (!client) {
    throw new Error('Client not found');
  }

  const metrics = await getClientMetrics(prisma, clientId);

  const sessions = await prisma.session.findMany({
    where: { clientId },
    orderBy: { scheduledAt: 'desc' },
    take: 50, // most recent 50 — keeps the PDF a reasonable length
  });

  const doc = new jsPDF();
  const marginX = 14;
  let y = 18;

  doc.setFontSize(18);
  doc.text(`Progress Report`, marginX, y);
  y += 8;
  doc.setFontSize(11);
  doc.text(`Client: ${client.firstName} ${client.lastName}`, marginX, y);
  y += 6;
  doc.text(`Generated: ${new Date().toLocaleString()}`, marginX, y);
  y += 10;

  doc.setFontSize(13);
  doc.text('Summary Metrics', marginX, y);
  y += 7;
  doc.setFontSize(10);
  doc.text(`Attendance: ${metrics.attendancePercent}%  (${metrics.completedSessions}/${metrics.dueSessions} due sessions completed)`, marginX, y);
  y += 6;
  doc.text(`Task completion rate: ${metrics.taskCompletionRate}%`, marginX, y);
  y += 6;
  doc.text(
    `Average performance score: ${metrics.averagePerformanceScore != null ? metrics.averagePerformanceScore : 'No data logged yet'}`,
    marginX,
    y
  );
  y += 10;

  doc.setFontSize(13);
  doc.text('Session History', marginX, y);
  y += 7;
  doc.setFontSize(9);
  const colX = { date: marginX, status: marginX + 55, confirmed: marginX + 95, duration: marginX + 140 };
  doc.setFont(undefined, 'bold');
  doc.text('Date', colX.date, y);
  doc.text('Status', colX.status, y);
  doc.text('Confirmed', colX.confirmed, y);
  doc.text('Duration', colX.duration, y);
  doc.setFont(undefined, 'normal');
  y += 5;

  for (const s of sessions) {
    if (y > 280) {
      doc.addPage();
      y = 18;
    }
    const durationMin =
      s.startedAt && s.endedAt ? `${Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 60000)}m` : '—';
    doc.text(new Date(s.scheduledAt).toLocaleDateString(), colX.date, y);
    doc.text(s.status, colX.status, y);
    doc.text(s.confirmedByPatient ? 'Yes' : 'No', colX.confirmed, y);
    doc.text(durationMin, colX.duration, y);
    y += 5.5;
  }

  if (sessions.length === 0) {
    doc.text('No sessions recorded yet.', marginX, y);
  }

  // Returns a Node Buffer, ready to send as an HTTP response body.
  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}
