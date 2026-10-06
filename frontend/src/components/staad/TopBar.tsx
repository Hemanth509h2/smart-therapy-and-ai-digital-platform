'use client';

import React from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/store/useAuthStore';
import { useNow } from '@/hooks/usePracticeData';
import {
  SESSION_KIND,
  byStartAsc,
  countdown,
  fmtTime,
  fullName,
  initials,
  sessionState,
  type PracticeSession,
} from '@/lib/practice';
import { IconArrowUpRight, IconCalendarSm, IconChevronDown } from './icons';

const fmtChipDate = (d: Date) =>
  d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The pill bar: today's date, the session the therapist is heading into next,
 * and shortcuts to the schedule and account. The lime strip is the live/next
 * session — it disappears when there is nothing left today, rather than showing
 * a placeholder.
 */
export function TopBar({ sessions = [] }: { sessions?: PracticeSession[] }) {
  const { profile } = useAuthStore();
  const now = useNow(30_000);

  const upcoming = [...sessions]
    .filter((s) => {
      const st = sessionState(s, now);
      return st === 'live' || st === 'upcoming';
    })
    .sort(byStartAsc);

  const next = upcoming[0];
  const live = next ? sessionState(next, now) === 'live' : false;
  const cd = next ? countdown(next.scheduledAt, now) : null;
  const clientName = next ? fullName(next.client) || 'Client' : '';

  return (
    <div className="topbar">
      <div className="pill-bar">
        <div className="date-chip">
          <span className="date-chip__ic">
            <IconCalendarSm />
          </span>
          <span className="date-chip__t">{fmtChipDate(now)}</span>
        </div>

        <span className="ticks" aria-hidden="true" />

        {next && (
          <div className="tl">
            <span className="av av--sm av--client" style={{ boxShadow: '0 0 0 2px rgba(255,255,255,.75)' }}>
              {initials(next.client?.firstName, next.client?.lastName) || '—'}
            </span>
            <span>
              <span className="tl__name">{clientName}</span>
              <span className="tl__type">{SESSION_KIND}</span>
            </span>
            <span style={{ flex: 1 }} />
            <span className="tl__chip">{live ? 'Live now' : cd ? `${cd.value} ${cd.unit}` : fmtTime(next.scheduledAt)}</span>
            <span className="tl__marker" data-time={fmtTime(now)} />
          </div>
        )}

        <span className="ticks" aria-hidden="true" />

        <Link className="round-btn" href="/schedule" aria-label="View full schedule">
          <IconArrowUpRight />
        </Link>
      </div>

      <Link className="av-btn" href="/profile" aria-label={`${fullName(profile) || 'Account'}, account menu`}>
        <span className="av av--user">{initials(profile?.firstName, profile?.lastName) || '—'}</span>
        <IconChevronDown />
      </Link>
    </div>
  );
}
