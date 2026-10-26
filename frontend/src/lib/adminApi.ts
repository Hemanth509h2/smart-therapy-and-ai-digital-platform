// Admin API helpers: adminFetch (apiFetch + JSON + the "confirm your
// password" step-up for destructive actions), formatting and CSV export.
import { apiFetch } from '@/lib/api';
import { apiErrorMessage } from '@/lib/apiError';

export class AdminApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// The admin layout registers a password prompt here (see ReauthPrompt in
// components/admin/kit.tsx). Resolves true once the admin has re-signed-in.
let reauthPrompt: (() => Promise<boolean>) | null = null;
export function registerReauthPrompt(fn: (() => Promise<boolean>) | null) {
  reauthPrompt = fn;
}

/**
 * fetch + JSON for /api/admin/* (and other API) calls. Throws AdminApiError
 * with a plain-language message on failure (see apiErrorMessage); `action`
 * completes "you can't …", e.g. "approve this request". When the backend
 * answers REAUTH_REQUIRED, asks for the password once and retries.
 */
export async function adminFetch<T = any>(
  path: string,
  init?: RequestInit & { json?: unknown; action?: string }
): Promise<T> {
  const { json, action = 'complete that request', ...rest } = init ?? {};
  const doFetch = () =>
    apiFetch(path, {
      ...rest,
      headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...rest.headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });

  let res = await doFetch();
  let data = await res.clone().json().catch(() => ({}));
  if (res.status === 401 && data?.code === 'REAUTH_REQUIRED' && reauthPrompt) {
    if (await reauthPrompt()) {
      res = await doFetch();
      data = await res.clone().json().catch(() => ({}));
    }
  }
  if (!res.ok) throw new AdminApiError(await apiErrorMessage(res, action), res.status, data?.code);
  return data as T;
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export const inr = (n: number | string | null | undefined) =>
  n == null || n === '' ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-IN'));

export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const fmtDateTime = (d: string | Date | null | undefined) =>
  d
    ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—';

export function timeAgo(d: string | Date | null | undefined) {
  if (!d) return 'never';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 60) return `${days}d ago`;
  return fmtDate(d);
}

export function fmtBytes(n: number | null | undefined) {
  if (n == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString('en-IN', { maximumFractionDigits: i ? 1 : 0 })} ${units[i]}`;
}

export const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`);

// ─── CSV export ──────────────────────────────────────────────────────────────

export function downloadCsv<T>(filename: string, rows: T[], columns: { header: string; value: (row: T) => unknown }[]) {
  const escape = (v: unknown) => {
    const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
    // Leading =,+,-,@ would run as a formula in Excel/Sheets.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [columns.map((c) => escape(c.header)).join(','), ...rows.map((r) => columns.map((c) => escape(c.value(r))).join(','))];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Fetch every page of an admin list endpoint (for CSV export). */
export async function fetchAllPages<T>(path: string, key: string, params: Record<string, string> = {}): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 100; page++) {
    const qs = new URLSearchParams({ ...params, page: String(page), pageSize: '200' });
    const data = await adminFetch<any>(`${path}?${qs}`, { action: 'export this list' });
    const rows: T[] = data[key] || [];
    out.push(...rows);
    if (rows.length < 200) break;
  }
  return out;
}

// ─── WhatsApp (click-to-chat, no API) ────────────────────────────────────────

/**
 * A wa.me link that opens WhatsApp with `text` ready to send. With a phone
 * number it opens that chat (10 digits = Indian, like the backend); without
 * one, WhatsApp asks who to send it to.
 */
export function whatsappLink(text: string, phone?: string | null) {
  const digits = (phone ?? '').replace(/\D/g, '');
  const to = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}
