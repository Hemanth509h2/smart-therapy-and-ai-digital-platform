'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useNow, usePracticeData, useTherapistGuard } from '@/hooks/usePracticeData';
import { StaadShell } from '@/components/staad/Shell';
import { TopBar } from '@/components/staad/TopBar';
import {
  Badge,
  Btn,
  EmptyCard,
  InlineError,
  SkeletonCard,
  cx,
} from '@/components/staad/parts';
import {
  IconCalendarSm,
  IconChat,
  IconCheckSm,
  IconChevronLeft,
  IconNoteAdd,
  IconPlus,
  IconProfile,
  IconRowA,
  IconRowB,
  IconSessions,
  IconTick,
} from '@/components/staad/icons';
import { AddClientDialog, StartSessionDialog } from '@/components/practice/dialogs';
import { useSessionActions } from '@/components/practice/useSessionActions';
import { toast } from '@/components/practice/ui';
import { MODULE_CATEGORIES, type ModuleItem } from '@/lib/modules';
import {
  createNote,
  fetchClientMetrics,
  fetchClientNotes,
  fetchClientReports,
  type ProgressMetric,
  type ProgressNote,
  type ProgressReport,
} from '@/lib/progressApi';
import {
  CLIENT_STATUS_META,
  SESSION_KIND,
  byStartAsc,
  clientAge,
  clientEmail,
  clientStatus,
  focusArea,
  fmtDate,
  fmtTime,
  fullName,
  hasDocs,
  initials,
  nextSessionFor,
  sessionClientId,
  sessionDuration,
  sessionNumbers,
  sessionState,
  startOfDay,
  type PracticeClient,
} from '@/lib/practice';

type Tab = 'overview' | 'history' | 'notes' | 'goals' | 'documents';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'history', label: 'Session History' },
  { key: 'notes', label: 'Notes' },
  { key: 'goals', label: 'Goals' },
  { key: 'documents', label: 'Documents' },
];

function suggestedModules(diagnosis: string[]): ModuleItem[] {
  const hay = diagnosis.join(' ').toLowerCase();
  const matched = MODULE_CATEGORIES.filter((cat) => {
    const blob = `${cat.id} ${cat.name} ${cat.desc}`.toLowerCase();
    return hay.split(/[\s,]+/).some((w) => w.length > 2 && blob.includes(w));
  });
  const cats = matched.length ? matched : MODULE_CATEGORIES.filter((c) => c.id === 'general' || c.id === 'anxiety-dep');
  return cats.flatMap((c) => c.modules).slice(0, 6);
}

function Sparkline({ values }: { values: number[] }) {
  const series = values.length >= 2 ? values : [3, 3.4, 3.2, 4, 4.6, 5.1, 5.8];
  const w = 280;
  const h = 72;
  const p = 6;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const pts = series.map((v, i) => {
    const x = p + ((w - 2 * p) * i) / (series.length - 1);
    const y = h - p - ((v - min) / range) * (h - 2 * p);
    return { x, y };
  });
  const d = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={d} fill="none" stroke="var(--lime)" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last.x} cy={last.y} r="4.2" fill="#0b0b0b" stroke="var(--lime)" strokeWidth="2" />
    </svg>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="drow">
      {icon}
      <span className="drow__k">{label}</span>
      <span className="drow__v">{value || '—'}</span>
    </div>
  );
}

