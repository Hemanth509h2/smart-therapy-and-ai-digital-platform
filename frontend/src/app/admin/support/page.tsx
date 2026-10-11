'use client';

import React, { useEffect, useState } from 'react';
import { Lock, Mail, Send } from 'lucide-react';
import {
  AdminPage,
  Badge,
  Btn,
  Checkbox,
  DataTable,
  ErrorBanner,
  KV,
  Modal,
  Pagination,
  SearchInput,
  Select,
  Spinner,
  Tabs,
  Textarea,
  Toolbar,
  useAdmin,
  useAdminQuery,
  useListState,
  type Column,
  type Tone,
} from '@/components/admin/kit';
import { adminFetch, fmtDateTime, timeAgo } from '@/lib/adminApi';
import { toast } from '@/components/practice/ui';

type TicketStatus = 'OPEN' | 'PENDING' | 'RESOLVED';

interface TicketRow {
  id: string;
  ref: string;
  userId: string | null;
  name: string | null;
  email: string;
  role: string | null;
  category: string;
  subject: string;
  status: TicketStatus;
  assigneeUid: string | null;
  assigneeEmail: string | null;
  replies: number;
  createdAt: string;
  updatedAt: string;
}

interface Reply {
  id: string;
  authorUid: string;
  authorEmail: string | null;
  body: string;
  internal: boolean;
  emailed: boolean;
  createdAt: string;
}

interface TicketDetail extends Omit<TicketRow, 'replies'> {
  message: string;
  replies: Reply[];
}

const STATUS_TONE: Record<TicketStatus, Tone> = { OPEN: 'bad', PENDING: 'warn', RESOLVED: 'good' };
const STATUS_LABEL: Record<TicketStatus, string> = { OPEN: 'Open', PENDING: 'Waiting on user', RESOLVED: 'Resolved' };
// Same list as the help page form (backend/src/app/api/support/route.ts).
const CATEGORIES = ['Technical Issue', 'Billing', 'Account', 'Feedback', 'Other'];

export default function AdminSupportPage() {
  const list = useListState({ sort: 'createdAt', dir: 'desc', filters: { status: 'OPEN', category: '', assignee: '' } });
  const { data, loading, error, reload } = useAdminQuery<{
    tickets: TicketRow[];
    total: number;
    counts: Record<TicketStatus, number>;
    admins: { id: string; email: string }[];
  }>(`/api/admin/support?${list.query}`);
  const [openId, setOpenId] = useState<string | null>(null);
  const counts = data?.counts;

  const columns: Column<TicketRow>[] = [
    {
      key: 'subject',
      header: 'Ticket',
      className: 'min-w-[260px]',
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-semibold">{r.subject}</p>
          <p className="truncate text-xs" style={{ color: 'var(--ink-muted)' }}>
            {r.name || r.email} · {r.ref}
          </p>
        </div>
      ),
    },
    { key: 'category', header: 'Category', render: (r) => <Badge>{r.category}</Badge> },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge> },
    { key: 'assignee', header: 'Assignee', render: (r) => <span className="text-xs">{r.assigneeEmail ?? 'Unassigned'}</span> },
    { key: 'replies', header: 'Replies', align: 'right', render: (r) => r.replies },
    { key: 'createdAt', header: 'Raised', sortKey: 'createdAt', render: (r) => <span title={fmtDateTime(r.createdAt)}>{timeAgo(r.createdAt)}</span> },
    { key: 'updatedAt', header: 'Updated', sortKey: 'updatedAt', render: (r) => timeAgo(r.updatedAt) },
  ];

  const tabLabel = (s: TicketStatus) => `${STATUS_LABEL[s]}${counts ? ` (${counts[s]})` : ''}`;

  return (
    <AdminPage title="Support" description="Helpdesk tickets raised from the Help page. Replies are emailed to the user; internal notes are not." permission="support">
      <Tabs<string>
        value={list.filters.status}
        onChange={(v) => list.setFilter('status', v)}
        tabs={[
          { value: 'OPEN', label: tabLabel('OPEN') },
          { value: 'PENDING', label: tabLabel('PENDING') },
          { value: 'RESOLVED', label: tabLabel('RESOLVED') },
          { value: '', label: 'All' },
        ]}
      />
      <Toolbar>
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Search ref, email, subject…" />
        <Select
          ariaLabel="Category"
          value={list.filters.category}
          onChange={(v) => list.setFilter('category', v)}
          options={[{ value: '', label: 'All categories' }, ...CATEGORIES.map((c) => ({ value: c, label: c }))]}
        />
        <Select
          ariaLabel="Assignee"
          value={list.filters.assignee}
          onChange={(v) => list.setFilter('assignee', v)}
          options={[
            { value: '', label: 'Anyone' },
            { value: 'me', label: 'Assigned to me' },
            { value: 'none', label: 'Unassigned' },
            ...(data?.admins ?? []).map((a) => ({ value: a.id, label: a.email })),
          ]}
        />
      </Toolbar>
      {error && <ErrorBanner message={error} onRetry={reload} />}
      <DataTable columns={columns} rows={data?.tickets ?? []} rowKey={(r) => r.id} loading={loading} sort={list.sort} dir={list.dir} onSort={list.onSort} onRowClick={(r) => setOpenId(r.id)} empty="No tickets here." />
      <Pagination page={list.page} pageSize={list.pageSize} total={data?.total ?? 0} onPage={list.setPage} />

      <TicketModal id={openId} admins={data?.admins ?? []} onClose={() => setOpenId(null)} onChanged={reload} />
    </AdminPage>
  );
}

