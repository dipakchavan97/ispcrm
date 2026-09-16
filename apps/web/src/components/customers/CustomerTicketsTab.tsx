'use client';

import React from 'react';
import Link from 'next/link';
import { LifeBuoy, Plus, ExternalLink, MessageSquare } from 'lucide-react';
import { StatusBadge } from '../StatusBadge';
import { EmptyState } from '../EmptyState';

interface CustomerTicketsTabProps {
  tickets: any[];
  onOpenNewTicket: () => void;
}

export function CustomerTicketsTab({
  tickets = [],
  onOpenNewTicket,
}: CustomerTicketsTabProps) {
  let openCount = 0;
  let pendingCount = 0;
  let resolvedCount = 0;
  let closedCount = 0;

  tickets.forEach((t) => {
    if (t.status === 'OPEN' || t.status === 'ASSIGNED') openCount++;
    else if (t.status === 'IN_PROGRESS' || t.status === 'WAITING_CUSTOMER') pendingCount++;
    else if (t.status === 'RESOLVED') resolvedCount++;
    else if (t.status === 'CLOSED') closedCount++;
  });

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl space-y-4 p-4 sm:p-5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <LifeBuoy className="h-4 w-4 text-amber-400" />
            <span>Support & Helpdesk Tickets</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Technical complaints, billing queries, and fiber link incident logs.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenNewTicket}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-lg shadow-amber-600/20 transition-all min-h-[38px]"
        >
          <Plus className="h-4 w-4" />
          <span>New Support Ticket</span>
        </button>
      </div>

      {/* Ticket Metrics Bar */}
      <div className="grid grid-cols-4 gap-2 text-center text-xs">
        <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
          <span className="text-[10px] text-amber-400 block font-semibold">Active / Open</span>
          <span className="font-mono text-base font-bold text-amber-400 mt-0.5 block">{openCount}</span>
        </div>
        <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
          <span className="text-[10px] text-blue-400 block font-semibold">In Progress</span>
          <span className="font-mono text-base font-bold text-blue-400 mt-0.5 block">{pendingCount}</span>
        </div>
        <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
          <span className="text-[10px] text-emerald-400 block font-semibold">Resolved</span>
          <span className="font-mono text-base font-bold text-emerald-400 mt-0.5 block">{resolvedCount}</span>
        </div>
        <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
          <span className="text-[10px] text-slate-400 block font-semibold">Closed</span>
          <span className="font-mono text-base font-bold text-slate-300 mt-0.5 block">{closedCount}</span>
        </div>
      </div>

      {tickets.length === 0 ? (
        <div className="p-6">
          <EmptyState
            icon={LifeBuoy}
            title="No Support Tickets"
            description="No customer issues or technical tickets are recorded for this subscriber."
            action={{
              label: 'Open Ticket',
              onClick: onOpenNewTicket,
              icon: Plus,
            }}
          />
        </div>
      ) : (
        <div className="overflow-x-auto w-full min-w-0 border border-slate-800 rounded-xl">
          <table className="w-full text-left text-xs min-w-[640px]">
            <thead className="bg-slate-950/70 text-slate-400 font-medium border-b border-slate-800">
              <tr>
                <th className="px-4 py-3">Ticket ID</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Assigned To</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {tickets.map((t) => (
                <tr key={t.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-blue-400">
                    {t.ticketNumber}
                  </td>
                  <td className="px-4 py-3 max-w-[220px]">
                    <div className="font-semibold text-slate-100 truncate">{t.title}</div>
                    <div className="text-[11px] text-slate-400 line-clamp-1 truncate">{t.description}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                        t.priority === 'URGENT' || t.priority === 'HIGH'
                          ? 'bg-rose-950 text-rose-300 border border-rose-800'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {t.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {t.assignedTo || 'Unassigned'}
                  </td>
                  <td className="px-4 py-3 text-slate-400 font-mono text-[11px]">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href="/tickets"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold min-h-[30px]"
                    >
                      <span>View</span>
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