export default function ClientProfilePage() {
  useTherapistGuard();
  const router = useRouter();
  const params = useParams<{ clientId: string }>();
  const clientId = params.clientId;
  const now = useNow(30_000);
  const { sessions, bookings, clients, loading, error, refresh } = usePracticeData();
  const actions = useSessionActions(refresh);

  const [tab, setTab] = useState<Tab>('overview');
  const [addOpen, setAddOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [metrics, setMetrics] = useState<ProgressMetric[]>([]);
  const [notes, setNotes] = useState<ProgressNote[]>([]);
  const [reports, setReports] = useState<ProgressReport[]>([]);
  const [extraLoading, setExtraLoading] = useState(true);

  const client = clients.find((c) => c.id === clientId) ?? null;

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setExtraLoading(true);
    Promise.allSettled([fetchClientMetrics(clientId), fetchClientNotes(clientId), fetchClientReports(clientId)])
      .then(([m, n, r]) => {
        if (cancelled) return;
        if (m.status === 'fulfilled') setMetrics(m.value);
        if (n.status === 'fulfilled') setNotes(n.value);
        if (r.status === 'fulfilled') setReports(r.value);
      })
      .finally(() => {
        if (!cancelled) setExtraLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const mine = useMemo(
    () => sessions.filter((s) => sessionClientId(s) === clientId && s.status !== 'CANCELLED').sort(byStartAsc),
    [sessions, clientId]
  );
  const past = mine.filter((s) => new Date(s.scheduledAt) < startOfDay(now) || s.status === 'COMPLETED');
  const last = past[past.length - 1] ?? null;
  const next = client ? nextSessionFor(client.id, sessions, now) : null;
  const live = mine.find((s) => sessionState(s, now, sessionDuration(s, bookings)) === 'live') ?? null;
  const upcoming = mine.filter((s) => s.status === 'ACTIVE' || (s.status === 'SCHEDULED' && new Date(s.scheduledAt) > now));
  const completed = mine.filter((s) => s.status === 'COMPLETED');
  const numbers = useMemo(() => sessionNumbers(sessions), [sessions]);
  const status = client ? clientStatus(client, sessions, bookings, now) : 'follow-up';
  const statusMeta = CLIENT_STATUS_META[status];
  const focus = client ? focusArea(client) : '';
  const email = clientEmail(client);
  const age = clientAge(client?.dateOfBirth);
  const assigned = suggestedModules(client?.diagnosis ?? []);
  const mood = metrics.filter((m) => m.metricType === 'MOOD_SCORE').sort((a, b) => +new Date(a.recordedAt) - +new Date(b.recordedAt));
  const sparkValues = mood.length >= 2 ? mood.map((m) => m.value) : completed.map((_, i) => 3 + i * 0.4);
  const moodDelta = mood.length >= 2 ? mood[mood.length - 1].value - mood[0].value : completed.length >= 2 ? 1 : 0;
  const improving = moodDelta >= 0;
  const weekly =
    mine.filter((s) => now.getTime() - new Date(s.scheduledAt).getTime() < 28 * 86_400_000).length >= 2 || !!next;
  const recentNotes = [...notes].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 2);

  const messageClient = (c: PracticeClient) => {
    const phone = c.phoneNumber?.replace(/\D/g, '');
    if (phone) {
      window.open(`https://wa.me/${phone}`, '_blank', 'noopener,noreferrer');
      return;
    }
    if (email) {
      window.location.href = `mailto:${email}`;
      return;
    }
    toast('No phone or email on file for this client.');
  };

  const saveNote = async () => {
    if (!noteDraft.trim()) return;
    setSavingNote(true);
    try {
      const note = await createNote({ clientId, content: noteDraft.trim() });
      setNotes((prev) => [note, ...prev]);
      setNoteDraft('');
      toast('Note saved.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the note.', 'error');
    } finally {
      setSavingNote(false);
    }
  };

  const startSession = () => {
    if (live) actions.enter(live);
    else if (next?.status === 'ACTIVE') actions.enter(next);
    else setStartOpen(true);
  };

  return (
    <StaadShell>
      <TopBar sessions={sessions} />

      <Link className="crumb" href="/clients">
        <IconChevronLeft />
        Clients
        {client && (
          <>
            <span aria-hidden>/</span>
            <span style={{ color: 'var(--ink)' }}>{fullName(client)}</span>
          </>
        )}
      </Link>

      {error && <InlineError message={error} onRetry={refresh} />}

      {loading && !client ? (
        <SkeletonCard height={220} />
      ) : !client ? (
        <EmptyCard
          mark={<IconProfile />}
          title="Client not found"
          body="This client is not on your caseload, or the link is out of date."
          action={<Btn href="/clients">Back to clients</Btn>}
        />
      ) : (
        <>
          <header className="chead">
            <div className="chead__who">
              <span className="av av--xl av--client">{initials(client.firstName, client.lastName) || '—'}</span>
              <div>
                <h1 className="chead__name">{fullName(client) || 'Client'}</h1>
                <p className="chead__focus">{focus}</p>
                <div className="chead__badges">
                  {live ? (
                    <span className="badge badge--solid">
                      <span className="dot dot--hard" />
                      Live
                    </span>
                  ) : (
                    <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                  )}
                  {weekly && <Badge tone="gray">Weekly session</Badge>}
                </div>
              </div>
            </div>
            <div className="chead__acts">
              <Btn icon={<IconChat />} onClick={() => messageClient(client)}>
                Message
              </Btn>
              <Btn icon={<IconPlus />} variant="primary" onClick={startSession}>
                {live ? 'Join Session' : 'Start Session'}
              </Btn>
            </div>
          </header>

          <nav className="ctabs" aria-label="Client sections">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={cx('ctab', tab === t.key && 'on')}
                aria-current={tab === t.key ? 'page' : undefined}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {tab === 'overview' && (
            <div className="ov">
              <article className="card card--flat ov__details">
                <h2 className="ovh">Client Details</h2>
                <div className="drows">
                  <DetailRow icon={<IconProfile size={16} />} label="Name" value={fullName(client)} />
                  <DetailRow icon={<IconTick size={16} />} label="Focus Area" value={focus} />
                  <DetailRow icon={<IconRowA size={16} />} label="Email" value={email} />
                  <DetailRow icon={<IconRowB size={16} />} label="Phone" value={client.phoneNumber} />
                  <DetailRow icon={<IconProfile size={16} />} label="Age" value={age} />
                  <DetailRow icon={<IconProfile size={16} />} label="Gender" value={client.gender} />
                  <DetailRow
                    icon={<IconCalendarSm size={16} />}
                    label="Joined On"
                    value={client.createdAt ? fmtDate(client.createdAt) : null}
                  />
                  <DetailRow
                    icon={<IconSessions size={16} />}
                    label="Last Session"
                    value={last ? fmtDate(last.scheduledAt) : 'None yet'}
                  />
                </div>
              </article>

              <div className="ov__mid">
                <article className="card card--flat">
                  <h2 className="ovh">Progress Overview</h2>
                  <div className="trend">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Sparkline values={sparkValues} />
                    </div>
                    <div>
                      <div className="trend__cap">Mood Trend</div>
                      <div className="trend__t">{improving ? 'Improving' : 'Needs attention'}</div>
                      <div className="trend__s">
                        {mood.length >= 2
                          ? `${moodDelta >= 0 ? '+' : ''}${moodDelta.toFixed(1)} since first log`
                          : completed.length
                            ? `${completed.length} session${completed.length === 1 ? '' : 's'} completed`
                            : 'Not enough data yet'}
                      </div>
                    </div>
                  </div>
                  <div className="minis">
                    <div className="mini">
                      <div className="mini__k">Sessions</div>
                      <div className="mini__n">{completed.length}</div>
                      <div className="mini__bar">
                        <i style={{ width: `${Math.min(100, completed.length * 20)}%` }} />
                      </div>
                    </div>
                    <div className="mini">
                      <div className="mini__k">Modules Completed</div>
                      <div className="mini__n">
                        {Math.min(completed.length, assigned.length)}
                        <span style={{ fontSize: 14, color: 'var(--muted)' }}> of {assigned.length}</span>
                      </div>
                      <div className="mini__bar">
                        <i
                          style={{
                            width: `${assigned.length ? Math.min(100, (Math.min(completed.length, assigned.length) / assigned.length) * 100) : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                    <div className="mini">
                      <div className="mini__k">Next Session</div>
                      <div className="mini__n" style={{ fontSize: next ? 16 : 28, lineHeight: '28px' }}>
                        {next ? fmtDate(next.scheduledAt) : '—'}
                      </div>
                      <div className="lsub">{next ? fmtTime(next.scheduledAt) : 'Not booked'}</div>
                    </div>
                  </div>
                </article>

                <article className="card card--flat">
                  <h2 className="ovh">Recent Notes</h2>
                  {extraLoading ? (
                    <SkeletonCard height={72} />
                  ) : recentNotes.length === 0 ? (
                    <p className="note">No notes yet. Add one from the Notes tab.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {recentNotes.map((n) => (
                        <div key={n.id} className="note-row">
                          <span className="note-row__ic">
                            <IconCheckSm />
                          </span>
                          <div>
                            {n.content}
                            <time dateTime={n.createdAt}>
                              {fmtDate(n.createdAt)} · {fmtTime(n.createdAt)}
                            </time>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ marginTop: 16 }}>
                    <button type="button" className="vlink" onClick={() => setTab('notes')}>
                      <span>View all notes</span>
                      <span className="vlink__disc">
                        <IconChevronLeft style={{ transform: 'rotate(180deg)' }} />
                      </span>
                    </button>
                  </div>
                </article>
              </div>

              <div className="ov__side">
                <article className="card card--flat">
                  <h2 className="ovh">Focus Areas</h2>
                  <div className="fpills">
                    {(client.diagnosis?.length ? client.diagnosis : [focus]).map((d) => (
                      <span key={d} className="fpill">
                        {d}
                      </span>
                    ))}
                    {assigned.slice(0, 3).map((m) => (
                      <span key={m.id} className="fpill">
                        {m.name}
                      </span>
                    ))}
                  </div>
                </article>

                <article className="card card--flat">
                  <div className="sess-block">
                    <h2 className="ovh">Upcoming Sessions</h2>
                    {upcoming.length === 0 ? (
                      <p className="note">Nothing booked yet.</p>
                    ) : (
                      upcoming.slice(0, 2).map((s) => (
                        <div key={s.id} style={{ marginBottom: 12 }}>
                          <div className="sess-block__t">
                            {fmtDate(s.scheduledAt)} · {fmtTime(s.scheduledAt)}
                          </div>
                          <div className="sess-block__s">{SESSION_KIND}</div>
                          <Badge tone="green">{s.confirmedByPatient ? 'Confirmed' : 'Scheduled'}</Badge>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="sess-block">
                    <h2 className="ovh">Last Session</h2>
                    {last ? (
                      <>
                        <div className="sess-block__t">
                          {fmtDate(last.scheduledAt)} · {fmtTime(last.scheduledAt)}
                        </div>
                        <div className="sess-block__s">{SESSION_KIND}</div>
                        <Badge tone={hasDocs(last) ? 'green' : 'red'}>
                          {last.status === 'COMPLETED' ? (hasDocs(last) ? 'Completed' : 'Notes pending') : 'Past'}
                        </Badge>
                      </>
                    ) : (
                      <p className="note">No sessions held yet.</p>
                    )}
                  </div>
                </article>

                <article className="card card--flat">
                  <h2 className="ovh">Quick Actions</h2>
                  <button type="button" className="qact" onClick={() => setTab('notes')}>
                    Add Note
                    <IconNoteAdd />
                  </button>
                  <button type="button" className="qact" onClick={() => messageClient(client)}>
                    Message
                    <IconChat />
                  </button>
                  <button type="button" className="qact" onClick={() => router.push(`/clients/${client.id}/progress`)}>
                    View Full Profile
                    <IconProfile size={16} />
                  </button>
                </article>
              </div>
            </div>
          )}

          {tab === 'history' && (
            <section>
              {mine.length === 0 ? (
                <EmptyCard
                  mark={<IconSessions />}
                  title="No sessions yet"
                  body="Start or book a session and it will show up here."
                  action={
                    <Btn icon={<IconPlus />} variant="primary" onClick={startSession}>
                      Start Session
                    </Btn>
                  }
                />
              ) : (
                <div className="list">
                  {[...mine].reverse().map((s) => {
                    const st = sessionState(s, now, sessionDuration(s, bookings));
                    return (
                      <article key={s.id} className="lrow" style={{ gridTemplateColumns: '1.6fr 1fr 1fr 120px' }}>
                        <div className="lcell">
                          <span className="lname">{fmtDate(s.scheduledAt)}</span>
                          <span className="lsub">
                            {fmtTime(s.scheduledAt)} · {SESSION_KIND}
                            {numbers.get(s.id) ? ` · Session ${numbers.get(s.id)}` : ''}
                          </span>
                        </div>
                        <div className="lcell">
                          <span className="lval">{st === 'live' ? 'In session' : st.replace('-', ' ')}</span>
                        </div>
                        <div className="lcell">
                          <span className="lsub">{hasDocs(s) ? 'Documented' : 'No notes yet'}</span>
                        </div>
                        <div className="lend">
                          {(st === 'live' || st === 'upcoming' || st === 'missed') && (
                            <Btn sm variant="primary" onClick={() => actions.enter(s)}>
                              {st === 'live' ? 'Join' : 'Open'}
                            </Btn>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {tab === 'notes' && (
            <article className="card card--flat">
              <h2 className="ovh">Notes</h2>
              <div className="field" style={{ marginBottom: 18 }}>
                <label htmlFor="client-note">Add a note</label>
                <textarea
                  id="client-note"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Latest updates, observations, key points from sessions."
                  rows={4}
                />
              </div>
              <Btn variant="primary" disabled={savingNote || !noteDraft.trim()} onClick={saveNote}>
                {savingNote ? 'Saving…' : 'Save note'}
              </Btn>
              <div className="divider" style={{ margin: '22px 0' }} />
              {notes.length === 0 ? (
                <p className="note">No notes yet for this client.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {notes.map((n) => (
                    <div key={n.id} className="note-row">
                      <span className="note-row__ic">
                        <IconCheckSm />
                      </span>
                      <div>
                        {n.content}
                        <time dateTime={n.createdAt}>
                          {fmtDate(n.createdAt)} · {fmtTime(n.createdAt)}
                          {n.isPrivate ? ' · Private' : ''}
                        </time>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          )}

          {tab === 'goals' && (
            <article className="card card--flat">
              <h2 className="ovh">Goals</h2>
              <p className="note" style={{ marginBottom: 16 }}>
                Main goals and therapy focus for this client.
              </p>
              <div className="fpills">
                {(client.diagnosis?.length ? client.diagnosis : [focus]).map((d) => (
                  <span key={d} className="fpill">
                    {d}
                  </span>
                ))}
              </div>
            </article>
          )}

          {tab === 'documents' && (
            <article className="card card--flat">
              <h2 className="ovh">Documents</h2>
              {reports.length === 0 ? (
                <p className="note">No reports yet. Export one from the full profile.</p>
              ) : (
                <div className="list">
                  {reports.map((r) => (
                    <article key={r.id} className="lrow" style={{ gridTemplateColumns: '1fr auto' }}>
                      <div className="lcell">
                        <span className="lname">{r.title || 'Progress report'}</span>
                        <span className="lsub">
                          {fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)} · {r.status}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 16 }}>
                <Btn href={`/clients/${client.id}/progress`}>View Full Profile</Btn>
              </div>
            </article>
          )}
        </>
      )}

      <AddClientDialog open={addOpen} onOpenChange={setAddOpen} onCreated={refresh} />
      <StartSessionDialog
        open={startOpen}
        onOpenChange={setStartOpen}
        clients={clients}
        sessions={sessions}
        defaultClientId={clientId}
        onAddClient={() => {
          setStartOpen(false);
          setAddOpen(true);
        }}
      />
      {actions.dialogs}
    </StaadShell>
  );
}
