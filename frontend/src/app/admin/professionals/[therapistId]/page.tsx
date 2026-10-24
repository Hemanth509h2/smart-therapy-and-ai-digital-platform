'use client';

import React, { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Activity, Clock, Eye, Gauge, Gift, Mail, Sparkles, Trash2, UserX, UserCheck, Users } from 'lucide-react';
import {
  AdminPage,
  Badge,
  Btn,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  KV,
  Modal,
  Pagination,
  Section,
  Select,
  Spinner,
  StatCard,
  Tabs,
  Textarea,
  useAdmin,
  useAdminQuery,
  type Column,
  type Tone,
} from '@/components/admin/kit';
import { ChartCard } from '@/components/admin/charts';
import { adminFetch, fmtDate, fmtDateTime, fmtMinutes, num, timeAgo } from '@/lib/adminApi';
import { caughtErrorMessage } from '@/lib/apiError';
import { MODULE_CATEGORIES, moduleName } from '@/lib/modules';
import { toast } from '@/components/practice/ui';
import { RemoveProfessionalDialog } from '@/components/admin/RemoveProfessionalDialog';

interface Detail {
  therapist: {
    id: string;
    userId: string;
    name: string;
    email: string;
    specialty: string[];
    qualification: string | null;
    experience: string | null;
    bio: string | null;
    joinedAt: string;
    status: 'ACTIVE' | 'SUSPENDED';
    suspendedAt: string | null;
    suspendReason: string | null;
    lastSeenAt: string | null;
    access: { allModulesAllowed: boolean; moduleAccess: string[]; allowedCount: number; totalModules: number };
  };
  stats: {
    clients: number;
    sessions: { total: number; active: number; completed: number; scheduled: number };
    totalMinutes: number;
    invites: { pending: number; claimed: number };
    documents: number;
    ai: { analyses: number; transcriptLines: number; moduleLaunches: number };
    topModules: { id: string; count: number }[];
    lastActive: string | null;
  };
  clients: { id: string; name: string; sessions: number; lastSession: string | null }[];
  billing: {
    current: { planName: string; status: string; currentPeriodEnd: string; toolQuota: number | null; moduleAccess: string[] } | null;
    history: SubRow[];
    pendingRequest: { id: string; planName: string; months: number; modules: string[]; toolQuota: number | null; note: string | null; createdAt: string } | null;
  };
  usageDaily: Record<UsageType, { date: string; count: number }[]>;
  sessions: SessionRow[];
}

interface SubRow {
  id: string;
  planName: string;
  status: string;
  months: number;
  startedAt: string;
  currentPeriodEnd: string;
  renewalCount: number;
  moduleAccess: string[];
  toolQuota: number | null;
}

interface SessionRow {
  id: string;
  status: string;
  scheduledAt: string;
  durationMinutes: number | null;
  client: { id: string; name: string } | null;
}

interface PhiClient {
  id: string;
  name: string;
  dateOfBirth: string;
  gender: string | null;
  diagnosis: string[];
  parentEmail: string | null;
  phoneNumber: string | null;
  email: string | null;
}

interface AuditEntry {
  id: string;
  action: string;
  actorEmail: string | null;
  actorUid: string;
  createdAt: string;
  after: unknown;
}

type UsageType = 'AI_ANALYSIS' | 'TRANSCRIPTION' | 'MODULE_LAUNCH';
type Tab = 'overview' | 'clients' | 'sessions' | 'billing' | 'usage' | 'activity';

const SESSION_TONE: Record<string, Tone> = { ACTIVE: 'good', SCHEDULED: 'info', COMPLETED: 'neutral', CANCELLED: 'bad' };
const SUB_TONE: Record<string, Tone> = { ACTIVE: 'good', EXPIRED: 'neutral', CANCELLED: 'bad' };

