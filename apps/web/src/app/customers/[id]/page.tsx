'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import {
  ArrowLeft,
  Users,
  Phone,
  Mail,
  MapPin,
  Wifi,
  ShieldCheck,
  ShieldAlert,
  Power,
  RotateCw,
  Edit,
  IndianRupee,
  Receipt,
  History,
  CreditCard,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  Radio,
  ExternalLink,
  Plus,
  RefreshCw,
  X,
  LifeBuoy,
} from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import { StatusBadge } from '../../../components/StatusBadge';
import { ConfirmationModal } from '../../../components/ConfirmationModal';
import { TableSkeleton, CardSkeleton } from '../../../components/LoadingSkeleton';
import { EmptyState } from '../../../components/EmptyState';
import { useToast } from '../../../components/Toast';
import { CustomerStatus } from '@isp-crm/shared';

interface CustomerDetails {
  id: string;
  organizationId: string;
  customerCode: string;
  name: string;
  mobile: string;
  phone?: string | null;
  email?: string | null;
  alternatePhone?: string | null;
  address: string;
  installationAddress?: string | null;
  area?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  aadhaarNumber?: string | null;
  gstin?: string | null;
  username: string;
  pppoeUsername?: string | null;
  pppoePassword?: string;
  staticIp?: string | null;
  macAddress?: string | null;
  status: CustomerStatus;
  installationDate?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  subscriptions?: Array<{
    id: string;
    status: string;
    startDate: string;
    endDate: string;
    price: number | string;
    billingCycle: string;
    autoRenew: boolean;
    gracePeriodDays: number;
    plan: {
      id: string;
      name: string;
      code: string;
      downloadSpeedMbps?: number;
      uploadSpeedMbps?: number;
      price: number | string;
      rateLimitString?: string;
    };
  }>;
  invoices?: Array<{
    id: string;
    invoiceNumber: string;
    invoiceDate: string;
    dueDate: string;
    totalAmount: string | number;
    paidAmount: string | number;
    status: string;
  }>;
  payments?: Array<{
    id: string;
    receiptNumber: string;
    amount: string | number;
    paymentMethod: string;
    status: string;
    paidAt: string;
    transactionRef?: string | null;
  }>;
  auditLogs?: Array<{
    id: string;
    action: string;
    entityType: string;
    details?: any;
    createdAt: string;
    adminUser?: {
      id: string;
      name: string;
      email: string;
    } | null;
  }>;
}

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const customerId = params?.id as string;

  const [activeTab, setActiveTab] = useState<'subscriptions' | 'invoices' | 'payments' | 'tickets' | 'audit'>('subscriptions');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSuspendConfirmOpen, setIsSuspendConfirmOpen] = useState(false);
  const [isReactivateConfirmOpen, setIsReactivateConfirmOpen] = useState(false);
  const [isDisconnectConfirmOpen, setIsDisconnectConfirmOpen] = useState(false);

  // 1. Fetch Detailed Customer Profile
  const {
    data: customer,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<CustomerDetails>({
    queryKey: ['customer-detail', customerId],
    queryFn: () => apiFetch<CustomerDetails>(`/customers/${customerId}`),
    enabled: !!customerId,
  });

  // 1b. Fetch Customer Helpdesk Tickets
  const { data: customerTickets = [] } = useQuery<any[]>({
    queryKey: ['customer-tickets', customerId],
    queryFn: () => apiFetch<any[]>(`/tickets?customerId=${customerId}`),
    enabled: !!customerId,
  });

  // Edit Form
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors: formErrors },
  } = useForm({
    values: customer
      ? {
          name: customer.name,
          mobile: customer.mobile || '',
          email: customer.email || '',
          address: customer.address || '',
          installationAddress: customer.installationAddress || '',
          area: customer.area || '',
          city: customer.city || '',
          state: customer.state || '',
          pincode: customer.pincode || '',
          staticIp: customer.staticIp || '',
          macAddress: customer.macAddress || '',
          notes: customer.notes || '',
        }
      : undefined,
  });

  // 2. Suspend Mutation
  const suspendMutation = useMutation({
    mutationFn: () => apiFetch(`/customers/${customerId}/suspend`, { method: 'POST' }),
    onSuccess: () => {
      toast.success(`Subscriber ${customer?.name} suspended and session dropped`, 'Customer Suspended');
      setIsSuspendConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ['customer-detail', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to suspend subscriber', 'Suspension Failed');
      setIsSuspendConfirmOpen(false);
    },
  });

  // 3. Reactivate Mutation
  const reactivateMutation = useMutation({
    mutationFn: () => apiFetch(`/customers/${customerId}/reactivate`, { method: 'POST' }),
    onSuccess: () => {
      toast.success(`Subscriber ${customer?.name} reactivated with restored bandwidth`, 'Customer Reactivated');
      setIsReactivateConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ['customer-detail', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to reactivate subscriber', 'Reactivation Failed');
      setIsReactivateConfirmOpen(false);
    },
  });

  // 4. Force Disconnect Session Mutation
  const disconnectMutation = useMutation({
    mutationFn: () => apiFetch(`/customers/${customerId}/disconnect`, { method: 'POST' }),
    onSuccess: () => {
      toast.success(`RFC 3576 Disconnect-Request (PoD) sent for ${customer?.username}`, 'Session Terminated');
      setIsDisconnectConfirmOpen(false);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to disconnect active session', 'Disconnect Failed');
      setIsDisconnectConfirmOpen(false);
    },
  });

  // 5. Update Profile Mutation
  const updateMutation = useMutation({
    mutationFn: (data: any) => apiFetch(`/customers/${customerId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => {
      toast.success('Subscriber profile updated successfully', 'Profile Updated');
      setIsEditModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['customer-detail', customerId] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to update subscriber profile', 'Update Failed');
    },
  });

  const onEditSubmit = (data: any) => {
    updateMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto pb-12">
        <div className="flex items-center gap-3">
          <Link
            href="/customers"
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

  if (isError || !customer) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto pb-12">
        <Link
          href="/customers"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Customers</span>
        </Link>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center">
          <AlertCircle className="h-10 w-10 text-rose-400 mx-auto mb-3" />
          <h2 className="text-base font-semibold text-slate-100 mb-1">Subscriber Not Found</h2>
          <p className="text-xs text-slate-400 max-w-md mx-auto mb-6 leading-relaxed">
            The requested customer profile could not be loaded or may belong to another organization.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => refetch()}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold"
            >
              Retry
            </button>
            <Link
              href="/customers"
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
            >
              Customer Directory
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isSuspended = customer.status === CustomerStatus.SUSPENDED;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Navigation & Action Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <Link
            href="/customers"
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors shrink-0"
            title="Back to Customers list"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl font-bold text-slate-100 tracking-tight">{customer.name}</h1>
              <span className="font-mono text-xs px-2.5 py-0.5 rounded-full bg-blue-950 text-blue-400 border border-blue-800">
                {customer.customerCode}
              </span>
              <StatusBadge status={customer.status} />
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Subscriber ID: <span className="font-mono text-slate-300">{customer.id}</span> • Registered{' '}
              {new Date(customer.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center flex-wrap gap-2.5">
          <button
            onClick={() => setIsEditModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-colors"
          >
            <Edit className="h-3.5 w-3.5" />
            <span>Edit Profile</span>
          </button>

          <button
            onClick={() => setIsDisconnectConfirmOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-400 border border-amber-500/30 text-xs font-semibold transition-colors"
            title="Terminate active PPPoE session via RFC 3576 Disconnect-Request"
          >
            <Radio className="h-3.5 w-3.5" />
            <span>Drop Session</span>
          </button>

          {isSuspended ? (
            <button
              onClick={() => setIsReactivateConfirmOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-500/20 transition-all"
            >
              <RotateCw className="h-3.5 w-3.5" />
              <span>Reactivate</span>
            </button>
          ) : (
            <button
              onClick={() => setIsSuspendConfirmOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-lg shadow-rose-500/20 transition-all"
            >
              <Power className="h-3.5 w-3.5" />
              <span>Suspend</span>
            </button>
          )}

          <Link
            href={`/payments?customerId=${customer.id}`}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/20 transition-all"
          >
            <IndianRupee className="h-3.5 w-3.5" />
            <span>Record Payment</span>
          </Link>
        </div>
      </div>

      {/* Grid: Left Column (Profile & Network Specs) + Right Column (Tabs: Subscriptions, Invoices, Payments, Audit) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (1 Col): Subscriber Details */}
        <div className="space-y-6">
          {/* Contact & KYC Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2 border-b border-slate-800 pb-3">
              <Users className="h-4 w-4 text-blue-400" />
              <span>Contact & KYC Details</span>
            </h2>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-slate-500 block text-[11px]">Primary Mobile</span>
                <span className="font-semibold text-slate-200 flex items-center gap-1.5 mt-0.5">
                  <Phone className="h-3.5 w-3.5 text-slate-400" />
                  {customer.mobile || '—'}
                </span>
              </div>

              {customer.phone && (
                <div>
                  <span className="text-slate-500 block text-[11px]">Alternate Phone</span>
                  <span className="text-slate-300">{customer.phone}</span>
                </div>
              )}

              <div>
                <span className="text-slate-500 block text-[11px]">Email Address</span>
                <span className="text-slate-300 flex items-center gap-1.5 mt-0.5">
                  <Mail className="h-3.5 w-3.5 text-slate-400" />
                  {customer.email || '—'}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">Billing Address</span>
                <span className="text-slate-300 flex items-start gap-1.5 mt-0.5 leading-relaxed">
                  <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
                  {customer.address || '—'}
                </span>
              </div>

              {customer.installationAddress && (
                <div>
                  <span className="text-slate-500 block text-[11px]">Installation Address</span>
                  <span className="text-slate-300 leading-relaxed block mt-0.5">
                    {customer.installationAddress}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800/80">
                <div>
                  <span className="text-slate-500 block text-[11px]">Area / Locality</span>
                  <span className="text-slate-300">{customer.area || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">City / State</span>
                  <span className="text-slate-300">
                    {[customer.city, customer.state].filter(Boolean).join(', ') || '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Pincode</span>
                  <span className="text-slate-300 font-mono">{customer.pincode || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">GSTIN</span>
                  <span className="text-slate-300 font-mono">{customer.gstin || '—'}</span>
                </div>
              </div>

              {customer.aadhaarNumber && (
                <div className="pt-1 border-t border-slate-800/80">
                  <span className="text-slate-500 block text-[11px]">Aadhaar Number</span>
                  <span className="text-slate-300 font-mono">•••• •••• {customer.aadhaarNumber.slice(-4)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Network & PPPoE Identity Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2 border-b border-slate-800 pb-3">
              <Wifi className="h-4 w-4 text-emerald-400" />
              <span>FreeRADIUS & Network Identity</span>
            </h2>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-slate-500 block text-[11px]">PPPoE Username</span>
                <span className="font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/20 px-2 py-0.5 rounded inline-block mt-0.5">
                  {customer.username || customer.pppoeUsername}
                </span>
              </div>

              <div>
                <span className="text-slate-500 block text-[11px]">Static IP (Framed-IP-Address)</span>
                <span className="font-mono text-cyan-400 block mt-0.5">
                  {customer.staticIp || 'Dynamic IP Pool'}
                </span>
              </div>

              {customer.macAddress && (
                <div>
                  <span className="text-slate-500 block text-[11px]">Calling-Station-Id (MAC)</span>
                  <span className="font-mono text-slate-300 block mt-0.5">{customer.macAddress}</span>
                </div>
              )}

              {customer.installationDate && (
                <div>
                  <span className="text-slate-500 block text-[11px]">Installation Date</span>
                  <span className="text-slate-300 flex items-center gap-1 mt-0.5">
                    <Calendar className="h-3 w-3 text-slate-500" />
                    {new Date(customer.installationDate).toLocaleDateString()}
                  </span>
                </div>
              )}

              {customer.notes && (
                <div className="pt-2 border-t border-slate-800/80">
                  <span className="text-slate-500 block text-[11px]">Operator Notes</span>
                  <p className="text-slate-300 italic mt-0.5 bg-slate-950/50 p-2.5 rounded border border-slate-800/80 leading-relaxed">
                    {customer.notes}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column (2 Cols): Tabs (Subscriptions, Invoices, Payments, Audit Logs) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Tabs Navigation */}
          <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
            <button
              onClick={() => setActiveTab('subscriptions')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'subscriptions'
                  ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Wifi className="h-3.5 w-3.5" />
              <span>Subscriptions ({customer.subscriptions?.length || 0})</span>
            </button>

            <button
              onClick={() => setActiveTab('invoices')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'invoices'
                  ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Receipt className="h-3.5 w-3.5" />
              <span>Invoices ({customer.invoices?.length || 0})</span>
            </button>

            <button
              onClick={() => setActiveTab('payments')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'payments'
                  ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <IndianRupee className="h-3.5 w-3.5" />
              <span>Payments ({customer.payments?.length || 0})</span>
            </button>

            <button
              onClick={() => setActiveTab('tickets')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'tickets'
                  ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <LifeBuoy className="h-3.5 w-3.5" />
              <span>Tickets ({customerTickets.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('audit')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'audit'
                  ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <History className="h-3.5 w-3.5" />
              <span>Audit Trail ({customer.auditLogs?.length || 0})</span>
            </button>
          </div>

          {/* Tab 1: Subscriptions */}
          {activeTab === 'subscriptions' && (
            <div className="space-y-4">
              {customer.subscriptions && customer.subscriptions.length > 0 ? (
                customer.subscriptions.map((sub) => (
                  <div
                    key={sub.id}
                    className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                      <div>
                        <div className="flex items-center gap-2.5">
                          <h3 className="text-base font-bold text-slate-100">{sub.plan?.name || 'Internet Plan'}</h3>
                          <StatusBadge status={sub.status} />
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Plan Code: <span className="font-mono text-slate-300">{sub.plan?.code}</span> •{' '}
                          Rate Limit: <span className="font-mono text-blue-400">{sub.plan?.rateLimitString || 'Standard'}</span>
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="text-lg font-bold text-slate-100">
                          ₹ {Number(sub.price).toFixed(2)}
                        </span>
                        <span className="text-[11px] text-slate-400 block">/ {sub.billingCycle.toLowerCase()}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                      <div>
                        <span className="text-slate-500 block text-[11px]">Download Speed</span>
                        <span className="font-semibold text-emerald-400 mt-0.5 block">
                          {sub.plan?.downloadSpeedMbps || '—'} Mbps
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[11px]">Upload Speed</span>
                        <span className="font-semibold text-blue-400 mt-0.5 block">
                          {sub.plan?.uploadSpeedMbps || '—'} Mbps
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[11px]">Start Date</span>
                        <span className="text-slate-300 mt-0.5 block">
                          {new Date(sub.startDate).toLocaleDateString()}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[11px]">Expiry Date</span>
                        <span className="font-semibold text-amber-400 mt-0.5 block">
                          {new Date(sub.endDate).toLocaleDateString()}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-slate-800 text-xs text-slate-400">
                      <span>Auto Renew: {sub.autoRenew ? 'Enabled' : 'Disabled'} • Grace: {sub.gracePeriodDays} days</span>
                      <Link
                        href={`/subscriptions`}
                        className="text-xs text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1"
                      >
                        <span>Manage Subscription</span>
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState
                  icon={Wifi}
                  title="No Subscriptions Found"
                  description="This subscriber does not have an active or past internet plan assigned."
                  action={{
                    label: 'Assign Plan',
                    onClick: () => router.push('/subscriptions'),
                    icon: Plus,
                  }}
                />
              )}
            </div>
          )}

          {/* Tab 2: Invoices */}
          {activeTab === 'invoices' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
              {customer.invoices && customer.invoices.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950/60 text-slate-400 font-medium border-b border-slate-800">
                      <tr>
                        <th className="px-4 py-3">Invoice Number</th>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Due Date</th>
                        <th className="px-4 py-3">Total</th>
                        <th className="px-4 py-3">Paid</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 text-slate-300">
                      {customer.invoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="px-4 py-3 font-mono font-semibold text-blue-400">
                            <Link href={`/invoices/${inv.id}`} className="hover:underline">
                              {inv.invoiceNumber}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-slate-400">
                            {new Date(inv.invoiceDate).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-slate-400">
                            {new Date(inv.dueDate).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-100">
                            ₹ {Number(inv.totalAmount).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-emerald-400">
                            ₹ {Number(inv.paidAmount).toFixed(2)}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={inv.status} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Link
                              href={`/invoices/${inv.id}`}
                              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold transition-colors"
                            >
                              View GST Bill
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-8">
                  <EmptyState
                    icon={Receipt}
                    title="No Invoices Issued"
                    description="No GST tax invoices have been generated for this subscriber."
                  />
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Payments */}
          {activeTab === 'payments' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
              {customer.payments && customer.payments.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-950/60 text-slate-400 font-medium border-b border-slate-800">
                      <tr>
                        <th className="px-4 py-3">Receipt Number</th>
                        <th className="px-4 py-3">Paid Date</th>
                        <th className="px-4 py-3">Amount</th>
                        <th className="px-4 py-3">Method</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Reference</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 text-slate-300">
                      {customer.payments.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="px-4 py-3 font-mono font-semibold text-slate-100">
                            {p.receiptNumber}
                          </td>
                          <td className="px-4 py-3 text-slate-400">
                            {new Date(p.paidAt).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 font-semibold text-emerald-400">
                            ₹ {Number(p.amount).toFixed(2)}
                          </td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px] font-medium border border-slate-700">
                              {p.paymentMethod}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={p.status} />
                          </td>
                          <td className="px-4 py-3 font-mono text-[11px] text-slate-400">
                            {p.transactionRef || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-8">
                  <EmptyState
                    icon={IndianRupee}
                    title="No Payment History"
                    description="No payment collections have been recorded for this subscriber yet."
                    action={{
                      label: 'Record Payment',
                      onClick: () => router.push(`/payments?customerId=${customer.id}`),
                      icon: Plus,
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Tab 4: Audit Trail */}
          {activeTab === 'audit' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-3">
              {customer.auditLogs && customer.auditLogs.length > 0 ? (
                <div className="space-y-2.5">
                  {customer.auditLogs.map((log) => (
                    <div
                      key={log.id}
                      className="p-3 rounded-lg bg-slate-950/40 border border-slate-800/80 text-xs flex items-start justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-200">
                            {log.action.replace(/_/g, ' ')}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 font-mono">
                            {log.entityType}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          Performed by: <strong className="text-slate-300">{log.adminUser?.name || 'System'}</strong> (
                          {log.adminUser?.email || 'automated'})
                        </p>
                        {log.details && (
                          <pre className="text-[10px] font-mono bg-slate-900 p-2 rounded text-slate-300 overflow-x-auto max-w-xl">
                            {JSON.stringify(log.details, null, 2)}
                          </pre>
                        )}
                      </div>
                      <span className="text-[11px] font-mono text-slate-500 shrink-0">
                        {new Date(log.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={History}
                  title="No Audit Records"
                  description="No audit logs recorded for this customer."
                />
              )}
            </div>
          )}

          {/* Tab: Tickets */}
          {activeTab === 'tickets' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <LifeBuoy className="h-4 w-4 text-amber-400" />
                  <span>Subscriber Helpdesk Tickets</span>
                </h3>
                <Link
                  href="/tickets"
                  className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1"
                >
                  <span>Open New Ticket</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>

              {customerTickets.length > 0 ? (
                <div className="space-y-3">
                  {customerTickets.map((t: any) => (
                    <div
                      key={t.id}
                      className="p-4 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-blue-400">{t.ticketNumber}</span>
                          <StatusBadge status={t.status} />
                          <span className="text-[10px] text-slate-400 font-mono">({t.priority})</span>
                        </div>
                        <p className="text-xs font-semibold text-white">{t.title}</p>
                        <p className="text-[11px] text-slate-400 line-clamp-1">{t.description}</p>
                      </div>
                      <Link
                        href="/tickets"
                        className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200"
                      >
                        View
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={LifeBuoy}
                  title="No Support Tickets"
                  description="This subscriber has no active or past support tickets."
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Edit Customer Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-semibold text-slate-100">Edit Customer Information</h3>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onEditSubmit)} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-slate-400 block mb-1">Customer Full Name *</label>
                  <input
                    {...register('name', { required: 'Name is required' })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                  {formErrors.name && (
                    <span className="text-rose-400 text-[10px]">{formErrors.name.message as string}</span>
                  )}
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Primary Mobile *</label>
                  <input
                    {...register('mobile', { required: 'Mobile number is required' })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                  {formErrors.mobile && (
                    <span className="text-rose-400 text-[10px]">{formErrors.mobile.message as string}</span>
                  )}
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Email Address</label>
                  <input
                    type="email"
                    {...register('email')}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Static IP (Framed-IP-Address)</label>
                  <input
                    {...register('staticIp')}
                    placeholder="e.g. 10.100.1.25"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Billing Address *</label>
                <input
                  {...register('address', { required: 'Address is required' })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Installation Address (Optional)</label>
                <input
                  {...register('installationAddress')}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Area / Locality</label>
                  <input
                    {...register('area')}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">City</label>
                  <input
                    {...register('city')}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">State</label>
                  <input
                    {...register('state')}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Pincode</label>
                  <input
                    {...register('pincode')}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Operator Notes</label>
                <textarea
                  {...register('notes')}
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/20 disabled:opacity-50"
                >
                  {updateMutation.isPending && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Suspend Confirmation Modal */}
      <ConfirmationModal
        isOpen={isSuspendConfirmOpen}
        onClose={() => setIsSuspendConfirmOpen(false)}
        onConfirm={() => suspendMutation.mutate()}
        title="Suspend Subscriber Account"
        message={`Are you sure you want to suspend "${customer.name}" (${customer.customerCode})? This will immediately throttle bandwidth or reject RADIUS auth and disconnect any active session.`}
        confirmText="Suspend Subscriber"
        variant="danger"
        isLoading={suspendMutation.isPending}
      />

      {/* Reactivate Confirmation Modal */}
      <ConfirmationModal
        isOpen={isReactivateConfirmOpen}
        onClose={() => setIsReactivateConfirmOpen(false)}
        onConfirm={() => reactivateMutation.mutate()}
        title="Reactivate Subscriber Account"
        message={`Are you sure you want to reactivate "${customer.name}"? This will restore plan bandwidth limits in FreeRADIUS and permit PPPoE dial-in.`}
        confirmText="Reactivate Subscriber"
        variant="primary"
        isLoading={reactivateMutation.isPending}
      />

      {/* Disconnect Session Confirmation Modal */}
      <ConfirmationModal
        isOpen={isDisconnectConfirmOpen}
        onClose={() => setIsDisconnectConfirmOpen(false)}
        onConfirm={() => disconnectMutation.mutate()}
        title="Force Disconnect PPPoE Session"
        message={`Send an RFC 3576 Disconnect-Request (PoD) for subscriber "${customer.username || customer.pppoeUsername}"? This will terminate the active session on the MikroTik router.`}
        confirmText="Disconnect Now"
        variant="warning"
        isLoading={disconnectMutation.isPending}
      />
    </div>
  );
}
