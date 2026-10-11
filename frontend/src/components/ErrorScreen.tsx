'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Btn } from '@/components/staad/parts';
import { IconArrowRightXs } from '@/components/staad/icons';

/**
 * Full-page error screen shared by app/error.tsx (runtime errors in any page),
 * app/not-found.tsx (404) and app/global-error.tsx (root layout failures).
 * Pages don't import this directly — Next.js renders those files automatically.
 */
export default function ErrorScreen({
  code,
  title,
  message,
  detail,
  onRetry,
}: {
  code: string;
  title: string;
  message: string;
  /** Shown small and muted, e.g. an error reference for support. */
  detail?: string;
  onRetry?: () => void;
}) {
  const router = useRouter();

  return (
    <main
      className="staad-ui"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px' }}
    >
      <section
        className="card"
        role="alert"
        style={{ width: '100%', maxWidth: 480, display: 'grid', gap: 24, padding: 32 }}
      >
        <img src="/assests/staad-emblem.svg" alt="STAAD" width={36} height={36} />

        <div>
          <p
            style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontSize: 56,
              lineHeight: '60px',
              fontWeight: 500,
              letterSpacing: '-1px',
              color: 'var(--ink)',
            }}
          >
            {code}
          </p>
          <h1 className="empty__h" style={{ marginTop: 12 }}>{title}</h1>
          <p className="empty__p" style={{ maxWidth: 'none' }}>{message}</p>
          {detail && (
            <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--muted)', wordBreak: 'break-word' }}>
              {detail}
            </p>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {onRetry ? (
            <Btn variant="primary" icon={<IconArrowRightXs />} onClick={onRetry}>Try again</Btn>
          ) : (
            <Btn variant="primary" icon={<IconArrowRightXs />} href="/">Go to home</Btn>
          )}
          {onRetry && <Btn variant="ghost" href="/">Go to home</Btn>}
          <Btn variant="ghost" onClick={() => router.back()}>Go back</Btn>
        </div>
      </section>
    </main>
  );
}
