'use client';

import React from 'react';
import {
  BarChart3,
  ArrowDown,
  ArrowUp,
  Clock,
  RefreshCw,
  HardDrive,
} from 'lucide-react';
import { formatBytes, formatDuration } from '../../lib/formatters';

interface UsageBucket {
  uploadBytes: number;
  downloadBytes: number;
  totalBytes: number;
  durationSecs: number;
}

interface CustomerUsageCardProps {
  usage?: {
    today: UsageBucket;
    month: UsageBucket;
    lifetime: UsageBucket;
    lastUpdated?: string;
  };
  isLoading?: boolean;
  onRefresh: () => void;
}

export function CustomerUsageCard({
  usage,
  isLoading = false,
  onRefresh,
}: CustomerUsageCardProps) {
  const hasUsage = usage && (usage.lifetime?.totalBytes > 0 || usage.lifetime?.durationSecs > 0);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <BarChart3 className="h-4 w-4 text-blue-400" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-100">
            Data Usage
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {usage?.lastUpdated && (
            <span className="text-[11px] text-slate-500 font-mono hidden sm:inline">
              Updated {new Date(usage.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center disabled:opacity-50"
            title="Refresh RADIUS data usage"
            aria-label="Refresh RADIUS data usage"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </div>

      {!hasUsage && !isLoading ? (
        <div className="p-8 text-center bg-slate-950/40 rounded-xl border border-slate-800/80">
          <HardDrive className="h-8 w-8 text-slate-600 mx-auto mb-2" />
          <h3 className="text-xs font-semibold text-slate-300">No Usage Data Available</h3>
          <p className="text-[11px] text-slate-500 mt-1 max-w-sm mx-auto">
            Zero accounting octets recorded in FreeRADIUS for this subscriber.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 3 Metric Buckets: Today, This Month, Lifetime */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* 1. Today */}
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                Today
              </span>
              <div className="text-xl sm:text-2xl font-black font-mono text-emerald-400 tracking-tight">
                {formatBytes(usage?.today?.totalBytes)}
              </div>
              <div className="space-y-1 text-xs font-mono font-medium pt-1 border-t border-slate-800/80 text-slate-400">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-slate-500">
                    <ArrowDown className="h-3 w-3 text-emerald-400" /> Down:
                  </span>
                  <span className="text-slate-200">{formatBytes(usage?.today?.downloadBytes)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-slate-500">
                    <ArrowUp className="h-3 w-3 text-blue-400" /> Up:
                  </span>
                  <span className="text-slate-200">{formatBytes(usage?.today?.uploadBytes)}</span>
                </div>
              </div>
            </div>

            {/* 2. This Month */}
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                This Month
              </span>
              <div className="text-xl sm:text-2xl font-black font-mono text-blue-400 tracking-tight">
                {formatBytes(usage?.month?.totalBytes)}
              </div>
              <div className="space-y-1 text-xs font-mono font-medium pt-1 border-t border-slate-800/80 text-slate-400">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-slate-500">
                    <ArrowDown className="h-3 w-3 text-emerald-400" /> Down:
                  </span>
                  <span className="text-slate-200">{formatBytes(usage?.month?.downloadBytes)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-slate-500">
                    <ArrowUp className="h-3 w-3 text-blue-400" /> Up:
                  </span>
                  <span className="text-slate-200">{formatBytes(usage?.month?.uploadBytes)}</span>
                </div>
              </div>
            </div>

            {/* 3. Lifetime */}
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                Lifetime
              </span>
              <div className="text-xl sm:text-2xl font-black font-mono text-purple-400 tracking-tight">
                {formatBytes(usage?.lifetime?.totalBytes)}
              </div>
              <div className="space-y-1 text-xs font-mono font-medium pt-1 border-t border-slate-800/80 text-slate-400">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-slate-500">
                    <ArrowDown className="h-3 w-3 text-emerald-400" /> Down:
                  </span>
                  <span className="text-slate-200">{formatBytes(usage?.lifetime?.downloadBytes)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-slate-500">
                    <ArrowUp className="h-3 w-3 text-blue-400" /> Up:
                  </span>
                  <span className="text-slate-200">{formatBytes(usage?.lifetime?.uploadBytes)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Connection Time Summary Footer */}
          <div className="p-3 rounded-xl bg-slate-950/40 border border-slate-800/80 flex items-center justify-between text-xs flex-wrap gap-2">
            <span className="text-slate-400 font-medium flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-slate-500" />
              <span>Connection Time:</span>
            </span>
            <div className="flex items-center gap-4 font-semibold text-slate-300">
              <span>Today: <strong className="font-mono text-slate-100">{formatDuration(usage?.today?.durationSecs || 0)}</strong></span>
              <span>•</span>
              <span>This Month: <strong className="font-mono text-slate-100">{formatDuration(usage?.month?.durationSecs || 0)}</strong></span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
