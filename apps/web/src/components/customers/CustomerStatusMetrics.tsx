'use client';

import React from 'react';
import { Wifi, Radio, IndianRupee, Globe } from 'lucide-react';
import { formatCurrency, formatDuration } from '../../lib/formatters';

interface CustomerStatusMetricsProps {
  customer: any;
  connection?: any;
  subscription?: any;
}

export function CustomerStatusMetrics({
  customer,
  connection,
  subscription,
}: CustomerStatusMetricsProps) {
  const isOnline = connection?.isOnline ?? false;
  const plan = subscription?.plan;

  // Calculate pending invoices and outstanding balance
  let totalBilled = 0;
  let totalPaid = 0;
  let pendingInvoicesCount = 0;

  (customer?.invoices || []).forEach((inv: any) => {
    totalBilled += Number(inv.totalAmount || 0);
    totalPaid += Number(inv.paidAmount || 0);
    if (inv.status !== 'PAID' && inv.status !== 'CANCELLED') {
      pendingInvoicesCount++;
    }
  });

  const balanceDue = Math.max(0, totalBilled - totalPaid);

  // Session duration text
  let sessionDurationText = 'No active session';
  if (isOnline && connection?.sessionDuration) {
    sessionDurationText = formatDuration(connection.sessionDuration);
  } else if (!isOnline && connection?.terminateCause) {
    sessionDurationText = `Terminated: ${connection.terminateCause}`;
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {/* 1. CONNECTION */}
      <div className="bg-slate-900 border border-slate-800/90 rounded-2xl p-4 sm:p-5 shadow-lg flex flex-col justify-between hover:border-slate-700/80 transition-colors min-h-[96px]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Connection
          </span>
          <div
            className={`p-1.5 rounded-lg ${
              isOnline ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-500'
            }`}
          >
            <Radio className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-2">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
              }`}
            />
            <span
              className={`text-lg sm:text-xl font-bold tracking-tight ${
                isOnline ? 'text-emerald-400' : 'text-slate-400'
              }`}
            >
              {isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
          <p className="text-xs text-slate-400 font-mono mt-0.5 truncate" title={sessionDurationText}>
            {sessionDurationText}
          </p>
        </div>
      </div>

      {/* 2. CURRENT PACKAGE */}
      <div className="bg-slate-900 border border-slate-800/90 rounded-2xl p-4 sm:p-5 shadow-lg flex flex-col justify-between hover:border-slate-700/80 transition-colors min-h-[96px]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Package
          </span>
          <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400">
            <Wifi className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-2">
          <div className="text-lg sm:text-xl font-bold text-slate-100 tracking-tight truncate">
            {plan?.downloadSpeedMbps ? `${plan.downloadSpeedMbps} Mbps` : 'No Plan'}
          </div>
          <p className="text-xs text-blue-400 font-medium truncate">
            {plan?.name || 'Unassigned'}
          </p>
        </div>
      </div>

      {/* 3. IP ADDRESS */}
      <div className="bg-slate-900 border border-slate-800/90 rounded-2xl p-4 sm:p-5 shadow-lg flex flex-col justify-between hover:border-slate-700/80 transition-colors min-h-[96px]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            IP Address
          </span>
          <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400">
            <Globe className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-2">
          <div
            className="text-base sm:text-lg font-bold font-mono text-cyan-300 tracking-tight truncate"
            title={connection?.framedIp || customer?.staticIp || 'Dynamic Pool'}
          >
            {connection?.framedIp || customer?.staticIp || 'Dynamic Pool'}
          </div>
          <p className="text-xs text-slate-400 font-medium">
            {customer?.staticIp ? 'Static IP' : 'PPPoE Dynamic'}
          </p>
        </div>
      </div>

      {/* 4. BALANCE */}
      <div className="bg-slate-900 border border-slate-800/90 rounded-2xl p-4 sm:p-5 shadow-lg flex flex-col justify-between hover:border-slate-700/80 transition-colors min-h-[96px]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Account Balance
          </span>
          <div
            className={`p-1.5 rounded-lg ${
              balanceDue > 0 ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'
            }`}
          >
            <IndianRupee className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-2">
          <div
            className={`text-lg sm:text-xl font-bold tracking-tight ${
              balanceDue > 0 ? 'text-rose-400 font-mono' : 'text-emerald-400'
            }`}
          >
            {balanceDue > 0 ? `${formatCurrency(balanceDue)} Due` : 'All Clear'}
          </div>
          <p className="text-xs text-slate-400 font-medium">
            {pendingInvoicesCount > 0
              ? `${pendingInvoicesCount} pending invoice${pendingInvoicesCount === 1 ? '' : 's'}`
              : 'Zero pending invoices'}
          </p>
        </div>
      </div>
    </div>
  );
}
