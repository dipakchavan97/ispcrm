'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import {
  CreditCard,
  RefreshCw,
  Clock,
  CheckCircle,
  AlertCircle,
  Wifi,
  Calendar,
  Zap,
  ArrowRight,
  X,
  Plus,
  Power,
  Search,
  History,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  Ban,
  Play,
  RotateCw,
  IndianRupee,
  User,
  ShieldCheck,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { StatusBadge } from '../../components/StatusBadge';

interface SubscriptionHistoryItem {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  action: string;
  reason?: string | null;
  fromPlanId?: string | null;
  toPlanId?: string | null;
  oldEndDate?: string | null;
  newEndDate?: string | null;
  createdAt: string;
  adminUser?: {
    id: string;
    name: string;
    email: string;
  } | null;
}

interface Subscription {
  id: string;
  organizationId: string;
  customerId: string;
  planId: string;
  status: 'PENDING' | 'ACTIVE' | 'GRACE' | 'SUSPENDED' | 'EXPIRED' | 'CANCELLED';
  startDate: string;
  endDate: string;
  price: number | string;
  billingCycle: 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'ANNUAL' | 'CUSTOM';
  autoRenew: boolean;
  gracePeriodDays: number;
  customer: {
    id: string;
    name: string;
    customerCode: string;
    pppoeUsername: string;
    mobile?: string;
    phone?: string;
  };
  plan: {
    id: string;
    name: string;
    code: string;
    downloadSpeed?: number;
    uploadSpeed?: number;
    downloadSpeedMbps?: number;
    uploadSpeedMbps?: number;
    speedUnit?: string;
    price: number | string;
    validityDays: number;
  };
  history?: SubscriptionHistoryItem[];
}

interface CustomerOption {
  id: string;
  name: string;
  customerCode: string;
  username: string;
}

interface PlanOption {
  id: string;
  name: string;
  code: string;
  downloadSpeed?: number;
  downloadSpeedMbps?: number;
  speedUnit?: string;
  price: number;
  validityDays: number;
  billingCycle?: string;
}

interface CreateSubFormData {
  customerId: string;
  planId: string;
  startDate?: string;
  billingCycle: string;
  status: string;
  gracePeriodDays: number;
  autoRenew: boolean;
}

