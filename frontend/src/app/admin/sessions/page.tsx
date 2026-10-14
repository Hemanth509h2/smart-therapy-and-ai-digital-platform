'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Clock, Download, Radio, Video, XCircle } from 'lucide-react';
import {
  AdminPage,
  Badge,
  Btn,
  DataTable,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  Modal,
  Pagination,
  Select,
  StatCard,
  Tabs,
  Textarea,
  Toolbar,
  useAdmin,
  useAdminQuery,
  useListState,
  type Column,
  type Tone,
} from '@/components/admin/kit';
import { adminFetch, downloadCsv, fetchAllPages, fmtDateTime, fmtMinutes, num, timeAgo } from '@/lib/adminApi';
import { toast } from '@/components/practice/ui';

type Tab = 'live' | 'all' | 'risk';

interface LiveSession {
  id: string;
  therapistId: string;
  therapist: string;
  client: string;
  scheduledAt: string;
  startedAt: string | null;
  minutes: number;
}

interface SessionRow {
  id: string;
  status: 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  noShow: boolean;
  scheduledAt: string;
  startedAt: string | null;
  endedAt: string | null;
  minutes: number | null;
  therapistId: string;
  therapist: string;
  client: string;
  riskFlag: boolean;
}

interface Stats {
  from: string;
  to: string;
  total: number;
  completed: number;
  cancelled: number;
  noShow: number;
  scheduled: number;
  active: number;
  avgMinutes: number | null;
  cancellationRate: number | null;
  noShowRate: number | null;
}

interface RiskFlag {
  id: string;
  sessionId: string;
  level: string;
  detail: string | null;
  raisedAt: string;
  acknowledgedAt: string | null;
  acknowledgedByEmail: string | null;
  note: string | null;
  sessionDate: string | null;
  therapistId: string | null;
  therapist: string;
}

// A session still "active" after this long was most likely never ended.
const STALE_MINUTES = 180;

const pct = (r: number | null) => (r == null ? '—' : `${Math.round(r * 1000) / 10}%`);

const linkStyle = { color: 'var(--sage)' } as const;
const TherapistLink = ({ id, name }: { id: string | null; name: string }) =>
  id ? (
    <Link href={`/admin/professionals/${id}`} className="font-semibold hover:underline" style={linkStyle} onClick={(e) => e.stopPropagation()}>
      {name}
    </Link>
  ) : (
    <>{name}</>
  );

export default function AdminSessionsPage() {
  const [tab, setTab] = useState<Tab>('live');

  // Honour ?tab=risk (linked from the dashboard). Read once on mount.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'all' || t === 'risk' || t === 'live') setTab(t);
  }, []);

  const changeTab = (t: Tab) => {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', t);
    window.history.replaceState(null, '', url.toString());
  };

  return (
    <AdminPage title="Sessions" description="Live rooms, session history and AI risk flags. Client names are shown as initials." permission="people.read">
      <Tabs<Tab>
        value={tab}
        onChange={changeTab}
        tabs={[
          { value: 'live', label: 'Live now' },
          { value: 'all', label: 'All sessions' },
          { value: 'risk', label: 'Risk flags' },
        ]}
      />
      {tab === 'live' && <LiveTab />}
      {tab === 'all' && <AllTab />}
      {tab === 'risk' && <RiskTab />}
    </AdminPage>
  );
}

// ─── Live ────────────────────────────────────────────────────────────────────

function LiveTab() {
  const { data, loading, error, reload } = useAdminQuery<{ sessions: LiveSession[]; generatedAt: string }>('/api/admin/sessions?view=live');

  useEffect(() => {
    const t = setInterval(reload, 30_000);
    return () => clearInterval(t);
  }, [reload]);

  const rows = data?.sessions ?? [];
  const columns: Column<LiveSession>[] = [
    { key: 'therapist', header: 'Professional', render: (r) => <TherapistLink id={r.therapistId} name={r.therapist} /> },
    { key: 'client', header: 'Client', render: (r) => r.client },
    { key: 'started', header: 'Started', render: (r) => fmtDateTime(r.startedAt ?? r.scheduledAt) },
    {
      key: 'duration',
      header: 'Running for',
      align: 'right',
      render: (r) => (
        <span className="inline-flex items-center gap-2">
          {r.minutes > STALE_MINUTES && <Badge tone="warn" title="Probably never ended">Stale</Badge>}
          {fmtMinutes(r.minutes)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} onRetry={reload} />}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
        <span className="inline-flex items-center gap-1.5">
          <Radio className="h-3.5 w-3.5" /> {num(rows.length)} in progress · refreshes every 30 seconds
          {data?.generatedAt && <> · updated {timeAgo(data.generatedAt)}</>}
        </span>
        <Btn size="sm" variant="ghost" onClick={reload} loading={loading && !!data}>Refresh</Btn>
      </div>
      {!loading && !error && rows.length === 0 ? (
        <EmptyState icon={<Video className="h-5 w-5" />} title="No live sessions" body="Sessions appear here while a professional has a room open." />
      ) : (
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} loading={loading} />
      )}
    </div>
  );
}