export default function TherapistDetailPage() {
  const { therapistId } = useParams<{ therapistId: string }>();
  const { can } = useAdmin();
  const { data, loading, error, reload } = useAdminQuery<Detail>(`/api/admin/therapists/${therapistId}`, 'load this professional');
  const [tab, setTab] = useState<Tab>('overview');
  const [emailOpen, setEmailOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const router = useRouter();

  const t = data?.therapist;
  const suspended = t?.status === 'SUSPENDED';
  const canMessage = can('support') || can('people.write');

  const setStatus = async (reason: string) => {
    await adminFetch(`/api/admin/users/${t!.userId}/status`, {
      method: 'PATCH',
      json: { action: suspended ? 'reactivate' : 'suspend', reason },
      action: suspended ? 'reactivate this account' : 'suspend this account',
    });
    toast(suspended ? `${t!.name || 'The account'} was reactivated.` : `${t!.name || 'The account'} was suspended.`);
    reload();
  };

  return (
    <AdminPage
      permission="people.read"
      back={{ href: '/admin/professionals', label: 'Back to Professionals' }}
      title={
        t ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            {t.name || 'Unnamed'}
            <Badge tone={suspended ? 'bad' : 'good'}>{suspended ? 'Suspended' : 'Active'}</Badge>
          </span>
        ) : (
          'Professional'
        )
      }
      description={t?.email}
      actions={
        t && (
          <>
            <Btn variant="ghost" icon={<Gauge className="h-4 w-4" />} onClick={() => router.push(`/admin/usage/${therapistId}`)}>Usage & cost</Btn>
            {canMessage && (
              <Btn variant="ghost" icon={<Mail className="h-4 w-4" />} onClick={() => setEmailOpen(true)}>Email</Btn>
            )}
            {can('people.write') && (
              <Btn
                variant={suspended ? 'ghost' : 'danger'}
                icon={suspended ? <UserCheck className="h-4 w-4" /> : <UserX className="h-4 w-4" />}
                onClick={() => setStatusOpen(true)}
              >
                {suspended ? 'Reactivate' : 'Suspend'}
              </Btn>
            )}
            {can('admins.manage') && (
              <Btn variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => setRemoveOpen(true)}>Remove</Btn>
            )}
          </>
        )
      }
    >
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : data && t ? (
        <>
          {suspended && (
            <div className="rounded-xl px-4 py-3 text-sm font-medium" style={{ background: 'rgba(220,38,38,0.08)', color: '#dc2626', border: '1px solid rgba(220,38,38,0.2)' }}>
              Suspended {fmtDate(t.suspendedAt)}{t.suspendReason ? ` — ${t.suspendReason}` : ''}. They can&apos;t sign in.
            </div>
          )}
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'overview', label: 'Overview' },
              { value: 'clients', label: `Clients (${data.clients.length})` },
              { value: 'sessions', label: `Sessions (${data.sessions.length})` },
              { value: 'billing', label: 'Billing' },
              { value: 'usage', label: 'Usage' },
              { value: 'activity', label: 'Activity' },
            ]}
          />
          {tab === 'overview' && <Overview data={data} />}
          {tab === 'clients' && <ClientsTab therapistId={t.id} clients={data.clients} />}
          {tab === 'sessions' && <SessionsTab sessions={data.sessions} />}
          {tab === 'billing' && <BillingTab therapistId={t.id} billing={data.billing} onChanged={reload} />}
          {tab === 'usage' && <UsageTab usage={data.usageDaily} />}
          {tab === 'activity' && <ActivityTab therapistId={t.id} />}

          <EmailModal open={emailOpen} onClose={() => setEmailOpen(false)} therapistId={t.id} email={t.email} />
          <ConfirmDialog
            open={statusOpen}
            onClose={() => setStatusOpen(false)}
            title={suspended ? 'Reactivate account?' : 'Suspend account?'}
            body={
              suspended
                ? `${t.name} will be able to sign in again.`
                : `${t.name} will be signed out and blocked from the app until reactivated. Their data is kept.`
            }
            confirmLabel={suspended ? 'Reactivate' : 'Suspend'}
            danger={!suspended}
            reasonLabel={suspended ? undefined : 'Reason (shown in the audit log)'}
            onConfirm={setStatus}
          />
          <RemoveProfessionalDialog
            target={removeOpen ? { userId: t.userId, name: t.name, email: t.email, clients: data.clients.length } : null}
            onClose={() => setRemoveOpen(false)}
            onRemoved={() => router.push('/admin/professionals')}
          />
        </>
      ) : !loading ? (
        <EmptyState title={error ? 'Nothing to show' : 'Professional not found'} />
      ) : null}
    </AdminPage>
  );
}

