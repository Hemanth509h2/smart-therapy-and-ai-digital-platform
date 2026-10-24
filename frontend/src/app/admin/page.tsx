'use client';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarClock, Inbox, MessageSquareWarning, Users, Video, CreditCard, UserCheck } from 'lucide-react';
import { AdminPage, Badge, Card, EmptyState, ErrorBanner, Section, Spinner, StatCard, useAdminQuery } from '@/components/admin/kit';
import { ChartCard, type Point } from '@/components/admin/charts';
import { fmtDate, fmtDateTime, inr, num } from '@/lib/adminApi';

interface Dashboard {
  people?: { therapists: number; activeTherapists: number; clients: number; sessionsToday: number; sessionsMonth: number; openRiskFlags: number };
  billing?: { subscribed: number; listMrr: number; pendingRequests: number };
  support?: { openTickets: number; failedMessages: number };
  signupsWeekly?: Point[];
  sessionsDaily?: Point[];
  planMix?: Point[];
  expiring?: { id: string; therapistId: string; therapist: string; plan: string; endsAt: string }[];
  riskFlags?: { id: string; sessionId: string; level: string; raisedAt: string }[];
}

export default function AdminDashboardPage() {
  const { data, loading, error, reload } = useAdminQuery<Dashboard>('/api/admin/dashboard');

  return (
    <AdminPage title="Dashboard" description="How the platform is doing today, and what needs attention.">
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {data.people && (
              <>
                <StatCard label="Professionals" value={num(data.people.therapists)} hint={`${num(data.people.activeTherapists)} active in the last 7 days`} icon={<Users className="h-4 w-4" />} href="/admin/professionals" />
                <StatCard label="Clients" value={num(data.people.clients)} icon={<UserCheck className="h-4 w-4" />} href="/admin/clients" />
                <StatCard label="Sessions today" value={num(data.people.sessionsToday)} hint={`${num(data.people.sessionsMonth)} this month`} icon={<Video className="h-4 w-4" />} href="/admin/sessions" />
              </>
            )}
            {data.billing && (
              <StatCard label="On a plan" value={num(data.billing.subscribed)} hint={`${inr(data.billing.listMrr)}/mo at list price`} icon={<CreditCard className="h-4 w-4" />} href="/admin/subscriptions" />
            )}
          </div>

          <NeedsAttention data={data} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {data.sessionsDaily && <ChartCard title="Sessions per day" subtitle="Last 30 days, excluding cancelled" data={data.sessionsDaily} kind="bar" />}
            {data.signupsWeekly && <ChartCard title="New professionals per week" subtitle="Last 12 weeks" data={data.signupsWeekly} kind="line" />}
            {data.planMix && (
              <ChartCard title="Professionals by plan" subtitle="Current terms" data={data.planMix} kind="bar" horizontal height={Math.max(140, data.planMix.length * 44)} />
            )}
          </div>
        </>
      ) : !loading ? (
        <EmptyState title="Nothing to show" />
      ) : null}
    </AdminPage>
  );
}

function NeedsAttention({ data }: { data: Dashboard }) {
  const items: { key: string; icon: React.ReactNode; text: React.ReactNode; href: string; badge?: React.ReactNode }[] = [];

  if (data.people?.openRiskFlags) {
    items.push({
      key: 'risk',
      icon: <AlertTriangle className="h-4 w-4" />,
      text: `${data.people.openRiskFlags} AI risk flag${data.people.openRiskFlags === 1 ? '' : 's'} not yet acknowledged`,
      href: '/admin/sessions?tab=risk',
      badge: <Badge tone="bad">Clinical safety</Badge>,
    });
  }
  if (data.billing?.pendingRequests) {
    items.push({
      key: 'requests',
      icon: <CreditCard className="h-4 w-4" />,
      text: `${data.billing.pendingRequests} plan request${data.billing.pendingRequests === 1 ? '' : 's'} waiting for approval`,
      href: '/admin/subscriptions',
    });
  }
  for (const s of data.expiring ?? []) {
    items.push({
      key: `exp-${s.id}`,
      icon: <CalendarClock className="h-4 w-4" />,
      text: <>{s.therapist}'s <b>{s.plan}</b> plan ends {fmtDate(s.endsAt)}</>,
      href: `/admin/professionals/${s.therapistId}`,
      badge: <Badge tone="warn">Expiring</Badge>,
    });
  }
  if (data.support?.openTickets) {
    items.push({ key: 'tickets', icon: <Inbox className="h-4 w-4" />, text: `${data.support.openTickets} open support ticket${data.support.openTickets === 1 ? '' : 's'}`, href: '/admin/support' });
  }
  if (data.support?.failedMessages) {
    items.push({
      key: 'wa',
      icon: <MessageSquareWarning className="h-4 w-4" />,
      text: `${data.support.failedMessages} WhatsApp message${data.support.failedMessages === 1 ? '' : 's'} failed this week`,
      href: '/admin/messages?status=FAILED',
    });
  }

  return (
    <Section title="Needs attention">
      <Card className="p-0">
        {items.length === 0 ? (
          <p className="px-5 py-6 text-sm" style={{ color: 'var(--ink-muted)' }}>All clear — nothing needs attention right now.</p>
        ) : (
          <ul>
            {items.map((i) => (
              <li key={i.key} style={{ borderBottom: '1px solid var(--glass-border)' }} className="last:border-0">
                <Link href={i.href} className="flex items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-[var(--sage-light)]" style={{ color: 'var(--ink)' }}>
                  <span style={{ color: 'var(--sage)' }}>{i.icon}</span>
                  <span className="flex-1">{i.text}</span>
                  {i.badge}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {data.riskFlags && data.riskFlags.length > 0 && (
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          Latest flag: {data.riskFlags[0].level} at {fmtDateTime(data.riskFlags[0].raisedAt)}
        </p>
      )}
    </Section>
  );
}
