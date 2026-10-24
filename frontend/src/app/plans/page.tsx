'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { usePracticeData, useTherapistGuard } from '@/hooks/usePracticeData';
import { StaadShell } from '@/components/staad/Shell';
import { TopBar } from '@/components/staad/TopBar';
import { Btn, Chips, Notch, Section, SkeletonCard, cx } from '@/components/staad/parts';
import { IconArrowRightXs, IconTick } from '@/components/staad/icons';
import { DsDialog, toast } from '@/components/practice/ui';
import { useErrorToast } from '@/components/practice/useErrorToast';
import { ALL_MODULE_IDS, MODULE_CATEGORIES, resolveAllowedModuleIds } from '@/lib/modules';
import { fmtDate } from '@/lib/practice';
import { apiFetch, apiFetchCached, clearApiCache } from '@/lib/api';
import { openCashfreeCheckout } from '@/lib/cashfree';

interface Plan {
  id: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  durationMonths: number;
  toolQuota: number | null;
  features?: string[];
  maxClients?: number | null;
  maxSessionsPerMonth?: number | null;
  maxAiReportsPerMonth?: number | null;
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
  cancelledAt: string | null;
}
interface Pending {
  id: string;
  planName: string;
  months: number;
  modules: string[];
  status: 'PENDING' | 'AWAITING_PAYMENT';
  couponCode: string | null;
  subtotal: number;
  discount: number;
  total: number;
}

interface AppliedCoupon {
  code: string;
  description: string | null;
  months: number;
  discount: number;
  total: number;
}

const MONTH_OPTIONS = [1, 3, 6, 12] as const;
type Term = (typeof MONTH_OPTIONS)[number];

// Admin-written bullets win; otherwise the built-in list.
const limitText = (n: number | null | undefined, unit: string, unlimited: string) =>
  n == null ? unlimited : `${n.toLocaleString('en-IN')} ${unit}`;

