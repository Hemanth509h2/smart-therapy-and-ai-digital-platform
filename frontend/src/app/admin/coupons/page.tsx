'use client';

import React, { useState } from 'react';
import { Download, Pencil, Plus, Power, PowerOff, TicketPercent, Trash2 } from 'lucide-react';
import {
  AdminPage, Badge, Btn, Checkbox, ConfirmDialog, DataTable, EmptyState, ErrorBanner, Field, Input, Modal, Select,
  Spinner, useAdmin, useAdminQuery, type Column, type Tone,
} from '@/components/admin/kit';
import { adminFetch, downloadCsv, fmtDate, inr, num } from '@/lib/adminApi';
import { caughtErrorMessage } from '@/lib/apiError';
import { toast } from '@/components/practice/ui';

interface Coupon {
  id: string;
  code: string;
  description: string | null;
  type: 'PERCENT' | 'FLAT';
  discountValue: number;
  planIds: string[];
  minMonths: number;
  maxMonths: number | null;
  maxRedemptions: number | null;
  oncePerTherapist: boolean;
  therapistId: string | null;
  therapistName: string | null;
  email: string | null;
  startsAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
  redemptionCount: number;
  discountTotal: number;
}
interface Plan { id: string; name: string; priceMonthly: number; isActive: boolean }
interface Professional { id: string; name: string; email?: string }

// "Term" choices: '1' = any term, MONTHLY = 1-month purchases only, else that many months or more.
const MONTHLY = 'monthly';
const TERM_OPTIONS = [
  { value: '1', label: 'Any term' },
  { value: MONTHLY, label: 'Monthly only' },
  ...[3, 6, 12].map((m) => ({ value: String(m), label: `${m}+ months` })),
];
// "Who can use it" value for a code reserved for an email address.
const BY_EMAIL = '__email__';

const termText = (c: Pick<Coupon, 'minMonths' | 'maxMonths'>) =>
  c.maxMonths === 1 ? 'Monthly only' : c.minMonths > 1 ? `${c.minMonths}+ months` : 'Any term';

const discountText = (c: Pick<Coupon, 'type' | 'discountValue'>) =>
  c.type === 'PERCENT' ? `${c.discountValue}% off` : `${inr(c.discountValue)} off`;

function couponStatus(c: Coupon): { label: string; tone: Tone } {
  const now = Date.now();
  if (!c.isActive) return { label: 'Disabled', tone: 'neutral' };
  if (c.expiresAt && new Date(c.expiresAt).getTime() <= now) return { label: 'Expired', tone: 'bad' };
  if (c.maxRedemptions != null && c.redemptionCount >= c.maxRedemptions) return { label: 'Used up', tone: 'warn' };
  if (c.startsAt && new Date(c.startsAt).getTime() > now) return { label: 'Scheduled', tone: 'info' };
  return { label: 'Active', tone: 'good' };
}

