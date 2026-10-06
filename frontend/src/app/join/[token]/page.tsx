'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { apiFetch } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Heart, Video, ShieldCheck, Loader2 } from 'lucide-react';

interface InviteInfo {
  firstName: string;
  therapistName: string;
  status: string;
}

/**
 * Guest landing page for invite links (/join/<token>). The patient needs NO
 * account: we sign in to Firebase anonymously (invisible — used only for
 * Firestore/LiveKit access), claim the invite server-side, and drop them
 * straight into the session room.
 */
export default function GuestJoinPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const router = useRouter();

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch(`/api/invites/${token}`)
      .then((res) => (res.ok ? res.json() : res.json().then((d) => Promise.reject(new Error(d.error || 'Invite not found')))))
      .then((data) => setInvite(data.invite))
      .catch((e) => setError(e.message || 'This invite link is not valid.'))
      .finally(() => setLoading(false));
  }, [token]);

  const join = async () => {
    setJoining(true);
    setError(null);
    try {
      // Claim the invite first — the backend generates a guest identity and
      // mints a custom token for it (no anonymous sign-in provider needed).
      const res = await apiFetch(`/api/invites/${token}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not join the session.');
      await signInWithCustomToken(auth, data.guestToken);
      sessionStorage.setItem('guestName', data.clientName || 'Guest');
      router.push(`/session/${data.sessionId}?guest=1`);
    } catch (e: any) {
      if (e?.code === 'auth/operation-not-allowed') {
        setError('Guest access is not enabled yet. Please ask your therapist for an account link instead.');
      } else if (e?.code === 'auth/network-request-failed') {
        setError('Network problem — please check your internet connection and try again.');
      } else {
        setError(e?.message || 'Could not join the session.');
      }
      setJoining(false);
    }
  };

  return (
    <div
      className="flex min-h-screen w-full items-center justify-center px-4"
      style={{ background: 'var(--page-bg)' }}
    >
      <Card
        className="w-full max-w-md border shadow-[var(--glass-shadow)] rounded-2xl bg-white dark:bg-[#16221e] animate-scale-in"
        style={{ borderColor: 'var(--glass-border)' }}
      >
        <CardHeader className="space-y-2 text-center pb-4">
          <CardTitle className="flex justify-center">
            <img src="/assests/staad-logo-horizontal.svg" alt="STAAD" style={{ height: 64, width: 'auto' }} />
          </CardTitle>
          <CardDescription className="font-medium" style={{ color: 'var(--ink-muted)' }}>
            Your therapist invited you to a session
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-6" style={{ color: 'var(--ink-muted)' }}>
              <Loader2 className="h-5 w-5 animate-spin" /> Loading your invite…
            </div>
          )}

          {!loading && invite && (
            <>
              <div
                className="rounded-xl p-4 text-center"
                style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
              >
                <p className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
                  Hi {invite.firstName} 👋
                </p>
                <p className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
                  <strong>{invite.therapistName}</strong> is waiting for you in a calm, private space.
                  No account or password needed.
                </p>
              </div>

              <div className="space-y-2 text-sm" style={{ color: 'var(--ink-muted)' }}>
                <div className="flex items-center gap-2">
                  <Video className="h-4 w-4" style={{ color: 'var(--sage)' }} /> Live video session with your therapist
                </div>
                <div className="flex items-center gap-2">
                  <Heart className="h-4 w-4" style={{ color: 'var(--sage)' }} /> Gentle, playful activities together
                </div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" style={{ color: 'var(--sage)' }} /> Private — only you two can join
                </div>
              </div>

              {error && <p className="text-sm text-red-600 font-medium text-center">{error}</p>}

              <Button
                onClick={join}
                disabled={joining}
                className="w-full transition-all rounded-xl py-5 font-semibold"
                style={{ background: 'var(--sage)', color: '#fff', border: 'none' }}
              >
                {joining ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Joining…
                  </span>
                ) : (
                  'Join session'
                )}
              </Button>
            </>
          )}

          {!loading && !invite && (
            <p className="py-4 text-center text-sm font-medium text-red-600">
              {error || 'This invite link is not valid. Ask your therapist for a new one.'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
