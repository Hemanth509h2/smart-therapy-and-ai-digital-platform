'use client';

// Landing page for an admin invite link (/admin/invite/<token>). The visitor
// isn't an admin yet, so this deliberately doesn't use AdminPage. AuthProvider
// lets this path through signed out and skips onboarding for it.

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { ShieldCheck } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { ADMIN_ROLE_LABELS, type AdminRole } from '@/lib/adminRoles';
import { fmtDate } from '@/lib/adminApi';
import { Badge, Btn, ErrorBanner, Field, Input, Spinner } from '@/components/admin/kit';

const REDIRECT_KEY = 'staad-post-auth-redirect';

interface InviteInfo {
  email: string;
  adminRole: AdminRole;
  expiresAt: string;
  state: 'valid' | 'accepted' | 'revoked' | 'expired';
  valid: boolean;
}

const STATE_TEXT: Record<Exclude<InviteInfo['state'], 'valid'>, string> = {
  accepted: 'This invite has already been used.',
  revoked: 'This invite was revoked. Ask the admin who invited you for a new one.',
  expired: 'This invite has expired. Ask the admin who invited you for a new one.',
};

export default function AdminInvitePage({ params }: { params: { token: string } }) {
  const { token } = params;
  const router = useRouter();
  const { uid, email, setRoleAndProfile } = useAuthStore();

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch(`/api/admin-invites/${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(res.status === 404 ? 'This invite link is not valid.' : data.error || 'Could not load the invite.');
        setInvite(data);
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const isGuest = !!uid && (uid.startsWith('guest:') || uid.startsWith('client:'));
  const signedIn = !!uid && !isGuest;
  const emailMatches = signedIn && !!email && !!invite && email.toLowerCase() === invite.email.toLowerCase();

  // Remember where to come back to, then go to sign-in / sign-up.
  const goToAuth = async () => {
    try {
      sessionStorage.setItem(REDIRECT_KEY, `/admin/invite/${token}`);
    } catch {}
    if (uid) await signOut(auth).catch(() => {});
    router.push('/auth');
  };

  const accept = async () => {
    setAccepting(true);
    setError('');
    try {
      const res = await apiFetch(`/api/admin-invites/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: firstName.trim() || undefined, lastName: lastName.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && data.code !== 'ALREADY_ADMIN') throw new Error(data.error || 'Could not accept the invite.');
      // Load the new role before navigating so the admin guard doesn't bounce us.
      const prof = await apiFetch('/api/users/profile');
      if (prof.ok) {
        const { user } = await prof.json();
        if (user) setRoleAndProfile(user.role, user.role === 'ADMIN' ? user.admin : user.role === 'THERAPIST' ? user.therapist : user.client);
      }
      router.replace('/admin');
    } catch (e: any) {
      setError(e.message);
      setAccepting(false);
    }
  };

  const role = invite ? ADMIN_ROLE_LABELS[invite.adminRole] : null;

  return (
    <div className="staad-ui admin-ui flex min-h-screen w-full items-center justify-center px-4 py-10">
      <div
        className="w-full max-w-md space-y-5 rounded-2xl border bg-[var(--glass-bg)] p-6 shadow-[var(--glass-shadow)] animate-scale-in"
        style={{ borderColor: 'var(--glass-border)' }}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <img src="/assests/staad-logo-horizontal.svg" alt="STAAD" style={{ height: 56, width: 'auto' }} />
          <h1 className="font-heading text-2xl" style={{ color: 'var(--ink)' }}>Admin invite</h1>
        </div>

        {loading && (
          <div className="flex justify-center py-6"><Spinner /></div>
        )}

        {!loading && loadError && <ErrorBanner message={loadError} />}

        {!loading && invite && (
          <>
            <div className="space-y-2 rounded-xl p-4" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
              <div className="flex items-center gap-2" style={{ color: 'var(--ink)' }}>
                <ShieldCheck className="h-5 w-5 shrink-0" style={{ color: 'var(--sage)' }} />
                <span className="text-sm font-semibold">
                  You&apos;ve been invited to the STAAD admin portal as
                </span>
                {role && <Badge tone="info">{role.label}</Badge>}
              </div>
              {role && <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>{role.description}.</p>}
              <p className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
                For <strong style={{ color: 'var(--ink)' }}>{invite.email}</strong>
                {invite.valid && <> · expires {fmtDate(invite.expiresAt)}</>}
              </p>
            </div>

            {!invite.valid ? (
              <ErrorBanner message={STATE_TEXT[invite.state as keyof typeof STATE_TEXT]} />
            ) : !signedIn ? (
              <div className="space-y-3">
                <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
                  Sign in — or create an account — with <strong style={{ color: 'var(--ink)' }}>{invite.email}</strong>.
                  You&apos;ll come back here to accept.
                </p>
                <Btn className="w-full" onClick={goToAuth}>Sign in or create account</Btn>
              </div>
            ) : !emailMatches ? (
              <div className="space-y-3">
                <ErrorBanner message={`You're signed in as ${email || 'another account'}. This invite is for ${invite.email}.`} />
                <Btn className="w-full" variant="ghost" onClick={goToAuth}>Sign out and use {invite.email}</Btn>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
                  Signed in as <strong style={{ color: 'var(--ink)' }}>{email}</strong>. Your name is shown to other admins (optional).
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="First name">
                    <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
                  </Field>
                  <Field label="Last name">
                    <Input value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
                  </Field>
                </div>
                {error && <ErrorBanner message={error} />}
                <Btn className="w-full" onClick={accept} loading={accepting}>Accept and open admin portal</Btn>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
