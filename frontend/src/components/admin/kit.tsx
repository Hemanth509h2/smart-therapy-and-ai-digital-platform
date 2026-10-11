'use client';

// Shared building blocks for the admin portal: page guard + layout, cards,
// tables, filters, dialogs and the step-up password prompt. Pages render in
// the STAAD shell (same look as the therapist app); the glass tokens used
// below are remapped to the STAAD palette in staad-extras.css (.admin-ui).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EmailAuthProvider, GoogleAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup } from 'firebase/auth';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Loader2, Lock, Search, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StaadShell } from '@/components/staad/Shell';
import { Toaster } from '@/components/practice/ui';
import { useAuthStore } from '@/store/useAuthStore';
import { auth } from '@/lib/firebase';
import { adminFetch, registerReauthPrompt } from '@/lib/adminApi';
import { adminRoleOf, canAdmin, type AdminPermission } from '@/lib/adminRoles';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export const CARD = 'rounded-[24px] border border-[var(--glass-border)] bg-[var(--glass-bg)]';
const inputStyle = { background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--ink)' } as const;

// ─── Access ──────────────────────────────────────────────────────────────────

export function useAdmin() {
  const { uid, role, profile, email } = useAuthStore();
  const adminRole = adminRoleOf(profile);
  const can = useCallback((p: AdminPermission) => role === 'ADMIN' && canAdmin(adminRole, p), [role, adminRole]);
  return { uid, role, profile, email, adminRole, can };
}

/** Layout + guard for every admin page. Renders nothing until the role is known. */
export function AdminPage({
  title,
  description,
  actions,
  permission,
  back,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  permission?: AdminPermission;
  back?: { href: string; label: string };
  children: React.ReactNode;
}) {
  const { uid, role, profile, can } = useAdmin();
  const router = useRouter();

  useEffect(() => {
    if (!uid) router.push('/auth');
    else if (role && role !== 'ADMIN') router.push('/');
  }, [uid, role, router]);

  if (role !== 'ADMIN') {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const allowed = !permission || can(permission);

  return (
    <StaadShell className="admin-ui">
      <ReauthPrompt />
      <Toaster />
      {back && (
        <Link href={back.href} className="inline-flex items-center gap-1 text-sm font-semibold" style={{ color: 'var(--ink-muted)' }}>
          <ChevronLeft className="h-4 w-4" /> {back.label}
        </Link>
      )}
      <div className="phead">
        <div className="min-w-0">
          <div className="eyebrow">Admin</div>
          <h1 className="phead__title">{title}</h1>
          {description && <p className="phead__lead">{description}</p>}
        </div>
        {allowed && actions && <div className="phead__acts">{actions}</div>}
      </div>
      {allowed ? (
        <div className="space-y-6">{children}</div>
      ) : (
        <EmptyState icon={<Lock className="h-5 w-5" />} title="No access" body="Your admin role doesn't include this page. Ask a super admin if you need it." />
      )}
    </StaadShell>
  );
}

/** Asks for the password (or Google) when the backend wants a fresh sign-in. */
function ReauthPrompt() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    registerReauthPrompt(
      () =>
        new Promise<boolean>((resolve) => {
          resolver.current = resolve;
          setPassword('');
          setError('');
          setOpen(true);
        })
    );
    return () => registerReauthPrompt(null);
  }, []);

  const finish = (ok: boolean) => {
    setOpen(false);
    resolver.current?.(ok);
    resolver.current = null;
  };

  const withPassword = async () => {
    const user = auth.currentUser;
    if (!user?.email) return;
    setBusy(true);
    setError('');
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
      await user.getIdToken(true);
      finish(true);
    } catch {
      setError('That password is not correct.');
    } finally {
      setBusy(false);
    }
  };

  const withGoogle = async () => {
    const user = auth.currentUser;
    if (!user) return;
    setBusy(true);
    setError('');
    try {
      await reauthenticateWithPopup(user, new GoogleAuthProvider());
      await user.getIdToken(true);
      finish(true);
    } catch {
      setError('Google sign-in did not complete.');
    } finally {
      setBusy(false);
    }
  };

  const usesPassword = auth.currentUser?.providerData.some((p) => p.providerId === 'password');

  return (
    <Modal
      open={open}
      onClose={() => finish(false)}
      title="Confirm it's you"
      description="This action needs a recent sign-in. Confirm your password to continue."
      footer={
        <>
          <Btn variant="ghost" onClick={() => finish(false)}>Cancel</Btn>
          {usesPassword ? (
            <Btn onClick={withPassword} loading={busy} disabled={!password}>Confirm</Btn>
          ) : (
            <Btn onClick={withGoogle} loading={busy}>Continue with Google</Btn>
          )}
        </>
      }
    >
      {usesPassword && (
        <Field label="Password">
          <Input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && password && withPassword()} />
        </Field>
      )}
      {error && <ErrorBanner message={error} />}
    </Modal>
  );
}

