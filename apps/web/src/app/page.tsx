'use client';

import React from 'react';
import { Users, Wifi, IndianRupee, AlertCircle, ArrowUpRight, UserPlus, ReceiptText, Power } from 'lucide-react';
import { MetricCard } from '../components/MetricCard';
import { StatusBadge } from '../components/StatusBadge';

export default function DashboardPage() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Banner / Welcome */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">ISP Network & Billing Operations</h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time subscriber status, MikroTik BNG orchestration, and automated GST billing.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/20 transition-all">
            <UserPlus className="h-4 w-4" />
            <span>New Subscriber</span>
          </button>
          <button className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-all">
            <ReceiptText className="h-4 w-4" />
            <span>Record Payment</span>
          </button>
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Subscribers"
          value="1,420"
          change="+12 this week"
          isPositive={true}
          icon={Users}
          iconColor="text-blue-400"
        />
        <MetricCard
          title="Active PPPoE Sessions"
          value="1,185"
          change="83.4% online"
          isPositive={true}
          icon={Wifi}
          iconColor="text-emerald-400"
        />
        <MetricCard
          title="Monthly Collections"
          value="₹ 8,92,400"
          change="+8.2% vs last mo"
          isPositive={true}
          icon={IndianRupee}
          iconColor="text-cyan-400"
        />
        <MetricCard
          title="Suspended Accounts"
          value="48"
          change="Due to non-payment"
          isPositive={false}
          icon={AlertCircle}
          iconColor="text-rose-400"
        />
      </div>

      {/* Grid: Active Sessions Table + Router Health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Live Sessions Table */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="p-5 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">Active PPPoE Sessions (FreeRADIUS)</h2>
              <p className="text-xs text-slate-400 mt-0.5">Live sessions streamed via RADIUS accounting (radacct)</p>
            </div>
            <a
              href="/radius"
              className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1"
            >
              <span>View all</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 font-medium border-b border-slate-800/80">
                <tr>
                  <th className="px-4 py-3">Subscriber</th>
                  <th className="px-4 py-3">PPPoE Username</th>
                  <th className="px-4 py-3">Framed IP</th>
                  <th className="px-4 py-3">Rate Limit</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                <tr className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-100">Rajesh Kumar</td>
                  <td className="px-4 py-3 font-mono text-slate-400">rajesh_fiber</td>
                  <td className="px-4 py-3 font-mono text-slate-400">10.100.4.15</td>
                  <td className="px-4 py-3">100M / 100M</td>
                  <td className="px-4 py-3">
                    <StatusBadge status="ACTIVE" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      title="Send CoA Disconnect"
                      className="p-1.5 rounded hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 transition-colors"
                    >
                      <Power className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
                <tr className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-100">Sunita Sharma</td>
                  <td className="px-4 py-3 font-mono text-slate-400">sunita_home</td>
                  <td className="px-4 py-3 font-mono text-slate-400">10.100.4.18</td>
                  <td className="px-4 py-3">50M / 50M</td>
                  <td className="px-4 py-3">
                    <StatusBadge status="ACTIVE" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      title="Send CoA Disconnect"
                      className="p-1.5 rounded hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 transition-colors"
                    >
                      <Power className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
                <tr className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-100">Amit Verma</td>
                  <td className="px-4 py-3 font-mono text-slate-400">amit_v</td>
                  <td className="px-4 py-3 font-mono text-slate-400">10.100.5.21</td>
                  <td className="px-4 py-3">128k / 128k</td>
                  <td className="px-4 py-3">
                    <StatusBadge status="SUSPENDED" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      title="Send CoA Disconnect"
                      className="p-1.5 rounded hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 transition-colors"
                    >
                      <Power className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* MikroTik Routers Health & Operations */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="text-sm font-semibold text-slate-200">MikroTik BNG Fleet</h2>
            <span className="text-[11px] text-emerald-400 font-medium">1 Online</span>
          </div>

          <div className="space-y-3">
            <div className="p-3.5 rounded-lg bg-slate-800/50 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-100">Main BNG CCR2004</span>
                <StatusBadge status="ONLINE" />
              </div>
              <div className="text-[11px] text-slate-400 font-mono flex items-center justify-between">
                <span>IP: 192.168.88.1</span>
                <span>CoA Port: 3799</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: '42%' }}></div>
              </div>
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>CPU Load: 42%</span>
                <span>Active PPPoE: 842</span>
              </div>
            </div>
          </div>

          {/* Quick System Info */}
          <div className="border-t border-slate-800 pt-4 space-y-2">
            <div className="flex justify-between text-xs text-slate-400">
              <span>Database Engine</span>
              <span className="text-slate-200">PostgreSQL 16</span>
            </div>
            <div className="flex justify-between text-xs text-slate-400">
              <span>AAA Engine</span>
              <span className="text-slate-200">FreeRADIUS 3.x (rlm_sql)</span>
            </div>
            <div className="flex justify-between text-xs text-slate-400">
              <span>Async Queue</span>
              <span className="text-slate-200">Redis 7 + BullMQ</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
