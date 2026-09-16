'use client';

import React from 'react';
import { IndianRupee, Plus, Receipt, ExternalLink } from 'lucide-react';
import { StatusBadge } from '../StatusBadge';
import { EmptyState } from '../EmptyState';
import { formatCurrency } from '../../lib/formatters';

interface CustomerPaymentsTabProps {
  payments: any[];
  onRecordPayment: () => void;
}

export function CustomerPaymentsTab({
  payments = [],
  onRecordPayment,
}: CustomerPaymentsTabProps) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl space-y-0">
      <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800 flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <IndianRupee className="h-4 w-4 text-emerald-400" />
            <span>Customer Payments & Receipts</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Recorded receipts, online transactions, and manual collections.
          </p>
        </div>

        <button
          type="button"
          onClick={onRecordPayment}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/20 transition-all min-h-[38px]"
        >
          <Plus className="h-4 w-4" />
          <span>Record Payment</span>
        </button>
      </div>

      {payments.length === 0 ? (
        <div className="p-8">
          <EmptyState
            icon={IndianRupee}
            title="No Payment History"
            description="No payments or collections have been recorded for this subscriber yet."
            action={{
              label: 'Record Payment',
              onClick: onRecordPayment,
              icon: Plus,
            }}
          />
        </div>
      ) : (
        <div className="overflow-x-auto w-full min-w-0">
          <table className="w-full text-left text-xs min-w-[680px]">
            <thead className="bg-slate-950/70 text-slate-400 font-medium border-b border-slate-800">
              <tr>
                <th className="px-4 py-3">Receipt Number</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Transaction Reference</th>
                <th className="px-4 py-3">Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {payments.map((p) => {
                const isOnline = p.paymentMethod === 'ONLINE_GATEWAY' || p.paymentMethod === 'UPI';
                return (
                  <tr key={p.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-slate-100">
                      {p.receiptNumber}
                    </td>
                    <td className="px-4 py-3 text-slate-400 font-mono">
                      {new Date(p.paidAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-emerald-400 text-sm">
                      {formatCurrency(p.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px] font-medium border border-slate-700">
                        {p.paymentMethod}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-400 text-[11px]">
                      {p.transactionRef || p.gatewayPaymentId || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                          isOnline
                            ? 'bg-blue-950/80 text-blue-400 border border-blue-800'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {isOnline ? 'Online Gateway' : 'Manual Ledger'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
