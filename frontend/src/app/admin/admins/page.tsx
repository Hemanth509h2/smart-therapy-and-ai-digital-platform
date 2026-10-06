'use client';

import React, { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Shield, Plus, Loader2, Mail } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { apiFetch } from '@/lib/api';

const CARD_BASE =
  'rounded-[14px] border-[0.5px] border-[var(--glass-border)] shadow-[var(--glass-shadow)] bg-[var(--glass-bg)] dark:bg-[#16221e] animate-fade-up';
const GLASS_CARD = `${CARD_BASE} hover-lift`;

interface AdminRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  createdAt: string;
}

const inputStyle = { background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--ink)' } as const;

export default function AdminsPage() {
  const { uid, role, profile } = useAuthStore();
  const router = useRouter();

  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!uid) { router.push('/auth'); return; }
    if (role && role !== 'ADMIN') { router.push('/'); return; }
    if (role === 'ADMIN') fetchAdmins();
  }, [uid, role]);

  const fetchAdmins = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/admin/admins');
      if (res.ok) { const d = await res.json(); setAdmins(d.admins || []); }
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const reset = () => {
    setOpen(false); setEmail(''); setPassword(''); setFirstName(''); setLastName(''); setError('');
  };

  const handleAdd = async () => {
    setError('');
    if (!email.trim()) { setError('Email is required.'); return; }
    setSaving(true);
    try {
      const res = await apiFetch('/api/admin/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, firstName: firstName.trim(), lastName: lastName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not create admin.'); }
      else { reset(); fetchAdmins(); }
    } catch (err) { setError('Network error. Please try again.'); }
    setSaving(false);
  };

  return (
    <DashboardLayout role={role} profile={profile}>
    <div className="relative">
      <div className="relative z-10 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="font-heading text-[28px]" style={{ color: 'var(--ink)' }}>Admins</h1>
            <p className="text-sm font-medium mt-1" style={{ color: 'var(--ink-muted)' }}>
              {admins.length} admin{admins.length !== 1 ? 's' : ''} with full access
            </p>
          </div>
          <Button onClick={() => setOpen(true)} className="btn-press rounded-xl flex items-center gap-2 py-5 px-4 shadow-sm" style={{ background: 'var(--sage)', color: '#fff', border: 'none' }}>
            <Plus className="h-4 w-4" /> Add Admin
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--sage)] border-t-transparent"></div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {admins.map((a, i) => (
              <div key={a.id} className={`${GLASS_CARD} p-5 stagger-${Math.min(i + 1, 4)}`}>
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: 'linear-gradient(135deg, var(--sage), var(--sage-mid))' }}>
                    <Shield className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>{a.name || 'Admin'}</p>
                    <p className="text-xs truncate" style={{ color: 'var(--ink-muted)' }}>{a.email}</p>
                  </div>
                </div>
                <p className="text-xs mt-3" style={{ color: 'var(--ink-muted)' }}>Added {new Date(a.createdAt).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); else setOpen(true); }}>
        <DialogContent className="rounded-2xl max-w-md" style={{ background: 'var(--glass-strong)', backdropFilter: 'blur(24px)', border: '1px solid var(--glass-border)' }}>
          <DialogHeader>
            <DialogTitle className="text-2xl font-heading" style={{ color: 'var(--ink)' }}>Add Admin</DialogTitle>
            <DialogDescription className="font-medium" style={{ color: 'var(--ink-muted)' }}>
              Creates a new admin login, or promotes an existing user to admin.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-semibold" style={{ color: 'var(--ink-muted)' }}>First Name</label>
                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Jane" className="w-full rounded-xl p-3 text-sm focus-visible:outline-none" style={inputStyle} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold" style={{ color: 'var(--ink-muted)' }}>Last Name</label>
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Doe" className="w-full rounded-xl p-3 text-sm focus-visible:outline-none" style={inputStyle} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold" style={{ color: 'var(--ink-muted)' }}>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@staad.in" className="w-full rounded-xl p-3 text-sm focus-visible:outline-none" style={inputStyle} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold" style={{ color: 'var(--ink-muted)' }}>Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 6 characters (new accounts)" className="w-full rounded-xl p-3 text-sm focus-visible:outline-none" style={inputStyle} />
              <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>For an existing user, leave blank to keep their password.</p>
            </div>
            {error && <p className="text-sm font-medium" style={{ color: '#ef4444' }}>{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={reset} className="btn-press rounded-xl font-medium" style={{ color: 'var(--ink-muted)' }}>Cancel</Button>
            <Button onClick={handleAdd} disabled={saving || !email.trim()} className="btn-press rounded-xl font-semibold px-5 flex items-center gap-2" style={{ background: 'var(--sage)', color: '#fff', border: 'none' }}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Save admin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </DashboardLayout>
  );
}
