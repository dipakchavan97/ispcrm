'use client';

import React from 'react';
import Link from 'next/link';
import { LucideIcon, ArrowRight } from 'lucide-react';

export type MetricCardVariant = 'plum' | 'blue' | 'gold' | 'red' | 'green' | 'purple' | 'orange' | 'amber' | 'default';

interface MetricCardProps {
  title: string;
  value: string;
  change?: string;
  isPositive?: boolean;
  icon: LucideIcon;
  iconColor?: string;
  variant?: MetricCardVariant;
  href?: string;
}

export function MetricCard({
  title,
  value,
  change,
  isPositive = true,
  icon: Icon,
  iconColor = 'text-blue-500',
  variant = 'default',
  href,
}: MetricCardProps) {
  // If a colorful variant is selected, render reference-style vibrant card
  if (variant && variant !== 'default') {
    const variantClasses: Record<MetricCardVariant, string> = {
      plum: 'kpi-card-plum',
      blue: 'kpi-card-blue',
      gold: 'kpi-card-gold',
      red: 'kpi-card-red',
      green: 'kpi-card-green',
      purple: 'kpi-card-purple',
      orange: 'kpi-card-orange',
      amber: 'kpi-card-amber',
      default: '',
    };

    const cardContent = (
      <div className={`kpi-card ${variantClasses[variant]} group cursor-pointer transition-all duration-200`}>
        {/* Semi-transparent Watermark Icon */}
        <div className="kpi-watermark">
          <Icon className="h-16 w-16 text-white" />
        </div>

        {/* Top Info */}
        <div className="relative z-10">
          <div className="kpi-value">{value}</div>
          <div className="kpi-label">{title}</div>
          {change && (
            <div className="text-[11px] text-white/80 font-medium mt-1 truncate">
              {change}
            </div>
          )}
        </div>

        {/* Footer: More info (Reference-Inspired) */}
        <div className="kpi-footer relative z-10">
          <span className="font-semibold text-[11px]">More info</span>
          <div className="h-4 w-4 rounded-full bg-white/20 flex items-center justify-center group-hover:bg-white/30 transition-colors">
            <ArrowRight className="h-2.5 w-2.5 text-white" />
          </div>
        </div>
      </div>
    );

    if (href) {
      return <Link href={href} className="block">{cardContent}</Link>;
    }
    return cardContent;
  }

  // Default clean white SaaS card
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 hover:border-[#CBD5E1] transition-all shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[#64748B] uppercase tracking-wider">{title}</span>
        <div className={`p-2 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] ${iconColor}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl font-bold tracking-tight text-[#0F172A]">{value}</span>
        {change && (
          <span
            className={`text-xs font-semibold ${
              isPositive ? 'text-[#16A34A]' : 'text-[#DC2626]'
            }`}
          >
            {change}
          </span>
        )}
      </div>
    </div>
  );
}
