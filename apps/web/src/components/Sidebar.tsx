'use client';

import React, { useState, useEffect } from 'react';
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
  KeyRound,
  Radio,
  User,
  ChevronLeft,
} from 'lucide-react';
import { apiFetch } from '../lib/api';

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

const navigationSections = [
  {
    category: 'GENERAL',
    items: [
      { name: 'Dashboard', icon: LayoutDashboard, href: '/dashboard', aliases: ['/'] },
    ],
  },
  {
    category: 'CUSTOMER MANAGEMENT',
    items: [
      { name: 'Customers', icon: Users, href: '/customers' },
      { name: 'Zones & Nodes', icon: MapPin, href: '/zones' },
      { name: 'Plans', icon: Wifi, href: '/plans' },
      { name: 'Subscriptions', icon: CreditCard, href: '/subscriptions' },
    ],
  },
  {
    category: 'BILLING',
    items: [
      { name: 'Invoices', icon: Receipt, href: '/invoices' },
      { name: 'Payments', icon: IndianRupee, href: '/payments' },
    ],
  },
  {
    category: 'NETWORK',
    items: [
      { name: 'Routers', icon: Router, href: '/routers' },
      { name: 'Network', icon: Activity, href: '/network' },
      { name: 'Access Requests', icon: KeyRound, href: '/network/access-requests' },
    ],
  },
  {
    category: 'SUPPORT',
    items: [
      { name: 'Tickets', icon: LifeBuoy, href: '/tickets' },
    ],
  },
  {
    category: 'INSIGHTS',
    items: [
      { name: 'Reports', icon: FileBarChart, href: '/reports' },
    ],
  },
  {
    category: 'SYSTEM',
    items: [
      { name: 'Settings', icon: Settings, href: '/settings' },
    ],
  },
];

interface SidebarProps {
  isMobileOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ isMobileOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    let isMounted = true;
    apiFetch<UserProfile>('/auth/me')
      .then((data) => {
        if (isMounted && data) {
          setProfile(data);
        }
      })
      .catch(() => {
        // Silently handled
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const getInitials = (name?: string) => {
    if (!name) return 'OP';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const sidebarContent = (isMobile: boolean) => (
    <div className="flex flex-col h-full bg-[#24102F] text-[#E9D5FF] select-none">
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-[#3A1948] shrink-0 bg-[#24102F]">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-[#FF6B35] to-[#E85A2A] flex items-center justify-center text-white font-bold shadow-md shadow-orange-500/20 text-sm tracking-wider">
            ISP
          </div>
          <div>
            <div className="font-bold text-white text-base tracking-tight leading-none">ISPCRM</div>
            <div className="text-[11px] text-[#C4B5FD] font-medium tracking-wide mt-1">Carrier Platform</div>
          </div>
        </div>

        {isMobile ? (
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[#C4B5FD] hover:text-white rounded-lg hover:bg-[#3A1948] transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
            aria-label="Close navigation menu"
          >
            <X className="h-5 w-5" />
          </button>
        ) : (
          <button
            type="button"
            className="p-1 text-[#A855F7] hover:text-white rounded-lg hover:bg-[#3A1948] transition-colors"
            title="Sidebar Menu"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Operator / User Profile Card (Reference-Inspired) */}
      <div className="px-3.5 pt-3 pb-2 shrink-0">
        <div className="bg-[#1C0C25]/90 border border-[#3A1948] rounded-xl p-3 flex flex-col items-center justify-center text-center shadow-inner">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#3A1948] to-[#5B2A86] border border-[#7C3AED]/40 flex items-center justify-center text-white font-bold text-sm shadow-md mb-2">
            {getInitials(profile?.name)}
          </div>
          <div className="font-semibold text-white text-xs truncate max-w-[190px]">
            {profile?.name || 'Dipak Operator'}
          </div>
          <div className="mt-1">
            <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wide bg-[#3A1948] text-[#E9D5FF] border border-[#5B2A86]/40">
              {profile?.role === 'ISP_OWNER' ? 'Admin' : profile?.role || 'Operator'}
            </span>
          </div>
        </div>
      </div>

      {/* Navigation Sections */}
      <nav className="flex-1 px-3 py-2 space-y-4 overflow-y-auto custom-scrollbar">
        {navigationSections.map((section) => (
          <div key={section.category} className="space-y-1">
            <div className="px-3 text-[10px] font-bold tracking-wider text-[#A855F7] uppercase pb-1">
              {section.category}
            </div>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href || (item as any).aliases?.includes(pathname);

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={isMobile ? onClose : undefined}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all min-h-[38px] ${
                      isActive
                        ? 'bg-[#FF6B35] text-white font-semibold shadow-md shadow-orange-500/25'
                        : 'text-[#C4B5FD] hover:text-white hover:bg-[#3A1948]'
                    }`}
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-white' : 'text-[#C4B5FD]'}`} />
                    <span className="truncate">{item.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Tenant Indicator / Footer */}
      <div className="p-3 border-t border-[#3A1948] shrink-0 bg-[#24102F]">
        <div className="bg-[#1C0C25]/90 rounded-lg p-2.5 border border-[#3A1948] flex items-center gap-2.5">
          <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white truncate">
              {profile?.organization?.name || 'Spacecom Telecom'}
            </p>
            <p className="text-[10px] text-[#A855F7] truncate">
              GST: {profile?.organization?.gstin || '27ABCDE1234F1Z5'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar (lg+) */}
      <aside className="hidden lg:flex w-64 bg-[#24102F] border-r border-[#3A1948] flex-col h-screen shrink-0 sticky top-0 z-30 shadow-xl">
        {sidebarContent(false)}
      </aside>

      {/* Mobile Drawer & Backdrop (< lg) */}
      {isMobileOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden animate-fadeIn"
            onClick={onClose}
            aria-hidden="true"
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-[#24102F] border-r border-[#3A1948] flex flex-col h-full shadow-2xl lg:hidden">
            {sidebarContent(true)}
          </aside>
        </>
      )}
    </>
  );
}
