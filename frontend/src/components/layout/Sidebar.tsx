'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from '@/components/ThemeProvider';
import { auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import {
  Home,
  Users,
  Calendar,
  CalendarDays,
  Puzzle,
  User,
  ClipboardList,
  LifeBuoy,
  Shield,
  CreditCard,
  Receipt,
  Layers,
  Moon,
  Sun,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { cx } from '@/components/practice/ui';
import { initials as toInitials } from '@/lib/practice';

interface SidebarProps {
  role: 'THERAPIST' | 'CLIENT' | 'ADMIN' | null;
  profile: any;
  /** Mobile drawer open state (ignored at lg+ where the sidebar is always shown). */
  mobileOpen?: boolean;
  /** Called when the mobile drawer should close (nav tap / backdrop). */
  onClose?: () => void;
  /** Desktop icon-only mode. */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const therapistNav = [
  { href: '/', label: 'Dashboard', icon: Home },
  { href: '/clients', label: 'Clients', icon: Users },
  { href: '/sessions', label: 'Sessions', icon: ClipboardList },
  { href: '/schedule', label: 'Schedule', icon: CalendarDays },
  { href: '/modules', label: 'Therapy Modules', icon: Puzzle },
  { href: '/plans', label: 'Plans', icon: CreditCard },
  { href: '/profile', label: 'Profile', icon: User },
  { href: '/help', label: 'Help & Support', icon: LifeBuoy },
];

const clientNav = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/my-sessions', label: 'My Sessions', icon: Calendar },
  { href: '/profile', label: 'Profile', icon: User },
  { href: '/help', label: 'Help & Support', icon: LifeBuoy },
];

const adminNav = [
  { href: '/admin', label: 'Professionals', icon: Users },
  { href: '/admin/subscriptions', label: 'Subscriptions', icon: Receipt },
  { href: '/admin/plans', label: 'Plans', icon: Layers },
  { href: '/admin/admins', label: 'Admins', icon: Shield },
  { href: '/help', label: 'Help & Support', icon: LifeBuoy },
];

export default function Sidebar({
  role,
  profile,
  mobileOpen = false,
  onClose,
  collapsed = false,
  onToggleCollapse,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggle: toggleTheme } = useTheme();

  const navItems = role === 'ADMIN' ? adminNav : role === 'THERAPIST' ? therapistNav : clientNav;
  const roleLabel = role === 'ADMIN' ? 'Admin' : role === 'THERAPIST' ? 'Therapist' : 'Client';

  // '/' and '/admin' only match exactly; everything else also owns its sub-routes
  // (e.g. /clients/{id}/progress keeps "Clients" highlighted).
  const isActive = (href: string) =>
    href === '/' || href === '/admin' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  const handleLogout = async () => {
    await signOut(auth);
    router.push('/auth');
  };

  // Labels hide only at lg+ when collapsed; the mobile drawer is always full width.
  const hideWhenCollapsed = collapsed ? 'lg:hidden' : '';
  const linkLayout = collapsed ? 'lg:justify-center lg:px-0' : '';

  return (
    <aside
      className={cx(
        'fixed inset-y-0 left-0 z-40 flex w-[244px] flex-col transition-[width,transform] duration-300 lg:translate-x-0',
        collapsed && 'lg:w-[76px]',
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      )}
      style={{ background: 'var(--ds-side)', color: 'var(--ds-side-ink)' }}
      aria-label="Main navigation"
    >
      {/* Logo + profile */}
      <div
        className={cx('flex flex-col items-center gap-3 px-4 pb-5 pt-6', collapsed && 'lg:px-2')}
        style={{ borderBottom: '1px solid var(--ds-side-border)' }}
      >
        <Link href={role === 'ADMIN' ? '/admin' : '/'} onClick={onClose} className="flex w-full items-center justify-center" aria-label="STAAD home">
          <img src="/assests/staad-logo-horizontal-light.svg" alt="STAAD" className={cx('block h-[54px] w-auto', hideWhenCollapsed)} />
          <img src="/assests/staad-emblem.svg" alt="STAAD" className={cx('hidden h-10 w-auto', collapsed && 'lg:block')} />
        </Link>

        {profile && (
          <>
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold text-white"
              style={{ background: '#C49A6C' }}
              title={collapsed ? `${profile.firstName ?? ''} ${profile.lastName ?? ''}` : undefined}
            >
              {toInitials(profile.firstName, profile.lastName)}
            </div>
            <div className={cx('w-full text-center', hideWhenCollapsed)}>
              <p className="truncate text-[15px] font-semibold text-white">
                {profile.firstName} {profile.lastName}
              </p>
              <span
                className="mt-1 inline-block rounded-md px-2 py-0.5 text-[11.5px] font-medium"
                style={{ background: 'rgba(255,255,255,0.09)', color: 'var(--ds-side-muted)' }}
              >
                {roleLabel}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navItems.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              title={collapsed ? item.label : undefined}
              aria-current={active ? 'page' : undefined}
              className={cx('ds-side-link', active && 'is-active', linkLayout)}
            >
              <item.icon className="h-[19px] w-[19px] shrink-0" />
              <span className={hideWhenCollapsed}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="space-y-1 px-3 py-4" style={{ borderTop: '1px solid var(--ds-side-border)' }}>
        <button
          type="button"
          onClick={toggleTheme}
          className={cx('ds-side-link w-full', linkLayout)}
          aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          title={collapsed ? 'Theme' : undefined}
        >
          {theme === 'light' ? <Sun className="h-[19px] w-[19px] shrink-0" /> : <Moon className="h-[19px] w-[19px] shrink-0" />}
          <span className={hideWhenCollapsed}>Theme</span>
        </button>
        <button type="button" onClick={handleLogout} className={cx('ds-side-link w-full', linkLayout)} title={collapsed ? 'Logout' : undefined}>
          <LogOut className="h-[19px] w-[19px] shrink-0" />
          <span className={hideWhenCollapsed}>Logout</span>
        </button>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className={cx('ds-side-link hidden w-full lg:flex', linkLayout)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand' : undefined}
          >
            {collapsed ? <ChevronsRight className="h-[19px] w-[19px] shrink-0" /> : <ChevronsLeft className="h-[19px] w-[19px] shrink-0" />}
            <span className={hideWhenCollapsed}>Collapse</span>
          </button>
        )}
      </div>
    </aside>
  );
}
