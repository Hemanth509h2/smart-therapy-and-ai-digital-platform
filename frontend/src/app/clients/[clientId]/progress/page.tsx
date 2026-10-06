'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import DashboardLayout from '@/components/layout/DashboardLayout';
import ProgressChart from '@/components/progress/ProgressChart';
import TherapistNotesInput from '@/components/progress/TherapistNotesInput';
import ExportProgressReport from '@/components/progress/ExportProgressReport';
import {
  fetchClientMetrics,
  fetchClientReports,
  fetchClientNotes,
  createMetric,
  type ProgressMetric,
  type ProgressReport,
  type ProgressNote,
} from '@/lib/progressApi';
import { apiFetch } from '@/lib/api';

const CARD =
  'rounded-[14px] border-[0.5px] border-[var(--glass-border)] shadow-[var(--glass-shadow)] bg-[var(--glass-bg)] dark:bg-[#16221e]';

const METRIC_TYPES = [
  { value: 'MOOD_SCORE', label: 'Mood Score', unit: 'scale_1_10' },
  { value: 'ANXIETY_LEVEL', label: 'Anxiety Level', unit: 'scale_1_10' },
  { value: 'FOCUS_SCORE', label: 'Focus Score', unit: 'scale_1_10' },
  { value: 'ENGAGEMENT', label: 'Engagement', unit: '%' },
];

export default function ClientProgressPage() {
  const { uid, role, profile } = useAuthStore();
  const router = useRouter();
  const params = useParams<{ clientId: string }>();
  const clientId = params.clientId;

  const [metrics, setMetrics] = useState<ProgressMetric[]>([]);
  const [reports, setReports] = useState<ProgressReport[]>([]);
  const [notes, setNotes] = useState<ProgressNote[]>([]);
  const [clientName, setClientName] = useState('Client');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Quick-add metric form state
  const [metricType, setMetricType] = useState(METRIC_TYPES[0].value);
  const [value, setValue] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!uid) { router.push('/auth'); return; }
    if (role !== 'THERAPIST') { router.push('/'); return; }
    loadData();
  }, [uid, role, clientId]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, r, n, clientRes] = await Promise.all([
        fetchClientMetrics(clientId),
        fetchClientReports(clientId),
        fetchClientNotes(clientId),
        apiFetch(`/api/clients?therapistId=${profile?.id || ''}`).then((res) => res.json()),
      ]);
      setMetrics(m);
      setReports(r);
      setNotes(n);
      const found = clientRes?.clients?.find((c: any) => c.id === clientId);
      if (found) setClientName(`${found.firstName} ${found.lastName}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddMetric = async (e: React.FormEvent) => {
    e.preventDefault();
    const numeric = parseFloat(value);
    if (Number.isNaN(numeric)) return;
    setAdding(true);
    setError(null);
    try {
      const unit = METRIC_TYPES.find((m) => m.value === metricType)?.unit;
      const created = await createMetric({ clientId, metricType, value: numeric, unit });
      setMetrics((prev) => [...prev, created]);
      setValue('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <DashboardLayout role={role} profile={profile}>
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-[28px]" style={{ color: 'var(--ink)' }}>
            {clientName}'s Progress
          </h1>
          <p className="text-sm font-medium mt-1" style={{ color: 'var(--ink-muted)' }}>
            Track metrics, add notes, and export reports.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-600">{error}</div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--sage)] border-t-transparent" />
          </div>
        ) : (
          <>
            {/* Quick add metric */}
            <div className={`${CARD} p-6`}>
              <h3 className="font-heading text-lg mb-4" style={{ color: 'var(--ink)' }}>
                Log a Metric
              </h3>
              <form onSubmit={handleAddMetric} className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                    Metric
                  </label>
                  <select
                    value={metricType}
                    onChange={(e) => setMetricType(e.target.value)}
                    className="rounded-lg border border-[var(--glass-border)] bg-transparent px-3 py-2 text-sm"
                    style={{ color: 'var(--ink)' }}
                  >
                    {METRIC_TYPES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                    Value
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="e.g. 7"
                    className="w-28 rounded-lg border border-[var(--glass-border)] bg-transparent px-3 py-2 text-sm"
                    style={{ color: 'var(--ink)' }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={adding || !value}
                  className="rounded-full px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  style={{ background: 'var(--c-accent)' }}
                >
                  {adding ? 'Saving…' : 'Add Entry'}
                </button>
              </form>
            </div>

            <ProgressChart metrics={metrics} />
            <TherapistNotesInput clientId={clientId} />
                        <ExportProgressReport clientName={clientName} metrics={metrics} reports={reports} notes={notes} />
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
