'use client';

import { useEffect } from 'react';
import ErrorScreen from '@/components/ErrorScreen';
import './globals.css';
import './staad-design.css';
import './staad-extras.css';

// Last resort: replaces the root layout when it fails itself, so it must render
// its own <html>/<body> and load the stylesheets the layout normally provides.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global error]', error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <ErrorScreen
          code="Oops"
          title="Something went wrong"
          message="STAAD couldn't load. Please try again in a moment."
          detail={error.digest ? `Reference: ${error.digest}` : undefined}
          onRetry={reset}
        />
      </body>
    </html>
  );
}
