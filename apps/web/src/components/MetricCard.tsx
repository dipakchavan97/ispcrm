'use client';

import React from 'react';
import { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string;
  change?: string;
  isPositive?: boolean;
  icon: LucideIcon;
  iconColor?: string;
}

export function MetricCard({
  title,
  value,
  change,
  isPositive = true,
  icon: Icon,
  iconColor = 'text-blue-500',
}: MetricCardProps) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700/80 transition-colors shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-400">{title}</span>
        <div className={`p-2 rounded-lg bg-slate-800/80 ${iconColor}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl font-bold tracking-tight text-slate-100">{value}</span>
        {change && (
          <span
            className={`text-xs font-medium ${
              isPositive ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {change}
          </span>
        )}
      </div>
    </div>
  );
}
