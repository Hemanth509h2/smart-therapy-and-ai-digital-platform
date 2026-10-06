'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { usePracticeData, useTherapistGuard } from '@/hooks/usePracticeData';
import { StaadShell } from '@/components/staad/Shell';
import { TopBar } from '@/components/staad/TopBar';
import { Badge, Btn, Chips, InlineError, Notch, Section, SkeletonCard, cx } from '@/components/staad/parts';
import { IconArrowRightXs, IconTick } from '@/components/staad/icons';
import { DsDialog, toast } from '@/components/practice/ui';
import { ALL_MODULE_IDS, MODULE_CATEGORIES, resolveAllowedModuleIds } from '@/lib/modules';
import { fmtDate } from '@/lib/practice';
import { apiFetch } from '@/lib/api';

interface Plan {
  id: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  durationMonths: number;
  toolQuota: number | null;
}
interface Current {
  planName: string;
  priceMonthly: number;
  toolQuota: number | null;
  status: string;
  months: number;
  startedAt: string;
  currentPeriodEnd: string;
  renewed: boolean;
  renewalCount: number;
  moduleAccess: string[];
}
interface Pending {
  id: string;
  planName: string;
  months: number;
  modules: string[];
}

const MONTH_OPTIONS = [1, 3, 6, 12] as const;
type Term = (typeof MONTH_OPTIONS)[number];

