'use client';

import React, { useState } from 'react';
import { Archive, ArchiveRestore, Check, Layers, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  AdminPage, Badge, Btn, Card, Checkbox, ConfirmDialog, EmptyState, ErrorBanner, Field, Input, Modal, Spinner,
  Textarea, useAdmin, useAdminQuery,
} from '@/components/admin/kit';
import { adminFetch, inr, num } from '@/lib/adminApi';
import { toast } from '@/components/practice/ui';

interface Plan {
  id: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  durationMonths: number;
  toolQuota: number | null;
  isActive: boolean;
  sortOrder: number;
  features: string[];
  maxClients: number | null;
  maxSessionsPerMonth: number | null;
  maxAiReportsPerMonth: number | null;
  subscriberCount: number;
  requestCount: number;
  pendingRequestCount: number;
}

const MAX_FEATURES = 10;
const MAX_FEATURE_LENGTH = 120;

const blankForm = {
  name: '',
  description: '',
  priceMonthly: '',
  durationMonths: '1',
  toolQuota: '',
  unlimited: false,
  sortOrder: '0',
  isActive: true,
  features: [] as string[],
  // Usage limits as typed; blank = unlimited.
  maxClients: '',
  maxSessionsPerMonth: '',
  maxAiReportsPerMonth: '',
};
type Form = typeof blankForm;

type Limits = { maxClients: number | null; maxSessionsPerMonth: number | null; maxAiReportsPerMonth: number | null };

const limitText = (n: number | null, unit: string, unlimited: string) =>
  n == null ? unlimited : `${n.toLocaleString('en-IN')} ${unit}`;

// Same fallback bullets the therapist /plans page shows when a plan has no
// features of its own — keep in sync with planFeatures() in app/plans/page.tsx.
function builtInFeatures(toolQuota: number | null, durationMonths: number, limits: Limits) {
  return [
    toolQuota == null ? 'Every therapy tool, including new ones' : `Any ${toolQuota} therapy tools you choose`,
    limitText(limits.maxClients, limits.maxClients === 1 ? 'active client' : 'active clients', 'Unlimited clients'),
    limitText(limits.maxSessionsPerMonth, 'sessions a month', 'Unlimited sessions'),
    limitText(limits.maxAiReportsPerMonth, 'AI session reports a month', 'Unlimited AI session reports'),
    'Session notes',
    'Progress tracking with PDF/CSV export',
    durationMonths > 1 ? `${durationMonths}-month default term` : 'Flexible terms from 1 to 12 months',
  ];
}

