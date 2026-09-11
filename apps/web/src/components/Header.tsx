'use client';

import React from 'react';
import { Bell, Search, Activity, UserCircle } from 'lucide-react';

export function Header() {
  return (
    <header className="h-16 border-b border-slate-800 bg-[#0f172a]/70 backdrop-blur px-6 flex items-center justify-between sticky top-0 z-10">
      <div className="flex items-center gap-3 w-96">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search subscribers, PPPoE username, IP, phone..."
            className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-950/40 border border-emerald-800/40 text-emerald-400 text-xs font-medium">
          <Activity className="h-3.5 w-3.5 animate-pulse" />
          <span>FreeRADIUS: Online</span>
        </div>

        <button className="h-8 w-8 rounded-lg bg-slate-800 border border-slate-700/60 flex items-center justify-center text-slate-400 hover:text-slate-200 transition-colors">
          <Bell className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2.5 pl-2 border-l border-slate-800">
          <UserCircle className="h-7 w-7 text-slate-400" />
          <div className="text-left">
            <div className="text-xs font-semibold text-slate-200">Admin User</div>
            <div className="text-[10px] text-slate-400">Org Administrator</div>
          </div>
        </div>
      </div>
    </header>
  );
}