// ─── All sessions ────────────────────────────────────────────────────────────

const STATUS_TONE: Record<SessionRow['status'], Tone> = { SCHEDULED: 'info', ACTIVE: 'good', COMPLETED: 'neutral', CANCELLED: 'bad' };
const STATUS_LABEL: Record<SessionRow['status'], string> = { SCHEDULED: 'Scheduled', ACTIVE: 'Active', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };

function AllTab() {
  const list = useListState({ sort: 'scheduledAt', dir: 'desc', filters: { status: '', therapist: '', from: '', to: '' } });
  const { data, loading, error, reload } = useAdminQuery<{ sessions: SessionRow[]; total: number; stats: Stats; therapists: { id: string; name: string }[] }>(
    `/api/admin/sessions?view=all&${list.query}`
  );
  const [exporting, setExporting] = useState(false);
  const stats = data?.stats;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params: Record<string, string> = { view: 'all', sort: list.sort, dir: list.dir };
      for (const [k, v] of Object.entries(list.filters)) if (v) params[k] = v;
      const rows = await fetchAllPages<SessionRow>('/api/admin/sessions', 'sessions', params);
      downloadCsv(`sessions-${new Date().toISOString().slice(0, 10)}`, rows, [
        { header: 'Session ID', value: (r) => r.id },
        { header: 'Status', value: (r) => (r.noShow ? 'No-show' : STATUS_LABEL[r.status]) },
        { header: 'Scheduled', value: (r) => r.scheduledAt },
        { header: 'Started', value: (r) => r.startedAt },
        { header: 'Ended', value: (r) => r.endedAt },
        { header: 'Minutes', value: (r) => r.minutes },
        { header: 'Professional', value: (r) => r.therapist },
        { header: 'Client (initials)', value: (r) => r.client },
        { header: 'Risk flag', value: (r) => (r.riskFlag ? 'yes' : '') },
      ]);
    } catch (e: any) {
      toast(e.message || 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<SessionRow>[] = [
    { key: 'scheduledAt', header: 'Scheduled', sortKey: 'scheduledAt', render: (r) => fmtDateTime(r.scheduledAt) },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <span className="inline-flex flex-wrap gap-1">
          {r.noShow ? <Badge tone="warn">No-show</Badge> : <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>}
          {r.riskFlag && <Badge tone="bad">Risk flag</Badge>}
        </span>
      ),
    },
    { key: 'therapist', header: 'Professional', render: (r) => <TherapistLink id={r.therapistId} name={r.therapist} /> },
    { key: 'client', header: 'Client', render: (r) => r.client },
    { key: 'duration', header: 'Length', sortKey: 'duration', align: 'right', render: (r) => (r.minutes == null ? '—' : fmtMinutes(r.minutes)) },
  ];

  const therapistOptions = [{ value: '', label: 'All professionals' }, ...(data?.therapists ?? []).map((t) => ({ value: t.id, label: t.name }))];
  const rangeLabel = list.filters.from || list.filters.to ? 'Selected dates' : 'Last 30 days';

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onRetry={reload} />}

      {stats && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Sessions" value={num(stats.total)} hint={rangeLabel} icon={<Video className="h-4 w-4" />} />
          <StatCard label="Completed" value={num(stats.completed)} hint={`${num(stats.scheduled)} upcoming · ${num(stats.active)} active`} icon={<CheckCircle2 className="h-4 w-4" />} />
          <StatCard label="Cancelled" value={num(stats.cancelled)} hint={`${pct(stats.cancellationRate)} of sessions due`} icon={<XCircle className="h-4 w-4" />} />
          <StatCard label="No-shows" value={num(stats.noShow)} hint={`${pct(stats.noShowRate)} of sessions due`} icon={<AlertTriangle className="h-4 w-4" />} />
          <StatCard label="Avg length" value={stats.avgMinutes == null ? '—' : fmtMinutes(stats.avgMinutes)} hint="Completed sessions" icon={<Clock className="h-4 w-4" />} />
        </div>
      )}

      <Toolbar>
        <Select
          ariaLabel="Status"
          value={list.filters.status}
          onChange={(v) => list.setFilter('status', v)}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'SCHEDULED', label: 'Scheduled' },
            { value: 'ACTIVE', label: 'Active' },
            { value: 'COMPLETED', label: 'Completed' },
            { value: 'CANCELLED', label: 'Cancelled' },
            { value: 'NO_SHOW', label: 'No-show' },
          ]}
        />
        <Select ariaLabel="Professional" value={list.filters.therapist} onChange={(v) => list.setFilter('therapist', v)} options={therapistOptions} className="max-w-[220px]" />
        <label className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--ink-muted)' }}>
          Scheduled
          <Input type="date" aria-label="Scheduled from" value={list.filters.from} onChange={(e) => list.setFilter('from', e.target.value)} className="w-auto py-2" />
          –
          <Input type="date" aria-label="Scheduled to" value={list.filters.to} onChange={(e) => list.setFilter('to', e.target.value)} className="w-auto py-2" />
        </label>
        <span className="flex-1" />
        <Btn variant="ghost" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={exportCsv} loading={exporting} disabled={!data?.total}>
          Export CSV
        </Btn>
      </Toolbar>

      <DataTable columns={columns} rows={data?.sessions ?? []} rowKey={(r) => r.id} loading={loading} sort={list.sort} dir={list.dir} onSort={list.onSort} empty="No sessions match these filters." />
      <Pagination page={list.page} pageSize={list.pageSize} total={data?.total ?? 0} onPage={list.setPage} />
    </div>
  );
}

