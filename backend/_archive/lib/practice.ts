// Shared types and pure helpers for the therapist practice pages (Dashboard,
// Clients, Sessions, Schedule). Everything here is derived from the existing
// Session / Booking / ProfileClient rows — there are no extra schema fields for
// status, duration or session numbers, so they are computed.

export type SessionStatus = 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface PracticeClient {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  diagnosis: string[];
  sessionCount?: number;
  lastSession?: string | null;
  nextSession?: { id: string; scheduledAt: string } | null;
  createdAt?: string;
  user?: { email: string };
}

export interface PracticeSession {
  id: string;
  scheduledAt: string;
  status: SessionStatus;
  startedAt?: string | null;
  endedAt?: string | null;
  confirmedByPatient?: boolean;
  clientId?: string;
  client?: { id: string; userId?: string; firstName: string; lastName: string; diagnosis?: string[] };
  therapist?: { firstName: string; lastName: string };
  report?: { id: string } | null;
  _count?: { notes: number };
}

export interface PracticeBooking {
  id: string;
  clientId: string;
  dateTime: string;
  duration: number;
  status?: string;
}

export interface PracticeInvite {
  id: string;
  token: string;
  firstName: string;
  lastName: string;
  diagnosis: string[];
  status: string;
  createdAt: string;
}

export const DEFAULT_DURATION = 50;
const MIN = 60_000;
const DAY = 86_400_000;

/* ─────────────────────────── dates ─────────────────────────── */

export const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/** Monday of the week containing `d`. */
export const startOfWeek = (d: Date) => {
  const x = startOfDay(d);
  const dow = x.getDay();
  return addDays(x, dow === 0 ? -6 : 1 - dow);
};

export const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const fmtTime = (d: Date | string) =>
  new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export const fmtShortDate = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** "Today" / "Tomorrow" / "Yesterday" / "Wed, Sep 9". */
