'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Blocks, Brain, IndianRupee, Mic } from 'lucide-react';
import { AdminPage, Badge, Card, DataTable, ErrorBanner, Section, Select, Spinner, StatCard, useAdminQuery } from '@/components/admin/kit';
import { ChartCard, type Point } from '@/components/admin/charts';
import { inr, num } from '@/lib/adminApi';

interface TherapistUsage {
  therapistId: string;
  name: string;
  email: string | null;
  aiAnalyses: number;
  transcriptSegments: number;
  transcriptionMinutes: number;
  moduleLaunches: number;
  estCostInr: number;
}

interface Usage {
  range: { days: number };
  rates: { aiAnalysisInr: number; transcriptionMinuteInr: number };
  totals: {
    aiAnalyses: number;
    transcriptSegments: number;
    transcriptionMinutes: number;
    moduleLaunches: number;
    estCostInr: number;
    aiCostInr: number;
    transcriptionCostInr: number;
  };
  series: Record<'AI_ANALYSIS' | 'TRANSCRIPTION' | 'MODULE_LAUNCH', Point[]>;
  topTherapists: TherapistUsage[];
  topModules: { moduleId: string; name: string; launches: number }[];
  neverLaunched: { moduleId: string; name: string }[];
  notLaunchedInRange: { moduleId: string; name: string }[];
  alerts: { threshold: number; therapists: { therapistId: string; name: string; email: string | null; aiAnalyses: number }[] };
}

const RANGES = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

export default function AdminUsagePage() {
  const [range, setRange] = useState('30d');
  const { data, loading, error, reload } = useAdminQuery<Usage>(`/api/admin/usage?range=${range}`);
  const rangeLabel = RANGES.find((r) => r.value === range)?.label ?? '';

  return (
    <AdminPage
      title="Usage & AI cost"
      description="AI analyses, transcription and module launches, with estimated cost."
      permission="people.read"
      actions={<Select ariaLabel="Date range" value={range} onChange={setRange} options={RANGES} />}
    >
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Estimated cost" value={inr(data.totals.estCostInr)} hint={rangeLabel} icon={<IndianRupee className="h-4 w-4" />} />
            <StatCard label="AI analyses" value={num(data.totals.aiAnalyses)} hint={`${inr(data.totals.aiCostInr)} at ${inr(data.rates.aiAnalysisInr)} each`} icon={<Brain className="h-4 w-4" />} />
            <StatCard
              label="Transcription"
              value={`${num(data.totals.transcriptionMinutes)} min`}
              hint={`${inr(data.totals.transcriptionCostInr)} at ${inr(data.rates.transcriptionMinuteInr)}/min`}
              icon={<Mic className="h-4 w-4" />}
            />
            <StatCard label="Module launches" value={num(data.totals.moduleLaunches)} hint={rangeLabel} icon={<Blocks className="h-4 w-4" />} />
          </div>
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            Costs are estimates from the rates in Settings. Transcription minutes are the length of sessions that were transcribed;
            the chart below counts transcript segments (spoken lines saved).
          </p>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <ChartCard title="AI analyses per day" subtitle={rangeLabel} data={data.series.AI_ANALYSIS} kind="bar" />
            <ChartCard title="Transcript segments per day" subtitle={rangeLabel} data={data.series.TRANSCRIPTION} kind="bar" />
            <ChartCard title="Module launches per day" subtitle={rangeLabel} data={data.series.MODULE_LAUNCH} kind="bar" />
          </div>

          {data.alerts.therapists.length > 0 && (
            <Section title="Heavy users this month" description={`More than ${num(data.alerts.threshold)} AI analyses since the 1st. Change the threshold in Settings.`}>
              <Card className="space-y-2">
                {data.alerts.therapists.map((t) => (
                  <Link key={t.therapistId} href={`/admin/professionals/${t.therapistId}`} className="flex flex-wrap items-center gap-3 rounded-lg px-1 py-1.5 text-sm hover:bg-[var(--sage-light)]">
                    <AlertTriangle className="h-4 w-4" style={{ color: '#b45309' }} />
                    <span className="font-semibold" style={{ color: 'var(--ink)' }}>{t.name}</span>
                    <span style={{ color: 'var(--ink-muted)' }}>{t.email}</span>
                    <span className="flex-1" />
                    <Badge tone="warn">{num(t.aiAnalyses)} analyses</Badge>
                  </Link>
                ))}
              </Card>
            </Section>
          )}

          <Section title="Top professionals" description={`By estimated cost, ${rangeLabel.toLowerCase()}`}>
            <DataTable<TherapistUsage>
              rows={data.topTherapists}
              rowKey={(r) => r.therapistId}
              empty="No usage in this period."
              columns={[
                {
                  key: 'name',
                  header: 'Professional',
                  render: (r) => (
                    <Link href={`/admin/professionals/${r.therapistId}`} className="block min-w-[160px]">
                      <div className="font-semibold">{r.name}</div>
                      <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>{r.email}</div>
                    </Link>
                  ),
                },
                { key: 'ai', header: 'AI analyses', align: 'right', render: (r) => num(r.aiAnalyses) },
                { key: 'min', header: 'Transcribed', align: 'right', render: (r) => `${num(r.transcriptionMinutes)} min` },
                { key: 'mod', header: 'Launches', align: 'right', render: (r) => num(r.moduleLaunches) },
                { key: 'cost', header: 'Est. cost', align: 'right', render: (r) => inr(r.estCostInr) },
              ]}
            />
          </Section>

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
