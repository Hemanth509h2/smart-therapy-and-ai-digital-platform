'use client';

// Where a client lands when the therapist ends the call and the browser would
// not let the session tab close itself (see app/session/[sessionId]/page.tsx),
// when a guest leaves the call themselves (?left=1), or after the therapist
// removed them from the call (?removed=1). Public: guests have no
// account, so they must never be sent to the login page.

import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';

export default function SessionEndedPage() {
  const [reason, setReason] = useState<'ended' | 'left' | 'removed'>('ended');

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setReason(q.get('removed') === '1' ? 'removed' : q.get('left') === '1' ? 'left' : 'ended');
    // Sign out the throwaway guest identity from the invite link. Done here,
    // not in the session room, so the sign-out can't trigger a redirect to /auth.
    auth.authStateReady().then(() => {
      if (auth.currentUser?.uid?.startsWith('guest:')) auth.signOut().catch(() => {});
    });
    // One more try: some in-app browsers (e.g. WhatsApp's) allow it here.
    window.close();
  }, []);

  return (
    <div className="flex h-screen w-screen items-center justify-center px-4" style={{ background: '#0d1614' }}>
      <div className="w-full max-w-sm text-center">
        <h1 className="text-xl font-semibold" style={{ color: '#fff' }}>
          {reason === 'left' ? 'You left the session' : 'Session ended'}
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--ink-muted)' }}>
          {reason === 'left'
            ? 'To rejoin, open the invite link your therapist sent you again. Otherwise you can close this tab.'
            : reason === 'removed'
              ? 'Your therapist removed you from the call. To join again, open your invite link and wait to be let in. Otherwise you can close this tab.'
              : 'Your therapist has ended the session. You can close this tab now.'}
        </p>
      </div>
    </div>
  );
}
