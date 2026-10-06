'use client';

import React, { useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';
import { Toaster, cx } from '@/components/practice/ui';

interface DashboardLayoutProps {
  children: React.ReactNode;
  role: 'THERAPIST' | 'CLIENT' | 'ADMIN' | null;
  profile: any;
}

const COLLAPSE_KEY = 'staad-sidebar-collapsed';

export default function DashboardLayout({ children, role, profile }: DashboardLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

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

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-9 lg:py-8">{children}</main>
      </div>

      <Toaster />
    </div>
  );
}