// ─── Risk flags ──────────────────────────────────────────────────────────────

function RiskTab() {
  const { can } = useAdmin();
  const [state, setState] = useState<'open' | 'acknowledged' | ''>('open');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useAdminQuery<{ flags: RiskFlag[]; total: number; open: number; pageSize: number }>(
    `/api/admin/sessions?view=risk&page=${page}${state ? `&state=${state}` : ''}`
  );
  const [acking, setAcking] = useState<RiskFlag | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [ackError, setAckError] = useState('');

  const acknowledge = async () => {
    if (!acking) return;
    setBusy(true);
    setAckError('');
    try {
      await adminFetch(`/api/admin/risk-flags/${acking.id}`, { method: 'PATCH', json: { note } });
      toast('Risk flag acknowledged');
      setAcking(null);
      reload();
    } catch (e: any) {
      setAckError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<RiskFlag>[] = [
    { key: 'level', header: 'Level', render: (r) => (r.level === 'urgent' ? <Badge tone="bad">Urgent</Badge> : <Badge tone="warn">Watch</Badge>) },
    { key: 'raisedAt', header: 'Raised', render: (r) => <span title={fmtDateTime(r.raisedAt)}>{timeAgo(r.raisedAt)}</span> },
    { key: 'detail', header: 'What the AI noticed', className: 'min-w-[240px] max-w-md', render: (r) => <span className="text-sm">{r.detail || '—'}</span> },
    { key: 'session', header: 'Session', render: (r) => fmtDateTime(r.sessionDate) },
    { key: 'therapist', header: 'Professional', render: (r) => <TherapistLink id={r.therapistId} name={r.therapist} /> },
    {
      key: 'ack',
      header: 'Acknowledged',
      render: (r) =>
        r.acknowledgedAt ? (
          <span className="text-xs" title={r.note || undefined}>
            <Badge tone="good">Acknowledged</Badge>
            <span className="mt-1 block" style={{ color: 'var(--ink-muted)' }}>
              {r.acknowledgedByEmail || 'admin'} · {timeAgo(r.acknowledgedAt)}
            </span>
            {r.note && <span className="mt-0.5 block italic" style={{ color: 'var(--ink-muted)' }}>“{r.note}”</span>}
          </span>
        ) : can('people.write') ? (
          <Btn size="sm" onClick={() => { setAcking(r); setNote(''); setAckError(''); }}>Acknowledge</Btn>
        ) : (
          <Badge tone="warn">Open</Badge>
        ),
    },
  ];

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
        Raised by the in-session AI copilot when it notices possible self-harm, harm to others or another safeguarding concern. Acknowledge each one once it has been followed up with the professional.
      </p>
      <Toolbar>
        <Tabs<'open' | 'acknowledged' | ''>
          value={state}
          onChange={(v) => { setState(v); setPage(1); }}
          tabs={[
            { value: 'open', label: `Open${data ? ` (${data.open})` : ''}` },
            { value: 'acknowledged', label: 'Acknowledged' },
            { value: '', label: 'All' },
          ]}
        />
      </Toolbar>
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {!loading && !error && data?.flags.length === 0 && state === 'open' ? (
        <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="No open risk flags" body="Nothing waiting for review." />
      ) : (
        <DataTable columns={columns} rows={data?.flags ?? []} rowKey={(r) => r.id} loading={loading} empty="No risk flags." />
      )}
      <Pagination page={page} pageSize={data?.pageSize ?? 25} total={data?.total ?? 0} onPage={setPage} />

      <Modal
        open={!!acking}
        onClose={() => setAcking(null)}
        title="Acknowledge risk flag"
        description="Record that this flag has been reviewed. Your name and the time are saved with it."
        footer={
          <>
            <Btn variant="ghost" onClick={() => setAcking(null)}>Cancel</Btn>
            <Btn onClick={acknowledge} loading={busy}>Acknowledge</Btn>
          </>
        }
      >
        {acking && (
          <div className="space-y-1 rounded-xl px-3 py-2.5 text-sm" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--ink)' }}>
            <div className="flex items-center gap-2">
              {acking.level === 'urgent' ? <Badge tone="bad">Urgent</Badge> : <Badge tone="warn">Watch</Badge>}
              <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>{acking.therapist} · {fmtDateTime(acking.raisedAt)}</span>
            </div>
            <p>{acking.detail || 'No detail recorded.'}</p>
          </div>
        )}
        <Field label="Note (optional)" hint="What was done, e.g. 'Called the professional; safety plan in place.'">
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </Field>
        {ackError && <ErrorBanner message={ackError} />}
      </Modal>
    </div>
  );
}
