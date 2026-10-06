'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useNow, usePracticeData, useTherapistGuard } from '@/hooks/usePracticeData';
import { StaadShell } from '@/components/staad/Shell';
import { TopBar } from '@/components/staad/TopBar';
import {
  Badge,
  Btn,
  Chips,
  EmptyCard,
  InlineError,
  Notch,
  NotchLink,
  PageHead,
  SearchBox,
  SkeletonCard,
  StaadMenu,
  cx,
} from '@/components/staad/parts';
import {
  IconClients,
  IconStatA,
  IconStatB,
  IconStatE,
  IconUserPlus,
} from '@/components/staad/icons';
import { AddClientDialog, BookSessionDialog, StartSessionDialog } from '@/components/practice/dialogs';
import { useSessionActions } from '@/components/practice/useSessionActions';
import {
  CLIENT_STATUS_META,
  SESSION_KIND,
  byStartAsc,
  clientStatus,
  countdown,
  fmtListDate,
  fmtSessionNo,
  fmtTime,
  fullName,
  hasDocs,
  initials,
  newClientsSince,
  nextSessionFor,
  sessionClientId,
  sessionDuration,
  sessionNumbers,
  sessionState,
  startOfDay,
  type PracticeClient,
  type PracticeSession,
} from '@/lib/practice';

type Tab = 'all' | 'active' | 'upcoming' | 'follow-up';
const GRID = '2.2fr 1.1fr 1.1fr 1fr 96px';
const PAGE_SIZE = 8;

