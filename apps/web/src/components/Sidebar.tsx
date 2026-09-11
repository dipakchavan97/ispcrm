'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Wifi,
  CreditCard,
  Receipt,
  Router,
  Radio,
  History,
  Settings,
  ShieldCheck,
} from 'lucide-react';

const navigationItems = [
  { name: 'Dashboard', icon: LayoutDashboard, href: '/' },
  { name: 'Customers', icon: Users, href: '/customers' },
  { name: 'Internet Plans', icon: Wifi, href: '/plans' },
  { name: 'Subscriptions', icon: CreditCard, href: '/subscriptions' },
  { name: 'Invoices (GST)', icon: Receipt, href: '/invoices' },
  { name: 'MikroTik Routers', icon: Router, href: '/routers' },
  { name: 'RADIUS Sessions', icon: Radio, href: '/radius' },
  { name: 'Audit Logs', icon: History, href: '/audit' },
  { name: 'Settings', icon: Settings, href: '/settings' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-[#0f172a] border-r border-slate-800 flex flex-col h-screen shrink-0">
      {/* Brand Header */}
      <div className="h-16 flex items-center px-6 border-b border-slate-800 gap-3">
        <div className="h-9 w-9 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold shadow-lg shadow-blue-500/30">
          ISP
        </div>
        <div>
          <div className="font-semibold text-slate-100 text-sm tracking-tight">SpeedNet CRM</div>
          <div className="text-xs text-blue-400 font-mono">Multi-Tenant SaaS</div>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive ? 'text-blue-400' : 'text-slate-400'}`} />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* Tenant Indicator */}
      <div className="p-4 border-t border-slate-800">
        <div className="bg-slate-900/90 rounded-lg p-3 border border-slate-800 flex items-center gap-2.5">
          <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-200 truncate">SpeedNet Broadband</p>
            <p className="text-[10px] text-slate-400">GST: 27AAAAA0000A1Z5</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
