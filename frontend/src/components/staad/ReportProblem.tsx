'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Bug, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { DsDialog, Field, toast } from '@/components/practice/ui';
import { fullName } from '@/lib/practice';
import { apiFetch } from '@/lib/api';
import { caughtErrorMessage, toastApiError } from '@/lib/apiError';

const KINDS = ['Something is broken', 'Something looks wrong', 'Something is slow', 'Suggestion'];

/**
 * "Report a problem" button for the top bar. Sends a support ticket (category
 * "Bug report", the admin Support inbox + support email) with the page it was
 * sent from and the browser details attached, so the report can be followed
 * up without asking where it happened.
 */
export function ReportProblem() {
  const { email, role, profile } = useAuthStore();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(KINDS[0]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) {
      setKind(KINDS[0]);
      setMessage('');
    }
  }, [open]);

  const submit = async () => {
    if (!message.trim()) return void toast('Describe what happened.', 'warning');
    const replyTo = email || profile?.email;
    if (!replyTo) return void toast('Your email has not loaded yet. Refresh the page and try again.', 'warning');
    // Where and in what browser, so the report can be reproduced. Never page content.
    const details = [
      `Page: ${window.location.pathname}${window.location.search}`,
      `Time: ${new Date().toISOString()}`,
      `Browser: ${navigator.userAgent}`,
      `Screen: ${window.innerWidth}×${window.innerHeight}`,
    ].join('\n');
    setSending(true);
    try {
      const res = await apiFetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fullName(profile),
          email: replyTo,
          role,
          category: 'Bug report',
          subject: `${kind} on ${pathname || 'a page'}`,
          message: `${message.trim()}\n\n---\n${details}`,
        }),
      });
      if (!res.ok) {
        await toastApiError(res, 'send your report');
        return;
      }
      const data = await res.json().catch(() => ({}));
      toast(data.ref ? `Thanks, report ${data.ref} was sent. We'll reply by email.` : "Thanks, your report was sent. We'll reply by email.");
      setOpen(false);
    } catch (e) {
      toast(caughtErrorMessage(e, 'send your report'), 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="theme-btn"
        onClick={() => setOpen(true)}
        aria-label="Report a problem with this page"
        title="Report a problem"
      >
        <Bug size={20} strokeWidth={1.6} />
      </button>

      <DsDialog
        open={open}
        onOpenChange={setOpen}
        title="Report a problem"
        description="Tell us what went wrong on this page. We reply by email."
        footer={
          <>
            <button className="ds-btn ds-btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="ds-btn ds-btn-clay" onClick={submit} disabled={sending || !message.trim()}>
              {sending && <Loader2 className="animate-spin" />}
              Send report
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="What kind of problem?" htmlFor="rp-kind">
            <select id="rp-kind" className="ds-input" value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="What happened?"
            htmlFor="rp-msg"
            hint="What you did, what you expected and what you saw. Please don't include clients' personal or health details."
          >
            <textarea
              id="rp-msg"
              className="ds-input"
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="I clicked Save on the client's details and nothing happened."
              autoFocus
              maxLength={5000}
            />
          </Field>
          <p className="ds-muted text-[12.5px]">
            We&apos;ll attach this page&apos;s address ({pathname}), the time, and your browser and screen size.
          </p>
        </div>
      </DsDialog>
    </>
  );
}
