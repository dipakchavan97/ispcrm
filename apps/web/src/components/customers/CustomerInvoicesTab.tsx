'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Receipt, Plus, Eye, FileDown, IndianRupee, RefreshCw } from 'lucide-react';
import { StatusBadge } from '../StatusBadge';
import { EmptyState } from '../EmptyState';
import { formatCurrency } from '../../lib/formatters';
import { useToast } from '../Toast';
import { downloadInvoicePdf } from '../../lib/api';

interface CustomerInvoicesTabProps {
  invoices: any[];
  onCreateInvoice: () => void;
  onRecordPayment: (invoice?: any) => void;
}

export function CustomerInvoicesTab({
  invoices = [],
  onCreateInvoice,
  onRecordPayment,
}: CustomerInvoicesTabProps) {
  const toast = useToast();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleDownloadPdf = async (invoiceId: string, invoiceNumber: string) => {
    try {
      setDownloadingId(invoiceId);
      await downloadInvoicePdf(invoiceId, invoiceNumber);
      toast.success(`Invoice ${invoiceNumber} downloaded`, 'PDF Downloaded');
    } catch (err: any) {
      toast.error(err.message || 'Could not download PDF', 'Download Error');
    } finally {
      setDownloadingId(null);
    }
  };

  const formatPeriod = (start?: string | null, end?: string | null) => {
    if (!start || !end) return 'Not recorded';
    const s = new Date(start);
    const e = new Date(end);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return 'Not recorded';
    return `${s.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} – ${e.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`;
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl space-y-0">
      <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800 flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <Receipt className="h-4 w-4 text-blue-400" />
            <span>Customer GST Tax Invoices</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Issued billing invoices and tax statements for this subscriber.
          </p>
        </div>

        <button
          type="button"
          onClick={onCreateInvoice}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/20 transition-all min-h-[38px]"
        >
          <Plus className="h-4 w-4" />
          <span>Create Invoice</span>
        </button>
      </div>

      {invoices.length === 0 ? (
        <div className="p-8">
          <EmptyState
            icon={Receipt}
            title="No Invoices Issued"
            description="No billing statements or GST invoices have been generated for this subscriber."
            action={{
              label: 'Generate Invoice',
              onClick: onCreateInvoice,
              icon: Plus,
            }}
          />
        </div>
      ) : (
        <div className="overflow-x-auto w-full min-w-0">
          <table className="w-full text-left text-xs min-w-[850px]">
            <thead className="bg-slate-950/70 text-slate-400 font-medium border-b border-slate-800">
              <tr>
                <th className="px-4 py-3">Invoice Number</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Service Period</th>
                <th className="px-4 py-3">Due Date</th>
                <th className="px-4 py-3">Total Amount</th>
                <th className="px-4 py-3">Due Balance</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {invoices.map((inv) => {
                const total = Number(inv.totalAmount || 0);
                const paid = Number(inv.paidAmount || 0);
                const balance = Math.max(0, total - paid);
                const isDownloading = downloadingId === inv.id;

                return (
                  <tr key={inv.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-blue-400">
                      <Link href={`/invoices/${inv.id}`} className="hover:underline">
                        {inv.invoiceNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-400 font-mono">
                      {new Date(inv.invoiceDate).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-slate-300 font-mono text-[11px]">
                      <span className={inv.servicePeriodStart ? 'text-sky-400 font-medium' : 'text-slate-500 italic'}>
                        {formatPeriod(inv.servicePeriodStart, inv.servicePeriodEnd)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 font-mono">
                      {new Date(inv.dueDate).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-100">
                      {formatCurrency(total)}
                    </td>
                    <td className="px-4 py-3 font-mono font-bold">
                      <span className={balance > 0 ? 'text-rose-400' : 'text-slate-400'}>
                        {formatCurrency(balance)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {balance > 0 && (
                          <button
                            type="button"
                            onClick={() => onRecordPayment(inv)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-950 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-900/60 text-[11px] font-semibold min-h-[30px]"
                          >
                            <IndianRupee className="h-3 w-3" />
                            <span>Pay</span>
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={isDownloading}
                          onClick={() => handleDownloadPdf(inv.id, inv.invoiceNumber)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 border border-slate-700 text-[11px] font-semibold min-h-[30px] disabled:opacity-50"
                          title="Download Server-Generated GST PDF"
                        >
                          {isDownloading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <FileDown className="h-3 w-3" />}
                          <span>PDF</span>
                        </button>
                        <Link
                          href={`/invoices/${inv.id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-semibold min-h-[30px]"
                        >
                          <Eye className="h-3 w-3" />
                          <span>View</span>
                        </Link>
                      </div>
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
