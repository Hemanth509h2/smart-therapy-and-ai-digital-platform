'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Lock, Menu } from 'lucide-react';
import Sidebar from './Sidebar';
import { cx } from '@/components/practice/ui';
import { apiFetch, PLAN_REQUIRED_EVENT } from '@/lib/api';

interface DashboardLayoutProps {
  children: React.ReactNode;
  role: 'THERAPIST' | 'CLIENT' | 'ADMIN' | null;
  profile: any;
}

const COLLAPSE_KEY = 'staad-sidebar-collapsed';

// Therapists without an active plan can browse but not act; the backend
// refuses their actions (402 PLAN_REQUIRED). Returns true once we know there
// is no plan, so the layout can say so up front. Re-checks on navigation, so
// buying a plan on /plans clears it on the next page.
function useNoActivePlan(role: DashboardLayoutProps['role'], therapistId: string | undefined) {
  const pathname = usePathname();
  const [noPlan, setNoPlan] = useState(false);

  useEffect(() => {
    if (role !== 'THERAPIST' || !therapistId) return;
    let cancelled = false;
    apiFetch(`/api/subscriptions?therapistId=${therapistId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setNoPlan(!data.current);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [role, therapistId, pathname]);

  useEffect(() => {
    // The call site already toasts the reason (apiErrorMessage); here we only
    // show the banner, so the user doesn't get the same message twice.
    const onPlanRequired = () => setNoPlan(true);
    window.addEventListener(PLAN_REQUIRED_EVENT, onPlanRequired);
    return () => window.removeEventListener(PLAN_REQUIRED_EVENT, onPlanRequired);
  }, []);

  return noPlan;
}

function NoPlanBanner() {
  const onPlans = usePathname() === '/plans';
  return (
    <div
      className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-[13.5px]"
      style={{ background: 'var(--ds-clay-soft)', color: 'var(--ds-clay-ink)' }}
      role="status"
    >
      <Lock className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <strong>You don't have an active plan.</strong> You can look around, but adding clients, booking and
        running sessions, and saving notes or reports need a plan.
      </span>
      {!onPlans && (
        <Link href="/plans" className="ds-btn ds-btn-sm ds-btn-clay">
          Choose a plan
        </Link>
      )}
    </div>
  );
}

export default function DashboardLayout({ children, role, profile }: DashboardLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const noPlan = useNoActivePlan(role, profile?.id);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {}
  }, []);

  const toggleCollapse = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {}
      return !c;
    });

  return (
    <div className="ds-page flex min-h-screen">
      <Sidebar
        role={role}
        profile={profile}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
      />

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/45 lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden />
      )}

      {/* Content column — offset by the fixed sidebar only on desktop */}
      <div
        className={cx(
          'flex min-h-screen w-full min-w-0 flex-col transition-[margin] duration-300',
          collapsed ? 'lg:ml-[76px]' : 'lg:ml-[244px]'
        )}
      >
        {/* Mobile top bar */}
        <header className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 lg:hidden" style={{ background: 'var(--ds-side)' }}>
          <button
            onClick={() => setMobileOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-[10px] text-white"
            style={{ background: 'rgba(255,255,255,0.1)' }}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <img src="/assests/staad-logo-horizontal-light.svg" alt="STAAD" style={{ height: 34, width: 'auto', display: 'block' }} />
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-9 lg:py-8">
          {noPlan && <NoPlanBanner />}
          {children}
        </main>
      </div>

    </div>
  );
}
