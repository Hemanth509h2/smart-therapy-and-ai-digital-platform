'use client';

import React, { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Check, X, RefreshCw, Ban, Inbox } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { MODULE_CATEGORIES, moduleName } from '@/lib/modules';
import { apiFetch } from '@/lib/api';

const CARD_BASE =
  'rounded-[14px] border-[0.5px] border-[var(--glass-border)] shadow-[var(--glass-shadow)] bg-[var(--glass-bg)] dark:bg-[#16221e] animate-fade-up';

interface Current {
  id: string;
  planName: string;
  status: string;
  months: number;
  startedAt: string;
  currentPeriodEnd: string;
  renewed: boolean;
  renewalCount: number;
  toolQuota: number | null;
}
interface Professional {
  therapistId: string;
  name: string;
  email: string;
  allModulesAllowed: boolean;
  moduleAccessCount: number;
  current: Current | null;
  termCount: number;
}
interface Request {
  id: string;
  therapistId: string;
  therapistName: string;
  email: string;
  planId: string;
  planName: string;
  toolQuota: number | null;
  months: number;
  modules: string[];
  note: string | null;
  createdAt: string;
}

const MONTH_OPTIONS = [1, 3, 6, 12];
const inputStyle = { background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--ink)' } as const;

export default function AdminSubscriptionsPage() {
  const { uid, role, profile } = useAuthStore();
  const router = useRouter();

  const [pros, setPros] = useState<Professional[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Approve modal
  const [approving, setApproving] = useState<Request | null>(null);
  const [months, setMonths] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!uid) { router.push('/auth'); return; }
    if (role && role !== 'ADMIN') { router.push('/'); return; }
    if (role === 'ADMIN') load();
  }, [uid, role]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/admin/subscriptions');
      if (res.ok) {
        const d = await res.json();
        setPros(d.professionals || []);
        setRequests(d.requests || []);
      }
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const openApprove = (r: Request) => {
    setApproving(r);
    setMonths(r.months);
    setSelected(new Set(r.modules));
    setError('');
  };

  const toggle = (id: string) => {
    if (!approving) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (approving.toolQuota == null || next.size < approving.toolQuota) next.add(id);
      return next;
    });
  };

  const review = async (r: Request, action: 'approve' | 'reject', extra?: object) => {
    const res = await apiFetch(`/api/admin/subscriptions/requests/${r.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    return res;
  };

  const reject = async (r: Request) => {
    setBusy(r.id);
    try { await review(r, 'reject'); load(); } catch (e) { console.error(e); }
    setBusy(null);
  };

  const approve = async () => {
    if (!approving) return;
    setError('');
    if (approving.toolQuota != null && selected.size === 0) { setError('Select at least one tool.'); return; }
    setSaving(true);
    try {
      const res = await review(approving, 'approve', { months, modules: Array.from(selected) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Could not approve.'); }
      else { setApproving(null); load(); }
    } catch (e) { setError('Network error.'); }
    setSaving(false);
  };

  const manage = async (sub: Current, action: 'renew' | 'cancel') => {
    setBusy(sub.id);
    try {
      await apiFetch(`/api/admin/subscriptions/${sub.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, months: sub.months }),
      });
      load();
    } catch (e) { console.error(e); }
    setBusy(null);
  };

  const fmtDate = (d: string) => new Date(d).toLocaleDateString();

  return (
    <DashboardLayout role={role} profile={profile}>
      <div className="relative z-10 space-y-6">
        <div>
          <h1 className="font-heading text-[28px]" style={{ color: 'var(--ink)' }}>Subscriptions</h1>
          <p className="text-sm font-medium mt-1" style={{ color: 'var(--ink-muted)' }}>
            Approve plan requests and track each professional&apos;s plan, term, and renewals.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--sage)] border-t-transparent"></div>
          </div>
        ) : (
          <>
            {/* Pending requests */}
            <div>
              <h2 className="font-heading text-xl mb-3 flex items-center gap-2" style={{ color: 'var(--ink)' }}>
                <Inbox className="h-5 w-5" /> Pending requests
                {requests.length > 0 && (
                  <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: 'var(--c-accent-bg)', color: 'var(--c-accent)' }}>{requests.length}</span>
                )}
              </h2>
              {requests.length === 0 ? (
                <div className={`${CARD_BASE} p-5 text-sm font-medium`} style={{ color: 'var(--ink-muted)' }}>No pending requests.</div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {requests.map((r) => (
                    <div key={r.id} className={`${CARD_BASE} p-5`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{r.therapistName || 'Unnamed'}</p>
                          <p className="text-xs truncate" style={{ color: 'var(--ink-muted)' }}>{r.email}</p>
                        </div>
                        <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold shrink-0" style={{ background: 'var(--sage-light)', color: 'var(--sage)' }}>
                          {r.planName} · {r.months} mo
                        </span>
                      </div>
                      <p className="text-xs mt-3" style={{ color: 'var(--ink-muted)' }}>
                        Tools: {r.toolQuota == null ? 'All (unlimited plan)' : r.modules.map(moduleName).join(', ') || '—'}
                      </p>
                      {r.note && <p className="text-xs mt-1 italic" style={{ color: 'var(--ink-muted)' }}>&ldquo;{r.note}&rdquo;</p>}
                      <p className="text-[11px] mt-2" style={{ color: 'var(--ink-muted)' }}>Requested {fmtDate(r.createdAt)}</p>
                      <div className="flex gap-2 mt-4">
                        <Button onClick={() => openApprove(r)} className="btn-press rounded-lg font-semibold flex-1 flex items-center justify-center gap-1.5" style={{ background: 'var(--sage)', color: '#fff', border: 'none' }}>
                          <Check className="h-4 w-4" /> Approve
                        </Button>
                        <Button onClick={() => reject(r)} disabled={busy === r.id} variant="ghost" className="btn-press rounded-lg font-semibold flex items-center justify-center gap-1.5" style={{ color: '#ef4444', border: '1px solid var(--glass-border)' }}>
                          {busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Reject
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Professionals + current plans */}
            <div className={`${CARD_BASE} overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--glass-border)', color: 'var(--ink-muted)' }}>
                      {['Professional', 'Plan', 'Term', 'Started', 'Renews / ends', 'Renewed', 'Status', ''].map((h) => (
                        <th key={h} className="px-4 py-3 text-left font-semibold whitespace-nowrap" style={{ fontSize: 12 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pros.map((p) => (
                      <tr key={p.therapistId} style={{ borderBottom: '1px solid var(--glass-border)', color: 'var(--ink)' }}>
                        <td className="px-4 py-3">
                          <div className="font-semibold">{p.name || 'Unnamed'}</div>
                          <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>{p.email}</div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {p.current ? (
                            <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'var(--sage-light)', color: 'var(--sage)' }}>{p.current.planName}</span>
                          ) : (
                            <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'var(--c-accent-bg)', color: 'var(--c-accent)' }}>Free tier</span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">{p.current ? `${p.current.months} mo` : '—'}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--ink-muted)' }}>{p.current ? fmtDate(p.current.startedAt) : '—'}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--ink-muted)' }}>{p.current ? fmtDate(p.current.currentPeriodEnd) : '—'}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {p.current ? (p.current.renewed ? `Yes ×${p.current.renewalCount}` : 'No') : '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--ink-muted)' }}>{p.current?.status ?? '—'}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {p.current && (
                            <div className="flex gap-1.5">
                              <button onClick={() => manage(p.current!, 'renew')} disabled={busy === p.current.id} className="btn-press flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--sage)' }}>
                                {busy === p.current.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Renew
                              </button>
                              <button onClick={() => manage(p.current!, 'cancel')} disabled={busy === p.current.id} className="btn-press flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: '#ef4444' }}>
                                <Ban className="h-3.5 w-3.5" /> Cancel
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {pros.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-10 text-center text-sm font-medium" style={{ color: 'var(--ink-muted)' }}>No professionals yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Approve modal */}
      <Dialog open={!!approving} onOpenChange={(o) => { if (!o) setApproving(null); }}>
        <DialogContent className="rounded-2xl max-w-lg" style={{ background: 'var(--glass-strong)', backdropFilter: 'blur(24px)', border: '1px solid var(--glass-border)' }}>
          <DialogHeader>
            <DialogTitle className="text-2xl font-heading" style={{ color: 'var(--ink)' }}>Approve request</DialogTitle>
            <DialogDescription className="font-medium" style={{ color: 'var(--ink-muted)' }}>
              {approving?.therapistName} · {approving?.planName}. Confirm the term and the tools to grant — this sets their in-session access.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 max-h-[55vh] overflow-y-auto">
            <div>
              <label className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>Term (months)</label>
              <div className="mt-2 flex gap-2">
                {MONTH_OPTIONS.map((m) => (
                  <button key={m} onClick={() => setMonths(m)} className="btn-press rounded-lg px-4 py-2 text-sm font-semibold"
                    style={months === m ? { background: 'var(--sage)', color: '#fff', border: '1px solid var(--sage)' } : { ...inputStyle }}>
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {approving?.toolQuota == null ? (
              <p className="text-sm font-medium rounded-lg p-3" style={{ background: 'var(--sage-light)', color: 'var(--ink)' }}>
                This is an unlimited plan — approving grants access to all tools.
              </p>
            ) : (
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>Tools to grant</label>
                  <span className="text-xs font-semibold" style={{ color: 'var(--ink-muted)' }}>{selected.size} / {approving?.toolQuota}</span>
                </div>
                <div className="mt-2 space-y-4">
                  {MODULE_CATEGORIES.map((cat) => (
                    <div key={cat.id}>
                      <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--ink-muted)' }}>{cat.emoji} {cat.name}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {cat.modules.map((m) => {
                          const checked = selected.has(m.id);
                          const full = !checked && approving?.toolQuota != null && selected.size >= approving.toolQuota;
                          return (
                            <label key={m.id} className="flex items-center gap-2 rounded-lg p-2"
                              style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', cursor: full ? 'not-allowed' : 'pointer', opacity: full ? 0.45 : 1 }}>
                              <input type="checkbox" checked={checked} disabled={full} onChange={() => toggle(m.id)} style={{ accentColor: 'var(--sage)', width: 15, height: 15 }} />
                              <span className="text-sm" style={{ color: 'var(--ink)' }}>{m.emoji} {m.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && <p className="text-sm font-medium" style={{ color: '#ef4444' }}>{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setApproving(null)} className="btn-press rounded-xl font-medium" style={{ color: 'var(--ink-muted)' }}>Cancel</Button>
            <Button onClick={approve} disabled={saving} className="btn-press rounded-xl font-semibold px-5 flex items-center gap-2" style={{ background: 'var(--sage)', color: '#fff', border: 'none' }}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Approve &amp; grant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
