'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import {
  ArrowLeft,
  Printer,
  Receipt,
  IndianRupee,
  Ban,
  Building,
  User,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  X,
  CreditCard,
  FileText,
} from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import { StatusBadge } from '../../../components/StatusBadge';
import { ConfirmationModal } from '../../../components/ConfirmationModal';
import { CardSkeleton } from '../../../components/LoadingSkeleton';
import { useToast } from '../../../components/Toast';

interface InvoiceDetail {
  id: string;
  organizationId: string;
  customerId: string;
  subscriptionId?: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  subtotal: string;
  discountAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  totalAmount: string;
  paidAmount: string;
  balanceDue: string;
  status: string;
  notes?: string | null;
  paidAt?: string | null;
  organization?: {
    id: string;
    name: string;
    legalName?: string | null;
    gstin?: string | null;
    email: string;
    phone: string;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    stateCode?: string | null;
    pincode?: string | null;
    currency?: string;
  };
  customer?: {
    id: string;
    name: string;
    customerCode: string;
    mobile: string;
    email?: string | null;
    address: string;
    area?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
    gstin?: string | null;
    username: string;
    status: string;
  };
  items: Array<{
    id: string;
    description: string;
    sacCode: string;
    quantity: number;
    unitPrice: string;
    discountAmount: string;
    taxRatePercent: string | number;
    taxAmount: string | number;
    totalAmount: string;
  }>;
  payments: Array<{
    id: string;
    receiptNumber: string;
    amount: string | number;
    paymentMethod: string;
    status: string;
    paidAt: string;
    transactionRef?: string | null;
  }>;
}