export default function ClientsPage() {
  useTherapistGuard();
  const now = useNow(30_000);
  const { sessions, bookings, clients, loading, error, refresh } = usePracticeData();
  const actions = useSessionActions(refresh);

  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [book, setBook] = useState<{ open: boolean; clientId?: string }>({ open: false });
  const [start, setStart] = useState<{ open: boolean; clientId?: string }>({ open: false });

  useEffect(() => setPage(1), [tab, search]);

  const numbers = useMemo(() => sessionNumbers(sessions), [sessions]);

  const rows = useMemo(
    () =>
      clients.map((c) => {
        const mine = sessions
          .filter((s) => sessionClientId(s) === c.id && s.status !== 'CANCELLED')
          .sort(byStartAsc);
        const past = mine.filter((s) => new Date(s.scheduledAt) < startOfDay(now) || s.status === 'COMPLETED');
        return {
          c,
          status: clientStatus(c, sessions, bookings, now),
          last: past[past.length - 1] ?? null,
          next: nextSessionFor(c.id, sessions, now),
          live: mine.find((s) => sessionState(s, now, sessionDuration(s, bookings)) === 'live') ?? null,
          count: mine.length,
        };
      }),
    [clients, sessions, bookings, now]
  );

  const counts = {
    all: rows.length,
    active: rows.filter((r) => r.status === 'active').length,
    upcoming: rows.filter((r) => r.status === 'upcoming').length,
    'follow-up': rows.filter((r) => r.status === 'follow-up').length,
  };

  const q = search.trim().toLowerCase();
  const filtered = rows
    .filter((r) => tab === 'all' || r.status === tab)
    .filter(
      (r) =>
        !q ||
        [fullName(r.c), r.c.user?.email ?? '', ...(r.c.diagnosis ?? [])].some((v) =>
          String(v).toLowerCase().includes(q)
        )
    );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const seenThisMonth = clients.filter((c) =>
    sessions.some(
      (s) =>
        sessionClientId(s) === c.id && s.status === 'COMPLETED' && new Date(s.scheduledAt) >= monthStart
    )
  ).length;
  const pendingNotes = sessions.filter((s) => s.status === 'COMPLETED' && !hasDocs(s));
  const pendingClients = new Set(pendingNotes.map(sessionClientId)).size;
  const newThisMonth = newClientsSince(clients, sessions, monthStart);

  const openBook = (clientId?: string) => setBook({ open: true, clientId });

  const menuFor = (c: PracticeClient, next: PracticeSession | null) => [
    { label: 'View client', onClick: () => actions.viewClient(c.id) },
    { label: 'Book a session', onClick: () => openBook(c.id) },
    {
      label: next?.status === 'ACTIVE' ? 'Join session' : 'Start a session',
      onClick: () => (next?.status === 'ACTIVE' ? actions.enter(next) : setStart({ open: true, clientId: c.id })),
    },
  ];

  return (
    <StaadShell>
      <TopBar sessions={sessions} />

      <PageHead
        eyebrow="Your caseload"
        title="Clients"
        lead="Everyone you're working with, and what each one is waiting on."
        actions={
          <Btn icon={<IconUserPlus />} variant="primary" onClick={() => setAddOpen(true)}>
            Add Client
          </Btn>
        }
      />

      {error && <InlineError message={error} onRetry={refresh} />}

      <div className="stats stats--3">
        {loading ? (
          <>
            <SkeletonCard height={160} />
            <SkeletonCard height={160} />
            <SkeletonCard height={160} />
          </>
        ) : (
          <>
            <article className="card stat" style={{ minHeight: 160 }}>
              <div className="stat__head">
                <span className="stat__ic">
                  <IconStatA />
                </span>
              </div>
              <div>
                <div className="stat__label">Total Clients</div>
                <div className="stat__row">
                  <span className="stat__num">{clients.length}</span>
                  <span className="stat__meta">
                    {newThisMonth > 0 && <Badge tone="green">+{newThisMonth}</Badge>}
                    <span className="stat__cap">{newThisMonth > 0 ? 'Since last month' : 'No new clients yet'}</span>
                  </span>
                </div>
              </div>
            </article>

            <article className="card stat" style={{ minHeight: 160 }}>
              <div className="stat__head">
                <span className="stat__ic">
                  <IconStatE />
                </span>
                <span className="steps">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <i key={i} className={i < Math.round((seenThisMonth / Math.max(clients.length, 1)) * 5) ? 'on' : undefined} />
                  ))}
                </span>
              </div>
              <div>
                <div className="stat__label">Seen This Month</div>
                <div className="stat__row">
                  <span className="stat__num">{seenThisMonth}</span>
                  <span className="stat__meta">
                    <Badge tone="gray">of {clients.length}</Badge>
                    <span className="stat__cap">
                      {clients.length - seenThisMonth > 0
                        ? `${clients.length - seenThisMonth} not yet seen`
                        : 'Everyone seen'}
                    </span>
                  </span>
                </div>
              </div>
            </article>

            <article className={cx('card stat', pendingNotes.length > 0 && 'card--lime')} style={{ minHeight: 160 }}>
              <Notch>
                <NotchLink href="/sessions?view=notes-pending" label="Open pending notes" />
              </Notch>
              <div className="stat__head">
                <span className="stat__ic">
                  <IconStatB />
                </span>
              </div>
              <div>
                <div className="stat__label">Notes Pending</div>
                <div className="stat__row">
                  <span className="stat__num">{pendingNotes.length}</span>
                  <span className="stat__meta">
                    {pendingNotes.length > 0 && (
                      <span className="badge badge--solid">
                        <span className="dot dot--hard" />
                      </span>
                    )}
                    <span className="stat__cap">
                      {pendingNotes.length > 0 ? `Across ${pendingClients} client${pendingClients === 1 ? '' : 's'}` : 'All caught up'}
                    </span>
                  </span>
                </div>
              </div>
            </article>
          </>
        )}
      </div>

      <div className="toolbar">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search clients by name or focus area"
          label="Search clients"
        />
        <Chips<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { key: 'all', label: 'All', count: counts.all },
            { key: 'active', label: 'Active', count: counts.active },
            { key: 'upcoming', label: 'Upcoming', count: counts.upcoming },
            { key: 'follow-up', label: 'Follow-up', count: counts['follow-up'] },
          ]}
        />
      </div>

      <section>
        <div className="lhead" style={{ gridTemplateColumns: GRID }}>
          <span>Client</span>
          <span>Last session</span>
          <span>Next session</span>
          <span>Status</span>
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
            mark={<IconClients />}
            title={clients.length === 0 ? 'No clients yet' : 'Nothing matches that'}
            body={
              clients.length === 0
                ? 'Add your first client and they will appear here with their sessions.'
                : 'Try a different search term or filter.'
            }
            action={
              clients.length === 0 ? (
                <Btn icon={<IconUserPlus />} variant="primary" onClick={() => setAddOpen(true)}>
                  Add Client
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
          <>
            <div className="list">
              {pageRows.map(({ c, status, last, next, live, count }) => {
                const meta = CLIENT_STATUS_META[status];
                const cd = live ? countdown(live.scheduledAt, now) : null;
                const no = last ? numbers.get(last.id) : undefined;
                return (
                  <article
                    key={c.id}
                    className={cx('lrow', live && 'lrow--lime')}
                    style={{ gridTemplateColumns: GRID }}
                  >
                    <div className="lwho">
                      <span className="av av--client">{initials(c.firstName, c.lastName) || '—'}</span>
                      <span className="lcell">
                        <span className="lname">{fullName(c) || 'Client'}</span>
                        <span className="lsub">
                          {[c.diagnosis?.[0], count ? fmtSessionNo(no ?? count) : null].filter(Boolean).join(' · ') ||
                            'No sessions yet'}
                        </span>
                      </span>
                    </div>

                    <div className="lcell">
                      <span className="lval">{last ? fmtListDate(last.scheduledAt) : 'None yet'}</span>
                      <br />
                      <span className="lsub">{last ? SESSION_KIND : '—'}</span>
                    </div>

                    <div className="lcell">
                      <span className="lval">
                        {live ? 'In session' : next ? fmtListDate(next.scheduledAt) : 'Not booked'}
                      </span>
                      <br />
                      <span className="lsub">
                        {live
                          ? cd
                            ? `${cd.value} ${cd.unit} left`
                            : 'now'
                          : next
                            ? fmtTime(next.scheduledAt)
                            : 'Needs a slot'}
                      </span>
                    </div>

                    <div className="lcell">
                      {live ? (
                        <span className="badge badge--solid">
                          <span className="dot dot--hard" />
                          Live
                        </span>
                      ) : (
                        <Badge tone={meta.tone} dot={meta.tone === 'red'}>
                          {meta.label}
                        </Badge>
                      )}
                    </div>

                    <div className="lend">
                      <StaadMenu label={`More options for ${fullName(c)}`} items={menuFor(c, next)} />
                    </div>
                  </article>
                );
              })}
            </div>

            {pageCount > 1 && (
              <div className="toolbar" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
                <Btn sm disabled={currentPage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Previous
                </Btn>
                <span className="lsub">
                  Page {currentPage} of {pageCount}
                </span>
                <Btn sm disabled={currentPage === pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                  Next
                </Btn>
              </div>
            )}
          </>
        )}
      </section>

      <AddClientDialog open={addOpen} onOpenChange={setAddOpen} onCreated={refresh} />
      <BookSessionDialog
        open={book.open}
        onOpenChange={(open) => setBook((b) => ({ ...b, open }))}
        clients={clients}
        defaultClientId={book.clientId}
        onBooked={refresh}
        onAddClient={() => {
          setBook({ open: false });
          setAddOpen(true);
        }}
      />
      <StartSessionDialog
        open={start.open}
        onOpenChange={(open) => setStart((s) => ({ ...s, open }))}
        clients={clients}
        sessions={sessions}
        defaultClientId={start.clientId}
        onAddClient={() => {
          setStart({ open: false });
          setAddOpen(true);
        }}
      />
      {actions.dialogs}
    </StaadShell>
  );
}
