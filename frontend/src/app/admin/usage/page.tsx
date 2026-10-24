'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Blocks, Brain, Cpu, Database, Download, FileText, HardDrive, IndianRupee, MemoryStick, MessageCircle, Mic, Server, TrendingUp, Users, Video } from 'lucide-react';
import {
  AdminPage,
  Badge,
  Btn,
  Card,
  DataTable,
  ErrorBanner,
  Pagination,
  SearchInput,
  Section,
  Select,
  Spinner,
  StatCard,
  Tabs,
  Toolbar,
  useAdmin,
  useAdminQuery,
  type Column,
} from '@/components/admin/kit';
import { ChartCard, type Point } from '@/components/admin/charts';
import { downloadCsv, fmtBytes as bytes, inr, num, timeAgo } from '@/lib/adminApi';

interface ProfessionalUsage {
  therapistId: string;
  name: string;
  email: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | null;
  lastSeenAt: string | null;
  joinedAt: string;
  plan: string | null;
  clients: number;
  sessions: number;
  videoMinutes: number;
  aiAnalyses: number;
  aiReports: number;
  transcriptSegments: number;
  transcriptionMinutes: number;
  moduleLaunches: number;
  whatsappMessages: number;
  storageBytes: number;
  payments: number;
  revenueInr: number;
  cost: { aiAnalysisInr: number; aiReportInr: number; transcriptionInr: number; videoInr: number; whatsappInr: number };
  estCostInr: number;
  netInr: number;
}

interface Usage {
  range: { key: string; days: number | null; seriesDays: number };
  rates: {
    aiAnalysisInr: number;
    transcriptionMinuteInr: number;
    aiReportInr: number;
    videoMinuteInr: number;
    whatsappMessageInr: number;
    hostingMonthlyInr: number;
    databaseMonthlyInr: number;
  };
  totals: {
    professionals: number;
    activeProfessionals: number;
    sessions: number;
    videoMinutes: number;
    aiAnalyses: number;
    aiReports: number;
    transcriptSegments: number;
    transcriptionMinutes: number;
    moduleLaunches: number;
    whatsappMessages: number;
    storageBytes: number;
    revenueInr: number;
    estCostInr: number;
    fixed: { hostingInr: number; databaseInr: number };
    fixedCostInr: number;
    totalCostInr: number;
    netInr: number;
    aiCostInr: number;
    aiReportCostInr: number;
    transcriptionCostInr: number;
    videoCostInr: number;
    whatsappCostInr: number;
  };
  series: Record<'AI_ANALYSIS' | 'TRANSCRIPTION' | 'MODULE_LAUNCH', Point[]>;
  professionals: ProfessionalUsage[];
  topModules: { moduleId: string; name: string; launches: number }[];
  neverLaunched: { moduleId: string; name: string }[];
  notLaunchedInRange: { moduleId: string; name: string }[];
  alerts: { threshold: number; therapists: { therapistId: string; name: string; email: string | null; aiAnalyses: number }[] };
}

interface DbUsage {
  label: string;
  holds: string;
  ok: boolean;
  bytes: number;
  limitBytes: number;
  connections: number;
  tableCount: number;
  rows: number;
  tables: { name: string; rows: number; bytes: number }[];
}

interface Infra {
  checkedAt: string;
  databases: DbUsage[];
  server: {
    platform: string;
    cpus: number;
    load: number[];
    uptimeSec: number;
    memory: { total: number; free: number };
    disk: { total: number; free: number } | null;
    container: { used: number; limit: number | null } | null;
    backend: { node: string; uptimeSec: number; rss: number; heapUsed: number };
  };
  fixed: { hostingMonthlyInr: number; databaseMonthlyInr: number };
}

const RANGES = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '365d', label: 'Last 12 months' },
  { value: 'all', label: 'All time' },
];

const PAGE_SIZE = 25;

function duration(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return d ? `${d}d ${h}h` : `${h}h ${Math.floor((sec % 3600) / 60)}m`;
}

