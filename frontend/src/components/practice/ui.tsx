'use client';

import React, { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { AlertCircle, CheckCircle2, Info, Loader2, MoreVertical, Search, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { STATE_META, TONES, avatarColor, initials, tagTone, type SessionState, type Tone } from '@/lib/practice';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Icon = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

/* ─────────────────────────── surfaces ─────────────────────────── */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('ds-card', className)} {...props} />;
}

export function PageHeader({
  title,
  subtitle,
  icon,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        {icon && (
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full"
            style={{ background: 'var(--ds-clay-soft)', color: 'var(--ds-clay-ink)' }}
          >
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="ds-title text-[34px] leading-[1.1] sm:text-[42px]">{title}</h1>
          {subtitle && <div className="ds-muted mt-1.5 text-[15px] sm:text-[16px]">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="ds-title text-[24px] leading-tight sm:text-[26px]">{title}</h2>
        {subtitle && <p className="ds-muted mt-0.5 text-[13.5px]">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ─────────────────────────── chips ─────────────────────────── */

export function Pill({
  tone,
  dot,
  children,
  className,
}: {
  tone: Tone;
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <span className={cx('ds-chip', className)} style={{ color: t.fg, background: t.bg }}>
      {dot && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.fg }} />}
      {children}
    </span>
  );
}

export const StatusPill = ({ state }: { state: SessionState }) => (
  <Pill tone={STATE_META[state].tone} dot>
    {STATE_META[state].label}
  </Pill>
);

export const Tag = ({ label }: { label: string }) => <Pill tone={tagTone(label)}>{label}</Pill>;

export function Avatar({
  first,
  last,
  size = 44,
  className,
}: {
  first?: string;
  last?: string;
  size?: number;
  className?: string;
}) {
  const seed = `${first ?? ''} ${last ?? ''}`;
  return (
    <div
      className={cx('flex shrink-0 items-center justify-center rounded-full font-semibold text-white', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36), background: avatarColor(seed) }}
      aria-hidden
    >
      {initials(first, last)}
    </div>
  );
}

export function IconBubble({
  tone = 'clay',
  size = 50,
  children,
}: {
  tone?: Tone;
  size?: number;
  children: React.ReactNode;
}) {
  const t = TONES[tone];
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: t.bg, color: t.fg }}
    >
      {children}
    </div>
  );
}

/* ─────────────────────────── data viz ─────────────────────────── */

export function ProgressRing({
  value,
  size = 68,
  stroke = 7,
  color = 'var(--ds-forest)',
  children,
  label,
}: {
  value: number; // 0..1
  size?: number;
  stroke?: number;
  color?: string;
  children?: React.ReactNode;
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ds-border)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold" style={{ color: 'var(--ds-ink)' }}>
        {children}
      </div>
    </div>
  );
}

