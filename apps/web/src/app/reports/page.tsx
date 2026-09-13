'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileBarChart,
  IndianRupee,
  Users,
  Wifi,
  Receipt,
  Download,
  Calendar,
  Filter,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';

export default function ReportsPage() {
  // Query data from real endpoints
  const { data: customersData, isLoading: loadingCustomers } = useQuery({
    queryKey: ['reports-customers'],
    queryFn: () => apiFetch('/customers?limit=1000'),
  });

  const { data: invoicesData, isLoading: loadingInvoices } = useQuery({
    queryKey: ['reports-invoices'],
    queryFn: () => apiFetch('/invoices'),
  });

  const { data: plansData, isLoading: loadingPlans } = useQuery({
    queryKey: ['reports-plans'],
    queryFn: () => apiFetch('/plans'),
  });

  const customers = customersData?.items || [];
  const invoices = invoicesData || [];
  const plans = plansData || [];

  const totalInvoiced = invoices.reduce((sum: number, inv: any) => sum + Number(inv.totalAmount || 0), 0);
  const totalCollected = invoices
    .filter((inv: any) => inv.status === 'PAID')
    .reduce((sum: number, inv: any) => sum + Number(inv.totalAmount || 0), 0);
  const outstandingAmount = invoices
    .filter((inv: any) => inv.status !== 'PAID' && inv.status !== 'CANCELLED')
    .reduce((sum: number, inv: any) => sum + (Number(inv.totalAmount || 0) - Number(inv.paidAmount || 0)), 0);

  const activeSubscribers = customers.filter((c: any) => c.status === 'ACTIVE').length;
  const suspendedSubscribers = customers.filter((c: any) => c.status === 'SUSPENDED').length;
  const expiredSubscribers = customers.filter((c: any) => c.status === 'EXPIRED').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <FileBarChart className="h-6 w-6 text-blue-500" />
            Financial & Operational Reports
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time subscriber lifecycle metrics, revenue settlement breakdown, and plan adoption statistics
          </p>
        </div>

        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition-colors cursor-pointer w-fit"
        >
          <Download className="h-3.5 w-3.5 text-blue-400" />
          <span>Export Summary</span>
        </button>
      </div>

      {/* Metric Summaries */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#0f172a] p-5 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-slate-400">Total Billed Revenue</p>
            <Receipt className="h-4 w-4 text-blue-400" />
          </div>
          <p className="text-2xl font-bold text-white mt-2">₹{totalInvoiced.toLocaleString('en-IN')}</p>
          <p className="text-[11px] text-slate-500 mt-1">Across {invoices.length} invoices generated</p>
        </div>

        <div className="bg-[#0f172a] p-5 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-slate-400">Total Collections Settled</p>
            <IndianRupee className="h-4 w-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-emerald-400 mt-2">₹{totalCollected.toLocaleString('en-IN')}</p>
          <p className="text-[11px] text-emerald-500/80 mt-1">Direct receipts & verified webhooks</p>
        </div>

        <div className="bg-[#0f172a] p-5 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-slate-400">Outstanding Receivables</p>
            <Receipt className="h-4 w-4 text-amber-400" />
          </div>
          <p className="text-2xl font-bold text-amber-400 mt-2">₹{outstandingAmount.toLocaleString('en-IN')}</p>
          <p className="text-[11px] text-amber-500/80 mt-1">Pending subscriber payments</p>
        </div>
      </div>

      {/* Detailed Tables Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Subscriber Status Breakdown */}
        <div className="bg-[#0f172a] rounded-xl border border-slate-800 p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <Users className="h-4 w-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-slate-200">Subscriber Lifecycle Distribution</h2>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-xs text-slate-300">Active Subscribers (Online Access)</span>
              <span className="text-xs font-mono font-bold text-emerald-400">{activeSubscribers}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-xs text-slate-300">Suspended Subscribers (Restricted Access)</span>
              <span className="text-xs font-mono font-bold text-amber-400">{suspendedSubscribers}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-xs text-slate-300">Expired Subscriptions (Awaiting Renewal)</span>
              <span className="text-xs font-mono font-bold text-rose-400">{expiredSubscribers}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-900/40 border border-slate-800/60">
              <span className="text-xs text-slate-400">Total Customer Records</span>
              <span className="text-xs font-mono font-bold text-white">{customers.length}</span>
            </div>
          </div>
        </div>

        {/* Plan Portfolio Breakdown */}
        <div className="bg-[#0f172a] rounded-xl border border-slate-800 p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
            <Wifi className="h-4 w-4 text-purple-400" />
            <h2 className="text-sm font-semibold text-slate-200">Active Broadband Plans Catalog</h2>
          </div>

          {loadingPlans ? (
            <div className="p-6 text-center text-xs text-slate-400">Loading catalog...</div>
          ) : (
            <div className="space-y-2.5">
              {plans.map((p: any) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-slate-900 border border-slate-800"
                >
                  <div>
                    <h3 className="text-xs font-semibold text-white">{p.name}</h3>
                    <p className="text-[10px] text-slate-400 font-mono">
                      {p.downloadSpeed} Mbps Down / {p.uploadSpeed} Mbps Up
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold font-mono text-emerald-400">₹{p.price}</span>
                    <span className="text-[10px] text-slate-500 block">/ {p.validityDays} days</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