// ─── Overview ────────────────────────────────────────────────────────────────

function Overview({ data }: { data: Detail }) {
  const { therapist: t, stats } = data;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Clients" value={num(stats.clients)} hint={`${num(stats.invites.pending)} invites pending`} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Sessions" value={num(stats.sessions.total)} hint={`${num(stats.sessions.completed)} completed · ${num(stats.sessions.scheduled)} scheduled`} icon={<Activity className="h-4 w-4" />} />
        <StatCard label="Session time" value={fmtMinutes(stats.totalMinutes)} icon={<Clock className="h-4 w-4" />} />
        <StatCard label="AI analyses" value={num(stats.ai.analyses)} hint={`${num(stats.ai.moduleLaunches)} module launches`} icon={<Sparkles className="h-4 w-4" />} />
      </div>
      <Card>
        <KV
          items={[
            { label: 'Email', value: t.email || '—' },
            { label: 'Joined', value: fmtDate(t.joinedAt) },
            { label: 'Last seen', value: timeAgo(t.lastSeenAt) },
            { label: 'Last session activity', value: timeAgo(stats.lastActive) },
            { label: 'Qualification', value: t.qualification || '—' },
            { label: 'Experience', value: t.experience ? `${t.experience} yrs` : '—' },
            { label: 'Specialties', value: t.specialty?.length ? t.specialty.join(', ') : '—' },
            {
              label: 'Module access',
              value: t.access.allModulesAllowed ? 'All modules' : `${t.access.allowedCount} of ${t.access.totalModules} modules`,
            },
            { label: 'Documents uploaded', value: num(stats.documents) },
            { label: 'Transcript lines', value: num(stats.ai.transcriptLines) },
            { label: 'Invites claimed', value: num(stats.invites.claimed) },
          ]}
        />
        {t.bio && <p className="mt-4 text-sm" style={{ color: 'var(--ink-muted)' }}>{t.bio}</p>}
      </Card>
      {stats.topModules.length > 0 && (
        <ChartCard
          title="Module launches by module"
          subtitle="All time"
          kind="bar"
          horizontal
          data={stats.topModules.slice(0, 10).map((m) => ({ label: moduleName(m.id), value: m.count }))}
          height={Math.max(140, Math.min(10, stats.topModules.length) * 36)}
        />
      )}
    </div>
  );
}

// ─── Clients ─────────────────────────────────────────────────────────────────

function ClientsTab({ therapistId, clients }: { therapistId: string; clients: Detail['clients'] }) {
  const { can } = useAdmin();
  const [phi, setPhi] = useState<Map<string, PhiClient> | null>(null);
  const [revealing, setRevealing] = useState(false);

  const reveal = async () => {
    setRevealing(true);
    try {
      const d = await adminFetch<{ clients: PhiClient[] }>(`/api/admin/therapists/${therapistId}/phi`, {
        action: 'reveal client details',
      });
      setPhi(new Map(d.clients.map((c) => [c.id, c])));
    } catch (e) {
      toast(caughtErrorMessage(e, 'reveal client details'), 'error');
    } finally {
      setRevealing(false);
    }
  };

  const columns: Column<Detail['clients'][number]>[] = [
    {
      key: 'name',
      header: 'Client',
      render: (c) => (
        <Link href={`/admin/clients/${c.id}`} className="font-semibold hover:underline">
          {phi?.get(c.id)?.name ?? c.name}
        </Link>
      ),
    },
    { key: 'sessions', header: 'Sessions', align: 'right', render: (c) => num(c.sessions) },
    { key: 'last', header: 'Last session', render: (c) => fmtDate(c.lastSession) },
    ...(phi
      ? ([
          { key: 'dob', header: 'Date of birth', render: (c) => fmtDate(phi.get(c.id)?.dateOfBirth) },
          { key: 'gender', header: 'Gender', render: (c) => phi.get(c.id)?.gender || '—' },
          {
            key: 'dx',
            header: 'Diagnosis',
            render: (c) => (
              <div className="flex flex-wrap gap-1">
                {(phi.get(c.id)?.diagnosis || []).map((d) => <Badge key={d} tone="info">{d}</Badge>)}
              </div>
            ),
          },
          {
            key: 'contact',
            header: 'Contact',
            render: (c) => {
              const p = phi.get(c.id);
              return <span className="text-xs">{[p?.email, p?.parentEmail, p?.phoneNumber].filter(Boolean).join(' · ') || '—'}</span>;
            },
          },
        ] as Column<Detail['clients'][number]>[])
      : []),
  ];

  return (
    <Section
      title="Clients"
      description={phi ? 'Showing full client details. This view was recorded in the audit log.' : 'Names are shown as initials. Clinical details are hidden.'}
      actions={
        can('phi.read') &&
        (phi ? (
          <Btn variant="ghost" size="sm" onClick={() => setPhi(null)}>Hide details</Btn>
        ) : (
          <Btn variant="ghost" size="sm" icon={<Eye className="h-3.5 w-3.5" />} loading={revealing} onClick={reveal} title="Each reveal is logged">
            Reveal names (logged)
          </Btn>
        ))
      }
    >
      <DataTable columns={columns} rows={clients} rowKey={(c) => c.id} empty="No clients yet." />
    </Section>
  );
}

