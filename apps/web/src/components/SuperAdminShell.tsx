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
      <div className="min-h-screen w-full bg-[#F5F6F8] flex items-center justify-center text-[#64748B]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-[#FF6B35] border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-mono text-[#0F172A]">Authenticating Platform Super Admin...</span>
        </div>
      </div>
    );
  }

  // RBAC Access Guard: If not SUPER_ADMIN, present high-contrast security denial
  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen w-full bg-[#F5F6F8] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white border border-[#E2E8F0] rounded-2xl p-6 sm:p-8 shadow-2xl text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center mx-auto text-rose-600">
            <ShieldAlert className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-[#0F172A]">Super Admin Privilege Required</h2>
            <p className="text-xs text-[#64748B]">
              Your account role (<code className="text-rose-600 font-mono font-semibold">{profile?.role || 'OPERATOR'}</code>) is restricted to tenant operations and does not possess multi-tenant platform authority.
            </p>
          </div>
          <div className="pt-2 flex flex-col sm:flex-row gap-2.5 justify-center">
            <button
              onClick={() => router.push('/dashboard')}
              className="btn-primary text-xs"
            >
              Return to Operator CRM
            </button>
            <button
              onClick={() => redirectToLogin()}
              className="btn-secondary text-xs"
            >
              Log Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const sidebarContent = (isMobile: boolean) => (
    <div className="flex flex-col h-full bg-[#24102F] text-[#E9D5FF] border-r border-[#3A1948]">
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-5 border-b border-[#3A1948] shrink-0 bg-[#24102F]">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-[#FF6B35] to-[#E85A2A] flex items-center justify-center text-white font-bold shadow-md shadow-orange-500/25">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <div className="font-bold text-white text-sm tracking-tight flex items-center gap-1.5">
              ISPCRM <span className="px-1.5 py-0.2 text-[10px] font-mono font-semibold rounded bg-[#3A1948] text-[#E9D5FF] border border-[#5B2A86]/40">HQ</span>
            </div>
            <div className="text-[11px] text-[#C4B5FD] font-medium">SaaS Platform Operator</div>
          </div>
        </div>

        {isMobile && (
          <button
            type="button"
            onClick={() => setIsMobileNavOpen(false)}
            className="p-1.5 text-[#C4B5FD] hover:text-white rounded-lg hover:bg-[#3A1948]"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <div className="flex-1 px-3 py-4 space-y-6 overflow-y-auto">
        <div>
          <div className="px-3 mb-2 text-[10px] uppercase tracking-wider text-[#A855F7] font-bold">
            Platform Core
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={isMobile ? () => setIsMobileNavOpen(false) : undefined}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all min-h-[40px] ${
                    isActive
                      ? 'bg-[#FF6B35] text-white shadow-md shadow-orange-500/25'
                      : 'text-[#C4B5FD] hover:text-white hover:bg-[#3A1948]'
                  }`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-white' : 'text-[#C4B5FD]'}`} />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div>
          <div className="px-3 mb-2 text-[10px] uppercase tracking-wider text-[#A855F7] font-bold">
            Future Modules (Phase 6B+)
          </div>
          <div className="space-y-1">
            {futurePlaceholders.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.name}
                  className="flex items-center justify-between px-3 py-2 rounded-xl text-xs text-[#C4B5FD]/60 cursor-not-allowed opacity-70"
                  title="Coming in upcoming commercialization phases"
                >
                  <div className="flex items-center gap-3">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.name}</span>
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#3A1948] text-[#C4B5FD]">
                    Soon
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tenant CRM Switcher link */}
      <div className="p-3 border-t border-[#3A1948] shrink-0 bg-[#24102F]">
        <Link
          href="/dashboard"
          className="flex items-center justify-between p-2.5 rounded-xl bg-[#1C0C25]/90 border border-[#3A1948] hover:border-[#FF6B35]/40 text-xs font-medium text-[#E9D5FF] transition-colors group"
        >
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-[#FF6B35]" />
            <span>Switch to Tenant CRM</span>
          </div>
          <ExternalLink className="h-3.5 w-3.5 text-[#C4B5FD] group-hover:text-[#FF6B35]" />
        </Link>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen w-full bg-[#F5F6F8] text-[#0F172A] overflow-x-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 flex-col h-screen shrink-0 sticky top-0 z-30 shadow-xl">
        {sidebarContent(false)}
      </aside>

      {/* Mobile Drawer */}
      {isMobileNavOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden animate-fadeIn"
            onClick={() => setIsMobileNavOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] flex flex-col h-full shadow-2xl lg:hidden">
            {sidebarContent(true)}
          </aside>
        </>
      )}

      <div className="flex-1 flex flex-col min-w-0 w-full">
        {/* Top Header */}
        <header className="h-16 border-b border-[#E2E8F0] bg-white px-3 sm:px-6 flex items-center justify-between sticky top-0 z-20 w-full shadow-sm">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsMobileNavOpen(true)}
              className="lg:hidden p-2 text-[#475569] hover:text-[#0F172A] rounded-lg hover:bg-[#F1F5F9] min-h-[40px] min-w-[40px] flex items-center justify-center"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-[#FFF7ED] text-[#FF6B35] border border-[#FED7AA] font-bold">
                SUPER ADMIN
              </span>
              <span className="text-xs text-[#64748B] hidden md:inline-block font-medium">
                Multi-Tenant SaaS Operator Engine
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Theme Selector */}
            <div className="relative" ref={themeDropdownRef}>
              <button
                type="button"
                onClick={() => setIsThemeDropdownOpen((prev) => !prev)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] text-[#334155] text-xs font-semibold transition-colors"
              >
                {theme === 'light' ? (
                  <Sun className="h-3.5 w-3.5 text-[#FF6B35]" />
                ) : theme === 'colorful' ? (
                  <Palette className="h-3.5 w-3.5 text-[#8B5CF6]" />
                ) : (
                  <Moon className="h-3.5 w-3.5 text-[#3B82F6]" />
                )}
                <span className="capitalize">{theme}</span>
                <ChevronDown className="h-3 w-3 text-[#94A3B8]" />
              </button>

              {isThemeDropdownOpen && (
                <div className="absolute right-0 mt-2 w-36 rounded-xl bg-white border border-[#E2E8F0] shadow-xl py-1 z-50 animate-fadeIn">
                  {(['light', 'dark', 'colorful'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setTheme(t);
                        setIsThemeDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between transition-colors ${
                        theme === t ? 'text-[#FF6B35] font-semibold bg-[#FFF7ED]' : 'text-[#334155] hover:bg-[#F8FAFC]'
                      }`}
                    >
                      <span className="capitalize">{t}</span>
                      {theme === t && <Check className="h-3 w-3" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Operator Info */}
            <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-[#E2E8F0]">
              <div className="text-right">
                <div className="text-xs font-bold text-[#0F172A]">{profile?.name}</div>
                <div className="text-[10px] font-mono text-[#64748B]">SUPER_ADMIN</div>
              </div>
            </div>

            {/* Logout */}
            <button
              onClick={() => redirectToLogin()}
              className="p-2 text-[#94A3B8] hover:text-[#DC2626] rounded-lg hover:bg-[#FFF1F2] transition-colors"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-3 sm:p-5 md:p-8 overflow-y-auto w-full min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