// ─── Data loading ────────────────────────────────────────────────────────────

/** GET an admin endpoint; refetches when `path` changes. `path` null = skip. */
export function useAdminQuery<T = any>(path: string | null) {
  const { role } = useAuthStore();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!path || role !== 'ADMIN') return;
    const mine = ++seq.current;
    setLoading(true);
    setError('');
    try {
      const d = await adminFetch<T>(path);
      if (mine === seq.current) setData(d);
    } catch (e: any) {
      if (mine === seq.current) setError(e.message || 'Could not load data.');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [path, role]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load, setData };
}

/** Page / search / sort / filter state for a list page, serialised to a query string. */
export function useListState(defaults: { sort?: string; dir?: 'asc' | 'desc'; pageSize?: number; filters?: Record<string, string> } = {}) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [sort, setSortKey] = useState(defaults.sort || '');
  const [dir, setDir] = useState<'asc' | 'desc'>(defaults.dir || 'desc');
  const [filters, setFilters] = useState<Record<string, string>>(defaults.filters || {});
  const pageSize = defaults.pageSize || 25;

  const query = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (q) p.set('q', q);
    if (sort) {
      p.set('sort', sort);
      p.set('dir', dir);
    }
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    return p.toString();
  }, [page, pageSize, q, sort, dir, filters]);

  return {
    page,
    pageSize,
    setPage,
    q,
    setQ: (v: string) => { setQ(v); setPage(1); },
    sort,
    dir,
    onSort: (key: string) => {
      if (key === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      else { setSortKey(key); setDir('desc'); }
      setPage(1);
    },
    filters,
    setFilter: (k: string, v: string) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); },
    query,
  };
}

// ─── Primitives ──────────────────────────────────────────────────────────────

export function Card({ className, children, style }: { className?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return <div className={cx(CARD, 'p-5', className)} style={style}>{children}</div>;
}

export function Section({ title, description, actions, children, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx('space-y-3', className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-heading text-lg" style={{ color: 'var(--ink)' }}>{title}</h2>
          {description && <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function StatCard({ label, value, hint, icon, href }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode; href?: string }) {
  const body = (
    <div className={cx(CARD, 'p-4 h-full', href && 'hover-lift')}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>{label}</span>
        {icon && <span style={{ color: 'var(--sage)' }}>{icon}</span>}
      </div>
      <div className="mt-2 font-heading text-[26px] leading-none" style={{ color: 'var(--ink)' }}>{value}</div>
      {hint && <div className="mt-1.5 text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';
const TONES: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: 'var(--glass-bg)', fg: 'var(--ink-muted)' },
  good: { bg: 'rgba(22,163,74,0.12)', fg: '#15803d' },
  warn: { bg: 'rgba(217,119,6,0.14)', fg: '#b45309' },
  bad: { bg: 'rgba(220,38,38,0.12)', fg: '#dc2626' },
  info: { bg: 'var(--sage-light)', fg: 'var(--sage)' },
};

/** Status pill: always a text label, so state never relies on color alone. */
export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  const t = TONES[tone];
  return (
    <span title={title} className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: t.bg, color: t.fg, border: tone === 'neutral' ? '1px solid var(--glass-border)' : undefined }}>
      {children}
    </span>
  );
}

export function Btn({
  variant = 'primary',
  size = 'md',
  icon,
  loading,
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; icon?: React.ReactNode; loading?: boolean }) {
  const styles = {
    primary: { background: 'var(--sage)', color: 'var(--on-sage, #fff)', border: '1px solid transparent' },
    ghost: { background: 'var(--glass-bg)', color: 'var(--ink)', border: '1px solid var(--glass-border)' },
    danger: { background: 'rgba(220,38,38,0.1)', color: '#dc2626', border: '1px solid rgba(220,38,38,0.25)' },
  }[variant];
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'btn-press inline-flex items-center justify-center gap-1.5 rounded-full font-bold transition-opacity disabled:opacity-50',
        size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-5 py-2.5 text-[13.5px]',
        className
      )}
      style={{ ...styles, ...rest.style }}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(props, ref) {
  return <input ref={ref} {...props} className={cx('w-full rounded-xl px-3 py-2.5 text-sm focus-visible:outline-none', props.className)} style={{ ...inputStyle, ...props.style }} />;
});

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx('w-full rounded-xl px-3 py-2.5 text-sm focus-visible:outline-none', props.className)} style={{ ...inputStyle, ...props.style }} />;
}

export function Select({ value, onChange, options, className, ariaLabel }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string; ariaLabel?: string }) {
  return (
    <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} className={cx('rounded-xl px-3 py-2 text-sm focus-visible:outline-none', className)} style={inputStyle}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: 'var(--ink)' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: 'var(--sage)', width: 15, height: 15 }} />
      {label}
    </label>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-semibold" style={{ color: 'var(--ink-muted)' }}>{label}</label>
      {children}
      {hint && <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>{hint}</p>}
    </div>
  );
}

