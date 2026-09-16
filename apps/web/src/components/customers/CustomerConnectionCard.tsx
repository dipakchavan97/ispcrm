'use client';

import React from 'react';
import {
  Activity,
  RefreshCw,
  Eye,
  Radio,
  CheckCircle2,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
} from 'lucide-react';
import { formatBytes, formatDuration } from '../../lib/formatters';

interface CustomerConnectionCardProps {
  connection: any;
  isLoading?: boolean;
  onRefresh: () => void;
  onViewAccessRequests: () => void;
}

export function CustomerConnectionCard({
  connection,
  isLoading = false,
  onRefresh,
  onViewAccessRequests,
}: CustomerConnectionCardProps) {
  const isOnline = connection?.isOnline ?? false;
  const hasHistory = Boolean(connection?.acctSessionId || connection?.loginTime);

  // Observed vs Authorized MAC match
  const isMacMatch = connection?.isMacMatch ?? true;

  // Session duration text
  let sessionTime = 'Offline';
  if (isOnline && connection?.sessionDuration) {
    sessionTime = `Active for ${formatDuration(connection.sessionDuration)}`;
  } else if (!isOnline && connection?.terminateCause) {
    sessionTime = `Last terminated: ${connection.terminateCause}`;
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-5">
      {/* Header Bar */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
              }`}
            />
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-100">
              Live Connection
            </h2>
          </div>
          <span className="text-xs text-slate-400 font-medium">
            • {sessionTime}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onViewAccessRequests}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-colors min-h-[36px]"
            title="View recent RADIUS authentication requests (radpostauth)"
          >
            <Eye className="h-3.5 w-3.5 text-blue-400" />
            <span>Access Requests</span>
          </button>

          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center disabled:opacity-50"
            title="Refresh connection telemetry"
            aria-label="Refresh connection telemetry"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </div>

      {!hasHistory ? (
        <div className="p-8 text-center bg-slate-950/40 rounded-xl border border-slate-800/80">
          <Radio className="h-8 w-8 text-slate-600 mx-auto mb-2" />
          <h3 className="text-xs font-semibold text-slate-300">No Connection History Available</h3>
          <p className="text-[11px] text-slate-500 mt-1 max-w-sm mx-auto">
            This subscriber has not dialed in through PPPoE yet, or no accounting sessions have been recorded in FreeRADIUS.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Clean 2-4 column telemetry grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-xs">
            {/* IP Address */}
            <div className="space-y-1">
              <span className="text-[11px] text-slate-500 uppercase tracking-wider block font-medium">
                IP Address
              </span>
              <span className="font-mono text-sm font-bold text-cyan-300 block truncate">
                {connection?.framedIp || '—'}
              </span>
            </div>

            {/* Authorized MAC */}
            <div className="space-y-1">
              <span className="text-[11px] text-slate-500 uppercase tracking-wider block font-medium">
                Authorized MAC
              </span>
              <span className="font-mono text-sm font-bold text-purple-300 block truncate">
                {connection?.authorizedMac || 'Unrestricted'}
              </span>
            </div>

            {/* Observed MAC */}
            <div className="space-y-1">
              <span className="text-[11px] text-slate-500 uppercase tracking-wider block font-medium">
                Observed MAC
              </span>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-sm font-bold text-slate-200 truncate">
                  {connection?.callingStationId || '—'}
                </span>
                {connection?.callingStationId && (
                  isMacMatch ? (
                    <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-0.5 shrink-0" title="Device matches authorization">
                      <CheckCircle2 className="h-3 w-3" />
                      <span>Match</span>
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold text-rose-400 flex items-center gap-0.5 shrink-0" title="Device mismatch">
                      <AlertTriangle className="h-3 w-3" />
                      <span>Mismatch</span>
                    </span>
                  )
                )}
              </div>
            </div>

            {/* RADIUS Username */}
            <div className="space-y-1">
              <span className="text-[11px] text-slate-500 uppercase tracking-wider block font-medium">
                RADIUS Username
              </span>
              <span className="font-mono text-sm font-semibold text-emerald-400 block truncate">
                {connection?.username || '—'}
              </span>
            </div>

            {/* Router / NAS */}
            <div className="space-y-1">
              <span className="text-[11px] text-slate-500 uppercase tracking-wider block font-medium">
                Router / NAS
              </span>
              <span className="text-sm font-medium text-slate-200 block truncate">
                {connection?.routerName || 'MikroTik Router'}
                {connection?.nasIp && (
                  <span className="font-mono text-xs text-slate-400 ml-1">({connection.nasIp})</span>
                )}
              </span>
            </div>

            {/* Service Type */}
            <div className="space-y-1">
              <span className="text-[11px] text-slate-500 uppercase tracking-wider block font-medium">
                Service Type
              </span>
              <span className="text-sm font-medium text-slate-200 block">
                {connection?.serviceType || 'PPPoE'}
              </span>
            </div>

            {/* Rate Limit */}
            <div className="space-y-1">
              <span className="text-[11px] text-slate-500 uppercase tracking-wider block font-medium">
                Bandwidth Rate Limit
              </span>
              <span className="font-mono text-sm font-bold text-blue-400 block">
                {connection?.rateLimit || '50M / 50M'}
              </span>
            </div>

            {/* Session ID */}
            <div className="space-y-1">
              <span className="text-[11px] text-slate-500 uppercase tracking-wider block font-medium">
                Session ID
              </span>
              <span className="font-mono text-xs text-slate-400 block truncate" title={connection?.acctSessionId}>
                {connection?.acctSessionId || '—'}
              </span>
            </div>
          </div>

          {/* Active Session Traffic Bar if Online */}
          {isOnline && (connection?.inputOctets > 0 || connection?.outputOctets > 0) && (
            <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs bg-slate-950/40 p-3 rounded-xl flex-wrap gap-2">
              <span className="text-slate-400 font-medium">Current Session Transfer:</span>
              <div className="flex items-center gap-4 font-mono font-semibold">
                <span className="text-emerald-400 inline-flex items-center gap-1">
                  <ArrowDown className="h-3 w-3" />
                  <span>Down: {formatBytes(connection.outputOctets)}</span>
                </span>
                <span className="text-blue-400 inline-flex items-center gap-1">
                  <ArrowUp className="h-3 w-3" />
                  <span>Up: {formatBytes(connection.inputOctets)}</span>
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
