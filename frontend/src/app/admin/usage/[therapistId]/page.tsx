'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Blocks, Brain, Database, FileText, IndianRupee, MessageCircle, Mic, TrendingUp, User, Users, Video } from 'lucide-react';
import {
  AdminPage,
  Badge,
  Btn,
  Card,
  DataTable,
  EmptyState,
  ErrorBanner,
  Pagination,
  Section,
  Select,
  Spinner,
  StatCard,
  useAdminQuery,
  type Tone,
} from '@/components/admin/kit';
import { ChartCard } from '@/components/admin/charts';
import { fmtBytes, fmtDate, fmtDateTime, inr, num, timeAgo } from '@/lib/adminApi';

interface Cost {
  aiAnalysisInr: number;
  aiReportInr: number;
  transcriptionInr: number;
  videoInr: number;
  whatsappInr: number;
}

interface SessionRow {
  sessionId: string;
  status: 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  scheduledAt: string;
  startedAt: string | null;
  minutes: number;
  aiAnalyses: number;
  transcribed: boolean;
  transcriptSegments: number;
  moduleLaunches: number;
  aiReport: boolean;
  estCostInr: number;
}

interface PaymentRow {
  id: string;
  status: string;
  amountInr: number;
  discountInr: number | null;
  couponCode: string | null;
  plan: string | null;
  months: number | null;
  createdAt: string;
  paidAt: string | null;
}

interface ProfessionalUsage {
  range: { key: string; days: number | null; seriesDays: number };
  rates: { aiAnalysisInr: number; transcriptionMinuteInr: number; aiReportInr: number; videoMinuteInr: number; whatsappMessageInr: number };
  professional: {
    therapistId: string;
    name: string;
    email: string | null;
    status: 'ACTIVE' | 'SUSPENDED' | null;
    lastSeenAt: string | null;
    joinedAt: string;
    specialty: string[];
    plan: string | null;
    planEndsAt: string | null;
  };
  totals: {
    clients: number;
    sessions: number;
    videoMinutes: number;
    aiAnalyses: number;
    aiReports: number;
    transcriptSegments: number;
    transcriptionMinutes: number;
    moduleLaunches: number;
    whatsappMessages: number;
    whatsappFailed: number;
    payments: number;
    revenueInr: number;
    storageBytes: number;
    cost: Cost;
    estCostInr: number;
    netInr: number;
  };
  series: { label: string; costInr: number; sessions: number }[];
  sessions: SessionRow[];
  sessionsTruncated: boolean;
  modules: { moduleId: string; name: string; launches: number }[];
  whatsapp: { type: string; sent: number; failed: number }[];
  payments: PaymentRow[];
  storage: { table: string; rows: number; bytes: number }[];
}

const RANGES = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '365d', label: 'Last 12 months' },
  { value: 'all', label: 'All time' },
];

const SESSION_TONE: Record<SessionRow['status'], Tone> = { COMPLETED: 'good', ACTIVE: 'info', SCHEDULED: 'neutral', CANCELLED: 'bad' };
const PAYMENT_TONE: Record<string, Tone> = { PAID: 'good', ACTIVE: 'neutral', EXPIRED: 'warn', TERMINATED: 'bad' };
const WHATSAPP_LABEL: Record<string, string> = {
  CLIENT_INVITE: 'Client invites',
  SESSION_SCHEDULED: 'Session scheduled',
  SESSION_STARTED: 'Session started',
};
const SESSIONS_PAGE = 20;