const planFeatures = (p: Plan) => [
  p.toolQuota == null ? 'Every therapy tool, including new ones' : `Any ${p.toolQuota} therapy tools you choose`,
  'Unlimited clients & sessions',
  'Session notes & AI session reports',
  'Progress tracking with PDF/CSV export',
  p.durationMonths > 1 ? `${p.durationMonths}-month default term` : 'Flexible terms from 1 to 12 months',
];

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export default function PlansPage() {
  useTherapistGuard();
  const { role, profile } = useAuthStore();
  const { sessions } = usePracticeData();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [current, setCurrent] = useState<Current | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [term, setTerm] = useState<Term>(1);

  // request dialog
  const [reqPlan, setReqPlan] = useState<Plan | null>(null);
  const [months, setMonths] = useState<number>(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const [pRes, sRes] = await Promise.all([
        apiFetch('/api/plans'),
        apiFetch(`/api/subscriptions?therapistId=${profile.id}`),
      ]);
      if (pRes.ok) setPlans((await pRes.json()).plans || []);
      if (sRes.ok) {
        const d = await sRes.json();
        setCurrent(d.current);
        setPending(d.pendingRequest);
      }
      setLoadError(pRes.ok && sRes.ok ? '' : 'Some plan details could not be loaded.');
    } catch {
      setLoadError('Could not reach the server. Please try again.');
    }
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => {
    if (role === 'THERAPIST') load();
  }, [role, load]);

  const openRequest = (p: Plan) => {
    setReqPlan(p);
    setMonths(term || p.durationMonths || 1);
    setSelected(new Set(current?.moduleAccess?.slice(0, p.toolQuota ?? undefined) ?? []));
    setError('');
  };

  const toggleTool = (id: string) => {
    if (!reqPlan) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (reqPlan.toolQuota == null || next.size < reqPlan.toolQuota) next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (!reqPlan || !profile?.id) return;
    setError('');
    if (reqPlan.toolQuota != null && selected.size === 0) {
      setError('Please select at least one tool.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/subscriptions/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          therapistId: profile.id,
          planId: reqPlan.id,
          months,
          modules: Array.from(selected),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not submit request.');
      } else {
        toast(`Request for ${reqPlan.name} sent — an admin will review it.`);
        setReqPlan(null);
        load();
      }
    } catch {
      setError('Network error. Please try again.');
    }
    setSubmitting(false);
  };

  const toolsAvailable = resolveAllowedModuleIds(profile).length;

  return (
    <StaadShell>
      <TopBar sessions={sessions} />

      <div className="phead">
        <div>
          <div className="eyebrow">Billing</div>
          <h1 className="phead__title">Plans</h1>
          <p className="phead__lead">What your practice is on, and what changes if you grow.</p>
        </div>
        <div className="phead__acts">
          <Chips<Term>
            value={term}
            onChange={setTerm}
            options={MONTH_OPTIONS.map((m) => ({ key: m, label: m === 1 ? 'Monthly' : `${m} months` }))}
          />
        </div>
      </div>

      {loadError && <InlineError message={loadError} onRetry={load} />}

      {pending && (
        <div className="inline-err" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }} role="status">
          <span style={{ flex: 1 }}>
            Your request for <b>{pending.planName}</b> ({pending.months} month{pending.months === 1 ? '' : 's'}) is with
            an admin for approval.
          </span>
        </div>
      )}

      <div className="grid3">
        {loading ? (
          <>
            <SkeletonCard height={420} />
            <SkeletonCard height={420} />
            <SkeletonCard height={420} />
          </>
        ) : plans.length === 0 ? (
          <article className="card plan card--flat">
            <span className="plan__name">No plans available</span>
            <p className="mod__p">No subscription plans have been published yet. Check back soon.</p>
          </article>
        ) : (
          plans.map((p) => {
            const isCurrent = current?.planName === p.name;
            const total = p.priceMonthly * term;
            return (
              <article key={p.id} className={cx('card plan', isCurrent ? 'card--lime' : 'card--flat')}>
                {isCurrent && (
                  <Notch width={52}>
                    <button
                      type="button"
                      className="nbtn arrow"
                      aria-label="Open plan details"
                      onClick={() => openRequest(p)}
                    >
                      <IconArrowRightXs />
                    </button>
                  </Notch>
                )}

                <div>
                  {isCurrent && <span className="badge badge--solid">Current plan</span>}
                  <span className="plan__name" style={{ display: 'block' }}>
                    {p.name}
                  </span>
                  <p className="mod__p">{p.description || 'Everything your practice needs to run its day.'}</p>
                </div>

                <div>
                  <span className="plan__price">{p.priceMonthly === 0 ? 'Free' : inr(p.priceMonthly)}</span>
                  <div className="plan__per">
                    {p.priceMonthly === 0
                      ? 'no charge'
                      : term === 1
                        ? 'per month, billed monthly'
                        : `per month · ${inr(total)} for ${term} months`}
                  </div>
                </div>

                <ul className="plan__list">
                  {planFeatures(p).map((f) => (
                    <li key={f}>
                      <span className="plan__tick">
                        <IconTick />
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>

                <div className="plan__foot">
                  <Btn
                    variant={isCurrent ? 'onlime' : 'primary'}
                    onClick={() => openRequest(p)}
                    disabled={!!pending}
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    {isCurrent ? 'Manage Plan' : pending ? 'Request pending' : `Request ${p.name}`}
                  </Btn>
                </div>
              </article>
            );
          })
        )}
      </div>

      <div className="cols">
        <div className="left">
          <Section
            title="Your subscription"
            sub={current ? 'The term you are on right now' : 'You are on the free tier'}
          >
            <article className="card card--flat" style={{ minHeight: 160 }}>
              {loading ? (
                <SkeletonCard height={120} />
              ) : current ? (
                <div className="fgrid">
                  <Detail label="Plan" value={current.planName} />
                  <Detail label="Status" value={current.status} />
                  <Detail label="Started" value={fmtDate(current.startedAt)} />
                  <Detail label="Renews / ends" value={fmtDate(current.currentPeriodEnd)} />
                  <Detail label="Term" value={`${current.months} month${current.months === 1 ? '' : 's'}`} />
                  <Detail
                    label="Renewals"
                    value={current.renewalCount > 0 ? `${current.renewalCount}×` : 'First term'}
                  />
                </div>
              ) : (
                <p className="mod__p">
                  No active subscription. Request a plan above and an admin will review it.
                </p>
              )}
            </article>
          </Section>
        </div>

        <aside className="panel">
          <div>
            <h2 className="panel__t">Tool access</h2>
            <p className="panel__s">What your plan unlocks in the session room</p>
          </div>
          <div className="panel__rows">
            <div className="prow">
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="prow__t">
                  {toolsAvailable} of {ALL_MODULE_IDS.length} tools
                </span>
                <span className="prow__s">
                  {current?.toolQuota == null ? 'All therapy tools included' : `Quota: ${current.toolQuota}`}
                </span>
              </span>
              <span className="badge badge--onpanel">
                {Math.round((toolsAvailable / ALL_MODULE_IDS.length) * 100)}%
              </span>
            </div>
          </div>
          <span className="panel__glow" />
        </aside>
      </div>

      {/* plan request */}
      <DsDialog
        open={!!reqPlan}
        onOpenChange={(o) => !o && setReqPlan(null)}
        title={reqPlan ? `Request ${reqPlan.name}` : ''}
        description="An admin reviews every plan change before it takes effect."
        footer={
          <>
            <button className="ds-btn ds-btn-ghost" onClick={() => setReqPlan(null)}>
              Cancel
            </button>
            <button className="ds-btn ds-btn-clay" onClick={submit} disabled={submitting}>
              {submitting ? 'Sending…' : 'Send request'}
            </button>
          </>
        }
      >
        {reqPlan && (
          <div className="space-y-4">
            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                Term
              </div>
              <Chips<number>
                value={months}
                onChange={setMonths}
                options={MONTH_OPTIONS.map((m) => ({ key: m, label: m === 1 ? '1 month' : `${m} months` }))}
              />
            </div>

            {reqPlan.toolQuota != null && (
              <div>
                <div className="eyebrow" style={{ marginBottom: 8 }}>
                  Choose up to {reqPlan.toolQuota} tools ({selected.size} selected)
                </div>
                <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {MODULE_CATEGORIES.map((cat) => (
                    <div key={cat.id}>
                      <div className="lsub" style={{ marginBottom: 6 }}>
                        {cat.emoji} {cat.name}
                      </div>
                      <div className="chips">
                        {cat.modules.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            className={cx('chip', selected.has(m.id) && 'on')}
                            aria-pressed={selected.has(m.id)}
                            onClick={() => toggleTool(m.id)}
                          >
                            {m.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && <InlineError message={error} />}
          </div>
        )}
      </DsDialog>
    </StaadShell>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="lsub">{label}</div>
      <div className="lval" style={{ marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}
