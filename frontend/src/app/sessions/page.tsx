'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useNow, usePracticeData, useTherapistGuard } from '@/hooks/usePracticeData';
import { StaadShell } from '@/components/staad/Shell';
import { TopBar } from '@/components/staad/TopBar';
import { SessionCard } from '@/components/staad/SessionCard';
import {
  Badge,
  Btn,
  Chips,
  EmptyCard,
  InlineError,
  SearchBox,
  Section,
  SkeletonCard,
  cx,
} from '@/components/staad/parts';
import {
  IconArrowRightXs,
  IconDownload,
  IconPlus,
  IconSessions,
} from '@/components/staad/icons';
import { StartSessionDialog, AddClientDialog } from '@/components/practice/dialogs';
import { useSessionActions } from '@/components/practice/useSessionActions';
import SessionReportDrawer from '@/components/report/SessionReportDrawer';
import { Sparkles } from 'lucide-react';
import {
  SESSION_KIND,
  byStartAsc,
  downloadFile,
  fmtListDate,
  fmtSessionNo,
  fmtTime,
  fullName,
  hasDocs,
  initials,
  sessionDuration,
  sessionNumbers,
  sessionState,
  toCsv,
  type PracticeSession,
} from '@/lib/practice';

type Tab = 'all' | 'completed' | 'upcoming' | 'notes-pending';
const GRID = '1.9fr 1fr 1fr 1.1fr 150px';

export default function SessionsPage() {
  return (
    <Suspense fallback={null}>
      <SessionsInner />
    </Suspense>
  );
}

