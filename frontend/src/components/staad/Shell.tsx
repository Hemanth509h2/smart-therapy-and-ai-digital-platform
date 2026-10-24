'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { toast } from '@/components/practice/ui';
import { useAuthStore } from '@/store/useAuthStore';
import { useTheme } from '@/components/ThemeProvider';
import { initials, fullName } from '@/lib/practice';
import { adminNavFor } from '@/lib/adminNav';
import { ADMIN_ROLE_LABELS, adminRoleOf } from '@/lib/adminRoles';
import {
  IconClients,
  IconCollapse,
  IconDashboard,
  IconHelp,
  IconLogout,
  IconModules,
  IconPlans,
  IconProfile,
  IconSchedule,
  IconSessions,
  IconThemeA,
  IconThemeB,
} from './icons';

type Role = 'THERAPIST' | 'CLIENT' | 'ADMIN' | null;

interface NavItem {
  href: string;
  label: string;
  Icon: React.ComponentType<{ size?: number }>;
}

const THERAPIST_NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', Icon: IconDashboard },
  { href: '/clients', label: 'Clients', Icon: IconClients },
  { href: '/sessions', label: 'Sessions', Icon: IconSessions },
  { href: '/schedule', label: 'Schedule', Icon: IconSchedule },
  { href: '/modules', label: 'Therapy Modules', Icon: IconModules },
  { href: '/plans', label: 'Plans', Icon: IconPlans },
  { href: '/profile', label: 'Profile', Icon: IconProfile },
  { href: '/help', label: 'Help & Support', Icon: IconHelp },
];

const COLLAPSE_KEY = 'staad-sidebar-collapsed';

/** The design collapses the rail on its own below this width. */
const AUTO_COLLAPSE_AT = 900;

/** Admin items use lucide icons; wrap each once so it takes our `size` prop
 *  with the design's stroke weight (and keeps a stable component identity). */
const adminIcons = new Map<string, NavItem['Icon']>();
function adminNav(profile: any): NavItem[] {
  return adminNavFor(profile).map(({ href, label, icon: Lucide }) => {
    let Icon = adminIcons.get(href);
    if (!Icon) {
      Icon = ({ size = 20 }: { size?: number }) => <Lucide size={size} strokeWidth={1.8} />;
      adminIcons.set(href, Icon);
    }
    return { href, label, Icon };
  });
}

export function StaadShell({ children, className }: { children: React.ReactNode; className?: string }) {
  const { role, profile } = useAuthStore();
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggle: toggleTheme } = useTheme();

  const [collapsed, setCollapsed] = useState(false);
  const [autoCollapsed, setAutoCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {}
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${AUTO_COLLAPSE_AT}px)`);
    const sync = () => setAutoCollapsed(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const toggleCollapse = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {}
      return !c;
    });

  const isAdmin = role === 'ADMIN';
  const nav = isAdmin ? adminNav(profile) : THERAPIST_NAV;
  const home = isAdmin ? '/admin' : '/';
  // Home routes match exactly; everything else also owns its sub-routes.
  const isActive = (href: string) =>
    href === home ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch {
      toast('Could not sign out. Please try again.', 'error');
    }
    router.push('/auth');
  };

  const name = fullName(profile) || 'Your account';
  const mark = initials(profile?.firstName, profile?.lastName) || '—';
  const isCollapsed = collapsed || autoCollapsed;

  return (
    <div className={`staad-ui app${isCollapsed ? ' collapsed' : ''}${className ? ` ${className}` : ''}`}>
      <nav className="sb" aria-label="Main">
        {/* Real STAAD brand mark. The emblem stays in the circle so it still
            reads when the rail collapses to 84px; the wordmark is the design's
            own Sora treatment, which animates away on collapse. */}
        <Link href={home} className="sb-brand" aria-label="STAAD home">
          <span className="sb-mark sb-mark--logo">
            <img src="/assests/staad-emblem.svg" alt="" width={30} height={30} />
          </span>
          <span className="sb-word">STAAD</span>
        </Link>

        <div className="sb-prof">
          <span className="av av--user">{mark}</span>
          <span className="prof-text">
            <span style={{ display: 'block', fontSize: 13.5, lineHeight: '20px', fontWeight: 700, color: 'var(--ink)' }}>
              {name}
            </span>
            <span style={{ fontSize: 11, lineHeight: '16px', fontWeight: 700, color: 'var(--muted)' }}>
              {isAdmin
                ? `Admin · ${ADMIN_ROLE_LABELS[adminRoleOf(profile)].label}`
                : role
                  ? role.charAt(0) + role.slice(1).toLowerCase()
                  : '—'}
            </span>
          </span>
        </div>

        <div className="sb-nav">
          {nav.map(({ href, label, Icon }) => (
            <Link key={href} href={href} className={`nav-item${isActive(href) ? ' active' : ''}`}>
              <span className="nav-ic">
                <Icon />
              </span>
              <span className="nav-label">{label}</span>
            </Link>
          ))}
        </div>

        <div className="sb-foot">
          {/* Therapist pages switch theme from the TopBar; admin pages have no TopBar. */}
          {isAdmin && (
            <button
              className="nav-item"
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              <span className="nav-ic">{theme === 'dark' ? <IconThemeB /> : <IconThemeA />}</span>
              <span className="nav-label">Theme</span>
            </button>
          )}
          <button className="nav-item" type="button" onClick={handleLogout}>
            <span className="nav-ic">
              <IconLogout />
            </span>
            <span className="nav-label">Logout</span>
          </button>
          <button
            className="nav-item collapse-row"
            type="button"
            onClick={toggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <span className="nav-ic collapse-ic">
              <IconCollapse />
            </span>
            <span className="nav-label">Collapse</span>
          </button>
        </div>
      </nav>

      <main className="main">
        <div className="wrap">{children}</div>
      </main>
    </div>
  );
}
