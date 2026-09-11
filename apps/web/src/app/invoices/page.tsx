'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import {
  Receipt,
  Plus,
  Search,
  IndianRupee,
  Printer,
  CheckCircle,
  CheckCircle2,
  AlertTriangle,
  X,
  Calendar,
  Clock,
  CreditCard,
  Ban,
  FileText,
  Trash2,
  Building,
  User,
  ShieldAlert,
  Zap,
  RefreshCw,
  Copy,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { StatusBadge } from '../../components/StatusBadge';
import {
  calculateInvoiceTotals,
  calculatePaymentSettlement,
  InvoiceStatus,
  PaymentMethod,
} from '@isp-crm/shared';

interface InvoiceItem {
  id?: string;
  description: string;
  sacCode: string;
  quantity: number;
  unitPrice: string | number;
  discountAmount: string | number;
  taxRatePercent: string | number;
  taxAmount: string | number;
  totalAmount: string | number;
}

interface PaymentRecord {
  id: string;
  receiptNumber: string;
  amount: string;
  paymentMethod: string;
  transactionRef?: string | null;
  gatewayOrderId?: string | null;
  gatewayPaymentId?: string | null;
  idempotencyKey?: string | null;
  paidAt: string;
  notes?: string | null;
}

interface Invoice {
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
  customer: {
    id: string;
    name: string;
    customerCode: string;
    mobile?: string;
    email?: string;
    username?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    gstin?: string;
  };
  organization?: {
    name: string;
    legalName?: string;
    gstin?: string;
    email: string;
    phone: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
  };
  items: InvoiceItem[];
  payments: PaymentRecord[];
}

interface CustomerOption {
  id: string;
  name: string;
  customerCode: string;
  username: string;
  mobile: string;
  state?: string;
}

