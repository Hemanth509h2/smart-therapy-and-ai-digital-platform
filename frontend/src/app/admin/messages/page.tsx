'use client';

import React, { useEffect, useState } from 'react';
import { CheckCheck, Megaphone, MessageSquareWarning, RotateCw, Send, SkipForward, Smartphone } from 'lucide-react';
import {
  AdminPage,
  Badge,
  Btn,
  Card,
  ConfirmDialog,
  DataTable,
  ErrorBanner,
  Field,
  Input,
  Modal,
  Pagination,
  SearchInput,
  Select,
  StatCard,
  Textarea,
  Toolbar,
  useAdmin,
  useAdminQuery,
  useListState,
  type Column,
  type Tone,
} from '@/components/admin/kit';
import { ChartCard, type Point } from '@/components/admin/charts';
import { adminFetch, fmtDateTime, num, timeAgo } from '@/lib/adminApi';
import { caughtErrorMessage } from '@/lib/apiError';
import { toast } from '@/components/practice/ui';

type MsgStatus = 'PENDING' | 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'SKIPPED';
type MsgType = 'CLIENT_INVITE' | 'SESSION_SCHEDULED' | 'SESSION_STARTED';

interface Message {
  id: string;
  phoneNumber: string;
  messageType: MsgType;
  status: MsgStatus;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  lastAttemptAt: string | null;
  sentAt: string | null;
  createdAt: string;
  therapist: string | null;
  sessionAt: string | null;
}

interface MessagesResponse {
  messages: Message[];
  total: number;
  stats: { counts: Record<MsgStatus, number>; total: number; attempted: number; deliveryRate: number | null; sentRate: number | null };
  sentDaily: Point[];
}

const STATUS_TONE: Record<MsgStatus, Tone> = {
  PENDING: 'neutral',
  SENDING: 'info',
  SENT: 'info',
  DELIVERED: 'good',
  READ: 'good',
  FAILED: 'bad',
  SKIPPED: 'warn',
};
const STATUS_LABEL: Record<MsgStatus, string> = {
  PENDING: 'Pending',
  SENDING: 'Sending',
  SENT: 'Sent',
  DELIVERED: 'Delivered',
  READ: 'Read',
  FAILED: 'Failed',
  SKIPPED: 'Skipped',
};
const TYPE_LABEL: Record<MsgType, string> = {
  CLIENT_INVITE: 'Client invite',
  SESSION_SCHEDULED: 'Booking confirmation',
  SESSION_STARTED: 'Session join link',
};

const pct = (r: number | null) => (r == null ? '—' : `${Math.round(r * 1000) / 10}%`);

