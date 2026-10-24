'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { AdminPage, Badge, Btn, Card, Checkbox, ErrorBanner, Field, Input, KV, Section, Spinner, useAdminQuery } from '@/components/admin/kit';
import { toast } from '@/components/practice/ui';
import { adminFetch, fmtDateTime } from '@/lib/adminApi';

type Value = string | number | boolean;
interface SettingRow {
  key: string;
  value: Value;
  default: Value;
  isDefault: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}
interface Integrations {
  cashfree: { configured: boolean; mode: string | null };
  whatsapp: { bot: boolean; cloudApi: boolean; twilio: boolean };
  smtp: { configured: boolean };
  livekit: { configured: boolean };
  transcription: { configured: boolean };
  cron: { configured: boolean };
}

// Labels and grouping for each setting key (keys come from backend lib/settings.ts).
const GROUPS: { title: string; description: string; fields: { key: string; label: string; hint?: string; unit?: string }[] }[] = [
  {
    title: 'Features',
    description: 'Turn platform features on or off for everyone.',
    fields: [
      { key: 'features.aiInsights', label: 'AI insights during sessions' },
      { key: 'features.transcription', label: 'Live transcription', hint: 'When off, new transcription connections are refused.' },
      { key: 'features.whatsapp', label: 'WhatsApp messages' },
    ],
  },
  {
    title: 'Billing',
    description: 'How professionals get a paid plan.',
    fields: [
      {
        key: 'billing.approvalBeforePayment',
        label: 'Admin approves plans before payment',
        hint: 'On: professionals request a plan (with any coupon), you approve it on Subscriptions, then they pay. Off: they pay straight away. A ₹0 total never goes to Cashfree.',
      },
    ],
  },
  {
    title: 'Data retention',
    description: 'How long session data is kept.',
    fields: [{ key: 'retention.transcriptHours', label: 'Delete live transcripts after', unit: 'hours', hint: 'The cleanup job runs once a day, so data may live up to a day longer.' }],
  },
  {
    title: 'Support contact',
    description: 'Shown to professionals and clients who need help.',
    fields: [{ key: 'support.email', label: 'Support email' }],
  },
  {
    title: 'Usage cost estimates',
    description: 'Used by the Usage page to estimate spend. These do not change billing.',
    fields: [
      { key: 'costs.aiAnalysisInr', label: 'Cost per AI analysis', unit: '₹' },
      { key: 'costs.transcriptionMinuteInr', label: 'Cost per transcription minute', unit: '₹' },
      { key: 'costs.aiReportInr', label: 'Cost per AI session report', unit: '₹' },
      { key: 'costs.videoMinuteInr', label: 'Cost per video session minute', unit: '₹', hint: 'For the whole call, all participants together.' },
      { key: 'costs.whatsappMessageInr', label: 'Cost per WhatsApp message sent', unit: '₹' },
      { key: 'usage.alertMonthlyAnalyses', label: 'Flag professionals above', unit: 'AI analyses / month' },
    ],
  },
  {
    title: 'Hosting & database',
    description: 'Fixed monthly bills and plan limits, shown on the Usage page.',
    fields: [
      { key: 'costs.hostingMonthlyInr', label: 'Server hosting per month', unit: '₹' },
      { key: 'costs.databaseMonthlyInr', label: 'Databases per month', unit: '₹', hint: 'Both Neon databases together.' },
      { key: 'limits.appDbMb', label: 'App database storage limit', unit: 'MB' },
      { key: 'limits.hipaaDbMb', label: 'HIPAA database storage limit', unit: 'MB' },
    ],
  },
];

