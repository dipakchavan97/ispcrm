'use client';

import React, { useState } from 'react';
import { History, Shield, Clock, ChevronDown, ChevronRight, User } from 'lucide-react';
import { EmptyState } from '../EmptyState';

interface CustomerAuditCardProps {
  auditLogs: any[];
}

export function CustomerAuditCard({ auditLogs = [] }: CustomerAuditCardProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl space-y-3">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <History className="h-4 w-4 text-blue-400" />
          <span>Administrative Audit Trail & Lifecycle Changes</span>
        </h3>
        <span className="text-xs text-slate-400 font-mono">
          {auditLogs.length} Records Logged
        </span>
      </div>

      {auditLogs.length === 0 ? (
        <EmptyState
          icon={History}
          title="No Audit Records Found"
          description="No administrative mutations have been logged for this subscriber."
        />
      ) : (
        <div className="space-y-2.5 text-xs">
          {auditLogs.map((log) => {
            const isExpanded = expandedId === log.id;
            return (
              <div
                key={log.id}
                className="rounded-xl bg-slate-950/40 border border-slate-800/80 overflow-hidden transition-colors"
              >
                <div
                  onClick={() => toggleExpand(log.id)}
                  className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer hover:bg-slate-900/60"
                >
                  <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                    <button
                      type="button"
                      className="p-1 rounded text-slate-400 hover:text-slate-200"
                      aria-label="Toggle details"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>

                    <span className="font-bold text-slate-200">
                      {log.action.replace(/_/g, ' ')}
                    </span>

                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                      {log.entityType}
                    </span>

                    <span className="text-slate-400 flex items-center gap-1">
                      <User className="h-3 w-3 text-slate-500" />
                      <strong className="text-slate-300">
                        {log.adminUser?.name || 'Automated System'}
                      </strong>
                    </span>
                  </div>

                  <span className="text-[11px] font-mono text-slate-500 shrink-0">
                    {new Date(log.createdAt).toLocaleString()}
                  </span>
                </div>

                {isExpanded && log.details && (
                  <div className="px-4 pb-4 pt-1 border-t border-slate-800/60 bg-slate-950/60">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1">
                      Event Mutation Payload / Diff:
                    </span>
                    <pre className="text-[11px] font-mono bg-slate-900/90 p-3 rounded-lg border border-slate-800 text-slate-300 overflow-x-auto max-w-full break-all whitespace-pre-wrap">
                      {JSON.stringify(log.details, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