export default function AdminCouponsPage() {
  const { can } = useAdmin();
  const canWrite = can('billing.write');
  const { data, loading, error, reload } = useAdminQuery<{ coupons: Coupon[] }>('/api/admin/coupons', 'load the coupons');
  const { data: planData } = useAdminQuery<{ plans: Plan[] }>('/api/admin/plans', 'load the plans');
  const coupons = data?.coupons ?? [];
  const paidPlans = (planData?.plans ?? []).filter((p) => p.priceMonthly > 0);
  const planName = (id: string) => paidPlans.find((p) => p.id === id)?.name ?? 'Removed plan';

  const [editing, setEditing] = useState<Coupon | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Coupon | null>(null);
  const [busy, setBusy] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Only coupons still in the list, so a deleted coupon drops out of the selection.
  const picked = coupons.filter((c) => selected.has(c.id));
  const allSelected = coupons.length > 0 && picked.length === coupons.length;
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(coupons.map((c) => c.id)));

  // Exports the given coupons, or every coupon when none are passed.
  const exportCsv = (rows: Coupon[] = coupons) => {
    downloadCsv(`coupons-${new Date().toISOString().slice(0, 10)}`, rows, [
      { header: 'Code', value: (c) => c.code },
      { header: 'Description', value: (c) => c.description ?? '' },
      { header: 'Discount', value: (c) => (c.type === 'PERCENT' ? `${c.discountValue}%` : `₹${c.discountValue}`) },
      { header: 'Plans', value: (c) => (c.planIds.length ? c.planIds.map(planName).join('; ') : 'All paid plans') },
      { header: 'Term', value: (c) => termText(c) },
      { header: 'Who can use it', value: (c) => c.email ?? c.therapistName ?? (c.therapistId ? 'One professional' : 'Any professional') },
      { header: 'Once per professional', value: (c) => (c.oncePerTherapist ? 'Yes' : 'No') },
      { header: 'Uses', value: (c) => c.redemptionCount },
      { header: 'Use limit', value: (c) => c.maxRedemptions ?? 'Unlimited' },
      { header: 'Discount given (₹)', value: (c) => c.discountTotal },
      { header: 'Starts', value: (c) => c.startsAt ?? '' },
      { header: 'Expires', value: (c) => c.expiresAt ?? '' },
      { header: 'Status', value: (c) => couponStatus(c).label },
      { header: 'Created', value: (c) => c.createdAt },
    ]);
    toast(`Exported ${rows.length} coupon${rows.length === 1 ? '' : 's'}.`);
  };

  const setActive = async (c: Coupon, isActive: boolean) => {
    setBusy(c.id);
    try {
      await adminFetch(`/api/admin/coupons/${c.id}`, {
        method: 'PATCH',
        json: { isActive },
        action: isActive ? 'enable this coupon' : 'disable this coupon',
      });
      toast(isActive ? `Coupon ${c.code} is enabled.` : `Coupon ${c.code} is disabled.`);
      reload();
    } catch (e) {
      toast(caughtErrorMessage(e, isActive ? 'enable this coupon' : 'disable this coupon'), 'error');
    } finally {
      setBusy('');
    }
  };

  const columns: Column<Coupon>[] = [
    {
      key: 'select',
      header: <input type="checkbox" aria-label="Select all coupons" checked={allSelected} onChange={toggleAll} style={{ accentColor: 'var(--sage)', width: 15, height: 15 }} />,
      render: (c) => (
        <input type="checkbox" aria-label={`Select ${c.code}`} checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} style={{ accentColor: 'var(--sage)', width: 15, height: 15 }} />
      ),
      className: 'w-8',
    },
    {
      key: 'code',
      header: 'Code',
      render: (c) => (
        <div className="min-w-0">
          <p className="font-mono font-bold" style={{ color: 'var(--ink)' }}>{c.code}</p>
          {c.description && <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>{c.description}</p>}
          {c.therapistId && (
            <p className="mt-1"><Badge tone="info">Only {c.therapistName || 'one professional'}</Badge></p>
          )}
          {c.email && <p className="mt-1"><Badge tone="info">Only {c.email}</Badge></p>}
        </div>
      ),
    },
    { key: 'discount', header: 'Discount', render: (c) => discountText(c) },
    {
      key: 'applies',
      header: 'Applies to',
      render: (c) => (
        <span className="text-xs">
          {c.planIds.length ? c.planIds.map(planName).join(', ') : 'All paid plans'}
          {c.maxMonths === 1 ? ' · Monthly only' : c.minMonths > 1 && ` · ${c.minMonths}+ months`}
        </span>
      ),
    },
    {
      key: 'used',
      header: 'Used',
      align: 'right',
      render: (c) => (
        <span title={c.discountTotal ? `${inr(c.discountTotal)} discounted` : undefined}>
          {num(c.redemptionCount)}{c.maxRedemptions != null && ` / ${num(c.maxRedemptions)}`}
        </span>
      ),
    },
    {
      key: 'valid',
      header: 'Valid',
      render: (c) => (
        <span className="whitespace-nowrap text-xs">
          {c.startsAt ? fmtDate(c.startsAt) : 'Now'} – {c.expiresAt ? fmtDate(c.expiresAt) : 'No expiry'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) => {
        const s = couponStatus(c);
        return <Badge tone={s.tone}>{s.label}</Badge>;
      },
    },
  ];
  if (canWrite) {
    columns.push({
      key: 'actions',
      header: '',
      align: 'right',
      render: (c) => (
        <div className="flex justify-end gap-1.5">
          <Btn size="sm" variant="ghost" aria-label={`Edit ${c.code}`} icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(c)} />
          <Btn
            size="sm"
            variant="ghost"
            loading={busy === c.id}
            aria-label={c.isActive ? `Disable ${c.code}` : `Enable ${c.code}`}
            title={c.isActive ? 'Disable' : 'Enable'}
            icon={c.isActive ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
            onClick={() => setActive(c, !c.isActive)}
          />
          <Btn size="sm" variant="danger" aria-label={`Delete ${c.code}`} icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDeleting(c)} />
        </div>
      ),
    });
  }

  return (
    <AdminPage
      title="Coupons"
      description="Discount codes professionals can enter when paying for a plan through Cashfree. A use is counted once the payment succeeds."
      permission="billing.read"
      actions={
        <>
          <Btn variant="ghost" icon={<Download className="h-4 w-4" />} disabled={!coupons.length} onClick={() => exportCsv()}>Export CSV</Btn>
          {canWrite && <Btn icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>New coupon</Btn>}
        </>
      }
    >
      {picked.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl px-4 py-2.5 text-sm" style={{ background: 'var(--sage-light)', border: '1px solid var(--glass-border)', color: 'var(--ink)' }}>
          <span className="font-semibold">{picked.length} selected</span>
          <span className="flex-1" />
          <Btn size="sm" variant="ghost" icon={<Download className="h-3.5 w-3.5" />} onClick={() => exportCsv(picked)}>Export selected</Btn>
          <Btn size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Btn>
        </div>
      )}
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : coupons.length === 0 ? (
        <EmptyState
          icon={<TicketPercent className="h-5 w-5" />}
          title="No coupons yet"
          body="Create a code like WELCOME20 to give professionals a discount on paid plans."
          action={canWrite && <Btn icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>New coupon</Btn>}
        />
      ) : (
        <DataTable columns={columns} rows={coupons} rowKey={(c) => c.id} />
      )}

      <CouponModal coupon={editing} plans={paidPlans} onClose={() => setEditing(null)} onSaved={reload} />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.code ?? 'coupon'}?`}
        body={
          deleting?.redemptionCount
            ? 'This coupon has been used, so the server will refuse to delete it. Disable it instead.'
            : 'This permanently removes the coupon. Only coupons no order has used can be deleted.'
        }
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          await adminFetch(`/api/admin/coupons/${deleting!.id}`, { method: 'DELETE', action: 'delete this coupon' });
          toast(`Coupon ${deleting!.code} deleted.`);
          reload();
        }}
      />
    </AdminPage>
  );
}

// ─── Create / edit ──────────────────────────────────────────────────────────

const blankForm = {
  code: '',
  description: '',
  type: 'PERCENT' as Coupon['type'],
  discountValue: '',
  planIds: [] as string[],
  term: '1',
  maxRedemptions: '',
  oncePerTherapist: true,
  therapistId: '', // '' = anyone, BY_EMAIL = whoever has `email`
  email: '',
  startsAt: '',
  expiresAt: '',
  isActive: true,
};
type Form = typeof blankForm;

// Dates are edited as whole days; expiry runs to the end of the chosen day.
const toDay = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-CA') : '');
const startOfDay = (s: string) => (s ? new Date(`${s}T00:00:00`).toISOString() : null);
const endOfDay = (s: string) => (s ? new Date(`${s}T23:59:59`).toISOString() : null);

function toForm(c: Coupon | 'new' | null): Form {
  if (!c || c === 'new') return { ...blankForm, planIds: [] };
  return {
    code: c.code,
    description: c.description || '',
    type: c.type,
    discountValue: String(c.discountValue),
    planIds: [...c.planIds],
    term: c.maxMonths === 1 ? MONTHLY : String(c.minMonths),
    maxRedemptions: c.maxRedemptions == null ? '' : String(c.maxRedemptions),
    oncePerTherapist: c.oncePerTherapist,
    therapistId: c.therapistId || (c.email ? BY_EMAIL : ''),
    email: c.email || '',
    startsAt: toDay(c.startsAt),
    expiresAt: toDay(c.expiresAt),
    isActive: c.isActive,
  };
}

function CouponModal({ coupon, plans, onClose, onSaved }: { coupon: Coupon | 'new' | null; plans: Plan[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Form>(toForm(null));
  const [saving, setSaving] = useState(false);
  const [openedFor, setOpenedFor] = useState<Coupon | 'new' | null>(null);
  const { can } = useAdmin();
  const pros = useAdminQuery<{ professionals: Professional[] }>(
    coupon && can('people.read') ? '/api/admin/professionals?pageSize=200&sort=name&dir=asc' : null,
    'load the professionals'
  );

  // Reset the form each time the modal opens for a different coupon.
  if (coupon !== openedFor) {
    setOpenedFor(coupon);
    if (coupon) setForm(toForm(coupon));
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const togglePlan = (id: string) =>
    set('planIds', form.planIds.includes(id) ? form.planIds.filter((p) => p !== id) : [...form.planIds, id]);
  const isNew = coupon === 'new';
  const editingCoupon = coupon && coupon !== 'new' ? coupon : null;
  const proOptions = (pros.data?.professionals ?? []).map((p) => ({
    value: p.id,
    label: p.email ? `${p.name} (${p.email})` : p.name,
  }));
  // Keep the saved professional selectable even if they're outside the loaded list.
  if (form.therapistId && form.therapistId !== BY_EMAIL && !proOptions.some((o) => o.value === form.therapistId)) {
    proOptions.unshift({
      value: form.therapistId,
      label: editingCoupon?.therapistId === form.therapistId ? editingCoupon.therapistName || 'Assigned professional' : 'Assigned professional',
    });
  }

  const save = async () => {
    const value = Number(form.discountValue);
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(form.code.trim())) { toast('Code must be 3–32 letters, numbers, - or _.', 'error'); return; }
    if (!Number.isInteger(value) || value < 1) { toast('Enter a whole-number discount of at least 1.', 'error'); return; }
    if (form.type === 'PERCENT' && value > 100) { toast('A percentage discount must be 1–100%.', 'error'); return; }
    if (form.maxRedemptions.trim() && !(Number.isInteger(Number(form.maxRedemptions)) && Number(form.maxRedemptions) >= 1)) {
      toast('Usage limit must be a whole number of at least 1, or blank for unlimited.', 'error');
      return;
    }
    const byEmail = form.therapistId === BY_EMAIL;
    if (byEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { toast('Enter the email address the professional will sign up with.', 'error'); return; }
    if (form.startsAt && form.expiresAt && form.expiresAt < form.startsAt) { toast('Expiry must be on or after the start date.', 'error'); return; }
    setSaving(true);
    const json = {
      code: form.code.trim().toUpperCase(),
      description: form.description,
      type: form.type,
      discountValue: value,
      planIds: form.planIds,
      minMonths: form.term === MONTHLY ? 1 : Number(form.term) || 1,
      maxMonths: form.term === MONTHLY ? 1 : null,
      maxRedemptions: form.maxRedemptions.trim() ? Number(form.maxRedemptions) : null,
      oncePerTherapist: form.oncePerTherapist,
      therapistId: byEmail ? null : form.therapistId || null,
      email: byEmail ? form.email.trim().toLowerCase() : null,
      startsAt: startOfDay(form.startsAt),
      expiresAt: endOfDay(form.expiresAt),
      isActive: form.isActive,
    };
    try {
      if (isNew) await adminFetch('/api/admin/coupons', { method: 'POST', json, action: 'create the coupon' });
      else await adminFetch(`/api/admin/coupons/${(coupon as Coupon).id}`, { method: 'PATCH', json, action: 'save the coupon' });
      toast(isNew ? `Coupon ${form.code.trim().toUpperCase()} created.` : 'Coupon saved.');
      onClose();
      onSaved();
    } catch (e) {
      toast(caughtErrorMessage(e, isNew ? 'create the coupon' : 'save the coupon'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!coupon}
      onClose={onClose}
      title={isNew ? 'New coupon' : `Edit ${(coupon as Coupon | null)?.code ?? 'coupon'}`}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={save} loading={saving}>{isNew ? 'Create coupon' : 'Save changes'}</Btn>
        </>
      }
    >
      <Field label="Code" hint="What professionals type at checkout. Not case-sensitive.">
        <Input value={form.code} maxLength={32} onChange={(e) => set('code', e.target.value.toUpperCase().replace(/\s/g, ''))} placeholder="e.g. WELCOME20" className="font-mono" />
      </Field>
      <Field label="Description (optional)" hint="Shown to the professional when the code is applied.">
        <Input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="e.g. Launch offer" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Discount type">
          <Select
            value={form.type}
            onChange={(v) => set('type', v as Coupon['type'])}
            options={[{ value: 'PERCENT', label: 'Percentage (%)' }, { value: 'FLAT', label: 'Flat amount (₹)' }]}
            className="w-full"
          />
        </Field>
        <Field label={form.type === 'PERCENT' ? 'Percent off' : 'Rupees off'}>
          <Input type="number" min={1} max={form.type === 'PERCENT' ? 100 : undefined} value={form.discountValue} onChange={(e) => set('discountValue', e.target.value)} />
        </Field>
        <Field label="Term">
          <Select
            value={form.term}
            onChange={(v) => set('term', v)}
            options={TERM_OPTIONS}
            className="w-full"
          />
        </Field>
        <Field label="Total uses" hint="Blank = unlimited.">
          <Input type="number" min={1} placeholder="Unlimited" value={form.maxRedemptions} onChange={(e) => set('maxRedemptions', e.target.value)} />
        </Field>
        <Field label="Starts (optional)">
          <Input type="date" value={form.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
        </Field>
        <Field label="Expires (optional)" hint="Valid through this day.">
          <Input type="date" value={form.expiresAt} onChange={(e) => set('expiresAt', e.target.value)} />
        </Field>
      </div>
      <Field
        label="Who can use it"
        hint={
          form.therapistId === BY_EMAIL
            ? 'Personal code for whoever signs up, or has signed up, with this email. Anyone else is told the code is not valid.'
            : form.therapistId
              ? 'Personal code: anyone else who enters it is told the code is not valid.'
              : 'Any professional who has the code.'
        }
      >
        {!can('people.read') ? (
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
            {form.therapistId === BY_EMAIL
              ? `Only ${form.email}`
              : form.therapistId
                ? `Only ${editingCoupon?.therapistName || 'one professional'}`
                : 'Any professional'}
            . You need people access to change this.
          </p>
        ) : (
          <>
            {pros.error && <ErrorBanner message="Could not load professionals." onRetry={pros.reload} />}
            <Select
              value={form.therapistId}
              onChange={(v) => set('therapistId', v)}
              options={[
                { value: '', label: pros.loading && !pros.data ? 'Loading professionals…' : 'Any professional' },
                { value: BY_EMAIL, label: 'Someone not signed up yet (by email)' },
                ...proOptions,
              ]}
              className="w-full"
              ariaLabel="Who can use it"
            />
            {form.therapistId === BY_EMAIL && (
              <Input
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="name@example.com"
                aria-label="Email address"
                className="mt-2"
              />
            )}
          </>
        )}
      </Field>
      <Field label="Plans" hint={form.planIds.length ? undefined : 'None ticked = every paid plan.'}>
        {plans.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>No paid plans yet.</p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {plans.map((p) => (
              <Checkbox
                key={p.id}
                checked={form.planIds.includes(p.id)}
                onChange={() => togglePlan(p.id)}
                label={`${p.name}${p.isActive ? '' : ' (archived)'}`}
              />
            ))}
          </div>
        )}
      </Field>
      <div className="flex flex-wrap gap-4">
        <Checkbox checked={form.oncePerTherapist} onChange={(v) => set('oncePerTherapist', v)} label="One use per professional" />
        <Checkbox checked={form.isActive} onChange={(v) => set('isActive', v)} label="Enabled" />
      </div>
    </Modal>
  );
}
