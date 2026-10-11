'use client';

import React, { useEffect, useState } from 'react';
import { Check, Download, Inbox, RefreshCw, X } from 'lucide-react';
import {
  AdminPage, Badge, Btn, Card, ConfirmDialog, DataTable, EmptyState, ErrorBanner, Field, Modal, Pagination,
  SearchInput, Section, Select, Spinner, Toolbar, useAdmin, useAdminQuery, useListState, type Column, type Tone,
} from '@/components/admin/kit';
import { adminFetch, downloadCsv, fetchAllPages, fmtDate, fmtDateTime } from '@/lib/adminApi';
import { MODULE_CATEGORIES, moduleName } from '@/lib/modules';
import { toast } from '@/components/practice/ui';

interface Term {
  id: string;
  planId: string;
  planName: string;
  status: string;
  months: number;
  startedAt: string;
  currentPeriodEnd: string;
  renewed: boolean;
  renewalCount: number;
  toolQuota: number | null;
}
type State = 'active' | 'expiring' | 'expired' | 'cancelled' | 'none';
interface Professional {
  therapistId: string;
  name: string;
  email: string;
  current: Term | null;
  latest: Term | null;
  state: State;
  daysLeft: number | null;
  termCount: number;
}
interface PlanRequest {
  id: string;
  therapistId: string;
  therapistName: string;
  email: string;
  planName: string;
  toolQuota: number | null;
  months: number;
  modules: string[];
  note: string | null;
  createdAt: string;
}
interface History {
  therapist: { name: string; email: string; state: State; allModulesAllowed: boolean; moduleAccess: string[] };
  terms: (Term & { current: boolean })[];
  events: { at: string; kind: string; title: string; detail?: string; refId: string }[];
}

const MONTH_OPTIONS = [1, 3, 6, 12].map((m) => ({ value: String(m), label: `${m} month${m === 1 ? '' : 's'}` }));

const STATE_BADGE: Record<State, { tone: Tone; label: string }> = {
  active: { tone: 'good', label: 'Active' },
  expiring: { tone: 'warn', label: 'Expiring soon' },
  expired: { tone: 'bad', label: 'Expired' },
  cancelled: { tone: 'bad', label: 'Cancelled' },
  none: { tone: 'neutral', label: 'None' },
};

const StateBadge = ({ state, daysLeft }: { state: State; daysLeft?: number | null }) => (
  <Badge tone={STATE_BADGE[state].tone} title={daysLeft != null ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : undefined}>
    {STATE_BADGE[state].label}
  </Badge>
);

const endsIn = (days: number | null) =>
  days == null ? '' : days < 0 ? 'ended' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;