// Sortable numeric fields of a row, keyed by the column's sortKey.
const SORT_VALUE: Record<string, (r: ProfessionalUsage) => number | string> = {
  name: (r) => r.name.toLowerCase(),
  clients: (r) => r.clients,
  sessions: (r) => r.sessions,
  video: (r) => r.videoMinutes,
  ai: (r) => r.aiAnalyses,
  reports: (r) => r.aiReports,
  transcribed: (r) => r.transcriptionMinutes,
  modules: (r) => r.moduleLaunches,
  whatsapp: (r) => r.whatsappMessages,
  storage: (r) => r.storageBytes,
  lastSeen: (r) => (r.lastSeenAt ? new Date(r.lastSeenAt).getTime() : 0),
  costAi: (r) => r.cost.aiAnalysisInr,
  costReports: (r) => r.cost.aiReportInr,
  costTranscription: (r) => r.cost.transcriptionInr,
  costVideo: (r) => r.cost.videoInr,
  costWhatsapp: (r) => r.cost.whatsappInr,
  cost: (r) => r.estCostInr,
  revenue: (r) => r.revenueInr,
  net: (r) => r.netInr,
};

export default function AdminUsagePage() {
  const [range, setRange] = useState('30d');
  const { data, loading, error, reload } = useAdminQuery<Usage>(`/api/admin/usage?range=${range}`);
  const { can } = useAdmin();
  const router = useRouter();
  const rangeLabel = RANGES.find((r) => r.value === range)?.label ?? '';
  const seriesLabel = data && data.range.days == null ? 'Last 12 months' : rangeLabel;

  const [view, setView] = useState<'usage' | 'cost'>('usage');
  const [q, setQ] = useState('');
  const [usedOnly, setUsedOnly] = useState('all');
  const [sort, setSort] = useState('cost');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [q, usedOnly, sort, dir, range]);

  const onSort = (key: string) => {
    if (key === sort) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSort(key);
      setDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const value = SORT_VALUE[sort] ?? SORT_VALUE.cost;
    return (data?.professionals ?? [])
      .filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.email?.toLowerCase().includes(needle))
      .filter((r) => usedOnly === 'all' || (usedOnly === 'used' ? r.estCostInr > 0 || r.moduleLaunches > 0 : r.estCostInr === 0 && r.moduleLaunches === 0))
      .sort((a, b) => {
        const x = value(a);
        const y = value(b);
        const c = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number);
        return dir === 'asc' ? c : -c;
      });
  }, [data, q, usedOnly, sort, dir]);

  const exportCsv = () =>
    downloadCsv(`professional-usage-${range}-${new Date().toISOString().slice(0, 10)}`, rows, [
      { header: 'Name', value: (r) => r.name },
      { header: 'Email', value: (r) => r.email },
      { header: 'Status', value: (r) => r.status },
      { header: 'Plan', value: (r) => r.plan ?? 'Free' },
      { header: 'Last seen', value: (r) => r.lastSeenAt },
      { header: 'Clients', value: (r) => r.clients },
      { header: 'Sessions', value: (r) => r.sessions },
      { header: 'Video minutes', value: (r) => r.videoMinutes },
      { header: 'AI analyses', value: (r) => r.aiAnalyses },
      { header: 'AI reports', value: (r) => r.aiReports },
      { header: 'Transcription minutes', value: (r) => r.transcriptionMinutes },
      { header: 'Transcript segments', value: (r) => r.transcriptSegments },
      { header: 'Module launches', value: (r) => r.moduleLaunches },
      { header: 'WhatsApp messages', value: (r) => r.whatsappMessages },
      { header: 'Storage (bytes)', value: (r) => r.storageBytes },
      { header: 'AI analysis cost (INR)', value: (r) => r.cost.aiAnalysisInr },
      { header: 'AI report cost (INR)', value: (r) => r.cost.aiReportInr },
      { header: 'Transcription cost (INR)', value: (r) => r.cost.transcriptionInr },
      { header: 'Video cost (INR)', value: (r) => r.cost.videoInr },
      { header: 'WhatsApp cost (INR)', value: (r) => r.cost.whatsappInr },
      { header: 'Total est. cost (INR)', value: (r) => r.estCostInr },
      { header: 'Payments', value: (r) => r.payments },
      { header: 'Revenue (INR)', value: (r) => r.revenueInr },
      { header: 'Net (INR)', value: (r) => r.netInr },
    ]);

  const nameColumn: Column<ProfessionalUsage> = {
    key: 'name',
    header: 'Professional',
    sortKey: 'name',
    render: (r) => (
      <div className="min-w-[180px]">
        <div className="flex items-center gap-1.5 font-semibold">
          {r.name}
          {r.status === 'SUSPENDED' && <Badge tone="bad">Suspended</Badge>}
        </div>
        <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>{r.email}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          <Badge tone={r.plan ? 'info' : 'neutral'}>{r.plan ?? 'Free'}</Badge>
        </div>
      </div>
    ),
  };
  const right = (key: string, header: string, sortKey: string, render: (r: ProfessionalUsage) => React.ReactNode): Column<ProfessionalUsage> => ({
    key,
    header,
    sortKey,
    align: 'right',
    className: 'whitespace-nowrap tabular-nums',
    render,
  });

  const usageColumns: Column<ProfessionalUsage>[] = [
    nameColumn,
    right('clients', 'Clients', 'clients', (r) => num(r.clients)),
    right('sessions', 'Sessions', 'sessions', (r) => num(r.sessions)),
    right('video', 'Video', 'video', (r) => `${num(r.videoMinutes)} min`),
    right('ai', 'AI analyses', 'ai', (r) => num(r.aiAnalyses)),
    right('reports', 'AI reports', 'reports', (r) => num(r.aiReports)),
    right('transcribed', 'Transcribed', 'transcribed', (r) => `${num(r.transcriptionMinutes)} min`),
    right('modules', 'Modules', 'modules', (r) => num(r.moduleLaunches)),
    right('whatsapp', 'WhatsApp', 'whatsapp', (r) => num(r.whatsappMessages)),
    right('storage', 'Storage', 'storage', (r) => bytes(r.storageBytes)),
    right('lastSeen', 'Last seen', 'lastSeen', (r) => <span style={{ color: 'var(--ink-muted)' }}>{timeAgo(r.lastSeenAt)}</span>),
    right('cost', 'Est. cost', 'cost', (r) => <span className="font-semibold">{inr(r.estCostInr)}</span>),
  ];

  const costColumns: Column<ProfessionalUsage>[] = [
    nameColumn,
    right('costAi', 'AI analyses', 'costAi', (r) => inr(r.cost.aiAnalysisInr)),
    right('costReports', 'AI reports', 'costReports', (r) => inr(r.cost.aiReportInr)),
    right('costTranscription', 'Transcription', 'costTranscription', (r) => inr(r.cost.transcriptionInr)),
    right('costVideo', 'Video', 'costVideo', (r) => inr(r.cost.videoInr)),
    right('costWhatsapp', 'WhatsApp', 'costWhatsapp', (r) => inr(r.cost.whatsappInr)),
    right('cost', 'Total cost', 'cost', (r) => <span className="font-semibold">{inr(r.estCostInr)}</span>),
    right('revenue', 'Paid', 'revenue', (r) => inr(r.revenueInr)),
    right('net', 'Net', 'net', (r) => <span className="font-semibold" style={{ color: r.netInr < 0 ? '#dc2626' : 'var(--ink)' }}>{inr(r.netInr)}</span>),
  ];

  const t = data?.totals;

  return (
    <AdminPage
      title="Usage & cost"
      description="Everything every professional uses — sessions, AI, transcription, video, WhatsApp — with estimated cost and what they paid."
      permission="people.read"
      actions={
        <div className="flex flex-wrap gap-2">
          <Select ariaLabel="Date range" value={range} onChange={setRange} options={RANGES} />
          <Btn variant="ghost" icon={<Download className="h-4 w-4" />} disabled={!data} onClick={exportCsv}>Export CSV</Btn>
        </div>
      }
    >
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : data && t ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Total cost"
              value={inr(t.totalCostInr)}
              hint={`${inr(t.estCostInr)} usage + ${inr(t.fixedCostInr)} hosting & database`}
              icon={<IndianRupee className="h-4 w-4" />}
            />
            <StatCard label="Paid by professionals" value={inr(t.revenueInr)} hint={rangeLabel} icon={<TrendingUp className="h-4 w-4" />} />
            <StatCard label="Net" value={inr(t.netInr)} hint="Paid minus estimated cost" icon={<IndianRupee className="h-4 w-4" />} />
            <StatCard label="Professionals using it" value={`${num(t.activeProfessionals)} / ${num(t.professionals)}`} hint={rangeLabel} icon={<Users className="h-4 w-4" />} />
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Video sessions" value={num(t.sessions)} hint={`${num(t.videoMinutes)} min · ${inr(t.videoCostInr)}`} icon={<Video className="h-4 w-4" />} />
            <StatCard label="AI analyses" value={num(t.aiAnalyses)} hint={`${inr(t.aiCostInr)} at ${inr(data.rates.aiAnalysisInr)} each`} icon={<Brain className="h-4 w-4" />} />
            <StatCard label="AI reports" value={num(t.aiReports)} hint={`${inr(t.aiReportCostInr)} at ${inr(data.rates.aiReportInr)} each`} icon={<FileText className="h-4 w-4" />} />
            <StatCard
              label="Transcription"
              value={`${num(t.transcriptionMinutes)} min`}
              hint={`${inr(t.transcriptionCostInr)} at ${inr(data.rates.transcriptionMinuteInr)}/min`}
              icon={<Mic className="h-4 w-4" />}
            />
            <StatCard label="WhatsApp sent" value={num(t.whatsappMessages)} hint={`${inr(t.whatsappCostInr)} at ${inr(data.rates.whatsappMessageInr)} each`} icon={<MessageCircle className="h-4 w-4" />} />
            <StatCard label="Module launches" value={num(t.moduleLaunches)} hint="No direct cost" icon={<Blocks className="h-4 w-4" />} />
          </div>
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            Costs are estimates from the rates in Settings ({inr(data.rates.videoMinuteInr)} per video minute). Video and transcription minutes are the
            length of sessions that were held or transcribed. &ldquo;Paid&rdquo; is successful Cashfree payments in the period. Hosting (
            {inr(data.rates.hostingMonthlyInr)}/month) and databases ({inr(data.rates.databaseMonthlyInr)}/month) are fixed bills, prorated over the
            period and counted in the platform total only; a professional&rsquo;s &ldquo;Net&rdquo; is what they paid minus their usage cost.
            Storage is an estimate of the database space their rows take.
          </p>

          <Section
            title="Every professional"
            description={`${num(rows.length)} of ${num(data.professionals.length)} professionals, ${rangeLabel.toLowerCase()}. Click a row for everything about that professional.`}
          >
            <Toolbar>
              <SearchInput value={q} onChange={setQ} placeholder="Search name or email…" />
              <Select
                ariaLabel="Filter by usage"
                value={usedOnly}
                onChange={setUsedOnly}
                options={[
                  { value: 'all', label: 'Everyone' },
                  { value: 'used', label: 'Used something' },
                  { value: 'unused', label: 'Used nothing' },
                ]}
              />
              <span className="flex-1" />
              <Tabs value={view} onChange={setView} tabs={[{ value: 'usage', label: 'Usage' }, { value: 'cost', label: 'Cost' }]} />
            </Toolbar>
            <DataTable<ProfessionalUsage>
              rows={rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
              rowKey={(r) => r.therapistId}
              columns={view === 'usage' ? usageColumns : costColumns}
              sort={sort}
              dir={dir}
              onSort={onSort}
              onRowClick={(r) => router.push(`/admin/usage/${r.therapistId}?range=${range}`)}
              loading={loading}
              empty={q || usedOnly !== 'all' ? 'No professionals match.' : 'No professionals yet.'}
            />
            <Pagination page={page} pageSize={PAGE_SIZE} total={rows.length} onPage={setPage} />
          </Section>

          {can('settings') && <InfraSection />}

          {data.alerts.therapists.length > 0 && (
            <Section title="Heavy users this month" description={`More than ${num(data.alerts.threshold)} AI analyses since the 1st. Change the threshold in Settings.`}>
              <Card className="space-y-2">
                {data.alerts.therapists.map((a) => (
                  <button
                    key={a.therapistId}
                    onClick={() => router.push(`/admin/usage/${a.therapistId}?range=${range}`)}
                    className="flex w-full flex-wrap items-center gap-3 rounded-lg px-1 py-1.5 text-left text-sm hover:bg-[var(--sage-light)]"
                  >
                    <AlertTriangle className="h-4 w-4" style={{ color: '#b45309' }} />
                    <span className="font-semibold" style={{ color: 'var(--ink)' }}>{a.name}</span>
                    <span style={{ color: 'var(--ink-muted)' }}>{a.email}</span>
                    <span className="flex-1" />
                    <Badge tone="warn">{num(a.aiAnalyses)} analyses</Badge>
                  </button>
                ))}
              </Card>
            </Section>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title="Estimated cost by type"
              subtitle={rangeLabel}
              kind="bar"
              horizontal
              format={(n) => inr(n)}
              height={200}
              data={[
                { label: 'Video', value: t.videoCostInr },
                { label: 'AI analyses', value: t.aiCostInr },
                { label: 'AI reports', value: t.aiReportCostInr },
                { label: 'Transcription', value: t.transcriptionCostInr },
                { label: 'WhatsApp', value: t.whatsappCostInr },
                { label: 'Hosting', value: t.fixed.hostingInr },
                { label: 'Databases', value: t.fixed.databaseInr },
              ]}
            />
            <ChartCard
              title="Highest-cost professionals"
              subtitle={rangeLabel}
              kind="bar"
              horizontal
              format={(n) => inr(n)}
              height={Math.max(140, Math.min(10, data.professionals.filter((p) => p.estCostInr > 0).length) * 32)}
              data={data.professionals
                .filter((p) => p.estCostInr > 0)
                .slice(0, 10)
                .map((p) => ({ label: p.name, value: p.estCostInr }))}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <ChartCard title="AI analyses per day" subtitle={seriesLabel} data={data.series.AI_ANALYSIS} kind="bar" />
            <ChartCard title="Transcript segments per day" subtitle={seriesLabel} data={data.series.TRANSCRIPTION} kind="bar" />
            <ChartCard title="Module launches per day" subtitle={seriesLabel} data={data.series.MODULE_LAUNCH} kind="bar" />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section title="Top modules" description={rangeLabel}>
              {data.topModules.length ? (
                <ChartCard
                  title="Launches by module"
                  data={data.topModules.slice(0, 12).map((m) => ({ label: m.name, value: m.launches }))}
                  kind="bar"
                  horizontal
                  height={Math.max(140, Math.min(12, data.topModules.length) * 32)}
                />
              ) : (
                <Card><p className="text-sm" style={{ color: 'var(--ink-muted)' }}>No modules launched in this period.</p></Card>
              )}
            </Section>
            <Section title="Unused modules" description="Candidates for pruning or promotion">
              <Card className="space-y-4">
                <ModuleList title="Never launched" tone="bad" items={data.neverLaunched} empty="Every module has been launched at least once." />
                <ModuleList
                  title={`Not launched in the ${rangeLabel.toLowerCase()}`}
                  tone="warn"
                  items={data.notLaunchedInRange.filter((m) => !data.neverLaunched.some((n) => n.moduleId === m.moduleId))}
                  empty="None."
                />
              </Card>
            </Section>
          </div>
        </>
      ) : null}
    </AdminPage>
  );
}