export function Spinner() {
  return <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--sage)] border-t-transparent" role="status" aria-label="Loading" />;
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium" style={{ background: 'rgba(220,38,38,0.08)', color: '#dc2626', border: '1px solid rgba(220,38,38,0.2)' }}>
      <span className="flex-1">{message}</span>
      {onRetry && <Btn size="sm" variant="ghost" onClick={onRetry}>Retry</Btn>}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className={cx(CARD, 'flex flex-col items-center gap-2 px-6 py-12 text-center')}>
      {icon && <div className="flex h-11 w-11 items-center justify-center rounded-full" style={{ background: 'var(--sage-light)', color: 'var(--sage)' }}>{icon}</div>}
      <p className="font-heading text-lg" style={{ color: 'var(--ink)' }}>{title}</p>
      {body && <p className="max-w-md text-sm" style={{ color: 'var(--ink-muted)' }}>{body}</p>}
      {action}
    </div>
  );
}

export function KV({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-muted)' }}>{i.label}</dt>
          <dd className="mt-0.5 break-words text-sm font-medium" style={{ color: 'var(--ink)' }}>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: React.ReactNode }[] }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto rounded-full p-1" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className="whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors"
          style={value === t.value ? { background: 'var(--sage)', color: 'var(--on-sage, #fff)' } : { color: 'var(--ink-muted)' }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cx('rounded-2xl', wide ? 'max-w-3xl' : 'max-w-md')} style={{ background: 'var(--glass-strong)', backdropFilter: 'blur(24px)', border: '1px solid var(--glass-border)' }}>
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl" style={{ color: 'var(--ink)' }}>{title}</DialogTitle>
          {description && <DialogDescription className="font-medium" style={{ color: 'var(--ink-muted)' }}>{description}</DialogDescription>}
        </DialogHeader>
        {children && <div className="max-h-[62vh] space-y-3 overflow-y-auto py-1">{children}</div>}
        {footer && <DialogFooter className="gap-2">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

/** Confirmation dialog with an optional required reason. */
export function ConfirmDialog({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  danger,
  reasonLabel,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  reasonLabel?: string;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) { setReason(''); setError(''); }
  }, [open]);

  const go = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (e: any) {
      setError(e.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={body}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant={danger ? 'danger' : 'primary'} onClick={go} loading={busy} disabled={!!reasonLabel && !reason.trim()}>{confirmLabel}</Btn>
        </>
      }
    >
      {reasonLabel && (
        <Field label={reasonLabel}>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
      {error && <ErrorBanner message={error} />}
    </Modal>
  );
}

// ─── Lists ───────────────────────────────────────────────────────────────────

/** Search box that reports after the user pauses typing. */
export function SearchInput({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onChange(text), 300);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--ink-muted)' }} />
      <Input aria-label={placeholder} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} style={{ paddingLeft: 34, paddingRight: text ? 30 : undefined }} />
      {text && (
        <button aria-label="Clear search" onClick={() => { setText(''); onChange(''); }} className="absolute right-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-muted)' }}>
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/** One row of filters above a list. */
export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  render: (row: T) => React.ReactNode;
  /** Server-side sort key; omit for unsortable columns. */
  sortKey?: string;
  align?: 'left' | 'right';
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  sort,
  dir,
  onSort,
  loading,
  empty = 'Nothing here yet.',
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  sort?: string;
  dir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  loading?: boolean;
  empty?: React.ReactNode;
}) {
  return (
    <div className={cx(CARD, 'overflow-hidden')}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--glass-border)' }}>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cx('whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide', c.align === 'right' ? 'text-right' : 'text-left')} style={{ color: 'var(--ink-muted)' }}>
                  {c.sortKey && onSort ? (
                    <button onClick={() => onSort(c.sortKey!)} className="inline-flex items-center gap-1" aria-label={`Sort by ${typeof c.header === 'string' ? c.header : c.key}`}>
                      {c.header}
                      {sort === c.sortKey ? (dir === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />) : null}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12">
                  <div className="flex justify-center"><Spinner /></div>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--ink-muted)' }}>{empty}</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={rowKey(r)}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={cx('transition-colors', onRowClick && 'cursor-pointer hover:bg-[var(--sage-light)]', loading && 'opacity-60')}
                  style={{ borderBottom: '1px solid var(--glass-border)' }}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cx('px-4 py-3 align-middle', c.align === 'right' && 'text-right', c.className)} style={{ color: 'var(--ink)' }}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total ? <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>{total} total</p> : null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-2 text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
      <span>{first}–{last} of {total}</span>
      <div className="flex items-center gap-1">
        <Btn size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" icon={<ChevronLeft className="h-3.5 w-3.5" />} />
        <span className="px-2">Page {page} of {pages}</span>
        <Btn size="sm" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page" icon={<ChevronRight className="h-3.5 w-3.5" />} />
      </div>
    </div>
  );
}