export default function AdminSettingsPage() {
  const { data, loading, error, reload } = useAdminQuery<{ settings: SettingRow[]; integrations: Integrations }>('/api/admin/settings');
  const [form, setForm] = useState<Record<string, Value>>({});
  const [saving, setSaving] = useState(false);

  const byKey = useMemo(() => new Map((data?.settings ?? []).map((s) => [s.key, s])), [data]);
  useEffect(() => {
    if (data) setForm(Object.fromEntries(data.settings.map((s) => [s.key, s.value])));
  }, [data]);

  const dirty = (data?.settings ?? []).filter((s) => String(form[s.key]) !== String(s.value));

  const save = async () => {
    const body: Record<string, Value> = {};
    for (const s of dirty) {
      const v = form[s.key];
      if (typeof s.default === 'number') {
        const n = Number(v);
        if (v === '' || !Number.isFinite(n) || n < 0) {
          toast(`Enter a number of 0 or more for “${labelOf(s.key)}”.`, 'error');
          return;
        }
        body[s.key] = n;
      } else body[s.key] = v;
    }
    setSaving(true);
    try {
      await adminFetch('/api/admin/settings', { method: 'PATCH', json: body });
      toast('Settings saved');
      reload();
    } catch (e: any) {
      toast(e.message || 'Could not save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminPage
      title="Settings"
      description="Feature switches, data retention, support contact and usage estimates."
      permission="settings"
      actions={
        <Btn icon={<Save className="h-4 w-4" />} onClick={save} loading={saving} disabled={!dirty.length}>
          {dirty.length ? `Save ${dirty.length} change${dirty.length === 1 ? '' : 's'}` : 'Saved'}
        </Btn>
      }
    >
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {GROUPS.map((g) => (
              <Section key={g.title} title={g.title} description={g.description}>
                <Card className="space-y-4">
                  {g.fields.map((f) => {
                    const s = byKey.get(f.key);
                    if (!s) return null;
                    const meta = s.updatedAt ? `Last changed ${fmtDateTime(s.updatedAt)}${s.updatedBy ? ` by ${s.updatedBy}` : ''}` : 'Using the default';
                    if (typeof s.default === 'boolean') {
                      return (
                        <div key={f.key} className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Checkbox checked={!!form[f.key]} onChange={(v) => setForm((x) => ({ ...x, [f.key]: v }))} label={<span className="font-semibold">{f.label}</span>} />
                            <Badge tone={form[f.key] ? 'good' : 'bad'}>{form[f.key] ? 'On' : 'Off'}</Badge>
                          </div>
                          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>{f.hint ? `${f.hint} ` : ''}{meta}</p>
                        </div>
                      );
                    }
                    return (
                      <Field key={f.key} label={f.unit ? `${f.label} (${f.unit})` : f.label} hint={`${f.hint ? `${f.hint} ` : ''}${meta}. Default: ${s.default}.`}>
                        <Input
                          type={typeof s.default === 'number' ? 'number' : f.key === 'support.email' ? 'email' : 'text'}
                          min={typeof s.default === 'number' ? 0 : undefined}
                          step="any"
                          value={String(form[f.key] ?? '')}
                          onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))}
                        />
                      </Field>
                    );
                  })}
                </Card>
              </Section>
            ))}
          </div>

          <Section title="Integrations" description="Read-only. Configured in the server environment; secrets are never shown here. See System health for live checks.">
            <Card>
              <KV
                items={[
                  { label: 'Payments (Cashfree)', value: <Configured ok={data.integrations.cashfree.configured} extra={data.integrations.cashfree.mode ? `${data.integrations.cashfree.mode} mode` : undefined} /> },
                  { label: 'WhatsApp bot', value: <Configured ok={data.integrations.whatsapp.bot} /> },
                  { label: 'WhatsApp Cloud API', value: <Configured ok={data.integrations.whatsapp.cloudApi} /> },
                  { label: 'Twilio', value: <Configured ok={data.integrations.whatsapp.twilio} /> },
                  { label: 'Email (SMTP)', value: <Configured ok={data.integrations.smtp.configured} /> },
                  { label: 'Video (LiveKit)', value: <Configured ok={data.integrations.livekit.configured} /> },
                  { label: 'Transcription relay token', value: <Configured ok={data.integrations.transcription.configured} /> },
                  { label: 'Cron secret', value: <Configured ok={data.integrations.cron.configured} /> },
                ]}
              />
            </Card>
          </Section>
        </>
      ) : null}
    </AdminPage>
  );
}

function Configured({ ok, extra }: { ok: boolean; extra?: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={ok ? 'good' : 'neutral'}>{ok ? 'Configured' : 'Not configured'}</Badge>
      {extra && <Badge tone={extra.startsWith('production') ? 'info' : 'warn'}>{extra}</Badge>}
    </span>
  );
}

function labelOf(key: string) {
  for (const g of GROUPS) for (const f of g.fields) if (f.key === key) return f.label;
  return key;
}
