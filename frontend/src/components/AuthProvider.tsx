'use client';

import React, { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuthStore } from '@/store/useAuthStore';
import { useRouter, usePathname } from 'next/navigation';
import { apiFetch } from '@/lib/api';

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setAuthUser, setRoleAndProfile, clearAuth, uid } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
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
        if (pathname === '/auth' || pathname === '/onboarding' || pathname.startsWith('/join')) {
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
              const profile =
                role === 'THERAPIST' ? data.user.therapist
                : role === 'ADMIN' ? data.user.admin
                : data.user.client;
              setRoleAndProfile(role, profile);
            }
          } else if (res.status === 404) {
            // Profile doesn't exist yet, needs onboarding
            if (pathname !== '/onboarding') {
              router.push('/onboarding');
            }
          }
        } catch (err) {
          console.error("Failed to load user profile context:", err);
        }
      } else {
        clearAuth();
        // /session/preview is a dev-only layout harness with no data of its own,
        // so it must not be bounced to /auth. It 404s in production anyway.
        const devPreview =
          process.env.NODE_ENV !== 'production' && pathname === '/session/preview';
        // /join/<token> is the public guest invite page — no session needed.
        const guestInvite = pathname.startsWith('/join');
        if (pathname !== '/auth' && pathname !== '/onboarding' && !devPreview && !guestInvite) {
          router.push('/auth');
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [setAuthUser, setRoleAndProfile, clearAuth, router, pathname]);

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
