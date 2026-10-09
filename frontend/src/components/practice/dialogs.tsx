'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, Loader2, Mail, MessageCircle, Send } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { auth } from '@/lib/firebase';
import { DsDialog, Drawer, Field, Spinner, toast } from './ui';
import {
  DAY_NAMES,
  DEFAULT_DURATION,
  createSession,
  describeAvailability,
  fmtDayTime,
  fromInputs,
  fullName,
  loadAvailability,
  saveAvailability,
  sessionClientId,
  sessionRoomUrl,
  toDateInput,
  toTimeInput,
  updateSchedule,
  withinAvailability,
  type Availability,
  type PracticeClient,
  type PracticeSession,
} from '@/lib/practice';
import { apiFetch } from '@/lib/api';

const DURATIONS = [30, 45, 50, 60, 80];

/** Sensible default slot: the next half hour (≥30 min out) today, or 10:00 on another day. */
function defaultStart(day?: Date) {
  const now = new Date();
  if (day && day.toDateString() !== now.toDateString()) {
    const d = new Date(day);
    d.setHours(10, 0, 0, 0);
    return d;
  }
  const t = new Date(now.getTime() + 30 * 60_000);
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() <= 30 ? 30 : 60);
  return t;
}

const ErrorText = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[13px] font-medium" style={{ color: 'var(--ds-red)' }} role="alert">
    {children}
  </p>
);

