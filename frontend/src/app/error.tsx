'use client';

import { useEffect } from 'react';
import ErrorScreen from '@/components/ErrorScreen';

// Catches runtime errors thrown while rendering any page under app/.
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[page error]', error);
  }, [error]);

  return (
    <ErrorScreen
      code="Oops"
      title="Something went wrong"
      message="This page ran into a problem. Please try again — if it keeps happening, let us know."
      detail={
        process.env.NODE_ENV !== 'production'
          ? error.message
          : error.digest
            ? `Reference: ${error.digest}`
            : undefined
      }
      onRetry={reset}
    />
  );
}
