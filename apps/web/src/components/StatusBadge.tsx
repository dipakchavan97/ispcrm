'use client';

import React from 'react';

interface StatusBadgeProps {
  status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'PAID' | 'UNPAID' | 'ONLINE' | 'OFFLINE' | string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const normalized = status.toUpperCase();

  let styles = 'bg-slate-800 text-slate-300 border-slate-700';

  if (normalized === 'ACTIVE' || normalized === 'PAID' || normalized === 'ONLINE' || normalized === 'SUCCESS' || normalized === 'RESOLVED') {
    styles = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  } else if (normalized === 'LEAD' || normalized === 'ISSUED' || normalized === 'OPEN') {
    styles = 'bg-sky-500/10 text-sky-400 border-sky-500/30';
  } else if (normalized === 'PENDING' || normalized === 'PARTIALLY_PAID' || normalized === 'MEDIUM') {
    styles = 'bg-amber-500/10 text-amber-400 border-amber-500/30';
  } else if (normalized === 'IN_PROGRESS' || normalized === 'GRACE' || normalized === 'HIGH') {
    styles = 'bg-purple-500/10 text-purple-400 border-purple-500/30';
  } else if (normalized === 'SUSPENDED' || normalized === 'UNPAID' || normalized === 'OFFLINE' || normalized === 'OVERDUE' || normalized === 'FAILED' || normalized === 'URGENT') {
    styles = 'bg-rose-500/10 text-rose-400 border-rose-500/20';
  } else if (normalized === 'EXPIRED' || normalized === 'REFUNDED') {
    styles = 'bg-orange-500/10 text-orange-400 border-orange-500/20';
  } else if (normalized === 'DRAFT' || normalized === 'LOW') {
    styles = 'bg-slate-800 text-slate-400 border-slate-600';
  } else if (normalized === 'TERMINATED' || normalized === 'CANCELLED' || normalized === 'CLOSED') {
    styles = 'bg-slate-800/80 text-slate-400 border-slate-700 line-through';
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${styles}`}
    >
      {normalized}
    </span>
  );
}
