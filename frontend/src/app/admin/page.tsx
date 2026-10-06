'use client';

import React, { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Users, Activity, Sparkles, Puzzle, SlidersHorizontal, Loader2 } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { MODULE_CATEGORIES, ALL_MODULE_IDS } from '@/lib/modules';
import { apiFetch } from '@/lib/api';

const CARD_BASE =
  'rounded-[14px] border-[0.5px] border-[var(--glass-border)] shadow-[var(--glass-shadow)] bg-[var(--glass-bg)] dark:bg-[#16221e] animate-fade-up';
const GLASS_CARD = `${CARD_BASE} hover-lift`;

interface TherapistRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  specialty: string[];
  clients: number;
  sessions: { total: number; active: number; completed: number; scheduled: number };
  totalMinutes: number;
  invites: { pending: number; claimed: number };
  documents: number;
  ai: { analyses: number; transcriptLines: number; moduleLaunches: number };
  topModules: { id: string; count: number }[];
  access: { allModulesAllowed: boolean; moduleAccess: string[]; allowedCount: number; totalModules: number };
  lastActive: string | null;
}

export default function AdminOverviewPage() {
  const { uid, role, profile } = useAuthStore();
  const router = useRouter();

  const [rows, setRows] = useState<TherapistRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Access modal
  const [editing, setEditing] = useState<TherapistRow | null>(null);
  const [allowAll, setAllowAll] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [savingAccess, setSavingAccess] = useState(false);

  useEffect(() => {
    if (!uid) { router.push('/auth'); return; }
    if (role && role !== 'ADMIN') { router.push('/'); return; }
    if (role === 'ADMIN') fetchOverview();
  }, [uid, role]);

  const fetchOverview = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/admin/overview');
      if (res.ok) {
        const data = await res.json();
        setRows(data.therapists || []);
      }
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const openAccess = (t: TherapistRow) => {
    setEditing(t);
    setAllowAll(t.access.allModulesAllowed);
    setSelected(new Set(t.access.allModulesAllowed ? ALL_MODULE_IDS : t.access.moduleAccess));
  };

  const toggleModule = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const saveAccess = async () => {
    if (!editing) return;
    setSavingAccess(true);
    try {
      const res = await apiFetch(`/api/admin/therapists/${editing.id}/access`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allModulesAllowed: allowAll, moduleAccess: Array.from(selected) }),
      });
      if (res.ok) {
        setEditing(null);
        fetchOverview();
      }
    } catch (err) { console.error(err); }
    setSavingAccess(false);
  };

  const totals = rows.reduce(
    (acc, r) => ({
      clients: acc.clients + r.clients,
      sessions: acc.sessions + r.sessions.total,
      analyses: acc.analyses + r.ai.analyses,
      minutes: acc.minutes + r.totalMinutes,
    }),
    { clients: 0, sessions: 0, analyses: 0, minutes: 0 }
  );

  const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
  const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

  const summaryCards = [
    { icon: Users, label: 'Professionals', value: rows.length },
    { icon: Activity, label: 'Total sessions', value: totals.sessions },
    { icon: Sparkles, label: 'AI analyses', value: totals.analyses },
    { icon: Puzzle, label: 'Session time', value: fmtMinutes(totals.minutes) },
  ];

  return (
    <DashboardLayout role={role} profile={profile}>
    <div className="relative">
      <div className="relative z-10 space-y-6">
        <div>
          <h1 className="font-heading text-[28px]" style={{ color: 'var(--ink)' }}>Professionals</h1>
          <p className="text-sm font-medium mt-1" style={{ color: 'var(--ink-muted)' }}>
            Monitor resource usage and manage module access per therapist
          </p>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {summaryCards.map(({ icon: Icon, label, value }, i) => (
            <div key={label} className={`${CARD_BASE} stat-hover stagger-${i + 1} p-5`}>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'var(--sage-light)', color: 'var(--sage)' }}>
                <Icon className="h-5 w-5" />
              </div>
              <p className="mt-3 font-heading text-3xl" style={{ color: 'var(--ink)' }}>{value}</p>
              <p className="text-sm font-medium" style={{ color: 'var(--ink-muted)' }}>{label}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--sage)] border-t-transparent"></div>
          </div>
        ) : rows.length === 0 ? (
          <div className={`${GLASS_CARD} flex flex-col items-center justify-center py-20 gap-3`}>
            <div className="text-5xl">🧑‍⚕️</div>
            <p className="font-heading text-xl" style={{ color: 'var(--ink)' }}>No professionals yet</p>
            <p className="text-sm font-medium" style={{ color: 'var(--ink-muted)' }}>Therapists will appear here once they sign up.</p>
          </div>
        ) : (
          <div className={`${CARD_BASE} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--glass-border)', color: 'var(--ink-muted)' }}>
                    {['Professional', 'Clients', 'Sessions', 'Time', 'AI', 'Transcript', 'Modules used', 'Invites', 'Access', 'Last active', ''].map((h) => (
                      <th key={h} className="px-4 py-3 text-left font-semibold whitespace-nowrap" style={{ fontSize: 12 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => router.push(`/admin/professionals/${t.id}`)}
                      className="cursor-pointer hover-lift"
                      style={{ borderBottom: '1px solid var(--glass-border)', color: 'var(--ink)' }}
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold">{t.name || 'Unnamed'}</div>
                        <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>{t.email}</div>
                      </td>
                      <td className="px-4 py-3">{t.clients}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {t.sessions.total}
                        <span className="text-xs" style={{ color: 'var(--ink-muted)' }}> ({t.sessions.active}a · {t.sessions.completed}c)</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{fmtMinutes(t.totalMinutes)}</td>
                      <td className="px-4 py-3">{t.ai.analyses}</td>
                      <td className="px-4 py-3">{t.ai.transcriptLines}</td>
                      <td className="px-4 py-3">{t.ai.moduleLaunches}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span style={{ color: 'var(--sage)' }}>{t.invites.claimed}</span>
                        <span className="text-xs" style={{ color: 'var(--ink-muted)' }}> / {t.invites.pending} pend</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          style={
                            t.access.allModulesAllowed
                              ? { background: 'var(--sage-light)', color: 'var(--sage)' }
                              : { background: 'var(--c-accent-bg)', color: 'var(--c-accent)' }
                          }
                        >
                          {t.access.allModulesAllowed ? 'All' : `${t.access.allowedCount}/${t.access.totalModules}`}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--ink-muted)' }}>{fmtDate(t.lastActive)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={(e) => { e.stopPropagation(); openAccess(t); }}
                          className="btn-press flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap"
                          style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--ink)' }}
                        >
                          <SlidersHorizontal className="h-3.5 w-3.5" /> Access
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Module access modal */}
      <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent className="rounded-2xl max-w-lg" style={{ background: 'var(--glass-strong)', backdropFilter: 'blur(24px)', border: '1px solid var(--glass-border)' }}>
          <DialogHeader>
            <DialogTitle className="text-2xl font-heading" style={{ color: 'var(--ink)' }}>Module access</DialogTitle>
            <DialogDescription className="font-medium" style={{ color: 'var(--ink-muted)' }}>
              Choose which tools {editing?.name || 'this therapist'} can launch in sessions.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 max-h-[55vh] overflow-y-auto">
            <label className="flex items-center gap-3 rounded-xl p-3 cursor-pointer" style={{ background: 'var(--sage-light)', border: '1px solid var(--glass-border)' }}>
              <input type="checkbox" checked={allowAll} onChange={(e) => setAllowAll(e.target.checked)} style={{ accentColor: 'var(--sage)', width: 16, height: 16 }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Allow all modules</p>
                <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>Therapist can launch every tool (default).</p>
              </div>
            </label>

            <div style={{ opacity: allowAll ? 0.45 : 1, pointerEvents: allowAll ? 'none' : 'auto' }} className="space-y-4">
              {MODULE_CATEGORIES.map((cat) => (
                <div key={cat.id}>
                  <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--ink-muted)' }}>{cat.emoji} {cat.name}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {cat.modules.map((m) => (
                      <label key={m.id} className="flex items-center gap-2 rounded-lg p-2 cursor-pointer" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                        <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggleModule(m.id)} style={{ accentColor: 'var(--sage)', width: 15, height: 15 }} />
                        <span className="text-sm" style={{ color: 'var(--ink)' }}>{m.emoji} {m.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)} className="btn-press rounded-xl font-medium" style={{ color: 'var(--ink-muted)' }}>Cancel</Button>
            <Button onClick={saveAccess} disabled={savingAccess} className="btn-press rounded-xl font-semibold px-5 flex items-center gap-2" style={{ background: 'var(--sage)', color: '#fff', border: 'none' }}>
              {savingAccess && <Loader2 className="h-4 w-4 animate-spin" />} Save access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </DashboardLayout>
  );
}