/** Tiny bar sparkline. `values` are raw counts; bars are scaled to the max. */
export function MiniBars({
  values,
  color = 'var(--ds-green)',
  height = 40,
  label,
}: {
  values: number[];
  color?: string;
  height?: number;
  label?: string;
}) {
  const max = Math.max(1, ...values);
  const w = 7;
  const gap = 5;
  return (
    <svg
      width={values.length * (w + gap) - gap}
      height={height}
      role="img"
      aria-label={label}
      className="shrink-0"
    >
      {values.map((v, i) => {
        const h = Math.max(4, (v / max) * height);
        return (
          <rect
            key={i}
            x={i * (w + gap)}
            y={height - h}
            width={w}
            height={h}
            rx={3}
            fill={color}
            opacity={v === 0 ? 0.25 : 0.45 + 0.55 * (i / Math.max(1, values.length - 1))}
          >
            <title>{v}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export function StatCard({
  icon: IconCmp,
  tone = 'clay',
  label,
  value,
  hint,
  visual,
  onClick,
  highlight,
}: {
  icon: Icon;
  tone?: Tone;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  visual?: React.ReactNode;
  onClick?: () => void;
  highlight?: boolean;
}) {
  const body = (
    <>
      <IconBubble tone={tone}>
        <IconCmp className="h-[22px] w-[22px]" />
      </IconBubble>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium" style={{ color: 'var(--ds-ink)' }}>
          {label}
        </p>
        <p className="ds-title mt-0.5 text-[34px] leading-none">{value}</p>
        {hint && <p className="ds-muted mt-1.5 text-[12.5px]">{hint}</p>}
      </div>
      {visual}
    </>
  );
  const className = cx('ds-card flex w-full items-center gap-4 p-5 text-left', onClick && 'ds-card-hover');
  const style = highlight ? { background: 'var(--ds-red-soft)', borderColor: 'transparent' } : undefined;
  return onClick ? (
    <button type="button" onClick={onClick} className={className} style={style}>
      {body}
    </button>
  ) : (
    <div className={className} style={style}>
      {body}
    </div>
  );
}

/* ─────────────────────────── feedback ─────────────────────────── */

export const Spinner = ({ className }: { className?: string }) => (
  <Loader2 className={cx('animate-spin', className ?? 'h-5 w-5')} style={{ color: 'var(--ds-clay)' }} />
);

export const LoadingBlock = ({ label = 'Loading…' }: { label?: string }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-16" role="status">
    <Spinner className="h-7 w-7" />
    <span className="ds-muted text-[13px]">{label}</span>
  </div>
);

export function EmptyState({
  icon,
  title,
  body,
  children,
  compact,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: React.ReactNode;
  children?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cx('flex flex-col items-center text-center', compact ? 'py-8' : 'py-14')}>
      {icon && <div className="mb-4">{icon}</div>}
      <p className="ds-title text-[22px]">{title}</p>
      {body && <p className="ds-muted mt-1.5 max-w-md text-[14px] leading-relaxed">{body}</p>}
      {children && <div className="mt-5 flex flex-wrap justify-center gap-3">{children}</div>}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-[13.5px]"
      style={{ background: 'var(--ds-red-soft)', color: 'var(--ds-red)' }}
      role="alert"
    >
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button className="ds-btn ds-btn-sm ds-btn-outline" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────── inputs ─────────────────────────── */

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  label?: string;
}) {
  return (
    <div className={cx('relative', className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--ds-faint)' }} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        className="ds-input"
        style={{ paddingLeft: '2.5rem' }}
      />
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="ds-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="ds-muted mt-1 text-[12px]">{hint}</p>}
    </div>
  );
}

/* ─────────────────────────── popovers ─────────────────────────── */

/** Click-to-open popover that closes on outside click, Escape, or `close()`. */
export function Dropdown({
  trigger,
  children,
  align = 'right',
  width = 200,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: 'left' | 'right';
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          className={cx('ds-card animate-scale-in absolute top-full z-30 mt-1.5 p-1.5', align === 'right' ? 'right-0' : 'left-0')}
          style={{ minWidth: width, boxShadow: 'var(--ds-shadow-lg)' }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export interface MenuItem {
  label: string;
  icon?: Icon;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
}

/** "⋮" overflow menu. Renders nothing when every item is hidden. */
export function Menu({ items, label = 'More actions' }: { items: MenuItem[]; label?: string }) {
  const visible = items.filter((i) => !i.hidden);
  if (visible.length === 0) return null;
  return (
    <Dropdown
      width={210}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          className="ds-icon-btn"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
        >
          <MoreVertical className="h-[18px] w-[18px]" />
        </button>
      )}
    >
      {(close) => (
        <div role="menu">
          {visible.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className="ds-menu-item"
              style={item.danger ? { color: 'var(--ds-red)' } : undefined}
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

/* ─────────────────────────── dialogs & drawers ─────────────────────────── */

export function DsDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `staad-ui` matters here: Radix portals this to <body>, outside the app
          shell, so without it none of the STAAD design tokens resolve. */}
      <DialogContent className={cx('staad-ui ds-dialog gap-0 p-0', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}>
        <div className="px-6 pb-4 pt-6 pr-12">
          <DialogTitle className="ds-title text-[25px] leading-tight">{title}</DialogTitle>
          {description && (
            <DialogDescription className="mt-1.5 text-[13.5px] leading-relaxed" style={{ color: 'var(--ds-muted)' }}>
              {description}
            </DialogDescription>
          )}
        </div>
        {children && <div className="max-h-[62vh] overflow-y-auto px-6 pb-5">{children}</div>}
        {footer && (
          <div
            className="flex flex-col-reverse gap-2 border-t px-6 py-4 sm:flex-row sm:justify-end"
            style={{ borderColor: 'var(--ds-border)' }}
          >
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={cx('staad-ui animate-fade-in relative flex h-full w-full flex-col', wide ? 'max-w-xl' : 'max-w-md')}
        style={{ background: 'var(--ds-surface)', borderLeft: '1px solid var(--ds-border)' }}
      >
        <div className="flex items-start justify-between gap-3 border-b px-6 py-5" style={{ borderColor: 'var(--ds-border)' }}>
          <div className="min-w-0">
            <h2 className="ds-title text-[24px] leading-tight">{title}</h2>
            {subtitle && <p className="ds-muted mt-0.5 text-[13px]">{subtitle}</p>}
          </div>
          <button className="ds-icon-btn" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

/* ─────────────────────────── toasts ─────────────────────────── */

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const useToastStore = create<{ items: ToastItem[]; push: (m: string, t: ToastTone) => void; dismiss: (id: number) => void }>(
  (set) => ({
    items: [],
    push: (message, tone) => {
      const id = Date.now() + Math.random();
      set((s) => ({ items: [...s.items, { id, message, tone }] }));
      setTimeout(() => set((s) => ({ items: s.items.filter((i) => i.id !== id) })), 3500);
    },
    dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  })
);

export const toast = (message: string, tone: ToastTone = 'success') => useToastStore.getState().push(message, tone);

export function Toaster() {
  const { items, dismiss } = useToastStore();
  const icons: Record<ToastTone, Icon> = { success: CheckCircle2, error: AlertCircle, info: Info };
  const colors: Record<ToastTone, string> = { success: 'var(--ds-green)', error: 'var(--ds-red)', info: 'var(--ds-clay)' };
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(92vw,360px)] flex-col gap-2" aria-live="polite">
      {items.map((t) => {
        const IconCmp = icons[t.tone];
        return (
          <div
            key={t.id}
            className="ds-card animate-fade-up pointer-events-auto flex items-start gap-3 px-4 py-3"
            style={{ boxShadow: 'var(--ds-shadow-lg)' }}
            role="status"
          >
            <IconCmp className="mt-0.5 h-[18px] w-[18px] shrink-0" style={{ color: colors[t.tone] }} />
            <p className="flex-1 text-[13.5px]" style={{ color: 'var(--ds-ink)' }}>
              {t.message}
            </p>
            <button className="ds-faint" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
