'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Btn } from '@/components/staad/parts';
import { apiFetch } from '@/lib/api';
import { apiErrorMessage, caughtErrorMessage } from '@/lib/apiError';

// Opened from the "Unsubscribe" link in a marketing email (?u=<uid>&t=<sig>).
// Public: works signed out (see AuthProvider). Opening the page changes
// nothing, because mail scanners open links on their own; the button does.

type State =
  | { kind: 'loading' }
  | { kind: 'subscribed' }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

function Unsubscribe() {
  const params = useSearchParams();
  const qs = new URLSearchParams({ u: params.get('u') ?? '', t: params.get('t') ?? '' }).toString();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/unsubscribe?${qs}`);
        if (!res.ok) throw new Error(await apiErrorMessage(res, 'open this unsubscribe link'));
        const data = await res.json();
        if (!cancelled) setState(data.subscribed ? { kind: 'subscribed' } : { kind: 'done' });
      } catch (e) {
        if (!cancelled) setState({ kind: 'error', message: caughtErrorMessage(e, 'open this unsubscribe link') });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [qs]);

  const unsubscribe = async () => {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/unsubscribe?${qs}`, { method: 'POST' });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'unsubscribe you'));
      setState({ kind: 'done' });
    } catch (e) {
      setState({ kind: 'error', message: caughtErrorMessage(e, 'unsubscribe you') });
    } finally {
      setSaving(false);
    }
  };

  const text: React.CSSProperties = { margin: '0 0 16px', fontSize: 15, lineHeight: '25px', color: 'var(--ink)' };

  return (
    <main className="staad-ui" style={{ padding: '48px 16px 80px' }}>
      <article style={{ maxWidth: 560, margin: '0 auto' }}>
        <img src="/assests/staad-emblem.svg" alt="STAAD" width={36} height={36} />
        <header style={{ margin: '28px 0 20px' }}>
          <div className="eyebrow">Email preferences</div>
          <h1 className="phead__title">
            {state.kind === 'done' ? 'You’re unsubscribed' : 'Unsubscribe from product updates'}
          </h1>
        </header>

        <div role="status" aria-live="polite">
          {state.kind === 'loading' && <p style={text}>Checking your link…</p>}
          {state.kind === 'subscribed' && (
            <p style={text}>
              Stop receiving product updates and news from STAAD by email. You will still get emails about your account,
              billing and sessions.
            </p>
          )}
          {state.kind === 'done' && (
            <p style={text}>
              You won’t receive product updates or news from STAAD any more. Emails about your account, billing and
              sessions still arrive. You can subscribe again at any time from Profile.
            </p>
          )}
          {state.kind === 'error' && <p style={text}>{state.message}</p>}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
          {state.kind === 'subscribed' && (
            <Btn variant="primary" onClick={unsubscribe} disabled={saving}>
              {saving ? 'Unsubscribing…' : 'Unsubscribe'}
            </Btn>
          )}
          <Btn variant="ghost" href="/">Go to STAAD</Btn>
          <Btn variant="ghost" href="/privacy">Privacy Policy</Btn>
        </div>
      </article>
    </main>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={null}>
      <Unsubscribe />
    </Suspense>
  );
}
