'use client';

import React, { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Plus, Pencil, Layers } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { apiFetch } from '@/lib/api';

const CARD_BASE =
  'rounded-[14px] border-[0.5px] border-[var(--glass-border)] shadow-[var(--glass-shadow)] bg-[var(--glass-bg)] dark:bg-[#16221e] animate-fade-up';
const GLASS_CARD = `${CARD_BASE} hover-lift`;
const inputStyle = { background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--ink)' } as const;

interface Plan {
  id: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  durationMonths: number;
  toolQuota: number | null;
  isActive: boolean;
  sortOrder: number;
}

const blankForm = { name: '', description: '', priceMonthly: '', durationMonths: '1', toolQuota: '', unlimited: false, sortOrder: '0', isActive: true };

export default function AdminPlansPage() {
  const { uid, role, profile } = useAuthStore();
  const router = useRouter();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...blankForm });
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
      const res = await apiFetch('/api/admin/plans');
      if (res.ok) setPlans((await res.json()).plans || []);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const openNew = () => { setEditingId(null); setForm({ ...blankForm }); setError(''); setOpen(true); };
  const openEdit = (p: Plan) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      description: p.description || '',
      priceMonthly: String(p.priceMonthly),
      durationMonths: String(p.durationMonths),
      toolQuota: p.toolQuota == null ? '' : String(p.toolQuota),
      unlimited: p.toolQuota == null,
      sortOrder: String(p.sortOrder),
      isActive: p.isActive,
    });
    setError('');
    setOpen(true);
  };

  const save = async () => {
    setError('');
    if (!form.name.trim()) { setError('Name is required.'); return; }
    if (!form.unlimited && (!form.toolQuota || Number(form.toolQuota) < 1)) {
      setError('Set a tool quota, or mark the plan unlimited.');
      return;
    }
    setSaving(true);
    const body = {
      name: form.name.trim(),
      description: form.description.trim(),
      priceMonthly: Number(form.priceMonthly) || 0,
      durationMonths: Number(form.durationMonths) || 1,
      toolQuota: form.unlimited ? null : Number(form.toolQuota),
      sortOrder: Number(form.sortOrder) || 0,
      isActive: form.isActive,
    };
    try {
      const res = await apiFetch(editingId ? `/api/admin/plans/${editingId}` : '/api/admin/plans', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Could not save plan.'); }
      else { setOpen(false); load(); }
    } catch (e) { setError('Network error.'); }
    setSaving(false);
  };

  const price = (n: number) => (n > 0 ? `₹${n.toLocaleString('en-IN')}/mo` : 'Free');

  return (
    <DashboardLayout role={role} profile={profile}>
      <div className="relative z-10 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="font-heading text-[28px]" style={{ color: 'var(--ink)' }}>Plans</h1>
            <p className="text-sm font-medium mt-1" style={{ color: 'var(--ink-muted)' }}>
              Define the subscription plans therapists can request. Pricing is display-only.
            </p>
          </div>
          <Button onClick={openNew} className="btn-press rounded-xl flex items-center gap-2 py-5 px-4 shadow-sm" style={{ background: 'var(--sage)', color: '#fff', border: 'none' }}>
            <Plus className="h-4 w-4" /> New Plan
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--sage)] border-t-transparent"></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {plans.map((p, i) => (
              <div key={p.id} className={`${GLASS_CARD} p-5 stagger-${Math.min(i + 1, 4)}`} style={{ opacity: p.isActive ? 1 : 0.6 }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: 'var(--sage-light)', color: 'var(--sage)' }}>
                      <Layers className="h-4 w-4" />
                    </div>
                    <p className="font-heading text-lg" style={{ color: 'var(--ink)' }}>{p.name}</p>
                  </div>
                  {!p.isActive && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--c-accent-bg)', color: 'var(--c-accent)' }}>Inactive</span>}
                </div>
                <p className="font-heading text-2xl mt-3" style={{ color: 'var(--ink)' }}>{price(p.priceMonthly)}</p>
                {p.description && <p className="text-sm font-medium mt-1" style={{ color: 'var(--ink-muted)' }}>{p.description}</p>}
                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                  <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--sage-light)', color: 'var(--sage)' }}>
                    {p.toolQuota == null ? 'All tools' : `${p.toolQuota} tools`}
                  </span>
                  <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--ink-muted)' }}>
                    {p.durationMonths} mo default
                  </span>
                </div>
                <button onClick={() => openEdit(p)} className="btn-press mt-4 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--ink)' }}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
              </div>
            ))}
            {plans.length === 0 && (
              <div className={`${CARD_BASE} p-6 col-span-full text-sm font-medium`} style={{ color: 'var(--ink-muted)' }}>
                No plans yet. Create one, or run <code>npm run seed:plans</code> to add the starter set.
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl max-w-md" style={{ background: 'var(--glass-strong)', backdropFilter: 'blur(24px)', border: '1px solid var(--glass-border)' }}>
          <DialogHeader>
            <DialogTitle className="text-2xl font-heading" style={{ color: 'var(--ink)' }}>{editingId ? 'Edit plan' : 'New plan'}</DialogTitle>
            <DialogDescription className="font-medium" style={{ color: 'var(--ink-muted)' }}>
              Therapists choose tools up to the quota when requesting this plan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto">
            <Field label="Name">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Base" className="w-full rounded-xl p-3 text-sm focus-visible:outline-none" style={inputStyle} />
            </Field>
            <Field label="Description">
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Access to any 5 tools" className="w-full rounded-xl p-3 text-sm focus-visible:outline-none" style={inputStyle} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Price / month (₹)">
                <input type="number" value={form.priceMonthly} onChange={(e) => setForm({ ...form, priceMonthly: e.target.value })} placeholder="999" className="w-full rounded-xl p-3 text-sm focus-visible:outline-none" style={inputStyle} />
              </Field>
              <Field label="Default term (mo)">
                <input type="number" value={form.durationMonths} onChange={(e) => setForm({ ...form, durationMonths: e.target.value })} className="w-full rounded-xl p-3 text-sm focus-visible:outline-none" style={inputStyle} />
              </Field>
            </div>
            <Field label="Tool quota">
              <div className="flex items-center gap-3">
                <input type="number" disabled={form.unlimited} value={form.unlimited ? '' : form.toolQuota} onChange={(e) => setForm({ ...form, toolQuota: e.target.value })} placeholder="5" className="w-24 rounded-xl p-3 text-sm focus-visible:outline-none" style={{ ...inputStyle, opacity: form.unlimited ? 0.5 : 1 }} />
                <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink)' }}>
                  <input type="checkbox" checked={form.unlimited} onChange={(e) => setForm({ ...form, unlimited: e.target.checked })} style={{ accentColor: 'var(--sage)', width: 15, height: 15 }} />
                  Unlimited (all tools)
                </label>
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Sort order">
                <input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} className="w-full rounded-xl p-3 text-sm focus-visible:outline-none" style={inputStyle} />
              </Field>
              <div className="flex items-end pb-3">
                <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink)' }}>
                  <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} style={{ accentColor: 'var(--sage)', width: 15, height: 15 }} />
                  Active (visible to therapists)
                </label>
              </div>
            </div>
            {error && <p className="text-sm font-medium" style={{ color: '#ef4444' }}>{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} className="btn-press rounded-xl font-medium" style={{ color: 'var(--ink-muted)' }}>Cancel</Button>
            <Button onClick={save} disabled={saving} className="btn-press rounded-xl font-semibold px-5 flex items-center gap-2" style={{ background: 'var(--sage)', color: '#fff', border: 'none' }}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} {editingId ? 'Save plan' : 'Create plan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-semibold" style={{ color: 'var(--ink-muted)' }}>{label}</label>
      {children}
    </div>
  );
}
