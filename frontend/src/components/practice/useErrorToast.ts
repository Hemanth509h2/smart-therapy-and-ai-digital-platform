'use client';

import { useEffect, useRef } from 'react';
import { toast } from './ui';

/**
 * Shows a load error as a toast (once per new error, not on every render),
 * with a Retry button when `retry` is given. If a retry fails with the same
 * message the toast is shown again, since the error value didn't change.
 */
export function useErrorToast(error: string | null | undefined, retry?: () => unknown) {
  const latest = useRef(error);
  latest.current = error;
  const retryRef = useRef(retry);
  retryRef.current = retry;

  // Remembers what was last shown so React's dev double-run doesn't toast twice.
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!error) {
      shown.current = null;
      return;
    }
    if (shown.current === error) return;
    shown.current = error;
    const show = (message: string) =>
      toast(message, 'error', {
        button: retryRef.current
          ? {
              title: 'Retry',
              onClick: async () => {
                await retryRef.current?.();
                // Let the page re-render with the result before checking it.
                setTimeout(() => {
                  if (latest.current === message) show(message);
                }, 50);
              },
            }
          : undefined,
      });
    show(error);
  }, [error]);
}
