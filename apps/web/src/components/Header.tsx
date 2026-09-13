'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Search, Activity, UserCircle, LogOut, Building2 } from 'lucide-react';
import { apiFetch, redirectToLogin } from '../lib/api';

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

export function Header() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

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
    <header className="h-16 border-b border-slate-800 bg-[#0f172a]/80 backdrop-blur px-6 flex items-center justify-between sticky top-0 z-20">
      <form onSubmit={handleSearch} className="flex items-center gap-3 w-80 md:w-96">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search subscribers, PPPoE username, IP, phone..."
            className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </form>

      <div className="flex items-center gap-4">
        {/* ISP Organization Badge */}
        <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300">
          <Building2 className="h-3.5 w-3.5 text-blue-400" />
          <span className="font-semibold text-slate-200 truncate max-w-[150px]">
            {profile?.organization?.name || 'SpeedNet Telecom'}
          </span>
        </div>

        {/* FreeRADIUS Status Pill */}
        <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-950/40 border border-emerald-800/40 text-emerald-400 text-xs font-medium">
          <Activity className="h-3.5 w-3.5 animate-pulse" />
          <span className="hidden sm:inline">RADIUS:</span>
          <span>Online</span>
        </div>

        {/* Notifications Icon */}
        <button
          title="Notifications"
          className="h-8 w-8 rounded-lg bg-slate-800 border border-slate-700/60 flex items-center justify-center text-slate-400 hover:text-slate-200 transition-colors"
        >
          <Bell className="h-4 w-4" />
        </button>

        {/* User Profile & Logout */}
        <div className="flex items-center gap-3 pl-3 border-l border-slate-800">
          <div className="flex items-center gap-2">
            <UserCircle className="h-7 w-7 text-blue-400" />
            <div className="text-left hidden sm:block">
              <div className="text-xs font-semibold text-slate-200 leading-tight">
                {profile?.name || 'Operator Admin'}
              </div>
              <div className="text-[10px] text-blue-400 font-mono leading-tight">
                {profile?.role || 'ISP_ADMIN'}
              </div>
            </div>
          </div>

          <button
            onClick={() => setShowLogoutConfirm(true)}
            title="Sign out of console"
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
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
