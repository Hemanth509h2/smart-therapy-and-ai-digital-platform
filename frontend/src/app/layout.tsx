import React from 'react';
import { Analytics } from '@vercel/analytics/next';
import AuthProvider from '@/components/AuthProvider';
import ThemeProvider from '@/components/ThemeProvider';
import { Toaster } from '@/components/practice/ui';
import './globals.css';
import './staad-design.css';
import './staad-extras.css';

export const metadata = {
  title: 'STAAD — Collaborative Therapy Platform',
  description: 'A calm, emotionally safe, and interactive space for neurodivergent learners.',
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
            {children}
          </AuthProvider>
          <Toaster />
        </ThemeProvider>
        {/* Vercel Web Analytics (page views, visitors). Only on Vercel, which
            sets NEXT_PUBLIC_VERCEL_ENV: elsewhere (Docker) its script doesn't
            exist and every page would request it in vain. */}
        {process.env.NEXT_PUBLIC_VERCEL_ENV && <Analytics />}
      </body>
    </html>
  );
}
