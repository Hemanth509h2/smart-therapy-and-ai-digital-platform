'use client';

import React from 'react';
import Link from 'next/link';
import { Dropdown, type MenuItem } from '@/components/practice/ui';
import { IconArrowRightXs, IconArrowUpRightSm, IconMore, IconSearch } from './icons';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/* ── section header ─────────────────────────────────────────────────────── */

export function Section({
  title,
  sub,
  link,
  children,
}: {
  title: string;
  sub?: string;
  link?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="sec">
        <div>
          <h2 className="sec__t">{title}</h2>
          {sub && <p className="sec__s">{sub}</p>}
        </div>
        {link && (
          <Link className="vlink" href={link.href}>
            <span>{link.label}</span>
            <span className="vlink__disc">
              <IconArrowRightXs />
            </span>
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

/* ── page header (inner pages) ──────────────────────────────────────────── */

export function PageHead({
  eyebrow,
  title,
  lead,
  actions,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="phead">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="phead__title">{title}</h1>
        {lead && <p className="phead__lead">{lead}</p>}
      </div>
      {actions && <div className="phead__acts">{actions}</div>}
    </div>
  );
}

/* ── buttons ────────────────────────────────────────────────────────────── */

type BtnVariant = 'primary' | 'ghost' | 'onlime';

export function Btn({
  icon,
  children,
  variant = 'ghost',
  sm,
  href,
  onClick,
  type = 'button',
  disabled,
  ...rest
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  variant?: BtnVariant;
  sm?: boolean;
  href?: string;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
} & Omit<React.HTMLAttributes<HTMLElement>, 'onClick' | 'type'>) {
  const cls = cx('btn', `btn--${variant}`, sm && 'btn--sm');
  const inner = (
    <>
      {icon && <span className="btn__ic">{icon}</span>}
      <span>{children}</span>
    </>
  );
  if (href) {
    return (
      <Link className={cls} href={href} {...rest}>
        {inner}
      </Link>
    );
  }
  return (
    <button className={cls} type={type} onClick={onClick} disabled={disabled} {...rest}>
      {inner}
    </button>
  );
}

/* ── notch (the cut-out corner with its round buttons) ──────────────────── */

export function Notch({ children, width }: { children: React.ReactNode; width?: number }) {
  return (
    <div className="notch" style={width ? { width } : undefined}>
      {children}
    </div>
  );
}

export function NotchLink({ href, label }: { href: string; label: string }) {
  return (
    <Link className="nbtn arrow" href={href} aria-label={label}>
      <IconArrowUpRightSm />
    </Link>
  );
}

export function NotchButton({
  onClick,
  label,
  arrow,
  onPanel,
  children,
}: {
  onClick: () => void;
  label: string;
  arrow?: boolean;
  onPanel?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={cx('nbtn', arrow && 'arrow', onPanel && 'nbtn--onpanel')}
      aria-label={label}
      onClick={onClick}
    >
      {children ?? <IconArrowUpRightSm />}
    </button>
  );
}

/* ── overflow menu, using the design's round button as the trigger ──────── */

export function StaadMenu({
  items,
  label = 'More actions',
  onPanel,
  size,
}: {
  items: MenuItem[];
  label?: string;
  onPanel?: boolean;
  size?: number;
}) {
  const visible = items.filter((i) => !i.hidden);
  if (visible.length === 0) return null;
  return (
    <Dropdown
      width={210}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          className={cx('nbtn', onPanel && 'nbtn--onpanel')}
          style={size ? { width: size, height: size } : undefined}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
        >
          <IconMore />
        </button>
      )}
    >
      {(close) => (
        <div role="menu" className="staad-menu">
          {visible.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className="staad-menu__item"
              style={item.danger ? { color: 'var(--red)' } : undefined}
              onClick={(e) => {
                e.stopPropagation();
                close();
                item.onClick();
              }}
            >
              {item.icon && <item.icon className="h-4 w-4 shrink-0" />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </Dropdown>
  );
}

/* ── badges ─────────────────────────────────────────────────────────────── */

/** Maps the data layer's tones onto the design's badge variants. */
const BADGE_BY_TONE: Record<string, string> = {
  green: 'badge--ok',
  forest: 'badge--ok',
  amber: 'badge--neutral',
  gray: 'badge--neutral',
  blue: 'badge--neutral',
  violet: 'badge--neutral',
  clay: 'badge--neutral',
  red: 'badge--red',
};

export function Badge({
  tone,
  dot,
  onLime,
  onPanel,
  children,
}: {
  tone?: string;
  dot?: boolean;
  onLime?: boolean;
  onPanel?: boolean;
  children: React.ReactNode;
}) {
  const variant = onLime ? 'badge--onlime' : onPanel ? 'badge--onpanel' : tone ? BADGE_BY_TONE[tone] : '';
  return (
    <span className={cx('badge', variant)}>
      {dot && <span className={cx('dot', tone === 'red' ? 'dot--hard' : 'dot--sm')} />}
      {children}
    </span>
  );
}

/* ── search + filter chips ──────────────────────────────────────────────── */

export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <label className="search">
      <IconSearch />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function Chips<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { key: T; label: string; count?: number }[];
}) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          className={cx('chip', value === o.key && 'on')}
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
        >
          {o.label}
          {typeof o.count === 'number' && <span className="chip__n">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ── states ─────────────────────────────────────────────────────────────── */

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="inline-err" role="alert">
      <span style={{ flex: 1 }}>{message}</span>
      {onRetry && (
        <button type="button" className="btn btn--sm btn--primary" onClick={onRetry}>
          <span>Retry</span>
        </button>
      )}
    </div>
  );
}

export function EmptyCard({
  mark,
  title,
  body,
  action,
  notch,
}: {
  mark: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
  notch?: React.ReactNode;
}) {
  return (
    <article className="card empty">
      {notch && <Notch>{notch}</Notch>}
      <span className="empty__mark">{mark}</span>
      <div>
        <h3 className="empty__h">{title}</h3>
        <p className="empty__p">{body}</p>
      </div>
      {action && <div>{action}</div>}
    </article>
  );
}

export function SkeletonCard({ height = 186 }: { height?: number }) {
  return <div className="sk--card" style={{ minHeight: height }} aria-hidden />;
}

export function SkeletonLines({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <span key={i} className="sk" style={{ height: 12, width: i % 2 ? '58%' : '82%' }} />
      ))}
    </div>
  );
}
