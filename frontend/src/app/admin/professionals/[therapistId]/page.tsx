'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { ArrowLeft, Mail, Calendar, Clock, Users, Activity, Sparkles, Puzzle, FileText } from 'lucide-react';
import { apiFetch } from '@/lib/api';

const CARD_BASE =
  'rounded-[14px] border-[0.5px] border-[var(--glass-border)] shadow-[var(--glass-shadow)] bg-[var(--glass-bg)] dark:bg-[#16221e]';

interface TherapistDetail {
  id: string;
  userId: string;
  name: string;
  email: string;
  specialty: string[];
  qualification: string;
  experience: number;
  bio: string;
  joinedAt: string;
  access: { allModulesAllowed: boolean; moduleAccess: string[]; allowedCount: number; totalModules: number };
}

interface Stats {
  clients: number;
  sessions: { total: number; active: number; completed: number; scheduled: number };
  totalMinutes: number;
  invites: { pending: number; claimed: number };
  documents: number;
  ai: { analyses: number; transcriptLines: number; moduleLaunches: number };
  topModules: { id: string; count: number }[];
  lastActive: string | null;
}

interface ClientRow {
  id: string;
  firstName: string;
  lastName: string;
  diagnosis: string[];
}

interface SessionRow {
  id: string;
  status: string;
  scheduledAt: string;
  startedAt: string | null;
  endedAt: string | null;
  durationMinutes: number | null;
  client: { id: string; firstName: string; lastName: string } | null;
}

