'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, Ban, CreditCard, Download, Gauge, RotateCcw, SlidersHorizontal, Trash2, Users } from 'lucide-react';
import {
  AdminPage,
  Badge,
  Btn,
  Checkbox,
  ConfirmDialog,
  DataTable,
  ErrorBanner,
  Input,
  Modal,
  Pagination,
  SearchInput,
  Select,
  StatCard,
  Toolbar,
  useAdmin,
  useAdminQuery,
  useListState,
  type Column,
} from '@/components/admin/kit';
import { adminFetch, downloadCsv, fetchAllPages, fmtDate, num, timeAgo } from '@/lib/adminApi';
import { toast } from '@/components/practice/ui';
import { MODULE_CATEGORIES, ALL_MODULE_IDS } from '@/lib/modules';
import { RemoveProfessionalDialog } from '@/components/admin/RemoveProfessionalDialog';

interface Row {
  id: string;
  userId: string;
  name: string;
  email: string;
  specialty: string[];
  createdAt: string;
  status: 'ACTIVE' | 'SUSPENDED';
  suspendedAt: string | null;
  suspendReason: string | null;
  lastSeenAt: string | null;
  lastActive: string | null;
  clients: number;
  sessions: { total: number; completed: number };
  plan: { id: string; name: string; endsAt: string } | null;
  access: { allModulesAllowed: boolean; moduleAccess: string[]; allowedCount: number; totalModules: number };
}

interface ListResponse {
  professionals: Row[];
  total: number;
  kpis: { total: number; active30d: number; suspended: number; onPlan: number };
  plans: { id: string; name: string }[];
}

const ACTIVE_MS = 30 * 864e5;

function statusOf(r: Row): { label: string; tone: 'good' | 'neutral' | 'bad' } {
  if (r.status === 'SUSPENDED') return { label: 'Suspended', tone: 'bad' };
  const active = r.lastActive && Date.now() - new Date(r.lastActive).getTime() <= ACTIVE_MS;
  return active ? { label: 'Active', tone: 'good' } : { label: 'Inactive', tone: 'neutral' };
}

const accessLabel = (r: Row) => (r.access.allModulesAllowed ? 'All' : `${r.access.allowedCount}/${r.access.totalModules}`);

type BulkAction = 'grantModules' | 'revokeModules';

