'use client';

import React from 'react';
import {
  Radio,
  Power,
  RotateCw,
  RefreshCw,
  IndianRupee,
  ChevronDown,
} from 'lucide-react';
import { CustomerStatus } from '@isp-crm/shared';

interface CustomerQuickActionsProps {
  customer: any;
  connection?: any;
  onDisconnect: () => void;
  onReactivate?: () => void;
  onRenewPackage: () => void;
  onRecordPayment: () => void;
  onOpenMoreActions: () => void;
}

export function CustomerQuickActions({
  customer,
  connection,
  onDisconnect,
  onReactivate,
  onRenewPackage,
  onRecordPayment,
  onOpenMoreActions,
}: CustomerQuickActionsProps) {
  const isSuspended = customer?.status === CustomerStatus.SUSPENDED;
  const isOnline = connection?.isOnline ?? false;

  return (
    <div className="flex items-center gap-2.5 flex-wrap">
      {/* Action 1: Disconnect or Reactivate */}
      {isSuspended ? (
        <button
          type="button"
          onClick={onReactivate}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-lg shadow-emerald-600/20 transition-all min-h-[42px]"
        >
          <RotateCw className="h-4 w-4" />
          <span>Reactivate Account</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={onDisconnect}
          disabled={!isOnline}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 disabled:opacity-40 disabled:hover:bg-slate-800 font-semibold text-xs transition-all min-h-[42px]"
          title={isOnline ? 'Force Disconnect active PPPoE session via RFC 3576 PoD' : 'Subscriber is offline'}
        >
          <Radio className="h-4 w-4" />
          <span>Disconnect (PoD)</span>
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
        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-950/80 hover:bg-emerald-900/90 text-emerald-300 border border-emerald-500/30 font-semibold text-xs transition-all min-h-[42px]"
      >
        <IndianRupee className="h-4 w-4" />
        <span>Record Payment</span>
      </button>

      {/* Action 4: More Actions ▾ */}
      <button
        type="button"
        onClick={onOpenMoreActions}
        className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs transition-colors min-h-[42px]"
      >
        <span>More Actions</span>
        <ChevronDown className="h-4 w-4 text-slate-400" />
      </button>
    </div>
  );
}
