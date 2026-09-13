'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Router as RouterIcon,
  Radio,
  RefreshCw,
  Power,
  ShieldCheck,
  AlertTriangle,
  Cpu,
  HardDrive,
  Clock,
  ArrowDownCircle,
  ArrowUpCircle,
  Search,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../components/Toast';

interface RouterItem {
  id: string;
  name: string;
  host: string;
  port: number;
  status: 'ONLINE' | 'OFFLINE' | 'UNREACHABLE' | 'ERROR';
  model?: string;
  rosVersion?: string;
  identity?: string;
  lastSeen?: string;
}

interface ActiveSession {
  radacctid: string;
  acctsessionid: string;
  username: string;
  nasipaddress: string;
  callingstationid?: string;
  framedipaddress: string;
  acctstarttime?: string;
  acctsessiontime: number;
  downloadBytes: number;
  uploadBytes: number;
}

function formatBytes(bytes: number) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDuration(seconds: number) {
  if (!seconds || seconds <= 0) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default function NetworkCommandCenter() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [searchSession, setSearchSession] = useState('');
  const [selectedSessionToDisconnect, setSelectedSessionToDisconnect] = useState<ActiveSession | null>(null);

  // 1. Fetch Routers
  const {
    data: routers,
    isLoading: loadingRouters,
    refetch: refetchRouters,
  } = useQuery<RouterItem[]>({
    queryKey: ['network-routers'],
    queryFn: () => apiFetch('/routers'),
    refetchInterval: 30000,
  });

  // 2. Fetch Active RADIUS Sessions
  const {
    data: sessions,
    isLoading: loadingSessions,
    refetch: refetchSessions,
    isRefetching: refreshingSessions,
  } = useQuery<ActiveSession[]>({
    queryKey: ['active-radius-sessions'],
    queryFn: () => apiFetch('/radius/sessions/active'),
    refetchInterval: 15000,
  });

  // Disconnect Mutation
  const disconnectMutation = useMutation({
    mutationFn: (sessionId: string) =>
      apiFetch(`/radius/sessions/${sessionId}/disconnect`, { method: 'POST' }),
    onSuccess: () => {
      showToast('RFC 3576 Disconnect (PoD) queued successfully', 'success');
      setSelectedSessionToDisconnect(null);
      queryClient.invalidateQueries({ queryKey: ['active-radius-sessions'] });
    },
    onError: (err: any) => {
      showToast(err.message || 'Failed to dispatch disconnect packet', 'error');
    },
  });

  const onlineRouters = routers?.filter((r) => r.status === 'ONLINE').length || 0;
  const totalRouters = routers?.length || 0;
  const totalSessions = sessions?.length || 0;
  const totalDownload = sessions?.reduce((sum, s) => sum + (s.downloadBytes || 0), 0) || 0;
  const totalUpload = sessions?.reduce((sum, s) => sum + (s.uploadBytes || 0), 0) || 0;

  const filteredSessions = sessions?.filter((s) =>
    s.username.toLowerCase().includes(searchSession.toLowerCase()) ||
    s.framedipaddress.includes(searchSession) ||
    s.nasipaddress.includes(searchSession)
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <Activity className="h-6 w-6 text-blue-500" />
            Network Command Center
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time RouterOS fleet telemetry, RFC 3576 CoA/PoD controls, and FreeRADIUS subscriber accounting
          </p>
        </div>

        <button
          onClick={() => {
            refetchRouters();
            refetchSessions();
            showToast('Network telemetry refreshed', 'info');
          }}
          disabled={refreshingSessions}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition-colors cursor-pointer w-fit"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshingSessions ? 'animate-spin text-blue-400' : ''}`} />
          <span>Refresh Telemetry</span>
        </button>
      </div>

      {/* Network Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#0f172a] p-4 rounded-xl border border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase text-slate-400">Router Fleet Health</p>
            <p className="text-2xl font-bold text-white mt-1">
              {onlineRouters} <span className="text-xs font-normal text-slate-400">/ {totalRouters} Online</span>
            </p>
          </div>
          <div className="h-10 w-10 rounded-lg bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
            <RouterIcon className="h-5 w-5" />
          </div>
        </div>

        <div className="bg-[#0f172a] p-4 rounded-xl border border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase text-slate-400">Active PPPoE Sessions</p>
            <p className="text-2xl font-bold text-white mt-1">
              {totalSessions} <span className="text-xs font-normal text-emerald-400">Live</span>
            </p>
          </div>
          <div className="h-10 w-10 rounded-lg bg-emerald-600/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Radio className="h-5 w-5" />
          </div>
        </div>

        <div className="bg-[#0f172a] p-4 rounded-xl border border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase text-slate-400">Cumulative Download</p>
            <p className="text-2xl font-bold text-sky-400 mt-1">{formatBytes(totalDownload)}</p>
          </div>
          <div className="h-10 w-10 rounded-lg bg-sky-600/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
            <ArrowDownCircle className="h-5 w-5" />
          </div>
        </div>

        <div className="bg-[#0f172a] p-4 rounded-xl border border-slate-800 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase text-slate-400">Cumulative Upload</p>
            <p className="text-2xl font-bold text-purple-400 mt-1">{formatBytes(totalUpload)}</p>
          </div>
          <div className="h-10 w-10 rounded-lg bg-purple-600/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
            <ArrowUpCircle className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Router Fleet Section */}
      <div className="bg-[#0f172a] rounded-xl border border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RouterIcon className="h-4 w-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-slate-200">MikroTik Router Fleet</h2>
          </div>
          <span className="text-xs text-slate-400 font-mono">{totalRouters} BNG Gateways</span>
        </div>

        {loadingRouters ? (
          <div className="p-8 text-center text-slate-400 text-xs">Loading router telemetry...</div>
        ) : !routers || routers.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            No MikroTik routers configured. Add a router from the Routers management page.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-5">
            {routers.map((router) => (
              <div
                key={router.id}
                className="bg-slate-900/60 rounded-lg p-4 border border-slate-800/80 hover:border-slate-700 transition-all space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white">{router.name}</h3>
                    <p className="text-xs font-mono text-slate-400">{router.host}:{router.port}</p>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase ${
                      router.status === 'ONLINE'
                        ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                        : 'bg-rose-950/60 text-rose-400 border border-rose-800/60'
                    }`}
                  >
                    {router.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-800">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase block">Identity</span>
                    <span className="font-mono text-slate-300">{router.identity || 'MikroTik'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase block">RouterOS</span>
                    <span className="font-mono text-slate-300">{router.rosVersion || 'v7.x'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Live PPPoE Sessions Section */}
      <div className="bg-[#0f172a] rounded-xl border border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-200">Active PPPoE Sessions (radacct)</h2>
            <span className="text-xs bg-emerald-950/50 text-emerald-400 border border-emerald-800/40 px-2 py-0.5 rounded-full font-mono">
              {filteredSessions?.length || 0} active
            </span>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              value={searchSession}
              onChange={(e) => setSearchSession(e.target.value)}
              placeholder="Filter by subscriber, IP, NAS..."
              className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {loadingSessions ? (
          <div className="p-8 text-center text-slate-400 text-xs">Querying FreeRADIUS radacct sessions...</div>
        ) : !filteredSessions || filteredSessions.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            {searchSession ? 'No sessions match your filter.' : 'No active PPPoE subscriber sessions detected in RADIUS accounting.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900/60 text-slate-400 uppercase font-mono text-[10px] border-b border-slate-800">
                <tr>
                  <th className="px-5 py-3">Subscriber</th>
                  <th className="px-5 py-3">Framed IP</th>
                  <th className="px-5 py-3">NAS / Router IP</th>
                  <th className="px-5 py-3">Session Uptime</th>
                  <th className="px-5 py-3">Traffic (Rx / Tx)</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredSessions.map((session) => (
                  <tr key={session.radacctid} className="hover:bg-slate-900/40 transition-colors">
                    <td className="px-5 py-3 font-medium text-white">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="font-mono text-blue-400">{session.username}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono block mt-0.5">
                        ID: {session.acctsessionid}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono text-slate-200">
                      {session.framedipaddress || 'Dynamic'}
                    </td>
                    <td className="px-5 py-3 font-mono text-slate-400">
                      {session.nasipaddress}
                    </td>
                    <td className="px-5 py-3 font-mono text-slate-300">
                      {formatDuration(session.acctsessiontime)}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3 text-[11px] font-mono">
                        <span className="text-sky-400">↓ {formatBytes(session.downloadBytes)}</span>
                        <span className="text-purple-400">↑ {formatBytes(session.uploadBytes)}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => setSelectedSessionToDisconnect(session)}
                        className="px-2.5 py-1 rounded bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/30 text-[11px] font-medium transition-colors cursor-pointer"
                      >
                        Disconnect (PoD)
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Disconnect Confirmation Modal */}
      {selectedSessionToDisconnect && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <Power className="h-6 w-6" />
              <h3 className="text-base font-semibold text-white">Confirm Disconnect (PoD)</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to send an RFC 3576 Disconnect-Request for subscriber session{' '}
              <strong className="text-blue-400 font-mono">{selectedSessionToDisconnect.username}</strong> on router{' '}
              <strong className="text-slate-200 font-mono">{selectedSessionToDisconnect.nasipaddress}</strong>?
            </p>
            <p className="text-[11px] text-slate-500">
              This will forcefully terminate the subscriber's PPP session on the MikroTik router.
            </p>
            <div className="flex justify-end gap-3 pt-3">
              <button
                type="button"
                onClick={() => setSelectedSessionToDisconnect(null)}
                className="px-4 py-2 rounded-lg border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={disconnectMutation.isPending}
                onClick={() => disconnectMutation.mutate(selectedSessionToDisconnect.acctsessionid)}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white transition-colors cursor-pointer disabled:opacity-50"
              >
                {disconnectMutation.isPending ? 'Sending PoD...' : 'Disconnect Subscriber'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
