'use client';

import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { readCachedAuth, useAuthStore } from '@/store/useAuthStore';
import { useRouter, usePathname } from 'next/navigation';
import { apiFetch, PROFILE_MISMATCH_EVENT } from '@/lib/api';
import { toast } from '@/components/practice/ui';
import { apiErrorMessage, networkErrorMessage } from '@/lib/apiError';

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setAuthUser, setRoleAndProfile, clearAuth } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  // Read by the auth listener, so it doesn't re-subscribe (and re-fetch the
  // profile) on every navigation.
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    // Show the page at once with the last signed-in user's role and profile.
    // Firebase restoring the session and the profile request can take seconds;
    // the listener below confirms the cached user or replaces it.
    const cached = readCachedAuth();
    if (cached) {
      setAuthUser(cached.uid, cached.email);
      setRoleAndProfile(cached.role, cached.profile);
      setLoading(false);
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      const pathname = pathRef.current;
      if (firebaseUser) {
        if (cached && cached.uid !== firebaseUser.uid) {
          // A different account than the cached one: wait for its own profile.
          clearAuth();
          setLoading(true);
        }
        setAuthUser(firebaseUser.uid, firebaseUser.email);

        // Guest joining via an invite link: signed in anonymously, so there
        // is no Postgres profile to fetch and onboarding must never trigger.
        // They get a client-shaped view of the session room and nothing else.
        if (firebaseUser.uid.startsWith('guest:')) {
          setRoleAndProfile('CLIENT', null);
          setLoading(false);
          return;
        }

        // Skip profile fetch on pages that handle their own auth flow
        // (/admin/invite/<token>: the invitee may have no profile yet, and
        // must not be sent to onboarding).
        if (
          pathname === '/auth' ||
          pathname === '/onboarding' ||
          pathname.startsWith('/join') ||
          pathname.startsWith('/admin/invite/')
        ) {
          setLoading(false);
          return;
        }

        try {
          // Identity is verified server-side from the ID token that
          // apiFetch attaches — no client-supplied uid.
          const res = await apiFetch('/api/users/profile');
          if (res.ok) {
            const data = await res.json();
            if (data.user) {
              const role = data.user.role;
              if (role === 'CLIENT') {
                // Patients no longer have accounts; they join through the link their therapist sends.
                await signOut(auth);
                clearAuth();
                router.push('/auth?clients=removed');
                setLoading(false);
                return;
              }
              setRoleAndProfile(role, role === 'THERAPIST' ? data.user.therapist : data.user.admin);
            }
          } else if (res.status === 404) {
            // Profile doesn't exist yet, needs onboarding
            setRoleAndProfile(null, null);
            if (pathname !== '/onboarding') {
              router.push('/onboarding');
            }
          } else {
            // Without a fresh profile the page keeps the cached one, and its
            // requests may fail; say why instead of failing silently.
            toast(await apiErrorMessage(res, 'load your account'), 'error');
          }
        } catch (err) {
          console.error("Failed to load user profile context:", err);
          toast(networkErrorMessage('load your account'), 'error');
        }
      } else {
        clearAuth();
        // /session/preview is a dev-only layout harness with no data of its own,
        // so it must not be bounced to /auth. It 404s in production anyway.
        const devPreview =
          process.env.NODE_ENV !== 'production' && pathname === '/session/preview';
        // /join/<token> is the public guest invite page — no session needed.
        // /admin/invite/<token> explains how to sign in before accepting.
        // /session-ended is where guests land after a call (they have no account).
        // /privacy and /terms are linked from sign-up and the session consent prompt.
        const guestInvite =
          pathname.startsWith('/join') ||
          pathname.startsWith('/admin/invite/') ||
          pathname === '/session-ended' ||
          pathname === '/privacy' ||
          pathname === '/terms';
        if (pathname !== '/auth' && pathname !== '/onboarding' && !devPreview && !guestInvite) {
          router.push('/auth');
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [setAuthUser, setRoleAndProfile, clearAuth, router]);

  // A request was refused because the page sent a profile id that isn't the
  // signed-in user's — the cached profile is stale (e.g. data was migrated or
  // another account signed in on this browser). Reload the real profile; pages
  // keyed on the profile id then refetch on their own.
  useEffect(() => {
    let last = 0;
    const reload = async () => {
      if (Date.now() - last < 10_000) return; // one reload per burst of failures
      last = Date.now();
      try {
        const res = await apiFetch('/api/users/profile');
        const data = res.ok ? await res.json() : null;
        const role = data?.user?.role;
        if (role === 'THERAPIST' || role === 'ADMIN') {
          setRoleAndProfile(role, role === 'THERAPIST' ? data.user.therapist : data.user.admin);
          toast('Your account details were out of date and have been refreshed.', 'info');
        } else {
          toast(res.ok ? 'Please sign in again to continue.' : await apiErrorMessage(res, 'refresh your account'), 'error');
        }
      } catch {
        toast(networkErrorMessage('refresh your account'), 'error');
      }
    };
    window.addEventListener(PROFILE_MISMATCH_EVENT, reload);
    return () => window.removeEventListener(PROFILE_MISMATCH_EVENT, reload);
  }, [setRoleAndProfile]);

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#f6f8f6]">
        <div className="text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto"></div>
          <p className="mt-4 text-muted-foreground font-medium">Entering calm space...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