export default function AdminProfessionalsPage() {
  const router = useRouter();
  const { can } = useAdmin();
  const canWrite = can('people.write');
  const canRemove = can('admins.manage'); // permanent removal: super admins only
  const list = useListState({ sort: 'createdAt', dir: 'desc', filters: { status: '', plan: '', from: '', to: '' } });
  const { data, loading, error, reload } = useAdminQuery<ListResponse>(`/api/admin/professionals?${list.query}`);
  const rows = data?.professionals ?? [];

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  // Single-therapist module access
  const [editing, setEditing] = useState<Row | null>(null);
  const [allowAll, setAllowAll] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [savingAccess, setSavingAccess] = useState(false);

  // Bulk module grant / revoke
  const [bulk, setBulk] = useState<BulkAction | null>(null);
  const [bulkModules, setBulkModules] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmAllowAll, setConfirmAllowAll] = useState(false);

  // Suspend / reactivate
  const [statusTarget, setStatusTarget] = useState<Row | null>(null);
  // Permanent removal
  const [removeTarget, setRemoveTarget] = useState<Row | null>(null);

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  };

  const pageIds = rows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleAllOnPage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPage) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });

  const openAccess = (r: Row) => {
    setEditing(r);
    setAllowAll(r.access.allModulesAllowed);
    setPicked(new Set(r.access.allModulesAllowed ? ALL_MODULE_IDS : r.access.moduleAccess));
  };

  const saveAccess = async () => {
    if (!editing) return;
    setSavingAccess(true);
    try {
      await adminFetch(`/api/admin/therapists/${editing.id}/access`, {
        method: 'PATCH',
        json: { allModulesAllowed: allowAll, moduleAccess: Array.from(picked) },
      });
      toast(`Module access updated for ${editing.name || 'professional'}`);
      setEditing(null);
      reload();
    } catch (e: any) {
      toast(e.message || 'Could not update access', 'error');
    } finally {
      setSavingAccess(false);
    }
  };

  const runBulk = async (action: BulkAction | 'allowAllModules', moduleIds: string[] = []) => {
    const res = await adminFetch<{ updated: number; unchanged: number; missing: string[] }>('/api/admin/professionals/bulk', {
      method: 'POST',
      json: { therapistIds: Array.from(selected), action, moduleIds },
    });
    toast(`Updated ${res.updated} professional${res.updated === 1 ? '' : 's'}${res.unchanged ? ` · ${res.unchanged} already set` : ''}`);
    setSelected(new Set());
    reload();
  };

  const submitBulk = async () => {
    if (!bulk) return;
    setBulkBusy(true);
    try {
      await runBulk(bulk, Array.from(bulkModules));
      setBulk(null);
    } catch (e: any) {
      toast(e.message || 'Bulk update failed', 'error');
    } finally {
      setBulkBusy(false);
    }
  };

  const changeStatus = async (reason: string) => {
    if (!statusTarget) return;
    const suspend = statusTarget.status !== 'SUSPENDED';
    await adminFetch(`/api/admin/users/${statusTarget.userId}/status`, {
      method: 'PATCH',
      json: suspend ? { action: 'suspend', reason } : { action: 'reactivate' },
    });
    toast(`${statusTarget.name || 'Account'} ${suspend ? 'suspended' : 'reactivated'}`);
    reload();
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params: Record<string, string> = { sort: list.sort, dir: list.dir };
      if (list.q) params.q = list.q;
      for (const [k, v] of Object.entries(list.filters)) if (v) params[k] = v;
      const all = await fetchAllPages<Row>('/api/admin/professionals', 'professionals', params);
      downloadCsv(`professionals-${new Date().toISOString().slice(0, 10)}`, all, [
        { header: 'Name', value: (r) => r.name },
        { header: 'Email', value: (r) => r.email },
        { header: 'Specialty', value: (r) => r.specialty.join('; ') },
        { header: 'Status', value: (r) => statusOf(r).label },
        { header: 'Plan', value: (r) => r.plan?.name ?? 'Free' },
        { header: 'Plan ends', value: (r) => r.plan?.endsAt ?? '' },
        { header: 'Clients', value: (r) => r.clients },
        { header: 'Sessions', value: (r) => r.sessions.total },
        { header: 'Completed sessions', value: (r) => r.sessions.completed },
        { header: 'Module access', value: (r) => accessLabel(r) },
        { header: 'Last active', value: (r) => r.lastActive ?? '' },
        { header: 'Signed up', value: (r) => r.createdAt },
        { header: 'Suspend reason', value: (r) => r.suspendReason ?? '' },
      ]);
      toast(`Exported ${all.length} rows`);
    } catch (e: any) {
      toast(e.message || 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<Row>[] = [
    ...(canWrite
      ? [
          {
            key: 'select',
            header: (
              <span onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" aria-label="Select all on this page" checked={allOnPage} onChange={toggleAllOnPage} style={{ accentColor: 'var(--sage)', width: 15, height: 15 }} />
              </span>
            ),
            render: (r: Row) => (
              <span onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.id)} onChange={() => setSelected((s) => toggle(s, r.id))} style={{ accentColor: 'var(--sage)', width: 15, height: 15 }} />
              </span>
            ),
            className: 'w-8',
          } as Column<Row>,
        ]
      : []),
    {
      key: 'name',
      header: 'Professional',
      sortKey: 'name',
      render: (r) => (
        <div className="min-w-[160px]">
          <div className="font-semibold">{r.name || 'Unnamed'}</div>
          <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>{r.email}</div>
        </div>
      ),
    },
    { key: 'plan', header: 'Plan', render: (r) => (r.plan ? <Badge tone="info" title={`Until ${fmtDate(r.plan.endsAt)}`}>{r.plan.name}</Badge> : <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>Free</span>) },
    {
      key: 'status',
      header: 'Status',
      render: (r) => {
        const s = statusOf(r);
        return <Badge tone={s.tone} title={r.suspendReason ? `Reason: ${r.suspendReason}` : undefined}>{s.label}</Badge>;
      },
    },
    { key: 'clients', header: 'Clients', sortKey: 'clients', align: 'right', render: (r) => num(r.clients) },
    {
      key: 'sessions',
      header: 'Sessions',
      sortKey: 'sessions',
      align: 'right',
      render: (r) => (
        <span className="whitespace-nowrap">
          {num(r.sessions.total)}
          <span className="text-xs" style={{ color: 'var(--ink-muted)' }}> ({num(r.sessions.completed)} done)</span>
        </span>
      ),
    },
    {
      key: 'lastActive',
      header: 'Last active',
      sortKey: 'lastActive',
      render: (r) => <span className="whitespace-nowrap text-xs" style={{ color: 'var(--ink-muted)' }} title={r.lastActive ?? undefined}>{timeAgo(r.lastActive)}</span>,
    },
    { key: 'access', header: 'Modules', render: (r) => <Badge tone={r.access.allModulesAllowed ? 'info' : 'warn'}>{accessLabel(r)}</Badge> },
    { key: 'createdAt', header: 'Joined', sortKey: 'createdAt', render: (r) => <span className="whitespace-nowrap text-xs" style={{ color: 'var(--ink-muted)' }}>{fmtDate(r.createdAt)}</span> },
    {
      key: 'actions',
      header: '',
      render: (r: Row) => (
        <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Btn size="sm" variant="ghost" icon={<Gauge className="h-3.5 w-3.5" />} onClick={() => router.push(`/admin/usage/${r.id}`)} title="Usage, cost, storage and payments">
            Usage & cost
          </Btn>
          {canWrite && (
            <>
              <Btn size="sm" variant="ghost" icon={<SlidersHorizontal className="h-3.5 w-3.5" />} onClick={() => openAccess(r)}>Access</Btn>
              {r.status === 'SUSPENDED' ? (
                <Btn size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setStatusTarget(r)}>Reactivate</Btn>
              ) : (
                <Btn size="sm" variant="danger" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setStatusTarget(r)}>Suspend</Btn>
              )}
              {canRemove && (
                <Btn size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setRemoveTarget(r)} title="Remove permanently">Remove</Btn>
              )}
            </>
          )}
        </div>
      ),
    },
  ];

  const k = data?.kpis;
  const planOptions = [
    { value: '', label: 'All plans' },
    { value: 'none', label: 'No plan (free)' },
    ...(data?.plans ?? []).map((p) => ({ value: p.id, label: p.name })),
  ];
  const suspending = statusTarget?.status !== 'SUSPENDED';

  return (
    <AdminPage
      title="Professionals"
      description="Find therapists, check their activity, and manage access and account status."
      permission="people.read"
      actions={<Btn variant="ghost" icon={<Download className="h-4 w-4" />} loading={exporting} onClick={exportCsv}>Export CSV</Btn>}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Professionals" value={k ? num(k.total) : '—'} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Active (30 days)" value={k ? num(k.active30d) : '—'} hint="Signed in or held a session" icon={<Activity className="h-4 w-4" />} />
        <StatCard label="On a plan" value={k ? num(k.onPlan) : '—'} icon={<CreditCard className="h-4 w-4" />} />
        <StatCard label="Suspended" value={k ? num(k.suspended) : '—'} icon={<Ban className="h-4 w-4" />} />
      </div>

      <Toolbar>
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Search name or email…" />
        <Select
          ariaLabel="Status"
          value={list.filters.status}
          onChange={(v) => list.setFilter('status', v)}
          options={[
            { value: '', label: 'All statuses' },
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
            { value: 'suspended', label: 'Suspended' },
          ]}
        />
        <Select ariaLabel="Plan" value={list.filters.plan} onChange={(v) => list.setFilter('plan', v)} options={planOptions} />
        <label className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--ink-muted)' }}>
          Joined
          <Input type="date" aria-label="Joined from" value={list.filters.from} onChange={(e) => list.setFilter('from', e.target.value)} className="w-auto py-2" />
          –
          <Input type="date" aria-label="Joined to" value={list.filters.to} onChange={(e) => list.setFilter('to', e.target.value)} className="w-auto py-2" />
        </label>
      </Toolbar>

      {canWrite && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl px-4 py-2.5 text-sm" style={{ background: 'var(--sage-light)', border: '1px solid var(--glass-border)', color: 'var(--ink)' }}>
          <span className="font-semibold">{selected.size} selected</span>
          <span className="flex-1" />
          <Btn size="sm" variant="ghost" onClick={() => { setBulkModules(new Set()); setBulk('grantModules'); }}>Grant modules</Btn>
          <Btn size="sm" variant="ghost" onClick={() => { setBulkModules(new Set()); setBulk('revokeModules'); }}>Revoke modules</Btn>
          <Btn size="sm" variant="ghost" onClick={() => setConfirmAllowAll(true)}>Allow all modules</Btn>
          <Btn size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Btn>
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={reload} />}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={(r) => router.push(`/admin/professionals/${r.id}`)}
        sort={list.sort}
        dir={list.dir}
        onSort={list.onSort}
        loading={loading}
        empty={list.q || Object.values(list.filters).some(Boolean) ? 'No professionals match these filters.' : 'No professionals yet. Therapists appear here once they sign up.'}
      />
      <Pagination page={list.page} pageSize={list.pageSize} total={data?.total ?? 0} onPage={list.setPage} />

      {/* Single-therapist module access */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        wide
        title="Module access"
        description={`Choose which tools ${editing?.name || 'this therapist'} can launch in sessions.`}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setEditing(null)}>Cancel</Btn>
            <Btn onClick={saveAccess} loading={savingAccess}>Save access</Btn>
          </>
        }
      >
        <div className="rounded-xl p-3" style={{ background: 'var(--sage-light)', border: '1px solid var(--glass-border)' }}>
          <Checkbox
            checked={allowAll}
            onChange={setAllowAll}
            label={
              <span>
                <span className="block font-semibold">Allow all modules</span>
                <span className="block text-xs" style={{ color: 'var(--ink-muted)' }}>Therapist can launch every tool (default).</span>
              </span>
            }
          />
        </div>
        <div style={{ opacity: allowAll ? 0.45 : 1, pointerEvents: allowAll ? 'none' : 'auto' }}>
          <ModulePicker selected={picked} onToggle={(id) => setPicked((s) => toggle(s, id))} />
        </div>
      </Modal>

      {/* Bulk grant / revoke */}
      <Modal
        open={!!bulk}
        onClose={() => setBulk(null)}
        wide
        title={bulk === 'revokeModules' ? 'Revoke modules' : 'Grant modules'}
        description={
          bulk === 'revokeModules'
            ? `Remove the chosen tools from ${selected.size} professional${selected.size === 1 ? '' : 's'}. Anyone on "all modules" keeps every other tool.`
            : `Add the chosen tools for ${selected.size} professional${selected.size === 1 ? '' : 's'}. Anyone already on "all modules" is unchanged.`
        }
        footer={
          <>
            <Btn variant="ghost" onClick={() => setBulk(null)}>Cancel</Btn>
            <Btn variant={bulk === 'revokeModules' ? 'danger' : 'primary'} onClick={submitBulk} loading={bulkBusy} disabled={!bulkModules.size}>
              {bulk === 'revokeModules' ? 'Revoke' : 'Grant'} {bulkModules.size || ''} module{bulkModules.size === 1 ? '' : 's'}
            </Btn>
          </>
        }
      >
        <ModulePicker selected={bulkModules} onToggle={(id) => setBulkModules((s) => toggle(s, id))} />
      </Modal>

      <ConfirmDialog
        open={confirmAllowAll}
        onClose={() => setConfirmAllowAll(false)}
        title="Allow all modules?"
        body={`${selected.size} professional${selected.size === 1 ? '' : 's'} will be able to launch every tool.`}
        confirmLabel="Allow all"
        onConfirm={() => runBulk('allowAllModules')}
      />

      <ConfirmDialog
        open={!!statusTarget}
        onClose={() => setStatusTarget(null)}
        title={suspending ? 'Suspend account?' : 'Reactivate account?'}
        body={
          suspending
            ? `${statusTarget?.name || 'This professional'} (${statusTarget?.email}) will be signed out of the app and blocked from every API until reactivated.`
            : `${statusTarget?.name || 'This professional'} will be able to sign in and use the app again.${statusTarget?.suspendReason ? ` Suspended for: ${statusTarget.suspendReason}` : ''}`
        }
        confirmLabel={suspending ? 'Suspend' : 'Reactivate'}
        danger={suspending}
        reasonLabel={suspending ? 'Reason (kept in the audit log)' : undefined}
        onConfirm={changeStatus}
      />

      <RemoveProfessionalDialog
        target={removeTarget}
        onClose={() => setRemoveTarget(null)}
        onRemoved={() => {
          setSelected((s) => { const next = new Set(s); if (removeTarget) next.delete(removeTarget.id); return next; });
          reload();
        }}
      />
    </AdminPage>
  );
}

function ModulePicker({ selected, onToggle }: { selected: Set<string>; onToggle: (id: string) => void }) {
  return (
    <div className="space-y-4">
      {MODULE_CATEGORIES.map((cat) => (
        <div key={cat.id}>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>{cat.emoji} {cat.name}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {cat.modules.map((m) => (
              <div key={m.id} className="rounded-lg p-2" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                <Checkbox checked={selected.has(m.id)} onChange={() => onToggle(m.id)} label={<span>{m.emoji} {m.name}</span>} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