export default function AdminSubscriptionsPage() {
  const { can } = useAdmin();
  const canWrite = can('billing.write');
  const list = useListState({ sort: 'joined', dir: 'asc', filters: { status: '', planId: '' } });
  const { data, loading, error, reload } = useAdminQuery<{ professionals: Professional[]; total: number; requests: PlanRequest[] }>(
    `/api/admin/subscriptions?${list.query}`
  );
  const { data: planData } = useAdminQuery<{ plans: { id: string; name: string }[] }>('/api/admin/plans');

  const [approving, setApproving] = useState<PlanRequest | null>(null);
  const [rejecting, setRejecting] = useState<PlanRequest | null>(null);
  const [renewing, setRenewing] = useState<{ pro: Professional; term: Term } | null>(null);
  const [cancelling, setCancelling] = useState<{ pro: Professional; term: Term } | null>(null);
  const [historyFor, setHistoryFor] = useState<Professional | null>(null);
  const [busy, setBusy] = useState('');
  const [exporting, setExporting] = useState(false);

  const requests = data?.requests ?? [];
  const pros = data?.professionals ?? [];

  const reactivate = async (term: Term) => {
    setBusy(term.id);
    try {
      await adminFetch(`/api/admin/subscriptions/${term.id}`, { method: 'PATCH', json: { action: 'reactivate' } });
      toast('Term reactivated');
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params: Record<string, string> = { sort: list.sort, dir: list.dir };
      if (list.q) params.q = list.q;
      for (const [k, v] of Object.entries(list.filters)) if (v) params[k] = v;
      const rows = await fetchAllPages<Professional>('/api/admin/subscriptions', 'professionals', params);
      downloadCsv(`subscriptions-${new Date().toISOString().slice(0, 10)}`, rows, [
        { header: 'Name', value: (r) => r.name },
        { header: 'Email', value: (r) => r.email },
        { header: 'Status', value: (r) => STATE_BADGE[r.state].label },
        { header: 'Plan', value: (r) => (r.current ?? r.latest)?.planName ?? '' },
        { header: 'Term (months)', value: (r) => (r.current ?? r.latest)?.months ?? '' },
        { header: 'Started', value: (r) => (r.current ?? r.latest)?.startedAt ?? '' },
        { header: 'Ends', value: (r) => (r.current ?? r.latest)?.currentPeriodEnd ?? '' },
        { header: 'Days left', value: (r) => r.daysLeft ?? '' },
        { header: 'Renewals', value: (r) => (r.current ?? r.latest)?.renewalCount ?? '' },
        { header: 'Terms on record', value: (r) => r.termCount },
      ]);
    } catch (e: any) {
      toast(e.message || 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<Professional>[] = [
    {
      key: 'name',
      header: 'Professional',
      sortKey: 'name',
      render: (p) => (
        <div className="min-w-0">
          <div className="font-semibold">{p.name || 'Unnamed'}</div>
          <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>{p.email}</div>
        </div>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      render: (p) =>
        p.current ? (
          <span className="font-semibold">{p.current.planName}</span>
        ) : p.latest ? (
          <span style={{ color: 'var(--ink-muted)' }}>Free tier <span className="text-xs">(was {p.latest.planName})</span></span>
        ) : (
          <span style={{ color: 'var(--ink-muted)' }}>Free tier</span>
        ),
    },
    { key: 'status', header: 'Status', render: (p) => <StateBadge state={p.state} daysLeft={p.daysLeft} /> },
    {
      key: 'term',
      header: 'Term',
      className: 'whitespace-nowrap',
      render: (p) => {
        const t = p.current ?? p.latest;
        return t ? (
          <span>{t.months} mo <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>· from {fmtDate(t.startedAt)}</span></span>
        ) : '—';
      },
    },
    {
      key: 'ends',
      header: 'Ends',
      sortKey: 'ends',
      className: 'whitespace-nowrap',
      render: (p) => {
        const t = p.current ?? p.latest;
        if (!t) return '—';
        return (
          <div>
            <div>{fmtDate(t.currentPeriodEnd)}</div>
            {p.current && <div className="text-xs" style={{ color: p.state === 'expiring' ? '#b45309' : 'var(--ink-muted)' }}>{endsIn(p.daysLeft)}</div>}
          </div>
        );
      },
    },
    {
      key: 'renewals',
      header: 'Renewals',
      align: 'right',
      render: (p) => {
        const t = p.current ?? p.latest;
        return t ? t.renewalCount : '—';
      },
    },
  ];

  if (canWrite) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      className: 'whitespace-nowrap',
      render: (p) => {
        const t = p.current ?? p.latest;
        if (!t) return null;
        const canReactivate = !p.current && t.status === 'CANCELLED' && new Date(t.currentPeriodEnd).getTime() > Date.now();
        return (
          <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
            <Btn size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => setRenewing({ pro: p, term: t })}>Renew</Btn>
            {canReactivate && (
              <Btn size="sm" variant="ghost" loading={busy === t.id} onClick={() => reactivate(t)}>Reactivate</Btn>
            )}
            {p.current && (
              <Btn size="sm" variant="danger" onClick={() => setCancelling({ pro: p, term: p.current! })}>Cancel</Btn>
            )}
          </div>
        );
      },
    });
  }

  const planOptions = [{ value: '', label: 'All plans' }, ...(planData?.plans ?? []).map((p) => ({ value: p.id, label: p.name }))];

  return (
    <AdminPage
      title="Subscriptions"
      description="Approve plan requests and track each professional's plan, term, and renewals."
      permission="billing.read"
      actions={<Btn variant="ghost" icon={<Download className="h-4 w-4" />} loading={exporting} onClick={exportCsv}>Export CSV</Btn>}
    >
      {error && <ErrorBanner message={error} onRetry={reload} />}

      <Section
        title={<span className="inline-flex items-center gap-2"><Inbox className="h-5 w-5" /> Pending requests {requests.length > 0 && <Badge tone="info">{requests.length}</Badge>}</span>}
        description="Plans are requested by professionals and take effect when approved here."
      >
        {loading && !data ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : requests.length === 0 ? (
          <Card><p className="text-sm font-medium" style={{ color: 'var(--ink-muted)' }}>No pending requests.</p></Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {requests.map((r) => (
              <Card key={r.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{r.therapistName || 'Unnamed'}</p>
                    <p className="truncate text-xs" style={{ color: 'var(--ink-muted)' }}>{r.email}</p>
                  </div>
                  <Badge tone="info">{r.planName} · {r.months} mo</Badge>
                </div>
                <p className="mt-3 text-xs" style={{ color: 'var(--ink-muted)' }}>
                  Tools: {r.toolQuota == null ? 'All (unlimited plan)' : r.modules.map(moduleName).join(', ') || '—'}
                </p>
                {r.note && <p className="mt-1 text-xs italic" style={{ color: 'var(--ink-muted)' }}>&ldquo;{r.note}&rdquo;</p>}
                <p className="mt-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>Requested {fmtDateTime(r.createdAt)}</p>
                {canWrite && (
                  <div className="mt-4 flex gap-2">
                    <Btn className="flex-1" icon={<Check className="h-4 w-4" />} onClick={() => setApproving(r)}>Approve</Btn>
                    <Btn variant="danger" icon={<X className="h-4 w-4" />} onClick={() => setRejecting(r)}>Reject</Btn>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Section title="Professionals" description="Click a row to see that professional's subscription history.">
        <Toolbar>
          <SearchInput value={list.q} onChange={list.setQ} placeholder="Search name or email…" />
          <Select
            ariaLabel="Status"
            value={list.filters.status}
            onChange={(v) => list.setFilter('status', v)}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'active', label: 'Active' },
              { value: 'expiring7', label: 'Expiring in 7 days' },
              { value: 'expiring30', label: 'Expiring in 30 days' },
              { value: 'expired', label: 'Expired / cancelled' },
              { value: 'none', label: 'Never subscribed' },
            ]}
          />
          <Select ariaLabel="Plan" value={list.filters.planId} onChange={(v) => list.setFilter('planId', v)} options={planOptions} />
        </Toolbar>
        <DataTable
          columns={columns}
          rows={pros}
          rowKey={(p) => p.therapistId}
          onRowClick={setHistoryFor}
          sort={list.sort}
          dir={list.dir}
          onSort={list.onSort}
          loading={loading}
          empty="No professionals match these filters."
        />
        <Pagination page={list.page} pageSize={list.pageSize} total={data?.total ?? 0} onPage={list.setPage} />
      </Section>

      <ApproveModal request={approving} onClose={() => setApproving(null)} onDone={reload} />

      <ConfirmDialog
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Reject request?"
        body={rejecting ? `${rejecting.therapistName || 'This professional'} asked for ${rejecting.planName} (${rejecting.months} mo). They can request again later.` : ''}
        confirmLabel="Reject"
        danger
        onConfirm={async () => {
          await adminFetch(`/api/admin/subscriptions/requests/${rejecting!.id}`, { method: 'POST', json: { action: 'reject' } });
          toast('Request rejected');
          reload();
        }}
      />

      <RenewModal target={renewing} onClose={() => setRenewing(null)} onDone={reload} />

      <ConfirmDialog
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        title="Cancel this term?"
        body={cancelling ? `${cancelling.pro.name || 'This professional'}'s ${cancelling.term.planName} term ends now and they go back to free-tier tool access. You can reactivate it before ${fmtDate(cancelling.term.currentPeriodEnd)}.` : ''}
        confirmLabel="Cancel term"
        danger
        onConfirm={async () => {
          await adminFetch(`/api/admin/subscriptions/${cancelling!.term.id}`, { method: 'PATCH', json: { action: 'cancel' } });
          toast('Term cancelled');
          reload();
        }}
      />

      <HistoryModal pro={historyFor} onClose={() => setHistoryFor(null)} />
    </AdminPage>
  );
}

// ─── Approve: confirm the term length and (for capped plans) the tools ───────

function ApproveModal({ request, onClose, onDone }: { request: PlanRequest | null; onClose: () => void; onDone: () => void }) {
  const [months, setMonths] = useState('1');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!request) return;
    setMonths(String(request.months));
    setSelected(new Set(request.modules));
    setError('');
  }, [request]);

  const quota = request?.toolQuota ?? null;
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (quota == null || next.size < quota) next.add(id);
      return next;
    });

  const approve = async () => {
    if (!request) return;
    if (quota != null && selected.size === 0) { setError('Select at least one tool.'); return; }
    setSaving(true);
    setError('');
    try {
      await adminFetch(`/api/admin/subscriptions/requests/${request.id}`, {
        method: 'POST',
        json: { action: 'approve', months: Number(months), modules: Array.from(selected) },
      });
      toast('Request approved');
      onClose();
      onDone();
    } catch (e: any) {
      setError(e.message || 'Could not approve.');
    } finally {
      setSaving(false);
    }
  };

  const monthOptions = MONTH_OPTIONS.some((o) => o.value === months) ? MONTH_OPTIONS : [{ value: months, label: `${months} months` }, ...MONTH_OPTIONS];

  return (
    <Modal
      open={!!request}
      onClose={onClose}
      wide
      title="Approve request"
      description={request ? `${request.therapistName} · ${request.planName}. Confirm the term and the tools to grant — this sets their in-session access and replaces any current term.` : ''}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={approve} loading={saving}>Approve &amp; grant</Btn>
        </>
      }
    >
      <Field label="Term">
        <Select ariaLabel="Term" value={months} onChange={setMonths} options={monthOptions} />
      </Field>
      {quota == null ? (
        <p className="rounded-lg p-3 text-sm font-medium" style={{ background: 'var(--sage-light)', color: 'var(--ink)' }}>
          This is an unlimited plan — approving grants access to all tools.
        </p>
      ) : (
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
                  {cat.modules.map((m) => {
                    const checked = selected.has(m.id);
                    const full = !checked && selected.size >= quota;
                    return (
                      <label
                        key={m.id}
                        className="flex items-center gap-2 rounded-lg p-2"
                        style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', cursor: full ? 'not-allowed' : 'pointer', opacity: full ? 0.45 : 1 }}
                      >
                        <input type="checkbox" checked={checked} disabled={full} onChange={() => toggle(m.id)} style={{ accentColor: 'var(--sage)', width: 15, height: 15 }} />
                        <span className="text-sm" style={{ color: 'var(--ink)' }}>{m.emoji} {m.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {error && <ErrorBanner message={error} />}
    </Modal>
  );
}

// ─── Renew: extend a term by N months ────────────────────────────────────────

function RenewModal({ target, onClose, onDone }: { target: { pro: Professional; term: Term } | null; onClose: () => void; onDone: () => void }) {
  const [months, setMonths] = useState('1');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!target) return;
    setMonths(MONTH_OPTIONS.some((o) => o.value === String(target.term.months)) ? String(target.term.months) : '1');
    setError('');
  }, [target]);

  const renew = async () => {
    if (!target) return;
    setSaving(true);
    setError('');
    try {
      await adminFetch(`/api/admin/subscriptions/${target.term.id}`, { method: 'PATCH', json: { action: 'renew', months: Number(months) } });
      toast('Term renewed');
      onClose();
      onDone();
    } catch (e: any) {
      setError(e.message || 'Could not renew.');
    } finally {
      setSaving(false);
    }
  };

  const ended = target ? new Date(target.term.currentPeriodEnd).getTime() <= Date.now() || !target.pro.current : false;

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title="Renew term"
      description={
        target
          ? ended
            ? `${target.pro.name}'s ${target.term.planName} term is no longer current. Renewing restarts it from today and restores its tools.`
            : `Extends ${target.pro.name}'s ${target.term.planName} term from its current end date (${fmtDate(target.term.currentPeriodEnd)}).`
          : ''
      }
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={renew} loading={saving}>Renew</Btn>
        </>
      }
    >
      <Field label="Add">
        <Select ariaLabel="Months to add" value={months} onChange={setMonths} options={MONTH_OPTIONS} />
      </Field>
      {error && <ErrorBanner message={error} />}
    </Modal>
  );
}

// ─── History: every term and request for one professional ───────────────────

const EVENT_TONE: Record<string, Tone> = {
  request: 'info',
  approved: 'good',
  rejected: 'bad',
  term: 'good',
  renewed: 'good',
  cancelled: 'bad',
  ended: 'neutral',
};
const EVENT_LABEL: Record<string, string> = {
  request: 'Request',
  approved: 'Approved',
  rejected: 'Rejected',
  term: 'Started',
  renewed: 'Renewed',
  cancelled: 'Cancelled',
  ended: 'Ended',
};

function HistoryModal({ pro, onClose }: { pro: Professional | null; onClose: () => void }) {
  const { data, loading, error, reload } = useAdminQuery<History>(pro ? `/api/admin/subscriptions/history/${pro.therapistId}` : null);
  const ready = data && pro && !loading;

  return (
    <Modal open={!!pro} onClose={onClose} wide title={pro?.name || 'Subscription history'} description={pro?.email}>
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {!ready ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm" style={{ color: 'var(--ink-muted)' }}>
            <StateBadge state={data.therapist.state} />
            <span>
              Tool access:{' '}
              {data.therapist.allModulesAllowed ? 'all tools' : `${data.therapist.moduleAccess.length} tool${data.therapist.moduleAccess.length === 1 ? '' : 's'}`}
            </span>
            <span>· {data.terms.length} term{data.terms.length === 1 ? '' : 's'} on record</span>
          </div>
          {data.events.length === 0 ? (
            <EmptyState title="No history yet" body="This professional has never requested or held a plan." />
          ) : (
            <ol className="relative space-y-3 pl-5" style={{ borderLeft: '2px solid var(--glass-border)' }}>
              {data.events.map((e, i) => (
                <li key={`${e.refId}-${e.kind}-${i}`} className="relative">
                  <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full" style={{ background: 'var(--sage)', border: '2px solid var(--glass-strong)' }} />
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={EVENT_TONE[e.kind] ?? 'neutral'}>{EVENT_LABEL[e.kind] ?? e.kind}</Badge>
                    <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{e.title}</span>
                  </div>
                  <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
                    {fmtDateTime(e.at)}{e.detail ? ` · ${e.detail}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </Modal>
  );
}