function SessionsInner() {
  useTherapistGuard();
  const now = useNow(30_000);
  const params = useSearchParams();
  const { sessions, bookings, clients, loading, error, refresh } = usePracticeData();
  const actions = useSessionActions(refresh);

  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [startOpen, setStartOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const [reportFor, setReportFor] = useState<PracticeSession | null>(null);

  // deep link from the Dashboard's "Pending Session Notes" card
  useEffect(() => {
    const view = params.get('view');
    if (view === 'notes-pending' || view === 'completed' || view === 'upcoming') setTab(view as Tab);
  }, [params]);

  const numbers = useMemo(() => sessionNumbers(sessions), [sessions]);

  const rows = useMemo(
    () =>
      sessions
        .filter((s) => s.status !== 'CANCELLED')
        .map((s) => {
          const minutes = sessionDuration(s, bookings);
          return { s, minutes, state: sessionState(s, now, minutes), filed: hasDocs(s) };
        })
        .sort((a, b) => new Date(b.s.scheduledAt).getTime() - new Date(a.s.scheduledAt).getTime()),
    [sessions, bookings, now]
  );

  const counts = {
    all: rows.length,
    completed: rows.filter((r) => r.s.status === 'COMPLETED').length,
    upcoming: rows.filter((r) => r.state === 'upcoming').length,
    'notes-pending': rows.filter((r) => r.s.status === 'COMPLETED' && !r.filed).length,
  };

  const q = search.trim().toLowerCase();
  const inTab = (r: (typeof rows)[number]) =>
    tab === 'all' ||
    (tab === 'completed' && r.s.status === 'COMPLETED') ||
    (tab === 'upcoming' && r.state === 'upcoming') ||
    (tab === 'notes-pending' && r.s.status === 'COMPLETED' && !r.filed);

  const filtered = rows
    .filter(inTab)
    .filter((r) => !q || [fullName(r.s.client), ...(r.s.client?.diagnosis ?? [])].some((v) => String(v).toLowerCase().includes(q)));

  const liveRow = rows.find((r) => r.state === 'live');
  const pendingQueue = rows.filter((r) => r.s.status === 'COMPLETED' && !r.filed).slice(0, 6);

  const exportCsv = () => {
    const header = ['Client', 'Date', 'Time', 'Length (min)', 'Status', 'Notes'];
    const body = filtered.map((r) => [
      fullName(r.s.client) || 'Client',
      fmtListDate(r.s.scheduledAt),
      fmtTime(r.s.scheduledAt),
      r.minutes,
      r.s.status,
      r.filed ? 'Filed' : 'Pending',
    ]);
    downloadFile('staad-sessions.csv', toCsv([header, ...body]), 'text/csv');
  };

  const monthLabel = now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <StaadShell>
      <TopBar sessions={sessions} />

      <PageHeadSessions
        monthLabel={monthLabel}
        onExport={exportCsv}
        onNew={() => setStartOpen(true)}
        canExport={filtered.length > 0}
      />

      {error && <InlineError message={error} onRetry={refresh} />}

      <div className="toolbar">
        <Chips<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { key: 'all', label: 'All', count: counts.all },
            { key: 'completed', label: 'Completed', count: counts.completed },
            { key: 'upcoming', label: 'Upcoming', count: counts.upcoming },
            { key: 'notes-pending', label: 'Notes pending', count: counts['notes-pending'] },
          ]}
        />
        <span style={{ flex: 1 }} />
        <div style={{ maxWidth: 320, flex: 1, display: 'flex' }}>
          <SearchBox value={search} onChange={setSearch} placeholder="Search sessions" label="Search sessions" />
        </div>
      </div>

      <div className="cols">
        <div className="left">
          {liveRow && (
            <Section title="In session now" sub={`Started ${fmtTime(liveRow.s.scheduledAt)}, room is open`}>
              <SessionCard
                s={liveRow.s}
                no={numbers.get(liveRow.s.id)}
                now={now}
                minutes={liveRow.minutes}
                actions={actions}
                tone="lime"
              />
            </Section>
          )}

          <Section
            title={liveRow ? 'Earlier sessions' : 'All sessions'}
            sub={
              loading
                ? 'Loading…'
                : `${counts.completed} completed, ${counts['notes-pending']} still open`
            }
          >
            <div className="lhead" style={{ gridTemplateColumns: GRID }}>
              <span>Client</span>
              <span>Date</span>
              <span>Length</span>
              <span>Notes</span>
              <span />
            </div>

            {loading ? (
              <div className="list">
                <SkeletonCard height={74} />
                <SkeletonCard height={74} />
                <SkeletonCard height={74} />
              </div>
            ) : filtered.length === 0 ? (
              <EmptyCard
                mark={<IconSessions />}
                title={rows.length === 0 ? 'No sessions yet' : 'Nothing matches that'}
                body={
                  rows.length === 0
                    ? 'Start a session or book one, and it will be listed here.'
                    : 'Try another search term or filter.'
                }
                action={
                  rows.length === 0 ? (
                    <Btn icon={<IconPlus />} variant="primary" onClick={() => setStartOpen(true)}>
                      New Session
                    </Btn>
                  ) : (
                    <Btn
                      onClick={() => {
                        setSearch('');
                        setTab('all');
                      }}
                    >
                      Clear filters
                    </Btn>
                  )
                }
              />
            ) : (
              <div className="list">
                {filtered.map(({ s, minutes, state, filed }) => {
                  const no = numbers.get(s.id);
                  return (
                    <article
                      key={s.id}
                      className={cx('lrow', state === 'live' && 'lrow--lime')}
                      style={{ gridTemplateColumns: GRID }}
                    >
                      <div className="lwho">
                        <span className="av av--client av--sm">
                          {initials(s.client?.firstName, s.client?.lastName) || '—'}
                        </span>
                        <span className="lcell">
                          <span className="lname">{fullName(s.client) || 'Client'}</span>
                          <span className="lsub">
                            {[SESSION_KIND, no ? fmtSessionNo(no) : null].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                      </div>

                      <div className="lcell">
                        <span className="lval">{fmtListDate(s.scheduledAt)}</span>
                        <br />
                        <span className="lsub">{fmtTime(s.scheduledAt)}</span>
                      </div>

                      <div className="lcell">
                        <span className="lval">{minutes} min</span>
                      </div>

                      <div className="lcell">
                        {s.status === 'COMPLETED' ? (
                          filed ? (
                            <Badge tone="green">Filed</Badge>
                          ) : (
                            <Badge tone="red" dot>
                              Pending
                            </Badge>
                          )
                        ) : (
                          <Badge tone="gray">{state === 'missed' ? 'Missed' : 'Scheduled'}</Badge>
                        )}
                      </div>

                      <div className="lend" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {s.status === 'COMPLETED' && (
                          <button
                            type="button"
                            className="ds-btn ds-btn-sm ds-btn-clay"
                            onClick={() => setReportFor(s)}
                            style={{ padding: '0.25rem 0.5rem', minHeight: 'unset', height: '32px' }}
                          >
                            <Sparkles style={{ width: '14px', height: '14px' }} /> Report
                          </button>
                        )}
                        <button
                          type="button"
                          className="nbtn arrow"
                          aria-label={`Open ${fullName(s.client) || 'client'}'s session`}
                          onClick={() => (s.status === 'COMPLETED' ? actions.openNotes(s) : actions.enter(s))}
                        >
                          <IconArrowRightXs />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </Section>
        </div>

        <aside className="panel">
          <div>
            <h2 className="panel__t">Notes Queue</h2>
            <p className="panel__s">Write these up before they go cold</p>
            <Link className="vlink vlink--onpanel" href="/clients">
              <span>View All Clients</span>
              <span className="vlink__disc">
                <IconArrowRightXs />
              </span>
            </Link>
          </div>

          <div className="panel__rows">
            {loading ? (
              <SkeletonCard height={70} />
            ) : pendingQueue.length === 0 ? (
              <p className="panel__s">Nothing waiting — every completed session has its notes.</p>
            ) : (
              pendingQueue.map(({ s }) => {
                const days = Math.floor((now.getTime() - new Date(s.scheduledAt).getTime()) / 86_400_000);
                const no = numbers.get(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    className="prow as-button"
                    style={{ width: '100%', textAlign: 'left' }}
                    onClick={() => actions.openNotes(s)}
                  >
                    <span className="av av--client av--sm">
                      {initials(s.client?.firstName, s.client?.lastName) || '—'}
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="prow__t">{fullName(s.client) || 'Client'}</span>
                      <span className="prow__s">
                        {[fmtListDate(s.scheduledAt), no ? fmtSessionNo(no) : null].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className={cx('badge', days <= 0 && 'badge--onpanel')}>
                      {days <= 0 ? 'Today' : `${days}d late`}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <span className="panel__glow" />
        </aside>
      </div>

      <StartSessionDialog
        open={startOpen}
        onOpenChange={setStartOpen}
        clients={clients}
        sessions={sessions}
        onAddClient={() => {
          setStartOpen(false);
          setAddOpen(true);
        }}
      />
      <AddClientDialog open={addOpen} onOpenChange={setAddOpen} onCreated={refresh} />
      {actions.dialogs}

      <SessionReportDrawer session={reportFor} onClose={() => setReportFor(null)} />
    </StaadShell>
  );
}

function PageHeadSessions({
  monthLabel,
  onExport,
  onNew,
  canExport,
}: {
  monthLabel: string;
  onExport: () => void;
  onNew: () => void;
  canExport: boolean;
}) {
  return (
    <div className="phead">
      <div>
        <div className="eyebrow">{monthLabel}</div>
        <h1 className="phead__title">Sessions</h1>
        <p className="phead__lead">Every session you&apos;ve run, and the notes each one is still waiting on.</p>
      </div>
      <div className="phead__acts">
        <Btn icon={<IconDownload />} onClick={onExport} disabled={!canExport}>
          Export
        </Btn>
        <Btn icon={<IconPlus />} variant="primary" onClick={onNew}>
          New Session
        </Btn>
      </div>
    </div>
  );
}
