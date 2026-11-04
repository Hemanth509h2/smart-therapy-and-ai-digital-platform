'use client';

import React, { useEffect, useRef, useState } from 'react';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/firebase';
import { apiFetch } from '@/lib/api';
import { apiErrorMessage, caughtErrorMessage } from '@/lib/apiError';
import { Btn } from '@/components/staad/parts';
import { toast } from '@/components/practice/ui';
import { useAuthStore } from '@/store/useAuthStore';
import { LEGAL_VERSION } from '@/content/legal';

/**
 * Asks a therapist to accept the current Privacy Policy and Terms when their
 * recorded acceptance is missing (accounts created before acceptance was
 * recorded, or by an admin) or for an older version. Mounted by StaadShell, so
 * it shows on dashboard pages but never interrupts a live session.
 *
 * It can't be dismissed: using STAAD needs the current terms. The way out is
 * signing out, and the documents open in a new tab to be read first.
 */
export default function TermsUpdateGate() {
  const { role, profile, setRoleAndProfile } = useAuthStore();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const acceptRef = useRef<HTMLButtonElement>(null);

  // Only once the server's profile is loaded: a profile cached from before
  // acceptance was recorded has no termsVersion field at all, and must not
  // flash this dialog while the fresh one loads.
  const needed =
    role === 'THERAPIST' &&
    !!profile &&
    Object.prototype.hasOwnProperty.call(profile, 'termsVersion') &&
    profile.termsVersion !== LEGAL_VERSION;

  useEffect(() => {
    if (needed) acceptRef.current?.focus();
  }, [needed]);

  if (!needed) return null;

  const firstTime = !profile.termsVersion;

  const accept = async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/users/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'TERMS_PRIVACY', version: LEGAL_VERSION }),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'record your acceptance'));
      const data = await res.json();
      setRoleAndProfile('THERAPIST', data.profile);
      toast('Thank you. Your acceptance has been recorded.');
    } catch (e) {
      toast(caughtErrorMessage(e, 'record your acceptance'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const leave = async () => {
    try {
      await signOut(auth);
    } catch {
      toast('Could not sign out. Please try again.', 'error');
      return;
    }
    router.push('/auth');
  };

  return (
    <div
      className="staad-ui"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        background: 'rgba(0,0,0,0.55)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="terms-gate-title"
        aria-describedby="terms-gate-body"
        className="card"
        style={{ maxWidth: 520, width: '100%', transform: 'none' }}
      >
        <h2 id="terms-gate-title" className="empty__h" style={{ margin: '0 0 10px' }}>
          {firstTime ? 'Please review our Privacy Policy and Terms' : 'We’ve updated our Privacy Policy and Terms'}
        </h2>
        <div id="terms-gate-body" style={{ fontSize: 14.5, lineHeight: '23px', color: 'var(--ink)' }}>
          <p style={{ margin: '0 0 10px' }}>
            {firstTime
              ? 'Before you continue, please read and accept the documents that govern your use of STAAD and how we handle your and your clients’ data.'
              : 'Please read the updated documents and accept them to keep using STAAD.'}
          </p>
          <p style={{ margin: '0 0 18px' }}>
            <a href="/privacy" target="_blank" rel="noopener" style={{ color: 'var(--ink)', fontWeight: 700, textDecoration: 'underline' }}>
              Privacy Policy
            </a>
            {' · '}
            <a href="/terms" target="_blank" rel="noopener" style={{ color: 'var(--ink)', fontWeight: 700, textDecoration: 'underline' }}>
              Terms &amp; Conditions
            </a>
          </p>
          <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--muted)' }}>
            By selecting “I agree” you confirm you are 18 or older and accept both documents. If you don’t agree, you
            can sign out, and you can delete your account at any time from Profile.
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={leave} disabled={saving}>
            Sign out
          </Btn>
          <button ref={acceptRef} type="button" className="btn btn--primary" onClick={accept} disabled={saving}>
            <span>{saving ? 'Saving…' : 'I agree'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
