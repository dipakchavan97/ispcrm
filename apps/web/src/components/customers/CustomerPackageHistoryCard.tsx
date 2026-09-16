'use client';

import React from 'react';
import Link from 'next/link';
import { History, Wifi, ExternalLink, Calendar } from 'lucide-react';
import { StatusBadge } from '../StatusBadge';
import { EmptyState } from '../EmptyState';
import { formatCurrency } from '../../lib/formatters';

interface CustomerPackageHistoryCardProps {
  subscriptions: any[];
}

export function CustomerPackageHistoryCard({ subscriptions = [] }: CustomerPackageHistoryCardProps) {
  // Sort by startDate descending
  const pastSubscriptions = [...subscriptions];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl space-y-3">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <History className="h-4 w-4 text-blue-400" />
          <span>Package Subscription History</span>
        </h3>
        <span className="text-xs text-slate-400 font-mono">
          Total Packages: {pastSubscriptions.length}
        </span>
      </div>

      {pastSubscriptions.length === 0 ? (
        <EmptyState
          icon={Wifi}
          title="No Package History"
          description="No previous subscription plans recorded for this subscriber."
        />
      ) : (
        <div className="overflow-x-auto border border-slate-800 rounded-xl">
          <table className="w-full text-left text-xs min-w-[640px]">
            <thead className="bg-slate-950/70 text-slate-400 font-medium border-b border-slate-800">
              <tr>
                <th className="px-4 py-3">Start Date</th>
                <th className="px-4 py-3">End Date</th>
                <th className="px-4 py-3">Package Name</th>
                <th className="px-4 py-3">Bandwidth</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {pastSubscriptions.map((sub) => (
                <tr key={sub.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3 font-mono text-slate-400">
                    {new Date(sub.startDate).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-400">
                    {new Date(sub.endDate).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-100">{sub.plan?.name || 'Internet Plan'}</div>
                    <div className="text-[10px] font-mono text-slate-500">{sub.plan?.code}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-blue-400">
                    {sub.plan?.downloadSpeedMbps || 50}M / {sub.plan?.uploadSpeedMbps || 50}M
                  </td>
                  <td className="px-4 py-3 font-mono font-semibold text-slate-200">
                    {formatCurrency(sub.price)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={sub.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href="/subscriptions"
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-400 hover:text-blue-300 min-h-[30px]"
                    >
                      <span>Manage</span>
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
