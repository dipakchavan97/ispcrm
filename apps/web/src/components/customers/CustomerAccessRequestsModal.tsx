'use client';

import React from 'react';
import Link from 'next/link';
import {
  X,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  Clock,
  KeyRound,
  Lock,
  Radio,
  ExternalLink,
} from 'lucide-react';
import { EmptyState } from '../EmptyState';

interface AccessRequest {
  id: string;
  username: string;
  reply: string;
  authdate: string | null;
}

interface CustomerAccessRequestsModalProps {
  isOpen: boolean;
  onClose: () => void;
  accessRequests: AccessRequest[];
  isLoading?: boolean;
  onRefresh: () => void;
  customerUsername: string;
}

export function CustomerAccessRequestsModal({
  isOpen,
  onClose,
  accessRequests,
  isLoading = false,
  onRefresh,
  customerUsername,
}: CustomerAccessRequestsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden my-auto">
        {/* Sticky Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800 shrink-0 bg-slate-900">
          <div className="flex items-center gap-2.5">
            <Radio className="h-5 w-5 text-blue-400" />
            <div>
              <h3 className="text-base font-bold text-slate-100">
                RADIUS Authentication Requests
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Authentication events evaluated by FreeRADIUS for{' '}
                <span className="font-mono text-emerald-400 font-semibold">{customerUsername}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={`/network/access-requests?username=${encodeURIComponent(customerUsername)}`}
              target="_blank"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-colors min-h-[36px]"
              title="Open full access requests log"
            >
              <ExternalLink className="h-3.5 w-3.5 text-blue-400" />
              <span className="hidden sm:inline">Full Log</span>
            </Link>
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center disabled:opacity-50"
              title="Refresh requests"
              aria-label="Refresh requests"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200 p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg hover:bg-slate-800 transition-colors"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 min-h-0 space-y-4">
          {accessRequests.length === 0 ? (
            <EmptyState
              icon={Radio}
              title="No Authentication Requests Recorded"
              description="FreeRADIUS has not logged any access requests for this subscriber in radpostauth yet."
            />
          ) : (
            <div className="overflow-x-auto border border-slate-800 rounded-xl">
              <table className="w-full text-left text-xs min-w-[480px]">
                <thead className="bg-slate-950/70 text-slate-400 font-medium border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-3">Timestamp (UTC)</th>
                    <th className="px-4 py-3">Username Candidate</th>
                    <th className="px-4 py-3">FreeRADIUS Decision</th>
                    <th className="px-4 py-3 text-right">Event ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {accessRequests.map((req) => {
                    const isAccept = req.reply === 'Access-Accept';
                    return (
                      <tr key={req.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="px-4 py-3 font-mono text-slate-400">
                          {req.authdate ? new Date(req.authdate).toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-3 font-mono font-semibold text-slate-200">
                          {req.username}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                              isAccept
                                ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/30'
                                : 'bg-rose-950/80 text-rose-400 border border-rose-500/30'
                            }`}
                          >
                            {isAccept ? (
                              <ShieldCheck className="h-3.5 w-3.5" />
                            ) : (
                              <ShieldAlert className="h-3.5 w-3.5" />
                            )}
                            <span>{req.reply}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-500 text-[11px]">
                          #{req.id}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Security Notice */}
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-2.5 text-slate-400 text-[11px]">
            <Lock className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong className="text-slate-300">Security & Privacy:</strong> Subscriber passwords,
              RADIUS shared secrets, and encryption keys are never stored in plain text or transmitted in API responses.
            </p>
          </div>
        </div>

        {/* Sticky Footer */}
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
