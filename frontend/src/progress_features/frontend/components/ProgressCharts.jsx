'use client';

import React, { useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend);

const CARD =
  'rounded-[14px] border-[0.5px] border-[var(--glass-border)] shadow-[var(--glass-shadow)] bg-[var(--glass-bg)] dark:bg-[#16221e] p-5';

export default function ProgressCharts({ clientId }) {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setLoading(true);
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
    return <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-600">{error}</div>;
  }

  if (!metrics) return null;

  const hasHistory = metrics.history && metrics.history.length > 0;
  const hasMonthly = metrics.monthly && metrics.monthly.length > 0;

  const lineData = {
    labels: hasHistory ? metrics.history.map((h) => new Date(h.date).toLocaleDateString()) : [],
    datasets: [
      {
        label: 'Performance score',
        data: hasHistory ? metrics.history.map((h) => h.value) : [],
        borderColor: '#c8602a',
        backgroundColor: 'rgba(200, 96, 42, 0.15)',
        tension: 0.3,
      },
    ],
  };

  const barData = {
    labels: hasMonthly ? metrics.monthly.map((m) => m.month) : [],
    datasets: [
      {
        label: 'Sessions completed',
        data: hasMonthly ? metrics.monthly.map((m) => m.completed) : [],
        backgroundColor: '#6a8f6b',
      },
      {
        label: 'Confirmed by client',
        data: hasMonthly ? metrics.monthly.map((m) => m.confirmed) : [],
        backgroundColor: '#c8602a',
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    plugins: { legend: { position: 'bottom' } },
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className={CARD}>
        <h3 className="font-heading text-lg mb-3" style={{ color: 'var(--ink)' }}>Progress trend</h3>
        {hasHistory ? (
          <Line data={lineData} options={chartOptions} />
        ) : (
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
            No progress metrics logged for this client yet.
          </p>
        )}
      </div>
      <div className={CARD}>
        <h3 className="font-heading text-lg mb-3" style={{ color: 'var(--ink)' }}>Task completion by month</h3>
        {hasMonthly ? (
          <Bar data={barData} options={chartOptions} />
        ) : (
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>No session history yet.</p>
        )}
      </div>
    </div>
  );
}
