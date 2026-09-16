'use client';

import React from 'react';
import {
  IndianRupee,
  Receipt,
  CreditCard,
  Plus,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { formatCurrency } from '../../lib/formatters';

interface CustomerBillingCardProps {
  invoices?: any[];
  payments?: any[];
  onCreateInvoice: () => void;
  onRecordPayment: () => void;
  onGeneratePaymentLink: () => void;
}

export function CustomerBillingCard({
  invoices = [],
  payments = [],
  onCreateInvoice,
  onRecordPayment,
  onGeneratePaymentLink,
}: CustomerBillingCardProps) {
  let totalBilled = 0;
  let totalPaid = 0;
  let overdueCount = 0;
  let pendingCount = 0;
  let paidCount = 0;

  const now = new Date();

  invoices.forEach((inv) => {
    const total = Number(inv.totalAmount || 0);
    const paid = Number(inv.paidAmount || 0);
    totalBilled += total;
    totalPaid += paid;

    if (inv.status === 'PAID') {
      paidCount++;
    } else if (inv.dueDate && new Date(inv.dueDate) < now) {
      overdueCount++;
    } else {
      pendingCount++;
    }
  });

  const outstandingBalance = Math.max(0, totalBilled - totalPaid);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-100 flex items-center gap-2">
          <IndianRupee className="h-4 w-4 text-emerald-400" />
          <span>Billing Summary</span>
        </h2>
        <span
          className={`inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-bold ${
            outstandingBalance > 0
              ? 'bg-rose-950/80 text-rose-400 border border-rose-500/30'
              : 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/30'
          }`}
        >
          {outstandingBalance > 0 ? 'PAYMENT DUE' : 'ALL CLEAR'}
        </span>
      </div>

      {/* Prominent Outstanding Display */}
      <div className="bg-slate-950/40 p-4 rounded-xl border border-slate-800/80 flex items-center justify-between">
        <div>
          <span className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold block">
            Outstanding Due
          </span>
          <span
            className={`font-mono text-2xl sm:text-3xl font-black mt-0.5 block ${
              outstandingBalance > 0 ? 'text-rose-400' : 'text-emerald-400'
            }`}
          >
            {formatCurrency(outstandingBalance)}
          </span>
        </div>

        <div className="text-right space-y-1">
          <span className="text-xs text-slate-400 block">
            Total Invoiced: <strong className="text-slate-200 font-mono">{formatCurrency(totalBilled)}</strong>
          </span>
          <span className="text-xs text-slate-400 block">
            Total Paid: <strong className="text-emerald-400 font-mono">{formatCurrency(totalPaid)}</strong>
          </span>
        </div>
      </div>

      {/* Invoice Breakdown Metrics */}
      <div className="grid grid-cols-3 gap-3 text-center text-xs">
        <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
          <span className="text-[11px] text-slate-500 uppercase tracking-wider block">Invoices</span>
          <span className="font-mono text-base font-bold text-slate-200 mt-0.5 block">
            {invoices.length}
          </span>
        </div>

        <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
          <span className="text-[11px] text-slate-500 uppercase tracking-wider block">Pending</span>
          <span className="font-mono text-base font-bold text-amber-400 mt-0.5 block">
            {pendingCount}
          </span>
        </div>

        <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
          <span className="text-[11px] text-slate-500 uppercase tracking-wider block">Overdue</span>
          <span className="font-mono text-base font-bold text-rose-400 mt-0.5 block">
            {overdueCount}
          </span>
        </div>
      </div>

      {/* Action Buttons: 1 Primary + 2 Secondary */}
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        <button
          type="button"
          onClick={onRecordPayment}
          className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-lg shadow-emerald-600/20 transition-all min-h-[40px]"
        >
          <IndianRupee className="h-4 w-4" />
          <span>Record Payment</span>
        </button>

        <button
          type="button"
          onClick={onCreateInvoice}
          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs transition-colors min-h-[40px]"
        >
          <Receipt className="h-4 w-4 text-blue-400" />
          <span>New Invoice</span>
        </button>

        <button
          type="button"
          onClick={onGeneratePaymentLink}
          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs transition-colors min-h-[40px]"
          title="Copy customer payment link"
        >
          <CreditCard className="h-4 w-4 text-emerald-400" />
          <span>Payment Link</span>
        </button>
      </div>
    </div>
  );
}
