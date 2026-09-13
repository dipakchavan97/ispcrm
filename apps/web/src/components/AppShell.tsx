'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { getAuthToken } from '../lib/api';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === '/login';
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const token = getAuthToken();
    if (!token && !isLoginPage) {
      router.replace('/login');
    } else if (token && isLoginPage) {
      router.replace('/dashboard');
    } else {
      setAuthChecked(true);
    }
  }, [pathname, isLoginPage, router]);

  // If on login page, render full screen without dashboard shell
  if (isLoginPage) {
    return <>{children}</>;
  }

  // Prevent flash of protected dashboard before checking authentication
  if (!authChecked) {
    return (
      <div className="min-h-screen w-full bg-[#0b1329] flex items-center justify-center text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-mono">Verifying operator session...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full bg-[#0b1329]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 p-6 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
