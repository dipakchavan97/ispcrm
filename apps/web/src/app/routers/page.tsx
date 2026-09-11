'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import {
  Router,
  Plus,
  Zap,
  Activity,
  Server,
  Users,
  Network,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Clock,
  HardDrive,
  Cpu,
  Layers,
  ArrowDownUp,
  X,
  Radio,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { RouterDto, SystemResources, ActivePppSession, RouterInterface, InterfaceTraffic } from '@isp-crm/shared';

export default function RoutersPage() {
  const queryClient = useQueryClient();
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerSuccess, setRegisterSuccess] = useState<string | null>(null);
  const [selectedRouterForResources, setSelectedRouterForResources] = useState<RouterDto | null>(null);
  const [selectedRouterForSessions, setSelectedRouterForSessions] = useState<RouterDto | null>(null);
  const [selectedRouterForInterfaces, setSelectedRouterForInterfaces] = useState<RouterDto | null>(null);
  const [activeTrafficInterface, setActiveTrafficInterface] = useState<string | null>(null);
  const [testingRouterId, setTestingRouterId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ routerId: string; success: boolean; latencyMs?: number; message?: string } | null>(null);

  // 1. Fetch Routers list
  const { data: routers = [], isLoading, refetch } = useQuery<RouterDto[]>({
    queryKey: ['routers'],
    queryFn: async () => {
      const res = await apiFetch<RouterDto[]>('/routers');
      return res || [];
    },
  });

  // 2. Register Router Form
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    defaultValues: {
      name: '',
      host: '',
      port: 8728,
      username: 'admin',
      password: '',
      radiusSecret: 'testing123',
      testOnRegister: false,
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: any) => {
      setRegisterError(null);
      const rawPort = Number(data.port);
      const port = Number.isInteger(rawPort) && rawPort > 0 ? rawPort : 8728;
      return apiFetch('/routers', {
        method: 'POST',
        body: JSON.stringify({
          ...data,
          port,
        }),
      });
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['routers'] });
      setIsRegisterModalOpen(false);
      setRegisterError(null);
      reset();
      const statusNote = res?.status === 'ONLINE' ? 'Online & responsive' : res?.status;
      setRegisterSuccess(`Router "${res?.name || 'New Router'}" (${res?.host || ''}) registered successfully! Status: ${statusNote}`);
      setTimeout(() => setRegisterSuccess(null), 8000);
    },
    onError: (err: any) => {
      setRegisterError(err?.message || 'Failed to register router. Please check the credentials and network reachability.');
    },
  });

  // 3. Test Connection Mutation
  const testMutation = useMutation({
    mutationFn: async (routerId: string) => {
      setTestingRouterId(routerId);
      return apiFetch<any>(`/routers/${routerId}/test-connection`, {
        method: 'POST',
      });
    },
    onSuccess: (res: any, routerId) => {
      queryClient.invalidateQueries({ queryKey: ['routers'] });
      setTestResult({
        routerId,
        success: res?.success ?? true,
        latencyMs: res?.latencyMs,
        message: res?.errorMessage || 'Connection test successful',
      });
      setTestingRouterId(null);
    },
    onError: (err: any, routerId) => {
      setTestResult({
        routerId,
        success: false,
        message: err?.message || 'Connection failed',
      });
      setTestingRouterId(null);
    },
  });

  // 4. Delete Router Mutation
  const deleteMutation = useMutation({
    mutationFn: async (routerId: string) => {
      return apiFetch(`/routers/${routerId}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routers'] });
    },
  });

  // Resources Query for selected router
  const { data: systemResources, isLoading: isLoadingResources } = useQuery<SystemResources>({
    queryKey: ['router-resources', selectedRouterForResources?.id],
    queryFn: async () => {
      if (!selectedRouterForResources) return null as any;
      const res = await apiFetch<SystemResources>(`/routers/${selectedRouterForResources.id}/system-resources`);
      return res;
    },
    enabled: !!selectedRouterForResources,
  });

  // PPP Sessions Query for selected router
  const { data: pppSessions = [], isLoading: isLoadingSessions } = useQuery<ActivePppSession[]>({
    queryKey: ['router-ppp-sessions', selectedRouterForSessions?.id],
    queryFn: async () => {
      if (!selectedRouterForSessions) return [];
      const res = await apiFetch<ActivePppSession[]>(`/routers/${selectedRouterForSessions.id}/active-ppp-sessions`);
      return res || [];
    },
    enabled: !!selectedRouterForSessions,
  });

  // Interfaces Query for selected router
  const { data: routerInterfaces = [], isLoading: isLoadingInterfaces } = useQuery<RouterInterface[]>({
    queryKey: ['router-interfaces', selectedRouterForInterfaces?.id],
    queryFn: async () => {
      if (!selectedRouterForInterfaces) return [];
      const res = await apiFetch<RouterInterface[]>(`/routers/${selectedRouterForInterfaces.id}/interfaces`);
      return res || [];
    },
    enabled: !!selectedRouterForInterfaces,
  });

  // Interface Traffic Query
  const { data: trafficData } = useQuery<InterfaceTraffic>({
    queryKey: ['interface-traffic', selectedRouterForInterfaces?.id, activeTrafficInterface],
    queryFn: async () => {
      if (!selectedRouterForInterfaces || !activeTrafficInterface) return null as any;
      const res = await apiFetch<InterfaceTraffic>(
        `/routers/${selectedRouterForInterfaces.id}/interfaces/${activeTrafficInterface}/traffic`,
      );
      return res;
    },
    enabled: !!selectedRouterForInterfaces && !!activeTrafficInterface,
    refetchInterval: 3000, // Poll every 3s when modal is open
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ONLINE':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Online
          </span>
        );
      case 'UNREACHABLE':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            Unreachable
          </span>
        );
      case 'ERROR':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <XCircle className="w-3.5 h-3.5 text-rose-400" />
            Error
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-500/10 text-slate-400 border border-slate-500/20">
            Offline
          </span>
        );
    }
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes && bytes !== 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let val = bytes;
    let idx = 0;
    while (val >= 1024 && idx < units.length - 1) {
      val /= 1024;
      idx++;
    }
    return `${val.toFixed(1)} ${units[idx]}`;
  };

  const formatBps = (bps?: number) => {
    if (!bps && bps !== 0) return '0 bps';
    if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(2)} Gbps`;
    if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
    if (bps >= 1_000) return `${(bps / 1_000).toFixed(2)} Kbps`;
    return `${bps} bps`;
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2.5">
            <Router className="w-7 h-7 text-blue-400" />
            MikroTik BNG & Edge Routers
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Centralized RouterOS integration, hardware telemetry, active PPP subscriber sessions, and live bandwidth monitoring.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium border border-slate-700 transition"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            onClick={() => {
              setRegisterError(null);
              setIsRegisterModalOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium shadow-lg shadow-blue-500/25 transition"
          >
            <Plus className="w-4 h-4" />
            Register Router
          </button>
        </div>
      </div>

      {/* Success Notification Banner */}
      {registerSuccess && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-sm text-emerald-300 flex items-center justify-between shadow-lg shadow-emerald-950/20">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>{registerSuccess}</span>
          </div>
          <button onClick={() => setRegisterSuccess(null)} className="text-emerald-400 hover:text-emerald-200">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 border border-blue-500/20">
            <Server className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-100">{routers.length}</div>
            <div className="text-xs text-slate-400 uppercase tracking-wider font-medium">Total Routers</div>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 border border-emerald-500/20">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-bold text-emerald-400">
              {routers.filter((r) => r.status === 'ONLINE').length}
            </div>
            <div className="text-xs text-slate-400 uppercase tracking-wider font-medium">Online & Healthy</div>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400 border border-amber-500/20">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-bold text-amber-400">
              {routers.filter((r) => r.status === 'UNREACHABLE' || r.status === 'ERROR').length}
            </div>
            <div className="text-xs text-slate-400 uppercase tracking-wider font-medium">Issues Detected</div>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-400 border border-purple-500/20">
            <Radio className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-bold text-purple-400">FreeRADIUS</div>
            <div className="text-xs text-slate-400 uppercase tracking-wider font-medium">AAA Synced (UDP 1812/1813)</div>
          </div>
        </div>
      </div>

      {/* Routers Table */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <h2 className="font-semibold text-slate-200">Registered MikroTik Hardware</h2>
          <span className="text-xs text-slate-400 font-mono">AES-256-GCM Secured Credentials</span>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-3">
            <RefreshCw className="w-5 h-5 animate-spin text-blue-400" />
            Loading MikroTik devices...
          </div>
        ) : routers.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Router className="w-12 h-12 mx-auto text-slate-600 mb-3" />
            <p className="text-base font-medium text-slate-300">No MikroTik Routers registered yet</p>
            <p className="text-sm text-slate-500 mt-1">Register your first CCR / Cloud Hosted Router to monitor sessions and sync AAA.</p>
            <button
              onClick={() => setIsRegisterModalOpen(true)}
              className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium"
            >
              Register Router Now
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950/60 text-xs uppercase text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-6 py-3.5">Router Name & Host</th>
                  <th className="px-6 py-3.5">Identity & Model</th>
                  <th className="px-6 py-3.5">Status</th>
                  <th className="px-6 py-3.5">Last Seen</th>
                  <th className="px-6 py-3.5 text-center">Telemetry & Diagnostic Actions</th>
                  <th className="px-6 py-3.5 text-right">Manage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {routers.map((router) => {
                  const isTesting = testingRouterId === router.id;
                  const curTest = testResult?.routerId === router.id ? testResult : null;

                  return (
                    <tr key={router.id} className="hover:bg-slate-800/40 transition">
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-100 flex items-center gap-2">
                          <Router className="w-4 h-4 text-blue-400" />
                          {router.name}
                        </div>
                        <div className="text-xs text-slate-400 font-mono mt-0.5">
                          {router.host}:{router.port} ({router.username})
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="text-slate-200 font-medium">{router.identity || 'MikroTik'}</div>
                        <div className="text-xs text-slate-400">
                          {router.model || 'CCR / CHR'} • {router.rosVersion || 'ROS v7'}
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div>{getStatusBadge(router.status)}</div>
                        {curTest && (
                          <div className="mt-1 text-[11px] font-mono">
                            {curTest.success ? (
                              <span className="text-emerald-400">● {curTest.latencyMs}ms latency</span>
                            ) : (
                              <span className="text-rose-400 truncate block max-w-[160px]">{curTest.message}</span>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="px-6 py-4 text-xs text-slate-400">
                        {router.lastSeen ? new Date(router.lastSeen).toLocaleString() : 'Never'}
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => testMutation.mutate(router.id)}
                            disabled={isTesting}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 text-xs font-medium border border-blue-500/20 transition disabled:opacity-50"
                            title="Test reachability & credentials"
                          >
                            <Zap className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                            {isTesting ? 'Testing...' : 'Test Connection'}
                          </button>

                          <button
                            onClick={() => setSelectedRouterForResources(router)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
                            title="View CPU, RAM, and Disk telemetry"
                          >
                            <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                            Resources
                          </button>

                          <button
                            onClick={() => setSelectedRouterForSessions(router)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
                            title="View active connected PPPoE subscribers"
                          >
                            <Users className="w-3.5 h-3.5 text-purple-400" />
                            PPP Sessions
                          </button>

                          <button
                            onClick={() => {
                              setSelectedRouterForInterfaces(router);
                              setActiveTrafficInterface('ether1-wan');
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
                            title="View Interfaces and live bandwidth traffic"
                          >
                            <Network className="w-3.5 h-3.5 text-emerald-400" />
                            Traffic
                          </button>
                        </div>
                      </td>

                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => {
                            if (confirm(`Are you sure you want to remove router '${router.name}'?`)) {
                              deleteMutation.mutate(router.id);
                            }
                          }}
                          className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg hover:bg-rose-500/10 transition"
                          title="Delete router"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL 1: Register Router */}
      {isRegisterModalOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                <Plus className="w-5 h-5 text-blue-400" />
                Register MikroTik Router
              </h3>
              <button
                onClick={() => {
                  setRegisterError(null);
                  setIsRegisterModalOpen(false);
                }}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Error Alert Banner */}
            {registerError && (
              <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-300 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                <div className="flex-1">
                  <p className="font-semibold text-rose-200">Registration Failed</p>
                  <p className="mt-0.5 text-rose-300/90 leading-relaxed">{registerError}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setRegisterError(null)}
                  className="text-rose-400 hover:text-rose-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <form
              onSubmit={handleSubmit((data) => registerMutation.mutate(data))}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Friendly Name</label>
                <input
                  {...register('name', { required: 'Friendly Name is required' })}
                  placeholder="e.g. North Zone CCR2004 Edge"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                />
                {errors.name && <p className="text-xs text-rose-400 mt-1">{errors.name.message as string}</p>}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1">Host IP / Domain</label>
                  <input
                    {...register('host', { required: 'Host IP or domain is required' })}
                    placeholder="192.168.88.1"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                  />
                  {errors.host && <p className="text-xs text-rose-400 mt-1">{errors.host.message as string}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Port</label>
                  <input
                    type="number"
                    {...register('port', {
                      validate: (v) => !v || (Number(v) > 0 && Number(v) <= 65535) || '1-65535',
                    })}
                    placeholder="8728"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                  />
                  {errors.port && <p className="text-xs text-rose-400 mt-1">{errors.port.message as string}</p>}
                </div>
              </div>
              <p className="text-[11px] text-slate-500 -mt-2">
                REST API: port 80 (HTTP) or 443 (HTTPS) | WinBox API: port 8728
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">API Username</label>
                  <input
                    {...register('username', { required: 'API Username is required' })}
                    placeholder="admin"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                  />
                  {errors.username && <p className="text-xs text-rose-400 mt-1">{errors.username.message as string}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">API Password</label>
                  <input
                    type="password"
                    {...register('password', { required: 'API Password is required' })}
                    placeholder="••••••••"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                  />
                  {errors.password && <p className="text-xs text-rose-400 mt-1">{errors.password.message as string}</p>}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">RADIUS Shared Secret (FreeRADIUS NAS)</label>
                <input
                  {...register('radiusSecret')}
                  placeholder="testing123"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Synchronized to FreeRADIUS NAS table for PPPoE AAA authentication.
                </p>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="testOnRegister"
                  {...register('testOnRegister')}
                  className="w-4 h-4 rounded bg-slate-950 border-slate-800 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="testOnRegister" className="text-xs text-slate-300 cursor-pointer">
                  Test connection immediately during registration
                </label>
              </div>

              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs text-blue-300 flex items-center gap-2">
                <Zap className="w-4 h-4 shrink-0 text-blue-400" />
                <span>Credentials are encrypted with AES-256-GCM and never logged or exposed.</span>
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setRegisterError(null);
                    setIsRegisterModalOpen(false);
                  }}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={registerMutation.isPending}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2"
                >
                  {registerMutation.isPending && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  {registerMutation.isPending ? 'Registering...' : 'Register Router'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: System Resources */}
      {selectedRouterForResources && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-indigo-400" />
                  System Resources & Hardware Telemetry
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">{selectedRouterForResources.name} ({selectedRouterForResources.host})</p>
              </div>
              <button
                onClick={() => setSelectedRouterForResources(null)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isLoadingResources ? (
              <div className="p-8 text-center text-slate-400 flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
                Querying RouterOS system resources...
              </div>
            ) : systemResources ? (
              <div className="space-y-4">
                {/* CPU Load bar */}
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-semibold uppercase text-slate-400 flex items-center gap-1.5">
                      <Cpu className="w-4 h-4 text-blue-400" />
                      CPU Utilization ({systemResources.cpuCount} Cores @ {systemResources.cpuFrequency || 1700} MHz)
                    </span>
                    <span className="text-sm font-bold text-slate-200">{systemResources.cpuLoad}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-3 rounded-full transition-all duration-500 ${
                        systemResources.cpuLoad > 80
                          ? 'bg-rose-500'
                          : systemResources.cpuLoad > 50
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(1, systemResources.cpuLoad))}%` }}
                    />
                  </div>
                </div>

                {/* Hardware Spec Grid */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                    <div className="text-slate-500">Board / Model</div>
                    <div className="font-semibold text-slate-200">{systemResources.boardName || 'CCR2004'}</div>
                    <div className="text-[10px] text-slate-400">{systemResources.architectureName || 'ARM64'}</div>
                  </div>

                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                    <div className="text-slate-500">RouterOS Version</div>
                    <div className="font-semibold text-emerald-400">{systemResources.version}</div>
                    <div className="text-[10px] text-slate-400">Platform: {systemResources.platform || 'MikroTik'}</div>
                  </div>

                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                    <div className="text-slate-500">System Uptime</div>
                    <div className="font-semibold text-slate-200 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-blue-400" />
                      {systemResources.uptime}
                    </div>
                  </div>

                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                    <div className="text-slate-500">Memory (RAM)</div>
                    <div className="font-semibold text-slate-200">
                      {formatBytes(systemResources.freeMemory)} free / {formatBytes(systemResources.totalMemory)}
                    </div>
                  </div>

                  <div className="col-span-2 bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                    <div className="text-slate-500">Storage / Disk (HDD)</div>
                    <div className="font-semibold text-slate-200">
                      {formatBytes(systemResources.freeHddSpace)} free / {formatBytes(systemResources.totalHddSpace)}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-center text-rose-400 text-sm py-4">Failed to fetch system resources.</p>
            )}

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedRouterForResources(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Active PPP Sessions */}
      {selectedRouterForSessions && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                  <Users className="w-5 h-5 text-purple-400" />
                  Active PPP & PPPoE Subscriber Sessions
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">Live sessions connected to {selectedRouterForSessions.name}</p>
              </div>
              <button
                onClick={() => setSelectedRouterForSessions(null)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isLoadingSessions ? (
              <div className="p-8 text-center text-slate-400 flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-purple-400" />
                Querying /ppp/active from RouterOS...
              </div>
            ) : pppSessions.length === 0 ? (
              <p className="text-center text-slate-500 py-8 text-sm">No active PPP sessions currently on this router.</p>
            ) : (
              <div className="max-h-96 overflow-y-auto rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950 text-slate-400 uppercase border-b border-slate-800 sticky top-0">
                    <tr>
                      <th className="px-4 py-3">Subscriber</th>
                      <th className="px-4 py-3">Framed IP Address</th>
                      <th className="px-4 py-3">Caller ID / MAC</th>
                      <th className="px-4 py-3">Uptime</th>
                      <th className="px-4 py-3 text-right">Traffic (In / Out)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 bg-slate-900/40">
                    {pppSessions.map((session, idx) => (
                      <tr key={session.id || idx} className="hover:bg-slate-800/50">
                        <td className="px-4 py-3 font-semibold text-slate-100 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-400" />
                          {session.name}
                        </td>
                        <td className="px-4 py-3 font-mono text-blue-400">{session.address}</td>
                        <td className="px-4 py-3 font-mono text-slate-400">{session.callerId || 'N/A'}</td>
                        <td className="px-4 py-3 text-slate-300">{session.uptime}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-400">
                          {formatBytes(session.bytesIn)} ↓ / {formatBytes(session.bytesOut)} ↑
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-between items-center pt-2">
              <span className="text-xs text-slate-500">Total Active: {pppSessions.length} session(s)</span>
              <button
                onClick={() => setSelectedRouterForSessions(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Interfaces & Live Bandwidth Traffic */}
      {selectedRouterForInterfaces && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                  <Network className="w-5 h-5 text-emerald-400" />
                  Network Interfaces & Real-Time Traffic
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">{selectedRouterForInterfaces.name} ({selectedRouterForInterfaces.host})</p>
              </div>
              <button
                onClick={() => setSelectedRouterForInterfaces(null)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Live Interface Bandwidth Card */}
            {activeTrafficInterface && (
              <div className="bg-slate-950 p-4 rounded-xl border border-emerald-500/30 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold uppercase text-emerald-400 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    Live Monitor: {activeTrafficInterface}
                  </span>
                  <span className="text-[11px] text-slate-500">Polling every 3s via RouterOS REST</span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                    <div className="text-xs text-slate-400 flex items-center gap-1">
                      <ArrowDownUp className="w-3.5 h-3.5 text-blue-400 rotate-180" />
                      Rx (Download / Inbound)
                    </div>
                    <div className="text-xl font-bold text-blue-400 mt-1">
                      {formatBps(trafficData?.rxBps)}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {trafficData?.rxPacketsPerSecond?.toLocaleString() || 0} packets/sec
                    </div>
                  </div>

                  <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                    <div className="text-xs text-slate-400 flex items-center gap-1">
                      <ArrowDownUp className="w-3.5 h-3.5 text-purple-400" />
                      Tx (Upload / Outbound)
                    </div>
                    <div className="text-xl font-bold text-purple-400 mt-1">
                      {formatBps(trafficData?.txBps)}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {trafficData?.txPacketsPerSecond?.toLocaleString() || 0} packets/sec
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Interface List */}
            <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-800">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 uppercase border-b border-slate-800 sticky top-0">
                  <tr>
                    <th className="px-4 py-2.5">Interface Name</th>
                    <th className="px-4 py-2.5">Type</th>
                    <th className="px-4 py-2.5">MAC Address</th>
                    <th className="px-4 py-2.5">MTU</th>
                    <th className="px-4 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 bg-slate-900/40">
                  {routerInterfaces.map((iface) => (
                    <tr
                      key={iface.id || iface.name}
                      className={`hover:bg-slate-800/50 ${
                        activeTrafficInterface === iface.name ? 'bg-emerald-500/10' : ''
                      }`}
                    >
                      <td className="px-4 py-2.5 font-medium text-slate-200 flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            iface.running ? 'bg-emerald-400' : 'bg-slate-600'
                          }`}
                        />
                        {iface.name}
                        {iface.comment && <span className="text-[10px] text-slate-500">({iface.comment})</span>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-400 font-mono">{iface.type}</td>
                      <td className="px-4 py-2.5 text-slate-400 font-mono">{iface.macAddress || 'N/A'}</td>
                      <td className="px-4 py-2.5 text-slate-400">{iface.actualMtu || 1500}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => setActiveTrafficInterface(iface.name)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium"
                        >
                          Monitor Traffic
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedRouterForInterfaces(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
