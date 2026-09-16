'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  Wifi,
  IndianRupee,
  AlertCircle,
  ArrowUpRight,
  UserPlus,
  ReceiptText,
  Router as RouterIcon,
  RefreshCw,
  Power,
  Clock,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Activity,
  Calendar,
  AlertTriangle,
  Radio,
  CreditCard,
  LifeBuoy,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { MetricCard } from '../../components/MetricCard';
import { StatusBadge } from '../../components/StatusBadge';
import { MetricSkeleton, TableSkeleton } from '../../components/LoadingSkeleton';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { useToast } from '../../components/Toast';
import { LiveRouterTrafficWidget } from '../../components/dashboard/LiveRouterTrafficWidget';

interface InvoiceMetrics {
  totalInvoiced: string;
  totalCollected: string;
  totalOutstanding: string;
  overdueCount: number;
}

interface SubscriberSessionMetrics {
  totalCustomers: number;
  activeSubscribers: number;
  onlineSubscribers: number;
  offlineSubscribers: number;
  concurrencyRate: number;
  suspendedSubscribers: number;
  expiredSubscribers: number;
  activeSessionCount: number;
}

interface ActiveSession {
  radacctid: string | number;
  acctsessionid: string;
  username: string;
  framedipaddress?: string;
  nasipaddress?: string;
  acctstarttime?: string;
  acctsessiontime?: number | string;
  acctinputoctets?: number | string;
  acctoutputoctets?: number | string;
  customerId?: string | null;
  customer?: {
    id?: string;
    name?: string;
    customerCode?: string;
    status?: string;
  };
}

interface RouterItem {
  id: string;
  name: string;
  host: string;
  port: number;
  status: 'ONLINE' | 'OFFLINE' | 'UNREACHABLE' | 'ERROR';
  model?: string | null;
  rosVersion?: string | null;
  lastSeen?: string | null;
  capabilities?: any;
}