export default function AdminMessagesPage() {
  const { can } = useAdmin();
  const list = useListState({ sort: 'createdAt', dir: 'desc', filters: { status: '', type: '', from: '', to: '' } });
  const { data, loading, error, reload } = useAdminQuery<MessagesResponse>(`/api/admin/messages?${list.query}`, 'load the messages');
  const [retrying, setRetrying] = useState<string | null>(null);
  const [broadcastOpen, setBroadcastOpen] = useState(false);

  // Honour ?status=FAILED (linked from the dashboard). Read once on mount.
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('status');
    if (s && s in STATUS_LABEL) list.setFilter('status', s);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = async (m: Message) => {
    setRetrying(m.id);
    try {
      const res = await adminFetch<{ ok: boolean; message: Message }>(`/api/admin/messages/${m.id}/retry`, {
        method: 'POST',
        action: 'resend this message',
      });
      if (res.ok) toast('Message resent.');
      else toast(`The message still could not be sent${res.message.errorMessage ? `: ${res.message.errorMessage}` : '.'}`, 'error');
      reload();
    } catch (e) {
      toast(caughtErrorMessage(e, 'resend this message'), 'error');
    } finally {
      setRetrying(null);
    }
  };

  const stats = data?.stats;
  const sent = stats ? stats.counts.SENT + stats.counts.DELIVERED + stats.counts.READ : 0;

  const columns: Column<Message>[] = [
    { key: 'createdAt', header: 'Created', sortKey: 'createdAt', render: (r) => <span title={fmtDateTime(r.createdAt)}>{fmtDateTime(r.createdAt)}</span> },
    { key: 'type', header: 'Message', render: (r) => TYPE_LABEL[r.messageType] ?? r.messageType },
    { key: 'phone', header: 'To', render: (r) => <span className="whitespace-nowrap font-mono text-xs">{r.phoneNumber}</span> },
    { key: 'therapist', header: 'Professional', render: (r) => r.therapist ?? '—' },
    {
      key: 'status',
      header: 'Status',
      className: 'max-w-xs',
      render: (r) => (
        <div className="space-y-0.5">
          <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
          {r.errorMessage && (
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              {r.errorCode ? `${r.errorCode}: ` : ''}{r.errorMessage}
            </p>
          )}
        </div>
      ),
    },
    { key: 'attempts', header: 'Attempts', sortKey: 'attempts', align: 'right', render: (r) => num(r.attempts) },
    { key: 'lastAttemptAt', header: 'Last attempt', sortKey: 'lastAttemptAt', render: (r) => timeAgo(r.lastAttemptAt) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) =>
        r.status === 'FAILED' ? (
          <Btn size="sm" variant="ghost" icon={<RotateCw className="h-3.5 w-3.5" />} loading={retrying === r.id} disabled={!!retrying} onClick={() => retry(r)}>
            Retry
          </Btn>
        ) : null,
    },
  ];

  return (
    <AdminPage
      title="Messages"
      description="WhatsApp delivery log, the WhatsApp bot, and email announcements."
      permission="support"
      actions={
        <Btn icon={<Megaphone className="h-4 w-4" />} onClick={() => setBroadcastOpen(true)}>
          Email announcement
        </Btn>
      }
    >
      {error && <ErrorBanner message={error} onRetry={reload} />}

      {stats && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Sent" value={num(sent)} hint={`${pct(stats.sentRate)} of attempts`} icon={<Send className="h-4 w-4" />} />
          <StatCard label="Delivery rate" value={pct(stats.deliveryRate)} hint={`${num(stats.counts.DELIVERED + stats.counts.READ)} confirmed delivered or read`} icon={<CheckCheck className="h-4 w-4" />} />
          <StatCard label="Failed" value={num(stats.counts.FAILED)} hint={`${num(stats.counts.PENDING + stats.counts.SENDING)} pending`} icon={<MessageSquareWarning className="h-4 w-4" />} />
          <StatCard label="Skipped" value={num(stats.counts.SKIPPED)} hint="WhatsApp turned off in settings" icon={<SkipForward className="h-4 w-4" />} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {data && <ChartCard title="WhatsApp messages sent per day" subtitle="Last 30 days" data={data.sentDaily} kind="bar" />}
        </div>
        <BotCard canManage={can('settings')} />
      </div>

      <Toolbar>
        <SearchInput value={list.q} onChange={list.setQ} placeholder="Search phone number…" />
        <Select
          ariaLabel="Status"
          value={list.filters.status}
          onChange={(v) => list.setFilter('status', v)}
          options={[{ value: '', label: 'All statuses' }, ...(Object.keys(STATUS_LABEL) as MsgStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))]}
        />
        <Select
          ariaLabel="Message type"
          value={list.filters.type}
          onChange={(v) => list.setFilter('type', v)}
          options={[{ value: '', label: 'All messages' }, ...(Object.keys(TYPE_LABEL) as MsgType[]).map((t) => ({ value: t, label: TYPE_LABEL[t] }))]}
        />
        <label className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--ink-muted)' }}>
          Created
          <Input type="date" aria-label="Created from" value={list.filters.from} onChange={(e) => list.setFilter('from', e.target.value)} className="w-auto py-2" />
          –
          <Input type="date" aria-label="Created to" value={list.filters.to} onChange={(e) => list.setFilter('to', e.target.value)} className="w-auto py-2" />
        </label>
      </Toolbar>

      <DataTable columns={columns} rows={data?.messages ?? []} rowKey={(r) => r.id} loading={loading} sort={list.sort} dir={list.dir} onSort={list.onSort} empty="No messages match these filters." />
      <Pagination page={list.page} pageSize={list.pageSize} total={data?.total ?? 0} onPage={list.setPage} />

      <BroadcastModal open={broadcastOpen} onClose={() => setBroadcastOpen(false)} />
    </AdminPage>
  );
}

// ─── WhatsApp bot ────────────────────────────────────────────────────────────

