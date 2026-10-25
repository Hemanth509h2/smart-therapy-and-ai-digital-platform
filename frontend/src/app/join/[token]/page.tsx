'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { apiFetch } from '@/lib/api';
import { apiErrorMessage, caughtErrorMessage, networkErrorMessage } from '@/lib/apiError';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Heart, Video, ShieldCheck, Loader2 } from 'lucide-react';
import { toast } from '@/components/practice/ui';

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
  const [joining, setJoining] = useState(false);
  const [loading, setLoading] = useState(true);
  // The session behind this link has ended (410): the link can't be used again.
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/invites/${token}`)
      .then(async (res) => {
        if (res.status === 410) {
          if (!cancelled) setEnded(true);
          return { invite: null };
        }
        if (!res.ok) throw new Error(await apiErrorMessage(res, 'open this invite link'));
        return res.json();
      })
      .then((data) => !cancelled && setInvite(data.invite))
      .catch((e) => !cancelled && toast(caughtErrorMessage(e, 'open this invite link'), 'error'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const join = async () => {
    setJoining(true);
    try {
      // Claim the invite first — the backend generates a guest identity and
      // mints a custom token for it (no anonymous sign-in provider needed).
      const res = await apiFetch(`/api/invites/${token}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.status === 410) {
        setInvite(null);
        setEnded(true);
        return;
      }
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'join the session'));
      const data = await res.json().catch(() => ({}));
      await signInWithCustomToken(auth, data.guestToken);
      sessionStorage.setItem('guestName', data.clientName || 'Guest');
      router.push(`/session/${data.sessionId}?guest=1`);
    } catch (e: any) {
      if (e?.code === 'auth/operation-not-allowed') {
        toast('Guest access is not enabled yet. Please ask your therapist for an account link instead.', 'error');
      } else if (e?.code === 'auth/network-request-failed') {
        toast(networkErrorMessage('join the session'), 'error');
      } else {
        toast(caughtErrorMessage(e, 'join the session'), 'error');
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

          {!loading && !invite && ended && (
            <div className="py-4 text-center">
              <p className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
                This session has ended
              </p>
              <p className="mt-1 text-sm" style={{ color: 'var(--ink-muted)' }}>
                This link can no longer be used. Your therapist will send you a new link for your next session.
              </p>
            </div>
          )}

          {!loading && !invite && !ended && (
            <p className="py-4 text-center text-sm font-medium" style={{ color: 'var(--ink-muted)' }}>
              This invite link is not valid. Ask your therapist for a new one.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
