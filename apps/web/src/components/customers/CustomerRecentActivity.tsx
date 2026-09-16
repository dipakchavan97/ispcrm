'use client';

import React from 'react';
import { Activity, ShieldCheck, CheckCircle2, IndianRupee, Clock, RefreshCw, LifeBuoy } from 'lucide-react';

interface ActivityItem {
  id: string;
  type: 'radius' | 'payment' | 'subscription' | 'ticket' | 'audit';
  title: string;
  subtitle: string;
  timestamp: string;
}

interface CustomerRecentActivityProps {
  auditLogs?: any[];
  accessRequests?: any[];
  payments?: any[];
}

export function CustomerRecentActivity({
  auditLogs = [],
  accessRequests = [],
  payments = [],
}: CustomerRecentActivityProps) {
  // Combine real timeline events
  const timeline: ActivityItem[] = [];

  // 1. Audit logs
  auditLogs.slice(0, 4).forEach((log) => {
    timeline.push({
      id: `audit-${log.id}`,
      type: 'audit',
      title: log.action.replace(/_/g, ' '),
      subtitle: log.adminUser?.name ? `By ${log.adminUser.name}` : 'System operation',
      timestamp: log.createdAt,
    });
  });

  // 2. Recent Access Requests
  accessRequests.slice(0, 3).forEach((req) => {
    timeline.push({
      id: `rad-${req.id}`,
      type: 'radius',
      title: `RADIUS ${req.reply || 'Request'}`,
      subtitle: req.reply === 'Access-Accept' ? 'Dial-in successful' : 'Dial-in rejected',
      timestamp: req.authdate,
    });
  });

  // 3. Payments
  payments.slice(0, 2).forEach((p) => {
    timeline.push({
      id: `pay-${p.id}`,
      type: 'payment',
      title: `Payment Receipt #${p.receiptNumber}`,
      subtitle: `₹${p.amount} collected via ${p.paymentMethod}`,
      timestamp: p.paidAt,
    });
  });

  // Sort by date descending
  timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const displayItems = timeline.slice(0, 5);

  if (displayItems.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
        <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-400" />
          <span>Recent Activity</span>
        </h3>
        <p className="text-xs text-slate-500 py-3">No recent subscriber activities recorded.</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-400" />
          <span>Recent Activity Timeline</span>
        </h3>
        <span className="text-[11px] font-mono text-slate-500">Real-time audit</span>
      </div>

      <div className="space-y-3">
        {displayItems.map((item) => (
          <div key={item.id} className="flex items-start gap-3 text-xs">
            <div className="mt-1 h-2 w-2 rounded-full bg-blue-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-200 capitalize truncate">
                  {item.title}
                </span>
                <span className="text-[10px] font-mono text-slate-500 shrink-0">
                  {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">{item.subtitle}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