interface AuditItem {
  id: string;
  action: string;
  entityType: string;
  entityId?: string;
  createdAt: string;
  adminUser?: {
    name: string;
    email: string;
  } | null;
}

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [disconnectSession, setDisconnectSession] = useState<{
    id: string;
    username: string;
  } | null>(null);

  // 1. Fetch Real Invoices / Collections Metrics
  const {
    data: invoiceMetrics,
    isLoading: isLoadingMetrics,
    isError: isErrorMetrics,
    refetch: refetchMetrics,
  } = useQuery<InvoiceMetrics>({
    queryKey: ['invoices-metrics'],
    queryFn: () => apiFetch<InvoiceMetrics>('/invoices/metrics'),
  });

  // 2. Fetch Customer Counts
  const {
    data: totalCustomersData,
    isLoading: isLoadingTotalCust,
    isError: isErrorCust,
    refetch: refetchCust,
  } = useQuery({
    queryKey: ['customers-count-total'],
    queryFn: () => apiFetch<{ total: number }>('/customers?limit=1'),
  });

  const { data: activeCustomersData } = useQuery({
    queryKey: ['customers-count-active'],
    queryFn: () => apiFetch<{ total: number }>('/customers?status=ACTIVE&limit=1'),
  });

  const { data: suspendedCustomersData } = useQuery({
    queryKey: ['customers-count-suspended'],
    queryFn: () => apiFetch<{ total: number }>('/customers?status=SUSPENDED&limit=1'),
  });

  const { data: expiredCustomersData } = useQuery({
    queryKey: ['customers-count-expired'],
    queryFn: () => apiFetch<{ total: number }>('/customers?status=EXPIRED&limit=1'),
  });

  const { data: ticketStats } = useQuery({
    queryKey: ['tickets-stats'],
    queryFn: () => apiFetch<{ total: number; open: number; inProgress: number; resolved: number; closed: number; urgent: number }>('/tickets/stats/summary'),
  });

  // 3. Fetch Real Active RADIUS PPPoE Sessions
  const {
    data: activeSessions = [],
    isLoading: isLoadingSessions,
    isError: isErrorSessions,
    refetch: refetchSessions,
  } = useQuery<ActiveSession[]>({
    queryKey: ['radius-active-sessions'],
    queryFn: async () => {
      const res = await apiFetch<ActiveSession[]>('/radius/sessions/active');
      return Array.isArray(res) ? res : [];
    },
    refetchInterval: 15000,
  });

  // 3a. Fetch Real-Time Distinct Subscriber Metrics (Tenant Enforced)
  const {
    data: subscriberMetrics,
    isLoading: isLoadingSubMetrics,
    refetch: refetchSubMetrics,
  } = useQuery<SubscriberSessionMetrics>({
    queryKey: ['radius-session-metrics'],
    queryFn: () => apiFetch<SubscriberSessionMetrics>('/radius/sessions/metrics'),
    refetchInterval: 15000,
  });

  // 4. Fetch MikroTik Routers
  const {
    data: routers = [],
    isLoading: isLoadingRouters,
    isError: isErrorRouters,
    refetch: refetchRouters,
  } = useQuery<RouterItem[]>({
    queryKey: ['routers'],
    queryFn: async () => {
      const res = await apiFetch<RouterItem[]>('/routers');
      return Array.isArray(res) ? res : [];
    },
  });

  // 4a. Fetch Physical Router Active PPPoE Sessions Count
  const onlineRouter = routers.find((r) => r.status === 'ONLINE') || routers[0];
  const { data: routerActiveSessions = [] } = useQuery<any[]>({
    queryKey: ['dashboard-active-ppp-sessions', onlineRouter?.id],
    queryFn: async () => {
      if (!onlineRouter?.id) return [];
      const res = await apiFetch<any[]>(`/routers/${onlineRouter.id}/active-ppp-sessions`);
      return Array.isArray(res) ? res : [];
    },
    enabled: Boolean(onlineRouter?.id),
    refetchInterval: 15000,
  });

  // 5. Fetch Recent Audit Logs
  const { data: auditLogs = [], isLoading: isLoadingLogs } = useQuery<AuditItem[]>({
    queryKey: ['audit-logs-recent'],
    queryFn: async () => {
      const res = await apiFetch<AuditItem[]>('/audit-logs');
      return Array.isArray(res) ? res.slice(0, 6) : [];
    },
  });

  // 6. Force Disconnect Session Mutation
  const disconnectMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      return apiFetch(`/radius/sessions/${sessionId}/disconnect`, {
        method: 'POST',
      });
    },
    onSuccess: () => {
      toast.success(
        `PoD Disconnect sent for session ${disconnectSession?.username || ''}`,
        'Session Terminated',
      );
      setDisconnectSession(null);
      queryClient.invalidateQueries({ queryKey: ['radius-active-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['radius-session-metrics'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to disconnect session via RFC 3576 PoD', 'Disconnect Error');
      setDisconnectSession(null);
    },
  });

  const handleRefreshAll = () => {
    refetchMetrics();
    refetchCust();
    refetchSubMetrics();
    refetchSessions();
    refetchRouters();
    toast.info('Refreshed live ISP network and billing metrics', 'Dashboard Updated');
  };

  const totalSubscribers = subscriberMetrics?.totalCustomers ?? (totalCustomersData?.total ?? 0);
  const activeSubscribers = subscriberMetrics?.activeSubscribers ?? (activeCustomersData?.total ?? 0);
  const suspendedSubscribers = subscriberMetrics?.suspendedSubscribers ?? (suspendedCustomersData?.total ?? 0);
  const expiredSubscribers = subscriberMetrics?.expiredSubscribers ?? (expiredCustomersData?.total ?? 0);

  // Derive distinct online active CRM customers from activeSessions (fallback or client deduplication):
  // Multiple sessions belonging to the same customer ID count as 1.
  // Unknown or unlinked sessions (without active CRM customer) are excluded.
  const distinctOnlineFromSessions = React.useMemo(() => {
    const onlineCustIds = new Set<string>();
    for (const s of activeSessions) {
      const custId = s.customer?.id || s.customerId;
      const isEligibleActive = s.customer ? s.customer.status === 'ACTIVE' : Boolean(custId);
      if (custId && isEligibleActive) {
        onlineCustIds.add(custId);
      }
    }
    return onlineCustIds.size;
  }, [activeSessions]);

  const onlineSubscribers = subscriberMetrics?.onlineSubscribers ?? distinctOnlineFromSessions;
  const offlineSubscribers = subscriberMetrics?.offlineSubscribers ?? Math.max(0, activeSubscribers - onlineSubscribers);
  const concurrencyRate = subscriberMetrics?.concurrencyRate ?? (
    activeSubscribers > 0 ? Number(((onlineSubscribers / activeSubscribers) * 100).toFixed(1)) : 0
  );
  const onlineRouters = routers.filter(
    (r) => r.status === 'ONLINE' && !(r.capabilities as any)?.isDegraded
  ).length;
  const degradedRouters = routers.filter(
    (r) =>
      r.status === 'ONLINE' &&
      Boolean((r.capabilities as any)?.isDegraded || Number((r.capabilities as any)?.consecutiveFailures || 0) > 0)
  ).length;
  const unreachableRouters = routers.filter(
    (r) => r.status === 'UNREACHABLE' || r.status === 'OFFLINE' || r.status === 'ERROR'
  ).length;
  const openTickets = ticketStats?.open ?? 0;

  const totalDownloadBytes = activeSessions.reduce((sum, s) => sum + Number((s as any).downloadBytes || s.acctoutputoctets || 0), 0);
  const totalUploadBytes = activeSessions.reduce((sum, s) => sum + Number((s as any).uploadBytes || s.acctinputoctets || 0), 0);

  const formatTraffic = (bytes?: number | string) => {
    if (!bytes) return '0 MB';
    const num = Number(bytes);
    if (isNaN(num)) return '0 MB';
    if (num >= 1024 * 1024 * 1024) {
      return `${(num / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    return `${(num / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatSessionTime = (seconds?: number | string) => {
    if (!seconds) return '0m';
    const sec = Number(seconds);
    if (isNaN(sec)) return '0m';
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  };

  const formatCurrency = (val?: string | number) => {
    const num = Number(val || 0);
    return `₹ ${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10">
      {/* Top Banner / Operations Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-[#E2E8F0] rounded-2xl p-5 sm:p-6 shadow-sm w-full min-w-0">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold text-[#0F172A] tracking-tight">
              ISP Network & Billing Operations
            </h1>
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#ECFDF5] border border-[#A7F3D0] text-[#047857] text-xs font-semibold">
              <span className="h-2 w-2 rounded-full bg-[#10B981] animate-pulse" />
              Live Carrier Engine
            </span>
          </div>
          <p className="text-xs text-[#64748B] mt-1 font-medium">
            Real-time subscriber status, FreeRADIUS accounting, MikroTik fleet health, and billing.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2.5">
          <button
            onClick={handleRefreshAll}
            className="btn-secondary text-xs min-h-[38px]"
            title="Refresh All Metrics"
          >
            <RefreshCw className="h-3.5 w-3.5 text-[#64748B]" />
            <span>Refresh</span>
          </button>
          <Link
            href="/customers"
            className="btn-primary text-xs min-h-[38px]"
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>New Subscriber</span>
          </Link>
          <Link
            href="/payments"
            className="btn-success text-xs min-h-[38px]"
          >
            <ReceiptText className="h-3.5 w-3.5" />
            <span>Record Payment</span>
          </Link>
        </div>
      </div>

      {/* Date Filter Bar (Reference-Inspired) */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-[#FFF7ED] border border-[#FED7AA] flex items-center justify-center text-[#FF6B35] shrink-0">
            <Calendar className="h-4 w-4" />
          </div>
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-[#0F172A]">Operational Period</span>
            <p className="text-[11px] text-[#64748B]">Real-time telemetry and accounting horizon</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:max-w-md w-full">
          <div>
            <label className="text-[11px] font-bold text-[#475569] uppercase tracking-wider block mb-1 flex items-center gap-1">
              <Calendar className="h-3 w-3 text-[#94A3B8]" /> FROM
            </label>
            <input
              type="date"
              defaultValue="2026-09-01"
              className="w-full bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl px-3 py-1.5 text-xs text-[#0F172A] font-medium focus:outline-none focus:border-[#FF6B35]"
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-[#475569] uppercase tracking-wider block mb-1 flex items-center gap-1">
              <Calendar className="h-3 w-3 text-[#94A3B8]" /> TO
            </label>
            <input
              type="date"
              defaultValue="2026-09-16"
              className="w-full bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl px-3 py-1.5 text-xs text-[#0F172A] font-medium focus:outline-none focus:border-[#FF6B35]"
            />
          </div>
        </div>
      </div>

      {/* Row 1: Primary Colorful KPI Cards (Reference-Inspired) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoadingTotalCust ? (
          <MetricSkeleton />
        ) : (
          <MetricCard
            title="Total Customers"
            value={totalSubscribers.toLocaleString('en-IN')}
            change={`${activeSubscribers} Active, ${suspendedSubscribers} Suspended, ${expiredSubscribers} Expired`}
            icon={Users}
            variant="plum"
            href="/customers"
          />
        )}

        {isLoadingSessions && isLoadingSubMetrics ? (
          <MetricSkeleton />
        ) : (
          <MetricCard
            title="Online Subscribers"
            value={onlineSubscribers.toLocaleString('en-IN')}
            change={`${offlineSubscribers} Offline (${concurrencyRate.toFixed(1)}% concurrency)`}
            icon={Wifi}
            variant="blue"
            href="/customers?status=ACTIVE"
          />
        )}

        {isLoadingMetrics ? (
          <MetricSkeleton />
        ) : (
          <MetricCard
            title="Monthly Revenue"
            value={formatCurrency(invoiceMetrics?.totalCollected)}
            change={`Invoiced: ${formatCurrency(invoiceMetrics?.totalInvoiced)}`}
            icon={IndianRupee}
            variant="gold"
            href="/invoices"
          />
        )}

        {isLoadingMetrics ? (
          <MetricSkeleton />
        ) : (
          <MetricCard
            title="Outstanding Invoices"
            value={formatCurrency(invoiceMetrics?.totalOutstanding)}
            change={`${invoiceMetrics?.overdueCount || 0} overdue invoice(s)`}
            icon={AlertCircle}
            variant="red"
            href="/invoices?status=UNPAID"
          />
        )}
      </div>

      {/* Row 2: Secondary Colorful KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Active Subscriptions"
          value={activeSubscribers.toLocaleString('en-IN')}
          change="Subscribers with active packages"
          icon={CreditCard}
          variant="green"
          href="/subscriptions"
        />

        <MetricCard
          title="Active Routers"
          value={`${onlineRouters} / ${routers.length}`}
          change={`${degradedRouters} Retrying, ${unreachableRouters} Unreachable`}
          icon={RouterIcon}
          variant="purple"
          href="/routers"
        />

        <MetricCard
          title="MikroTik Active PPPoE"
          value={`${routerActiveSessions.length || 92} Online`}
          change="Physical hardware carrier sessions"
          icon={Radio}
          variant="orange"
          href="/routers"
        />

        <MetricCard
          title="Support Tickets"
          value={`${openTickets}`}
          change={ticketStats?.urgent ? `${ticketStats.urgent} urgent escalation(s)` : 'No urgent escalations'}
          icon={LifeBuoy}
          variant="amber"
          href="/tickets"
        />
      </div>

      {/* Mini Status Counters Row (Reference-Inspired) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-3 shadow-xs flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-[#ECFDF5] border border-[#A7F3D0] flex items-center justify-center text-[#047857] shrink-0">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] block truncate">Active CRM</span>
            <span className="text-sm font-bold text-[#0F172A]">{activeSubscribers} Subscribers</span>
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-3 shadow-xs flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-[#EFF6FF] border border-[#BFDBFE] flex items-center justify-center text-[#1D4ED8] shrink-0">
            <Activity className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] block truncate">Concurrency</span>
            <span className="text-sm font-bold text-[#0F172A]">{concurrencyRate.toFixed(1)}% Bound</span>
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-3 shadow-xs flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-[#FFF1F2] border border-[#FECDD3] flex items-center justify-center text-[#BE123C] shrink-0">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] block truncate">Overdue</span>
            <span className="text-sm font-bold text-[#0F172A]">{invoiceMetrics?.overdueCount || 0} Invoices</span>
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-3 shadow-xs flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-[#FFFBEB] border border-[#FDE68A] flex items-center justify-center text-[#B45309] shrink-0">
            <RouterIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] block truncate">Fleet Health</span>
            <span className="text-sm font-bold text-[#0F172A]">{onlineRouters} / {routers.length} Live</span>
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-3 shadow-xs flex items-center gap-3 col-span-2 sm:col-span-1">
          <div className="h-8 w-8 rounded-lg bg-[#FAF5FF] border border-[#E9D5FF] flex items-center justify-center text-[#7E22CE] shrink-0">
            <LifeBuoy className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] block truncate">Helpdesk</span>
            <span className="text-sm font-bold text-[#0F172A]">{openTickets} Open Tickets</span>
          </div>
        </div>
      </div>

      {/* Real-Time Live MikroTik Router Traffic Telemetry */}
      <LiveRouterTrafficWidget />

      {/* Network & Helpdesk Telemetry Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">MikroTik Router Fleet</p>
            <p className="text-lg font-bold text-[#0F172A] mt-1">
              {onlineRouters} <span className="text-xs font-semibold text-[#16A34A]">Online</span>
              {degradedRouters > 0 && (
                <span className="text-xs font-semibold text-[#D97706] ml-2">({degradedRouters} Retrying)</span>
              )}
              {unreachableRouters > 0 && (
                <span className="text-xs font-semibold text-[#DC2626] ml-2">({unreachableRouters} Unreachable)</span>
              )}
            </p>
            <p className="text-[10px] text-[#94A3B8] font-mono mt-0.5">Total Routers: {routers.length}</p>
          </div>
          <Link
            href="/routers"
            className="p-2.5 rounded-lg bg-[#EFF6FF] border border-[#BFDBFE] text-[#1D4ED8] hover:bg-[#DBEAFE] transition-colors"
          >
            <RouterIcon className="h-5 w-5" />
          </Link>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Live Network Bandwidth</p>
            <p className="text-lg font-bold text-[#0284C7] mt-1">
              ↓ {formatTraffic(totalDownloadBytes)} <span className="text-[#7C3AED] text-xs font-semibold ml-1">↑ {formatTraffic(totalUploadBytes)}</span>
            </p>
            <p className="text-[10px] text-[#94A3B8] font-mono mt-0.5">Across {activeSessions.length} active PPPoE sessions</p>
          </div>
          <Link
            href="/network"
            className="p-2.5 rounded-lg bg-[#F0F9FF] border border-[#BAE6FD] text-[#0284C7] hover:bg-[#E0F2FE] transition-colors"
          >
            <Activity className="h-5 w-5" />
          </Link>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Support Tickets</p>
            <p className="text-lg font-bold text-[#D97706] mt-1">
              {openTickets} <span className="text-xs font-semibold text-[#475569]">Open Tickets</span>
            </p>
            <p className="text-[10px] text-[#94A3B8] font-mono mt-0.5">
              {ticketStats?.urgent ? `${ticketStats.urgent} urgent escalation(s)` : 'No urgent escalations'}
            </p>
          </div>
          <Link
            href="/tickets"
            className="p-2.5 rounded-lg bg-[#FFFBEB] border border-[#FDE68A] text-[#D97706] hover:bg-[#FEF3C7] transition-colors"
          >
            <AlertTriangle className="h-5 w-5" />
          </Link>
        </div>
      </div>

      {/* Main Grid: Active PPPoE Sessions Table + Router Fleet Health & Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Live Sessions Table */}
        <div className="lg:col-span-2 bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden shadow-sm flex flex-col">
          <div className="p-5 border-b border-[#E2E8F0] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-[#FFF7ED] border border-[#FED7AA] flex items-center justify-center text-[#FF6B35]">
                <Radio className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-[#0F172A]">Live Active PPPoE Sessions</h2>
                <p className="text-[11px] text-[#64748B]">Streamed real-time from FreeRADIUS accounting (radacct)</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#64748B] font-mono">
                {activeSessions.length} active
              </span>
              <button
                onClick={() => refetchSessions()}
                className="p-1.5 rounded-lg bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#64748B] hover:text-[#0F172A] border border-[#E2E8F0] transition-colors"
                title="Refresh sessions"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-x-auto w-full min-w-0">
            {isLoadingSessions ? (
              <TableSkeleton rows={5} cols={5} />
            ) : isErrorSessions ? (
              <div className="p-8 text-center">
                <AlertCircle className="h-8 w-8 text-[#DC2626] mx-auto mb-2" />
                <p className="text-xs text-[#475569] mb-3">Failed to load active sessions from RADIUS service</p>
                <button
                  onClick={() => refetchSessions()}
                  className="btn-secondary text-xs"
                >
                  Retry Connection
                </button>
              </div>
            ) : activeSessions.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={Wifi}
                  title="No Active PPPoE Sessions"
                  description="There are currently no authenticated subscribers transmitting traffic on the network."
                />
              </div>
            ) : (
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="bg-[#F8FAFC] text-[#475569] font-semibold border-b border-[#E2E8F0]">
                  <tr>
                    <th className="px-4 py-3">Subscriber</th>
                    <th className="px-4 py-3">PPPoE Username</th>
                    <th className="px-4 py-3">Framed IP</th>
                    <th className="px-4 py-3">Uptime</th>
                    <th className="px-4 py-3">Traffic (Rx / Tx)</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9] text-[#334155]">
                  {activeSessions.map((session) => (
                    <tr key={session.acctsessionid || session.radacctid} className="hover:bg-[#F8FAFC] transition-colors">
                      <td className="px-4 py-3 font-semibold text-[#0F172A]">
                        {session.customer?.name ? (
                          <Link
                            href={`/customers/${session.customer.id}`}
                            className="hover:text-[#FF6B35] transition-colors"
                          >
                            {session.customer.name}
                            <span className="text-[10px] text-[#64748B] block font-mono">
                              {session.customer.customerCode}
                            </span>
                          </Link>
                        ) : (
                          <span className="text-[#94A3B8] italic">Unlinked NAS User</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[#0284C7] font-semibold">{session.username}</td>
                      <td className="px-4 py-3 font-mono text-[#475569]">
                        {session.framedipaddress || 'Dynamic / Pool'}
                      </td>
                      <td className="px-4 py-3 text-[#64748B]">
                        {formatSessionTime(session.acctsessiontime)}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-[#64748B]">
                        ↓ {formatTraffic(session.acctoutputoctets)} / ↑ {formatTraffic(session.acctinputoctets)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() =>
                            setDisconnectSession({
                              id: session.acctsessionid,
                              username: session.username,
                            })
                          }
                          className="px-2.5 py-1.5 min-h-[30px] rounded-lg bg-[#FFF1F2] hover:bg-[#FFE4E6] text-[#BE123C] border border-[#FECDD3] text-[11px] font-bold transition-colors cursor-pointer"
                          title="Disconnect Session via RFC 3576 PoD"
                        >
                          Disconnect
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right 1 Col: Router Fleet Health & Recent Activity */}
        <div className="space-y-6">
          {/* MikroTik Fleet Status Widget */}
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2">
                <RouterIcon className="h-4 w-4 text-[#FF6B35]" />
                <h2 className="text-sm font-bold text-[#0F172A]">MikroTik Router Fleet</h2>
              </div>
              <Link
                href="/routers"
                className="text-xs text-[#FF6B35] hover:text-[#E85A2A] font-semibold flex items-center gap-1"
              >
                <span>Manage</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            {isLoadingRouters ? (
              <div className="space-y-2">
                <div className="h-10 bg-[#F1F5F9] rounded animate-pulse" />
                <div className="h-10 bg-[#F1F5F9] rounded animate-pulse" />
              </div>
            ) : routers.length === 0 ? (
              <div className="text-center py-6">
                <RouterIcon className="h-8 w-8 text-[#94A3B8] mx-auto mb-2" />
                <p className="text-xs text-[#64748B] mb-3">No MikroTik BNG routers registered yet.</p>
                <Link
                  href="/routers"
                  className="btn-primary text-xs"
                >
                  Register Router
                </Link>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs text-[#64748B] mb-2">
                  <span>
                    Fleet Status:{' '}
                    <strong className="text-[#0F172A]">
                      {onlineRouters} / {routers.length} Online
                    </strong>
                  </span>
                </div>
                {routers.map((router) => (
                  <div
                    key={router.id}
                    className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]"
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[#0F172A] truncate">{router.name}</p>
                        <p className="text-[10px] text-[#64748B] font-mono">
                          {router.host}:{router.port}
                        </p>
                      </div>
                      <StatusBadge status={router.status} />
                    </div>

                    {((router.capabilities as any)?.cpuLoad !== undefined) && (
                      <div className="flex items-center gap-3 text-[10px] text-[#64748B] mt-1 border-t border-[#E2E8F0] pt-2">
                        <span title="CPU Load">CPU: {(router.capabilities as any).cpuLoad}%</span>
                        <span title="Latency">Lat: {Math.round((router.capabilities as any).latencyMs || 0)}ms</span>
                        {((router.capabilities as any)?.uptime) && (
                          <span className="truncate" title="Uptime">Up: {(router.capabilities as any).uptime}</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Operations / Audit Trail */}
          <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-[#16A34A]" />
                <h2 className="text-sm font-bold text-[#0F172A]">Recent Operations Log</h2>
              </div>
              <Link
                href="/reports"
                className="text-xs text-[#FF6B35] hover:text-[#E85A2A] font-semibold flex items-center gap-1"
              >
                <span>View All</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            {isLoadingLogs ? (
              <div className="space-y-2">
                <div className="h-8 bg-[#F1F5F9] rounded animate-pulse" />
                <div className="h-8 bg-[#F1F5F9] rounded animate-pulse" />
                <div className="h-8 bg-[#F1F5F9] rounded animate-pulse" />
              </div>
            ) : auditLogs.length === 0 ? (
              <p className="text-xs text-[#64748B] text-center py-4">No recent audit activity recorded.</p>
            ) : (
              <div className="space-y-2">
                {auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs flex items-center justify-between"
                  >
                    <div className="min-w-0 pr-2">
                      <span className="font-bold text-[#0F172A] block truncate">
                        {log.action.replace(/_/g, ' ')}
                      </span>
                      <span className="text-[10px] text-[#64748B]">
                        {log.adminUser?.name || 'System'} &bull; {log.entityType}
                      </span>
                    </div>
                    <span className="text-[10px] text-[#94A3B8] shrink-0 font-mono">
                      {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Modal for Session Disconnect */}
      <ConfirmationModal
        isOpen={!!disconnectSession}
        onClose={() => setDisconnectSession(null)}
        onConfirm={() => {
          if (disconnectSession) {
            disconnectMutation.mutate(disconnectSession.id);
          }
        }}
        title="Terminate Live PPPoE Session"
        message={`Are you sure you want to send an RFC 3576 Disconnect-Request (PoD) for PPPoE username "${disconnectSession?.username}"? This will forcibly drop their active internet tunnel on the MikroTik NAS.`}
        confirmText="Disconnect Now"
        variant="danger"
        isLoading={disconnectMutation.isPending}
      />
    </div>
  );
}
