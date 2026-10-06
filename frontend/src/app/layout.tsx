import React from 'react';
import AuthProvider from '@/components/AuthProvider';
import ThemeProvider from '@/components/ThemeProvider';
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
        </ThemeProvider>
      </body>
    </html>
  );
}
