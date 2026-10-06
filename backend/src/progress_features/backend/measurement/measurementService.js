// measurementService.js
//
// Pure calculation logic for quantitative progress measurement. Reads real
// data from STAAD's existing Prisma models — no dummy/mock data anywhere.
//
// Metrics computed, and exactly what they're derived from:
//
// 1. attendancePercent
//    = (sessions with status COMPLETED) / (sessions already due, i.e.
//      scheduledAt in the past) * 100
//    This uses the existing Session.status and Session.scheduledAt fields.
//
// 2. taskCompletionRate
//    STAAD's schema has no separate "assigned tasks" model, so this uses the
//    closest real signal available: Session.confirmedByPatient (the client
//    confirming/completing their side of a session) as a proxy, expressed as
//    a percentage of completed sessions. This assumption is intentional and
//    documented here rather than inventing a fake field.
//
// 3. averagePerformanceScore
//    Averages ProgressMetric.value across all metric types logged for the
//    client (from the progress-tracking feature, if that migration has been
//    applied to this database). If the ProgressMetric table isn't present
//    yet, this returns null rather than a fabricated number.
//
// 4. history
//    A chronological list of ProgressMetric entries, used by the frontend
//    line chart. Empty array if no metrics have been logged yet.

export async function getClientMetrics(prisma, clientId) {
  const now = new Date();

  const sessions = await prisma.session.findMany({
    where: { clientId },
    orderBy: { scheduledAt: 'asc' },
  });

  const dueSessions = sessions.filter((s) => s.scheduledAt <= now);
  const completedSessions = sessions.filter((s) => s.status === 'COMPLETED');
  const confirmedCompleted = completedSessions.filter((s) => s.confirmedByPatient);

  const attendancePercent =
    dueSessions.length > 0 ? Math.round((completedSessions.length / dueSessions.length) * 1000) / 10 : 0;

  const taskCompletionRate =
    completedSessions.length > 0
      ? Math.round((confirmedCompleted.length / completedSessions.length) * 1000) / 10
      : 0;

  // ProgressMetric may not exist if that migration hasn't been run on this
  // database yet — degrade gracefully instead of throwing.
  let averagePerformanceScore = null;
  let history = [];
  try {
    const metrics = await prisma.progressMetric.findMany({
      where: { clientId },
      orderBy: { recordedAt: 'asc' },
    });
    if (metrics.length > 0) {
      const sum = metrics.reduce((acc, m) => acc + m.value, 0);
      averagePerformanceScore = Math.round((sum / metrics.length) * 10) / 10;
      history = metrics.map((m) => ({
        date: m.recordedAt,
        metricType: m.metricType,
        value: m.value,
      }));
    }
  } catch (err) {
    // ProgressMetric table not present on this database — that's fine, the
    // rest of the metrics (attendance, task completion) still work.
    averagePerformanceScore = null;
    history = [];
  }

  // Monthly attendance/task-completion breakdown for the bar chart.
  const monthlyBuckets = {};
  for (const s of sessions) {
    const key = `${s.scheduledAt.getFullYear()}-${String(s.scheduledAt.getMonth() + 1).padStart(2, '0')}`;
    if (!monthlyBuckets[key]) monthlyBuckets[key] = { month: key, total: 0, completed: 0, confirmed: 0 };
    monthlyBuckets[key].total += 1;
    if (s.status === 'COMPLETED') {
      monthlyBuckets[key].completed += 1;
      if (s.confirmedByPatient) monthlyBuckets[key].confirmed += 1;
    }
  }
  const monthly = Object.values(monthlyBuckets).sort((a, b) => (a.month > b.month ? 1 : -1));

  return {
    clientId,
    totalSessions: sessions.length,
    dueSessions: dueSessions.length,
    completedSessions: completedSessions.length,
    attendancePercent,
    taskCompletionRate,
    averagePerformanceScore,
    history,
    monthly,
  };
}
