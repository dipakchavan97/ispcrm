'use client';

import React from 'react';
import {
  Wifi,
  RefreshCw,
  Zap,
  Gauge,
  Calendar,
  ArrowDown,
  ArrowUp,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { formatCurrency } from '../../lib/formatters';

interface CustomerPackageCardProps {
  subscription?: any;
  onRenew: () => void;
  onChangePlan: () => void;
  onOverrideSpeed: () => void;
  onSuspend?: () => void;
  onReactivate?: () => void;
  onCancel?: () => void;
}

export function CustomerPackageCard({
  subscription,
  onRenew,
  onChangePlan,
  onOverrideSpeed,
}: CustomerPackageCardProps) {
  if (!subscription) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-100 flex items-center gap-2 border-b border-slate-800 pb-3">
          <Wifi className="h-4 w-4 text-blue-400" />
          <span>Current Internet Plan</span>
        </h2>
        <div className="p-8 text-center bg-slate-950/40 rounded-xl border border-slate-800/80 space-y-3">
          <Wifi className="h-8 w-8 text-slate-600 mx-auto" />
          <h3 className="text-sm font-semibold text-slate-200">No Active Plan Assigned</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            This subscriber currently does not have an active internet subscription.
          </p>
          <button
            type="button"
            onClick={onChangePlan}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/20 transition-all min-h-[40px]"
          >
            <Zap className="h-4 w-4" />
            <span>Assign Internet Plan</span>
          </button>
        </div>
      </div>
    );
  }

  const plan = subscription.plan;
  const startDate = new Date(subscription.startDate);
  const endDate = new Date(subscription.endDate);
  const now = new Date();

  const totalDurationMs = endDate.getTime() - startDate.getTime();
  const elapsedMs = now.getTime() - startDate.getTime();
  const remainingMs = Math.max(0, endDate.getTime() - now.getTime());

  const daysRemaining = Math.ceil(remainingMs / (1000 * 60 * 60 * 24));
  const isExpired = now > endDate;
  const isExpiringSoon = daysRemaining <= 5 && !isExpired;

  let progressPercent = 0;
  if (totalDurationMs > 0) {
    progressPercent = Math.max(0, Math.min(100, (elapsedMs / totalDurationMs) * 100));
  }

  const price = Number(subscription.price || plan?.price || 0);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-100 flex items-center gap-2">
          <Wifi className="h-4 w-4 text-blue-400" />
          <span>Current Internet Plan</span>
        </h2>
        <span
          className={`inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-bold ${
            isExpired
              ? 'bg-rose-950/80 text-rose-400 border border-rose-500/30'
              : isExpiringSoon
              ? 'bg-amber-950/80 text-amber-400 border border-amber-500/30'
              : 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/30'
          }`}
        >
          {isExpired ? 'EXPIRED' : isExpiringSoon ? 'EXPIRING SOON' : 'ACTIVE'}
        </span>
      </div>

      {/* Plan Details & Speed Highlights */}
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
        <div>
          <h3 className="text-xl sm:text-2xl font-black text-slate-100 tracking-tight">
            {plan?.downloadSpeedMbps || 50} Mbps — {plan?.name || 'Broadband Plan'}
          </h3>
          <div className="flex items-center gap-4 text-xs font-semibold text-slate-400 mt-1">
            <span className="flex items-center gap-1 text-emerald-400">
              <ArrowDown className="h-3.5 w-3.5" />
              <span>{plan?.downloadSpeedMbps || 50} Mbps Download</span>
            </span>
            <span>•</span>
            <span className="flex items-center gap-1 text-blue-400">
              <ArrowUp className="h-3.5 w-3.5" />
              <span>{plan?.uploadSpeedMbps || 50} Mbps Upload</span>
            </span>
          </div>
        </div>

        <div className="text-left sm:text-right">
          <span className="font-mono text-lg font-bold text-slate-200">
            {formatCurrency(price)}
          </span>
          <span className="text-xs text-slate-500 block">/ {subscription.billingCycle || 'month'}</span>
        </div>
      </div>

      {/* Section 9: Clean Expiry Visualization Bar */}
      <div className="space-y-2.5 bg-slate-950/40 p-4 rounded-xl border border-slate-800/80">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400 font-medium">Package Validity</span>
          <span
            className={`font-bold uppercase tracking-wider text-[11px] ${
              isExpired
                ? 'text-rose-400'
                : isExpiringSoon
                ? 'text-amber-400'
                : 'text-emerald-400'
            }`}
          >
            {isExpired
              ? 'Expired'
              : `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining`}
          </span>
        </div>

        {/* Progress Bar */}
        <div className="relative w-full h-2 rounded-full bg-slate-800 overflow-hidden">
          <div
            className={`h-full transition-all duration-500 rounded-full ${
              isExpired
                ? 'bg-rose-500'
                : isExpiringSoon
                ? 'bg-amber-400'
                : 'bg-blue-500'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Dates */}
        <div className="flex items-center justify-between text-xs text-slate-400 pt-0.5">
          <span>
            Activated:{' '}
            <strong className="text-slate-300 font-mono">
              {startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </strong>
          </span>
          <span>
            Expires:{' '}
            <strong className="text-slate-300 font-mono">
              {endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </strong>
          </span>
        </div>
      </div>

      {/* Action Buttons: 2 Primary + 1 Secondary Override */}
      <div className="flex items-center justify-between gap-3 pt-1 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onRenew}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-lg shadow-blue-600/20 transition-all min-h-[40px]"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Renew Package</span>
          </button>

          <button
            type="button"
            onClick={onChangePlan}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs transition-colors min-h-[40px]"
          >
            <Zap className="h-4 w-4 text-blue-400" />
            <span>Change Package</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onOverrideSpeed}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 text-xs font-semibold transition-colors min-h-[36px]"
          title="Apply temporary bandwidth rate-limit override"
        >
          <Gauge className="h-3.5 w-3.5 text-amber-400" />
          <span>Override Speed</span>
        </button>
      </div>
    </div>
  );
}