// ─── Sessions ────────────────────────────────────────────────────────────────

function SessionsTab({ sessions }: { sessions: SessionRow[] }) {
  const [status, setStatus] = useState('');
  const rows = status ? sessions.filter((s) => s.status === status) : sessions;
  return (
    <Section
      title="Sessions"
      actions={
        <Select
          ariaLabel="Filter by status"
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'SCHEDULED', label: 'Scheduled' },
            { value: 'ACTIVE', label: 'Active' },
            { value: 'COMPLETED', label: 'Completed' },
            { value: 'CANCELLED', label: 'Cancelled' },
          ]}
        />
      }
    >
      <DataTable
        rowKey={(s) => s.id}
        rows={rows}
        empty="No sessions."
        columns={[
          { key: 'when', header: 'Scheduled', render: (s) => <span className="whitespace-nowrap">{fmtDateTime(s.scheduledAt)}</span> },
          { key: 'client', header: 'Client', render: (s) => (s.client ? <Link href={`/admin/clients/${s.client.id}`} className="hover:underline">{s.client.name}</Link> : '—') },
          { key: 'status', header: 'Status', render: (s) => <Badge tone={SESSION_TONE[s.status] ?? 'neutral'}>{s.status.toLowerCase()}</Badge> },
          { key: 'duration', header: 'Duration', align: 'right', render: (s) => (s.durationMinutes != null ? fmtMinutes(s.durationMinutes) : '—') },
        ]}
      />
    </Section>
  );
}

// ─── Billing ─────────────────────────────────────────────────────────────────

function BillingTab({ therapistId, billing, onChanged }: { therapistId: string; billing: Detail['billing']; onChanged: () => void }) {
  const { can } = useAdmin();
  const [grantOpen, setGrantOpen] = useState(false);
  const cur = billing.current;
  const pending = billing.pendingRequest;

  return (
    <div className="space-y-6">
      <Section
        title="Current plan"
        actions={can('billing.write') && <Btn size="sm" icon={<Gift className="h-3.5 w-3.5" />} onClick={() => setGrantOpen(true)}>Grant plan</Btn>}
      >
        <Card>
          {cur ? (
            <KV
              items={[
                { label: 'Plan', value: cur.planName },
                { label: 'Status', value: <Badge tone={SUB_TONE[cur.status] ?? 'neutral'}>{cur.status.toLowerCase()}</Badge> },
                { label: 'Renews / ends', value: fmtDate(cur.currentPeriodEnd) },
                {
                  label: 'Tools',
                  value: cur.toolQuota == null ? 'All tools' : cur.moduleAccess.map(moduleName).join(', ') || '—',
                },
              ]}
            />
          ) : (
            <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>Free tier — no active plan.</p>
          )}
        </Card>
      </Section>

      {pending && (
        <Section title="Pending request" actions={<Link href="/admin/subscriptions" className="text-sm font-semibold" style={{ color: 'var(--sage)' }}>Review in Subscriptions</Link>}>
          <Card>
            <KV
              items={[
                { label: 'Plan', value: pending.planName },
                { label: 'Months', value: pending.months },
                { label: 'Requested', value: fmtDateTime(pending.createdAt) },
                { label: 'Tools', value: pending.toolQuota == null ? 'All tools' : pending.modules.map(moduleName).join(', ') || '—' },
                ...(pending.note ? [{ label: 'Note', value: pending.note }] : []),
              ]}
            />
          </Card>
        </Section>
      )}

      <Section title="Plan history">
        <DataTable
          rowKey={(s) => s.id}
          rows={billing.history}
          empty="No plans yet."
          columns={[
            { key: 'plan', header: 'Plan', render: (s) => <span className="font-semibold">{s.planName}</span> },
            { key: 'status', header: 'Status', render: (s) => <Badge tone={SUB_TONE[s.status] ?? 'neutral'}>{s.status.toLowerCase()}</Badge> },
            { key: 'months', header: 'Months', align: 'right', render: (s) => s.months },
            { key: 'start', header: 'Started', render: (s) => fmtDate(s.startedAt) },
            { key: 'end', header: 'Ends', render: (s) => fmtDate(s.currentPeriodEnd) },
            { key: 'renewals', header: 'Renewals', align: 'right', render: (s) => s.renewalCount },
          ]}
        />
      </Section>

      {can('billing.write') && (
        <GrantModal open={grantOpen} onClose={() => setGrantOpen(false)} therapistId={therapistId} onGranted={onChanged} />
      )}
    </div>
  );
}