function NoClients({ onAddClient }: { onAddClient?: () => void }) {
  return (
    <div className="rounded-2xl p-4 text-[13.5px]" style={{ background: 'var(--ds-surface-2)', color: 'var(--ds-muted)' }}>
      You don&apos;t have any clients yet. Invite one first — once they sign up with your link you can book sessions with them.
      {onAddClient && (
        <button className="ds-btn ds-btn-sm ds-btn-clay mt-3 flex" onClick={onAddClient}>
          Add a client
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────── Book session ─────────────────────────── */

export function BookSessionDialog({
  open,
  onOpenChange,
  clients,
  defaultClientId,
  defaultDay,
  onBooked,
  onAddClient,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: PracticeClient[];
  defaultClientId?: string;
  defaultDay?: Date;
  onBooked?: (session: PracticeSession) => void;
  onAddClient?: () => void;
}) {
  const { profile } = useAuthStore();
  const [clientId, setClientId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState(DEFAULT_DURATION);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const start = defaultStart(defaultDay);
    setClientId(defaultClientId ?? clients[0]?.id ?? '');
    setDate(toDateInput(start));
    setTime(toTimeInput(start));
    setDuration(DEFAULT_DURATION);
    setError('');
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const availability = useMemo(() => (open ? loadAvailability(profile?.id) : null), [open, profile?.id]);
  const when = fromInputs(date, time);
  const outside = when && availability ? !withinAvailability(when, duration, availability) : false;

  const submit = async () => {
    if (!profile?.id) return;
    if (!clientId) return setError('Choose a client.');
    if (!when) return setError('Pick a date and time.');
    if (when.getTime() < Date.now() - 60_000) return setError('Pick a time in the future.');
    setSaving(true);
    setError('');
    try {
      const session = await createSession(profile.id, clientId, when, duration);
      toast(`Session booked for ${fmtDayTime(when)}`);
      onOpenChange(false);
      onBooked?.(session);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not book the session.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DsDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Book a session"
      description="The session appears on your schedule and on the client's dashboard."
      footer={
        clients.length > 0 && (
          <>
            <button className="ds-btn ds-btn-ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </button>
            <button className="ds-btn ds-btn-clay" onClick={submit} disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              Book session
            </button>
          </>
        )
      }
    >
      {clients.length === 0 ? (
        <NoClients onAddClient={onAddClient} />
      ) : (
        <div className="space-y-4">
          <Field label="Client" htmlFor="book-client">
            <select id="book-client" className="ds-input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {fullName(c)}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" htmlFor="book-date">
              <input id="book-date" type="date" className="ds-input" value={date} min={toDateInput(new Date())} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Time" htmlFor="book-time">
              <input id="book-time" type="time" className="ds-input" value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
          </div>
          <Field label="Duration" htmlFor="book-duration">
            <select id="book-duration" className="ds-input" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATIONS.map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
          </Field>
          {outside && availability && (
            <p className="rounded-xl px-3 py-2.5 text-[12.5px]" style={{ background: 'var(--ds-amber-soft)', color: 'var(--ds-amber)' }}>
              This is outside your working hours ({describeAvailability(availability)}). You can still book it.
            </p>
          )}
          {error && <ErrorText>{error}</ErrorText>}
        </div>
      )}
    </DsDialog>
  );
}

/* ─────────────────────────── Start / launch session ─────────────────────────── */

export function StartSessionDialog({
  open,
  onOpenChange,
  clients,
  sessions = [],
  defaultClientId,
  moduleId,
  moduleName,
  onAddClient,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: PracticeClient[];
  sessions?: PracticeSession[];
  defaultClientId?: string;
  moduleId?: string;
  moduleName?: string;
  onAddClient?: () => void;
}) {
  const router = useRouter();
  const { profile } = useAuthStore();
  const [clientId, setClientId] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [patientLink, setPatientLink] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setClientId(defaultClientId ?? clients[0]?.id ?? '');
    setError('');
    setStarting(false);
    setPatientLink(null);
    setSessionId(null);
    setCopied(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reuse a session that's live or due within the hour instead of opening a second room.
  const existing = sessions.find(
    (s) =>
      sessionClientId(s) === clientId &&
      (s.status === 'ACTIVE' ||
        (s.status === 'SCHEDULED' && Math.abs(new Date(s.scheduledAt).getTime() - Date.now()) < 60 * 60_000))
  );

  const start = async () => {
    if (!profile?.id || !clientId) return setError('Choose a client.');
    setStarting(true);
    setError('');
    try {
      const id = existing?.id ?? (await createSession(profile.id, clientId, new Date())).id;
      // Get (or create) the patient join link for this session first.
      const res = await apiFetch(`/api/sessions/${id}/guest-link`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not create the patient link.');
      setSessionId(id);
      setPatientLink(`${window.location.origin}/join/${data.token}`);
      setStarting(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the session.');
      setStarting(false);
    }
  };

  const joinVideo = () => {
    if (sessionId) router.push(sessionRoomUrl(sessionId, moduleId));
  };

  const copyLink = async () => {
    if (!patientLink) return;
    try {
      await navigator.clipboard.writeText(patientLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — user can select the text manually */
    }
  };

  return (
    <DsDialog
      open={open}
      onOpenChange={onOpenChange}
      title={moduleName ? `Launch ${moduleName}` : 'Start a new session'}
      description={
        moduleName
          ? 'Choose the client. The session room opens with this module ready to go.'
          : 'Open a live session room with a client right now.'
      }
      footer={
        patientLink ? (
          <>
            <button className="ds-btn ds-btn-ghost" onClick={() => onOpenChange(false)}>
              Close
            </button>
            <button className="ds-btn ds-btn-primary" onClick={joinVideo}>
              Join video room
            </button>
          </>
        ) : (
          clients.length > 0 && (
            <>
              <button className="ds-btn ds-btn-ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </button>
              <button className="ds-btn ds-btn-primary" onClick={start} disabled={starting || !clientId}>
                {starting && <Loader2 className="animate-spin" />}
                {existing ? `Join ${existing.status === 'ACTIVE' ? 'live' : 'scheduled'} session` : 'Start session'}
              </button>
            </>
          )
        )
      }
    >
      {patientLink ? (
        <div className="space-y-4">
          <p className="ds-muted text-[13px]">
            Share this link with the patient — they open it on their phone/laptop to join.
            Join the video room once they&apos;re ready.
          </p>
          <div className="flex items-center gap-2 rounded-xl p-2 pl-3" style={{ background: 'var(--ds-surface-2)', border: '1px solid var(--ds-border)' }}>
            <span className="flex-1 truncate text-[13px]" style={{ color: 'var(--ds-ink)' }}>{patientLink}</span>
            <button className="ds-btn ds-btn-sm ds-btn-primary" onClick={copyLink}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      ) : clients.length === 0 ? (
        <NoClients onAddClient={onAddClient} />
      ) : (
        <div className="space-y-4">
          <Field label="Client" htmlFor="start-client">
            <select id="start-client" className="ds-input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {fullName(c)}
                </option>
              ))}
            </select>
          </Field>
          {existing && (
            <p className="ds-muted text-[12.5px]">
              {existing.status === 'ACTIVE' ? 'This client already has a live session' : `This client has a session at ${fmtDayTime(existing.scheduledAt)}`}{' '}
              — you&apos;ll join that room.
            </p>
          )}
          {error && <ErrorText>{error}</ErrorText>}
        </div>
      )}
    </DsDialog>
  );
}

/* ─────────────────────────── Add client (invite) ─────────────────────────── */

export function AddClientDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}) {
  const { profile } = useAuthStore();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [waSending, setWaSending] = useState(false);
  const [waStatus, setWaStatus] = useState('');

  useEffect(() => {
    if (open) {
      setFirstName('');
      setLastName('');
      setDiagnosis('');
      setPhone('');
      setEmail('');
      setDateOfBirth('');
      setGender('');
      setLink('');
      setCopied(false);
      setError('');
      setWaStatus('');
    }
  }, [open]);

  // Fires on its own once the invite exists — the therapist never clicks "send".
  const sendWhatsApp = async (inviteLink: string) => {
    if (!profile?.id || !phone.trim() || !auth.currentUser) return;
    setWaSending(true);
    setWaStatus('');
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await apiFetch('/api/whatsapp/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ therapistId: profile.id, patientName: firstName.trim(), inviteLink }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'WhatsApp send failed');
      setWaStatus('Invite sent via WhatsApp.');
    } catch (e) {
      setWaStatus(e instanceof Error ? e.message : 'WhatsApp send failed');
    } finally {
      setWaSending(false);
    }
  };

  const submit = async () => {
    if (!profile?.id) return;
    if (!firstName.trim()) return setError("Enter the client's first name.");
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch('/api/clients', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await auth.currentUser?.getIdToken()}`,
        },
        body: JSON.stringify({
          therapistId: profile.id,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          diagnosis: diagnosis.split(',').map((d) => d.trim()).filter(Boolean),
          phoneNumber: phone,
          email: email.trim(),
          dateOfBirth: dateOfBirth || undefined,
          gender,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not add the client.');
      onCreated?.();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the invite.');
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Could not copy — select the link and copy it manually.', 'error');
    }
  };

  const message = `You're invited to a STAAD therapy session. Sign up here: ${link}`;

  return (
    <DsDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a new client"
      description="Add the client to your caseload. No session or invite link is created."
      footer={
        <>
          <button className="ds-btn ds-btn-ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button className="ds-btn ds-btn-clay" onClick={submit} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Add Client
          </button>
        </>
      }
    >
      <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" htmlFor="client-first">
              <input id="client-first" className="ds-input" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Isha" autoFocus />
            </Field>
            <Field label="Last name" htmlFor="client-last">
              <input id="client-last" className="ds-input" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Maurya" />
            </Field>
          </div>
          <Field label="Conditions" htmlFor="client-dx" hint="Separate with commas, e.g. Anxiety, ADHD">
            <input id="client-dx" className="ds-input" value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="Anxiety, ADHD" />
          </Field>
          <Field label="WhatsApp number" htmlFor="client-phone" hint="Include the country code. The invite is sent here automatically.">
            <input
              id="client-phone"
              className="ds-input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
              inputMode="tel"
            />
          </Field>
          <Field label="Email" htmlFor="client-email">
            <input
              id="client-email"
              type="email"
              className="ds-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="isha@example.com"
              inputMode="email"
              autoComplete="off"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date of birth" htmlFor="client-dob">
              <input
                id="client-dob"
                type="date"
                className="ds-input"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                max={toDateInput(new Date())}
              />
            </Field>
            <Field label="Gender" htmlFor="client-gender">
              <select id="client-gender" className="ds-input" value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="">Select</option>
                <option value="Female">Female</option>
                <option value="Male">Male</option>
                <option value="Non-binary">Non-binary</option>
                <option value="Other">Other</option>
                <option value="Prefer not to say">Prefer not to say</option>
              </select>
            </Field>
          </div>
          {error && <ErrorText>{error}</ErrorText>}
        </div>
    </DsDialog>
  );
}

/* ─────────────────────────── Reschedule / confirm ─────────────────────────── */

export function RescheduleDialog({
  session,
  onClose,
  onDone,
}: {
  session: PracticeSession | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session) return;
    const current = new Date(session.scheduledAt);
    const start = current.getTime() > Date.now() ? current : defaultStart();
    setDate(toDateInput(start));
    setTime(toTimeInput(start));
    setError('');
  }, [session]);

  const submit = async () => {
    if (!session) return;
    const when = fromInputs(date, time);
    if (!when) return setError('Pick a date and time.');
    if (when.getTime() < Date.now() - 60_000) return setError('Pick a time in the future.');
    setSaving(true);
    setError('');
    try {
      await updateSchedule(session.id, 'reschedule', when);
      toast(`Session moved to ${fmtDayTime(when)}`);
      onClose();
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reschedule.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DsDialog
      open={!!session}
      onOpenChange={(o) => !o && onClose()}
      title="Reschedule session"
      description={session?.client ? `Choose a new time for ${fullName(session.client)}.` : undefined}
      footer={
        <>
          <button className="ds-btn ds-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="ds-btn ds-btn-clay" onClick={submit} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Save new time
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" htmlFor="rs-date">
            <input id="rs-date" type="date" className="ds-input" value={date} min={toDateInput(new Date())} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Time" htmlFor="rs-time">
            <input id="rs-time" type="time" className="ds-input" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        {error && <ErrorText>{error}</ErrorText>}
      </div>
    </DsDialog>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Something went wrong.', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <DsDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={body}
      footer={
        <>
          <button className="ds-btn ds-btn-ghost" onClick={() => onOpenChange(false)}>
            Keep it
          </button>
          <button className={danger ? 'ds-btn ds-btn-danger' : 'ds-btn ds-btn-clay'} onClick={run} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </button>
        </>
      }
    />
  );
}

/** Cancel-session confirmation wired to the API. */
export function CancelSessionDialog({
  session,
  onClose,
  onDone,
}: {
  session: PracticeSession | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  return (
    <ConfirmDialog
      open={!!session}
      onOpenChange={(o) => !o && onClose()}
      title="Cancel this session?"
      body={
        session
          ? `${fullName(session.client) || 'The client'}'s session on ${fmtDayTime(session.scheduledAt)} will be marked as cancelled. You can reschedule it later.`
          : ''
      }
      confirmLabel="Cancel session"
      danger
      onConfirm={async () => {
        if (!session) return;
        await updateSchedule(session.id, 'cancel');
        toast('Session cancelled');
        onDone?.();
      }}
    />
  );
}

/* ─────────────────────────── Availability ─────────────────────────── */

export function AvailabilityDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { profile } = useAuthStore();
  const [av, setAv] = useState<Availability>(() => loadAvailability());
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setAv(loadAvailability(profile?.id));
      setError('');
    }
  }, [open, profile?.id]);

  const toggleDay = (d: number) =>
    setAv((a) => ({ ...a, days: a.days.includes(d) ? a.days.filter((x) => x !== d) : [...a.days, d] }));

  const save = () => {
    if (av.start >= av.end) return setError('End time must be after start time.');
    saveAvailability(profile?.id, av);
    toast('Working hours saved');
    onOpenChange(false);
  };

  return (
    <DsDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Manage availability"
      description="Set your working hours. Bookings outside them are flagged. Saved in this browser."
      footer={
        <>
          <button className="ds-btn ds-btn-ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button className="ds-btn ds-btn-clay" onClick={save}>
            Save hours
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="ds-label">Working days</p>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <button
                key={d}
                type="button"
                className={`ds-pill-tab ${av.days.includes(d) ? 'is-active' : ''}`}
                aria-pressed={av.days.includes(d)}
                onClick={() => toggleDay(d)}
              >
                {DAY_NAMES[d]}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start" htmlFor="av-start">
            <input id="av-start" type="time" className="ds-input" value={av.start} onChange={(e) => setAv({ ...av, start: e.target.value })} />
          </Field>
          <Field label="End" htmlFor="av-end">
            <input id="av-end" type="time" className="ds-input" value={av.end} onChange={(e) => setAv({ ...av, end: e.target.value })} />
          </Field>
        </div>
        {error && <ErrorText>{error}</ErrorText>}
      </div>
    </DsDialog>
  );
}

/* ─────────────────────────── Session notes drawer ─────────────────────────── */

interface Note {
  id: string;
  content: string;
  createdAt: string;
}

export function NotesDrawer({
  session,
  onClose,
  onChanged,
}: {
  session: PracticeSession | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { role, profile } = useAuthStore();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!session) return;
    setDraft('');
    setLoading(true);
    apiFetch(`/api/notes?sessionId=${session.id}`)
      .then((r) => (r.ok ? r.json() : { notes: [] }))
      .then((d) => setNotes(d.notes ?? []))
      .catch(() => setNotes([]))
      .finally(() => setLoading(false));
  }, [session]);

  const add = async () => {
    if (!session || !profile?.id || !draft.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, therapistId: profile.id, content: draft.trim() }),
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setNotes((prev) => [d.note, ...prev]);
      setDraft('');
      toast('Note saved');
      onChanged?.();
    } catch {
      toast('Could not save the note.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={!!session}
      onClose={onClose}
      title="Session notes"
      subtitle={session ? `${fullName(session.client)} · ${fmtDayTime(session.scheduledAt)}` : undefined}
    >
      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <div className="space-y-4">
          {role === 'THERAPIST' && (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Add a note about this session…"
                rows={4}
                className="ds-input resize-y"
                aria-label="New note"
              />
              <div className="flex justify-end">
                <button className="ds-btn ds-btn-sm ds-btn-clay" onClick={add} disabled={saving || !draft.trim()}>
                  {saving ? <Loader2 className="animate-spin" /> : <Send />}
                  Save note
                </button>
              </div>
            </div>
          )}
          {notes.length === 0 ? (
            <p className="ds-muted py-6 text-center text-[13.5px]">No notes recorded for this session yet.</p>
          ) : (
            notes.map((n) => (
              <div key={n.id} className="rounded-2xl p-4" style={{ background: 'var(--ds-surface-2)', border: '1px solid var(--ds-border)' }}>
                <p className="whitespace-pre-wrap text-[14px]" style={{ color: 'var(--ds-ink)' }}>
                  {n.content}
                </p>
                <p className="ds-faint mt-2 text-[12px]">{fmtDayTime(n.createdAt)}</p>
              </div>
            ))
          )}
        </div>
      )}
    </Drawer>
  );
}
