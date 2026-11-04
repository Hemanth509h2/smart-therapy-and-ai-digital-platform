'use client';

import React, { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Analytics } from '@vercel/analytics/next';
import {
  COOKIE_CHANGE_EVENT,
  COOKIE_SETTINGS_EVENT,
  analyticsAllowed,
  readCookieChoice,
  saveCookieChoice,
} from '@/lib/cookieConsent';

// In the live session room the banner would cover the call controls, so it
// isn't shown there on its own; analytics simply stays off until a choice is
// made on another page. "Cookie settings" still opens it anywhere.
const QUIET_PATHS = ['/session/'];

/**
 * First-visit banner asking whether optional analytics may run. "Accept" and
 * "Reject" are the same size and style, nothing is pre-selected, and closing
 * the banner any other way is not taken as consent.
 */
export function CookieConsent() {
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);
  const firstButton = useRef<HTMLButtonElement>(null);
  const reopened = useRef(false);

  useEffect(() => {
    const quiet = QUIET_PATHS.some((p) => pathname.startsWith(p));
    if (!quiet && !readCookieChoice()) setOpen(true);
  }, [pathname]);

  useEffect(() => {
    const show = () => {
      reopened.current = true;
      setOpen(true);
    };
    window.addEventListener(COOKIE_SETTINGS_EVENT, show);
    return () => window.removeEventListener(COOKIE_SETTINGS_EVENT, show);
  }, []);

  // Opened from a "Cookie settings" link: move focus into the banner.
  useEffect(() => {
    if (open && reopened.current) firstButton.current?.focus();
  }, [open]);

  if (!open) return null;

  const choose = (analytics: boolean) => {
    saveCookieChoice(analytics);
    reopened.current = false;
    setOpen(false);
  };

  const current = readCookieChoice();

  const button: React.CSSProperties = {
    flex: '1 1 160px',
    minHeight: 44,
    padding: '10px 18px',
    borderRadius: 12,
    border: '1.5px solid var(--ink)',
    background: 'var(--glass-strong)',
    color: 'var(--ink)',
    font: 'inherit',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  };

  return (
    <section
      role="region"
      aria-label="Cookie preferences"
      style={{
        position: 'fixed',
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 9999,
        maxWidth: 640,
        margin: '0 auto',
        padding: '18px 20px',
        borderRadius: 16,
        background: 'var(--glass-strong)',
        border: '1px solid var(--glass-border)',
        boxShadow: 'var(--glass-shadow-lg)',
        color: 'var(--ink)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        fontFamily: '"DM Sans", system-ui, sans-serif',
      }}
    >
      <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 800 }}>Your privacy choices</h2>
      <p style={{ margin: '0 0 6px', fontSize: 14, lineHeight: '21px' }}>
        STAAD only stores what it needs to work, such as keeping you signed in and remembering your theme.
        With your permission we would also use Vercel Web Analytics to count page visits so we can improve
        the site. It sets no advertising cookies and does not track you on other websites.
      </p>
      <p style={{ margin: '0 0 14px', fontSize: 13, lineHeight: '19px', color: 'var(--ink-muted)' }}>
        {current
          ? `Current choice: analytics ${current.analytics ? 'accepted' : 'rejected'}. `
          : 'Nothing optional runs until you choose. '}
        You can change this any time from &ldquo;Cookie settings&rdquo;.{' '}
        <a href="/privacy#cookies" style={{ color: 'var(--ink)', fontWeight: 700, textDecoration: 'underline' }}>
          Read the Privacy Policy
        </a>
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <button ref={firstButton} type="button" style={button} onClick={() => choose(false)}>
          Reject analytics
        </button>
        <button type="button" style={button} onClick={() => choose(true)}>
          Accept analytics
        </button>
      </div>
    </section>
  );
}

/**
 * Vercel Web Analytics, mounted only after the visitor accepted. If they later
 * reject, `beforeSend` drops every event at once (the already-loaded script
 * can't be unloaded until the next page load).
 */
export function ConsentedAnalytics() {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    setAllowed(analyticsAllowed());
    const update = () => setAllowed(analyticsAllowed());
    window.addEventListener(COOKIE_CHANGE_EVENT, update);
    return () => window.removeEventListener(COOKIE_CHANGE_EVENT, update);
  }, []);

  // Only on Vercel, which sets NEXT_PUBLIC_VERCEL_ENV: elsewhere (Docker) the
  // script doesn't exist and every page would request it in vain.
  if (!process.env.NEXT_PUBLIC_VERCEL_ENV || !allowed) return null;
  return <Analytics beforeSend={(event) => (analyticsAllowed() ? event : null)} />;
}
