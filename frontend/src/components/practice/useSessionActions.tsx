'use client';

import React, { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, CalendarPlus, CalendarX, FileText, Play, User } from 'lucide-react';
import { CancelSessionDialog, NotesDrawer, RescheduleDialog } from './dialogs';
import { toast, type MenuItem } from './ui';
import {
  downloadFile,
  sessionClientId,
  sessionIcs,
  sessionRoomUrl,
  type PracticeSession,
  type SessionState,
} from '@/lib/practice';

/**
 * Session actions shared by the Dashboard, Sessions and Schedule pages — enter
 * the room, notes, reschedule, cancel, add to calendar — plus the dialogs they
 * open. Render `dialogs` once in the page.
 */
export function useSessionActions(refresh: () => void) {
  const router = useRouter();
  const [notesFor, setNotesFor] = useState<PracticeSession | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<PracticeSession | null>(null);
  const [cancelFor, setCancelFor] = useState<PracticeSession | null>(null);

  const enter = useCallback((s: PracticeSession) => router.push(sessionRoomUrl(s.id)), [router]);
  const viewClient = useCallback((clientId: string) => router.push(`/clients/${clientId}/progress`), [router]);

  const addToCalendar = (s: PracticeSession, minutes: number) => {
    downloadFile(`staad-session-${s.id.slice(0, 8)}.ics`, sessionIcs([{ s, minutes }]), 'text/calendar');
    toast('Calendar file downloaded — open it to add the session to your calendar.');
  };

  const menuFor = (s: PracticeSession, state: SessionState, minutes: number): MenuItem[] => {
    const clientId = sessionClientId(s);
    return [
      {
        label: state === 'live' ? 'Join session' : 'Start session',
        icon: Play,
        onClick: () => enter(s),
        hidden: !(state === 'upcoming' || state === 'live' || state === 'missed'),
      },
      {
        label: s.status === 'COMPLETED' ? 'View notes' : 'Add a note',
        icon: FileText,
        onClick: () => setNotesFor(s),
        hidden: s.status === 'CANCELLED',
      },
      { label: 'View client', icon: User, onClick: () => viewClient(clientId), hidden: !clientId },
      { label: 'Add to calendar', icon: CalendarPlus, onClick: () => addToCalendar(s, minutes), hidden: state !== 'upcoming' },
      {
        label: 'Reschedule',
        icon: CalendarClock,
        onClick: () => setRescheduleFor(s),
        hidden: s.status !== 'SCHEDULED' && s.status !== 'CANCELLED',
      },
      { label: 'Cancel session', icon: CalendarX, onClick: () => setCancelFor(s), danger: true, hidden: s.status !== 'SCHEDULED' },
    ];
  };

  const dialogs = (
    <>
      <NotesDrawer session={notesFor} onClose={() => setNotesFor(null)} onChanged={refresh} />
      <RescheduleDialog session={rescheduleFor} onClose={() => setRescheduleFor(null)} onDone={refresh} />
      <CancelSessionDialog session={cancelFor} onClose={() => setCancelFor(null)} onDone={refresh} />
    </>
  );

  return { enter, viewClient, openNotes: setNotesFor, openReschedule: setRescheduleFor, menuFor, dialogs };
}
