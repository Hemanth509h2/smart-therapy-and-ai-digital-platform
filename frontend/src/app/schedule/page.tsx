'use client';

import React, { useMemo, useState } from 'react';
import { useNow, usePracticeData, useTherapistGuard } from '@/hooks/usePracticeData';
import { useAuthStore } from '@/store/useAuthStore';
import { StaadShell } from '@/components/staad/Shell';
import { TopBar } from '@/components/staad/TopBar';
import { Btn, InlineError, Section, SkeletonCard, cx } from '@/components/staad/parts';
import {
  IconCalendarPlus,
  IconChevronLeft,
  IconChevronRight,
  IconStatA,
  IconStatE,
  IconStatF,
} from '@/components/staad/icons';
import { AddClientDialog, BookSessionDialog } from '@/components/practice/dialogs';
import { useSessionActions } from '@/components/practice/useSessionActions';
import {
  DAY_NAMES,
  addDays,
  describeAvailability,
  fmtTime,
  fullName,
  isSameDay,
  loadAvailability,
  sessionDuration,
  sessionState,
  startOfDay,
  startOfWeek,
  type PracticeSession,
} from '@/lib/practice';

/** Two-hour buckets, the same rhythm the artboard's week grid uses. */
const BUCKET_HOURS = 2;

export default function SchedulePage() {
  useTherapistGuard();
  const now = useNow(60_000);
  const { profile } = useAuthStore();
  const { sessions, bookings, clients, loading, error, refresh } = usePracticeData();
  const actions = useSessionActions(refresh);

  const [weekOffset, setWeekOffset] = useState(0);
  const [book, setBook] = useState<{ open: boolean; day?: Date }>({ open: false });
  const [addOpen, setAddOpen] = useState(false);

  const availability = useMemo(() => loadAvailability(profile?.id), [profile?.id]);

  const weekStart = useMemo(() => addDays(startOfWeek(now), weekOffset * 7), [now, weekOffset]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const live = useMemo(
    () => sessions.filter((s) => s.status !== 'CANCELLED'),
    [sessions]
  );

  /** Time buckets derived from the therapist's own availability window. */
  const buckets = useMemo(() => {
    const startH = Number(availability.start.split(':')[0]) || 9;
    const endH = Number(availability.end.split(':')[0]) || 18;
    const out: number[] = [];
    for (let h = startH; h < endH; h += BUCKET_HOURS) out.push(h);
    return out.length ? out : [9, 11, 13, 15];
  }, [availability]);

  const weekSessions = live.filter((s) =>
    days.some((d) => isSameDay(new Date(s.scheduledAt), d))
  );

  const inCell = (day: Date, hour: number) =>
    weekSessions.filter((s) => {
      const d = new Date(s.scheduledAt);
      return isSameDay(d, day) && d.getHours() >= hour && d.getHours() < hour + BUCKET_HOURS;
    });

  // availability summary
  const nextSeven = Array.from({ length: 7 }, (_, i) => addDays(startOfDay(now), i));
  const openSlots = nextSeven.reduce((acc, d) => {
    if (!availability.days.includes(d.getDay())) return acc;
    const booked = live.filter((s) => isSameDay(new Date(s.scheduledAt), d)).length;
    return acc + Math.max(0, buckets.length - booked);
  }, 0);

  const perDay = days.map((d) => live.filter((s) => isSameDay(new Date(s.scheduledAt), d)).length);
  const busiestIdx = perDay.indexOf(Math.max(...perDay));
  const busiest = Math.max(...perDay) > 0 ? DAY_NAMES[days[busiestIdx].getDay()] : '—';

  // mini month
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const leading = (monthStart.getDay() + 6) % 7; // design's calendar starts on Monday
  const monthDays = Array.from({ length: daysInMonth }, (_, i) => new Date(now.getFullYear(), now.getMonth(), i + 1));
  const hasSession = (d: Date) => live.some((s) => isSameDay(new Date(s.scheduledAt), d));

  const weekLabel = `${weekStart.toLocaleDateString(undefined, { day: 'numeric' })} — ${addDays(weekStart, 6).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`;

  return (
    <StaadShell>
      <TopBar sessions={sessions} />

      <div className="phead">
        <div>
          <div className="eyebrow">{weekLabel}</div>
          <h1 className="phead__title">Schedule</h1>
          <p className="phead__lead">Your week, with the empty slots you can still give away.</p>
        </div>
        <div className="phead__acts">
          <Btn icon={<IconCalendarPlus />} variant="primary" onClick={() => setBook({ open: true })}>
            Book Appointment
          </Btn>
          <button type="button" className="chip" aria-label="Previous week" onClick={() => setWeekOffset((w) => w - 1)}>
            <IconChevronLeft />
          </button>
          <button
            type="button"
            className={cx('chip', weekOffset === 0 && 'on')}
            onClick={() => setWeekOffset(0)}
          >
            This week
          </button>
          <button type="button" className="chip" aria-label="Next week" onClick={() => setWeekOffset((w) => w + 1)}>
            <IconChevronRight />
          </button>
        </div>
      </div>

      {error && <InlineError message={error} onRetry={refresh} />}

      <div className="cols">
        <div className="left">
          <Section
            title="Week view"
            sub={
              loading
                ? 'Loading…'
                : `${weekSessions.length} booked, the rest is yours`
            }
          >
            {loading ? (
              <SkeletonCard height={360} />
            ) : (
              <div className="week">
                <span />
                {days.map((d) => (
                  <div key={d.toISOString()} className={cx('wday', isSameDay(d, now) && 'today')}>
                    <span className="wday__d">{DAY_NAMES[d.getDay()]}</span>
                    <span className="wday__n">{d.getDate()}</span>
                  </div>
                ))}

                {buckets.map((hour) => (
                  <React.Fragment key={hour}>
                    <span className="wtime">{`${String(hour).padStart(2, '0')}:00`}</span>
                    {days.map((d) => {
                      const items = inCell(d, hour);
                      if (items.length === 0) {
                        const slotDate = new Date(d);
                        slotDate.setHours(hour, 0, 0, 0);
                        const bookable = availability.days.includes(d.getDay()) && slotDate >= now;
                        return (
                          <span
                            key={`${d.toISOString()}-${hour}`}
                            className="wslot"
                            role={bookable ? 'button' : undefined}
                            tabIndex={bookable ? 0 : undefined}
                            aria-label={bookable ? `Book ${DAY_NAMES[d.getDay()]} ${hour}:00` : undefined}
                            style={bookable ? { cursor: 'pointer' } : undefined}
                            onClick={bookable ? () => setBook({ open: true, day: slotDate }) : undefined}
                            onKeyDown={
                              bookable
                                ? (e) => {
                                    if (e.key === 'Enter' || e.key === ' ') setBook({ open: true, day: slotDate });
                                  }
                                : undefined
                            }
                          />
                        );
                      }
                      const s = items[0];
                      const state = sessionState(s, now, sessionDuration(s, bookings));
                      return (
                        <button
                          key={`${d.toISOString()}-${hour}`}
                          type="button"
                          className={cx('wev', state === 'live' && 'wev--lime', 'as-button')}
                          onClick={() => actions.enter(s)}
                        >
                          <span className="wev__t">{fullName(s.client) || 'Client'}</span>
                          <span className="wev__s">
                            {[fmtTime(s.scheduledAt), state === 'live' ? 'in session' : null]
                              .filter(Boolean)
                              .join(' · ')}
                            {items.length > 1 ? ` +${items.length - 1}` : ''}
                          </span>
                        </button>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            )}
          </Section>

          <Section title="Availability" sub="What clients can book into next week">
            <div className="grid3">
              <article className="card card--flat" style={{ minHeight: 150 }}>
                <div className="stat__head">
                  <span className="stat__ic">
                    <IconStatE />
                  </span>
                </div>
                <div className="stat__label">Open slots</div>
                <div className="stat__row">
                  <span className="stat__num">{openSlots}</span>
                  <span className="stat__meta">
                    <span className="stat__cap">Next seven days</span>
                  </span>
                </div>
              </article>

              <article className="card card--flat" style={{ minHeight: 150 }}>
                <div className="stat__head">
                  <span className="stat__ic">
                    <IconStatF />
                  </span>
                </div>
                <div className="stat__label">Busiest day</div>
                <div className="stat__row">
                  <span className="stat__num">{busiest}</span>
                  <span className="stat__meta">
                    <span className="stat__cap">
                      {Math.max(...perDay) > 0
                        ? `${Math.max(...perDay)} session${Math.max(...perDay) === 1 ? '' : 's'} booked`
                        : 'Nothing booked this week'}
                    </span>
                  </span>
                </div>
              </article>

              <article className="card card--flat" style={{ minHeight: 150 }}>
                <div className="stat__head">
                  <span className="stat__ic">
                    <IconStatA />
                  </span>
                </div>
                <div className="stat__label">Working hours</div>
                <div className="stat__row">
                  <span className="stat__num" style={{ fontSize: 28 }}>
                    {availability.start}–{availability.end}
                  </span>
                  <span className="stat__meta">
                    <span className="stat__cap">{describeAvailability(availability)}</span>
                  </span>
                </div>
              </article>
            </div>
          </Section>
        </div>

        <aside className="panel">
          <h2 className="panel__t">{now.toLocaleDateString(undefined, { month: 'long' })}</h2>
          <div className="mini">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((h, i) => (
              <span key={`${h}-${i}`} className="h">
                {h}
              </span>
            ))}
            {Array.from({ length: leading }).map((_, i) => (
              <span key={`lead-${i}`} />
            ))}
            {monthDays.map((d) => (
              <span
                key={d.toISOString()}
                className={cx(isSameDay(d, now) ? 'on' : 'd', hasSession(d) && !isSameDay(d, now) && 'dot-day')}
              >
                {d.getDate()}
              </span>
            ))}
          </div>
          <span className="panel__glow" />
        </aside>
      </div>

      <BookSessionDialog
        open={book.open}
        onOpenChange={(open) => setBook((b) => ({ ...b, open }))}
        clients={clients}
        defaultDay={book.day}
        onBooked={refresh}
        onAddClient={() => {
          setBook({ open: false });
          setAddOpen(true);
        }}
      />
      <AddClientDialog open={addOpen} onOpenChange={setAddOpen} onCreated={refresh} />
      {actions.dialogs}
    </StaadShell>
  );
}
