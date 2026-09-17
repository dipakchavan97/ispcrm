'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { getAuthToken } from '../lib/api';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isAuthPage = pathname === '/login' || pathname === '/register';
  const [authChecked, setAuthChecked] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  useEffect(() => {
    const token = getAuthToken();
    if (!token && !isAuthPage) {
      router.replace('/login');
    } else if (token && isAuthPage) {
      router.replace('/dashboard');
    } else {
      setAuthChecked(true);
    }
  }, [pathname, isAuthPage, router]);

  // If on auth pages (login/register), render full screen without dashboard shell
  if (isAuthPage) {
    return <>{children}</>;
  }

  // Prevent flash of protected dashboard before checking authentication
  if (!authChecked) {
    return (
      <div className="min-h-screen w-full bg-background flex items-center justify-center text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-mono">Verifying operator session...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground overflow-x-hidden">
      <Sidebar isMobileOpen={isMobileNavOpen} onClose={() => setIsMobileNavOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0 w-full">
        <Header onToggleMobileNav={() => setIsMobileNavOpen((prev) => !prev)} />
        <main className="flex-1 p-3 sm:p-4 md:p-6 overflow-y-auto w-full min-w-0">{children}</main>
      </div>
    </div>
  );
}
