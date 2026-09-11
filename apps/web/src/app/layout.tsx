import React from 'react';
import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '../components/Sidebar';
import { Header } from '../components/Header';

import { QueryProvider } from '../lib/query-provider';

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
      <body className="bg-[#0b1329] text-slate-100 flex min-h-screen">
        <QueryProvider>
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <Header />
            <main className="flex-1 p-6 overflow-y-auto">{children}</main>
          </div>
        </QueryProvider>
      </body>
    </html>
  );
}
