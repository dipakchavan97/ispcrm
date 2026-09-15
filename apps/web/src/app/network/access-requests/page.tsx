'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  CheckCircle2,
  XCircle,
  Search,
  RefreshCw,
  Filter,
  Clock,
  ShieldAlert,
  ShieldCheck,
  ArrowLeft,
  Calendar,
  User,
  ExternalLink,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Radio,
  WifiOff,
  RotateCcw,
} from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import { useToast } from '../../../components/Toast';

interface AccessRequestItem {
  id: string;
  authdate: string | null;
  username: string;
  reply: string;
  status: 'ACCEPT' | 'REJECT';
  customerId: string | null;
  customerCode: string | null;
  customerName: string | null;
  customerStatus: string | null;
  macAddress: string | null;
  callingStationId: string | null;
  framedIpAddress: string | null;
  nasIpAddress: string | null;
  rejectionReason: string;
}

interface AccessRequestsResponse {
  items: AccessRequestItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function formatTimestamp(isoString: string | null) {
  if (!isoString) return { formatted: 'Unknown', relative: '' };
  const d = new Date(isoString);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);

  let relative = '';
  if (diffSec < 60) relative = `${Math.max(1, diffSec)}s ago`;
  else if (diffSec < 3600) relative = `${Math.floor(diffSec / 60)}m ago`;
  else if (diffSec < 86400) relative = `${Math.floor(diffSec / 3600)}h ago`;
  else relative = `${Math.floor(diffSec / 86400)}d ago`;

  const formatted = d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return { formatted, relative };
}

