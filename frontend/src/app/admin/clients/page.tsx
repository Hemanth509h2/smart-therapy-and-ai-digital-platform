'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, Eye, EyeOff } from 'lucide-react';
import {
  AdminPage,
  Badge,
  Btn,
  DataTable,
  ErrorBanner,
  Pagination,
  SearchInput,
  Select,
  Toolbar,
  useAdmin,
  useAdminQuery,
  useListState,
  type Column,
} from '@/components/admin/kit';
import { downloadCsv, fetchAllPages, fmtDate, num } from '@/lib/adminApi';
import { caughtErrorMessage } from '@/lib/apiError';
import { toast } from '@/components/practice/ui';

interface ClientRow {
  id: string;
  name: string;
  masked: boolean;
  therapist: { id: string; name: string } | null;
  sessions: number;
  lastSession: string | null;
  inviteStatus: 'CLAIMED' | 'DIRECT';
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
}

export default function AdminClientsPage() {
  const router = useRouter();
  const { can } = useAdmin();
  const list = useListState({ sort: 'createdAt', dir: 'desc' });
  const [reveal, setReveal] = useState(false);
  const path = `/api/admin/clients?${list.query}${reveal ? '&reveal=1' : ''}`;
  const { data, loading, error, reload } = useAdminQuery<{ clients: ClientRow[]; total: number }>(path, 'load the clients');
  // Therapist filter options; the filter is hidden if this list can't load.
  const pros = useAdminQuery<{ professionals: { id: string; name: string }[] }>('/api/admin/professionals?pageSize=200&sort=name&dir=asc', 'load the professionals');
  const [exporting, setExporting] = useState(false);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params: Record<string, string> = { sort: list.sort, dir: list.dir };
      if (list.q) params.q = list.q;
      for (const [k, v] of Object.entries(list.filters)) if (v) params[k] = v;
      if (reveal) params.reveal = '1';
      const rows = await fetchAllPages<ClientRow>('/api/admin/clients', 'clients', params);
      downloadCsv(`clients-${new Date().toISOString().slice(0, 10)}`, rows, [
        { header: 'Client ID', value: (r) => r.id },
        { header: 'Name', value: (r) => r.name },
        { header: 'Therapist', value: (r) => r.therapist?.name ?? '' },
        { header: 'Sessions', value: (r) => r.sessions },
        { header: 'Last session', value: (r) => r.lastSession ?? '' },
        { header: 'Joined via', value: (r) => (r.inviteStatus === 'CLAIMED' ? 'Invite' : 'Added directly') },
        { header: 'Account', value: (r) => r.status },
        { header: 'Created', value: (r) => r.createdAt },
      ]);
      toast(`Exported ${rows.length} client${rows.length === 1 ? '' : 's'}.`);
    } catch (e) {
      toast(caughtErrorMessage(e, 'export the clients'), 'error');
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<ClientRow>[] = [
    {
      key: 'name',
      header: 'Client',
      sortKey: 'name',
      render: (r) => <span className="font-semibold">{r.name}</span>,
    },
    {
      key: 'therapist',
      header: 'Therapist',
      render: (r) =>
        r.therapist ? (
          <Link href={`/admin/professionals/${r.therapist.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
            {r.therapist.name}
          </Link>
        ) : (
          <span style={{ color: 'var(--ink-muted)' }}>Unassigned</span>
        ),
    },
    { key: 'sessions', header: 'Sessions', sortKey: 'sessions', align: 'right', render: (r) => num(r.sessions) },
    { key: 'last', header: 'Last session', render: (r) => fmtDate(r.lastSession) },
    {
      key: 'invite',
      header: 'Joined via',
      render: (r) => <Badge tone={r.inviteStatus === 'CLAIMED' ? 'info' : 'neutral'}>{r.inviteStatus === 'CLAIMED' ? 'Invite' : 'Added directly'}</Badge>,
    },
    {
      key: 'status',
      header: 'Account',
      render: (r) => <Badge tone={r.status === 'SUSPENDED' ? 'bad' : 'good'}>{r.status === 'SUSPENDED' ? 'Suspended' : 'Active'}</Badge>,
    },
    { key: 'created', header: 'Created', sortKey: 'createdAt', render: (r) => fmtDate(r.createdAt) },
  ];

  return (
    <AdminPage
      permission="people.read"
      title="Clients"
      description={reveal ? 'Full names shown — this view is recorded in the audit log.' : 'All clients across professionals. Names are shown as initials.'}
      actions={
        <>
          {can('phi.read') && (
            <Btn variant="ghost" icon={reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} onClick={() => setReveal((v) => !v)} title="Each reveal is logged">
              {reveal ? 'Hide names' : 'Reveal names (logged)'}
            </Btn>
          )}
          <Btn variant="ghost" icon={<Download className="h-4 w-4" />} loading={exporting} onClick={exportCsv}>Export CSV</Btn>
        </>
      }
    >
      <Toolbar>
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Search name or email…" />
        {!pros.error && pros.data?.professionals && (
          <Select
            ariaLabel="Filter by therapist"
            value={list.filters.therapistId || ''}
            onChange={(v) => list.setFilter('therapistId', v)}
            options={[{ value: '', label: 'All therapists' }, ...pros.data.professionals.map((p) => ({ value: p.id, label: p.name || 'Unnamed' }))]}
          />
        )}
        <Select
          ariaLabel="Filter by how they joined"
          value={list.filters.invite || ''}
          onChange={(v) => list.setFilter('invite', v)}
          options={[
            { value: '', label: 'Any origin' },
            { value: 'claimed', label: 'Joined via invite' },
            { value: 'direct', label: 'Added directly' },
          ]}
        />
        <Select
          ariaLabel="Filter by account status"
          value={list.filters.status || ''}
          onChange={(v) => list.setFilter('status', v)}
          options={[
            { value: '', label: 'Any status' },
            { value: 'ACTIVE', label: 'Active' },
            { value: 'SUSPENDED', label: 'Suspended' },
          ]}
        />
      </Toolbar>
      {error && <ErrorBanner message={error} onRetry={reload} />}
      <DataTable
        columns={columns}
        rows={data?.clients ?? []}
        rowKey={(r) => r.id}
        loading={loading}
        sort={list.sort}
        dir={list.dir}
        onSort={list.onSort}
        onRowClick={(r) => router.push(`/admin/clients/${r.id}`)}
        empty={list.q ? 'No clients match that search.' : 'No clients yet.'}
      />
      <Pagination page={list.page} pageSize={list.pageSize} total={data?.total ?? 0} onPage={list.setPage} />
    </AdminPage>
  );
}
