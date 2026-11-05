'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Bug, MessageSquareText, Star } from 'lucide-react';
import {
  AdminPage,
  Badge,
  DataTable,
  ErrorBanner,
  KV,
  Modal,
  Pagination,
  SearchInput,
  StatCard,
  Tabs,
  Toolbar,
  useAdminQuery,
  useListState,
  type Column,
  type Tone,
} from '@/components/admin/kit';
import { fmtDateTime, timeAgo } from '@/lib/adminApi';

type TicketStatus = 'OPEN' | 'PENDING' | 'RESOLVED';

interface BugItem {
  kind: 'bug';
  id: string;
  createdAt: string;
  ref: string;
  from: string;
  email: string;
  role: string | null;
  subject: string;
  message: string;
  status: TicketStatus;
}

interface SessionItem {
  kind: 'session';
  id: string;
  createdAt: string;
  from: string;
  rating: number;
  callQuality: 'GOOD' | 'SOME_ISSUES' | 'POOR' | null;
  comment: string | null;
  sessionId: string;
  sessionAt: string;
  minutes: number | null;
}

type Item = BugItem | SessionItem;

interface FeedbackResponse {
  items: Item[];
  total: number;
  counts: { bug: number; session: number };
  summary: { openBugs: number; feedback30d: number; avgRating30d: number | null };
}

const STATUS_TONE: Record<TicketStatus, Tone> = { OPEN: 'bad', PENDING: 'warn', RESOLVED: 'good' };
const STATUS_LABEL: Record<TicketStatus, string> = { OPEN: 'Open', PENDING: 'Waiting on user', RESOLVED: 'Resolved' };
const QUALITY_LABEL = { GOOD: 'Clear', SOME_ISSUES: 'Some problems', POOR: 'Hard to use' } as const;
const QUALITY_TONE: Record<keyof typeof QUALITY_LABEL, Tone> = { GOOD: 'good', SOME_ISSUES: 'warn', POOR: 'bad' };
const ratingTone = (r: number): Tone => (r >= 4 ? 'good' : r === 3 ? 'warn' : 'bad');

/** The bug report text without the page/browser block the button appends. */
function splitReport(message: string) {
  const i = message.lastIndexOf('\n---\n');
  return i === -1 ? { text: message, details: '' } : { text: message.slice(0, i).trim(), details: message.slice(i + 5).trim() };
}

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={14} strokeWidth={1.6} color={n <= value ? '#e0a92e' : 'var(--ink-muted)'} fill={n <= value ? '#f5c451' : 'transparent'} />
      ))}
    </span>
  );
}

