'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Eye, EyeOff, Repeat } from 'lucide-react';
import {
  AdminPage,
  Badge,
  Btn,
  Card,
  DataTable,
  EmptyState,
  ErrorBanner,
  Field,
  KV,
  Modal,
  Section,
  Select,
  Spinner,
  StatCard,
  useAdmin,
  useAdminQuery,
  type Tone,
} from '@/components/admin/kit';
import { adminFetch, fmtDate, fmtDateTime, fmtMinutes, num, timeAgo } from '@/lib/adminApi';
import { caughtErrorMessage } from '@/lib/apiError';
import { toast } from '@/components/practice/ui';

interface ClientDetail {
  client: {
    id: string;
    name: string;
    masked: boolean;
    createdAt: string;
    status: 'ACTIVE' | 'SUSPENDED';
    lastSeenAt: string | null;
    inviteStatus: 'CLAIMED' | 'DIRECT';
    phi?: {
      dateOfBirth: string;
      gender: string | null;
      diagnosis: string[];
      parentEmail: string | null;
      phoneNumber: string | null;
      email: string | null;
    };
  };
  therapist: { id: string; name: string; email: string } | null;
  stats: { sessions: number; byStatus: Record<string, number>; totalMinutes: number; lastSession: string | null; bookings: number };
  progress: { metrics: number; reports: number; finalReports: number; notes: number };
  sessions: {
    id: string;
    status: string;
    scheduledAt: string;
    durationMinutes: number | null;
    therapist: { id: string; name: string };
  }[];
}

const SESSION_TONE: Record<string, Tone> = { ACTIVE: 'good', SCHEDULED: 'info', COMPLETED: 'neutral', CANCELLED: 'bad' };

export default function AdminClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAdmin();
  const [reveal, setReveal] = useState(false);
  const { data, loading, error, reload } = useAdminQuery<ClientDetail>(`/api/admin/clients/${id}${reveal ? '?reveal=1' : ''}`, 'load this client');
  const [reassignOpen, setReassignOpen] = useState(false);

  const c = data?.client;
  const phi = c?.phi;

  return (
    <AdminPage
      permission="people.read"
      back={{ href: '/admin/clients', label: 'Back to Clients' }}
      title={
        c ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            {c.name}
            <Badge tone={c.status === 'SUSPENDED' ? 'bad' : 'good'}>{c.status === 'SUSPENDED' ? 'Suspended' : 'Active'}</Badge>
          </span>
        ) : (
          'Client'
        )
      }
      description={c && (c.masked ? 'Name shown as initials. Clinical details are hidden.' : 'Full details shown — this view is recorded in the audit log.')}
      actions={
        c && (
          <>
            {can('phi.read') && (
              <Btn variant="ghost" icon={reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} onClick={() => setReveal((v) => !v)} title="Each reveal is logged">
                {reveal ? 'Hide details' : 'Reveal details (logged)'}
              </Btn>
            )}
            {can('people.write') && (
              <Btn icon={<Repeat className="h-4 w-4" />} onClick={() => setReassignOpen(true)}>Reassign</Btn>
            )}
          </>
        )
      }
    >
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : data && c ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Sessions" value={num(data.stats.sessions)} hint={`${num(data.stats.byStatus.COMPLETED ?? 0)} completed`} />
            <StatCard label="Session time" value={fmtMinutes(data.stats.totalMinutes)} />
            <StatCard label="Progress metrics" value={num(data.progress.metrics)} hint={`${num(data.progress.notes)} progress notes`} />
            <StatCard label="Progress reports" value={num(data.progress.reports)} hint={`${num(data.progress.finalReports)} final`} />
          </div>

          <Card>
            <KV
              items={[
                {
                  label: 'Therapist',
                  value: data.therapist ? (
                    <Link href={`/admin/professionals/${data.therapist.id}`} className="font-semibold hover:underline" style={{ color: 'var(--sage)' }}>
                      {data.therapist.name}
                    </Link>
                  ) : (
                    'Unassigned'
                  ),
                },
                { label: 'Joined via', value: c.inviteStatus === 'CLAIMED' ? 'Invite' : 'Added directly' },
                { label: 'Created', value: fmtDate(c.createdAt) },
                { label: 'Last seen', value: timeAgo(c.lastSeenAt) },
                { label: 'Last session', value: fmtDate(data.stats.lastSession) },
                { label: 'Bookings', value: num(data.stats.bookings) },
                ...(phi
                  ? [
                      { label: 'Date of birth', value: fmtDate(phi.dateOfBirth) },
                      { label: 'Gender', value: phi.gender || '—' },
                      {
                        label: 'Diagnosis',
                        value: phi.diagnosis.length ? (
                          <span className="flex flex-wrap gap-1">{phi.diagnosis.map((d) => <Badge key={d} tone="info">{d}</Badge>)}</span>
                        ) : (
                          '—'
                        ),
                      },
                      { label: 'Email', value: phi.email || '—' },
                      { label: 'Parent email', value: phi.parentEmail || '—' },
                      { label: 'Phone', value: phi.phoneNumber || '—' },
                    ]
                  : []),
              ]}
            />
          </Card>

          <Section title="Sessions">
            <DataTable
              rowKey={(s) => s.id}
              rows={data.sessions}
              empty="No sessions yet."
              columns={[
                { key: 'when', header: 'Scheduled', render: (s) => <span className="whitespace-nowrap">{fmtDateTime(s.scheduledAt)}</span> },
                {
                  key: 'therapist',
                  header: 'Therapist',
                  render: (s) => <Link href={`/admin/professionals/${s.therapist.id}`} className="hover:underline">{s.therapist.name}</Link>,
                },
                { key: 'status', header: 'Status', render: (s) => <Badge tone={SESSION_TONE[s.status] ?? 'neutral'}>{s.status.toLowerCase()}</Badge> },
                { key: 'duration', header: 'Duration', align: 'right', render: (s) => (s.durationMinutes != null ? fmtMinutes(s.durationMinutes) : '—') },
              ]}
            />
          </Section>

          {can('people.write') && (
            <ReassignModal
              open={reassignOpen}
              onClose={() => setReassignOpen(false)}
              clientId={c.id}
              currentTherapistId={data.therapist?.id ?? null}
              onDone={reload}
            />
          )}
        </>
      ) : !loading ? (
        <EmptyState title={error ? 'Nothing to show' : 'Client not found'} />
      ) : null}
    </AdminPage>
  );
}