export default function AccessRequestsPage() {
  const { showToast } = useToast();

  // Search & Filter State
  const [usernameSearch, setUsernameSearch] = useState('');
  const [macSearch, setMacSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACCEPT' | 'REJECT'>('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Build query string
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', page.toString());
    params.set('limit', limit.toString());
    if (usernameSearch.trim()) params.set('username', usernameSearch.trim());
    if (macSearch.trim()) params.set('mac', macSearch.trim());
    if (statusFilter !== 'ALL') params.set('status', statusFilter);
    if (fromDate) params.set('fromDate', new Date(fromDate).toISOString());
    if (toDate) params.set('toDate', new Date(toDate).toISOString());
    return params.toString();
  }, [page, limit, usernameSearch, macSearch, statusFilter, fromDate, toDate]);

  // Fetch access requests
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useQuery<AccessRequestsResponse>({
    queryKey: ['radius-access-requests', queryParams],
    queryFn: () => apiFetch(`/radius/access-requests?${queryParams}`),
    refetchInterval: autoRefresh ? 15000 : false,
  });

  const total = data?.total || 0;
  const items = data?.items || [];
  const totalPages = data?.totalPages || 1;

  // Compute metrics in current view
  const acceptCount = items.filter((i) => i.status === 'ACCEPT').length;
  const rejectCount = items.filter((i) => i.status === 'REJECT').length;
  const latestTimestamp = items[0]?.authdate ? formatTimestamp(items[0].authdate).relative : 'None';

  const hasActiveFilters =
    Boolean(usernameSearch.trim()) ||
    Boolean(macSearch.trim()) ||
    statusFilter !== 'ALL' ||
    Boolean(fromDate) ||
    Boolean(toDate);

  const handleResetFilters = () => {
    setUsernameSearch('');
    setMacSearch('');
    setStatusFilter('ALL');
    setFromDate('');
    setToDate('');
    setPage(1);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* 1. Header & Navigation */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl sm:rounded-2xl p-4 sm:p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <Link
                href="/network"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white transition-colors bg-slate-800/80 hover:bg-slate-800 px-2.5 py-1.5 rounded-lg border border-slate-700/80"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Command Center</span>
              </Link>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <Radio className="h-3 w-3 mr-1 animate-pulse text-indigo-400" />
                FreeRADIUS radpostauth
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2.5 mt-2.5">
              <ShieldCheck className="h-6 w-6 text-indigo-400 shrink-0" />
              <span>Live RADIUS Access Request Log</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Real-time audit log of all subscriber authentication attempts, packet responses, and failure diagnostics
            </p>
          </div>

          {/* Refresh Controls */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                autoRefresh
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
              }`}
              title="Toggle 15-second automatic polling"
            >
              <Clock className="h-3.5 w-3.5" />
              <span>Auto-refresh {autoRefresh ? 'ON (15s)' : 'OFF'}</span>
            </button>

            <button
              onClick={() => {
                refetch();
                showToast('Access request logs refreshed', 'info');
              }}
              disabled={isRefetching}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white transition-colors cursor-pointer shadow-sm"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Overview Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Requests */}
        <div className="bg-[#0f172a] p-4 rounded-xl border border-slate-800 flex items-center justify-between shadow-lg">
          <div>
            <p className="text-[11px] font-medium uppercase text-slate-400">Total Attempts</p>
            <p className="text-2xl font-bold text-white mt-1">{total}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Matching current filters</p>
          </div>
          <div className="h-10 w-10 rounded-lg bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
            <Activity className="h-5 w-5" />
          </div>
        </div>

        {/* Accepted Logins */}
        <div className="bg-[#0f172a] p-4 rounded-xl border border-slate-800 flex items-center justify-between shadow-lg">
          <div>
            <p className="text-[11px] font-medium uppercase text-emerald-400">Accepted</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{acceptCount}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Access-Accept packets</p>
          </div>
          <div className="h-10 w-10 rounded-lg bg-emerald-600/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
            <CheckCircle2 className="h-5 w-5" />
          </div>
        </div>

        {/* Rejected Logins */}
        <div className="bg-[#0f172a] p-4 rounded-xl border border-slate-800 flex items-center justify-between shadow-lg">
          <div>
            <p className="text-[11px] font-medium uppercase text-rose-400">Rejected / Failed</p>
            <p className="text-2xl font-bold text-rose-400 mt-1">{rejectCount}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Access-Reject packets</p>
          </div>
          <div className="h-10 w-10 rounded-lg bg-rose-600/10 border border-rose-500/20 flex items-center justify-center text-rose-400 shrink-0">
            <XCircle className="h-5 w-5" />
          </div>
        </div>

        {/* Latest Activity */}
        <div className="bg-[#0f172a] p-4 rounded-xl border border-slate-800 flex items-center justify-between shadow-lg">
          <div>
            <p className="text-[11px] font-medium uppercase text-slate-400">Latest Dial Attempt</p>
            <p className="text-2xl font-bold text-white mt-1">{latestTimestamp}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Most recent subscriber log</p>
          </div>
          <div className="h-10 w-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 shrink-0">
            <Clock className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* 3. Filters & Search Toolbar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg space-y-3">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Status Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-950 rounded-lg border border-slate-800 self-start">
            <button
              onClick={() => {
                setStatusFilter('ALL');
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                statusFilter === 'ALL'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Outcomes
            </button>
            <button
              onClick={() => {
                setStatusFilter('ACCEPT');
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                statusFilter === 'ACCEPT'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <span>Accepted Only</span>
            </button>
            <button
              onClick={() => {
                setStatusFilter('REJECT');
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                statusFilter === 'REJECT'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <XCircle className="h-3.5 w-3.5 text-rose-400" />
              <span>Rejected Only</span>
            </button>
          </div>

          {/* Quick Clear */}
          {hasActiveFilters && (
            <button
              onClick={handleResetFilters}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-amber-300 border border-amber-500/20 transition-colors cursor-pointer self-start lg:self-auto"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Clear Active Filters</span>
            </button>
          )}
        </div>

        {/* Input Filters Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          {/* Username Search */}
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-3 pointer-events-none" />
            <input
              type="text"
              placeholder="Search Username..."
              value={usernameSearch}
              onChange={(e) => {
                setUsernameSearch(e.target.value);
                setPage(1);
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          {/* MAC Address Search */}
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-3 pointer-events-none" />
            <input
              type="text"
              placeholder="Search MAC (e.g. AA:BB:CC)..."
              value={macSearch}
              onChange={(e) => {
                setMacSearch(e.target.value);
                setPage(1);
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          {/* Date From */}
          <div className="relative">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPage(1);
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 transition-colors"
              title="Filter attempts from this date"
            />
          </div>

          {/* Date To */}
          <div className="relative">
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setPage(1);
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 transition-colors"
              title="Filter attempts up to this date"
            />
          </div>
        </div>
      </div>

      {/* 4. Table / Content Container */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        {/* Loading State */}
        {isLoading && (
          <div className="p-8 space-y-4">
            <div className="flex items-center justify-center gap-3 text-slate-400">
              <RefreshCw className="h-5 w-5 animate-spin text-indigo-400" />
              <span className="text-xs font-medium">Fetching FreeRADIUS access request logs...</span>
            </div>
            <div className="space-y-2 pt-4">
              {[1, 2, 3, 4, 5].map((idx) => (
                <div key={idx} className="h-10 bg-slate-800/40 rounded-lg animate-pulse" />
              ))}
            </div>
          </div>
        )}

        {/* Error State */}
        {isError && (
          <div className="p-8 text-center space-y-3">
            <div className="h-12 w-12 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <p className="text-sm font-semibold text-white">Failed to Load Access Requests</p>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              {(error as any)?.message || 'An unexpected error occurred while querying the RADIUS log.'}
            </p>
            <button
              onClick={() => refetch()}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-white transition-colors cursor-pointer"
            >
              Retry Connection
            </button>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !isError && items.length === 0 && (
          <div className="p-12 text-center space-y-3">
            <div className="h-12 w-12 rounded-full bg-slate-800 border border-slate-700 text-slate-500 flex items-center justify-center mx-auto">
              <WifiOff className="h-6 w-6" />
            </div>
            <p className="text-sm font-semibold text-white">No Access Requests Found</p>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              {hasActiveFilters
                ? 'No authentication attempts match your current search and filter criteria. Try clearing or broadening the filters.'
                : 'No authentication attempts have been logged by FreeRADIUS yet for your subscribers.'}
            </p>
            {hasActiveFilters && (
              <button
                onClick={handleResetFilters}
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-xs font-semibold text-indigo-300 border border-indigo-500/30 transition-colors cursor-pointer"
              >
                Reset All Filters
              </button>
            )}
          </div>
        )}

        {/* Access Requests Table */}
        {!isLoading && !isError && items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-950/80 border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-3">Reply</th>
                  <th className="py-3 px-4">PPPoE Username</th>
                  <th className="py-3 px-4">Subscriber</th>
                  <th className="py-3 px-4">Failure Diagnosis & Reason</th>
                  <th className="py-3 px-3">Calling Station / MAC</th>
                  <th className="py-3 px-3">Framed IP</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {items.map((item) => {
                  const { formatted, relative } = formatTimestamp(item.authdate);
                  const isAccept = item.status === 'ACCEPT';

                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-800/30 transition-colors"
                    >
                      {/* Timestamp */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="text-slate-200 font-medium">{formatted}</div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <Clock className="h-3 w-3" />
                          <span>{relative}</span>
                        </div>
                      </td>

                      {/* Reply Badge */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        {isAccept ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 className="h-3 w-3" />
                            <span>Accept</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            <XCircle className="h-3 w-3" />
                            <span>Reject</span>
                          </span>
                        )}
                      </td>

                      {/* Username */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="font-mono text-xs text-indigo-300 font-medium bg-slate-800/70 px-2 py-0.5 rounded border border-slate-700/50">
                          {item.username}
                        </span>
                      </td>

                      {/* Subscriber Name & Status */}
                      <td className="py-3 px-4">
                        {item.customerId ? (
                          <div>
                            <Link
                              href={`/customers/${item.customerId}`}
                              className="font-medium text-white hover:text-indigo-400 transition-colors flex items-center gap-1"
                            >
                              <span>{item.customerName || 'Subscriber'}</span>
                              <ExternalLink className="h-3 w-3 text-slate-500" />
                            </Link>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-slate-400 font-mono">
                                {item.customerCode || ''}
                              </span>
                              {item.customerStatus && (
                                <span
                                  className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                                    item.customerStatus === 'ACTIVE'
                                      ? 'text-emerald-400 bg-emerald-500/10'
                                      : item.customerStatus === 'SUSPENDED'
                                      ? 'text-rose-400 bg-rose-500/10'
                                      : 'text-amber-400 bg-amber-500/10'
                                  }`}
                                >
                                  {item.customerStatus}
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-500 italic">Unregistered / Unknown</span>
                        )}
                      </td>

                      {/* Diagnosis & Rejection Reason */}
                      <td className="py-3 px-4">
                        <div
                          className={`inline-block px-2.5 py-1 rounded-md text-xs font-medium border ${
                            isAccept
                              ? 'bg-emerald-500/5 text-emerald-300 border-emerald-500/20'
                              : item.customerStatus === 'SUSPENDED'
                              ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                              : item.customerStatus === 'EXPIRED'
                              ? 'bg-orange-500/10 text-orange-300 border-orange-500/20'
                              : 'bg-rose-500/10 text-rose-300 border-rose-500/20'
                          }`}
                        >
                          {item.rejectionReason}
                        </div>
                      </td>

                      {/* Calling Station / MAC */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        {item.macAddress ? (
                          <span className="font-mono text-xs text-slate-300">
                            {item.macAddress}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>

                      {/* Framed IP */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        {item.framedIpAddress ? (
                          <span className="font-mono text-xs text-slate-300">
                            {item.framedIpAddress}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {item.customerId ? (
                          <Link
                            href={`/customers/${item.customerId}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-300 border border-slate-700 transition-colors"
                          >
                            <span>Profile</span>
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ) : (
                          <span className="text-slate-600 text-[11px]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 5. Pagination Controls */}
        {!isLoading && !isError && items.length > 0 && (
          <div className="bg-slate-950/60 border-t border-slate-800 px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <span>Show</span>
              <select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setPage(1);
                }}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span>per page</span>
              <span className="text-slate-600">|</span>
              <span>
                Showing <strong className="text-white">{(page - 1) * limit + 1}</strong> to{' '}
                <strong className="text-white">{Math.min(page * limit, total)}</strong> of{' '}
                <strong className="text-white">{total}</strong> attempts
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium text-slate-300 transition-colors cursor-pointer"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Prev</span>
              </button>

              <span className="px-2 font-medium text-slate-300">
                Page {page} of {totalPages}
              </span>

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium text-slate-300 transition-colors cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
