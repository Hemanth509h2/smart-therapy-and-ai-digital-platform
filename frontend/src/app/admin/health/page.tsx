'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { AdminPage, Badge, Btn, Card, DataTable, ErrorBanner, Section, Spinner, useAdminQuery, type Tone } from '@/components/admin/kit';
import { fmtDateTime, timeAgo } from '@/lib/adminApi';

type Status = 'ok' | 'warn' | 'down';
interface Check {
  id: string;
  label: string;
  status: Status;
  latencyMs: number | null;
  message: string;
}
interface CronRun {
  id: string;
  job: string;
  ok: boolean;
  detail: unknown;
  startedAt: string;
  finishedAt: string | null;
}
interface Health {
  checkedAt: string;
  checks: Check[];
  cron: { job: string; runs: CronRun[] }[];
}

const STATUS: Record<Status, { tone: Tone; label: string; icon: React.ReactNode }> = {
  ok: { tone: 'good', label: 'Working', icon: <CheckCircle2 className="h-5 w-5" style={{ color: '#15803d' }} /> },
  warn: { tone: 'warn', label: 'Check', icon: <AlertTriangle className="h-5 w-5" style={{ color: '#b45309' }} /> },
  down: { tone: 'bad', label: 'Down', icon: <XCircle className="h-5 w-5" style={{ color: '#dc2626' }} /> },
};

export default function AdminHealthPage() {
  const { data, loading, error, reload } = useAdminQuery<Health>('/api/admin/health');

  return (
    <AdminPage
      title="System health"
      description={data ? `Checked ${timeAgo(data.checkedAt)}.` : 'Live status of the services STAAD depends on.'}
      permission="settings"
      actions={<Btn variant="ghost" icon={<RefreshCw className="h-4 w-4" />} onClick={reload} loading={loading}>Re-check</Btn>}
    >
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.checks.map((c) => {
              const s = STATUS[c.status];
              return (
                <Card key={c.id} className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0" aria-hidden>{s.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold" style={{ color: 'var(--ink)' }}>{c.label}</h3>
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </div>
                    <p className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>{c.message}</p>
                    {c.latencyMs != null && <p className="mt-1 text-xs font-semibold" style={{ color: 'var(--ink-muted)' }}>{c.latencyMs} ms</p>}
                  </div>
                </Card>
              );
            })}
          </div>

          {data.cron.map((j) => (
            <Section key={j.job} title={`Cron: ${j.job}`} description={j.runs[0] ? `Last run ${timeAgo(j.runs[0].startedAt)}` : 'No runs recorded yet.'}>
              <DataTable<CronRun>
                rows={j.runs}
                rowKey={(r) => r.id}
                empty="No runs recorded yet."
                columns={[
                  { key: 'start', header: 'Started', className: 'whitespace-nowrap', render: (r) => fmtDateTime(r.startedAt) },
                  {
                    key: 'result',
                    header: 'Result',
                    render: (r) =>
                      !r.finishedAt && !r.ok ? <Badge tone="warn">Running / no finish</Badge> : r.ok ? <Badge tone="good">Succeeded</Badge> : <Badge tone="bad">Failed</Badge>,
                  },
                  {
                    key: 'dur',
                    header: 'Took',
                    align: 'right',
                    render: (r) => (r.finishedAt ? `${((new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 1000).toFixed(1)}s` : '—'),
                  },
                  { key: 'detail', header: 'Detail', render: (r) => <code className="block max-w-[420px] truncate text-xs" title={JSON.stringify(r.detail)}>{r.detail == null ? '—' : JSON.stringify(r.detail)}</code> },
                ]}
              />
            </Section>
          ))}
        </>
      ) : null}
    </AdminPage>
  );
}
