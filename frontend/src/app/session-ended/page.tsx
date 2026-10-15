'use client';

// Where a client lands when the therapist ends the call and the browser would
// not let the session tab close itself (see app/session/[sessionId]/page.tsx).

import { useEffect } from 'react';

export default function SessionEndedPage() {
  // One more try: some in-app browsers (e.g. WhatsApp's) allow it here.
  useEffect(() => {
    window.close();
  }, []);

  return (
    <div className="flex h-screen w-screen items-center justify-center px-4" style={{ background: '#0d1614' }}>
      <div className="w-full max-w-sm text-center">
        <h1 className="text-xl font-semibold" style={{ color: '#fff' }}>Session ended</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--ink-muted)' }}>
          Your therapist has ended the session. You can close this tab now.
        </p>
      </div>
    </div>
  );
}