function InfraSection() {
  const { data, loading, error, reload } = useAdminQuery<Infra>('/api/admin/usage/infra');
  const s = data?.server;
  const memUsed = s ? s.memory.total - s.memory.free : 0;
  const diskUsed = s?.disk ? s.disk.total - s.disk.free : 0;

  return (
    <Section
      title="Database & hosting"
      description="Live right now, not for the selected period."
      actions={<Btn size="sm" variant="ghost" loading={loading} onClick={reload}>Refresh</Btn>}
    >
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {!data ? (
        loading ? <div className="flex justify-center py-10"><Spinner /></div> : null
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {data.databases.map((db) => (
              <Card key={db.label} className="space-y-3">
                <div className="flex items-start gap-2">
                  <Database className="mt-0.5 h-4 w-4" style={{ color: 'var(--ink-muted)' }} />
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{db.label}</h3>
                    <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>{db.holds}</p>
                  </div>
                  {!db.ok && <Badge tone="bad">Could not read</Badge>}
                </div>
                <Meter label="Storage" used={db.bytes} total={db.limitBytes} format={bytes} />
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs" style={{ color: 'var(--ink-muted)' }}>
                  <span>{num(db.tableCount)} tables</span>
                  <span>~{num(db.rows)} rows</span>
                  <span>{num(db.connections)} open connections</span>
                </div>
                {db.tables.length > 0 && (
                  <table className="w-full text-xs tabular-nums">
                    <thead>
                      <tr style={{ color: 'var(--ink-muted)' }}>
                        <th className="py-1 text-left font-semibold">Largest tables</th>
                        <th className="py-1 text-right font-semibold">Rows</th>
                        <th className="py-1 text-right font-semibold">Size</th>
                      </tr>
                    </thead>
                    <tbody style={{ color: 'var(--ink)' }}>
                      {db.tables.map((tb) => (
                        <tr key={tb.name} style={{ borderTop: '1px solid var(--glass-border)' }}>
                          <td className="py-1">{tb.name}</td>
                          <td className="py-1 text-right">{num(tb.rows)}</td>
                          <td className="py-1 text-right">{bytes(tb.bytes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            ))}
          </div>

          {s && (
            <Card className="space-y-4">
              <div className="flex items-start gap-2">
                <Server className="mt-0.5 h-4 w-4" style={{ color: 'var(--ink-muted)' }} />
                <div className="flex-1">
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Server</h3>
                  <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                    {s.platform} · up {duration(s.uptimeSec)} · {inr(data.fixed.hostingMonthlyInr)}/month
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                    <Cpu className="h-3.5 w-3.5" /> CPU
                  </div>
                  <Meter label={`Load (1 min) on ${s.cpus} cores`} used={s.load[0]} total={s.cpus} format={(n) => n.toFixed(2)} />
                  <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>5 min {s.load[1]} · 15 min {s.load[2]}</p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                    <MemoryStick className="h-3.5 w-3.5" /> Memory
                  </div>
                  <Meter label="Whole server" used={memUsed} total={s.memory.total} format={bytes} />
                  {s.container && s.container.limit && <Meter label="Backend container" used={s.container.used} total={s.container.limit} format={bytes} />}
                  <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                    Backend process {bytes(s.backend.rss)} · Node {s.backend.node} · restarted {duration(s.backend.uptimeSec)} ago
                  </p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                    <HardDrive className="h-3.5 w-3.5" /> Disk
                  </div>
                  {s.disk ? <Meter label="Server disk" used={diskUsed} total={s.disk.total} format={bytes} /> : <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>Not available.</p>}
                </div>
              </div>
            </Card>
          )}
        </>
      )}
    </Section>
  );
}

function Meter({ label, used, total, format }: { label: string; used: number; total: number; format: (n: number) => string }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const color = pct >= 90 ? '#dc2626' : pct >= 75 ? '#b45309' : 'var(--sage)';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs" style={{ color: 'var(--ink-muted)' }}>
        <span>{label}</span>
        <span className="tabular-nums">
          {format(used)} / {format(total)} ({Math.round(pct)}%)
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--glass-border)' }} role="meter" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function ModuleList({ title, tone, items, empty }: { title: string; tone: 'bad' | 'warn'; items: { moduleId: string; name: string }[]; empty: string }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold" style={{ color: 'var(--ink)' }}>{title} ({items.length})</h3>
      {items.length ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((m) => <Badge key={m.moduleId} tone={tone}>{m.name}</Badge>)}
        </div>
      ) : (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>{empty}</p>
      )}
    </div>
  );
}
