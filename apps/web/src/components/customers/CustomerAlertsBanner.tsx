'use client';

import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronRight, Info } from 'lucide-react';
import { OperationalAlert } from './CustomerAlertsModal';

interface CustomerAlertsBannerProps {
  alerts: OperationalAlert[];
  onOpenAllAlerts?: () => void;
}

export function CustomerAlertsBanner({
  alerts,
  onOpenAllAlerts,
}: CustomerAlertsBannerProps) {
  if (alerts.length === 0) {
    return (
      <div className="bg-slate-900/60 border border-emerald-500/20 rounded-2xl p-3.5 sm:p-4 flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <span className="font-semibold text-emerald-400">Account Status: Good Standing</span>
            <span className="text-slate-400 block sm:inline sm:ml-2">
              No active operational alerts, pending suspensions, or billing blocks.
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Find the highest-severity alert to display prominently
  const primaryAlert =
    alerts.find((a) => a.type === 'danger') ||
    alerts.find((a) => a.type === 'warning') ||
    alerts[0];

  const isDanger = primaryAlert.type === 'danger';
  const isWarning = primaryAlert.type === 'warning';

  return (
    <div
      className={`rounded-2xl p-3.5 sm:p-4 border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs transition-all ${
        isDanger
          ? 'bg-rose-950/30 border-rose-500/30 text-rose-200'
          : isWarning
          ? 'bg-amber-950/30 border-amber-500/30 text-amber-200'
          : 'bg-blue-950/30 border-blue-500/30 text-blue-200'
      }`}
    >
      <div className="flex items-start sm:items-center gap-3 min-w-0">
        <div
          className={`p-1.5 rounded-lg shrink-0 mt-0.5 sm:mt-0 ${
            isDanger
              ? 'bg-rose-500/20 text-rose-400'
              : isWarning
              ? 'bg-amber-500/20 text-amber-400'
              : 'bg-blue-500/20 text-blue-400'
          }`}
        >
          {isDanger ? (
            <AlertCircle className="h-4 w-4" />
          ) : isWarning ? (
            <AlertTriangle className="h-4 w-4" />
          ) : (
            <Info className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold uppercase tracking-wider text-[11px] text-slate-300">
              Attention:
            </span>
            <span className="font-bold text-slate-100">{primaryAlert.title}</span>
            {alerts.length > 1 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                +{alerts.length - 1} more
              </span>
            )}
          </div>
          <p className="text-slate-400 mt-0.5 line-clamp-1">{primaryAlert.description}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
        {primaryAlert.actionLabel && primaryAlert.onAction && (
          <button
            type="button"
            onClick={primaryAlert.onAction}
            className={`px-3 py-1.5 rounded-xl font-semibold text-xs shadow-md transition-all min-h-[36px] ${
              isDanger
                ? 'bg-rose-600 hover:bg-rose-500 text-white'
                : isWarning
                ? 'bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold'
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}
          >
            {primaryAlert.actionLabel}
          </button>
        )}

        {alerts.length > 1 && onOpenAllAlerts && (
          <button
            type="button"
            onClick={onOpenAllAlerts}
            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs transition-colors min-h-[36px] inline-flex items-center gap-1"
          >
            <span>All Alerts ({alerts.length})</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
