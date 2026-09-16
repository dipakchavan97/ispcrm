'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Bell,
  Search,
  Activity,
  UserCircle,
  LogOut,
  Menu,
  Sun,
  Moon,
  Palette,
  ChevronDown,
  Check,
  RefreshCw,
  Printer,
  LayoutDashboard,
  Users,
  MapPin,
  Wifi,
  CreditCard,
  Receipt,
  IndianRupee,
  Router,
  LifeBuoy,
  FileBarChart,
  Settings,
} from 'lucide-react';
import { apiFetch, redirectToLogin } from '../lib/api';
import { useTheme } from '../lib/theme-provider';

interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  organization?: {
    id: string;
    name: string;
    slug: string;
    email: string;
    gstin?: string;
  };
}

interface HeaderProps {
  onToggleMobileNav?: () => void;
}

export function Header({ onToggleMobileNav }: HeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [searchTerm, setSearchTerm] = useState('');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isThemeDropdownOpen, setIsThemeDropdownOpen] = useState(false);
  const themeDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isMounted = true;
    apiFetch<UserProfile>('/auth/me')
      .then((data) => {
        if (isMounted && data) {
          setProfile(data);
        }
      })
      .catch(() => {
        // Silently handled by apiFetch or session redirect
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // Close theme dropdown when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (themeDropdownRef.current && !themeDropdownRef.current.contains(event.target as Node)) {
        setIsThemeDropdownOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsThemeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTerm.trim()) {
      router.push(`/customers?search=${encodeURIComponent(searchTerm.trim())}`);
    }
  };

  const handleLogout = () => {
    redirectToLogin();
  };

  const getPageInfo = () => {
    if (pathname.startsWith('/customers')) return { title: 'Customers', icon: Users, crumb: 'Customers' };
    if (pathname.startsWith('/zones')) return { title: 'Zones & Nodes', icon: MapPin, crumb: 'Zones & Nodes' };
    if (pathname.startsWith('/plans')) return { title: 'Internet Packages', icon: Wifi, crumb: 'Plans' };
    if (pathname.startsWith('/subscriptions')) return { title: 'Subscriptions', icon: CreditCard, crumb: 'Subscriptions' };
    if (pathname.startsWith('/invoices')) return { title: 'Billing Invoices', icon: Receipt, crumb: 'Invoices' };
    if (pathname.startsWith('/payments')) return { title: 'Subscriber Payments', icon: IndianRupee, crumb: 'Payments' };
    if (pathname.startsWith('/routers')) return { title: 'MikroTik Fleet', icon: Router, crumb: 'Routers' };
    if (pathname.startsWith('/network')) return { title: 'Network Telemetry', icon: Activity, crumb: 'Network' };
    if (pathname.startsWith('/tickets')) return { title: 'Support Tickets', icon: LifeBuoy, crumb: 'Tickets' };
    if (pathname.startsWith('/reports')) return { title: 'Carrier Reports', icon: FileBarChart, crumb: 'Reports' };
    if (pathname.startsWith('/settings')) return { title: 'System Settings', icon: Settings, crumb: 'Settings' };
    return { title: 'Dashboard', icon: LayoutDashboard, crumb: 'Dashboard' };
  };

  const pageInfo = getPageInfo();
  const PageIcon = pageInfo.icon;

  const firstName = profile?.name ? profile.name.split(' ')[0] : 'admin';

  return (
    <header className="h-16 border-b border-[#E2E8F0] bg-white px-3 sm:px-6 flex items-center justify-between sticky top-0 z-20 w-full min-w-0 shadow-sm">
      {/* Left: Hamburger & Breadcrumb Title */}
      <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0 pr-2">
        {/* Mobile Hamburger Menu Button */}
        <button
          type="button"
          onClick={onToggleMobileNav}
          className="lg:hidden p-2 text-[#475569] hover:text-[#0F172A] rounded-lg hover:bg-[#F1F5F9] transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center shrink-0 cursor-pointer"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Page Title & Breadcrumbs (Reference-Inspired) */}
        <div className="hidden sm:flex flex-col justify-center">
          <div className="flex items-center gap-2">
            <PageIcon className="h-4 w-4 text-[#FF6B35]" />
            <h1 className="text-sm sm:text-base font-bold text-[#0F172A] tracking-tight leading-none">
              {pageInfo.title}
            </h1>
          </div>
          <div className="text-[11px] text-[#64748B] flex items-center gap-1 mt-0.5 font-medium">
            <span>Home</span>
            <span>&gt;</span>
            <span className="text-[#0F172A] font-semibold">{pageInfo.crumb}</span>
          </div>
        </div>

        {/* Global Search */}
        <form onSubmit={handleSearch} className="flex-1 max-w-[200px] sm:max-w-xs md:max-w-sm min-w-0 sm:ml-4">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#94A3B8]" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search everything..."
              className="w-full bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl pl-9 pr-3 py-1.5 text-xs text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:border-[#FF6B35] focus:bg-white min-h-[36px] transition-colors"
            />
          </div>
        </form>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Refresh Quick Action */}
        <button
          type="button"
          onClick={() => router.refresh()}
          className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#E2E8F0] text-xs font-semibold text-[#334155] hover:bg-[#F8FAFC] hover:text-[#0F172A] transition-colors min-h-[36px]"
          title="Refresh Current Page"
        >
          <RefreshCw className="h-3.5 w-3.5 text-[#64748B]" />
          <span>Refresh</span>
        </button>

        {/* Theme Switcher Control */}
        <div className="relative" ref={themeDropdownRef}>
          <button
            type="button"
            onClick={() => setIsThemeDropdownOpen(!isThemeDropdownOpen)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-[#E2E8F0] text-xs font-semibold text-[#334155] hover:bg-[#F8FAFC] hover:text-[#0F172A] transition-colors cursor-pointer min-h-[36px] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]/30"
            aria-label="Toggle theme selection"
            aria-expanded={isThemeDropdownOpen}
            aria-haspopup="true"
          >
            {theme === 'light' && <Sun className="h-3.5 w-3.5 text-[#FF6B35] shrink-0" />}
            {theme === 'dark' && <Moon className="h-3.5 w-3.5 text-[#3B82F6] shrink-0" />}
            {theme === 'colorful' && <Palette className="h-3.5 w-3.5 text-[#8B5CF6] shrink-0" />}
            <span className="hidden sm:inline capitalize">{theme}</span>
            <ChevronDown className="h-3 w-3 text-[#94A3B8] shrink-0" />
          </button>

          {isThemeDropdownOpen && (
            <div
              role="menu"
              aria-orientation="vertical"
              className="absolute right-0 mt-2 w-40 rounded-xl bg-white border border-[#E2E8F0] shadow-xl py-1.5 z-50 animate-in fade-in slide-in-from-top-2 duration-150"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setTheme('light');
                  setIsThemeDropdownOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3.5 py-2 text-xs transition-colors hover:bg-[#F8FAFC] min-h-[36px] cursor-pointer ${
                  theme === 'light' ? 'text-[#FF6B35] font-semibold bg-[#FFF7ED]' : 'text-[#334155]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Sun className="h-3.5 w-3.5 text-[#FF6B35]" />
                  <span>Light (Default)</span>
                </div>
                {theme === 'light' && <Check className="h-3.5 w-3.5" />}
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setTheme('dark');
                  setIsThemeDropdownOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3.5 py-2 text-xs transition-colors hover:bg-[#F8FAFC] min-h-[36px] cursor-pointer ${
                  theme === 'dark' ? 'text-[#3B82F6] font-semibold bg-[#EFF6FF]' : 'text-[#334155]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Moon className="h-3.5 w-3.5 text-[#3B82F6]" />
                  <span>Dark</span>
                </div>
                {theme === 'dark' && <Check className="h-3.5 w-3.5" />}
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setTheme('colorful');
                  setIsThemeDropdownOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3.5 py-2 text-xs transition-colors hover:bg-[#F8FAFC] min-h-[36px] cursor-pointer ${
                  theme === 'colorful' ? 'text-[#8B5CF6] font-semibold bg-[#FAF5FF]' : 'text-[#334155]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Palette className="h-3.5 w-3.5 text-[#8B5CF6]" />
                  <span>Colorful</span>
                </div>
                {theme === 'colorful' && <Check className="h-3.5 w-3.5" />}
              </button>
            </div>
          )}
        </div>

        {/* Notifications Icon with Red Badge (Reference-Inspired) */}
        <button
          type="button"
          title="Notifications"
          aria-label="Notifications"
          className="relative h-9 w-9 rounded-xl bg-white border border-[#E2E8F0] flex items-center justify-center text-[#64748B] hover:text-[#0F172A] hover:bg-[#F8FAFC] transition-colors shrink-0"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 rounded-full bg-[#DC2626] text-white text-[10px] font-bold flex items-center justify-center shadow-sm">
            19
          </span>
        </button>

        {/* User Greeting & Avatar (Reference-Inspired) */}
        <div className="flex items-center gap-2 sm:gap-3 pl-2 border-l border-[#E2E8F0]">
          <div className="text-right hidden sm:block">
            <div className="text-xs font-bold text-[#0F172A] leading-tight">
              Welcome, {firstName}
            </div>
            <div className="text-[10px] text-[#64748B] font-medium leading-tight">
              {profile?.role === 'ISP_OWNER' ? 'Admin' : profile?.role || 'Operator'}
            </div>
          </div>

          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[#24102F] to-[#5B2A86] text-white font-bold text-xs flex items-center justify-center shadow-md">
            {profile?.name ? profile.name.charAt(0).toUpperCase() : 'A'}
          </div>

          <button
            type="button"
            onClick={() => setShowLogoutConfirm(true)}
            title="Sign out"
            aria-label="Sign out"
            className="p-1.5 rounded-lg text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#FFF1F2] transition-colors cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Logout Confirmation Dialog */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4 animate-fadeIn">
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 sm:p-6 max-w-sm w-full shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto">
            <h3 className="text-base font-bold text-[#0F172A]">Sign Out Confirmation</h3>
            <p className="text-xs text-[#64748B] leading-relaxed">
              Are you sure you want to end your current session? You will need to re-authenticate with your operator credentials to access the console.
            </p>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="btn-secondary text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="btn-danger text-xs"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