export default function InvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const invoiceId = params?.id as string;

  const [isRecordPaymentOpen, setIsRecordPaymentOpen] = useState(false);
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  // 1. Fetch Invoice Details
  const {
    data: invoice,
    isLoading,
    isError,
    refetch,
  } = useQuery<InvoiceDetail>({
    queryKey: ['invoice-detail', invoiceId],
    queryFn: () => apiFetch<InvoiceDetail>(`/invoices/${invoiceId}`),
    enabled: !!invoiceId,
  });

  // Record Payment Form
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors: formErrors },
  } = useForm({
    defaultValues: {
      amount: '',
      paymentMethod: 'UPI',
      transactionRef: '',
      notes: '',
    },
  });

  // Set default balance due when invoice loads
  React.useEffect(() => {
    if (invoice) {
      reset({
        amount: invoice.balanceDue,
        paymentMethod: 'UPI',
        transactionRef: '',
        notes: `Settlement for Invoice ${invoice.invoiceNumber}`,
      });
    }
  }, [invoice, reset]);

  // 2. Record Payment Mutation
  const recordPaymentMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch('/payments', {
        method: 'POST',
        body: JSON.stringify({
          customerId: invoice?.customerId,
          invoiceId: invoice?.id,
          amount: Number(data.amount),
          paymentMethod: data.paymentMethod,
          transactionRef: data.transactionRef || undefined,
          notes: data.notes || undefined,
        }),
      }),
    onSuccess: () => {
      toast.success('Payment recorded and ledger settled successfully', 'Payment Recorded');
      setIsRecordPaymentOpen(false);
      queryClient.invalidateQueries({ queryKey: ['invoice-detail', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices-metrics'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to record payment', 'Payment Error');
    },
  });

  // 3. Cancel Invoice Mutation
  const cancelInvoiceMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/invoices/${invoiceId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: cancelReason || 'Cancelled by operator' }),
      }),
    onSuccess: () => {
      toast.success(`Invoice ${invoice?.invoiceNumber} cancelled`, 'Invoice Cancelled');
      setIsCancelConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ['invoice-detail', invoiceId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices-metrics'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to cancel invoice', 'Cancellation Error');
      setIsCancelConfirmOpen(false);
    },
  });

  const onPaymentSubmit = (data: any) => {
    recordPaymentMutation.mutate(data);
  };

  const handlePrint = () => {
    window.print();
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto pb-12">
        <div className="flex items-center gap-3">
          <Link
            href="/invoices"
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="h-6 w-48 bg-slate-800 rounded animate-pulse" />
        </div>
        <CardSkeleton count={2} />
      </div>
    );
  }

  if (isError || !invoice) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto pb-12">
        <Link
          href="/invoices"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Invoices</span>
        </Link>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center">
          <AlertCircle className="h-10 w-10 text-rose-400 mx-auto mb-3" />
          <h2 className="text-base font-semibold text-slate-100 mb-1">Invoice Not Found</h2>
          <p className="text-xs text-slate-400 max-w-md mx-auto mb-6 leading-relaxed">
            The requested invoice could not be located or does not belong to your organization.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => refetch()}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold"
            >
              Retry
            </button>
            <Link
              href="/invoices"
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
            >
              Invoices List
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isPaid = invoice.status === 'PAID';
  const isCancelled = invoice.status === 'CANCELLED';

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Top Action Bar - Hidden in Print */}
      <div className="print:hidden flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <Link
            href="/invoices"
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors shrink-0"
            title="Back to Invoices"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-lg font-bold text-slate-100 font-mono tracking-tight">
                {invoice.invoiceNumber}
              </h1>
              <StatusBadge status={invoice.status} />
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Customer:{' '}
              <Link
                href={`/customers/${invoice.customer?.id}`}
                className="text-blue-400 hover:underline font-semibold"
              >
                {invoice.customer?.name}
              </Link>{' '}
              ({invoice.customer?.customerCode})
            </p>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2.5">
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-colors"
          >
            <Printer className="h-3.5 w-3.5" />
            <span>Print / PDF</span>
          </button>

          {!isPaid && !isCancelled && (
            <button
              onClick={() => setIsRecordPaymentOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-500/20 transition-all"
            >
              <IndianRupee className="h-3.5 w-3.5" />
              <span>Record Payment</span>
            </button>
          )}

          {!isPaid && !isCancelled && (
            <button
              onClick={() => setIsCancelConfirmOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-rose-400 border border-rose-500/30 text-xs font-semibold transition-colors"
            >
              <Ban className="h-3.5 w-3.5" />
              <span>Cancel</span>
            </button>
          )}
        </div>
      </div>

      {/* The Printable GST Tax Invoice Paper */}
      <div
        id="invoice-printable"
        className="bg-slate-900 border border-slate-800 print:border-none print:bg-white print:text-black rounded-2xl p-8 sm:p-12 shadow-2xl space-y-8 text-xs text-slate-300"
      >
        {/* Invoice Header: ISP Branding + Meta */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6 border-b border-slate-800 print:border-slate-300 pb-8">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="h-8 w-8 rounded-lg bg-blue-600 print:bg-black flex items-center justify-center text-white font-bold">
                ISP
              </div>
              <span className="text-lg font-bold text-slate-100 print:text-black">
                {invoice.organization?.legalName || invoice.organization?.name || 'SpeedNet Broadband'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 print:text-slate-600 leading-relaxed max-w-sm">
              {invoice.organization?.address || 'ISP Telecom Operations Center'}
              <br />
              {[invoice.organization?.city, invoice.organization?.state, invoice.organization?.pincode]
                .filter(Boolean)
                .join(', ')}
              <br />
              Email: {invoice.organization?.email || 'billing@speednet.in'} • Phone:{' '}
              {invoice.organization?.phone || '+91 98765 43210'}
              <br />
              <strong>GSTIN:</strong>{' '}
              <span className="font-mono">{invoice.organization?.gstin || '27AAAAA0000A1Z5'}</span> •{' '}
              <strong>State Code:</strong>{' '}
              <span className="font-mono">{invoice.organization?.stateCode || '27'}</span>
            </p>
          </div>

          <div className="text-left sm:text-right space-y-1">
            <h2 className="text-xl font-black uppercase tracking-wider text-slate-100 print:text-black">
              TAX INVOICE
            </h2>
            <p className="font-mono font-bold text-sm text-blue-400 print:text-black">
              #{invoice.invoiceNumber}
            </p>
            <div className="pt-2 text-[11px] text-slate-400 print:text-slate-600 space-y-0.5">
              <p>
                <strong>Invoice Date:</strong> {new Date(invoice.invoiceDate).toLocaleDateString()}
              </p>
              <p>
                <strong>Payment Due:</strong> {new Date(invoice.dueDate).toLocaleDateString()}
              </p>
              {invoice.paidAt && (
                <p className="text-emerald-400 print:text-emerald-700 font-semibold">
                  <strong>Paid At:</strong> {new Date(invoice.paidAt).toLocaleDateString()}
                </p>
              )}
            </div>
            <div className="pt-2">
              <StatusBadge status={invoice.status} />
            </div>
          </div>
        </div>

        {/* Bill To Customer Section */}
        <div className="bg-slate-950/60 print:bg-slate-50 border border-slate-800/80 print:border-slate-300 rounded-xl p-5">
          <span className="text-[10px] uppercase font-bold text-slate-500 print:text-slate-500 tracking-wider block mb-2">
            Billed To Subscriber
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <h3 className="text-sm font-bold text-slate-100 print:text-black">{invoice.customer?.name}</h3>
              <p className="text-[11px] text-slate-400 print:text-slate-600 mt-1 leading-relaxed">
                {invoice.customer?.address || 'Installation address on file'}
                <br />
                {[invoice.customer?.area, invoice.customer?.city, invoice.customer?.pincode]
                  .filter(Boolean)
                  .join(', ')}
              </p>
            </div>
            <div className="space-y-1 text-[11px] text-slate-400 print:text-slate-600 sm:text-right">
              <p>
                <strong>Subscriber Code:</strong>{' '}
                <span className="font-mono font-semibold text-slate-200 print:text-black">
                  {invoice.customer?.customerCode}
                </span>
              </p>
              <p>
                <strong>PPPoE Username:</strong>{' '}
                <span className="font-mono text-emerald-400 print:text-black">
                  {invoice.customer?.username}
                </span>
              </p>
              <p>
                <strong>Mobile:</strong> {invoice.customer?.mobile || '—'}
              </p>
              {invoice.customer?.gstin && (
                <p>
                  <strong>Customer GSTIN:</strong>{' '}
                  <span className="font-mono font-semibold">{invoice.customer?.gstin}</span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Itemized Line Items Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 print:bg-slate-100 text-slate-400 print:text-slate-700 font-semibold border-b border-slate-800 print:border-slate-300 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3 px-3">SAC Code</th>
                <th className="py-3 px-3">Description of Service</th>
                <th className="py-3 px-3 text-center">Qty</th>
                <th className="py-3 px-3 text-right">Unit Rate</th>
                <th className="py-3 px-3 text-right">Discount</th>
                <th className="py-3 px-3 text-right">Taxable Value</th>
                <th className="py-3 px-3 text-right">GST Rate</th>
                <th className="py-3 px-3 text-right">Total (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 print:divide-slate-200">
              {invoice.items && invoice.items.length > 0 ? (
                invoice.items.map((item, idx) => (
                  <tr key={item.id || idx} className="hover:bg-slate-800/20 print:hover:bg-transparent">
                    <td className="py-3.5 px-3 font-mono text-slate-400 print:text-slate-600">
                      {item.sacCode || '998422'}
                    </td>
                    <td className="py-3.5 px-3 font-medium text-slate-100 print:text-black">
                      {item.description}
                    </td>
                    <td className="py-3.5 px-3 text-center">{item.quantity}</td>
                    <td className="py-3.5 px-3 text-right font-mono">
                      ₹ {Number(item.unitPrice).toFixed(2)}
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono text-slate-400">
                      ₹ {Number(item.discountAmount || 0).toFixed(2)}
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono">
                      ₹ {(Number(item.unitPrice) * item.quantity - Number(item.discountAmount || 0)).toFixed(2)}
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono">
                      {item.taxRatePercent}%
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono font-semibold text-slate-100 print:text-black">
                      ₹ {Number(item.totalAmount).toFixed(2)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="py-4 text-center text-slate-500">
                    No line items attached.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Financial Totals & Tax Calculation Breakdown */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6 border-t border-slate-800 print:border-slate-300 pt-6">
          <div className="space-y-2 max-w-sm">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
              Payment Terms & Notes
            </span>
            <p className="text-[11px] text-slate-400 print:text-slate-600 leading-relaxed">
              {invoice.notes ||
                'Broadband internet services governed by TRAI/DoT licensing. Pay on or before due date to avoid service interruption.'}
            </p>
          </div>

          <div className="w-full sm:w-72 space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-slate-800/60 print:border-slate-200">
              <span className="text-slate-400 print:text-slate-600">Taxable Subtotal</span>
              <span className="font-mono font-medium">₹ {Number(invoice.subtotal).toFixed(2)}</span>
            </div>

            {Number(invoice.discountAmount || 0) > 0 && (
              <div className="flex justify-between py-1 border-b border-slate-800/60 print:border-slate-200 text-emerald-400 print:text-emerald-700">
                <span>Discount Applied</span>
                <span className="font-mono">- ₹ {Number(invoice.discountAmount).toFixed(2)}</span>
              </div>
            )}

            {Number(invoice.cgstAmount || 0) > 0 && (
              <div className="flex justify-between py-1 border-b border-slate-800/60 print:border-slate-200">
                <span className="text-slate-400 print:text-slate-600">CGST (9%)</span>
                <span className="font-mono">₹ {Number(invoice.cgstAmount).toFixed(2)}</span>
              </div>
            )}

            {Number(invoice.sgstAmount || 0) > 0 && (
              <div className="flex justify-between py-1 border-b border-slate-800/60 print:border-slate-200">
                <span className="text-slate-400 print:text-slate-600">SGST (9%)</span>
                <span className="font-mono">₹ {Number(invoice.sgstAmount).toFixed(2)}</span>
              </div>
            )}

            {Number(invoice.igstAmount || 0) > 0 && (
              <div className="flex justify-between py-1 border-b border-slate-800/60 print:border-slate-200">
                <span className="text-slate-400 print:text-slate-600">IGST (18%)</span>
                <span className="font-mono">₹ {Number(invoice.igstAmount).toFixed(2)}</span>
              </div>
            )}

            <div className="flex justify-between py-2 border-b-2 border-slate-700 print:border-slate-400 text-sm font-bold text-slate-100 print:text-black">
              <span>Grand Total</span>
              <span className="font-mono">₹ {Number(invoice.totalAmount).toFixed(2)}</span>
            </div>

            <div className="flex justify-between py-1 text-emerald-400 print:text-emerald-700 font-medium">
              <span>Paid Amount</span>
              <span className="font-mono">₹ {Number(invoice.paidAmount).toFixed(2)}</span>
            </div>

            <div className="flex justify-between py-2 rounded bg-slate-950 print:bg-slate-100 p-2 text-sm font-bold">
              <span className="text-slate-300 print:text-black">Balance Due</span>
              <span
                className={`font-mono ${
                  Number(invoice.balanceDue) > 0
                    ? 'text-rose-400 print:text-rose-700'
                    : 'text-emerald-400 print:text-emerald-700'
                }`}
              >
                ₹ {Number(invoice.balanceDue).toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Payments Ledger Section */}
        {invoice.payments && invoice.payments.length > 0 && (
          <div className="pt-6 border-t border-slate-800 print:border-slate-300">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 print:text-black mb-3">
              Payment Receipts Applied
            </h3>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 print:bg-slate-100 text-slate-500 font-semibold">
                <tr>
                  <th className="py-2 px-3">Receipt #</th>
                  <th className="py-2 px-3">Paid Date</th>
                  <th className="py-2 px-3">Method</th>
                  <th className="py-2 px-3">Reference / Txn ID</th>
                  <th className="py-2 px-3 text-right">Amount Settled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40 print:divide-slate-200 text-slate-300 print:text-black">
                {invoice.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 px-3 font-mono text-slate-200 print:text-black font-medium">
                      {p.receiptNumber}
                    </td>
                    <td className="py-2 px-3">{new Date(p.paidAt).toLocaleDateString()}</td>
                    <td className="py-2 px-3 font-medium">{p.paymentMethod}</td>
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-400">
                      {p.transactionRef || '—'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-400 print:text-black">
                      ₹ {Number(p.amount).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Record Payment Modal */}
      {isRecordPaymentOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <IndianRupee className="h-5 w-5 text-emerald-400" />
                <h3 className="text-base font-semibold text-slate-100">Record Payment</h3>
              </div>
              <button
                onClick={() => setIsRecordPaymentOpen(false)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onPaymentSubmit)} className="space-y-4 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Invoice</label>
                <div className="p-2.5 rounded bg-slate-950 border border-slate-800 font-mono text-slate-300">
                  {invoice.invoiceNumber} (Balance Due: ₹{invoice.balanceDue})
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Amount to Collect (₹) *</label>
                <input
                  type="number"
                  step="0.01"
                  {...register('amount', {
                    required: 'Amount is required',
                    min: { value: 1, message: 'Minimum collection is ₹1.00' },
                  })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 text-sm font-semibold focus:outline-none focus:border-emerald-500"
                />
                {formErrors.amount && (
                  <span className="text-rose-400 text-[10px]">{formErrors.amount.message as string}</span>
                )}
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Payment Method *</label>
                <select
                  {...register('paymentMethod')}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500"
                >
                  <option value="UPI">UPI (Google Pay / PhonePe / Paytm)</option>
                  <option value="CASH">Cash Collection</option>
                  <option value="BANK_TRANSFER">Direct Bank Transfer (NEFT/IMPS)</option>
                  <option value="CHEQUE">Cheque / Demand Draft</option>
                  <option value="ONLINE_GATEWAY">Online Gateway</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Transaction Ref / Cheque No.</label>
                <input
                  {...register('transactionRef')}
                  placeholder="e.g. UPI Ref / UTR / Cheque Number"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Notes</label>
                <input
                  {...register('notes')}
                  placeholder="Optional memo"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsRecordPaymentOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={recordPaymentMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                >
                  {recordPaymentMutation.isPending && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                  <span>Record & Settle</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cancel Invoice Confirmation Modal */}
      <ConfirmationModal
        isOpen={isCancelConfirmOpen}
        onClose={() => setIsCancelConfirmOpen(false)}
        onConfirm={() => cancelInvoiceMutation.mutate()}
        title="Cancel GST Tax Invoice"
        message={`Are you sure you want to cancel invoice ${invoice.invoiceNumber}? Cancelled invoices cannot be collected or settled and are permanently marked in the audit ledger.`}
        confirmText="Cancel Invoice"
        variant="danger"
        isLoading={cancelInvoiceMutation.isPending}
      />
    </div>
  );
}
