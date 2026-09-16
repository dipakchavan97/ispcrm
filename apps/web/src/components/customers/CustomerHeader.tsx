'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ShieldCheck,
  ShieldAlert,
  Copy,
  Check,
  Radio,
  RotateCw,
  RefreshCw,
  IndianRupee,
  ChevronDown,
  Power,
} from 'lucide-react';
import { StatusBadge } from '../StatusBadge';
import { formatCurrency } from '../../lib/formatters';
import { CustomerStatus } from '@isp-crm/shared';

interface CustomerHeaderProps {
  customer: any;
  connection?: any;
  currentSubscription?: any;
  onDisconnect?: () => void;
  onSuspend?: () => void;
  onReactivate?: () => void;
  onRenewPackage?: () => void;
  onRecordPayment?: () => void;
  onOpenMoreActions: () => void;
}

export function CustomerHeader({
  customer,
  connection,
  currentSubscription,
  onDisconnect,
  onSuspend,
  onReactivate,
  onRenewPackage,
  onRecordPayment,
  onOpenMoreActions,
}: CustomerHeaderProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = (text: string, fieldName: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const isOnline = connection?.isOnline ?? false;
  const isSuspended = customer?.status === CustomerStatus.SUSPENDED;
  const isMacBound = Boolean(customer?.macAddress);
  const activePlan = currentSubscription?.plan;

  // Calculate outstanding balance
  let totalBilled = 0;
  let totalPaid = 0;
  (customer?.invoices || []).forEach((inv: any) => {
    totalBilled += Number(inv.totalAmount || 0);
    totalPaid += Number(inv.paidAmount || 0);
  });
  const balanceDue = Math.max(0, totalBilled - totalPaid);

  // Expiry date formatting
  let expiryDateFormatted = 'No Active Plan';
  if (currentSubscription?.endDate) {
    expiryDateFormatted = `Expires ${new Date(currentSubscription.endDate).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })}`;
  }

  // Subscriber initial for avatar
  const initial = customer?.name ? customer.name.trim().charAt(0).toUpperCase() : 'S';

  return (
    <div className="bg-slate-900 border border-slate-800/90 rounded-2xl p-5 sm:p-6 shadow-xl space-y-5">
      {/* Top row: Back link + Navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/customers"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/80 text-xs font-semibold transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Subscribers</span>
        </Link>

        {/* Quick Expiry & Balance preview for tablet/desktop */}
        <div className="hidden sm:flex items-center gap-4 text-xs">
          <div className="text-right">
            <span
              className={`font-bold font-mono text-sm block ${
                balanceDue > 0 ? 'text-rose-400' : 'text-emerald-400'
              }`}
            >
              {balanceDue > 0 ? `${formatCurrency(balanceDue)} Due` : 'Balance: All Clear'}
            </span>
            <span className="text-[11px] text-slate-400 block font-medium">
              {expiryDateFormatted}
            </span>
          </div>
        </div>
      </div>

      {/* Main Identity Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 border-t border-slate-800/60 pt-4">
        {/* Left Side: Avatar + Name + Badges + Sub-identity */}
        <div className="flex items-start gap-4 min-w-0">
          {/* Avatar / Initial */}
          <div className="h-12 w-12 sm:h-14 sm:w-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white font-bold text-xl sm:text-2xl flex items-center justify-center shrink-0 shadow-lg shadow-blue-600/20 border border-blue-400/20">
            {initial}
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            {/* Name + Status Badges */}
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-extrabold text-slate-100 tracking-tight break-words">
                {customer.name}
              </h1>

              {/* Online / Offline Pill */}
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                  isOnline
                    ? 'bg-emerald-950/90 text-emerald-400 border border-emerald-500/40 shadow-sm shadow-emerald-950'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                  }`}
                />
                {isOnline ? 'Online' : 'Offline'}
              </span>

              {/* Customer Account Status */}
              <StatusBadge status={customer.status} />

              {/* MAC Authentication Pill */}
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                  isMacBound
                    ? 'bg-purple-950/80 text-purple-300 border border-purple-500/30'
                    : 'bg-amber-950/50 text-amber-400 border border-amber-500/20'
                }`}
              >
                {isMacBound ? (
                  <>
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>MAC Bound</span>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="h-3.5 w-3.5" />
                    <span>No MAC Lock</span>
                  </>
                )}
              </span>
            </div>

            {/* Sub-identity row: PPPoE username, customer code, account ID */}
            <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
              <span className="flex items-center gap-1">
                PPPoE:
                <button
                  type="button"
                  onClick={() => copyToClipboard(customer.username || customer.pppoeUsername, 'username')}
                  className="font-mono text-emerald-400 font-semibold hover:underline inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-950/60 border border-slate-800"
                  title="Click to copy PPPoE username"
                >
                  <span>{customer.username || customer.pppoeUsername}</span>
                  {copiedField === 'username' ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3 text-slate-500 hover:text-slate-300" />
                  )}
                </button>
              </span>

              <span>•</span>

              <span className="font-mono">
                Customer Code: <strong className="text-blue-400 font-bold">{customer.customerCode}</strong>
              </span>

              <span>•</span>

              <span className="hidden sm:inline">
                Subscriber Since:{' '}
                <strong className="text-slate-300">
                  {customer.createdAt
                    ? new Date(customer.createdAt).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })
                    : '—'}
                </strong>
              </span>
            </div>
          </div>
        </div>

        {/* Right Side: Primary Actions (Max 3 buttons + More Actions) */}
        <div className="flex items-center gap-2.5 flex-wrap shrink-0 self-start sm:self-auto">
          {/* Action 1: Disconnect (if online) or Reactivate (if suspended) */}
          {isSuspended ? (
            <button
              type="button"
              onClick={onReactivate}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-lg shadow-emerald-600/20 transition-all min-h-[42px]"
            >
              <RotateCw className="h-4 w-4" />
              <span>Reactivate</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onDisconnect}
              disabled={!isOnline}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 disabled:opacity-40 disabled:hover:bg-slate-800 font-semibold text-xs transition-all min-h-[42px]"
              title={isOnline ? 'Force Disconnect active session via RFC 3576 PoD' : 'Subscriber is offline'}
            >
              <Radio className="h-4 w-4" />
              <span>Disconnect</span>
            </button>
          )}

          {/* Action 2: Renew Package */}
          <button
            type="button"
            onClick={onRenewPackage}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-lg shadow-blue-600/20 transition-all min-h-[42px]"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Renew Package</span>
          </button>

          {/* Action 3: Record Payment */}
          <button
            type="button"
            onClick={onRecordPayment}
            className="hidden sm:inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-950/80 hover:bg-emerald-900/90 text-emerald-300 border border-emerald-500/30 font-semibold text-xs transition-all min-h-[42px]"
          >
            <IndianRupee className="h-4 w-4" />
            <span>Record Payment</span>
          </button>

          {/* Action 4: More Actions Dropdown Toggle */}
          <button
            type="button"
            onClick={onOpenMoreActions}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs transition-colors min-h-[42px]"
            aria-label="Open more actions menu"
          >
            <span>More Actions</span>
            <ChevronDown className="h-4 w-4 text-slate-400" />
          </button>
        </div>
      </div>
    </div>
  );
}
