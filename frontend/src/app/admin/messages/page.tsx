'use client';

import React, { useEffect, useState } from 'react';
import { Megaphone, Send } from 'lucide-react';
import { AdminPage, Btn, EmptyState, Field, Input, Modal, Textarea } from '@/components/admin/kit';
import { adminFetch, num } from '@/lib/adminApi';
import { caughtErrorMessage } from '@/lib/apiError';
import { toast } from '@/components/practice/ui';

export default function AdminMessagesPage() {
  const [broadcastOpen, setBroadcastOpen] = useState(false);

  return (
    <AdminPage
      title="Messages"
      description="Email product updates to professionals who opted in."
      permission="support"
      actions={
        <Btn icon={<Megaphone className="h-4 w-4" />} onClick={() => setBroadcastOpen(true)}>
          Email announcement
        </Btn>
      }
    >
      <EmptyState
        icon={<Megaphone className="h-5 w-5" />}
        title="Send an announcement"
        body="Email every professional who opted in to product updates. Clients never receive these. Preview the number of recipients before you send."
        action={<Btn icon={<Megaphone className="h-4 w-4" />} onClick={() => setBroadcastOpen(true)}>Email announcement</Btn>}
      />
      <BroadcastModal open={broadcastOpen} onClose={() => setBroadcastOpen(false)} />
    </AdminPage>
  );
}

// ─── Broadcast ───────────────────────────────────────────────────────────────

function BroadcastModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipients, setRecipients] = useState<number | null>(null);
  const [busy, setBusy] = useState<'' | 'preview' | 'send'>('');

  useEffect(() => {
    if (open) setRecipients(null);
  }, [open]);

  const preview = async () => {
    setBusy('preview');
    try {
      const res = await adminFetch<{ recipients: number }>('/api/admin/messages/broadcast', {
        method: 'POST',
        json: { dryRun: true },
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
        json: { subject, body },
        action: 'send the announcement',
      });
      if (res.ok) {
        toast(`Announcement emailed to ${num(res.sent)} people.`);
        setSubject('');
        setBody('');
        onClose();
      } else {
        toast(`Sent to ${num(res.sent)} of ${num(res.recipients)}. Some emails failed: ${res.failures.join('; ')}`, 'warning');
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
      description="Sent one by one to every active professional who opted in to product updates. Each email has an unsubscribe link and one-click unsubscribe."
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
      <Field label="Subject">
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
      </Field>
      <Field label="Message" hint="Plain text. Line breaks are kept.">
        <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
        {recipients == null
          ? 'Preview recipients to see how many people will get this before sending.'
          : recipients === 0
            ? 'No professional has opted in to product updates yet, so there is no one to send to.'
            : `${num(recipients)} people will receive this email.`}
      </p>
    </Modal>
  );
}