export default function ProfessionalUsagePage() {
  const { therapistId } = useParams<{ therapistId: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const initial = search.get('range');
  const [range, setRange] = useState(RANGES.some((r) => r.value === initial) ? initial! : '30d');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [range]);

  const { data, loading, error, reload } = useAdminQuery<ProfessionalUsage>(`/api/admin/usage/${therapistId}?range=${range}`);
  const rangeLabel = RANGES.find((r) => r.value === range)?.label ?? '';
  const seriesLabel = data && data.range.days == null ? 'Last 12 months' : rangeLabel;
  const p = data?.professional;
  const t = data?.totals;

  const changeRange = (v: string) => {
    setRange(v);
    router.replace(`/admin/usage/${therapistId}?range=${v}`, { scroll: false });
  };

  return (
    <AdminPage
      title={p?.name ?? 'Usage & cost'}
      description={p ? `${p.email ?? 'No email'} · everything this professional used and what it cost` : undefined}
      permission="people.read"
      actions={
        <div className="flex flex-wrap gap-2">
          <Btn variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => router.push('/admin/usage')}>All professionals</Btn>
          <Select ariaLabel="Date range" value={range} onChange={changeRange} options={RANGES} />
        </div>
      }
    >
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : data && p && t ? (
        <>
          <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="flex items-center gap-1.5">
              <Badge tone={p.plan ? 'info' : 'neutral'}>{p.plan ?? 'Free'}</Badge>
              {p.planEndsAt && <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>until {fmtDate(p.planEndsAt)}</span>}
            </span>
            {p.status === 'SUSPENDED' && <Badge tone="bad">Suspended</Badge>}
            <span style={{ color: 'var(--ink-muted)' }}>Joined {fmtDate(p.joinedAt)}</span>
            <span style={{ color: 'var(--ink-muted)' }}>Last seen {timeAgo(p.lastSeenAt)}</span>
            {p.specialty.length > 0 && <span style={{ color: 'var(--ink-muted)' }}>{p.specialty.join(', ')}</span>}
            <span className="flex-1" />
            <Link href={`/admin/professionals/${p.therapistId}`} className="flex items-center gap-1 text-sm font-semibold" style={{ color: 'var(--sage)' }}>
              <User className="h-3.5 w-3.5" /> Profile & account
            </Link>
          </Card>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Estimated cost" value={inr(t.estCostInr)} hint={rangeLabel} icon={<IndianRupee className="h-4 w-4" />} />
            <StatCard label="Paid" value={inr(t.revenueInr)} hint={`${num(t.payments)} successful payment${t.payments === 1 ? '' : 's'}`} icon={<TrendingUp className="h-4 w-4" />} />
            <StatCard label="Net" value={<span style={{ color: t.netInr < 0 ? '#dc2626' : undefined }}>{inr(t.netInr)}</span>} hint="Paid minus estimated cost" icon={<IndianRupee className="h-4 w-4" />} />
            <StatCard label="Database storage" value={fmtBytes(t.storageBytes)} hint="All their rows, both databases" icon={<Database className="h-4 w-4" />} />
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Clients" value={num(t.clients)} hint="All time" icon={<Users className="h-4 w-4" />} />
            <StatCard label="Video sessions" value={num(t.sessions)} hint={`${num(t.videoMinutes)} min · ${inr(t.cost.videoInr)}`} icon={<Video className="h-4 w-4" />} />
            <StatCard label="AI analyses" value={num(t.aiAnalyses)} hint={`${inr(t.cost.aiAnalysisInr)} at ${inr(data.rates.aiAnalysisInr)} each`} icon={<Brain className="h-4 w-4" />} />
            <StatCard label="AI reports" value={num(t.aiReports)} hint={`${inr(t.cost.aiReportInr)} at ${inr(data.rates.aiReportInr)} each`} icon={<FileText className="h-4 w-4" />} />
            <StatCard
              label="Transcription"
              value={`${num(t.transcriptionMinutes)} min`}
              hint={`${num(t.transcriptSegments)} segments · ${inr(t.cost.transcriptionInr)}`}
              icon={<Mic className="h-4 w-4" />}
            />
            <StatCard
              label="WhatsApp sent"
              value={num(t.whatsappMessages)}
              hint={`${inr(t.cost.whatsappInr)}${t.whatsappFailed ? ` · ${num(t.whatsappFailed)} failed` : ''}`}
              icon={<MessageCircle className="h-4 w-4" />}
            />
            <StatCard label="Module launches" value={num(t.moduleLaunches)} hint="No direct cost" icon={<Blocks className="h-4 w-4" />} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <ChartCard
              title="Estimated cost by type"
              subtitle={rangeLabel}
              kind="bar"
              horizontal
              format={(n) => inr(n)}
              height={200}
              data={[
                { label: 'Video', value: t.cost.videoInr },
                { label: 'AI analyses', value: t.cost.aiAnalysisInr },
                { label: 'AI reports', value: t.cost.aiReportInr },
                { label: 'Transcription', value: t.cost.transcriptionInr },
                { label: 'WhatsApp', value: t.cost.whatsappInr },
              ]}
            />
            <ChartCard title="Estimated cost per day" subtitle={seriesLabel} kind="bar" format={(n) => inr(n)} data={data.series.map((d) => ({ label: d.label, value: d.costInr }))} />
            <ChartCard title="Sessions per day" subtitle={seriesLabel} kind="bar" data={data.series.map((d) => ({ label: d.label, value: d.sessions }))} />
          </div>

          <Section
            title="Sessions"
            description={`${num(data.sessions.length)} in the ${rangeLabel.toLowerCase()}${data.sessionsTruncated ? ' (latest 500 shown)' : ''}. Cost counts what each session used.`}
          >
            <DataTable<SessionRow>
              rows={data.sessions.slice((page - 1) * SESSIONS_PAGE, page * SESSIONS_PAGE)}
              rowKey={(r) => r.sessionId}
              empty="No sessions in this period."
              columns={[
                {
                  key: 'when',
                  header: 'When',
                  render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.startedAt ?? r.scheduledAt)}</span>,
                },
                { key: 'status', header: 'Status', render: (r) => <Badge tone={SESSION_TONE[r.status]}>{r.status.toLowerCase()}</Badge> },
                { key: 'len', header: 'Length', align: 'right', className: 'tabular-nums', render: (r) => (r.minutes ? `${num(r.minutes)} min` : '—') },
                { key: 'ai', header: 'AI analyses', align: 'right', className: 'tabular-nums', render: (r) => num(r.aiAnalyses) },
                { key: 'tr', header: 'Transcribed', render: (r) => (r.transcribed ? <Badge tone="info">{num(r.transcriptSegments)} segments</Badge> : '—') },
                { key: 'rep', header: 'AI report', render: (r) => (r.aiReport ? <Badge tone="info">Yes</Badge> : '—') },
                { key: 'mod', header: 'Modules', align: 'right', className: 'tabular-nums', render: (r) => num(r.moduleLaunches) },
                { key: 'cost', header: 'Est. cost', align: 'right', className: 'tabular-nums font-semibold', render: (r) => inr(r.estCostInr) },
              ]}
            />
            <Pagination page={page} pageSize={SESSIONS_PAGE} total={data.sessions.length} onPage={setPage} />
          </Section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section title="Modules used" description={rangeLabel}>
              {data.modules.length ? (
                <ChartCard
                  title="Launches by module"
                  data={data.modules.slice(0, 12).map((m) => ({ label: m.name, value: m.launches }))}
                  kind="bar"
                  horizontal
                  height={Math.max(140, Math.min(12, data.modules.length) * 32)}
                />
              ) : (
                <Card><p className="text-sm" style={{ color: 'var(--ink-muted)' }}>No modules launched in this period.</p></Card>
              )}
            </Section>
            <Section title="WhatsApp messages" description={`${rangeLabel} · ${inr(data.rates.whatsappMessageInr)} per message sent`}>
              <DataTable<{ type: string; sent: number; failed: number }>
                rows={data.whatsapp}
                rowKey={(r) => r.type}
                empty="No WhatsApp messages in this period."
                columns={[
                  { key: 'type', header: 'Message', render: (r) => WHATSAPP_LABEL[r.type] ?? r.type },
                  { key: 'sent', header: 'Sent', align: 'right', className: 'tabular-nums', render: (r) => num(r.sent) },
                  { key: 'failed', header: 'Failed', align: 'right', className: 'tabular-nums', render: (r) => (r.failed ? <Badge tone="bad">{num(r.failed)}</Badge> : '0') },
                ]}
              />
            </Section>
          </div>

          <Section title="Payments" description={`Cashfree orders, ${rangeLabel.toLowerCase()}`}>
            <DataTable<PaymentRow>
              rows={data.payments}
              rowKey={(r) => r.id}
              empty="No payments in this period."
              columns={[
                { key: 'date', header: 'Date', render: (r) => <span className="whitespace-nowrap">{fmtDateTime(r.paidAt ?? r.createdAt)}</span> },
                { key: 'plan', header: 'Plan', render: (r) => (r.plan ? `${r.plan}${r.months ? ` · ${r.months} mo` : ''}` : '—') },
                { key: 'status', header: 'Status', render: (r) => <Badge tone={PAYMENT_TONE[r.status] ?? 'neutral'}>{r.status.toLowerCase()}</Badge> },
                { key: 'coupon', header: 'Coupon', render: (r) => (r.couponCode ? `${r.couponCode} (−${inr(r.discountInr)})` : '—') },
                { key: 'amount', header: 'Amount', align: 'right', className: 'tabular-nums font-semibold', render: (r) => inr(r.amountInr) },
              ]}
            />
          </Section>

          <Section title="Database storage" description="Approximate space this professional's rows take, by table (live, not for the selected period).">
            <DataTable<{ table: string; rows: number; bytes: number }>
              rows={data.storage}
              rowKey={(r) => r.table}
              empty="No stored data."
              columns={[
                { key: 'table', header: 'Table', render: (r) => r.table },
                { key: 'rows', header: 'Rows', align: 'right', className: 'tabular-nums', render: (r) => num(r.rows) },
                { key: 'bytes', header: 'Size', align: 'right', className: 'tabular-nums', render: (r) => fmtBytes(r.bytes) },
              ]}
            />
          </Section>
        </>
      ) : !loading ? (
        <EmptyState title="Nothing to show" />
      ) : null}
    </AdminPage>
  );
}