export default function TherapistDetailPage() {
  const { uid, role, profile } = useAuthStore();
  const router = useRouter();
  const params = useParams<{ therapistId: string }>();
  const therapistId = params.therapistId;

  const [therapist, setTherapist] = useState<TherapistDetail | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) { router.push('/auth'); return; }
    if (role && role !== 'ADMIN') { router.push('/'); return; }
    if (role === 'ADMIN') loadData();
  }, [uid, role, therapistId]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/therapists/${therapistId}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setTherapist(data.therapist);
      setStats(data.stats);
      setClients(data.clients || []);
      setSessions(data.sessions || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
  const fmtDateTime = (d: string | null) =>
    d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

  const statusColor = (status: string) => {
    if (status === 'ACTIVE') return { background: 'var(--sage-light)', color: 'var(--sage)' };
    if (status === 'COMPLETED') return { background: 'var(--glass-bg)', color: 'var(--ink-muted)' };
    return { background: 'var(--c-accent-bg)', color: 'var(--c-accent)' };
  };

  return (
    <DashboardLayout role={role} profile={profile}>
      <div className="space-y-6">
        <button
          onClick={() => router.push('/admin')}
          className="flex items-center gap-1.5 text-sm font-semibold"
          style={{ color: 'var(--ink-muted)' }}
        >
          <ArrowLeft className="h-4 w-4" /> Back to Professionals
        </button>

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-600">{error}</div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--sage)] border-t-transparent" />
          </div>
        ) : !therapist ? (
          <div className={`${CARD_BASE} p-10 text-center`}>
            <p className="font-medium" style={{ color: 'var(--ink-muted)' }}>Therapist not found.</p>
          </div>
        ) : (
          <>
            {/* Profile header */}
            <div className={`${CARD_BASE} p-6`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white"
                    style={{ background: 'linear-gradient(135deg, var(--sage), var(--sage-mid))' }}
                  >
                    {therapist.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '🙂'}
                  </div>
                  <div>
                    <h1 className="font-heading text-2xl" style={{ color: 'var(--ink)' }}>{therapist.name || 'Unnamed'}</h1>
                    <p className="flex items-center gap-1.5 text-sm font-medium mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                      <Mail className="h-3.5 w-3.5" /> {therapist.email}
                    </p>
                  </div>
                </div>
                <span
                  className="rounded-full px-3 py-1 text-xs font-semibold self-start sm:self-auto"
                  style={
                    therapist.access.allModulesAllowed
                      ? { background: 'var(--sage-light)', color: 'var(--sage)' }
                      : { background: 'var(--c-accent-bg)', color: 'var(--c-accent)' }
                  }
                >
                  {therapist.access.allModulesAllowed
                    ? 'All modules'
                    : `${therapist.access.allowedCount}/${therapist.access.totalModules} modules`}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {(therapist.specialty || []).map((s) => (
                  <span key={s} className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: 'var(--c-accent-bg)', color: 'var(--c-accent)' }}>
                    {s}
                  </span>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm" style={{ color: 'var(--ink-muted)' }}>
                {therapist.qualification && (
                  <div><span className="font-semibold" style={{ color: 'var(--ink)' }}>Qualification: </span>{therapist.qualification}</div>
                )}
                {therapist.experience != null && (
                  <div><span className="font-semibold" style={{ color: 'var(--ink)' }}>Experience: </span>{therapist.experience} yrs</div>
                )}
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  <span className="font-semibold" style={{ color: 'var(--ink)' }}>Joined: </span>{fmtDate(therapist.joinedAt)}
                </div>
              </div>

              {therapist.bio && (
                <p className="mt-4 text-sm" style={{ color: 'var(--ink-muted)' }}>{therapist.bio}</p>
              )}
            </div>

            {/* Stat cards */}
            {stats && (
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {[
                  { icon: Users, label: 'Clients', value: stats.clients },
                  { icon: Activity, label: 'Total sessions', value: stats.sessions.total },
                  { icon: Clock, label: 'Session time', value: fmtMinutes(stats.totalMinutes) },
                  { icon: Sparkles, label: 'AI analyses', value: stats.ai.analyses },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className={`${CARD_BASE} p-5`}>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'var(--sage-light)', color: 'var(--sage)' }}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <p className="mt-3 font-heading text-3xl" style={{ color: 'var(--ink)' }}>{value}</p>
                    <p className="text-sm font-medium" style={{ color: 'var(--ink-muted)' }}>{label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Sessions breakdown + clients */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <div className={`${CARD_BASE} overflow-hidden`}>
                  <div className="p-5 pb-0">
                    <h2 className="font-heading text-lg" style={{ color: 'var(--ink)' }}>Sessions</h2>
                  </div>
                  {sessions.length === 0 ? (
                    <p className="p-6 text-sm font-medium" style={{ color: 'var(--ink-muted)' }}>No sessions yet.</p>
                  ) : (
                    <div className="overflow-x-auto mt-3">
                      <table className="w-full text-sm">
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--glass-border)', color: 'var(--ink-muted)' }}>
                            {['Client', 'Status', 'Scheduled', 'Duration'].map((h) => (
                              <th key={h} className="px-5 py-2 text-left font-semibold" style={{ fontSize: 12 }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sessions.map((s) => (
                            <tr key={s.id} style={{ borderBottom: '1px solid var(--glass-border)', color: 'var(--ink)' }}>
                              <td className="px-5 py-3 font-medium">
                                {s.client ? `${s.client.firstName} ${s.client.lastName}` : '—'}
                              </td>
                              <td className="px-5 py-3">
                                <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={statusColor(s.status)}>
                                  {s.status}
                                </span>
                              </td>
                              <td className="px-5 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--ink-muted)' }}>
                                {fmtDateTime(s.scheduledAt)}
                              </td>
                              <td className="px-5 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--ink-muted)' }}>
                                {s.durationMinutes != null ? fmtMinutes(s.durationMinutes) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {stats && stats.topModules.length > 0 && (
                  <div className={`${CARD_BASE} p-5`}>
                    <h2 className="font-heading text-lg mb-3 flex items-center gap-2" style={{ color: 'var(--ink)' }}>
                      <Puzzle className="h-4 w-4" /> Top modules used
                    </h2>
                    <div className="space-y-2">
                      {stats.topModules.map((m) => (
                        <div key={m.id} className="flex items-center justify-between text-sm">
                          <span style={{ color: 'var(--ink)' }}>{m.id}</span>
                          <span className="font-semibold" style={{ color: 'var(--sage)' }}>{m.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className={`${CARD_BASE} p-5`}>
                <h2 className="font-heading text-lg mb-3 flex items-center gap-2" style={{ color: 'var(--ink)' }}>
                  <Users className="h-4 w-4" /> Clients ({clients.length})
                </h2>
                {clients.length === 0 ? (
                  <p className="text-sm font-medium" style={{ color: 'var(--ink-muted)' }}>No clients yet.</p>
                ) : (
                  <div className="space-y-2">
                    {clients.map((c) => (
                      <div key={c.id} className="rounded-lg p-3" style={{ background: 'var(--sage-light)', border: '1px solid var(--glass-border)' }}>
                        <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{c.firstName} {c.lastName}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {(c.diagnosis || []).map((tag) => (
                            <span key={tag} className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--c-accent-bg)', color: 'var(--c-accent)' }}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {stats && (
                  <div className="mt-4 pt-4 space-y-2 text-sm" style={{ borderTop: '1px solid var(--glass-border)', color: 'var(--ink-muted)' }}>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> Documents</span>
                      <span className="font-semibold" style={{ color: 'var(--ink)' }}>{stats.documents}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Invites claimed</span>
                      <span className="font-semibold" style={{ color: 'var(--ink)' }}>{stats.invites.claimed}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Invites pending</span>
                      <span className="font-semibold" style={{ color: 'var(--ink)' }}>{stats.invites.pending}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Last active</span>
                      <span className="font-semibold" style={{ color: 'var(--ink)' }}>{fmtDate(stats.lastActive)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}