'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  Search,
  Activity,
  UserCircle,
  LogOut,
  Building2,
  Menu,
  Sun,
  Moon,
  Palette,
  ChevronDown,
  Check,
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

    if (isThemeDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isThemeDropdownOpen]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTerm.trim()) {
      router.push(`/customers?search=${encodeURIComponent(searchTerm.trim())}`);
    }
  };

  const handleLogout = () => {
    redirectToLogin();
  };

  return (
    <header className="h-16 border-b border-slate-800 bg-[#0f172a]/80 backdrop-blur px-3 sm:px-6 flex items-center justify-between sticky top-0 z-20 w-full min-w-0">
      <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0 pr-2">
        {/* Mobile Hamburger Menu Button */}
        <button
          type="button"
          onClick={onToggleMobileNav}
          className="lg:hidden p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center shrink-0 cursor-pointer"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <form onSubmit={handleSearch} className="flex-1 max-w-[200px] sm:max-w-xs md:max-w-sm min-w-0">
          <div className="relative w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search subscribers..."
              className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 min-h-[36px]"
            />
          </div>
        </form>
      </div>

      <div className="flex items-center gap-2 sm:gap-4 shrink-0">
        {/* Accessible Theme Switcher Control (Replaces RADIUS / Business Name Area) */}
        <div className="relative" ref={themeDropdownRef}>
          <button
            type="button"
            onClick={() => setIsThemeDropdownOpen(!isThemeDropdownOpen)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs font-medium text-slate-200 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer min-h-[40px] min-w-[40px] focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            aria-label="Toggle theme selection"
            aria-expanded={isThemeDropdownOpen}
            aria-haspopup="true"
          >
            {theme === 'dark' && <Moon className="h-4 w-4 text-blue-400 shrink-0" />}
            {theme === 'light' && <Sun className="h-4 w-4 text-amber-500 shrink-0" />}
            {theme === 'colorful' && <Palette className="h-4 w-4 text-purple-400 shrink-0" />}
            <span className="hidden sm:inline capitalize font-semibold">{theme}</span>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          </button>

          {isThemeDropdownOpen && (
            <div
              role="menu"
              aria-orientation="vertical"
              className="absolute right-0 mt-2 w-40 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl py-1.5 z-50 animate-in fade-in slide-in-from-top-2 duration-150"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setTheme('dark');
                  setIsThemeDropdownOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 text-xs transition-colors hover:bg-slate-800 min-h-[40px] cursor-pointer ${
                  theme === 'dark' ? 'text-blue-400 font-semibold bg-blue-500/10' : 'text-slate-300'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Moon className="h-4 w-4 text-blue-400" />
                  <span>Dark</span>
                </div>
                {theme === 'dark' && <Check className="h-3.5 w-3.5" />}
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setTheme('light');
                  setIsThemeDropdownOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 text-xs transition-colors hover:bg-slate-800 min-h-[40px] cursor-pointer ${
                  theme === 'light' ? 'text-amber-500 font-semibold bg-amber-500/10' : 'text-slate-300'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Sun className="h-4 w-4 text-amber-500" />
                  <span>Light</span>
                </div>
                {theme === 'light' && <Check className="h-3.5 w-3.5" />}
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setTheme('colorful');
                  setIsThemeDropdownOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 text-xs transition-colors hover:bg-slate-800 min-h-[40px] cursor-pointer ${
                  theme === 'colorful' ? 'text-purple-400 font-semibold bg-purple-500/10' : 'text-slate-300'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Palette className="h-4 w-4 text-purple-400" />
                  <span>Colorful</span>
                </div>
                {theme === 'colorful' && <Check className="h-3.5 w-3.5" />}
              </button>
            </div>
          )}
        </div>

        {/* Notifications Icon */}
        <button
          type="button"
          title="Notifications"
          aria-label="Notifications"
          className="h-9 w-9 rounded-lg bg-slate-800 border border-slate-700/60 flex items-center justify-center text-slate-400 hover:text-slate-200 transition-colors shrink-0"
        >
          <Bell className="h-4 w-4" />
        </button>

        {/* User Profile & Logout */}
        <div className="flex items-center gap-2 sm:gap-3 pl-2 sm:pl-3 border-l border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <UserCircle className="h-7 w-7 text-blue-400 shrink-0" />
            <div className="text-left hidden sm:block">
              <div className="text-xs font-semibold text-slate-200 leading-tight truncate max-w-[120px]">
                {profile?.name || 'Operator Admin'}
              </div>
              <div className="text-[10px] text-blue-400 font-mono leading-tight">
                {profile?.role || 'ISP_ADMIN'}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowLogoutConfirm(true)}
            title="Sign out of console"
            aria-label="Sign out of console"
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer shrink-0"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Logout Confirmation Dialog */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <h3 className="text-base font-semibold text-white">Sign Out Confirmation</h3>
            <p className="text-xs text-slate-400">
              Are you sure you want to end your current session? You will need to re-authenticate with your operator credentials to access the console.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white transition-colors cursor-pointer shadow-lg shadow-rose-600/30"
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
