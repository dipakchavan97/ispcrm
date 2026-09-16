'use client';

import React from 'react';
import {
  X,
  Bell,
  AlertTriangle,
  AlertCircle,
  ShieldAlert,
  Clock,
  IndianRupee,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';

export interface OperationalAlert {
  id: string;
  type: 'danger' | 'warning' | 'info';
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface CustomerAlertsModalProps {
  isOpen: boolean;
  onClose: () => void;
  alerts: OperationalAlert[];
}

export function CustomerAlertsModal({
  isOpen,
  onClose,
  alerts,
}: CustomerAlertsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden my-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800 shrink-0 bg-slate-900">
          <div className="flex items-center gap-2.5">
            <Bell className="h-5 w-5 text-amber-400" />
            <div>
              <h3 className="text-base font-bold text-slate-100">Subscriber Operational Alerts</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Real-time active operational warnings derived from subscriber telemetry
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg hover:bg-slate-800 transition-colors"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Alerts List */}
        <div className="p-4 sm:p-6 space-y-3 text-xs overflow-y-auto flex-1 min-h-0">
          {alerts.length === 0 ? (
            <div className="p-8 text-center bg-slate-950/40 rounded-xl border border-slate-800/80">
              <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
              <h4 className="text-xs font-semibold text-slate-200">No Operational Alerts</h4>
              <p className="text-[11px] text-slate-500 mt-1">
                Account status, billing ledger, hardware binding, and session connectivity are all healthy.
              </p>
            </div>
          ) : (
            alerts.map((a) => (
              <div
                key={a.id}
                className={`p-3.5 rounded-xl border flex items-start gap-3 ${
                  a.type === 'danger'
                    ? 'bg-rose-950/40 border-rose-500/30 text-rose-300'
                    : a.type === 'warning'
                    ? 'bg-amber-950/40 border-amber-500/30 text-amber-300'
                    : 'bg-blue-950/40 border-blue-500/30 text-blue-300'
                }`}
              >
                {a.type === 'danger' ? (
                  <AlertCircle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
                ) : a.type === 'warning' ? (
                  <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                ) : (
                  <ShieldAlert className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
                )}

                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-slate-100">{a.title}</h4>
                  <p className="text-[11px] mt-1 text-slate-300 leading-relaxed">{a.description}</p>
                  {a.actionLabel && a.onAction && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        a.onAction?.();
                      }}
                      className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-semibold underline hover:opacity-80 cursor-pointer"
                    >
                      <span>{a.actionLabel}</span>
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end p-4 sm:p-5 border-t border-slate-800 shrink-0 bg-slate-900/95 backdrop-blur">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