export default function AdminPlansPage() {
  const { can } = useAdmin();
  const canWrite = can('billing.write');
  const { data, loading, error, reload } = useAdminQuery<{ plans: Plan[] }>('/api/admin/plans');
  const plans = data?.plans ?? [];

  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Plan | null>(null);
  const [busy, setBusy] = useState('');

  const setArchived = async (p: Plan, archived: boolean) => {
    setBusy(p.id);
    try {
      await adminFetch(`/api/admin/plans/${p.id}`, { method: 'PATCH', json: { isActive: !archived } });
      toast(archived ? `${p.name} archived` : `${p.name} is live again`);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <AdminPage
      title="Plans"
      description="The plans professionals can buy (paid plans check out through Cashfree) or request. Free plans are requested and approved by an admin on the Subscriptions page."
      permission="billing.read"
      actions={canWrite && <Btn icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>New plan</Btn>}
    >
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : plans.length === 0 ? (
        <EmptyState icon={<Layers className="h-5 w-5" />} title="No plans yet" body="Create the first plan so professionals have something to request." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((p) => (
            <Card key={p.id} className="flex flex-col gap-3" style={p.isActive ? undefined : { opacity: 0.75 }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-heading text-xl" style={{ color: 'var(--ink)' }}>{p.name}</h3>
                  <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>{p.description || 'No description'}</p>
                </div>
                <Badge tone={p.isActive ? 'good' : 'neutral'}>{p.isActive ? 'Active' : 'Archived'}</Badge>
              </div>
              <div className="font-heading text-2xl" style={{ color: 'var(--ink)' }}>
                {p.priceMonthly === 0 ? 'Free' : inr(p.priceMonthly)}
                {p.priceMonthly > 0 && <span className="text-sm font-medium" style={{ color: 'var(--ink-muted)' }}> /mo</span>}
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <Stat label="Tools" value={p.toolQuota == null ? 'Unlimited' : num(p.toolQuota)} />
                <Stat label="Default term" value={`${p.durationMonths} mo`} />
                <Stat label="Clients" value={p.maxClients == null ? 'Unlimited' : num(p.maxClients)} />
                <Stat label="Sessions / mo" value={p.maxSessionsPerMonth == null ? 'Unlimited' : num(p.maxSessionsPerMonth)} />
                <Stat label="AI reports / mo" value={p.maxAiReportsPerMonth == null ? 'Unlimited' : num(p.maxAiReportsPerMonth)} />
                <Stat label="Subscribers" value={num(p.subscriberCount)} />
                <Stat label="Requests" value={p.pendingRequestCount ? `${num(p.requestCount)} (${num(p.pendingRequestCount)} pending)` : num(p.requestCount)} />
              </dl>
              <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                {p.features.length ? `${p.features.length} custom feature${p.features.length === 1 ? '' : 's'}` : 'Using the built-in feature list'} · sort {p.sortOrder}
              </p>
              {canWrite && (
                <div className="mt-auto flex flex-wrap gap-2 pt-1">
                  <Btn size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(p)}>Edit</Btn>
                  <Btn
                    size="sm"
                    variant="ghost"
                    loading={busy === p.id}
                    icon={p.isActive ? <Archive className="h-3.5 w-3.5" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
                    onClick={() => setArchived(p, p.isActive)}
                  >
                    {p.isActive ? 'Archive' : 'Unarchive'}
                  </Btn>
                  <Btn size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDeleting(p)}>Delete</Btn>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <PlanModal plan={editing} onClose={() => setEditing(null)} onSaved={reload} />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'plan'}?`}
        body={
          deleting && (deleting.subscriberCount || deleting.requestCount)
            ? 'This plan has subscriptions or requests on record, so the server will refuse to delete it. Archive it instead to hide it from professionals.'
            : 'This permanently removes the plan. Only plans that were never requested can be deleted.'
        }
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          await adminFetch(`/api/admin/plans/${deleting!.id}`, { method: 'DELETE' });
          toast('Plan deleted');
          reload();
        }}
      />
    </AdminPage>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>{label}</dt>
      <dd className="font-semibold" style={{ color: 'var(--ink)' }}>{value}</dd>
    </div>
  );
}

// ─── Create / edit, with a live preview of the therapist card ───────────────

function toForm(p: Plan | 'new' | null): Form {
  if (!p || p === 'new') return { ...blankForm, features: [] };
  return {
    name: p.name,
    description: p.description || '',
    priceMonthly: String(p.priceMonthly),
    durationMonths: String(p.durationMonths),
    toolQuota: p.toolQuota == null ? '' : String(p.toolQuota),
    unlimited: p.toolQuota == null,
    sortOrder: String(p.sortOrder),
    isActive: p.isActive,
    features: [...p.features],
    maxClients: p.maxClients == null ? '' : String(p.maxClients),
    maxSessionsPerMonth: p.maxSessionsPerMonth == null ? '' : String(p.maxSessionsPerMonth),
    maxAiReportsPerMonth: p.maxAiReportsPerMonth == null ? '' : String(p.maxAiReportsPerMonth),
  };
}

function PlanModal({ plan, onClose, onSaved }: { plan: Plan | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Form>(toForm(null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [openedFor, setOpenedFor] = useState<Plan | 'new' | null>(null);

  // Reset the form each time the modal opens for a different plan.
  if (plan !== openedFor) {
    setOpenedFor(plan);
    if (plan) {
      setForm(toForm(plan));
      setError('');
    }
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setFeature = (i: number, v: string) => set('features', form.features.map((f, j) => (j === i ? v : f)));
  const isNew = plan === 'new';

  const save = async () => {
    if (!form.name.trim()) { setError('Name is required.'); return; }
    if (!form.unlimited && !(Number(form.toolQuota) >= 1)) { setError('Enter a tool quota of at least 1, or tick Unlimited.'); return; }
    const limitFields = [
      ['maxClients', 'Client limit'],
      ['maxSessionsPerMonth', 'Sessions per month'],
      ['maxAiReportsPerMonth', 'AI reports per month'],
    ] as const;
    for (const [key, label] of limitFields) {
      const v = form[key].trim();
      if (v && !(Number.isInteger(Number(v)) && Number(v) >= 0)) {
        setError(`${label} must be a whole number, or blank for unlimited.`);
        return;
      }
    }
    const features = form.features.map((f) => f.trim()).filter(Boolean);
    if (features.some((f) => f.length > MAX_FEATURE_LENGTH)) { setError(`Each feature must be ${MAX_FEATURE_LENGTH} characters or fewer.`); return; }
    setSaving(true);
    setError('');
    const json = {
      name: form.name.trim(),
      description: form.description,
      priceMonthly: Number(form.priceMonthly) || 0,
      durationMonths: Number(form.durationMonths) || 1,
      toolQuota: form.unlimited ? null : Number(form.toolQuota),
      sortOrder: Number(form.sortOrder) || 0,
      isActive: form.isActive,
      features,
      ...parseLimits(form),
    };
    try {
      if (isNew) await adminFetch('/api/admin/plans', { method: 'POST', json });
      else await adminFetch(`/api/admin/plans/${(plan as Plan).id}`, { method: 'PATCH', json });
      toast(isNew ? 'Plan created' : 'Plan saved');
      onClose();
      onSaved();
    } catch (e: any) {
      setError(e.message || 'Could not save the plan.');
    } finally {
      setSaving(false);
    }
  };

  const quota = form.unlimited ? null : Number(form.toolQuota) || 0;
  const price = Number(form.priceMonthly) || 0;
  const custom = form.features.map((f) => f.trim()).filter(Boolean);
  const previewFeatures = custom.length ? custom : builtInFeatures(quota, Number(form.durationMonths) || 1, parseLimits(form));

  return (
    <Modal
      open={!!plan}
      onClose={onClose}
      wide
      title={isNew ? 'New plan' : `Edit ${(plan as Plan | null)?.name ?? 'plan'}`}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={save} loading={saving}>{isNew ? 'Create plan' : 'Save changes'}</Btn>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-[1fr_260px]">
        <div className="space-y-3">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Pro" />
          </Field>
          <Field label="Description">
            <Textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Price per month (₹)" hint="Shown to professionals; nothing is charged here.">
              <Input type="number" min={0} value={form.priceMonthly} onChange={(e) => set('priceMonthly', e.target.value)} />
            </Field>
            <Field label="Default term (months)">
              <Input type="number" min={1} value={form.durationMonths} onChange={(e) => set('durationMonths', e.target.value)} />
            </Field>
            <Field label="Tool quota">
              <Input type="number" min={1} value={form.toolQuota} disabled={form.unlimited} onChange={(e) => set('toolQuota', e.target.value)} />
            </Field>
            <Field label="Sort order">
              <Input type="number" value={form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} />
            </Field>
          </div>
          <Field label="Usage limits" hint="Leave a box blank for unlimited.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <LimitInput label="Active clients" value={form.maxClients} onChange={(v) => set('maxClients', v)} />
              <LimitInput label="Sessions / month" value={form.maxSessionsPerMonth} onChange={(v) => set('maxSessionsPerMonth', v)} />
              <LimitInput label="AI reports / month" value={form.maxAiReportsPerMonth} onChange={(v) => set('maxAiReportsPerMonth', v)} />
            </div>
          </Field>
          <div className="flex flex-wrap gap-4">
            <Checkbox checked={form.unlimited} onChange={(v) => set('unlimited', v)} label="Unlimited (all tools)" />
            <Checkbox checked={form.isActive} onChange={(v) => set('isActive', v)} label="Active (visible to professionals)" />
          </div>

          <Field label={`Features (${custom.length}/${MAX_FEATURES})`} hint="Bullet points on the plan card. Leave empty to use the built-in list.">
            <div className="space-y-2">
              {form.features.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input value={f} maxLength={MAX_FEATURE_LENGTH} onChange={(e) => setFeature(i, e.target.value)} aria-label={`Feature ${i + 1}`} />
                  <Btn
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove feature ${i + 1}`}
                    icon={<X className="h-3.5 w-3.5" />}
                    onClick={() => set('features', form.features.filter((_, j) => j !== i))}
                  />
                </div>
              ))}
              <Btn
                size="sm"
                variant="ghost"
                icon={<Plus className="h-3.5 w-3.5" />}
                disabled={form.features.length >= MAX_FEATURES}
                onClick={() => set('features', [...form.features, ''])}
              >
                Add feature
              </Btn>
            </div>
          </Field>
          {error && <ErrorBanner message={error} />}
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>Preview</p>
          <div className="space-y-3 rounded-2xl p-4" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
            {!form.isActive && <Badge>Hidden — archived</Badge>}
            <div>
              <p className="font-heading text-lg" style={{ color: 'var(--ink)' }}>{form.name.trim() || 'Plan name'}</p>
              <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>{form.description.trim() || 'Everything your practice needs to run its day.'}</p>
            </div>
            <div>
              <p className="font-heading text-2xl" style={{ color: 'var(--ink)' }}>{price === 0 ? 'Free' : inr(price)}</p>
              <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>{price === 0 ? 'no charge' : 'per month, billed monthly'}</p>
            </div>
            <ul className="space-y-1.5">
              {previewFeatures.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-xs" style={{ color: 'var(--ink)' }}>
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: 'var(--sage)' }} />
                  <span className="break-words">{f}</span>
                </li>
              ))}
            </ul>
            <div className="rounded-xl py-2 text-center text-xs font-semibold" style={{ background: 'var(--sage)', color: 'var(--on-sage, #fff)' }}>
              Request {form.name.trim() || 'plan'}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// Blank boxes mean unlimited (null).
function parseLimits(form: Form): Limits {
  const v = (s: string) => (s.trim() === '' ? null : Number(s));
  return {
    maxClients: v(form.maxClients),
    maxSessionsPerMonth: v(form.maxSessionsPerMonth),
    maxAiReportsPerMonth: v(form.maxAiReportsPerMonth),
  };
}

function LimitInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-semibold" style={{ color: 'var(--ink-muted)' }}>{label}</span>
      <Input type="number" min={0} step={1} inputMode="numeric" placeholder="Unlimited" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
