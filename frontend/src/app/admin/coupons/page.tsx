'use client';

import React, { useState } from 'react';
import { Pencil, Plus, Power, PowerOff, TicketPercent, Trash2 } from 'lucide-react';
import {
  AdminPage, Badge, Btn, Checkbox, ConfirmDialog, DataTable, EmptyState, ErrorBanner, Field, Input, Modal, Select,
  Spinner, useAdmin, useAdminQuery, type Column, type Tone,
} from '@/components/admin/kit';
import { adminFetch, fmtDate, inr, num } from '@/lib/adminApi';
import { toast } from '@/components/practice/ui';

interface Coupon {
  id: string;
  code: string;
  description: string | null;
  type: 'PERCENT' | 'FLAT';
  discountValue: number;
  planIds: string[];
  minMonths: number;
  maxRedemptions: number | null;
  oncePerTherapist: boolean;
  therapistId: string | null;
  therapistName: string | null;
  startsAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
  redemptionCount: number;
  discountTotal: number;
}
interface Plan { id: string; name: string; priceMonthly: number; isActive: boolean }
interface Professional { id: string; name: string; email?: string }

const MONTH_OPTIONS = [1, 3, 6, 12];

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
  const { data, loading, error, reload } = useAdminQuery<{ coupons: Coupon[] }>('/api/admin/coupons');
  const { data: planData } = useAdminQuery<{ plans: Plan[] }>('/api/admin/plans');
  const coupons = data?.coupons ?? [];
  const paidPlans = (planData?.plans ?? []).filter((p) => p.priceMonthly > 0);
  const planName = (id: string) => paidPlans.find((p) => p.id === id)?.name ?? 'Removed plan';

  const [editing, setEditing] = useState<Coupon | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Coupon | null>(null);
  const [busy, setBusy] = useState('');

  const setActive = async (c: Coupon, isActive: boolean) => {
    setBusy(c.id);
    try {
      await adminFetch(`/api/admin/coupons/${c.id}`, { method: 'PATCH', json: { isActive } });
      toast(isActive ? `${c.code} enabled` : `${c.code} disabled`);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const columns: Column<Coupon>[] = [
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
          {c.minMonths > 1 && ` · ${c.minMonths}+ months`}
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
      actions={canWrite && <Btn icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>New coupon</Btn>}
    >
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
          await adminFetch(`/api/admin/coupons/${deleting!.id}`, { method: 'DELETE' });
          toast('Coupon deleted');
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
  minMonths: '1',
  maxRedemptions: '',
  oncePerTherapist: true,
  therapistId: '', // '' = anyone
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
    minMonths: String(c.minMonths),
    maxRedemptions: c.maxRedemptions == null ? '' : String(c.maxRedemptions),
    oncePerTherapist: c.oncePerTherapist,
    therapistId: c.therapistId || '',
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
    coupon && can('people.read') ? '/api/admin/professionals?pageSize=200&sort=name&dir=asc' : null
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
  if (form.therapistId && !proOptions.some((o) => o.value === form.therapistId)) {
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
    if (form.startsAt && form.expiresAt && form.expiresAt < form.startsAt) { toast('Expiry must be on or after the start date.', 'error'); return; }
    setSaving(true);
    const json = {
      code: form.code.trim().toUpperCase(),
      description: form.description,
      type: form.type,
      discountValue: value,
      planIds: form.planIds,
      minMonths: Number(form.minMonths) || 1,
      maxRedemptions: form.maxRedemptions.trim() ? Number(form.maxRedemptions) : null,
      oncePerTherapist: form.oncePerTherapist,
      therapistId: form.therapistId || null,
      startsAt: startOfDay(form.startsAt),
      expiresAt: endOfDay(form.expiresAt),
      isActive: form.isActive,
    };
    try {
      if (isNew) await adminFetch('/api/admin/coupons', { method: 'POST', json });
      else await adminFetch(`/api/admin/coupons/${(coupon as Coupon).id}`, { method: 'PATCH', json });
      toast(isNew ? 'Coupon created' : 'Coupon saved');
      onClose();
      onSaved();
    } catch (e: any) {
      toast(e.message || 'Could not save the coupon.', 'error');
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
        <Field label="Minimum term">
          <Select
            value={form.minMonths}
            onChange={(v) => set('minMonths', v)}
            options={MONTH_OPTIONS.map((m) => ({ value: String(m), label: m === 1 ? 'Any term' : `${m}+ months` }))}
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
        hint={form.therapistId ? 'Personal code: anyone else who enters it is told the code is not valid.' : 'Any professional who has the code.'}
      >
        {!can('people.read') ? (
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
            {form.therapistId ? `Only ${editingCoupon?.therapistName || 'one professional'}` : 'Any professional'}. You need people access to change this.
          </p>
        ) : (
          <>
            {pros.error && <ErrorBanner message="Could not load professionals." onRetry={pros.reload} />}
            <Select
              value={form.therapistId}
              onChange={(v) => set('therapistId', v)}
              options={[{ value: '', label: pros.loading && !pros.data ? 'Loading professionals…' : 'Any professional' }, ...proOptions]}
              className="w-full"
              ariaLabel="Who can use it"
            />
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