export default function SubscriptionsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedSubForChangePlan, setSelectedSubForChangePlan] = useState<Subscription | null>(null);
  const [newPlanId, setNewPlanId] = useState<string>('');
  const [changePlanReason, setChangePlanReason] = useState<string>('');
  const [historySub, setHistorySub] = useState<Subscription | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [suspendSub, setSuspendSub] = useState<Subscription | null>(null);
  const [suspendReason, setSuspendReason] = useState<string>('');
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4500);
  };

  // 1. Fetch Subscriptions
  const { data: subscriptions = [], isLoading, refetch, isFetching } = useQuery<Subscription[]>({
    queryKey: ['subscriptions', statusFilter, searchTerm],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (searchTerm.trim()) params.append('search', searchTerm.trim());
      return apiFetch<Subscription[]>(`/subscriptions?${params.toString()}`);
    },
  });

  // 2. Fetch Plans for selection
  const { data: plans = [] } = useQuery<PlanOption[]>({
    queryKey: ['plans'],
    queryFn: () => apiFetch<PlanOption[]>('/plans'),
  });

  // 3. Fetch Customers for creation
  const { data: customersResponse } = useQuery<{ data: CustomerOption[] } | CustomerOption[]>({
    queryKey: ['customers-list'],
    queryFn: () => apiFetch('/customers?limit=100'),
    enabled: isCreateModalOpen,
  });

  const customersList: CustomerOption[] = Array.isArray(customersResponse)
    ? customersResponse
    : (customersResponse as any)?.data || [];

  // Form for New Subscription
  const {
    register: registerCreate,
    handleSubmit: handleSubmitCreate,
    reset: resetCreate,
    formState: { isSubmitting: isCreatingSub },
  } = useForm<CreateSubFormData>({
    defaultValues: {
      billingCycle: 'MONTHLY',
      status: 'ACTIVE',
      gracePeriodDays: 3,
      autoRenew: true,
    },
  });

  // History query for currently inspected subscription
  const { data: historyItems = [], isLoading: isLoadingHistory } = useQuery<SubscriptionHistoryItem[]>({
    queryKey: ['subscription-history', historySub?.id],
    queryFn: () => apiFetch<SubscriptionHistoryItem[]>(`/subscriptions/${historySub?.id}/history`),
    enabled: Boolean(historySub?.id),
  });

  // Lifecycle Mutations
  const createSubMutation = useMutation({
    mutationFn: (formData: CreateSubFormData) => {
      return apiFetch('/subscriptions', {
        method: 'POST',
        body: JSON.stringify(formData),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      setIsCreateModalOpen(false);
      resetCreate();
      showNotification('Subscription created successfully!');
    },
    onError: (err: any) => {
      showNotification(err.message || 'Failed to create subscription', 'error');
    },
  });

  const activateMutation = useMutation({
    mutationFn: (subId: string) =>
      apiFetch(`/subscriptions/${subId}/activate`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      showNotification('Subscription activated & FreeRADIUS service synchronized!');
    },
    onError: (err: any) => {
      showNotification(err.message || 'Activation failed', 'error');
    },
  });

  const renewMutation = useMutation({
    mutationFn: (subId: string) =>
      apiFetch(`/subscriptions/${subId}/renew`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      showNotification('Subscription renewed! Validity extended by billing period.');
    },
    onError: (err: any) => {
      showNotification(err.message || 'Renewal failed', 'error');
    },
  });

  const changePlanMutation = useMutation({
    mutationFn: ({ subId, planId, reason }: { subId: string; planId: string; reason?: string }) =>
      apiFetch(`/subscriptions/${subId}/upgrade`, {
        method: 'POST',
        body: JSON.stringify({ planId, reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      setSelectedSubForChangePlan(null);
      setNewPlanId('');
      setChangePlanReason('');
      showNotification('Plan updated & FreeRADIUS rate limits re-allocated!');
    },
    onError: (err: any) => {
      showNotification(err.message || 'Failed to change plan', 'error');
    },
  });

  const suspendMutation = useMutation({
    mutationFn: ({ subId, reason }: { subId: string; reason: string }) =>
      apiFetch(`/subscriptions/${subId}/suspend`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      setSuspendSub(null);
      setSuspendReason('');
      showNotification('Subscription suspended & access throttled.');
    },
    onError: (err: any) => {
      showNotification(err.message || 'Failed to suspend subscription', 'error');
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: (subId: string) =>
      apiFetch(`/subscriptions/${subId}/reactivate`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      showNotification('Subscription reactivated & subscriber restored to service!');
    },
    onError: (err: any) => {
      showNotification(err.message || 'Reactivation failed', 'error');
    },
  });

  const expireMutation = useMutation({
    mutationFn: (subId: string) =>
      apiFetch(`/subscriptions/${subId}/expire`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Manual expiration triggered' }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      showNotification('Subscription marked as EXPIRED.');
    },
    onError: (err: any) => {
      showNotification(err.message || 'Expiration failed', 'error');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (subId: string) =>
      apiFetch(`/subscriptions/${subId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Cancelled by operator' }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      showNotification('Subscription permanently cancelled.');
    },
    onError: (err: any) => {
      showNotification(err.message || 'Cancellation failed', 'error');
    },
  });

  const getDaysRemaining = (endDateStr: string) => {
    const end = new Date(endDateStr).getTime();
    const now = Date.now();
    return Math.ceil((end - now) / (1000 * 60 * 60 * 24));
  };

  const activeCount = subscriptions.filter((s) => s.status === 'ACTIVE').length;
  const graceCount = subscriptions.filter((s) => s.status === 'GRACE').length;
  const pendingCount = subscriptions.filter((s) => s.status === 'PENDING').length;
  const suspendedCount = subscriptions.filter((s) => s.status === 'SUSPENDED').length;
  const expiredCount = subscriptions.filter((s) => s.status === 'EXPIRED').length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`fixed bottom-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border text-sm font-medium transition-all ${
            notification.type === 'success'
              ? 'bg-slate-900 border-emerald-500/40 text-emerald-400'
              : 'bg-slate-900 border-rose-500/40 text-rose-400'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle className="h-5 w-5 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="h-5 w-5 text-rose-400 shrink-0" />
          )}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-blue-600/10 text-blue-400 border border-blue-500/20 shadow-inner">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-100 tracking-tight">Subscriptions & Lifecycles</h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Automate subscriber validity, manage renewals, upgrades, grace periods, and audit histories.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/60 text-xs font-semibold transition-all"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin text-blue-400' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/20 transition-all"
          >
            <Plus className="h-4 w-4" />
            <span>New Subscription</span>
          </button>
        </div>
      </div>

      {/* KPI Badges & Filter Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
        {/* Status Filter Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {[
            { key: 'ALL', label: 'All', count: subscriptions.length },
            { key: 'ACTIVE', label: 'Active', count: activeCount, dot: 'bg-emerald-400' },
            { key: 'GRACE', label: 'Grace', count: graceCount, dot: 'bg-purple-400' },
            { key: 'PENDING', label: 'Pending', count: pendingCount, dot: 'bg-amber-400' },
            { key: 'SUSPENDED', label: 'Suspended', count: suspendedCount, dot: 'bg-rose-400' },
            { key: 'EXPIRED', label: 'Expired', count: expiredCount, dot: 'bg-orange-400' },
            { key: 'CANCELLED', label: 'Cancelled', count: 0 },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                statusFilter === tab.key
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              {tab.dot && <span className={`w-1.5 h-1.5 rounded-full ${tab.dot}`} />}
              <span>{tab.label}</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-900/60 text-slate-300 border border-white/10">
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative min-w-[260px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by subscriber, username, plan..."
            className="w-full bg-slate-950/80 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Subscriptions Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800 uppercase tracking-wider text-[11px]">
              <tr>
                <th className="px-5 py-3.5">Subscriber</th>
                <th className="px-5 py-3.5">Plan & Commercials</th>
                <th className="px-5 py-3.5">Validity Dates</th>
                <th className="px-5 py-3.5">Time Remaining</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Lifecycle Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-14 text-center text-slate-500">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto text-blue-500 mb-2" />
                    Loading subscriptions...
                  </td>
                </tr>
              ) : subscriptions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-14 text-center text-slate-500">
                    <CreditCard className="h-9 w-9 mx-auto text-slate-600 mb-2" />
                    <p className="font-semibold text-slate-300">No subscriptions found</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Click "New Subscription" above to assign an internet plan to a customer.
                    </p>
                  </td>
                </tr>
              ) : (
                subscriptions.map((s) => {
                  const daysLeft = getDaysRemaining(s.endDate);
                  const isExpired = daysLeft <= 0;
                  const isExpiringSoon = daysLeft <= s.gracePeriodDays && daysLeft > 0;
                  const speed = s.plan?.downloadSpeed || s.plan?.downloadSpeedMbps || 0;
                  const unit = s.plan?.speedUnit || 'MBPS';

                  return (
                    <tr key={s.id} className="hover:bg-slate-800/30 transition-colors">
                      {/* Subscriber */}
                      <td className="px-5 py-4">
                        <div className="font-bold text-slate-100">{s.customer?.name}</div>
                        <div className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5 mt-0.5">
                          <span className="text-blue-400">{s.customer?.pppoeUsername}</span>
                          <span>•</span>
                          <span>{s.customer?.customerCode}</span>
                        </div>
                      </td>

                      {/* Plan & Commercials */}
                      <td className="px-5 py-4">
                        <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                          <Wifi className="h-3.5 w-3.5 text-blue-400" />
                          <span>{s.plan?.name}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                          {speed} {unit} · ₹{Number(s.price).toLocaleString('en-IN')} / {s.billingCycle}
                        </div>
                      </td>

                      {/* Dates */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-1.5 text-slate-300 text-xs">
                          <Calendar className="h-3.5 w-3.5 text-slate-500" />
                          <span>
                            {new Date(s.startDate).toLocaleDateString('en-IN')} →{' '}
                            {new Date(s.endDate).toLocaleDateString('en-IN')}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-2">
                          <span>Grace: {s.gracePeriodDays} Days</span>
                          <span>•</span>
                          <span>{s.autoRenew ? 'Auto-Renew: ON' : 'Manual'}</span>
                        </div>
                      </td>

                      {/* Time Remaining */}
                      <td className="px-5 py-4">
                        {s.status === 'EXPIRED' ? (
                          <span className="font-semibold px-2 py-0.5 rounded text-[11px] bg-rose-950/60 text-rose-400 border border-rose-500/20">
                            Expired
                          </span>
                        ) : s.status === 'GRACE' ? (
                          <span className="font-semibold px-2 py-0.5 rounded text-[11px] bg-purple-950/60 text-purple-400 border border-purple-500/20 animate-pulse">
                            In Grace Period
                          </span>
                        ) : isExpired ? (
                          <span className="font-semibold px-2 py-0.5 rounded text-[11px] bg-orange-950/60 text-orange-400 border border-orange-500/20">
                            Due for Renewal
                          </span>
                        ) : isExpiringSoon ? (
                          <span className="font-semibold px-2 py-0.5 rounded text-[11px] bg-amber-950/60 text-amber-400 border border-amber-500/20">
                            {daysLeft} days left
                          </span>
                        ) : (
                          <span className="font-semibold text-emerald-400 text-xs">
                            {daysLeft} days left
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-5 py-4">
                        <StatusBadge status={s.status} />
                      </td>

                      {/* Lifecycle Actions */}
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Activate Button (for PENDING) */}
                          {s.status === 'PENDING' && (
                            <button
                              onClick={() => activateMutation.mutate(s.id)}
                              disabled={activateMutation.isPending}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium shadow transition-all flex items-center gap-1"
                              title="Activate Subscription"
                            >
                              <Play className="h-3 w-3" />
                              <span>Activate</span>
                            </button>
                          )}

                          {/* Renew Button (for ACTIVE, GRACE, SUSPENDED, EXPIRED) */}
                          {s.status !== 'CANCELLED' && s.status !== 'PENDING' && (
                            <button
                              onClick={() => renewMutation.mutate(s.id)}
                              disabled={renewMutation.isPending}
                              className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-[11px] font-medium transition-all flex items-center gap-1"
                              title="Renew Subscription"
                            >
                              <RotateCw className="h-3 w-3" />
                              <span>Renew</span>
                            </button>
                          )}

                          {/* Upgrade / Downgrade Plan Button */}
                          {(s.status === 'ACTIVE' || s.status === 'GRACE') && (
                            <button
                              onClick={() => {
                                setSelectedSubForChangePlan(s);
                                setNewPlanId(s.planId);
                              }}
                              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium border border-slate-700 transition-all flex items-center gap-1"
                              title="Upgrade or Downgrade Plan"
                            >
                              <Zap className="h-3 w-3 text-amber-400" />
                              <span>Plan</span>
                            </button>
                          )}

                          {/* Suspend / Reactivate Button */}
                          {s.status === 'SUSPENDED' ? (
                            <button
                              onClick={() => reactivateMutation.mutate(s.id)}
                              disabled={reactivateMutation.isPending}
                              className="px-2 py-1 rounded-lg bg-emerald-950/60 hover:bg-emerald-900 text-emerald-400 border border-emerald-500/30 text-[11px] font-medium transition-all flex items-center gap-1"
                              title="Reactivate subscriber access"
                            >
                              <Power className="h-3 w-3" />
                              <span>Reactivate</span>
                            </button>
                          ) : (s.status === 'ACTIVE' || s.status === 'GRACE') ? (
                            <button
                              onClick={() => setSuspendSub(s)}
                              className="px-2 py-1 rounded-lg bg-rose-950/40 hover:bg-rose-900/50 text-rose-400 border border-rose-800/40 text-[11px] font-medium transition-all flex items-center gap-1"
                              title="Suspend subscription"
                            >
                              <Power className="h-3 w-3" />
                              <span>Suspend</span>
                            </button>
                          ) : null}

                          {/* History Timeline */}
                          <button
                            onClick={() => setHistorySub(s)}
                            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors border border-slate-700/60"
                            title="View Subscription History & Transitions"
                          >
                            <History className="h-3.5 w-3.5" />
                          </button>

                          {/* Cancel Button (Terminal) */}
                          {s.status !== 'CANCELLED' && (
                            <button
                              onClick={() => {
                                if (
                                  confirm(
                                    `Are you sure you want to permanently cancel the subscription for ${s.customer?.name}? This action is irreversible.`,
                                  )
                                ) {
                                  cancelMutation.mutate(s.id);
                                }
                              }}
                              className="p-1.5 rounded-lg bg-slate-800/40 hover:bg-rose-950/60 text-slate-500 hover:text-rose-400 transition-colors border border-slate-800 hover:border-rose-800/50"
                              title="Permanently Cancel Subscription"
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </button>
                          )}
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

      {/* Modal: New Subscription */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60 sticky top-0 z-10">
              <div className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-blue-400" />
                <h2 className="text-base font-bold text-slate-100">Create Subscription</h2>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={handleSubmitCreate((data) => createSubMutation.mutate(data))}
              className="p-6 space-y-4"
            >
              {/* Customer Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Select Customer *</label>
                <select
                  {...registerCreate('customerId', { required: 'Please select a customer' })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">-- Choose Subscriber --</option>
                  {customersList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.username}) [{c.customerCode}]
                    </option>
                  ))}
                </select>
              </div>

              {/* Plan Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Select Internet Plan *</label>
                <select
                  {...registerCreate('planId', { required: 'Please select a plan' })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">-- Choose Plan --</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.downloadSpeed || p.downloadSpeedMbps} {p.speedUnit || 'Mbps'} (₹{p.price})
                    </option>
                  ))}
                </select>
              </div>

              {/* Start Date & Billing Cycle */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Start Date (Optional)</label>
                  <input
                    {...registerCreate('startDate')}
                    type="date"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Billing Cycle</label>
                  <select
                    {...registerCreate('billingCycle')}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="MONTHLY">Monthly</option>
                    <option value="QUARTERLY">Quarterly</option>
                    <option value="HALF_YEARLY">Half Yearly</option>
                    <option value="ANNUAL">Annual</option>
                    <option value="CUSTOM">Custom (Validity Days)</option>
                  </select>
                </div>
              </div>

              {/* Status & Grace Period */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Initial Status</label>
                  <select
                    {...registerCreate('status')}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="ACTIVE">ACTIVE (Immediate Service)</option>
                    <option value="PENDING">PENDING (Awaiting Installation)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Grace Period (Days)</label>
                  <input
                    {...registerCreate('gracePeriodDays', { valueAsNumber: true, min: 0 })}
                    type="number"
                    defaultValue={3}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Auto Renew Toggle */}
              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                  <input
                    type="checkbox"
                    {...registerCreate('autoRenew')}
                    defaultChecked={true}
                    className="rounded bg-slate-950 border-slate-700 text-blue-500 focus:ring-0"
                  />
                  <span>Enable automatic recurring billing renewal</span>
                </label>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingSub || createSubMutation.isPending}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/20 transition-all disabled:opacity-50"
                >
                  {createSubMutation.isPending ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle className="h-4 w-4" />
                  )}
                  <span>Create Subscription</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Change Plan (Upgrade / Downgrade) */}
      {selectedSubForChangePlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-amber-400" />
                <h2 className="text-base font-bold text-slate-100">Upgrade or Downgrade Plan</h2>
              </div>
              <button
                onClick={() => setSelectedSubForChangePlan(null)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1">
                <div className="text-slate-400">Subscriber:</div>
                <div className="font-semibold text-slate-100">{selectedSubForChangePlan.customer?.name}</div>
                <div className="text-slate-400 mt-2">Current Package:</div>
                <div className="font-semibold text-blue-400">
                  {selectedSubForChangePlan.plan?.name} (₹{selectedSubForChangePlan.price}/mo)
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Choose New Plan</label>
                <select
                  value={newPlanId}
                  onChange={(e) => setNewPlanId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.downloadSpeed || p.downloadSpeedMbps} {p.speedUnit || 'Mbps'} (₹{p.price})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Reason for Change</label>
                <input
                  type="text"
                  value={changePlanReason}
                  onChange={(e) => setChangePlanReason(e.target.value)}
                  placeholder="e.g. Subscriber requested higher bandwidth tier"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setSelectedSubForChangePlan(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={changePlanMutation.isPending || !newPlanId || newPlanId === selectedSubForChangePlan.planId}
                  onClick={() =>
                    changePlanMutation.mutate({
                      subId: selectedSubForChangePlan.id,
                      planId: newPlanId,
                      reason: changePlanReason,
                    })
                  }
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/20 transition-all disabled:opacity-50"
                >
                  {changePlanMutation.isPending ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle className="h-4 w-4" />
                  )}
                  <span>Apply Plan Change</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Suspend Subscription */}
      {suspendSub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-rose-400" />
                <h2 className="text-base font-bold text-slate-100">Suspend Subscription</h2>
              </div>
              <button
                onClick={() => setSuspendSub(null)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-slate-300 leading-relaxed">
                Suspending will throttle or disconnect subscriber{' '}
                <strong className="text-white">{suspendSub.customer?.name}</strong> and remove active FreeRADIUS
                bandwidth limits until reactivated.
              </p>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Suspension Reason</label>
                <input
                  type="text"
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  placeholder="e.g. Non-payment of overdue invoice"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-rose-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setSuspendSub(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={suspendMutation.isPending}
                  onClick={() =>
                    suspendMutation.mutate({
                      subId: suspendSub.id,
                      reason: suspendReason || 'Manual operator suspension',
                    })
                  }
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-lg shadow-rose-500/20 transition-all disabled:opacity-50"
                >
                  {suspendMutation.isPending ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Power className="h-4 w-4" />
                  )}
                  <span>Confirm Suspension</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: History Timeline */}
      {historySub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60 sticky top-0 z-10">
              <div className="flex items-center gap-2">
                <History className="h-5 w-5 text-blue-400" />
                <div>
                  <h2 className="text-base font-bold text-slate-100">Subscription History Timeline</h2>
                  <p className="text-[11px] text-slate-400">
                    Audit log for {historySub.customer?.name} ({historySub.plan?.name})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setHistorySub(null)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6">
              {isLoadingHistory ? (
                <div className="p-8 text-center text-slate-500">
                  <RefreshCw className="h-6 w-6 animate-spin mx-auto text-blue-500 mb-2" />
                  Loading history timeline...
                </div>
              ) : historyItems.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  No history records logged yet.
                </div>
              ) : (
                <div className="space-y-4 border-l-2 border-slate-800 ml-3 pl-4">
                  {historyItems.map((h) => (
                    <div key={h.id} className="relative group">
                      {/* Timeline dot */}
                      <span className="absolute -left-[23px] top-1.5 w-3 h-3 rounded-full bg-blue-500 border-2 border-slate-900 group-hover:scale-125 transition-transform" />

                      <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-3.5 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-bold text-blue-400 uppercase tracking-wider">
                            {h.action}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {new Date(h.createdAt).toLocaleString('en-IN')}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 text-xs">
                          {h.fromStatus ? (
                            <>
                              <StatusBadge status={h.fromStatus} />
                              <ArrowRight className="h-3 w-3 text-slate-500" />
                            </>
                          ) : null}
                          <StatusBadge status={h.toStatus} />
                        </div>

                        {h.reason && (
                          <div className="text-xs text-slate-300 italic">
                            "{h.reason}"
                          </div>
                        )}

                        {h.newEndDate && (
                          <div className="text-[11px] text-slate-400">
                            Validity End Date: {new Date(h.newEndDate).toLocaleDateString('en-IN')}
                          </div>
                        )}

                        {h.adminUser && (
                          <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-800/60 flex items-center gap-1">
                            <User className="h-3 w-3" />
                            <span>Triggered by: {h.adminUser.name} ({h.adminUser.email})</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