function TicketModal({ id, admins, onClose, onChanged }: { id: string | null; admins: { id: string; email: string }[]; onClose: () => void; onChanged: () => void }) {
  const { uid } = useAdmin();
  const { data, loading, error, reload } = useAdminQuery<{ ticket: TicketDetail }>(id ? `/api/admin/support/${id}` : null);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    setBody('');
    setInternal(false);
    setActionError('');
  }, [id]);

  const ticket = data?.ticket && data.ticket.id === id ? data.ticket : null;

  const update = async (patch: { status?: TicketStatus; assigneeUid?: string | null }) => {
    if (!ticket) return;
    setSaving(true);
    setActionError('');
    try {
      await adminFetch(`/api/admin/support/${ticket.id}`, { method: 'PATCH', json: patch });
      await reload();
      onChanged();
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const reply = async () => {
    if (!ticket || !body.trim()) return;
    setSending(true);
    setActionError('');
    try {
      const res = await adminFetch<{ emailError: string | null }>(`/api/admin/support/${ticket.id}/replies`, { method: 'POST', json: { body, internal } });
      if (internal) toast('Internal note added');
      else if (res.emailError) toast(`Reply saved, but the email failed: ${res.emailError}`, 'error');
      else toast('Reply emailed to the user');
      setBody('');
      await reload();
      onChanged();
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal open={!!id} onClose={onClose} wide title={ticket ? ticket.subject : 'Ticket'} description={ticket ? `${ticket.ref} · raised ${fmtDateTime(ticket.createdAt)}` : undefined}>
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {!ticket ? (
        loading && <div className="flex justify-center py-10"><Spinner /></div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              ariaLabel="Status"
              value={ticket.status}
              onChange={(v) => update({ status: v as TicketStatus })}
              options={(Object.keys(STATUS_LABEL) as TicketStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
            />
            <Select
              ariaLabel="Assignee"
              value={ticket.assigneeUid ?? ''}
              onChange={(v) => update({ assigneeUid: v || null })}
              options={[{ value: '', label: 'Unassigned' }, ...admins.map((a) => ({ value: a.id, label: a.email }))]}
            />
            {ticket.assigneeUid !== uid && uid && (
              <Btn size="sm" variant="ghost" onClick={() => update({ assigneeUid: uid })} disabled={saving}>Assign to me</Btn>
            )}
            {saving && <Spinner />}
          </div>

          <KV
            items={[
              { label: 'From', value: ticket.name || '—' },
              { label: 'Email', value: <a href={`mailto:${ticket.email}`} className="hover:underline" style={{ color: 'var(--sage)' }}>{ticket.email}</a> },
              { label: 'Role', value: ticket.role || 'Unknown' },
              { label: 'Category', value: ticket.category },
              { label: 'Signed in', value: ticket.userId ? 'Yes' : 'No' },
              { label: 'Status', value: <Badge tone={STATUS_TONE[ticket.status]}>{STATUS_LABEL[ticket.status]}</Badge> },
            ]}
          />

          <div className="space-y-3">
            <ThreadItem author={ticket.name || ticket.email} at={ticket.createdAt} body={ticket.message} tag={<Badge tone="info">User</Badge>} />
            {ticket.replies.map((r) => (
              <ThreadItem
                key={r.id}
                author={r.authorEmail || 'Admin'}
                at={r.createdAt}
                body={r.body}
                internal={r.internal}
                tag={
                  r.internal ? (
                    <Badge tone="warn"><Lock className="h-3 w-3" /> Internal note</Badge>
                  ) : r.emailed ? (
                    <Badge tone="good"><Mail className="h-3 w-3" /> Emailed</Badge>
                  ) : (
                    <Badge tone="bad">Email not sent</Badge>
                  )
                }
              />
            ))}
          </div>

          <div className="space-y-2 rounded-xl p-3" style={{ border: `1px ${internal ? 'dashed' : 'solid'} var(--glass-border)`, background: internal ? 'rgba(217,119,6,0.06)' : 'var(--glass-bg)' }}>
            <Textarea
              rows={4}
              aria-label={internal ? 'Internal note' : 'Reply'}
              placeholder={internal ? 'Note for other admins (not sent to the user)…' : `Reply to ${ticket.email}…`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Checkbox checked={internal} onChange={setInternal} label="Internal note (not emailed)" />
              <Btn icon={internal ? <Lock className="h-4 w-4" /> : <Send className="h-4 w-4" />} onClick={reply} loading={sending} disabled={!body.trim()}>
                {internal ? 'Add note' : 'Send reply'}
              </Btn>
            </div>
            {!internal && <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>Sending a reply marks the ticket as waiting on the user.</p>}
          </div>
          {actionError && <ErrorBanner message={actionError} />}
        </div>
      )}
    </Modal>
  );
}

function ThreadItem({ author, at, body, tag, internal }: { author: string; at: string; body: string; tag: React.ReactNode; internal?: boolean }) {
  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{
        background: internal ? 'rgba(217,119,6,0.08)' : 'var(--glass-bg)',
        border: `1px ${internal ? 'dashed rgba(217,119,6,0.4)' : 'solid var(--glass-border)'}`,
      }}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
        <span className="font-semibold" style={{ color: 'var(--ink)' }}>{author}</span>
        <span>{fmtDateTime(at)}</span>
        <span className="flex-1" />
        {tag}
      </div>
      <p className="whitespace-pre-wrap break-words text-sm" style={{ color: 'var(--ink)' }}>{body}</p>
    </div>
  );
}
