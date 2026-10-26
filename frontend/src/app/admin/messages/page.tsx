'use client';

import React, { useEffect, useState } from 'react';
import { Megaphone, Send } from 'lucide-react';
import { AdminPage, Btn, EmptyState, Field, Input, Modal, Select, Textarea } from '@/components/admin/kit';
import { adminFetch, num } from '@/lib/adminApi';
import { caughtErrorMessage } from '@/lib/apiError';
import { toast } from '@/components/practice/ui';

export default function AdminMessagesPage() {
  const [broadcastOpen, setBroadcastOpen] = useState(false);

  return (
    <AdminPage
      title="Messages"
      description="Email announcements to professionals and clients."
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
        body="Email every professional, or everyone, at once. Preview the number of recipients before you send."
        action={<Btn icon={<Megaphone className="h-4 w-4" />} onClick={() => setBroadcastOpen(true)}>Email announcement</Btn>}
      />
      <BroadcastModal open={broadcastOpen} onClose={() => setBroadcastOpen(false)} />
    </AdminPage>
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
