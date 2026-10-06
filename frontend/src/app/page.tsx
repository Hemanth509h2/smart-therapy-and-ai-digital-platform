'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/store/useAuthStore';
import { useNow, usePracticeData, useTherapistGuard } from '@/hooks/usePracticeData';
import { StaadShell } from '@/components/staad/Shell';
import { TopBar } from '@/components/staad/TopBar';
import { SessionCard } from '@/components/staad/SessionCard';
import {
  Btn,
  EmptyCard,
  InlineError,
  Notch,
  NotchLink,
  Section,
  SkeletonCard,
  StaadMenu,
  cx,
} from '@/components/staad/parts';
import {
  IconArrowRightXs,
  IconCalendarPlus,
  IconModules,
  IconNoteAdd,
  IconPlus,
  IconSchTile,
  IconStatA,
  IconStatB,
  IconStatE,
  IconStatF,
  IconTrendUp,
  IconUserPlus,
} from '@/components/staad/icons';
import { AddClientDialog, BookSessionDialog, StartSessionDialog } from '@/components/practice/dialogs';
import { useSessionActions } from '@/components/practice/useSessionActions';
import {
  SESSION_KIND,
  byStartAsc,
  clientFocus,
  countdown,
  fmtDay,
  fmtSessionNo,
  fmtTime,
  fullName,
  greeting,
  hasDocs,
  initials,
  isSameDay,
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

/** Quick links into the module library. Labels are UI copy; every href is a real route. */
const TOOLKIT = [
  { label: 'CBT Activities', sub: 'Thought work', href: '/modules?category=CBT' },
  { label: 'DBT Skills', sub: 'Regulation', href: '/modules?category=DBT' },
  { label: 'Grounding', sub: 'Calm the body', href: '/modules?q=grounding' },
  { label: 'Breathing', sub: 'Slow it down', href: `/modules?category=${encodeURIComponent('Anxiety & Depression')}` },
];

/** The design's little progress pips. */
const Steps = ({ filled, total = 5 }: { filled: number; total?: number }) => (
  <span className="steps">
    {Array.from({ length: total }).map((_, i) => (
      <i key={i} className={i < filled ? 'on' : undefined} />
    ))}
  </span>
);

export default function DashboardPage() {
  useTherapistGuard();
  const { profile } = useAuthStore();
  const now = useNow(30_000);
  const { sessions, bookings, clients, loading, error, refresh } = usePracticeData();
  const actions = useSessionActions(refresh);

  const [addOpen, setAddOpen] = useState(false);
  const [book, setBook] = useState<{ open: boolean; clientId?: string }>({ open: false });
  const [start, setStart] = useState<{ open: boolean; clientId?: string }>({ open: false });

  const live = useMemo(() => {
    const active = sessions.filter((s) => s.status !== 'CANCELLED');
    const today = active.filter((s) => isSameDay(new Date(s.scheduledAt), now));
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const completedThisMonth = active.filter(
      (s) => s.status === 'COMPLETED' && new Date(s.scheduledAt) >= monthStart
    ).length;
    const pendingNotes = active.filter((s) => s.status === 'COMPLETED' && !hasDocs(s));
    const upcoming = active
      .filter((s) => ['upcoming', 'live'].includes(sessionState(s, now, sessionDuration(s, bookings))))
      .sort(byStartAsc);

    const featured =
      today.find((s) => sessionState(s, now, sessionDuration(s, bookings)) === 'live') ??
      today.filter((s) => sessionState(s, now, sessionDuration(s, bookings)) === 'upcoming').sort(byStartAsc)[0] ??
      [...today].sort(byStartAsc)[0];

    const focus = clients
      .map((c) => ({ c, f: clientFocus(c, sessions, bookings, now) }))
      .sort((a, b) => a.f.rank - b.f.rank)
      .slice(0, 4);

    return {
      today,
      todayDone: today.filter((s) => s.status === 'COMPLETED').length,
      completedThisMonth,
      pendingNotes,
      next: upcoming.find((s) => !featured || s.id !== featured.id) ?? null,
      featured,
      focus,
      newThisMonth: newClientsSince(clients, sessions, monthStart),
      numbers: sessionNumbers(sessions),
    };
  }, [sessions, bookings, clients, now]);

  const openBook = (clientId?: string) => setBook({ open: true, clientId });
  const firstName = profile?.firstName || fullName(profile) || 'there';

  const stats = [
    {
      key: 'today',
      Icon: IconStatE,
      label: "Today's Sessions",
      value: live.today.length,
      filled: live.todayDone,
      total: Math.max(live.today.length, 1),
      badge: live.today.length ? `${live.todayDone}/${live.today.length}` : null,
      cap: live.today.length ? 'Scheduled for today' : 'Nothing booked today',
      href: '/sessions',
      aria: "Open today's sessions",
    },
    {
      key: 'clients',
      Icon: IconStatA,
      label: 'Active Clients',
      value: clients.length,
      filled: Math.min(clients.length, 5),
      total: 5,
      badgeIcon: live.newThisMonth > 0,
      cap: live.newThisMonth > 0 ? `+${live.newThisMonth} new this month` : 'No new clients this month',
      href: '/clients',
      aria: 'Open active clients',
    },
    {
      key: 'completed',
      Icon: IconStatF,
      label: 'Sessions Completed',
      value: live.completedThisMonth,
      filled: Math.min(live.completedThisMonth, 5),
      total: 5,
      badge: live.today.length ? `${Math.round((live.todayDone / Math.max(live.today.length, 1)) * 100)}%` : null,
      cap: 'This month',
      href: '/sessions',
      aria: 'Open sessions completed',
    },
  ];

  return (
    <StaadShell>
      <TopBar sessions={sessions} />

      <div className="hero">
        <div className="hero__left">
          <span className="av av--xl av--user">{initials(profile?.firstName, profile?.lastName) || '—'}</span>
          <div>
            <div className="eyebrow">{greeting(now)},</div>
            <h1 className="hero__title">
              <span className="hero__dot" />
              <span className="hero__t">{firstName}</span>
            </h1>
            <p className="hero__lead">Here&apos;s what your therapy day looks like.</p>
          </div>
        </div>
        <div className="hero__acts">
          <Btn icon={<IconUserPlus />} onClick={() => setAddOpen(true)}>
            Add Client
          </Btn>
          <Btn icon={<IconCalendarPlus />} onClick={() => openBook()}>
            Book Appointment
          </Btn>
          <Btn icon={<IconPlus />} variant="primary" onClick={() => setStart({ open: true })}>
            New Session
          </Btn>
        </div>
      </div>

      {error && <InlineError message={error} onRetry={refresh} />}

      <div className="stats">
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
          <>
            {stats.map((s) => (
              <article className="card stat" key={s.key}>
                <Notch>
                  <NotchLink href={s.href} label={s.aria} />
                </Notch>
                <div className="stat__head">
                  <span className="stat__ic">
                    <s.Icon />
                  </span>
                  <Steps filled={s.filled} total={s.total} />
                </div>
                <div>
                  <div className="stat__label">{s.label}</div>
                  <div className="stat__row">
                    <span className="stat__num">{s.value}</span>
                    <span className="stat__meta">
                      {(s.badge || s.badgeIcon) && (
                        <span className="badge badge--ok">{s.badgeIcon ? <IconTrendUp /> : s.badge}</span>
                      )}
                      <span className="stat__cap">{s.cap}</span>
                    </span>
                  </div>
                </div>
              </article>
            ))}

            {/* Pending notes takes the lime treatment only when it actually needs attention. */}
            <article className={cx('card stat', live.pendingNotes.length > 0 && 'card--lime')}>
              <Notch>
                <NotchLink href="/sessions?view=notes-pending" label="Open pending session notes" />
              </Notch>
              <div className="stat__head">
                <span className="stat__ic">
                  <IconStatB />
                </span>
                <Steps filled={Math.min(live.pendingNotes.length, 5)} />
              </div>
              <div>
                <div className="stat__label">Pending Session Notes</div>
                <div className="stat__row">
                  <span className="stat__num">{live.pendingNotes.length}</span>
                  <span className="stat__meta">
                    {live.pendingNotes.length > 0 && (
                      <span className="badge badge--solid">
                        <span className="dot dot--hard" />
                      </span>
                    )}
                    <span className="stat__cap">
                      {live.pendingNotes.length > 0 ? 'Need your attention' : 'All caught up'}
                    </span>
                  </span>
                </div>
              </div>
            </article>
          </>
        )}
      </div>

      <div className="cols">
        <div className="left">
          <div className="row1">
            <Section
              title="Today's Schedule"
              sub="Your appointments for today"
              link={{ href: '/schedule', label: 'View Full Schedule' }}
            >
              {loading ? (
                <SkeletonCard height={300} />
              ) : live.featured ? (
                <SessionCard
                  s={live.featured}
                  no={live.numbers.get(live.featured.id)}
                  now={now}
                  minutes={sessionDuration(live.featured, bookings)}
                  actions={actions}
                  tone="lime"
                />
              ) : (
                <EmptyCard
                  mark={<IconSchTile />}
                  title="No sessions today"
                  body="When you book an appointment for today it will appear here."
                  notch={<NotchLink href="/schedule" label="Book appointment" />}
                  action={
                    <Btn icon={<IconCalendarPlus />} variant="primary" onClick={() => openBook()}>
                      Book Appointment
                    </Btn>
                  }
                />
              )}
            </Section>

            <Section title="Next Session">
              {loading ? (
                <SkeletonCard height={300} />
              ) : live.next ? (
                <NextSession
                  s={live.next}
                  no={live.numbers.get(live.next.id)}
                  now={now}
                  onEnter={() => actions.enter(live.next!)}
                  onView={() => actions.viewClient(sessionClientId(live.next!))}
                />
              ) : (
                <EmptyCard
                  mark={<IconCalendarPlus />}
                  title="Nothing booked yet"
                  body="Book your next appointment and it will show up here."
                  notch={<NotchLink href="/schedule" label="Book appointment" />}
                  action={
                    <Btn icon={<IconCalendarPlus />} variant="primary" onClick={() => openBook()}>
                      Book Appointment
                    </Btn>
                  }
                />
              )}
            </Section>
          </div>

          <Section
            title="Therapy Toolkit"
            sub="Quick access to therapeutic tools"
            link={{ href: '/modules', label: 'View All Tools' }}
          >
            <div className="tools">
              {TOOLKIT.map((t) => (
                <Link key={t.href} href={t.href} className="tile tile--filled">
                  <span className="tile__ic">
                    <IconModules />
                  </span>
                  <span>
                    <span className="tile__label">{t.label}</span>
                    <span className="tile__sub">{t.sub}</span>
                  </span>
                </Link>
              ))}
            </div>
          </Section>
        </div>

        <aside className="panel">
          <span className="panel__glow" />
          <div>
            <h2 className="panel__t">Client Focus</h2>
            <p className="panel__s">Clients needing your attention</p>
            <Link className="vlink vlink--onpanel" href="/clients">
              <span>View All Clients</span>
              <span className="vlink__disc">
                <IconArrowRightXs />
              </span>
            </Link>
          </div>

          {loading ? (
            <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <SkeletonCard height={120} />
              <SkeletonCard height={120} />
            </div>
          ) : live.focus.length === 0 ? (
            <p className="panel__s" style={{ marginTop: 22 }}>
              No clients yet — add your first client and they will appear here.
            </p>
          ) : (
            live.focus.map(({ c, f }) => (
              <FocusCard
                key={c.id}
                c={c}
                label={f.label}
                sessions={sessions}
                now={now}
                menu={
                  <StaadMenu
                    onPanel
                    size={38}
                    label={`More options for ${fullName(c)}`}
                    items={[
                      { label: 'View client', onClick: () => actions.viewClient(c.id) },
                      { label: 'Book a session', onClick: () => openBook(c.id) },
                      { label: 'Start a session', onClick: () => setStart({ open: true, clientId: c.id }) },
                    ]}
                  />
                }
              />
            ))
          )}
        </aside>
      </div>

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

/* ── next session card ──────────────────────────────────────────────────── */

function NextSession({
  s,
  no,
  now,
  onEnter,
  onView,
}: {
  s: PracticeSession;
  no?: number;
  now: Date;
  onEnter: () => void;
  onView: () => void;
}) {
  const cd = countdown(s.scheduledAt, now);
  return (
    <article className="card sch">
      <Notch>
        <button type="button" className="nbtn arrow" aria-label="Open session" onClick={onEnter}>
          <IconArrowRightXs />
        </button>
      </Notch>

      <div className="sch__who">
        <span className="av av--client">{initials(s.client?.firstName, s.client?.lastName) || '—'}</span>
        <span>
          <span className="sch__name">{fullName(s.client) || 'Client'}</span>
          {s.client?.diagnosis?.[0] && <span className="badge">{s.client.diagnosis[0]}</span>}
        </span>
      </div>

      <div className="sch__mid">
        <span className="sch__tile">
          <IconSchTile />
        </span>
        <span>
          <span style={{ display: 'flex', gap: 12 }}>
            <span className="sch__h">{SESSION_KIND}</span>
            <span className="sch__rule" />
            {no ? <span className="sch__meta">{fmtSessionNo(no)}</span> : null}
          </span>
          <span className="sch__timer">
            <span>{fmtDay(s.scheduledAt, now)}</span>
            <span>{fmtTime(s.scheduledAt)}</span>
            {cd && <span>{`${cd.value} ${cd.unit}`}</span>}
          </span>
        </span>
      </div>

      <div className="sch__foot">
        <Btn sm onClick={onView}>
          View Client
        </Btn>
        <Btn sm variant="primary" icon={<IconPlus />} onClick={onEnter}>
          Enter Room
        </Btn>
      </div>
    </article>
  );
}

/* ── client focus card (inside the dark panel) ──────────────────────────── */

function FocusCard({
  c,
  label,
  sessions,
  now,
  menu,
}: {
  c: PracticeClient;
  label: string;
  sessions: PracticeSession[];
  now: Date;
  menu: React.ReactNode;
}) {
  const mine = sessions.filter((s) => sessionClientId(s) === c.id && s.status !== 'CANCELLED').sort(byStartAsc);
  const past = mine.filter((s) => new Date(s.scheduledAt) < startOfDay(now) || s.status === 'COMPLETED');
  const last = past[past.length - 1];
  const next = nextSessionFor(c.id, sessions, now);

  return (
    <article className="pcard">
      <div className="pcard__who">
        <span className="av av--client">{initials(c.firstName, c.lastName) || '—'}</span>
        <span>
          <span className="pcard__name">{fullName(c) || 'Client'}</span>
          {c.diagnosis?.[0] && <span className="badge badge--onpanel">{c.diagnosis[0]}</span>}
        </span>
        <span style={{ flex: 1 }} />
        {menu}
      </div>

      <ol className="steplist">
        <span className="steplist__rule" />
        <li>
          <span className="bullet bullet--done" />
          Last session:
          <b>{last ? fmtDay(last.scheduledAt, now) : 'None yet'}</b>
        </li>
        <li>
          <span className={cx('bullet', next ? 'bullet--done' : 'bullet--todo')} />
          Next:
          <b>{next ? fmtDay(next.scheduledAt, now) : 'Not booked'}</b>
        </li>
      </ol>

      <div className="pcard__foot">
        <span className="badge">
          <span className="dot dot--sm" />
          {label}
        </span>
      </div>
    </article>
  );
}