interface Plan {
  id: string;
  name: string;
  durationMonths: number;
  toolQuota: number | null;
  isActive: boolean;
}

function GrantModal({ open, onClose, therapistId, onGranted }: { open: boolean; onClose: () => void; therapistId: string; onGranted: () => void }) {
  const { data, loading, error, reload } = useAdminQuery<{ plans: Plan[] }>(open ? '/api/admin/plans' : null, 'load the plans');
  const [planId, setPlanId] = useState('');
  const [months, setMonths] = useState('1');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const plans = data?.plans ?? [];
  const plan = plans.find((p) => p.id === planId);
  const quota = plan?.toolQuota ?? null;

  const pickPlan = (id: string) => {
    setPlanId(id);
    setSelected(new Set());
    const p = plans.find((x) => x.id === id);
    if (p) setMonths(String(p.durationMonths || 1));
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (quota == null || next.size < quota) next.add(id);
      return next;
    });

  const submit = async () => {
    setBusy(true);
    try {
      await adminFetch(`/api/admin/therapists/${therapistId}/grant`, {
        method: 'POST',
        json: { planId, months: Number(months), modules: Array.from(selected) },
        action: 'grant this plan',
      });
      toast(`${plan?.name ?? 'The plan'} was granted for ${months} month${months === '1' ? '' : 's'}.`);
      onGranted();
      onClose();
    } catch (e) {
      toast(caughtErrorMessage(e, 'grant this plan'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const m = Number(months);
  const valid = !!plan && Number.isInteger(m) && m >= 1 && m <= 36 && (quota == null || selected.size > 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Grant plan"
      description="Starts a new term now, without payment. Any active term is ended."
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={submit} loading={busy} disabled={!valid}>Grant</Btn>
        </>
      }
    >
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Plan">
              <Select
                ariaLabel="Plan"
                className="w-full"
                value={planId}
                onChange={pickPlan}
                options={[
                  { value: '', label: 'Choose a plan…' },
                  ...plans.map((p) => ({ value: p.id, label: `${p.name}${p.isActive ? '' : ' (inactive)'}${p.toolQuota == null ? ' · all tools' : ` · ${p.toolQuota} tools`}` })),
                ]}
              />
            </Field>
            <Field label="Months" hint="1 to 36">
              <Input type="number" min={1} max={36} value={months} onChange={(e) => setMonths(e.target.value)} />
            </Field>
          </div>
          {plan && quota == null && (
            <p className="rounded-lg p-3 text-sm font-medium" style={{ background: 'var(--sage-light)', color: 'var(--ink)' }}>
              Unlimited plan — grants access to all tools.
            </p>
          )}
          {plan && quota != null && (
            <div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold" style={{ color: 'var(--ink-muted)' }}>Tools to grant</span>
                <span className="text-xs font-semibold" style={{ color: 'var(--ink-muted)' }}>{selected.size} / {quota}</span>
              </div>
              <div className="mt-2 space-y-4">
                {MODULE_CATEGORIES.map((cat) => (
                  <div key={cat.id}>
                    <p className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>{cat.emoji} {cat.name}</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {cat.modules.map((mod) => {
                        const checked = selected.has(mod.id);
                        const full = !checked && selected.size >= quota;
                        return (
                          <label
                            key={mod.id}
                            className="flex items-center gap-2 rounded-lg p-2"
                            style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', cursor: full ? 'not-allowed' : 'pointer', opacity: full ? 0.45 : 1 }}
                          >
                            <input type="checkbox" checked={checked} disabled={full} onChange={() => toggle(mod.id)} style={{ accentColor: 'var(--sage)', width: 15, height: 15 }} />
                            <span className="text-sm" style={{ color: 'var(--ink)' }}>{mod.emoji} {mod.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

// ─── Usage ───────────────────────────────────────────────────────────────────

const USAGE_CHARTS: { type: UsageType; title: string }[] = [
  { type: 'AI_ANALYSIS', title: 'AI analyses per day' },
  { type: 'TRANSCRIPTION', title: 'Transcript lines per day' },
  { type: 'MODULE_LAUNCH', title: 'Module launches per day' },
];

function UsageTab({ usage }: { usage: Detail['usageDaily'] }) {
  const series = useMemo(
    () =>
      USAGE_CHARTS.map((c) => ({
        ...c,
        data: (usage[c.type] || []).map((d) => ({
          label: new Date(`${d.date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
          value: d.count,
        })),
      })),
    [usage]
  );
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {series.map((s) => {
        const total = s.data.reduce((n, p) => n + p.value, 0);
        return <ChartCard key={s.type} title={s.title} subtitle={`Last 90 days · ${num(total)} total`} kind="bar" data={s.data} />;
      })}
    </div>
  );
}

// ─── Activity ────────────────────────────────────────────────────────────────

function ActivityTab({ therapistId }: { therapistId: string }) {
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const { data, loading, error, reload } = useAdminQuery<{ entries: AuditEntry[]; total: number }>(
    `/api/admin/therapists/${therapistId}/activity?page=${page}&pageSize=${pageSize}`,
    'load the admin activity'
  );
  return (
    <Section title="Admin activity" description="Admin actions taken on this account, newest first.">
      {error && <ErrorBanner message={error} onRetry={reload} />}
      <DataTable
        loading={loading}
        rowKey={(e) => e.id}
        rows={data?.entries ?? []}
        empty="No admin actions recorded for this account."
        columns={[
          { key: 'when', header: 'When', render: (e) => <span className="whitespace-nowrap" title={fmtDateTime(e.createdAt)}>{timeAgo(e.createdAt)}</span> },
          { key: 'action', header: 'Action', render: (e) => <Badge tone={e.action === 'phi.reveal' ? 'warn' : 'info'}>{e.action}</Badge> },
          { key: 'actor', header: 'By', render: (e) => e.actorEmail || e.actorUid },
          { key: 'detail', header: 'Detail', render: (e) => <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>{summarize(e.after)}</span> },
        ]}
      />
      <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />
    </Section>
  );
}

function summarize(v: unknown) {
  if (!v || typeof v !== 'object') return '—';
  const parts = Object.entries(v as Record<string, unknown>)
    .filter(([k]) => k !== 'clientIds')
    .map(([k, val]) => `${k}: ${Array.isArray(val) ? val.length : typeof val === 'object' ? '…' : String(val)}`);
  return parts.join(' · ').slice(0, 140) || '—';
}

// ─── Email ───────────────────────────────────────────────────────────────────

function EmailModal({ open, onClose, therapistId, email }: { open: boolean; onClose: () => void; therapistId: string; email: string }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      await adminFetch(`/api/admin/therapists/${therapistId}/message`, {
        method: 'POST',
        json: { subject, body },
        action: 'send the email',
      });
      toast(`Email sent to ${email}.`);
      setSubject('');
      setBody('');
      onClose();
    } catch (e) {
      toast(caughtErrorMessage(e, 'send the email'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Email professional"
      description={`Sends from the STAAD address to ${email}.`}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={send} loading={busy} disabled={!subject.trim() || !body.trim()}>Send</Btn>
        </>
      }
    >
      <Field label="Subject">
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
      </Field>
      <Field label="Message">
        <Textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
    </Modal>
  );
}
