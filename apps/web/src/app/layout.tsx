import React from 'react';
import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '../components/Sidebar';
import { Header } from '../components/Header';

import { QueryProvider } from '../lib/query-provider';
import { ToastProvider } from '../components/Toast';

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
    <html lang="en" className="dark">
      <body className="bg-[#0b1329] text-slate-100 min-h-screen">
        <QueryProvider>
          <ToastProvider>
            <AppShell>{children}</AppShell>
          </ToastProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
