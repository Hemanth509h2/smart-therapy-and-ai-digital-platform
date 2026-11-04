import React from 'react';
import type { Metadata } from 'next';
import AuthProvider from '@/components/AuthProvider';
import { PageRefreshProvider } from '@/lib/pageRefresh';
import ThemeProvider from '@/components/ThemeProvider';
import { Toaster } from '@/components/practice/ui';
import { CookieConsent, ConsentedAnalytics } from '@/components/CookieConsent';
import './fonts';
import './globals.css';
import './staad-design.css';
import './staad-extras.css';

const TITLE = 'STAAD — Collaborative Therapy Platform';
const DESCRIPTION = 'A calm, emotionally safe, and interactive space for neurodivergent learners.';

// The public address, so link previews get absolute image URLs (WhatsApp and
// others ignore relative ones). NEXT_PUBLIC_SITE_URL wins; on Vercel the
// production domain is used; local builds fall back to localhost.
function siteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return new URL(explicit);
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return new URL(`https://${vercel}`);
  return new URL('http://localhost:3000');
}

// Open Graph and Twitter tags make a shared link (WhatsApp, Slack, LinkedIn,
// X, iMessage) show a preview card with a title, description and image
// instead of a bare URL. The image comes from opengraph-image.tsx.
export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: 'STAAD',
  openGraph: {
    type: 'website',
    siteName: 'STAAD',
    title: TITLE,
    description: DESCRIPTION,
    locale: 'en_IN',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-[#f6f0e3]">
        <ThemeProvider>
          <AuthProvider>
            {/* The sidebar's Refresh button remounts the page from here. */}
            <PageRefreshProvider>{children}</PageRefreshProvider>
          </AuthProvider>
          <Toaster />
          <CookieConsent />
        </ThemeProvider>
        {/* Vercel Web Analytics (page views, visitors), only after the visitor
            accepts analytics in the cookie banner. */}
        <ConsentedAnalytics />
      </body>
    </html>
  );
}
