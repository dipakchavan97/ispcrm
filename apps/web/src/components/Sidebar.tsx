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
  IndianRupee,
  Router,
  Activity,
  LifeBuoy,
  FileBarChart,
  Settings,
  ShieldCheck,
  X,
  MapPin,
} from 'lucide-react';

const navigationItems = [
  { name: 'Dashboard', icon: LayoutDashboard, href: '/dashboard', aliases: ['/'] },
  { name: 'Customers', icon: Users, href: '/customers' },
  { name: 'Zones & Nodes', icon: MapPin, href: '/zones' },
  { name: 'Plans', icon: Wifi, href: '/plans' },
  { name: 'Subscriptions', icon: CreditCard, href: '/subscriptions' },
  { name: 'Invoices', icon: Receipt, href: '/invoices' },
  { name: 'Payments', icon: IndianRupee, href: '/payments' },
  { name: 'Routers', icon: Router, href: '/routers' },
  { name: 'Network', icon: Activity, href: '/network' },
  { name: 'Tickets', icon: LifeBuoy, href: '/tickets' },
  { name: 'Reports', icon: FileBarChart, href: '/reports' },
  { name: 'Settings', icon: Settings, href: '/settings' },
];

interface SidebarProps {
  isMobileOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ isMobileOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname();

  const sidebarContent = (isMobile: boolean) => (
    <div className="flex flex-col h-full">
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-5 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold shadow-lg shadow-blue-500/30">
            ISP
          </div>
          <div>
            <div className="font-semibold text-slate-100 text-sm tracking-tight">SpeedNet CRM</div>
            <div className="text-xs text-blue-400 font-mono">Carrier Platform</div>
          </div>
        </div>

        {isMobile && (
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center"
            aria-label="Close navigation menu"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || item.aliases?.includes(pathname);

          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={isMobile ? onClose : undefined}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[42px] ${
                isActive
                  ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-blue-400' : 'text-slate-400'}`} />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* Tenant Indicator */}
      <div className="p-4 border-t border-slate-800 shrink-0">
        <div className="bg-slate-900/90 rounded-lg p-3 border border-slate-800 flex items-center gap-2.5">
          <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-200 truncate">SpeedNet Broadband</p>
            <p className="text-[10px] text-slate-400">GST: 27AAAAA0000A1Z5</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar (lg+) */}
      <aside className="hidden lg:flex w-64 bg-[#0f172a] border-r border-slate-800 flex-col h-screen shrink-0 sticky top-0">
        {sidebarContent(false)}
      </aside>

      {/* Mobile Drawer & Backdrop (< lg) */}
      {isMobileOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-sm z-40 lg:hidden animate-fadeIn"
            onClick={onClose}
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-[#0f172a] border-r border-slate-800 flex flex-col h-full shadow-2xl lg:hidden">
            {sidebarContent(true)}
          </aside>
        </>
      )}
    </>
  );
}
