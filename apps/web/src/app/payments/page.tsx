'use client';

import React, { useState, useMemo, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import {
  IndianRupee,
  Receipt,
  Search,
  Plus,
  RefreshCw,
  Filter,
  CheckCircle2,
  AlertCircle,
  Clock,
  Printer,
  RotateCcw,
  User,
  Building,
  CreditCard,
  FileText,
  ChevronLeft,
  ChevronRight,
  X,
  ExternalLink,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { StatusBadge } from '../../components/StatusBadge';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { TableSkeleton, MetricSkeleton } from '../../components/LoadingSkeleton';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../components/Toast';

interface Payment {
  id: string;
  organizationId: string;
  customerId: string;
  invoiceId?: string | null;
  receiptNumber: string;
  amount: string | number;
  paymentMethod: 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE' | 'ONLINE_GATEWAY';
  status: 'SUCCESS' | 'PENDING' | 'FAILED' | 'REFUNDED';
  transactionRef?: string | null;
  gatewayOrderId?: string | null;
  gatewayPaymentId?: string | null;
  collectedById?: string | null;
  paidAt: string;
  notes?: string | null;
  createdAt: string;
  customer?: {
    id: string;
    name: string;
    customerCode: string;
    mobile?: string;
  };
  invoice?: {
    id: string;
    invoiceNumber: string;
    totalAmount: string | number;
    status: string;
  } | null;
}

interface PaymentListResponse {
  items: Payment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface CustomerOption {
  id: string;
  name: string;
  customerCode: string;
  mobile: string;
}

interface UnpaidInvoiceOption {
  id: string;
  invoiceNumber: string;
  totalAmount: string;
  balanceDue: string;
  dueDate: string;
}

function PaymentsContent() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const searchParams = useSearchParams();
  const queryCustomerId = searchParams?.get('customerId') || '';
  const queryInvoiceId = searchParams?.get('invoiceId') || '';

  const [page, setPage] = useState(1);
  const [limit] = useState(15);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [methodFilter, setMethodFilter] = useState('ALL');

  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
  const [selectedPaymentForReceipt, setSelectedPaymentForReceipt] = useState<Payment | null>(null);
  const [refundTarget, setRefundTarget] = useState<Payment | null>(null);
  const [refundReason, setRefundReason] = useState('');

  // Selected customer for creating payment
  const [selectedCustId, setSelectedCustId] = useState<string>(queryCustomerId);

  // 1. Fetch Paginated Payments
  const {
    data: paymentsData = { items: [], total: 0, page: 1, limit: 15, totalPages: 1 },
    isLoading,
    isError,
    refetch,
  } = useQuery<PaymentListResponse>({
    queryKey: ['payments', page, limit, search, statusFilter, methodFilter, queryCustomerId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(limit));
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (methodFilter !== 'ALL') params.set('paymentMethod', methodFilter);
      if (queryCustomerId) params.set('customerId', queryCustomerId);

      return apiFetch<PaymentListResponse>(`/payments?${params.toString()}`);
    },
  });

  // 2. Fetch Customers for Payment Form
  const { data: customersData } = useQuery<{ items: CustomerOption[] }>({
    queryKey: ['customers-list-lookup'],
    queryFn: () => apiFetch<{ items: CustomerOption[] }>('/customers?limit=100'),
    enabled: isRecordModalOpen,
  });

  // 3. Fetch Unpaid Invoices for Selected Customer
  const { data: customerInvoicesData } = useQuery<{ items: UnpaidInvoiceOption[] }>({
    queryKey: ['customer-unpaid-invoices', selectedCustId],
    queryFn: () => apiFetch<{ items: UnpaidInvoiceOption[] }>(`/invoices?customerId=${selectedCustId}&limit=50`),
    enabled: isRecordModalOpen && !!selectedCustId,
  });

  // Record Payment Form
  const {
    register,
    handleSubmit,
    setValue,
    reset: resetForm,
    formState: { errors: formErrors },
  } = useForm({
    defaultValues: {
      customerId: queryCustomerId || '',
      invoiceId: queryInvoiceId || '',
      amount: '',
      paymentMethod: 'UPI',
      transactionRef: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (queryCustomerId) {
      setSelectedCustId(queryCustomerId);
      setValue('customerId', queryCustomerId);
      setIsRecordModalOpen(true);
      if (queryInvoiceId) {
        setValue('invoiceId', queryInvoiceId);
      }
    }
  }, [queryCustomerId, queryInvoiceId, setValue]);

  // Handle customer select change in form
  const handleCustomerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const custId = e.target.value;
    setSelectedCustId(custId);
    setValue('customerId', custId);
    setValue('invoiceId', '');
    setValue('amount', '');
  };

  // Handle invoice select change in form
  const handleInvoiceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const invId = e.target.value;
    setValue('invoiceId', invId);
    if (invId && customerInvoicesData?.items) {
      const found = customerInvoicesData.items.find((i) => i.id === invId);
      if (found) {
        setValue('amount', found.balanceDue || found.totalAmount);
      }
    }
  };

  // 4. Record Payment Mutation
  const recordMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch('/payments', {
        method: 'POST',
        body: JSON.stringify({
          customerId: data.customerId,
          invoiceId: data.invoiceId || undefined,
          amount: Number(data.amount),
          paymentMethod: data.paymentMethod,
          transactionRef: data.transactionRef || undefined,
          notes: data.notes || undefined,
        }),
      }),
    onSuccess: (res: any) => {
      toast.success(`Payment receipt #${res?.receiptNumber || ''} created successfully`, 'Payment Recorded');
      setIsRecordModalOpen(false);
      resetForm();
      setSelectedCustId('');
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices-metrics'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to record payment', 'Payment Error');
    },
  });

  // 5. Refund Payment Mutation
  const refundMutation = useMutation({
    mutationFn: (paymentId: string) =>
      apiFetch(`/payments/${paymentId}/refund`, {
        method: 'POST',
        body: JSON.stringify({ reason: refundReason || 'Refund requested by operator' }),
      }),
    onSuccess: () => {
      toast.success(`Payment receipt #${refundTarget?.receiptNumber} refunded`, 'Refund Processed');
      setRefundTarget(null);
      setRefundReason('');
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['invoices-metrics'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to process refund', 'Refund Error');
      setRefundTarget(null);
    },
  });

  const onRecordSubmit = (data: any) => {
    recordMutation.mutate(data);
  };

  // Compute Real Aggregate Collections from loaded data
  const { totalCollections, cashTotal, digitalTotal } = useMemo(() => {
    let total = 0;
    let cash = 0;
    let digital = 0;

    paymentsData.items.forEach((p) => {
      if (p.status === 'SUCCESS') {
        const amt = Number(p.amount || 0);
        total += amt;
        if (p.paymentMethod === 'CASH') {
          cash += amt;
        } else {
          digital += amt;
        }
      }
    });

    return {
      totalCollections: total,
      cashTotal: cash,
      digitalTotal: digital,
    };
  }, [paymentsData.items]);

  const handlePrintReceipt = () => {
    window.print();
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-xl sm:rounded-2xl p-4 sm:p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-600/10 text-emerald-400 border border-emerald-500/20 shadow-inner shrink-0">
            <IndianRupee className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-lg sm:text-xl font-bold text-slate-100 tracking-tight">Payment Receipts & Ledger</h1>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono">
                {paymentsData.total} Transactions
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Record subscriber collections, reconcile cash & UPI, track transaction UTRs, and print receipts.
            </p>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2 sm:gap-2.5">
          <button
            onClick={() => refetch()}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition-colors"
            title="Refresh payments list"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => {
              resetForm();
              setSelectedCustId('');
              setIsRecordModalOpen(true);
            }}
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-500/20 transition-all"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Record Payment</span>
          </button>
        </div>
      </div>

      {/* Real Aggregate Metrics Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {isLoading ? (
          <>
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
          </>
        ) : (
          <>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-lg space-y-1.5">
              <span className="text-xs text-slate-400 font-medium">Page Collections (Settled)</span>
              <p className="text-xl font-bold text-emerald-400 font-mono">
                ₹ {totalCollections.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
              <p className="text-[11px] text-slate-500">Across {paymentsData.items.length} records on current view</p>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-lg space-y-1.5">
              <span className="text-xs text-slate-400 font-medium">Digital & UPI Collections</span>
              <p className="text-xl font-bold text-blue-400 font-mono">
                ₹ {digitalTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
              <p className="text-[11px] text-slate-500">UPI, Net Banking, Gateway</p>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-lg space-y-1.5">
              <span className="text-xs text-slate-400 font-medium">Cash Collections</span>
              <p className="text-xl font-bold text-amber-400 font-mono">
                ₹ {cashTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
              <p className="text-[11px] text-slate-500">Physical field cash collections</p>
            </div>
          </>
        )}
      </div>

      {/* Search & Filters Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-4 shadow-lg flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search receipt #, subscriber, ref..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-2 min-h-[40px] text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
          />
        </div>

        <div className="flex items-center flex-wrap gap-2.5 sm:gap-3 w-full md:w-auto">
          {/* Method Filter */}
          <div className="flex items-center gap-2 text-xs flex-1 sm:flex-initial">
            <span className="text-slate-400 shrink-0">Method:</span>
            <select
              value={methodFilter}
              onChange={(e) => {
                setMethodFilter(e.target.value);
                setPage(1);
              }}
              className="w-full sm:w-auto bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 min-h-[40px] text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="ALL">All Methods</option>
              <option value="UPI">UPI</option>
              <option value="CASH">Cash</option>
              <option value="BANK_TRANSFER">Bank Transfer</option>
              <option value="CHEQUE">Cheque</option>
              <option value="ONLINE_GATEWAY">Online Gateway</option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2 text-xs flex-1 sm:flex-initial">
            <span className="text-slate-400 shrink-0">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="w-full sm:w-auto bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 min-h-[40px] text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="ALL">All Statuses</option>
              <option value="SUCCESS">Success</option>
              <option value="PENDING">Pending</option>
              <option value="FAILED">Failed</option>
              <option value="REFUNDED">Refunded</option>
            </select>
          </div>
        </div>
      </div>

      {/* Payments Ledger Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl min-w-0 w-full">
        <div className="overflow-x-auto w-full min-w-0">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800 uppercase tracking-wider text-[11px]">
              <tr>
                <th className="px-4 py-3.5">Receipt #</th>
                <th className="px-4 py-3.5">Paid Date & Time</th>
                <th className="px-4 py-3.5">Subscriber</th>
                <th className="px-4 py-3.5">Invoice #</th>
                <th className="px-4 py-3.5 text-right">Amount (₹)</th>
                <th className="px-4 py-3.5">Payment Method</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5">Transaction Ref</th>
                <th className="px-4 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="p-4">
                    <TableSkeleton rows={5} cols={6} />
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={9} className="px-5 py-12 text-center text-slate-400">
                    <AlertCircle className="h-8 w-8 text-rose-400 mx-auto mb-2" />
                    Failed to fetch payments ledger.
                    <button
                      onClick={() => refetch()}
                      className="mt-2 block mx-auto px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700"
                    >
                      Retry
                    </button>
                  </td>
                </tr>
              ) : paymentsData.items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-12 text-center text-slate-400">
                    <EmptyState
                      icon={IndianRupee}
                      title="No Payments Found"
                      description="No payment transactions match your query or filters."
                      action={{
                        label: 'Record New Payment',
                        onClick: () => {
                          resetForm();
                          setSelectedCustId('');
                          setIsRecordModalOpen(true);
                        },
                        icon: Plus,
                      }}
                    />
                  </td>
                </tr>
              ) : (
                paymentsData.items.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-800/40 transition-colors">
                    {/* Receipt Number */}
                    <td className="px-4 py-3.5 font-mono font-semibold text-slate-100">
                      {p.receiptNumber}
                    </td>

                    {/* Paid Date */}
                    <td className="px-4 py-3.5 text-slate-400 font-mono text-[11px]">
                      {new Date(p.paidAt).toLocaleString([], {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>

                    {/* Customer */}
                    <td className="px-4 py-3.5">
                      {p.customer ? (
                        <Link
                          href={`/customers/${p.customer.id}`}
                          className="font-medium text-slate-100 hover:text-blue-400 transition-colors block"
                        >
                          {p.customer.name}
                          <span className="text-[10px] text-slate-400 block font-mono">
                            {p.customer.customerCode}
                          </span>
                        </Link>
                      ) : (
                        <span className="text-slate-500 italic">Unassigned</span>
                      )}
                    </td>

                    {/* Invoice Number */}
                    <td className="px-4 py-3.5 font-mono">
                      {p.invoice ? (
                        <Link
                          href={`/invoices/${p.invoice.id}`}
                          className="text-blue-400 hover:underline"
                        >
                          {p.invoice.invoiceNumber}
                        </Link>
                      ) : (
                        <span className="text-slate-500 text-[11px]">Direct Receipt</span>
                      )}
                    </td>

                    {/* Amount */}
                    <td className="px-4 py-3.5 text-right font-mono font-bold text-emerald-400">
                      ₹ {Number(p.amount).toFixed(2)}
                    </td>

                    {/* Method */}
                    <td className="px-4 py-3.5">
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                        {p.paymentMethod}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3.5">
                      <StatusBadge status={p.status} />
                    </td>

                    {/* Transaction Ref */}
                    <td className="px-4 py-3.5 font-mono text-[11px] text-slate-400 max-w-[140px] truncate">
                      {p.transactionRef || p.gatewayPaymentId || '—'}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setSelectedPaymentForReceipt(p)}
                          className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-all min-h-[36px] min-w-[36px] inline-flex items-center justify-center"
                          title="View & Print Money Receipt"
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </button>
                        {p.status === 'SUCCESS' && (
                          <button
                            onClick={() => {
                              setRefundTarget(p);
                              setRefundReason('');
                            }}
                            className="p-2 rounded-lg bg-slate-800 hover:bg-rose-900/40 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-500/30 transition-all min-h-[36px] min-w-[36px] inline-flex items-center justify-center"
                            title="Process Ledger Refund"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {paymentsData.totalPages > 1 && (
          <div className="p-3 sm:p-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
            <span>
              Showing {(page - 1) * limit + 1} to {Math.min(page * limit, paymentsData.total)} of{' '}
              {paymentsData.total} records
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex items-center gap-1 px-3 py-2 min-h-[40px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 disabled:pointer-events-none transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Prev</span>
              </button>
              <span className="px-2 py-1 font-mono text-slate-200">
                {page} / {paymentsData.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(paymentsData.totalPages, p + 1))}
                disabled={page >= paymentsData.totalPages}
                className="flex items-center gap-1 px-3 py-2 min-h-[40px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 disabled:pointer-events-none transition-colors"
              >
                <span>Next</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Record Payment Modal */}
      {isRecordModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden my-auto">
            <div className="flex items-center justify-between border-b border-slate-800 p-4 sm:p-6 shrink-0">
              <div className="flex items-center gap-2">
                <IndianRupee className="h-5 w-5 text-emerald-400 shrink-0" />
                <h3 className="text-base font-semibold text-slate-100">Record Subscriber Payment</h3>
              </div>
              <button
                onClick={() => setIsRecordModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 min-h-[40px] min-w-[40px] flex items-center justify-center"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onRecordSubmit)} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 text-xs">
              {/* Customer Selection */}
              <div>
                <label className="text-slate-400 block mb-1">Subscriber *</label>
                <select
                  {...register('customerId', { required: 'Please select a subscriber' })}
                  onChange={handleCustomerChange}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 min-h-[40px] text-slate-100 focus:outline-none focus:border-emerald-500"
                >
                  <option value="">-- Choose Subscriber --</option>
                  {customersData?.items?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.customerCode}) - {c.mobile}
                    </option>
                  ))}
                </select>
                {formErrors.customerId && (
                  <span className="text-rose-400 text-[10px]">{formErrors.customerId.message as string}</span>
                )}
              </div>

              {/* Unpaid Invoices Dropdown */}
              {selectedCustId && (
                <div>
                  <label className="text-slate-400 block mb-1">Apply to Invoice (Optional)</label>
                  <select
                    {...register('invoiceId')}
                    onChange={handleInvoiceChange}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 min-h-[40px] text-slate-100 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">-- Direct Advance / General Collection --</option>
                    {customerInvoicesData?.items?.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoiceNumber} (Balance Due: ₹{inv.balanceDue || inv.totalAmount})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Amount */}
              <div>
                <label className="text-slate-400 block mb-1">Amount to Collect (₹) *</label>
                <input
                  type="number"
                  step="0.01"
                  {...register('amount', {
                    required: 'Amount is required',
                    min: { value: 1, message: 'Minimum collection amount is ₹1.00' },
                  })}
                  placeholder="0.00"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 min-h-[40px] font-mono text-slate-100 text-sm font-semibold focus:outline-none focus:border-emerald-500"
                />
                {formErrors.amount && (
                  <span className="text-rose-400 text-[10px]">{formErrors.amount.message as string}</span>
                )}
              </div>

              {/* Payment Method */}
              <div>
                <label className="text-slate-400 block mb-1">Payment Method *</label>
                <select
                  {...register('paymentMethod')}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 min-h-[40px] text-slate-100 focus:outline-none focus:border-emerald-500"
                >
                  <option value="UPI">UPI (Google Pay / PhonePe / Paytm / BHIM)</option>
                  <option value="CASH">Cash Collection</option>
                  <option value="BANK_TRANSFER">Direct Bank Transfer (NEFT/RTGS/IMPS)</option>
                  <option value="CHEQUE">Cheque / Demand Draft</option>
                  <option value="ONLINE_GATEWAY">Online Gateway Settlement</option>
                </select>
              </div>

              {/* Transaction Ref */}
              <div>
                <label className="text-slate-400 block mb-1">Transaction Ref / Cheque No.</label>
                <input
                  {...register('transactionRef')}
                  placeholder="e.g. UPI Ref / UTR / Cheque Number"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 min-h-[40px] text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="text-slate-400 block mb-1">Remarks / Memo</label>
                <input
                  {...register('notes')}
                  placeholder="Optional internal remarks"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 min-h-[40px] text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsRecordModalOpen(false)}
                  className="px-4 py-2.5 min-h-[40px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={recordMutation.isPending}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 min-h-[40px] rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                >
                  {recordMutation.isPending && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                  <span>Record & Generate Receipt</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable Money Receipt Modal */}
      {selectedPaymentForReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden my-auto">
            <div className="flex items-center justify-between border-b border-slate-800 p-4 sm:p-6 shrink-0 print:hidden">
              <h3 className="text-sm font-semibold text-slate-100">Payment Receipt Slip</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrintReceipt}
                  className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Print</span>
                </button>
                <button
                  onClick={() => setSelectedPaymentForReceipt(null)}
                  className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 min-h-[40px] min-w-[40px] flex items-center justify-center"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Receipt Content */}
            <div
              id="printable-receipt"
              className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 text-xs bg-slate-950 border border-slate-800 print:border-none print:bg-white print:text-black rounded-xl m-4"
            >
              <div className="text-center border-b border-slate-800 print:border-slate-300 pb-3">
                <h2 className="text-base font-bold text-slate-100 print:text-black">MONEY RECEIPT</h2>
                <p className="font-mono text-xs text-blue-400 print:text-black mt-0.5">
                  #{selectedPaymentForReceipt.receiptNumber}
                </p>
                <p className="text-[10px] text-slate-500 mt-1">SpeedNet Broadband Operations</p>
              </div>

              <div className="space-y-2 text-slate-300 print:text-slate-800">
                <div className="flex justify-between py-1 border-b border-slate-800/60 print:border-slate-200">
                  <span className="text-slate-500">Date & Time:</span>
                  <span className="font-mono">
                    {new Date(selectedPaymentForReceipt.paidAt).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60 print:border-slate-200">
                  <span className="text-slate-500">Received From:</span>
                  <span className="font-semibold text-slate-100 print:text-black">
                    {selectedPaymentForReceipt.customer?.name || 'Subscriber'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/60 print:border-slate-200">
                  <span className="text-slate-500">Customer Code:</span>
                  <span className="font-mono">
                    {selectedPaymentForReceipt.customer?.customerCode || '—'}
                  </span>
                </div>
                {selectedPaymentForReceipt.invoice && (
                  <div className="flex justify-between py-1 border-b border-slate-800/60 print:border-slate-200">
                    <span className="text-slate-500">Invoice Reference:</span>
                    <span className="font-mono text-blue-400 print:text-black">
                      {selectedPaymentForReceipt.invoice.invoiceNumber}
                    </span>
                  </div>
                )}
                <div className="flex justify-between py-1 border-b border-slate-800/60 print:border-slate-200">
                  <span className="text-slate-500">Payment Mode:</span>
                  <span className="font-medium">{selectedPaymentForReceipt.paymentMethod}</span>
                </div>
                {selectedPaymentForReceipt.transactionRef && (
                  <div className="flex justify-between py-1 border-b border-slate-800/60 print:border-slate-200">
                    <span className="text-slate-500">Txn Ref / UTR:</span>
                    <span className="font-mono">{selectedPaymentForReceipt.transactionRef}</span>
                  </div>
                )}
                <div className="flex justify-between py-2 rounded bg-slate-900 print:bg-slate-100 p-2 text-sm font-bold mt-2">
                  <span className="text-slate-300 print:text-black">Amount Settled:</span>
                  <span className="font-mono text-emerald-400 print:text-emerald-700">
                    ₹ {Number(selectedPaymentForReceipt.amount).toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="text-center pt-2 text-[10px] text-slate-500">
                This is a computer generated payment receipt acknowledgment.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Refund Confirmation Modal */}
      <ConfirmationModal
        isOpen={!!refundTarget}
        onClose={() => setRefundTarget(null)}
        onConfirm={() => {
          if (refundTarget) {
            refundMutation.mutate(refundTarget.id);
          }
        }}
        title="Process Ledger Refund"
        message={`Are you sure you want to refund payment receipt ${refundTarget?.receiptNumber} of ₹${Number(refundTarget?.amount || 0).toFixed(2)}? This will adjust the ledger and recalculate invoice balance due.`}
        confirmText="Confirm Refund"
        variant="danger"
        isLoading={refundMutation.isPending}
      />
    </div>
  );
}

export default function PaymentsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6 max-w-[1440px] mx-auto pb-12 p-4 sm:p-6">
          <div className="h-8 w-48 bg-slate-800 rounded-xl animate-pulse" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-slate-900 border border-slate-800 rounded-2xl animate-pulse" />
            ))}
          </div>
          <TableSkeleton rows={5} cols={5} />
        </div>
      }
    >
      <PaymentsContent />
    </Suspense>
  );
}
