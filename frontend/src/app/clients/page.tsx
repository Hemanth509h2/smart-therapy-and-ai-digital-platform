'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useNow, usePracticeData, useTherapistGuard } from '@/hooks/usePracticeData';
import { StaadShell } from '@/components/staad/Shell';
import { TopBar } from '@/components/staad/TopBar';
import {
  Btn,
  Chips,
  EmptyCard,
  InlineError,
  PageHead,
  SearchBox,
  SkeletonCard,
  cx,
} from '@/components/staad/parts';
import { IconClients, IconUserPlus } from '@/components/staad/icons';
import { AddClientDialog } from '@/components/practice/dialogs';
import {
  clientStatus,
  focusArea,
  fullName,
  initials,
  sessionClientId,
  sessionDuration,
  sessionState,
  type PracticeClient,
} from '@/lib/practice';

type Tab = 'all' | 'active' | 'upcoming' | 'follow-up';

export default function ClientsPage() {
  useTherapistGuard();
  const router = useRouter();
  const now = useNow(30_000);
  const { sessions, bookings, clients, loading, error, refresh } = usePracticeData();

  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const rows = useMemo(
    () =>
      clients.map((c) => {
        const mine = sessions.filter((s) => sessionClientId(s) === c.id && s.status !== 'CANCELLED');
        return {
          c,
          status: clientStatus(c, sessions, bookings, now),
          live:
            mine.find((s) => sessionState(s, now, sessionDuration(s, bookings)) === 'live') ?? null,
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

  const openClient = (c: PracticeClient) => router.push(`/clients/${c.id}`);

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
        {loading ? (
          <div className="cgrid">
            <SkeletonCard height={196} />
            <SkeletonCard height={196} />
            <SkeletonCard height={196} />
            <SkeletonCard height={196} />
            <SkeletonCard height={196} />
            <SkeletonCard height={196} />
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
          <div className="cgrid">
            {filtered.map(({ c, status, live }) => (
              <button
                key={c.id}
                type="button"
                className={cx('ccard', live && 'ccard--live')}
                onClick={() => openClient(c)}
              >
                <span className="av av--client ccard__av">{initials(c.firstName, c.lastName) || '—'}</span>
                <span className="ccard__name">
                  {fullName(c) || 'Client'}
                  <span
                    className={cx('dot', live || status !== 'follow-up' ? 'dot--lime' : 'dot--hard')}
                    title={live ? 'Live now' : status === 'follow-up' ? 'Needs follow-up' : 'Active'}
                  />
                </span>
                <span className="ccard__focus">{focusArea(c)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <AddClientDialog open={addOpen} onOpenChange={setAddOpen} onCreated={refresh} />
    </StaadShell>
  );
}