function ReassignModal({
  open,
  onClose,
  clientId,
  currentTherapistId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  clientId: string;
  currentTherapistId: string | null;
  onDone: () => void;
}) {
  const { data, loading, error, reload } = useAdminQuery<{ professionals: { id: string; name: string; email?: string }[] }>(
    open ? '/api/admin/professionals?pageSize=200&sort=name&dir=asc' : null,
    'load the professionals'
  );
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const options = (data?.professionals ?? []).filter((p) => p.id !== currentTherapistId);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await adminFetch<{ therapist: { name: string } }>(`/api/admin/clients/${clientId}`, {
        method: 'PATCH',
        json: { therapistId: target },
        action: 'reassign this client',
      });
      toast(`Client reassigned to ${res.therapist.name}.`);
      setTarget('');
      onDone();
      onClose();
    } catch (e) {
      toast(caughtErrorMessage(e, 'reassign this client'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reassign client"
      description="Moves the client to another professional. Past sessions stay with the professional who ran them."
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn onClick={submit} loading={busy} disabled={!target}>Reassign</Btn>
        </>
      }
    >
      {loading && open && !data && !error ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : error ? (
        <ErrorBanner message={`Could not load professionals: ${error}`} onRetry={reload} />
      ) : (
        <Field label="New professional">
          <Select
            ariaLabel="New professional"
            className="w-full"
            value={target}
            onChange={setTarget}
            options={[
              { value: '', label: options.length ? 'Choose a professional…' : 'No other professionals' },
              ...options.map((p) => ({ value: p.id, label: `${p.name || 'Unnamed'}${p.email ? ` · ${p.email}` : ''}` })),
            ]}
          />
        </Field>
      )}
    </Modal>
  );
}
