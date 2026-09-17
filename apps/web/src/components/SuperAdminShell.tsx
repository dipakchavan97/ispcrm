'use client';

import React, { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Building2,
  Router,
  Users,
  ScrollText,
  ShieldAlert,
  Sun,
  Moon,
  Palette,
  LogOut,
  ChevronDown,
  Check,
  Menu,
  X,
  ExternalLink,
  Sparkles,
  CreditCard,
  UserPlus,
  HelpCircle,
  Settings,
  Shield,
} from 'lucide-react';
import { apiFetch, getAuthToken, redirectToLogin } from '../lib/api';
import { useTheme } from '../lib/theme-provider';

interface AdminUserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  organization?: {
    id: string;
    name: string;
    slug: string;
    email: string;
  };
}

const navItems = [
  { name: 'Dashboard', icon: LayoutDashboard, href: '/super-admin' },
  { name: 'Tenants', icon: Building2, href: '/super-admin/tenants' },
  { name: 'Global Routers', icon: Router, href: '/super-admin/routers' },
  { name: 'Platform Users', icon: Users, href: '/super-admin/users' },
  { name: 'Audit Logs', icon: ScrollText, href: '/super-admin/audit-logs' },
];

const futurePlaceholders = [
  { name: 'Onboarding', icon: UserPlus },
  { name: 'SaaS Plans', icon: Sparkles },
  { name: 'Billing', icon: CreditCard },
  { name: 'Support Tickets', icon: HelpCircle },
  { name: 'System Settings', icon: Settings },
];

