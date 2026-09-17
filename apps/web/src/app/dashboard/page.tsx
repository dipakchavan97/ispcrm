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
    refetchInterval: 15000, // Live poll every 15s for ISP NOC dashboard
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
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Banner / Operations Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl w-full min-w-0">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-lg sm:text-xl font-bold text-slate-100 tracking-tight">ISP Network & Billing Operations</h1>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-semibold">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live API
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real-time subscriber status, FreeRADIUS accounting, MikroTik fleet health, and GST ledger.
          </p>
        </div>
        <div className="flex items-center flex-wrap gap-2.5">
          <button
            onClick={handleRefreshAll}
            className="flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition-colors"
            title="Refresh All Metrics"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
          <Link
            href="/customers"
            className="flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/20 transition-all"
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>New Subscriber</span>
          </Link>
          <Link
            href="/payments"
            className="flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-500/20 transition-all"
          >
            <ReceiptText className="h-3.5 w-3.5" />
            <span>Record Payment</span>
          </Link>
        </div>
      </div>

      {/* Metric Cards Primary Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoadingTotalCust ? (
          <MetricSkeleton />
        ) : (
          <MetricCard
            title="Total Customers"
            value={totalSubscribers.toLocaleString('en-IN')}
            change={`${activeSubscribers} Active, ${suspendedSubscribers} Suspended, ${expiredSubscribers} Expired`}
            isPositive={activeSubscribers >= suspendedSubscribers}
            icon={Users}
            iconColor="text-blue-400"
          />
        )}

        {isLoadingSessions && isLoadingSubMetrics ? (
          <MetricSkeleton />
        ) : (
          <MetricCard
            title="Online Subscribers"
            value={onlineSubscribers.toLocaleString('en-IN')}
            change={`${offlineSubscribers} Offline (${concurrencyRate.toFixed(1)}% concurrency)`}
            isPositive={true}
            icon={Wifi}
            iconColor="text-emerald-400"
          />
        )}

        {isLoadingMetrics ? (
          <MetricSkeleton />
        ) : (
          <MetricCard
            title="Monthly Revenue"
            value={formatCurrency(invoiceMetrics?.totalCollected)}
            change={`Invoiced: ${formatCurrency(invoiceMetrics?.totalInvoiced)}`}
            isPositive={true}
            icon={IndianRupee}
            iconColor="text-cyan-400"
          />
        )}

        {isLoadingMetrics ? (
          <MetricSkeleton />
        ) : (
          <MetricCard
            title="Outstanding Invoices"
            value={formatCurrency(invoiceMetrics?.totalOutstanding)}
            change={`${invoiceMetrics?.overdueCount || 0} overdue invoice(s)`}
            isPositive={Number(invoiceMetrics?.totalOutstanding || 0) === 0}
            icon={AlertCircle}
            iconColor={Number(invoiceMetrics?.totalOutstanding || 0) > 0 ? 'text-rose-400' : 'text-slate-400'}
          />
        )}
      </div>

      {/* Real-Time Live MikroTik Router Traffic Telemetry */}
      <LiveRouterTrafficWidget />

      {/* Network & Helpdesk Telemetry Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase">MikroTik Router Fleet</p>
            <p className="text-lg font-bold text-white mt-1">
              {onlineRouters} <span className="text-xs font-normal text-emerald-400">Online</span>
              {degradedRouters > 0 && (
                <span className="text-xs font-normal text-amber-400 ml-2">({degradedRouters} Retrying)</span>
              )}
              {unreachableRouters > 0 && (
                <span className="text-xs font-normal text-rose-400 ml-2">({unreachableRouters} Unreachable)</span>
              )}
            </p>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">Total Routers: {routers.length}</p>
          </div>
          <Link
            href="/routers"
            className="p-2.5 rounded-lg bg-blue-600/10 border border-blue-500/20 text-blue-400 hover:bg-blue-600/20 transition-colors"
          >
            <RouterIcon className="h-5 w-5" />
          </Link>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase">Live Network Bandwidth</p>
            <p className="text-lg font-bold text-sky-400 mt-1">
              ↓ {formatTraffic(totalDownloadBytes)} <span className="text-purple-400 text-xs font-normal ml-1">↑ {formatTraffic(totalUploadBytes)}</span>
            </p>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">Across {activeSessions.length} active PPPoE sessions</p>
          </div>
          <Link
            href="/network"
            className="p-2.5 rounded-lg bg-sky-600/10 border border-sky-500/20 text-sky-400 hover:bg-sky-600/20 transition-colors"
          >
            <Activity className="h-5 w-5" />
          </Link>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase">Support Tickets</p>
            <p className="text-lg font-bold text-amber-400 mt-1">
              {openTickets} <span className="text-xs font-normal text-slate-300">Open Tickets</span>
            </p>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">
              {ticketStats?.urgent ? `${ticketStats.urgent} urgent escalation(s)` : 'No urgent escalations'}
            </p>
          </div>
          <Link
            href="/tickets"
            className="p-2.5 rounded-lg bg-amber-600/10 border border-amber-500/20 text-amber-400 hover:bg-amber-600/20 transition-colors"
          >
            <AlertTriangle className="h-5 w-5" />
          </Link>
        </div>
      </div>

      {/* Main Grid: Active PPPoE Sessions Table + Router Health & Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Live Sessions Table */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg flex flex-col">
          <div className="p-5 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                <Radio className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Live Active PPPoE Sessions</h2>
                <p className="text-[11px] text-slate-400">Streamed real-time from FreeRADIUS accounting (radacct)</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400 font-mono">
                {activeSessions.length} active
              </span>
              <button
                onClick={() => refetchSessions()}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
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
                <AlertCircle className="h-8 w-8 text-rose-400 mx-auto mb-2" />
                <p className="text-xs text-slate-300 mb-3">Failed to load active sessions from RADIUS service</p>
                <button
                  onClick={() => refetchSessions()}
                  className="px-3.5 py-2 min-h-[36px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700"
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
                <thead className="bg-slate-950/60 text-slate-400 font-medium border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-3">Subscriber</th>
                    <th className="px-4 py-3">PPPoE Username</th>
                    <th className="px-4 py-3">Framed IP</th>
                    <th className="px-4 py-3">Uptime</th>
                    <th className="px-4 py-3">Traffic (Rx / Tx)</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {activeSessions.map((session) => (
                    <tr key={session.acctsessionid || session.radacctid} className="hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-100">
                        {session.customer?.name ? (
                          <Link
                            href={`/customers/${session.customer.id}`}
                            className="hover:text-blue-400 transition-colors"
                          >
                            {session.customer.name}
                            <span className="text-[10px] text-slate-400 block font-mono">
                              {session.customer.customerCode}
                            </span>
                          </Link>
                        ) : (
                          <span className="text-slate-400 italic">Unlinked NAS User</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-blue-400">{session.username}</td>
                      <td className="px-4 py-3 font-mono text-slate-300">
                        {session.framedipaddress || 'Dynamic / Pool'}
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {formatSessionTime(session.acctsessiontime)}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-400">
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
                          className="px-2.5 py-1.5 min-h-[32px] rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-[11px] font-semibold transition-colors cursor-pointer"
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
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <RouterIcon className="h-4 w-4 text-blue-400" />
                <h2 className="text-sm font-semibold text-slate-100">MikroTik Router Fleet</h2>
              </div>
              <Link
                href="/routers"
                className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1"
              >
                <span>Manage</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            {isLoadingRouters ? (
              <div className="space-y-2">
                <div className="h-10 bg-slate-800 rounded animate-pulse" />
                <div className="h-10 bg-slate-800 rounded animate-pulse" />
              </div>
            ) : routers.length === 0 ? (
              <div className="text-center py-6">
                <RouterIcon className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                <p className="text-xs text-slate-400 mb-3">No MikroTik BNG routers registered yet.</p>
                <Link
                  href="/routers"
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold inline-block"
                >
                  Register Router
                </Link>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                  <span>
                    Fleet Status:{' '}
                    <strong className="text-slate-200">
                      {onlineRouters} / {routers.length} Online
                    </strong>
                  </span>
                </div>
                {routers.map((router) => (
                  <div
                    key={router.id}
                    className="flex flex-col gap-1.5 p-2.5 rounded-lg bg-slate-950/40 border border-slate-800/80"
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-200 truncate">{router.name}</p>
                        <p className="text-[10px] text-slate-400 font-mono">
                          {router.host}:{router.port}
                        </p>
                      </div>
                      <StatusBadge status={router.status} />
                    </div>

                    {((router.capabilities as any)?.cpuLoad !== undefined) && (
                      <div className="flex items-center gap-3 text-[10px] text-slate-400 mt-1 border-t border-slate-800/50 pt-2">
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
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-emerald-400" />
                <h2 className="text-sm font-semibold text-slate-100">Recent Operations Log</h2>
              </div>
              <Link
                href="/audit"
                className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1"
              >
                <span>View All</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            {isLoadingLogs ? (
              <div className="space-y-2">
                <div className="h-8 bg-slate-800 rounded animate-pulse" />
                <div className="h-8 bg-slate-800 rounded animate-pulse" />
                <div className="h-8 bg-slate-800 rounded animate-pulse" />
              </div>
            ) : auditLogs.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">No recent audit activity recorded.</p>
            ) : (
              <div className="space-y-2">
                {auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-2.5 rounded-lg bg-slate-950/40 border border-slate-800/80 text-xs flex items-center justify-between"
                  >
                    <div className="min-w-0 pr-2">
                      <span className="font-semibold text-slate-200 block truncate">
                        {log.action.replace('_', ' ')}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {log.adminUser?.name || 'System'} • {log.entityType}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-500 shrink-0 font-mono">
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