// Keep in sync with builtInFeatures() in app/admin/plans/page.tsx (its preview).
const planFeatures = (p: Plan) => Array.isArray(p.features) && p.features.length ? p.features : [
  p.toolQuota == null ? 'Every therapy tool, including new ones' : `Any ${p.toolQuota} therapy tools you choose`,
  limitText(p.maxClients, p.maxClients === 1 ? 'active client' : 'active clients', 'Unlimited clients'),
  limitText(p.maxSessionsPerMonth, 'sessions a month', 'Unlimited sessions'),
  limitText(p.maxAiReportsPerMonth, 'AI session reports a month', 'Unlimited AI session reports'),
  'Session notes',
  'Progress tracking with PDF/CSV export',
  p.durationMonths > 1 ? `${p.durationMonths}-month default term` : 'Flexible terms from 1 to 12 months',
];

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export default function PlansPage() {
  useTherapistGuard();
  const { role, profile, setRoleAndProfile } = useAuthStore();
  const { sessions } = usePracticeData();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [current, setCurrent] = useState<Current | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  // Paid plans are requested first and paid after an admin approves them.
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [term, setTerm] = useState<Term>(1);

  // request dialog
  const [reqPlan, setReqPlan] = useState<Plan | null>(null);
  const [months, setMonths] = useState<number>(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [phone, setPhone] = useState('');
  // coupon: what's typed, and the server-priced result once applied
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);

  // pay for an approved request / withdraw a request
  const [payOpen, setPayOpen] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  // cancel plan
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const [pRes, sRes] = await Promise.all([
        apiFetchCached('/api/plans'),
        apiFetchCached(`/api/subscriptions?therapistId=${profile.id}`),
      ]);
      if (pRes.ok) setPlans((await pRes.json()).plans || []);
      if (sRes.ok) {
        const d = await sRes.json();
        setCurrent(d.current);
        setPending(d.pendingRequest);
        setApprovalRequired(!!d.approvalRequired);
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

  useErrorToast(loadError, load);

  // Tool access lives on the therapist profile in the auth store, so reload it
  // after a plan activates or the session-room gate would use the old tools.
  const refreshProfile = useCallback(async () => {
    const res = await apiFetch('/api/users/profile');
    if (res.ok) {
      const { user } = await res.json();
      if (user?.therapist) setRoleAndProfile(user.role, user.therapist);
    }
  }, [setRoleAndProfile]);

  // Ask the backend (never the checkout popup) whether the order was paid.
  // The backend activates the plan as part of this check if the webhook
  // hasn't already.
  const confirmPayment = useCallback(
    async (orderId: string) => {
      const res = await apiFetch(`/api/payments/cashfree/order/${encodeURIComponent(orderId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not check the payment status.');
      if (data.orderStatus === 'PAID') {
        toast(
          data.planActivated
            ? 'Payment received — your plan is active.'
            : 'Payment received — activating your plan…'
        );
        // The plan was activated server-side by a GET, which doesn't clear
        // cached reads — drop them so load() sees the new subscription.
        clearApiCache();
        await Promise.all([load(), refreshProfile()]);
        return true;
      }
      return false;
    },
    [load, refreshProfile]
  );

  // Back from a payment method that redirected away (?order_id=...).
  useEffect(() => {
    if (role !== 'THERAPIST') return;
    const orderId = new URLSearchParams(window.location.search).get('order_id');
    if (!orderId) return;
    window.history.replaceState(null, '', window.location.pathname);
    confirmPayment(orderId)
      .then((paid) => !paid && toast('Payment was not completed. You have not been charged.', 'warning'))
      .catch((e) => toast(e.message, 'error'));
  }, [role, confirmPayment]);

  const openRequest = (p: Plan) => {
    setReqPlan(p);
    setMonths(term || p.durationMonths || 1);
    setSelected(new Set(current?.moduleAccess?.slice(0, p.toolQuota ?? undefined) ?? []));
    setCouponInput('');
    setCoupon(null);
  };

  // Prices the order with the code; checkout checks it again server-side.
  const applyCoupon = async (term = months) => {
    if (!reqPlan || !couponInput.trim()) return;
    setCouponBusy(true);
    try {
      const res = await apiFetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: couponInput, planId: reqPlan.id, months: term }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCoupon(null);
        toast(data.error || 'Could not apply that coupon.', 'error');
      } else {
        setCoupon({ code: data.code, description: data.description, months: term, discount: data.discount, total: data.total });
      }
    } catch {
      toast('Network error. Please try again.', 'error');
    } finally {
      setCouponBusy(false);
    }
  };

  // A coupon is priced for one term; re-price it when the term changes.
  const changeMonths = (m: number) => {
    setMonths(m);
    if (coupon) applyCoupon(m);
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
    if (reqPlan.toolQuota != null && selected.size === 0) {
      toast('Please select at least one tool.', 'warning');
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
          couponCode: couponApplies ? coupon!.code : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // e.g. the coupon expired or ran out since it was applied
        if (coupon) setCoupon(null);
        toast(data.error || 'Could not submit the request.', 'error');
      } else {
        toast(`Request for ${reqPlan.name} sent — an admin will review it.`);
        setReqPlan(null);
        load();
      }
    } catch {
      toast('Network error. Please try again.', 'error');
    }
    setSubmitting(false);
  };

  const pay = async () => {
    if (!reqPlan) return;
    if (reqPlan.toolQuota != null && selected.size === 0) {
      toast('Please select at least one tool.', 'warning');
      return;
    }
    if (reqTotal > 0 && phone.replace(/\D/g, '').length < 10) {
      toast('Please enter a 10-digit phone number.', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/payments/cashfree/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: reqPlan.id,
          months,
          modules: Array.from(selected),
          customerPhone: phone,
          returnUrl: `${window.location.origin}/plans`,
          couponCode: coupon?.code,
        }),
      });
      const order = await res.json().catch(() => ({}));
      if (!res.ok) {
        // e.g. the coupon expired or ran out since it was applied
        if (coupon) setCoupon(null);
        toast(order.error || 'Could not start the payment.', 'error');
        return;
      }
      if (order.activated) {
        // ₹0 total: started without Cashfree.
        toast(`${reqPlan.name} is active.`);
        setReqPlan(null);
        clearApiCache();
        await Promise.all([load(), refreshProfile()]);
        return;
      }

      const result = await openCashfreeCheckout(order);
      if (result.redirected) return; // finishes on return via ?order_id=

      const paid = await confirmPayment(order.orderId);
      if (paid) setReqPlan(null);
      else toast(result.closedMessage ? 'Payment was cancelled. You have not been charged.' : 'Payment was not completed. Please try again.', 'warning');
    } catch (e: any) {
      toast(e?.message || 'Network error. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Pay for a request an admin approved. Its price was fixed at approval.
  const payApproved = async () => {
    if (!pending) return;
    if (pending.total > 0 && phone.replace(/\D/g, '').length < 10) {
      toast('Please enter a 10-digit phone number.', 'warning');
      return;
    }
    setPayBusy(true);
    try {
      const res = await apiFetch('/api/payments/cashfree/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: pending.id, customerPhone: phone, returnUrl: `${window.location.origin}/plans` }),
      });
      const order = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(order.error || 'Could not start the payment.', 'error');
        if (res.status === 409) load();
        return;
      }
      if (order.activated) {
        toast(`${pending.planName} is active.`);
        setPayOpen(false);
        clearApiCache();
        await Promise.all([load(), refreshProfile()]);
        return;
      }
      const result = await openCashfreeCheckout(order);
      if (result.redirected) return; // finishes on return via ?order_id=
      const paid = await confirmPayment(order.orderId);
      if (paid) setPayOpen(false);
      else toast(result.closedMessage ? 'Payment was cancelled. You have not been charged.' : 'Payment was not completed. Please try again.', 'warning');
    } catch (e: any) {
      toast(e?.message || 'Network error. Please try again.', 'error');
    } finally {
      setPayBusy(false);
    }
  };

  const withdraw = async () => {
    if (!pending) return;
    setWithdrawing(true);
    try {
      const res = await apiFetch(`/api/subscriptions/request/${pending.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast(data.error || 'Could not withdraw the request.', 'error');
      else toast('Request withdrawn.');
      setPayOpen(false);
      load();
    } catch {
      toast('Network error. Please try again.', 'error');
    } finally {
      setWithdrawing(false);
    }
  };

  // Cancelling keeps the plan until its end date; `undo` restores it.
  const setCancelled = async (undo: boolean) => {
    setCancelBusy(true);
    try {
      const res = await apiFetch('/api/subscriptions/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ undo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || 'Could not update your plan.', 'error');
        return;
      }
      setCurrent(data.current);
      setCancelOpen(false);
      toast(
        undo
          ? 'Cancellation undone — your plan continues.'
          : `Plan cancelled. You keep access until ${fmtDate(data.current.currentPeriodEnd)}.`
      );
    } catch {
      toast('Network error. Please try again.', 'error');
    } finally {
      setCancelBusy(false);
    }
  };

  const reqSubtotal = reqPlan ? reqPlan.priceMonthly * months : 0;
  const couponApplies = !!coupon && coupon.months === months;
  const reqTotal = couponApplies ? coupon!.total : reqSubtotal;
  const reqIsPaid = !!reqPlan && reqPlan.priceMonthly > 0;
  // Pay straight away only while admins don't approve plans first.
  const payNow = reqIsPaid && !approvalRequired;
  // "Manage Plan" opens this same dialog for the plan they're already on.
  const managing = !!reqPlan && current?.planName === reqPlan.name;

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

      {pending && (
        <div className="inline-err" style={{ background: 'var(--ok-soft)', color: 'var(--ok)', flexWrap: 'wrap', gap: 10 }} role="status">
          <span style={{ flex: 1, minWidth: 220 }}>
            {pending.status === 'AWAITING_PAYMENT' ? (
              <>
                Your request for <b>{pending.planName}</b> ({pending.months} month{pending.months === 1 ? '' : 's'}) was approved.
                Pay <b>{inr(pending.total)}</b>
                {pending.couponCode ? ` (coupon ${pending.couponCode} applied)` : ''} to start it.
              </>
            ) : (
              <>
                Your request for <b>{pending.planName}</b> ({pending.months} month{pending.months === 1 ? '' : 's'}
                {pending.total > 0 ? `, ${inr(pending.total)}` : ''}
                {pending.couponCode ? ` with coupon ${pending.couponCode}` : ''}) is with an admin for approval.
                {pending.total > 0 ? ' You can pay once it is approved.' : ''}
              </>
            )}
          </span>
          {pending.status === 'AWAITING_PAYMENT' && (
            <Btn variant="primary" sm onClick={() => setPayOpen(true)}>
              Pay {inr(pending.total)}
            </Btn>
          )}
          <Btn variant="ghost" sm onClick={withdraw} disabled={withdrawing}>
            {withdrawing ? 'Withdrawing…' : 'Withdraw'}
          </Btn>
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
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    {isCurrent ? 'Manage Plan' : p.priceMonthly > 0 && !approvalRequired ? `Get ${p.name}` : `Request ${p.name}`}
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
                <div style={{ display: 'grid', gap: 18 }}>
                  {current.cancelledAt && (
                    <div className="inline-err" role="status">
                      <span style={{ flex: 1 }}>
                        Cancelled — you keep {current.planName} until <b>{fmtDate(current.currentPeriodEnd)}</b>.
                      </span>
                    </div>
                  )}
                  <div className="fgrid">
                    <Detail label="Plan" value={current.planName} />
                    <Detail label="Status" value={current.cancelledAt ? 'Cancelled' : current.status} />
                    <Detail label="Started" value={fmtDate(current.startedAt)} />
                    <Detail
                      label={current.cancelledAt ? 'Access ends' : 'Renews / ends'}
                      value={fmtDate(current.currentPeriodEnd)}
                    />
                    <Detail label="Term" value={`${current.months} month${current.months === 1 ? '' : 's'}`} />
                    <Detail
                      label="Renewals"
                      value={current.renewalCount > 0 ? `${current.renewalCount}×` : 'First term'}
                    />
                  </div>
                  <div>
                    {current.cancelledAt ? (
                      <Btn variant="primary" sm onClick={() => setCancelled(true)} disabled={cancelBusy}>
                        {cancelBusy ? 'Saving…' : 'Undo cancellation'}
                      </Btn>
                    ) : (
                      <Btn variant="ghost" sm onClick={() => setCancelOpen(true)}>
                        Cancel plan
                      </Btn>
                    )}
                  </div>
                </div>
              ) : (
                <p className="mod__p">
                  No active subscription. Choose a plan above — paid plans start as soon as payment
                  is confirmed.
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

      {/* cancel plan */}
      <DsDialog
        open={cancelOpen}
        onOpenChange={(o) => !o && setCancelOpen(false)}
        title={current ? `Cancel ${current.planName}?` : ''}
        description={
          current
            ? `You keep your plan and tools until ${fmtDate(current.currentPeriodEnd)}. After that it won't renew. No refund is issued for the remaining days, and you can undo this any time before then.`
            : ''
        }
        footer={
          <>
            <button className="ds-btn ds-btn-ghost" onClick={() => setCancelOpen(false)}>
              Keep plan
            </button>
            <button className="ds-btn ds-btn-clay" onClick={() => setCancelled(false)} disabled={cancelBusy}>
              {cancelBusy ? 'Cancelling…' : 'Cancel plan'}
            </button>
          </>
        }
      />

      {/* plan request */}
      <DsDialog
        open={!!reqPlan}
        onOpenChange={(o) => !o && setReqPlan(null)}
        title={reqPlan ? `${managing ? 'Manage' : payNow ? 'Get' : 'Request'} ${reqPlan.name}` : ''}
        description={
          managing && current?.cancelledAt
            ? `Cancelled — you keep this plan until ${fmtDate(current.currentPeriodEnd)}. Undo below to keep it going.`
            : payNow
              ? 'Pay securely with Cashfree (UPI, cards, netbanking). Your plan starts as soon as payment is confirmed.'
              : reqIsPaid
                ? 'Send a request with any coupon. Once an admin approves it you can pay here (UPI, cards, netbanking); if the total is ₹0 it starts right away.'
                : 'An admin reviews every plan change before it takes effect.'
        }
        footer={
          <>
            {managing &&
              (current?.cancelledAt ? (
                <button
                  className="ds-btn ds-btn-outline sm:mr-auto"
                  onClick={() => setCancelled(true).then(() => setReqPlan(null))}
                  disabled={cancelBusy}
                >
                  {cancelBusy ? 'Saving…' : 'Undo cancellation'}
                </button>
              ) : (
                <button
                  className="ds-btn ds-btn-danger sm:mr-auto"
                  onClick={() => {
                    setReqPlan(null);
                    setCancelOpen(true);
                  }}
                >
                  Cancel plan
                </button>
              ))}
            <button className="ds-btn ds-btn-ghost" onClick={() => setReqPlan(null)}>
              {managing ? 'Close' : 'Cancel'}
            </button>
            {payNow ? (
              <button className="ds-btn ds-btn-clay" onClick={pay} disabled={submitting}>
                {submitting ? 'Processing…' : reqTotal === 0 ? 'Activate for free' : `Pay ${inr(reqTotal)}`}
              </button>
            ) : (
              <button className="ds-btn ds-btn-clay" onClick={submit} disabled={submitting}>
                {submitting ? 'Sending…' : 'Send request'}
              </button>
            )}
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
                onChange={changeMonths}
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

            {reqIsPaid && (
              <div>
                {payNow && reqTotal > 0 && (
                  <>
                    <div className="eyebrow" style={{ marginBottom: 8 }}>
                      Phone number (for the payment receipt)
                    </div>
                    <input
                      className="ds-input"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel-national"
                      placeholder="10-digit mobile number"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      style={{ width: '100%', marginBottom: 16 }}
                    />
                  </>
                )}

                <div className="eyebrow" style={{ marginBottom: 8 }}>
                  Coupon code
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="ds-input"
                    placeholder="Have a code?"
                    value={couponInput}
                    disabled={!!coupon || couponBusy}
                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && applyCoupon()}
                    style={{ flex: 1, textTransform: 'uppercase' }}
                    aria-label="Coupon code"
                  />
                  {coupon ? (
                    <button
                      type="button"
                      className="ds-btn ds-btn-ghost"
                      onClick={() => {
                        setCoupon(null);
                        setCouponInput('');
                      }}
                    >
                      Remove
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ds-btn ds-btn-outline"
                      onClick={() => applyCoupon()}
                      disabled={couponBusy || !couponInput.trim()}
                    >
                      {couponBusy ? 'Checking…' : 'Apply'}
                    </button>
                  )}
                </div>
                {couponApplies && (
                  <p className="lsub" style={{ marginTop: 8 }}>
                    <b>{coupon!.code}</b> applied{coupon!.description ? ` — ${coupon!.description}` : ''}: −{inr(coupon!.discount)}
                  </p>
                )}

                <p className="lsub" style={{ marginTop: 8 }}>
                  Total:{' '}
                  {couponApplies && <s style={{ marginRight: 6 }}>{inr(reqSubtotal)}</s>}
                  <b>{inr(reqTotal)}</b> for {months} month{months === 1 ? '' : 's'}
                  {reqTotal === 0 && ' — nothing to pay'}
                  {!payNow && reqTotal > 0 && ' — you pay after approval'}
                </p>
              </div>
            )}

          </div>
        )}
      </DsDialog>

      {/* pay for an approved request */}
      <DsDialog
        open={payOpen && !!pending}
        onOpenChange={(o) => !o && setPayOpen(false)}
        title={pending ? `Pay for ${pending.planName}` : ''}
        description="Pay securely with Cashfree (UPI, cards, netbanking). Your plan starts as soon as payment is confirmed."
        footer={
          <>
            <button className="ds-btn ds-btn-ghost" onClick={() => setPayOpen(false)}>
              Cancel
            </button>
            <button className="ds-btn ds-btn-clay" onClick={payApproved} disabled={payBusy}>
              {payBusy ? 'Processing…' : pending && pending.total > 0 ? `Pay ${inr(pending.total)}` : 'Activate'}
            </button>
          </>
        }
      >
        {pending && (
          <div className="space-y-4">
            <p className="lsub">
              {pending.months} month{pending.months === 1 ? '' : 's'} ·{' '}
              {pending.couponCode && <s style={{ marginRight: 6 }}>{inr(pending.subtotal)}</s>}
              <b>{inr(pending.total)}</b>
              {pending.couponCode ? ` with coupon ${pending.couponCode}` : ''}
            </p>
            {pending.total > 0 && (
              <div>
                <div className="eyebrow" style={{ marginBottom: 8 }}>
                  Phone number (for the payment receipt)
                </div>
                <input
                  className="ds-input"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="10-digit mobile number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
            )}
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
