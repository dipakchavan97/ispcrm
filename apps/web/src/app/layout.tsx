import React from 'react';
import type { Metadata } from 'next';
import './globals.css';
import { QueryProvider } from '../lib/query-provider';
import { ToastProvider } from '../components/Toast';
import { ThemeProvider } from '../lib/theme-provider';
import { AppShell } from '../components/AppShell';

export const metadata: Metadata = {
  title: 'ISP CRM & Billing SaaS',
  description: 'Production-oriented multi-tenant ISP CRM, billing, and bandwidth management SaaS for Indian ISPs.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var saved = localStorage.getItem('ispcrm_theme');
                  var theme = (saved === 'light' || saved === 'colorful') ? saved : 'dark';
                  document.documentElement.classList.remove('dark', 'light', 'colorful');
                  document.documentElement.classList.add(theme);
                } catch (e) {
                  document.documentElement.classList.add('dark');
                }
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-screen transition-colors duration-200">
        <QueryProvider>
          <ToastProvider>
            <ThemeProvider>
              <AppShell>{children}</AppShell>
            </ThemeProvider>
          </ToastProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