function BotCard({ canManage }: { canManage: boolean }) {
  const { data, loading, error, reload } = useAdminQuery<{ configured: boolean; reachable: boolean; connected: boolean; error?: string; checkedAt?: string }>(
    '/api/admin/messages/bot',
    'check the WhatsApp bot'
  );
  const [confirm, setConfirm] = useState(false);

  let badge: React.ReactNode = <Badge>Checking…</Badge>;
  let body = '';
  if (error) {
    badge = <Badge tone="bad">Unavailable</Badge>;
    body = 'The bot status could not be checked.';
  } else if (data) {
    if (!data.reachable) {
      badge = <Badge tone="bad">Offline</Badge>;
      body = `The bot service could not be reached${data.error ? ` (${data.error})` : ''}. WhatsApp messages will fail until it is back.`;
    } else if (data.connected) {
      badge = <Badge tone="good">Connected</Badge>;
      body = 'A WhatsApp number is linked and messages are being sent.';
    } else {
      badge = <Badge tone="warn">QR scan needed</Badge>;
      body = 'The bot is running but no WhatsApp number is linked. Pair a phone from the bot’s /qr page.';
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-heading text-lg" style={{ color: 'var(--ink)' }}>
          <Smartphone className="h-4 w-4" style={{ color: 'var(--sage)' }} /> WhatsApp bot
        </h2>
        {badge}
      </div>
      <p className="flex-1 text-sm" style={{ color: 'var(--ink-muted)' }}>{loading && !data && !error ? 'Checking the bot…' : body}</p>
      <div className="flex flex-wrap gap-2">
        <Btn size="sm" variant="ghost" icon={<RotateCw className="h-3.5 w-3.5" />} onClick={reload} loading={loading}>Check again</Btn>
        {canManage && data?.reachable && (
          <Btn size="sm" variant="danger" onClick={() => setConfirm(true)}>Clear WhatsApp account</Btn>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Clear the WhatsApp account?"
        body="This unlinks the current WhatsApp number from the bot. No messages will send until someone scans a new QR code."
        confirmLabel="Unlink and clear"
        danger
        onConfirm={async () => {
          await adminFetch('/api/admin/messages/bot', { method: 'POST', json: { action: 'logout' }, action: 'clear the WhatsApp account' });
          toast('WhatsApp account cleared. Pair a new number from the bot’s QR page.');
          reload();
        }}
      />
    </Card>
  );
}

// ─── Broadcast ───────────────────────────────────────────────────────────────

function BroadcastModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [audience, setAudience] = useState<'therapists' | 'all'>('therapists');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipients, setRecipients] = useState<number | null>(null);
  const [busy, setBusy] = useState<'' | 'preview' | 'send'>('');

  useEffect(() => {
    if (open) setRecipients(null);
  }, [open]);
  // The count is for one audience; changing it needs a fresh preview.
  useEffect(() => setRecipients(null), [audience]);

  const preview = async () => {
    setBusy('preview');
    try {
      const res = await adminFetch<{ recipients: number }>('/api/admin/messages/broadcast', {
        method: 'POST',
        json: { audience, dryRun: true },
        action: 'count the recipients',
      });
      setRecipients(res.recipients);
    } catch (e) {
      toast(caughtErrorMessage(e, 'count the recipients'), 'error');
    } finally {
      setBusy('');
    }
  };

  const send = async () => {
    setBusy('send');
    try {
      const res = await adminFetch<{ ok: boolean; sent: number; recipients: number; failures: string[] }>('/api/admin/messages/broadcast', {
        method: 'POST',
        json: { audience, subject, body },
        action: 'send the announcement',
      });
      if (res.ok) {
        toast(`Announcement emailed to ${num(res.sent)} people.`);
        setSubject('');
        setBody('');
        onClose();
      } else {
        toast(`Sent to ${num(res.sent)} of ${num(res.recipients)}. Some batches failed: ${res.failures.join('; ')}`, 'warning');
      }
    } catch (e) {
      toast(caughtErrorMessage(e, 'send the announcement'), 'error');
    } finally {
      setBusy('');
    }
  };

  const ready = !!subject.trim() && !!body.trim() && recipients != null && recipients > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Email announcement"
      description="Sent by email (BCC, so recipients don't see each other) to every active account in the audience."
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="ghost" onClick={preview} loading={busy === 'preview'} disabled={!!busy}>Preview recipients</Btn>
          <Btn icon={<Send className="h-4 w-4" />} onClick={send} loading={busy === 'send'} disabled={!ready || !!busy}>
            {recipients != null ? `Send to ${num(recipients)}` : 'Send'}
          </Btn>
        </>
      }
    >
      <Field label="Audience">
        <Select
          ariaLabel="Audience"
          value={audience}
          onChange={(v) => setAudience(v as 'therapists' | 'all')}
          options={[
            { value: 'therapists', label: 'All professionals' },
            { value: 'all', label: 'Everyone (professionals and clients)' },
          ]}
          className="w-full"
        />
      </Field>
      <Field label="Subject">
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
      </Field>
      <Field label="Message" hint="Plain text. Line breaks are kept.">
        <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
        {recipients == null ? 'Preview recipients to see how many people will get this before sending.' : `${num(recipients)} people will receive this email.`}
      </p>
    </Modal>
  );
}
