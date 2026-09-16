'use client';

import React from 'react';

interface StatusBadgeProps {
  status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'PAID' | 'UNPAID' | 'ONLINE' | 'OFFLINE' | string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const normalized = (status || '').toUpperCase();

  let styles = 'bg-[#F1F5F9] text-[#475569] border-[#CBD5E1]';

  if (normalized === 'ACTIVE' || normalized === 'PAID' || normalized === 'ONLINE' || normalized === 'SUCCESS' || normalized === 'RESOLVED') {
    styles = 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]';
  } else if (normalized === 'LEAD' || normalized === 'ISSUED' || normalized === 'OPEN') {
    styles = 'bg-[#F0F9FF] text-[#0369A1] border-[#BAE6FD]';
  } else if (normalized === 'MAINTENANCE' || normalized === 'PENDING' || normalized === 'PARTIALLY_PAID' || normalized === 'MEDIUM' || normalized === 'ONBOARDING') {
    styles = 'bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]';
  } else if (normalized === 'IN_PROGRESS' || normalized === 'GRACE' || normalized === 'HIGH') {
    styles = 'bg-[#FAF5FF] text-[#7E22CE] border-[#E9D5FF]';
  } else if (normalized === 'SUSPENDED' || normalized === 'UNPAID' || normalized === 'OFFLINE' || normalized === 'OVERDUE' || normalized === 'FAILED' || normalized === 'URGENT') {
    styles = 'bg-[#FFF1F2] text-[#BE123C] border-[#FECDD3]';
  } else if (normalized === 'EXPIRED' || normalized === 'REFUNDED') {
    styles = 'bg-[#FFF7ED] text-[#C2410C] border-[#FED7AA]';
  } else if (normalized === 'INACTIVE' || normalized === 'DRAFT' || normalized === 'LOW') {
    styles = 'bg-[#F1F5F9] text-[#475569] border-[#CBD5E1]';
  } else if (normalized === 'TERMINATED' || normalized === 'CANCELLED' || normalized === 'CLOSED') {
    styles = 'bg-[#F1F5F9] text-[#94A3B8] border-[#E2E8F0] line-through';
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border shadow-xs ${styles}`}
    >
      {normalized}
    </span>
  );
}
