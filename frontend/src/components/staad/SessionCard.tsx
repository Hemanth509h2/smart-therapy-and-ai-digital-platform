'use client';

import React from 'react';
import { Btn, Notch, StaadMenu } from './parts';
import { IconArrowRightXs, IconNoteAdd, IconSchTile } from './icons';
import type { useSessionActions } from '@/components/practice/useSessionActions';
import {
  SESSION_KIND,
  countdown,
  fmtDay,
  fmtSessionNo,
  fmtTime,
  fullName,
  hasDocs,
  initials,
  sessionState,
  type PracticeSession,
} from '@/lib/practice';

/**
 * The big session card — lime while it's live or still owed notes, plain
 * otherwise. Shared by the Dashboard ("Today's Schedule") and the Sessions page
 * ("In session now") so both stay in step.
 */
export function SessionCard({
  s,
  no,
  now,
  minutes,
  actions,
  tone = 'auto',
}: {
  s: PracticeSession;
  no?: number;
  now: Date;
  minutes: number;
  actions: ReturnType<typeof useSessionActions>;
  tone?: 'auto' | 'lime' | 'plain';
}) {
  const state = sessionState(s, now, minutes);
  const cd = countdown(s.scheduledAt, now);
  const notesPending = s.status === 'COMPLETED' && !hasDocs(s);
  const highlight = tone === 'lime' || (tone === 'auto' && (state === 'live' || notesPending));

  const statusLabel =
    state === 'live'
      ? 'In progress'
      : notesPending
        ? 'Notes Pending'
        : state === 'missed'
          ? 'Missed'
          : s.status === 'COMPLETED'
            ? 'Completed'
            : 'Scheduled';

  return (
    <article className={`card sch${highlight ? ' card--lime' : ''}`}>
      <Notch width={102}>
        <StaadMenu label="More options for this session" items={actions.menuFor(s, state, minutes)} />
        <button
          type="button"
          className="nbtn arrow"
          aria-label="Open the session room"
          onClick={() => actions.enter(s)}
        >
          <IconArrowRightXs />
        </button>
      </Notch>

      <div className="sch__who">
        <span className="av av--client">{initials(s.client?.firstName, s.client?.lastName) || '—'}</span>
        <span>
          <span className="sch__name">{fullName(s.client) || 'Client'}</span>
          {s.client?.diagnosis?.[0] && (
            <span className={`badge${highlight ? ' badge--onlime' : ''}`}>{s.client.diagnosis[0]}</span>
          )}
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
            <span className="sch__ring">
              <span className="dot dot--hard" style={{ width: 5, height: 5 }} />
            </span>
            <span>{fmtTime(s.scheduledAt)}</span>
            <span>{state === 'live' ? 'now' : cd ? `${cd.value} ${cd.unit}` : fmtDay(s.scheduledAt, now)}</span>
          </span>
        </span>
      </div>

      <div className="sch__foot">
        <span className="sch__status">
          <span className="dot dot--hard" />
          {statusLabel}
        </span>
        <Btn
          icon={<IconNoteAdd />}
          variant={highlight ? 'onlime' : 'primary'}
          onClick={() => actions.openNotes(s)}
        >
          {s.status === 'COMPLETED' ? 'View Notes' : 'Add Notes'}
        </Btn>
      </div>
    </article>
  );
}