export default function AdminFeedbackPage() {
  const list = useListState({ sort: 'createdAt', dir: 'desc', filters: { type: 'all' } });
  const { data, loading, error, reload } = useAdminQuery<FeedbackResponse>(`/api/admin/feedback?${list.query}`, 'load bug reports and feedback');
  const [open, setOpen] = useState<Item | null>(null);
  const s = data?.summary;

  const columns: Column<Item>[] = [
    {
      key: 'kind',
      header: 'Type',
      render: (r) =>
        r.kind === 'bug' ? (
          <Badge tone="bad">
            <Bug className="h-3 w-3" /> Bug report
          </Badge>
        ) : (
          <Badge tone="info">
            <MessageSquareText className="h-3 w-3" /> Session feedback
          </Badge>
        ),
    },
    {
      key: 'what',
      header: 'Details',
      className: 'min-w-[300px]',
      render: (r) =>
        r.kind === 'bug' ? (
          <div className="min-w-0">
            <p className="truncate font-semibold">{r.subject}</p>
            <p className="truncate text-xs" style={{ color: 'var(--ink-muted)' }}>
              {splitReport(r.message).text}
            </p>
          </div>
        ) : (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Stars value={r.rating} />
              {r.callQuality && <Badge tone={QUALITY_TONE[r.callQuality]}>{QUALITY_LABEL[r.callQuality]}</Badge>}
            </div>
            <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--ink-muted)' }}>
              {r.comment || 'No comment'}
            </p>
          </div>
        ),
    },
    { key: 'from', header: 'From', render: (r) => <span className="text-xs">{r.from}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (r) =>
        r.kind === 'bug' ? (
          <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
        ) : (
          <Badge tone={ratingTone(r.rating)}>{r.rating}/5</Badge>
        ),
    },
    { key: 'createdAt', header: 'When', render: (r) => <span title={fmtDateTime(r.createdAt)}>{timeAgo(r.createdAt)}</span> },
  ];

  const tab = list.filters.type || 'all';
  const counts = data?.counts;

  return (
    <AdminPage
      title="Bugs & feedback"
      description="Problems reported with the Report a problem button, and how therapists rated their video sessions."
      permission="support"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Open bug reports" value={s ? s.openBugs : '—'} icon={<Bug className="h-4 w-4" />} />
        <StatCard
          label="Average session rating"
          value={s?.avgRating30d != null ? `${s.avgRating30d} / 5` : '—'}
          hint="Last 30 days"
          icon={<Star className="h-4 w-4" />}
        />
        <StatCard label="Session feedback" value={s ? s.feedback30d : '—'} hint="Answers in the last 30 days" icon={<MessageSquareText className="h-4 w-4" />} />
      </div>

      <Tabs<string>
        value={tab}
        onChange={(v) => list.setFilter('type', v)}
        tabs={[
          { value: 'all', label: `All${counts && tab === 'all' ? ` (${counts.bug + counts.session})` : ''}` },
          { value: 'bug', label: `Bug reports${counts && tab !== 'session' ? ` (${counts.bug})` : ''}` },
          { value: 'session', label: `Session feedback${counts && tab !== 'bug' ? ` (${counts.session})` : ''}` },
        ]}
      />
      <Toolbar>
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Search reports and comments…" />
      </Toolbar>
      {error && <ErrorBanner message={error} onRetry={reload} />}
      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(r) => `${r.kind}:${r.id}`}
        loading={loading}
        onRowClick={setOpen}
        empty="Nothing here yet."
      />
      <Pagination page={list.page} pageSize={list.pageSize} total={data?.total ?? 0} onPage={list.setPage} />

      <Modal
        open={!!open}
        onClose={() => setOpen(null)}
        wide
        title={open?.kind === 'bug' ? open.subject : 'Session feedback'}
        description={open ? `${open.from} · ${fmtDateTime(open.createdAt)}` : undefined}
        footer={
          open?.kind === 'bug' ? (
            <Link href="/admin/support" className="text-sm font-semibold underline" style={{ color: 'var(--sage)' }}>
              Reply or change status in the Support inbox ({open.ref})
            </Link>
          ) : undefined
        }
      >
        {open?.kind === 'bug' &&
          (() => {
            const { text, details } = splitReport(open.message);
            return (
              <>
                <KV
                  items={[
                    { label: 'Ref', value: open.ref },
                    { label: 'Status', value: <Badge tone={STATUS_TONE[open.status]}>{STATUS_LABEL[open.status]}</Badge> },
                    { label: 'From', value: `${open.from}${open.role ? ` (${open.role.toLowerCase()})` : ''}` },
                  ]}
                />
                <p className="whitespace-pre-wrap text-sm" style={{ color: 'var(--ink)' }}>
                  {text}
                </p>
                {details && (
                  <pre className="whitespace-pre-wrap break-all rounded-xl p-3 text-xs" style={{ background: 'var(--glass-bg)', color: 'var(--ink-muted)' }}>
                    {details}
                  </pre>
                )}
              </>
            );
          })()}
        {open?.kind === 'session' && (
          <>
            <KV
              items={[
                { label: 'Rating', value: <Stars value={open.rating} /> },
                { label: 'Video and sound', value: open.callQuality ? QUALITY_LABEL[open.callQuality] : 'Not answered' },
                { label: 'Session', value: `${fmtDateTime(open.sessionAt)}${open.minutes != null ? ` · ${open.minutes} min` : ''}` },
              ]}
            />
            <p className="whitespace-pre-wrap text-sm" style={{ color: 'var(--ink)' }}>
              {open.comment || 'No comment.'}
            </p>
          </>
        )}
      </Modal>
    </AdminPage>
  );
}
