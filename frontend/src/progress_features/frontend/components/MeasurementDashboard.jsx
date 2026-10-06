'use client';

import React, { useEffect, useState } from 'react';

// Same glass-card styling convention used across STAAD (see the existing
// Dashboard, Clients, and Progress pages) so this drops in visually
// consistent with the rest of the app.
const CARD =
  'rounded-[14px] border-[0.5px] border-[var(--glass-border)] shadow-[var(--glass-shadow)] bg-[var(--glass-bg)] dark:bg-[#16221e] p-5';

export default function MeasurementDashboard({ clientId }) {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/progress-features/measurement/${clientId}`)
      .then(async (res) => {
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || `Request failed (${res.status})`);
        }
        return res.json();
      })
      .then((data) => !cancelled && setMetrics(data.metrics))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--sage)] border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-600">{error}</div>
    );
  }

  if (!metrics) return null;

  const cards = [
    {
      label: 'Attendance',
      value: `${metrics.attendancePercent}%`,
      sub: `${metrics.completedSessions}/${metrics.dueSessions} sessions completed`,
    },
    {
      label: 'Task completion rate',
      value: `${metrics.taskCompletionRate}%`,
      sub: 'Based on confirmed sessions',
    },
    {
      label: 'Avg. performance score',
      value: metrics.averagePerformanceScore != null ? metrics.averagePerformanceScore : '—',
      sub: metrics.averagePerformanceScore != null ? 'From logged progress metrics' : 'No metrics logged yet',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {cards.map((c) => (
        <div key={c.label} className={CARD}>
          <p className="text-sm font-medium" style={{ color: 'var(--ink-muted)' }}>{c.label}</p>
          <p className="mt-2 font-heading text-3xl" style={{ color: 'var(--ink)' }}>{c.value}</p>
          <p className="mt-1 text-xs" style={{ color: 'var(--ink-muted)' }}>{c.sub}</p>
        </div>
      ))}
    </div>
  );
}