export function fmtDay(d: Date | string, now = new Date()) {
  const date = new Date(d);
  const diff = Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export const fmtDayTime = (d: Date | string, now = new Date()) => `${fmtDay(d, now)}, ${fmtTime(d)}`;

/** Human countdown/elapsed label for a session start time. */
export function fmtRelative(d: Date | string, now = new Date(), durationMin = DEFAULT_DURATION) {
  const mins = Math.round((new Date(d).getTime() - now.getTime()) / MIN);
  if (mins > 0) {
    if (mins < 60) return `Starts in ${mins} min`;
    if (mins < 24 * 60) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `Starts in ${h}h${m ? ` ${m}m` : ''}`;
    }
    const days = Math.round(mins / (24 * 60));
    return `In ${days} day${days === 1 ? '' : 's'}`;
  }
  const ago = -mins;
  if (ago === 0) return 'Starting now';
  if (ago <= durationMin) return `Started ${ago} min ago`;
  if (ago < 24 * 60) {
    const h = Math.floor(ago / 60);
    return h ? `${h}h ago` : `${ago} min ago`;
  }
  const days = Math.round(ago / (24 * 60));
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Big-number countdown ("22" + "min"); null once the start time has passed. */
export function countdown(d: Date | string, now = new Date()): { value: string; unit: string } | null {
  const mins = Math.round((new Date(d).getTime() - now.getTime()) / MIN);
  if (mins <= 0) return null;
  if (mins < 60) return { value: String(mins), unit: 'min' };
  if (mins < 48 * 60) {
    const h = Math.round(mins / 60);
    return { value: String(h), unit: h === 1 ? 'hour' : 'hours' };
  }
  return { value: String(Math.round(mins / (24 * 60))), unit: 'days' };
}

export function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const pad = (n: number) => String(n).padStart(2, '0');
export const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Combine <input type="date"> + <input type="time"> values into a local Date. */
export function fromInputs(date: string, time: string): Date | null {
  if (!date || !time) return null;
  const d = new Date(`${date}T${time}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ─────────────────────────── people ─────────────────────────── */

export const initials = (first?: string, last?: string) =>
  `${(first || '').trim()[0] ?? ''}${(last || '').trim()[0] ?? ''}`.toUpperCase() || '?';

export const fullName = (p?: { firstName?: string; lastName?: string } | null) =>
  p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() : '';

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const AVATAR_COLORS = ['#B98B63', '#8EA38F', '#A7835F', '#7E9A8A', '#C39A6E', '#96A78F'];
export const avatarColor = (seed: string) => AVATAR_COLORS[hash(seed) % AVATAR_COLORS.length];

/* ─────────────────────────── tones ─────────────────────────── */

export type Tone = 'green' | 'amber' | 'red' | 'clay' | 'forest' | 'gray' | 'blue' | 'violet';

export const TONES: Record<Tone, { fg: string; bg: string }> = {
  green: { fg: 'var(--ds-green)', bg: 'var(--ds-green-soft)' },
  amber: { fg: 'var(--ds-amber)', bg: 'var(--ds-amber-soft)' },
  red: { fg: 'var(--ds-red)', bg: 'var(--ds-red-soft)' },
  clay: { fg: 'var(--ds-clay-ink)', bg: 'var(--ds-clay-soft)' },
  forest: { fg: 'var(--ds-forest)', bg: 'var(--ds-forest-soft)' },
  gray: { fg: 'var(--ds-muted)', bg: 'var(--ds-surface-2)' },
  blue: { fg: 'var(--ds-blue)', bg: 'var(--ds-blue-soft)' },
  violet: { fg: 'var(--ds-violet)', bg: 'var(--ds-violet-soft)' },
};

/** Stable colour for a diagnosis / condition tag. */
export function tagTone(tag: string): Tone {
  const t = tag.toLowerCase();
  if (/anx|panic|ocd|phobia/.test(t)) return 'red';
  if (/adhd|attention/.test(t)) return 'clay';
  if (/depress|mood|grief/.test(t)) return 'green';
  if (/stress|trauma|ptsd/.test(t)) return 'forest';
  if (/sld|dyslex|learn/.test(t)) return 'blue';
  if (/autis|asd|^id$|intellect/.test(t)) return 'violet';
  const fallback: Tone[] = ['clay', 'green', 'blue', 'violet'];
  return fallback[hash(t) % fallback.length];
}

/* ─────────────────────────── sessions ─────────────────────────── */

export type SessionState = 'live' | 'upcoming' | 'missed' | 'completed' | 'notes-pending' | 'cancelled';

export const STATE_META: Record<SessionState, { label: string; tone: Tone }> = {
  live: { label: 'Live now', tone: 'forest' },
  upcoming: { label: 'Upcoming', tone: 'amber' },
  missed: { label: 'Attention Required', tone: 'red' },
  completed: { label: 'Completed', tone: 'green' },
  'notes-pending': { label: 'Notes Pending', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
};

/** All STAAD sessions run in the live video room. */
export const SESSION_KIND = 'Video Session';

/** A completed session is documented once it has a note or a report. Sessions
 *  fetched without counts (client role) are treated as documented. */
export const hasDocs = (s: PracticeSession) =>
  s._count === undefined ? true : s._count.notes > 0 || !!s.report;

export function sessionState(s: PracticeSession, now = new Date(), durationMin = DEFAULT_DURATION): SessionState {
  switch (s.status) {
    case 'ACTIVE':
      return 'live';
    case 'CANCELLED':
      return 'cancelled';
    case 'COMPLETED':
      return hasDocs(s) ? 'completed' : 'notes-pending';
    default:
      // Still SCHEDULED after its slot has fully elapsed → it never happened.
      return new Date(s.scheduledAt).getTime() + durationMin * MIN < now.getTime() ? 'missed' : 'upcoming';
  }
}

export const sessionClientId = (s: PracticeSession) => s.client?.id ?? s.clientId ?? '';

/** Actual length for held sessions, else the booked length, else the default. */
export function sessionDuration(s: PracticeSession, bookings: PracticeBooking[] = []) {
  if (s.startedAt && s.endedAt) {
    const m = Math.round((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / MIN);
    if (m > 0) return m;
  }
  const t = new Date(s.scheduledAt).getTime();
  const cid = sessionClientId(s);
  const booking = bookings.find(
    (b) => b.clientId === cid && Math.abs(new Date(b.dateTime).getTime() - t) < MIN
  );
  return booking?.duration ?? DEFAULT_DURATION;
}

/** Per-client running number (1-based, chronological, cancelled excluded). */
export function sessionNumbers(sessions: PracticeSession[]) {
  const byClient = new Map<string, PracticeSession[]>();
  for (const s of sessions) {
    if (s.status === 'CANCELLED') continue;
    const key = sessionClientId(s);
    byClient.set(key, [...(byClient.get(key) ?? []), s]);
  }
  const out = new Map<string, number>();
  byClient.forEach((list) => {
    list
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
      .forEach((s, i) => out.set(s.id, i + 1));
  });
  return out;
}

export const fmtSessionNo = (n?: number) => (n ? `Session ${pad(n)}` : '');

export const sessionRoomUrl = (id: string, moduleId?: string) =>
  `/session/${id}${moduleId ? `?module=${encodeURIComponent(moduleId)}` : ''}`;

export const byStartAsc = (a: PracticeSession, b: PracticeSession) =>
  new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();

/** "Wed, Sep 9, 09:13 PM" */
export const fmtListDate = (d: Date | string) =>
  new Date(d).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Non-cancelled sessions per week for the last `weeks` weeks, oldest first. */
export function weeklyCounts(sessions: PracticeSession[], weeks = 6, now = new Date()) {
  const thisWeek = startOfWeek(now).getTime();
  const counts: number[] = Array(weeks).fill(0);
  for (const s of sessions) {
    if (s.status === 'CANCELLED') continue;
    const back = Math.round((thisWeek - startOfWeek(new Date(s.scheduledAt)).getTime()) / (7 * DAY));
    const idx = weeks - 1 - back;
    if (idx >= 0 && idx < weeks) counts[idx]++;
  }
  return counts;
}

/** Clients whose first (non-cancelled) session falls on or after `since`. */
export function newClientsSince(clients: PracticeClient[], sessions: PracticeSession[], since: Date) {
  return clients.filter((c) => {
    const times = sessions
      .filter((s) => sessionClientId(s) === c.id && s.status !== 'CANCELLED')
      .map((s) => new Date(s.scheduledAt).getTime());
    return times.length > 0 && Math.min(...times) >= since.getTime();
  }).length;
}

export function sessionIcs(items: { s: PracticeSession; minutes: number }[]) {
  return buildIcs(
    items.map(({ s, minutes }) => ({
      uid: s.id,
      start: new Date(s.scheduledAt),
      minutes,
      title: `STAAD session · ${fullName(s.client) || 'Client'}`,
      description: 'Join the session room from your STAAD dashboard.',
    }))
  );
}

/* ─────────────────────────── clients ─────────────────────────── */

export type ClientStatus = 'upcoming' | 'active' | 'follow-up';

export const CLIENT_STATUS_META: Record<ClientStatus, { label: string; tone: Tone }> = {
  upcoming: { label: 'Upcoming', tone: 'amber' },
  active: { label: 'Active', tone: 'green' },
  'follow-up': { label: 'Needs Follow-up', tone: 'red' },
};

export function clientSessions(clientId: string, sessions: PracticeSession[]) {
  return sessions.filter((s) => sessionClientId(s) === clientId);
}

/** Needs follow-up if a session was missed or left undocumented, or the client
 *  has nothing booked and hasn't been seen in 30 days. */
export function clientStatus(
  c: PracticeClient,
  sessions: PracticeSession[],
  bookings: PracticeBooking[] = [],
  now = new Date()
): ClientStatus {
  const mine = clientSessions(c.id, sessions);
  const flagged = mine.some((s) => {
    const st = sessionState(s, now, sessionDuration(s, bookings));
    return st === 'missed' || st === 'notes-pending';
  });
  if (flagged) return 'follow-up';
  if (mine.some((s) => s.status === 'ACTIVE' || (s.status === 'SCHEDULED' && new Date(s.scheduledAt) > now))) {
    return 'upcoming';
  }
  if (c.lastSession && now.getTime() - new Date(c.lastSession).getTime() < 30 * DAY) return 'active';
  return 'follow-up';
}

/** Next live or upcoming session for a client (from the session list). */
export function nextSessionFor(clientId: string, sessions: PracticeSession[], now = new Date()) {
  return clientSessions(clientId, sessions)
    .filter((s) => s.status === 'ACTIVE' || (s.status === 'SCHEDULED' && new Date(s.scheduledAt) > now))
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];
}

/** Why a client should be on the therapist's radar, ranked (lower = more urgent). */
export function clientFocus(
  c: PracticeClient,
  sessions: PracticeSession[],
  bookings: PracticeBooking[] = [],
  now = new Date()
): { label: string; tone: Tone; rank: number } {
  const mine = clientSessions(c.id, sessions);
  const states = mine.map((s) => sessionState(s, now, sessionDuration(s, bookings)));
  if (states.includes('missed')) return { label: 'Missed session', tone: 'red', rank: 0 };
  if (states.includes('notes-pending')) return { label: 'Notes pending', tone: 'red', rank: 0 };
  const next = nextSessionFor(c.id, sessions, now);
  if (next && isSameDay(new Date(next.scheduledAt), now)) return { label: 'Upcoming today', tone: 'amber', rank: 1 };
  if (!next) return { label: 'Follow-up required', tone: 'red', rank: 2 };
  return { label: `Next ${fmtDay(next.scheduledAt, now)}`, tone: 'green', rank: 3 };
}

/* ─────────────────────────── API calls ─────────────────────────── */

async function jsonOrThrow(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/** Creates the Session row (what every view reads) and a matching Booking that
 *  records the planned duration. */
export async function createSession(
  therapistId: string,
  clientId: string,
  when: Date,
  duration?: number
): Promise<PracticeSession> {
  const data = await jsonOrThrow(
    await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ therapistId, clientId, scheduledAt: when.toISOString() }),
    })
  );
  if (duration) {
    await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ therapistId, clientId, dateTime: when.toISOString(), duration }),
    }).catch(() => {});
  }
  return data.session;
}

export async function updateSchedule(sessionId: string, action: 'cancel' | 'reschedule', scheduledAt?: Date) {
  const data = await jsonOrThrow(
    await fetch(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, scheduledAt: scheduledAt?.toISOString() }),
    })
  );
  return data.session as PracticeSession;
}

/* ─────────────────────────── files ─────────────────────────── */

export function downloadFile(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv(rows: (string | number)[][]) {
  return rows
    .map((r) =>
      r
        .map((v) => {
          const s = String(v ?? '');
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(',')
    )
    .join('\n');
}

/** iCalendar feed — imports into Google Calendar, Outlook and Apple Calendar. */
export function buildIcs(
  events: { uid: string; start: Date; minutes: number; title: string; description?: string }[]
) {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const now = stamp(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//STAAD//Practice Schedule//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@staad`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(e.start)}`,
      `DTEND:${stamp(new Date(e.start.getTime() + e.minutes * MIN))}`,
      `SUMMARY:${esc(e.title)}`,
      ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/* ─────────────────────────── availability ─────────────────────────── */

// Working hours have no schema column, so they are kept per therapist in
// localStorage and used to warn about bookings outside them.
export interface Availability {
  days: number[]; // 0 = Sunday … 6 = Saturday
  start: string; // "HH:MM"
  end: string;
}

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DEFAULT_AVAILABILITY: Availability = { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' };

const availabilityKey = (profileId?: string) => `staad-availability-${profileId ?? 'anon'}`;

export function loadAvailability(profileId?: string): Availability {
  try {
    const raw = localStorage.getItem(availabilityKey(profileId));
    if (raw) return { ...DEFAULT_AVAILABILITY, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_AVAILABILITY;
}

export function saveAvailability(profileId: string | undefined, av: Availability) {
  try {
    localStorage.setItem(availabilityKey(profileId), JSON.stringify(av));
  } catch {}
}

export function withinAvailability(when: Date, minutes: number, av: Availability) {
  if (!av.days.includes(when.getDay())) return false;
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const start = when.getHours() * 60 + when.getMinutes();
  return start >= toMin(av.start) && start + minutes <= toMin(av.end);
}

export function describeAvailability(av: Availability) {
  const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => av.days.includes(d)).map((d) => DAY_NAMES[d]);
  return `${days.length ? days.join(', ') : 'No days'} · ${av.start}–${av.end}`;
}