export function SuperAdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  const [authChecked, setAuthChecked] = useState(false);
  const [profile, setProfile] = useState<AdminUserProfile | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isThemeDropdownOpen, setIsThemeDropdownOpen] = useState(false);
  const themeDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      redirectToLogin();
      return;
    }

    let isMounted = true;
    apiFetch<AdminUserProfile>('/auth/me')
      .then((user) => {
        if (isMounted && user) {
          setProfile(user);
          if (user.role === 'SUPER_ADMIN') {
            setIsSuperAdmin(true);
          } else {
            setIsSuperAdmin(false);
          }
          setAuthChecked(true);
        }
      })
      .catch(() => {
        if (isMounted) {
          setAuthChecked(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [pathname]);

  // Click outside to close theme dropdown
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (themeDropdownRef.current && !themeDropdownRef.current.contains(e.target as Node)) {
        setIsThemeDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  if (!authChecked) {
    return (
      <div className="min-h-screen w-full bg-[#090d16] flex items-center justify-center text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-mono tracking-wide text-slate-400">
            Validating Super Admin privileges...
          </span>
        </div>
      </div>
    );
  }

  // 403 Screen if non-super-admin tries to view Super Admin interface
  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen w-full bg-[#090d16] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-rose-900/40 rounded-2xl p-6 sm:p-8 text-center shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-5">
            <ShieldAlert className="h-8 w-8" />
          </div>
          <h1 className="text-xl font-bold text-slate-100 mb-2">Access Restricted</h1>
          <p className="text-sm text-slate-400 mb-6 leading-relaxed">
            The Super Admin platform control panel requires <span className="text-rose-400 font-mono font-semibold">SUPER_ADMIN</span> privileges.
            Your account is assigned role <span className="text-amber-400 font-mono font-semibold">{profile?.role || 'UNKNOWN'}</span>.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors shadow-lg shadow-indigo-600/20"
            >
              Return to Tenant CRM
            </button>
            <button
              onClick={() => redirectToLogin()}
              className="px-4 py-2.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm font-medium transition-colors"
            >
              Log Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const sidebarContent = (isMobile: boolean) => (
    <div className="flex flex-col h-full bg-[#0b101d] border-r border-slate-800/80">
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-5 border-b border-slate-800/80 shrink-0 bg-slate-950/40">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white font-bold shadow-lg shadow-indigo-500/25">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <div className="font-bold text-slate-100 text-sm tracking-tight flex items-center gap-1.5">
              ISPCRM <span className="px-1.5 py-0.2 text-[10px] font-mono font-semibold rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">HQ</span>
            </div>
            <div className="text-[10px] text-indigo-400/90 font-mono font-medium">Platform Super Admin</div>
          </div>
        </div>

        {isMobile && (
          <button
            onClick={() => setIsMobileNavOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Main Nav */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        <div>
          <div className="px-3 mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Platform Management
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href || (item.href !== '/super-admin' && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => isMobile && setIsMobileNavOpen(false)}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-md shadow-indigo-900/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80'
                  }`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div>
          <div className="px-3 mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Roadmap Modules
          </div>
          <div className="space-y-1">
            {futurePlaceholders.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.name}
                  className="flex items-center justify-between px-3.5 py-2 rounded-xl text-xs font-medium text-slate-500 opacity-60 cursor-not-allowed"
                >
                  <div className="flex items-center gap-3">
                    <Icon className="h-4 w-4" />
                    <span>{item.name}</span>
                  </div>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">Soon</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tenant CRM Switcher & Profile Footer */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-950/40 space-y-2 shrink-0">
        <Link
          href="/dashboard"
          className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-900/90 border border-slate-800 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800/90 transition-colors group"
        >
          <span className="flex items-center gap-2">
            <ExternalLink className="h-3.5 w-3.5 text-indigo-400 group-hover:text-indigo-300" />
            Switch to Tenant CRM
          </span>
          <span className="text-[10px] font-mono text-slate-500">app</span>
        </Link>

        <div className="flex items-center justify-between px-2 pt-1">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-indigo-900/60 border border-indigo-700/50 flex items-center justify-center text-xs font-bold text-indigo-300 shrink-0">
              SA
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-200 truncate">{profile?.name || 'Super Admin'}</div>
              <div className="text-[10px] font-mono text-indigo-400 truncate">{profile?.email || 'admin@platform'}</div>
            </div>
          </div>
          <button
            onClick={() => redirectToLogin()}
            title="Log Out"
            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 flex-col fixed inset-y-0 left-0 z-30">
        {sidebarContent(false)}
      </aside>

      {/* Mobile Drawer */}
      {isMobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setIsMobileNavOpen(false)}
          />
          <div className="relative w-72 max-w-[85vw] h-full z-10">
            {sidebarContent(true)}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-h-screen min-w-0">
        {/* Super Admin Top Header */}
        <header className="h-16 bg-[#0b101d]/90 backdrop-blur border-b border-slate-800/80 px-4 sm:px-6 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsMobileNavOpen(true)}
              className="lg:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="hidden sm:block">
              <span className="text-xs font-semibold text-slate-400">Platform Control</span>
              <span className="mx-2 text-slate-600">/</span>
              <span className="text-xs font-semibold text-slate-200 capitalize">
                {pathname.split('/')[2] || 'Dashboard'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Theme Selector */}
            <div className="relative" ref={themeDropdownRef}>
              <button
                onClick={() => setIsThemeDropdownOpen(!isThemeDropdownOpen)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
              >
                {theme === 'dark' && <Moon className="h-3.5 w-3.5 text-blue-400" />}
                {theme === 'light' && <Sun className="h-3.5 w-3.5 text-amber-400" />}
                {theme === 'colorful' && <Palette className="h-3.5 w-3.5 text-purple-400" />}
                <span className="capitalize">{theme}</span>
                <ChevronDown className="h-3 w-3 text-slate-500" />
              </button>

              {isThemeDropdownOpen && (
                <div className="absolute right-0 mt-2 w-36 rounded-xl bg-slate-900 border border-slate-800 shadow-xl py-1 z-50">
                  <button
                    onClick={() => {
                      setTheme('dark');
                      setIsThemeDropdownOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-slate-800 transition-colors ${
                      theme === 'dark' ? 'text-blue-400 font-semibold' : 'text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Moon className="h-3.5 w-3.5" />
                      <span>Dark</span>
                    </div>
                    {theme === 'dark' && <Check className="h-3 w-3" />}
                  </button>
                  <button
                    onClick={() => {
                      setTheme('light');
                      setIsThemeDropdownOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-slate-800 transition-colors ${
                      theme === 'light' ? 'text-amber-400 font-semibold' : 'text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Sun className="h-3.5 w-3.5" />
                      <span>Light</span>
                    </div>
                    {theme === 'light' && <Check className="h-3 w-3" />}
                  </button>
                  <button
                    onClick={() => {
                      setTheme('colorful');
                      setIsThemeDropdownOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-slate-800 transition-colors ${
                      theme === 'colorful' ? 'text-purple-400 font-semibold' : 'text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Palette className="h-3.5 w-3.5" />
                      <span>Colorful</span>
                    </div>
                    {theme === 'colorful' && <Check className="h-3 w-3" />}
                  </button>
                </div>
              )}
            </div>

            {/* Platform Status Indicator */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>SUPER ADMIN ACTIVE</span>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