export default function InvoicesPage() {
  const queryClient = useQueryClient();
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);

  // Online Checkout Modal State
  const [isOnlineCheckoutOpen, setIsOnlineCheckoutOpen] = useState(false);
  const [checkoutInvoice, setCheckoutInvoice] = useState<Invoice | null>(null);
  const [checkoutIntent, setCheckoutIntent] = useState<any>(null);
  const [checkoutStep, setCheckoutStep] = useState<'INITIAL' | 'PROCESSING' | 'SUCCESS' | 'ERROR'>('INITIAL');
  const [checkoutResult, setCheckoutResult] = useState<any>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // 1. Fetch Invoices List
  const { data: invoicesData, isLoading } = useQuery({
    queryKey: ['invoices', selectedStatus, searchQuery],
    queryFn: () =>
      apiFetch<{ items: Invoice[]; total: number; totalPages: number }>(
        `/invoices?status=${selectedStatus}&search=${encodeURIComponent(searchQuery)}`,
      ),
  });

  // 2. Fetch KPI Metrics
  const { data: metrics } = useQuery({
    queryKey: ['invoice-metrics'],
    queryFn: () =>
      apiFetch<{
        totalInvoiced: string;
        totalCollected: string;
        totalOutstanding: string;
        overdueCount: number;
      }>('/invoices/metrics'),
  });

  // 3. Fetch Customers for Create Invoice dropdown
  const { data: customersData } = useQuery({
    queryKey: ['customers-picker'],
    queryFn: () => apiFetch<{ items: CustomerOption[] }>('/customers?limit=100'),
    enabled: isCreateOpen,
  });

  // Create Invoice Form
  const {
    register: registerInvoice,
    handleSubmit: handleInvoiceSubmit,
    reset: resetInvoiceForm,
    watch: watchInvoice,
    control: invoiceControl,
  } = useForm({
    defaultValues: {
      customerId: '',
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      discountAmount: 0,
      notes: '',
      status: 'ISSUED',
      items: [
        {
          description: 'High-Speed Fiber Broadband Service (SAC 998422)',
          sacCode: '998422',
          quantity: 1,
          unitPrice: 799,
          discountAmount: 0,
          taxRatePercent: 18,
        },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: invoiceControl,
    name: 'items',
  });

  const watchedItems = watchInvoice('items');
  const watchedDiscount = watchInvoice('discountAmount');

  // Compute live GST preview
  const liveTotals = React.useMemo(() => {
    try {
      return calculateInvoiceTotals({
        items: (watchedItems || []).map((i) => ({
          description: i.description || 'Item',
          sacCode: i.sacCode || '998422',
          quantity: Number(i.quantity) || 1,
          unitPrice: i.unitPrice || 0,
          discountAmount: i.discountAmount || 0,
          taxRatePercent: i.taxRatePercent !== undefined ? i.taxRatePercent : 18,
        })),
        invoiceDiscountAmount: watchedDiscount || 0,
        isIntraState: true,
      });
    } catch {
      return null;
    }
  }, [watchedItems, watchedDiscount]);

  // Create Invoice Mutation
  const createInvoiceMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch('/invoices', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-metrics'] });
      setIsCreateOpen(false);
      resetInvoiceForm();
    },
  });

  // Record Manual Payment Form
  const {
    register: registerPayment,
    handleSubmit: handlePaymentSubmit,
    reset: resetPaymentForm,
    watch: watchPayment,
  } = useForm({
    defaultValues: {
      amount: '',
      paymentMethod: 'UPI',
      transactionRef: '',
      notes: '',
    },
  });

  const watchedPaymentAmount = watchPayment('amount');

  // Compute live payment settlement preview
  const liveSettlement = React.useMemo(() => {
    if (!paymentInvoice || !watchedPaymentAmount) return null;
    try {
      return calculatePaymentSettlement({
        totalAmount: paymentInvoice.totalAmount,
        currentPaidAmount: paymentInvoice.paidAmount,
        paymentAmount: watchedPaymentAmount,
      });
    } catch (e: any) {
      return { error: e.message };
    }
  }, [paymentInvoice, watchedPaymentAmount]);

  // Record Manual Payment Mutation
  const recordPaymentMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch('/payments', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['invoice-metrics'] }),
      ]);
      if (selectedInvoice) {
        const updated = await apiFetch<Invoice>(`/invoices/${selectedInvoice.id}`);
        setSelectedInvoice(updated);
      }
      setIsPaymentOpen(false);
      resetPaymentForm();
    },
  });

  // Cancel Invoice Mutation
  const cancelInvoiceMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      apiFetch(`/invoices/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-metrics'] });
      if (selectedInvoice) {
        const updated = await apiFetch<Invoice>(`/invoices/${selectedInvoice.id}`);
        setSelectedInvoice(updated);
      }
    },
  });

  const handleOpenDetails = async (invoice: Invoice) => {
    try {
      const fullInvoice = await apiFetch<Invoice>(`/invoices/${invoice.id}`);
      setSelectedInvoice(fullInvoice);
      setIsDetailsOpen(true);
    } catch {
      setSelectedInvoice(invoice);
      setIsDetailsOpen(true);
    }
  };

  const handleOpenManualPayment = (invoice: Invoice) => {
    setPaymentInvoice(invoice);
    resetPaymentForm({
      amount: invoice.balanceDue,
      paymentMethod: 'UPI',
      transactionRef: '',
      notes: '',
    });
    setIsPaymentOpen(true);
  };

  // Online Checkout Handlers
  const handleOpenOnlineCheckout = async (invoice: Invoice) => {
    setCheckoutInvoice(invoice);
    setCheckoutStep('INITIAL');
    setCheckoutResult(null);
    setCheckoutError(null);
    setIsOnlineCheckoutOpen(true);

    try {
      // Step 1: Create Payment Intent via PaymentProvider
      const intent = await apiFetch<any>('/payments/create-intent', {
        method: 'POST',
        body: JSON.stringify({ invoiceId: invoice.id }),
      });
      setCheckoutIntent(intent);
    } catch (err: any) {
      setCheckoutError(err.message || 'Failed to initialize payment gateway');
      setCheckoutStep('ERROR');
    }
  };

  const handleExecuteOnlineCheckout = async (isDuplicateTest = false, isFailTest = false) => {
    if (!checkoutInvoice || !checkoutIntent) return;
    setCheckoutStep('PROCESSING');
    setCheckoutError(null);

    const ts = Date.now();
    // If testing duplicate callback, reuse previous gatewayPaymentId
    const gatewayPaymentId =
      isDuplicateTest && checkoutResult?.payment?.gatewayPaymentId
        ? checkoutResult.payment.gatewayPaymentId
        : isFailTest
          ? `mock_pay_fail_${ts}`
          : `mock_pay_${ts}_${Math.random().toString(36).substring(2, 7)}`;

    const signature = isFailTest ? 'INVALID_SIGNATURE' : `sig_${ts}`;
    const idempotencyKey = isDuplicateTest
      ? checkoutResult?.payment?.idempotencyKey || gatewayPaymentId
      : `idem_${ts}_${Math.random().toString(36).substring(2, 6)}`;

    try {
      const response = await apiFetch<any>('/payments/verify', {
        method: 'POST',
        body: JSON.stringify({
          invoiceId: checkoutInvoice.id,
          gatewayOrderId: checkoutIntent.gatewayOrderId,
          gatewayPaymentId,
          signature,
          idempotencyKey,
        }),
      });

      setCheckoutResult(response);
      setCheckoutStep('SUCCESS');

      // Invalidate queries so dashboard and lists update automatically
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['invoice-metrics'] }),
        queryClient.invalidateQueries({ queryKey: ['subscriptions'] }),
      ]);

      if (selectedInvoice && selectedInvoice.id === checkoutInvoice.id) {
        const updated = await apiFetch<Invoice>(`/invoices/${selectedInvoice.id}`);
        setSelectedInvoice(updated);
      }
    } catch (err: any) {
      setCheckoutError(err.message || 'Online payment execution failed');
      setCheckoutStep('ERROR');
    }
  };

  const statusTabs = [
    { label: 'All Invoices', value: 'ALL' },
    { label: 'Issued (Unpaid)', value: 'ISSUED' },
    { label: 'Partially Paid', value: 'PARTIALLY_PAID' },
    { label: 'Paid in Full', value: 'PAID' },
    { label: 'Overdue', value: 'OVERDUE' },
    { label: 'Draft', value: 'DRAFT' },
    { label: 'Cancelled', value: 'CANCELLED' },
  ];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <Receipt className="w-7 h-7 text-indigo-400" />
            Billing & Invoices
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            PaymentProvider gateway engine, idempotent settlement, SAC 998422 GST invoicing & subscription auto-renewal.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              resetInvoiceForm();
              setIsCreateOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium text-sm transition shadow-lg shadow-indigo-600/20"
          >
            <Plus className="w-4 h-4" />
            Create Invoice
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Total Invoiced</p>
            <p className="text-2xl font-bold text-white mt-1">
              ₹{metrics?.totalInvoiced ?? '0.00'}
            </p>
          </div>
          <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-indigo-400">
            <Receipt className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Total Collected</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">
              ₹{metrics?.totalCollected ?? '0.00'}
            </p>
          </div>
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400">
            <CheckCircle className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Outstanding Due</p>
            <p className="text-2xl font-bold text-amber-400 mt-1">
              ₹{metrics?.totalOutstanding ?? '0.00'}
            </p>
          </div>
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Overdue Invoices</p>
            <p className="text-2xl font-bold text-rose-400 mt-1">
              {metrics?.overdueCount ?? 0}
            </p>
          </div>
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400">
            <AlertTriangle className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Status Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 lg:pb-0 scrollbar-none">
            {statusTabs.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setSelectedStatus(tab.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                  selectedStatus === tab.value
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Input */}
          <div className="relative min-w-[280px]">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search invoice #, customer, mobile..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950/70 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
            />
          </div>
        </div>
      </div>

      {/* Invoices Data Table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Invoice #</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Invoice Date</th>
                <th className="py-3 px-4">Due Date</th>
                <th className="py-3 px-4 text-right">Subtotal</th>
                <th className="py-3 px-4 text-right">GST Tax</th>
                <th className="py-3 px-4 text-right">Total Amount</th>
                <th className="py-3 px-4 text-right">Balance Due</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-500">
                    Loading invoices ledger...
                  </td>
                </tr>
              ) : !invoicesData?.items || invoicesData.items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-slate-500">
                    <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    No invoices found matching current filter.
                  </td>
                </tr>
              ) : (
                invoicesData.items.map((inv) => {
                  const isOverdue =
                    new Date(inv.dueDate) < new Date() &&
                    inv.status !== 'PAID' &&
                    inv.status !== 'CANCELLED';

                  return (
                    <tr
                      key={inv.id}
                      className="hover:bg-slate-800/40 transition cursor-pointer"
                      onClick={() => handleOpenDetails(inv)}
                    >
                      <td className="py-3 px-4 font-mono font-medium text-indigo-400">
                        {inv.invoiceNumber}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-white">{inv.customer?.name}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {inv.customer?.customerCode} • {inv.customer?.mobile || 'No mobile'}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {new Date(inv.invoiceDate).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4">
                        <span className={isOverdue ? 'text-rose-400 font-medium' : 'text-slate-400'}>
                          {new Date(inv.dueDate).toLocaleDateString()}
                        </span>
                        {isOverdue && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-rose-500/20 text-rose-300 font-semibold">
                            OVERDUE
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono">
                        ₹{inv.subtotal}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-400">
                        ₹{(
                          Number(inv.cgstAmount || 0) +
                          Number(inv.sgstAmount || 0) +
                          Number(inv.igstAmount || 0)
                        ).toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-white">
                        ₹{inv.totalAmount}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold">
                        {Number(inv.balanceDue) > 0 ? (
                          <span className="text-amber-400">₹{inv.balanceDue}</span>
                        ) : (
                          <span className="text-emerald-400">₹0.00</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <StatusBadge status={inv.status} />
                      </td>
                      <td
                        className="py-3 px-4 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-2">
                          {/* Prominent Online PAY button */}
                          {inv.status !== 'PAID' && inv.status !== 'CANCELLED' && (
                            <button
                              onClick={() => handleOpenOnlineCheckout(inv)}
                              className="px-2.5 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded text-[11px] transition flex items-center gap-1 shadow-sm shadow-emerald-500/30"
                              title="Online Checkout & Tri-State Settlement"
                            >
                              <Zap className="w-3.5 h-3.5 fill-current" />
                              Pay
                            </button>
                          )}
                          <button
                            onClick={() => handleOpenDetails(inv)}
                            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded text-[11px] transition flex items-center gap-1"
                          >
                            <Printer className="w-3 h-3" />
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 1. INTERACTIVE ONLINE PAYMENT GATEWAY CHECKOUT MODAL        */}
      {/* ============================================================ */}
      {isOnlineCheckoutOpen && checkoutInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-indigo-900/60 to-slate-900 px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-500/20 border border-emerald-500/30 rounded-lg text-emerald-400">
                  <Zap className="w-5 h-5 fill-current" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Online Payment Gateway</h3>
                  <p className="text-xs text-slate-400">
                    PaymentProvider • Mock Gateway • Idempotent Tri-State Settlement
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsOnlineCheckoutOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 text-xs text-slate-300">
              {/* Invoice Summary Box */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="flex justify-between items-center pb-2 border-b border-slate-800/80">
                  <span className="text-slate-400">Invoice Number:</span>
                  <span className="font-mono font-bold text-indigo-400">
                    {checkoutInvoice.invoiceNumber}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Subscriber:</span>
                  <span className="text-white font-medium">{checkoutInvoice.customer.name}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Current Status:</span>
                  <StatusBadge status={checkoutInvoice.status} />
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-slate-800/80">
                  <span className="text-slate-200 font-semibold">Total Payable Amount:</span>
                  <span className="text-xl font-bold font-mono text-emerald-400">
                    ₹{checkoutInvoice.balanceDue}
                  </span>
                </div>
              </div>

              {/* Gateway Provider Selection */}
              <div className="p-3 bg-slate-950/40 border border-slate-800 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-indigo-400" />
                  <div>
                    <span className="font-semibold text-white block">Mock Gateway Simulator</span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      Order: {checkoutIntent?.gatewayOrderId || 'Initializing...'}
                    </span>
                  </div>
                </div>
                <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded text-[10px] font-bold">
                  TEST MODE
                </span>
              </div>

              {/* Checkout Progress / State */}
              {checkoutStep === 'PROCESSING' && (
                <div className="py-6 text-center space-y-3">
                  <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin mx-auto" />
                  <p className="text-sm font-semibold text-white">
                    Processing transaction via PaymentProvider...
                  </p>
                  <p className="text-slate-400 text-xs">
                    Reconciling invoice balance, issuing receipt, and extending subscription.
                  </p>
                </div>
              )}

              {checkoutStep === 'SUCCESS' && checkoutResult && (
                <div className="p-4 bg-emerald-950/20 border border-emerald-500/30 rounded-xl space-y-3">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                    <CheckCircle2 className="w-5 h-5" />
                    {checkoutResult.isDuplicate
                      ? 'Idempotent Duplicate Callback Verified!'
                      : 'Payment Settled Successfully!'}
                  </div>
                  <div className="space-y-1 font-mono text-[11px] bg-slate-950/80 p-3 rounded-lg border border-slate-800">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Invoice Status:</span>
                      <span className="text-emerald-400 font-bold">PAID</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Payment Status:</span>
                      <span className="text-emerald-400 font-bold">SUCCESS</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Subscription Status:</span>
                      <span className="text-emerald-400 font-bold">ACTIVE / RENEWED</span>
                    </div>
                    <div className="flex justify-between pt-1 border-t border-slate-800 text-slate-400">
                      <span>Receipt #:</span>
                      <span className="text-white">{checkoutResult.payment?.receiptNumber}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Gateway Payment ID:</span>
                      <span className="text-white truncate max-w-[180px]">
                        {checkoutResult.payment?.gatewayPaymentId}
                      </span>
                    </div>
                  </div>
                  {checkoutResult.isDuplicate && (
                    <p className="text-[11px] text-amber-300">
                      ⚡ <strong>Idempotency active:</strong> This payment was already registered.
                      The database skipped duplicate charging and subscription extension.
                    </p>
                  )}
                </div>
              )}

              {checkoutStep === 'ERROR' && checkoutError && (
                <div className="p-4 bg-rose-950/20 border border-rose-500/30 rounded-xl space-y-2 text-rose-300">
                  <div className="flex items-center gap-2 font-bold text-sm text-rose-400">
                    <AlertTriangle className="w-5 h-5" />
                    Payment Verification Failed
                  </div>
                  <p className="text-xs">{checkoutError}</p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="space-y-2 pt-2">
                {checkoutStep !== 'SUCCESS' ? (
                  <>
                    <button
                      onClick={() => handleExecuteOnlineCheckout(false, false)}
                      disabled={checkoutStep === 'PROCESSING' || !checkoutIntent}
                      className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                    >
                      <Zap className="w-4 h-4 fill-current" />
                      Pay ₹{checkoutInvoice.balanceDue} via Mock Gateway
                    </button>

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        onClick={() => handleExecuteOnlineCheckout(false, true)}
                        disabled={checkoutStep === 'PROCESSING' || !checkoutIntent}
                        className="py-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/30 rounded-lg text-xs font-medium transition flex items-center justify-center gap-1"
                        title="Simulate payment signature failure"
                      >
                        <ShieldAlert className="w-3.5 h-3.5" />
                        Test Signature Failure
                      </button>

                      <button
                        onClick={() => {
                          setIsOnlineCheckoutOpen(false);
                          handleOpenManualPayment(checkoutInvoice);
                        }}
                        className="py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition"
                      >
                        Switch to Manual / Cash
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    {/* Test Duplicate Callback Button */}
                    <button
                      onClick={() => handleExecuteOnlineCheckout(true, false)}
                      className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg text-xs transition flex items-center justify-center gap-2 shadow"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Test Duplicate Callback (Verify Idempotency)
                    </button>

                    <button
                      onClick={() => setIsOnlineCheckoutOpen(false)}
                      className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition"
                    >
                      Done & Close
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 2. INVOICE DETAILS & PRINTABLE GST TAX INVOICE MODAL         */}
      {/* ============================================================ */}
      {isDetailsOpen && selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            {/* Modal Actions Bar (hidden on print) */}
            <div className="sticky top-0 bg-slate-950/90 backdrop-blur px-6 py-4 border-b border-slate-800 flex items-center justify-between z-10 print:hidden">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-indigo-400" />
                <span className="font-semibold text-white">
                  Tax Invoice: {selectedInvoice.invoiceNumber}
                </span>
                <StatusBadge status={selectedInvoice.status} />
              </div>
              <div className="flex items-center gap-2">
                {/* Prominent Online Pay Button */}
                {selectedInvoice.status !== 'PAID' && selectedInvoice.status !== 'CANCELLED' && (
                  <button
                    onClick={() => handleOpenOnlineCheckout(selectedInvoice)}
                    className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg text-xs transition flex items-center gap-1.5 shadow-sm shadow-emerald-500/20"
                  >
                    <Zap className="w-3.5 h-3.5 fill-current" />
                    Pay Online
                  </button>
                )}
                {selectedInvoice.status !== 'PAID' && selectedInvoice.status !== 'CANCELLED' && (
                  <button
                    onClick={() => handleOpenManualPayment(selectedInvoice)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition flex items-center gap-1.5"
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    Record Cash/UPI
                  </button>
                )}
                {selectedInvoice.status !== 'PAID' && selectedInvoice.status !== 'CANCELLED' && (
                  <button
                    onClick={() => {
                      if (confirm('Are you sure you want to cancel this invoice?')) {
                        cancelInvoiceMutation.mutate({ id: selectedInvoice.id });
                      }
                    }}
                    className="px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/30 rounded-lg text-xs font-medium transition flex items-center gap-1"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    Cancel
                  </button>
                )}
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-medium transition flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print / PDF
                </button>
                <button
                  onClick={() => setIsDetailsOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Printable Tax Invoice Document Container */}
            <div className="p-8 space-y-6 text-slate-200" id="printable-invoice">
              {/* Top Header: ISP Info & Tax Invoice Title */}
              <div className="flex flex-col sm:flex-row justify-between items-start pb-6 border-b border-slate-800 gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Building className="w-5 h-5 text-indigo-400" />
                    <h2 className="text-xl font-bold text-white">
                      {selectedInvoice.organization?.legalName ||
                        selectedInvoice.organization?.name ||
                        'Internet Service Provider'}
                    </h2>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {selectedInvoice.organization?.address || 'ISP Operations Office'}
                  </p>
                  <p className="text-xs text-slate-400">
                    {selectedInvoice.organization?.city}, {selectedInvoice.organization?.state}{' '}
                    {selectedInvoice.organization?.pincode}
                  </p>
                  <p className="text-xs font-mono text-indigo-300 mt-1 font-semibold">
                    GSTIN: {selectedInvoice.organization?.gstin || '27AAAAA0000A1Z5 (Maharashtra)'}
                  </p>
                </div>

                <div className="text-right sm:self-start">
                  <span className="text-xs font-bold uppercase tracking-widest text-indigo-400 bg-indigo-500/10 px-2.5 py-1 rounded border border-indigo-500/20">
                    GST TAX INVOICE
                  </span>
                  <div className="mt-2 text-sm font-mono font-bold text-white">
                    {selectedInvoice.invoiceNumber}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    Date: {new Date(selectedInvoice.invoiceDate).toLocaleDateString()}
                  </div>
                  <div className="text-xs text-amber-400 font-medium">
                    Due Date: {new Date(selectedInvoice.dueDate).toLocaleDateString()}
                  </div>
                </div>
              </div>

              {/* Bill To & Supply Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 p-4 bg-slate-950/50 rounded-xl border border-slate-800/80">
                <div>
                  <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-400 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    Billed To (Subscriber)
                  </p>
                  <p className="font-bold text-white mt-1 text-sm">{selectedInvoice.customer.name}</p>
                  <p className="text-xs font-mono text-indigo-400">
                    Subscriber ID: {selectedInvoice.customer.customerCode}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">{selectedInvoice.customer.address}</p>
                  <p className="text-xs text-slate-400">
                    {selectedInvoice.customer.city}, {selectedInvoice.customer.state}{' '}
                    {selectedInvoice.customer.pincode}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Mobile: {selectedInvoice.customer.mobile || 'N/A'} • Username:{' '}
                    {selectedInvoice.customer.username}
                  </p>
                  {selectedInvoice.customer.gstin && (
                    <p className="text-xs font-mono text-emerald-400 mt-1">
                      Customer GSTIN: {selectedInvoice.customer.gstin}
                    </p>
                  )}
                </div>

                <div className="sm:text-right space-y-1">
                  <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">
                    Service Classification
                  </p>
                  <p className="text-xs text-slate-300">
                    Category:{' '}
                    <span className="font-semibold text-white">Telecommunication Services</span>
                  </p>
                  <p className="text-xs text-slate-300">
                    SAC Code: <span className="font-mono font-semibold text-indigo-400">998422</span>
                  </p>
                  <p className="text-xs text-slate-300">
                    Place of Supply:{' '}
                    <span className="font-semibold text-white">
                      {selectedInvoice.customer.state || 'Intra-State'}
                    </span>
                  </p>
                  <p className="text-xs text-slate-300">
                    Payment Status:{' '}
                    <span className="font-semibold text-white">{selectedInvoice.status}</span>
                  </p>
                </div>
              </div>

              {/* Invoice Line Items Table */}
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3">#</th>
                      <th className="py-2.5 px-3">Description</th>
                      <th className="py-2.5 px-3">SAC</th>
                      <th className="py-2.5 px-3 text-center">Qty</th>
                      <th className="py-2.5 px-3 text-right">Unit Price</th>
                      <th className="py-2.5 px-3 text-right">Disc.</th>
                      <th className="py-2.5 px-3 text-right">Taxable</th>
                      <th className="py-2.5 px-3 text-right">GST Rate</th>
                      <th className="py-2.5 px-3 text-right">GST Amount</th>
                      <th className="py-2.5 px-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 bg-slate-900/40">
                    {selectedInvoice.items?.map((item, idx) => {
                      const taxable = (
                        Number(item.quantity || 1) * Number(item.unitPrice || 0) -
                        Number(item.discountAmount || 0)
                      ).toFixed(2);

                      return (
                        <tr key={idx} className="hover:bg-slate-800/20">
                          <td className="py-2.5 px-3 text-slate-500 font-mono">{idx + 1}</td>
                          <td className="py-2.5 px-3 font-medium text-white">{item.description}</td>
                          <td className="py-2.5 px-3 font-mono text-indigo-400">{item.sacCode}</td>
                          <td className="py-2.5 px-3 text-center font-mono">{item.quantity}</td>
                          <td className="py-2.5 px-3 text-right font-mono">₹{item.unitPrice}</td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-400">
                            ₹{item.discountAmount}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-white">₹{taxable}</td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-400">
                            {item.taxRatePercent}%
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-300">
                            ₹{item.taxAmount}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-semibold text-white">
                            ₹{item.totalAmount}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Financial Summary Breakdown */}
              <div className="flex flex-col sm:flex-row justify-between items-start gap-6 pt-2">
                <div className="max-w-xs text-xs text-slate-400 space-y-1">
                  <p className="font-semibold text-white">Terms & Conditions:</p>
                  <p>1. Payments are due within 7 days of invoice date.</p>
                  <p>2. Failure to pay may result in automated PPPoE radius suspension.</p>
                  {selectedInvoice.notes && (
                    <p className="text-indigo-300 mt-2 font-medium">Notes: {selectedInvoice.notes}</p>
                  )}
                </div>

                <div className="w-full sm:w-72 bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2 text-xs">
                  <div className="flex justify-between text-slate-400">
                    <span>Subtotal:</span>
                    <span className="font-mono text-white">₹{selectedInvoice.subtotal}</span>
                  </div>

                  {Number(selectedInvoice.discountAmount) > 0 && (
                    <div className="flex justify-between text-emerald-400">
                      <span>Invoice Discount:</span>
                      <span className="font-mono">- ₹{selectedInvoice.discountAmount}</span>
                    </div>
                  )}

                  {Number(selectedInvoice.cgstAmount) > 0 && (
                    <div className="flex justify-between text-slate-400">
                      <span>CGST (9.00%):</span>
                      <span className="font-mono text-white">₹{selectedInvoice.cgstAmount}</span>
                    </div>
                  )}

                  {Number(selectedInvoice.sgstAmount) > 0 && (
                    <div className="flex justify-between text-slate-400">
                      <span>SGST (9.00%):</span>
                      <span className="font-mono text-white">₹{selectedInvoice.sgstAmount}</span>
                    </div>
                  )}

                  {Number(selectedInvoice.igstAmount) > 0 && (
                    <div className="flex justify-between text-slate-400">
                      <span>IGST (18.00%):</span>
                      <span className="font-mono text-white">₹{selectedInvoice.igstAmount}</span>
                    </div>
                  )}

                  <div className="border-t border-slate-800 pt-2 flex justify-between font-bold text-sm text-white">
                    <span>Total Payable:</span>
                    <span className="font-mono text-indigo-400">₹{selectedInvoice.totalAmount}</span>
                  </div>

                  <div className="flex justify-between text-emerald-400 font-medium">
                    <span>Amount Paid:</span>
                    <span className="font-mono">₹{selectedInvoice.paidAmount}</span>
                  </div>

                  <div className="border-t border-slate-800 pt-2 flex justify-between font-bold text-sm">
                    <span className={Number(selectedInvoice.balanceDue) > 0 ? 'text-amber-400' : 'text-emerald-400'}>
                      Balance Due:
                    </span>
                    <span className={`font-mono ${Number(selectedInvoice.balanceDue) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      ₹{selectedInvoice.balanceDue}
                    </span>
                  </div>
                </div>
              </div>

              {/* Payment History Section */}
              {selectedInvoice.payments && selectedInvoice.payments.length > 0 && (
                <div className="border-t border-slate-800 pt-4 space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-emerald-400" />
                    Payment Settlement History
                  </h3>
                  <div className="overflow-x-auto rounded-lg border border-slate-800">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800">
                        <tr>
                          <th className="py-2 px-3">Receipt #</th>
                          <th className="py-2 px-3">Date</th>
                          <th className="py-2 px-3">Method</th>
                          <th className="py-2 px-3">Ref / Gateway ID</th>
                          <th className="py-2 px-3 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 bg-slate-900/30">
                        {selectedInvoice.payments.map((pmt) => (
                          <tr key={pmt.id}>
                            <td className="py-2 px-3 font-mono font-medium text-emerald-400">
                              {pmt.receiptNumber}
                            </td>
                            <td className="py-2 px-3 text-slate-400">
                              {new Date(pmt.paidAt).toLocaleString()}
                            </td>
                            <td className="py-2 px-3 font-medium text-slate-300">
                              {pmt.paymentMethod}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-500">
                              {pmt.gatewayPaymentId || pmt.transactionRef || 'N/A'}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-white">
                              ₹{pmt.amount}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 3. CREATE INVOICE MODAL                                      */}
      {/* ============================================================ */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2">
                <Receipt className="w-6 h-6 text-indigo-400" />
                <h2 className="text-lg font-bold text-white">Create GST Invoice</h2>
              </div>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={handleInvoiceSubmit((data) =>
                createInvoiceMutation.mutate({
                  ...data,
                  discountAmount: Number(data.discountAmount) || 0,
                  items: data.items.map((i) => ({
                    ...i,
                    quantity: Number(i.quantity) || 1,
                    unitPrice: Number(i.unitPrice) || 0,
                    discountAmount: Number(i.discountAmount) || 0,
                    taxRatePercent: Number(i.taxRatePercent) || 18,
                  })),
                }),
              )}
              className="space-y-5"
            >
              {/* Customer & Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1 sm:col-span-1">
                  <label className="text-xs font-medium text-slate-300">Select Customer *</label>
                  <select
                    {...registerInvoice('customerId', { required: true })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">-- Choose Subscriber --</option>
                    {customersData?.items?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.customerCode} - {c.username})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300">Due Date *</label>
                  <input
                    type="date"
                    {...registerInvoice('dueDate', { required: true })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300">Invoice Status</label>
                  <select
                    {...registerInvoice('status')}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="ISSUED">ISSUED (Standard)</option>
                    <option value="DRAFT">DRAFT (Not Finalized)</option>
                  </select>
                </div>
              </div>

              {/* Line Items Builder */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Line Items (SAC 998422)
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      append({
                        description: 'Fiber Internet Service Addon',
                        sacCode: '998422',
                        quantity: 1,
                        unitPrice: 500,
                        discountAmount: 0,
                        taxRatePercent: 18,
                      })
                    }
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-indigo-400 hover:text-white rounded text-xs transition flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Item
                  </button>
                </div>

                <div className="space-y-3">
                  {fields.map((field, index) => (
                    <div
                      key={field.id}
                      className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl grid grid-cols-1 sm:grid-cols-12 gap-2 items-center"
                    >
                      <div className="sm:col-span-4">
                        <input
                          type="text"
                          placeholder="Description"
                          {...registerInvoice(`items.${index}.description` as const, {
                            required: true,
                          })}
                          className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <input
                          type="text"
                          placeholder="SAC Code"
                          {...registerInvoice(`items.${index}.sacCode` as const)}
                          className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs text-white font-mono"
                        />
                      </div>
                      <div className="sm:col-span-1">
                        <input
                          type="number"
                          placeholder="Qty"
                          min="1"
                          {...registerInvoice(`items.${index}.quantity` as const, {
                            valueAsNumber: true,
                          })}
                          className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs text-white text-center font-mono"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Unit Price (₹)"
                          {...registerInvoice(`items.${index}.unitPrice` as const, {
                            valueAsNumber: true,
                          })}
                          className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs text-white text-right font-mono"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Disc. (₹)"
                          {...registerInvoice(`items.${index}.discountAmount` as const, {
                            valueAsNumber: true,
                          })}
                          className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs text-white text-right font-mono"
                        />
                      </div>
                      <div className="sm:col-span-1 flex justify-center">
                        {fields.length > 1 && (
                          <button
                            type="button"
                            onClick={() => remove(index)}
                            className="p-1.5 text-rose-400 hover:bg-rose-500/20 rounded transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Invoice-level Discount & Notes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300">Invoice Discount (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    {...registerInvoice('discountAmount', { valueAsNumber: true })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-300">Notes / Memo</label>
                  <input
                    type="text"
                    placeholder="e.g. Monthly subscription bill"
                    {...registerInvoice('notes')}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>

              {/* Real-time Decimal Calculation Preview */}
              {liveTotals && (
                <div className="p-4 bg-indigo-950/20 border border-indigo-500/30 rounded-xl space-y-2 text-xs">
                  <p className="font-semibold text-indigo-300 uppercase tracking-wider text-[11px]">
                    Live Decimal & GST Calculation Preview (Zero Float Drift)
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-mono">
                    <div>
                      <span className="text-slate-400 block">Subtotal:</span>
                      <span className="text-white font-bold">₹{liveTotals.subtotal}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">CGST (9%) + SGST (9%):</span>
                      <span className="text-white font-bold">
                        ₹{liveTotals.cgstAmount} + ₹{liveTotals.sgstAmount}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Total GST (18%):</span>
                      <span className="text-white font-bold">₹{liveTotals.totalTaxAmount}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Grand Total:</span>
                      <span className="text-indigo-400 font-bold text-sm">
                        ₹{liveTotals.totalAmount}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Submit / Cancel Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createInvoiceMutation.isPending}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition flex items-center gap-2 shadow-lg shadow-indigo-600/20 disabled:opacity-50"
                >
                  {createInvoiceMutation.isPending ? 'Generating Invoice...' : 'Generate Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 4. RECORD MANUAL PAYMENT MODAL                               */}
      {/* ============================================================ */}
      {isPaymentOpen && paymentInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-emerald-400" />
                <h2 className="text-base font-bold text-white">Record Manual Payment</h2>
              </div>
              <button
                onClick={() => setIsPaymentOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Invoice #:</span>
                <span className="font-mono font-bold text-indigo-400">
                  {paymentInvoice.invoiceNumber}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Customer:</span>
                <span className="text-white font-medium">{paymentInvoice.customer.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Total Invoiced:</span>
                <span className="font-mono text-white">₹{paymentInvoice.totalAmount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Already Paid:</span>
                <span className="font-mono text-emerald-400">₹{paymentInvoice.paidAmount}</span>
              </div>
              <div className="border-t border-slate-800/80 pt-1.5 flex justify-between font-bold">
                <span className="text-amber-400">Balance Due:</span>
                <span className="font-mono text-amber-400">₹{paymentInvoice.balanceDue}</span>
              </div>
            </div>

            <form
              onSubmit={handlePaymentSubmit((data) =>
                recordPaymentMutation.mutate({
                  customerId: paymentInvoice.customerId,
                  invoiceId: paymentInvoice.id,
                  amount: data.amount,
                  paymentMethod: data.paymentMethod,
                  transactionRef: data.transactionRef,
                  notes: data.notes,
                }),
              )}
              className="space-y-4 text-xs"
            >
              <div className="space-y-1">
                <label className="font-medium text-slate-300">Payment Amount (₹) *</label>
                <input
                  type="number"
                  step="0.01"
                  {...registerPayment('amount', { required: true })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-medium text-slate-300">Payment Method *</label>
                <select
                  {...registerPayment('paymentMethod', { required: true })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="UPI">UPI / QR Code</option>
                  <option value="CASH">Cash Collection</option>
                  <option value="BANK_TRANSFER">Bank Transfer / NEFT / IMPS</option>
                  <option value="ONLINE_GATEWAY">Online Gateway (Razorpay / PayU)</option>
                  <option value="CHEQUE">Cheque / Demand Draft</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-medium text-slate-300">Transaction Reference / UTR #</label>
                <input
                  type="text"
                  placeholder="e.g. UPI-938491028301"
                  {...registerPayment('transactionRef')}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-medium text-slate-300">Notes / Remarks</label>
                <input
                  type="text"
                  placeholder="e.g. Paid in cash at office"
                  {...registerPayment('notes')}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Settlement Preview */}
              {liveSettlement && (
                <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg font-mono text-[11px] space-y-1">
                  {'error' in liveSettlement ? (
                    <p className="text-rose-400 font-sans">{liveSettlement.error}</p>
                  ) : (
                    <>
                      <div className="flex justify-between text-slate-400">
                        <span>New Paid Amount:</span>
                        <span className="text-white">₹{liveSettlement.newPaidAmount}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Remaining Balance:</span>
                        <span className="text-white">₹{liveSettlement.balanceDue}</span>
                      </div>
                      <div className="flex justify-between font-bold pt-1 border-t border-slate-800">
                        <span>Target Status:</span>
                        <span
                          className={
                            liveSettlement.targetStatus === 'PAID'
                              ? 'text-emerald-400'
                              : 'text-amber-400'
                          }
                        >
                          {liveSettlement.targetStatus}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsPaymentOpen(false)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    recordPaymentMutation.isPending ||
                    Boolean(liveSettlement && 'error' in liveSettlement)
                  }
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition flex items-center gap-1.5 shadow-lg shadow-emerald-600/20 disabled:opacity-50"
                >
                  {recordPaymentMutation.isPending ? 'Processing...' : 'Settle Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
