'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Play } from 'lucide-react';
import { AdminPage, Badge, Card, Checkbox, EmptyState, ErrorBanner, SearchInput, Section, Select, Spinner, Toolbar, useAdminQuery } from '@/components/admin/kit';
import { toast } from '@/components/practice/ui';
import { adminFetch, num, timeAgo } from '@/lib/adminApi';
import { caughtErrorMessage } from '@/lib/apiError';

interface ModuleRow {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  enabled: boolean;
  featured: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  launches30d: number;
  launchesAllTime: number;
}

interface Category {
  id: string;
  name: string;
  desc: string;
  emoji: string;
  modules: ModuleRow[];
}

const SHOW = [
  { value: '', label: 'All modules' },
  { value: 'disabled', label: 'Turned off' },
  { value: 'featured', label: 'Featured' },
  { value: 'unused', label: 'Never used' },
];

export default function AdminModulesPage() {
  const { data, loading, error, reload, setData } = useAdminQuery<{ categories: Category[] }>('/api/admin/modules', 'load the modules');
  const [q, setQ] = useState('');
  const [show, setShow] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const categories = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.categories ?? [])
      .map((c) => ({
        ...c,
        modules: c.modules.filter((m) => {
          if (term && !`${m.name} ${m.desc} ${c.name}`.toLowerCase().includes(term)) return false;
          if (show === 'disabled') return !m.enabled;
          if (show === 'featured') return m.featured;
          if (show === 'unused') return m.launchesAllTime === 0;
          return true;
        }),
      }))
      .filter((c) => c.modules.length > 0);
  }, [data, q, show]);

  const all = data?.categories.flatMap((c) => c.modules) ?? [];
  const off = all.filter((m) => !m.enabled).length;

  const update = async (m: ModuleRow, change: { enabled?: boolean; featured?: boolean }) => {
    setBusy(m.id);
    try {
      const res = await adminFetch<{ module: { enabled: boolean; featured: boolean; updatedAt: string; updatedBy: string } }>('/api/admin/modules', {
        method: 'PATCH',
        json: { moduleId: m.id, ...change },
        action: `update ${m.name}`,
      });
      setData((d) =>
        d && {
          categories: d.categories.map((c) => ({
            ...c,
            modules: c.modules.map((x) => (x.id === m.id ? { ...x, ...res.module } : x)),
          })),
        }
      );
      toast(change.enabled === false ? `${m.name} is turned off for everyone.` : change.enabled ? `${m.name} is turned on.` : change.featured ? `${m.name} is now featured.` : `${m.name} is no longer featured.`);
    } catch (e) {
      toast(caughtErrorMessage(e, `update ${m.name}`), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminPage
      title="Module library"
      description={data ? `${all.length} modules, ${off} turned off. Turned-off modules are hidden from every professional.` : 'Turn modules on or off and feature them for professionals.'}
      permission="content"
    >
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search modules…" />
        <Select ariaLabel="Show" value={show} onChange={setShow} options={SHOW} />
      </Toolbar>
      {error && <ErrorBanner message={error} onRetry={reload} />}

      {loading && !data ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : data && categories.length === 0 ? (
        <EmptyState title="No modules match" body="Try a different search or filter." />
      ) : (
        categories.map((c) => (
          <Section key={c.id} title={`${c.emoji} ${c.name}`} description={c.desc}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {c.modules.map((m) => (
                <Card key={m.id} className="flex flex-col gap-3" style={m.enabled ? undefined : { opacity: 0.75 }}>
                  <div className="flex items-start gap-3">
                    <span aria-hidden className="text-2xl leading-none">{m.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold" style={{ color: 'var(--ink)' }}>{m.name}</h3>
                      <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>{m.desc}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {!m.enabled && <Badge tone="bad">Turned off</Badge>}
                    {m.featured && <Badge tone="info">Featured</Badge>}
                    {m.launchesAllTime === 0 && <Badge tone="warn">Never used</Badge>}
                    <Badge>{num(m.launches30d)} launches · 30d</Badge>
                    <Badge>{num(m.launchesAllTime)} all time</Badge>
                  </div>
                  <div className="mt-auto flex flex-wrap items-center gap-4 border-t pt-3" style={{ borderColor: 'var(--glass-border)' }}>
                    <Checkbox checked={m.enabled} onChange={(v) => busy !== m.id && update(m, { enabled: v })} label="Enabled" />
                    <Checkbox checked={m.featured} onChange={(v) => busy !== m.id && update(m, { featured: v })} label="Featured" />
                    {m.updatedAt && (
                      <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }} title={m.updatedBy ?? undefined}>
                        Changed {timeAgo(m.updatedAt)}
                      </span>
                    )}
                    {/* Opens the module on its own (no client, session or plan
                        needed). Works while it is turned off, so it can be
                        checked before turning it on for everyone. */}
                    <Link
                      href={`/admin/modules/try/${m.id}`}
                      className="btn-press ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold"
                      style={{ background: 'var(--glass-bg)', color: 'var(--ink)', border: '1px solid var(--glass-border)' }}
                    >
                      <Play className="h-3.5 w-3.5" /> Try
                    </Link>
                  </div>
                </Card>
              ))}
            </div>
          </Section>
        ))
      )}
    </AdminPage>
  );
}
