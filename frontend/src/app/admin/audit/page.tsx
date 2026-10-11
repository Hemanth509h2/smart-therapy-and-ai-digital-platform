'use client';

import React, { useState } from 'react';
import { Download } from 'lucide-react';
import {
  AdminPage,
  Btn,
  DataTable,
  ErrorBanner,
  Input,
  Modal,
  Pagination,
  SearchInput,
  Select,
  Toolbar,
  KV,
  useAdminQuery,
  useListState,
} from '@/components/admin/kit';
import { toast } from '@/components/practice/ui';
import { downloadCsv, fetchAllPages, fmtDateTime } from '@/lib/adminApi';

interface Entry {
  id: string;
  actorUid: string;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
}

interface AuditResponse {
  entries: Entry[];
  total: number;
  actions: string[];
  targetTypes: string[];
}

// Read-only view of the admin audit trail. There is no edit or delete.
export default function AdminAuditPage() {
  const list = useListState({ pageSize: 50, filters: { action: '', targetType: '', targetId: '', from: '', to: '' } });
  const { data, loading, error, reload } = useAdminQuery<AuditResponse>(`/api/admin/audit?${list.query}`);
  const [open, setOpen] = useState<Entry | null>(null);
  const [exporting, setExporting] = useState(false);

  // Offer both full action names and their entity prefixes ("plan." etc.).
  const actions = data?.actions ?? [];
  const prefixes = Array.from(new Set(actions.map((a) => a.split('.')[0] + '.'))).filter((p) => !actions.includes(p));
  const actionOptions = [
    { value: '', label: 'All actions' },
    ...prefixes.map((p) => ({ value: p, label: `${p}*` })),
    ...actions.map((a) => ({ value: a, label: a })),
  ].sort((a, b) => (a.value === '' ? -1 : b.value === '' ? 1 : a.value.localeCompare(b.value)));

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = Object.fromEntries(new URLSearchParams(list.query));
      delete params.page;
      delete params.pageSize;
      const rows = await fetchAllPages<Entry>('/api/admin/audit', 'entries', params);
      downloadCsv(`audit-log-${new Date().toISOString().slice(0, 10)}`, rows, [
        { header: 'Time', value: (r) => r.createdAt },
        { header: 'Actor', value: (r) => r.actorEmail ?? r.actorUid },
        { header: 'Action', value: (r) => r.action },
        { header: 'Target type', value: (r) => r.targetType },
        { header: 'Target id', value: (r) => r.targetId },
        { header: 'IP', value: (r) => r.ip },
        { header: 'Before', value: (r) => (r.before == null ? '' : JSON.stringify(r.before)) },
        { header: 'After', value: (r) => (r.after == null ? '' : JSON.stringify(r.after)) },
      ]);
      toast(`Exported ${rows.length} entries`);
    } catch (e: any) {
      toast(e.message || 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <AdminPage
      title="Audit log"
      description="Every admin change and every reveal of client details. Entries can't be edited or deleted."
      permission="audit.read"
      actions={<Btn variant="ghost" icon={<Download className="h-4 w-4" />} onClick={exportCsv} loading={exporting}>Export CSV</Btn>}
    >
      <Toolbar>
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Actor email…" />
        <Select ariaLabel="Action" value={list.filters.action} onChange={(v) => list.setFilter('action', v)} options={actionOptions} />
        <Select
          ariaLabel="Target type"
          value={list.filters.targetType}
          onChange={(v) => list.setFilter('targetType', v)}
          options={[{ value: '', label: 'All targets' }, ...(data?.targetTypes ?? []).map((t) => ({ value: t, label: t }))]}
        />
        <SearchInput value={list.filters.targetId} onChange={(v) => list.setFilter('targetId', v.trim())} placeholder="Target id…" />
        <Input aria-label="From date" type="date" value={list.filters.from} onChange={(e) => list.setFilter('from', e.target.value)} style={{ width: 150 }} />
        <Input aria-label="To date" type="date" value={list.filters.to} onChange={(e) => list.setFilter('to', e.target.value)} style={{ width: 150 }} />
      </Toolbar>

      {error && <ErrorBanner message={error} onRetry={reload} />}

      <DataTable<Entry>
        rows={data?.entries ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        sort="createdAt"
        dir={list.dir}
        onSort={list.onSort}
        onRowClick={setOpen}
        empty="No audit entries match these filters."
        columns={[
          { key: 'time', header: 'Time', sortKey: 'createdAt', className: 'whitespace-nowrap', render: (r) => fmtDateTime(r.createdAt) },
          { key: 'actor', header: 'Actor', render: (r) => <span className="break-all">{r.actorEmail ?? r.actorUid}</span> },
          { key: 'action', header: 'Action', render: (r) => <code className="text-xs font-semibold">{r.action}</code> },
          {
            key: 'target',
            header: 'Target',
            render: (r) => (
              <div className="min-w-[140px]">
                <div className="font-semibold">{r.targetType}</div>
                {r.targetId && <div className="break-all text-xs" style={{ color: 'var(--ink-muted)' }}>{r.targetId}</div>}
              </div>
            ),
          },
          {
            key: 'details',
            header: '',
            align: 'right',
            render: (r) => (
              <Btn size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setOpen(r); }}>Details</Btn>
            ),
          },
        ]}
      />
      <Pagination page={list.page} pageSize={list.pageSize} total={data?.total ?? 0} onPage={list.setPage} />

      <Modal open={!!open} onClose={() => setOpen(null)} wide title={open?.action ?? ''} description={open ? fmtDateTime(open.createdAt) : undefined}>
        {open && (
          <>
            <KV
              items={[
                { label: 'Actor', value: open.actorEmail ?? '—' },
                { label: 'Actor uid', value: <span className="break-all">{open.actorUid}</span> },
                { label: 'IP', value: open.ip ?? '—' },
                { label: 'Target', value: open.targetType },
                { label: 'Target id', value: <span className="break-all">{open.targetId ?? '—'}</span> },
              ]}
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <JsonBlock title="Before" value={open.before} />
              <JsonBlock title="After" value={open.after} />
            </div>
          </>
        )}
      </Modal>
    </AdminPage>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>{title}</h3>
      <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap break-all rounded-xl p-3 text-xs" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--ink)' }}>
        {value == null ? '—' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
