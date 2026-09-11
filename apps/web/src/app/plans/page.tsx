'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import {
  Wifi,
  Plus,
  Zap,
  Clock,
  IndianRupee,
  Layers,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  X,
  Gauge,
  ArrowDownCircle,
  ArrowUpCircle,
  Edit3,
  Power,
  Search,
  Sliders,
  ShieldCheck,
  FileText,
  Check,
  Eye,
  Activity,
  Calendar,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';

// Vendor-neutral Plan Interface matching Backend & Database
interface Plan {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  description: string;
  downloadSpeed: number;
  uploadSpeed: number;
  downloadSpeedMbps: number;
  uploadSpeedMbps: number;
  speedUnit: 'MBPS' | 'KBPS' | 'GBPS';
  validityDays: number;
  billingCycle: 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'ANNUAL' | 'CUSTOM';
  price: number;
  status: 'ACTIVE' | 'INACTIVE';
  isActive: boolean;
  gstRatePercent: number;
  hsnSacCode?: string;
  dataLimitGb?: number | null;
  burstDownloadMbps?: number | null;
  burstUploadMbps?: number | null;
  burstThresholdMbps?: number | null;
  burstTimeSecs?: number | null;
  subscriberCount?: number;
  networkPolicy?: {
    policyName: string;
    rateLimit: {
      downloadSpeed: number;
      uploadSpeed: number;
      unit: string;
      downloadSpeedBps: number;
      uploadSpeedBps: number;
    };
    burst?: {
      enabled: boolean;
      burstDownloadSpeed?: number;
      burstUploadSpeed?: number;
      threshold?: number;
      durationSecs?: number;
    };
    fup?: {
      enabled: boolean;
      dataLimitGb?: number;
      fupDownloadSpeed?: number;
      fupUploadSpeed?: number;
    };
    qosPriority: number;
  };
  radiusAttributes?: Record<string, string | number>;
  rateLimitString?: string;
  createdAt: string;
  updatedAt: string;
}

// Form Data capturing all 9 required fields + optional traffic shaping
interface PlanFormData {
  name: string;
  code?: string;
  description: string;
  downloadSpeed: number;
  uploadSpeed: number;
  speedUnit: 'MBPS' | 'KBPS' | 'GBPS';
  price: number;
  validityDays: number;
  billingCycle: 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'ANNUAL' | 'CUSTOM';
  status: 'ACTIVE' | 'INACTIVE';
  gstRatePercent: number;
  dataLimitGb?: number | null;
  hasBurst?: boolean;
  burstDownloadMbps?: number | null;
  burstUploadMbps?: number | null;
  burstThresholdMbps?: number | null;
  burstTimeSecs?: number | null;
}

export default function PlansPage() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [policyInspectorPlan, setPolicyInspectorPlan] = useState<Plan | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // Fetch Internet Plans scoped to tenant organization
  const { data: plans = [], isLoading, refetch, isFetching } = useQuery<Plan[]>({
    queryKey: ['plans', statusFilter, searchTerm],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (searchTerm.trim()) params.append('search', searchTerm.trim());
      const query = params.toString() ? `?${params.toString()}` : '';
      return apiFetch<Plan[]>(`/plans${query}`);
    },
  });

  // React Hook Form for Creating Plan
  const {
    register: registerCreate,
    handleSubmit: handleSubmitCreate,
    watch: watchCreate,
    reset: resetCreate,
    setValue: setCreateValue,
    formState: { errors: createErrors, isSubmitting: isCreating },
  } = useForm<PlanFormData>({
    defaultValues: {
      name: '',
      description: '',
      downloadSpeed: 100,
      uploadSpeed: 50,
      speedUnit: 'MBPS',
      price: 799,
      validityDays: 30,
      billingCycle: 'MONTHLY',
      status: 'ACTIVE',
      gstRatePercent: 18.0,
      hasBurst: false,
    },
  });

  // React Hook Form for Editing Plan
  const {
    register: registerEdit,
    handleSubmit: handleSubmitEdit,
    watch: watchEdit,
    reset: resetEdit,
    formState: { errors: editErrors, isSubmitting: isEditing },
  } = useForm<PlanFormData>();

  const createHasBurst = watchCreate('hasBurst');
  const editHasBurst = watchEdit('hasBurst');

  // Mutation: Create Plan
  const createMutation = useMutation({
    mutationFn: (formData: PlanFormData) => {
      const payload: any = {
        name: formData.name.trim(),
        description: formData.description.trim(),
        downloadSpeed: Number(formData.downloadSpeed),
        uploadSpeed: Number(formData.uploadSpeed),
        speedUnit: formData.speedUnit,
        price: Number(formData.price),
        validityDays: Number(formData.validityDays),
        billingCycle: formData.billingCycle,
        status: formData.status,
        gstRatePercent: Number(formData.gstRatePercent || 18.0),
        dataLimitGb: formData.dataLimitGb ? Number(formData.dataLimitGb) : null,
      };

      if (formData.code && formData.code.trim()) {
        payload.code = formData.code.trim().toUpperCase();
      }

      if (formData.hasBurst) {
        payload.burstDownloadMbps = formData.burstDownloadMbps ? Number(formData.burstDownloadMbps) : null;
        payload.burstUploadMbps = formData.burstUploadMbps ? Number(formData.burstUploadMbps) : null;
        payload.burstThresholdMbps = formData.burstThresholdMbps ? Number(formData.burstThresholdMbps) : null;
        payload.burstTimeSecs = formData.burstTimeSecs ? Number(formData.burstTimeSecs) : null;
      }

      return apiFetch('/plans', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      setIsCreateModalOpen(false);
      resetCreate();
      showNotification('New internet plan created successfully!');
    },
    onError: (err: any) => {
      showNotification(err.message || 'Failed to create plan', 'error');
    },
  });

  // Mutation: Update Plan
  const updateMutation = useMutation({
    mutationFn: ({ id, formData }: { id: string; formData: PlanFormData }) => {
      const payload: any = {
        name: formData.name.trim(),
        description: formData.description.trim(),
        downloadSpeed: Number(formData.downloadSpeed),
        uploadSpeed: Number(formData.uploadSpeed),
        speedUnit: formData.speedUnit,
        price: Number(formData.price),
        validityDays: Number(formData.validityDays),
        billingCycle: formData.billingCycle,
        status: formData.status,
        gstRatePercent: Number(formData.gstRatePercent || 18.0),
        dataLimitGb: formData.dataLimitGb ? Number(formData.dataLimitGb) : null,
      };

      if (formData.hasBurst) {
        payload.burstDownloadMbps = formData.burstDownloadMbps ? Number(formData.burstDownloadMbps) : null;
        payload.burstUploadMbps = formData.burstUploadMbps ? Number(formData.burstUploadMbps) : null;
        payload.burstThresholdMbps = formData.burstThresholdMbps ? Number(formData.burstThresholdMbps) : null;
        payload.burstTimeSecs = formData.burstTimeSecs ? Number(formData.burstTimeSecs) : null;
      } else {
        payload.burstDownloadMbps = null;
        payload.burstUploadMbps = null;
        payload.burstThresholdMbps = null;
        payload.burstTimeSecs = null;
      }

      return apiFetch(`/plans/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      setEditingPlan(null);
      showNotification('Plan updated successfully!');
    },
    onError: (err: any) => {
      showNotification(err.message || 'Failed to update plan', 'error');
    },
  });

  // Mutation: Toggle Status (Activate / Deactivate)
  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, newStatus }: { id: string; newStatus: 'ACTIVE' | 'INACTIVE' }) => {
      return apiFetch(`/plans/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      showNotification(
        `Plan successfully ${variables.newStatus === 'ACTIVE' ? 'activated' : 'deactivated'}!`,
      );
    },
    onError: (err: any) => {
      showNotification(err.message || 'Failed to change plan status', 'error');
    },
  });

  // Quick Preset Helper for Common Plans (e.g. 50M, 100M, 200M)
  const applyPreset = (download: number, upload: number, price: number, name: string) => {
    setCreateValue('name', name);
    setCreateValue('downloadSpeed', download);
    setCreateValue('uploadSpeed', upload);
    setCreateValue('price', price);
    setCreateValue('speedUnit', 'MBPS');
    setCreateValue('validityDays', 30);
    setCreateValue('billingCycle', 'MONTHLY');
    setCreateValue('status', 'ACTIVE');
    setCreateValue('description', `${download} Mbps high-speed fiber plan with unlimited browsing & streaming.`);
  };

  // Open Edit Modal with Pre-populated data
  const handleOpenEdit = (plan: Plan) => {
    setEditingPlan(plan);
    resetEdit({
      name: plan.name,
      code: plan.code,
      description: plan.description || '',
      downloadSpeed: Number(plan.downloadSpeed || plan.downloadSpeedMbps || 0),
      uploadSpeed: Number(plan.uploadSpeed || plan.uploadSpeedMbps || 0),
      speedUnit: plan.speedUnit || 'MBPS',
      price: Number(plan.price),
      validityDays: Number(plan.validityDays),
      billingCycle: plan.billingCycle || 'MONTHLY',
      status: plan.status || (plan.isActive ? 'ACTIVE' : 'INACTIVE'),
      gstRatePercent: Number(plan.gstRatePercent || 18.0),
      dataLimitGb: plan.dataLimitGb,
      hasBurst: Boolean(plan.burstDownloadMbps && plan.burstUploadMbps),
      burstDownloadMbps: plan.burstDownloadMbps,
      burstUploadMbps: plan.burstUploadMbps,
      burstThresholdMbps: plan.burstThresholdMbps,
      burstTimeSecs: plan.burstTimeSecs,
    });
  };

  // Stats Counters
  const totalCount = plans.length;
  const activeCount = plans.filter((p) => p.status === 'ACTIVE').length;
  const inactiveCount = plans.filter((p) => p.status === 'INACTIVE').length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`fixed bottom-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border text-sm font-medium transition-all ${
            notification.type === 'success'
              ? 'bg-slate-900 border-emerald-500/40 text-emerald-400'
              : 'bg-slate-900 border-rose-500/40 text-rose-400'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle className="h-5 w-5 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="h-5 w-5 text-rose-400 shrink-0" />
          )}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-blue-600/10 text-blue-400 border border-blue-500/20 shadow-inner">
              <Wifi className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-100 tracking-tight">Internet Plans & Bandwidth Profiles</h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Multi-tenant broadband plans with vendor-neutral network policies and automated RADIUS translation.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/60 text-xs font-semibold transition-all"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin text-blue-400' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => {
              resetCreate();
              setIsCreateModalOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/20 transition-all"
          >
            <Plus className="h-4 w-4" />
            <span>New Internet Plan</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Badges & Filter Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
        {/* Status Filter Tabs */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setStatusFilter('ALL')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              statusFilter === 'ALL'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <span>All Plans</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-900/60 text-slate-300 border border-white/10">
              {totalCount}
            </span>
          </button>

          <button
            onClick={() => setStatusFilter('ACTIVE')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              statusFilter === 'ACTIVE'
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse" />
            <span>Active</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-900/60 text-slate-300 border border-white/10">
              {activeCount}
            </span>
          </button>

          <button
            onClick={() => setStatusFilter('INACTIVE')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              statusFilter === 'INACTIVE'
                ? 'bg-slate-700 text-white shadow-md shadow-slate-700/20'
                : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <span>Inactive</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-900/60 text-slate-300 border border-white/10">
              {inactiveCount}
            </span>
          </button>
        </div>

        {/* Search Field */}
        <div className="relative min-w-[260px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by plan name, code..."
            className="w-full bg-slate-950/80 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Plans Cards Grid */}
      {isLoading ? (
        <div className="p-16 text-center text-slate-500 bg-slate-900 border border-slate-800 rounded-2xl shadow-inner">
          <RefreshCw className="h-6 w-6 animate-spin mx-auto text-blue-500 mb-2" />
          <p className="text-sm font-medium">Loading broadband plans...</p>
        </div>
      ) : plans.length === 0 ? (
        <div className="p-16 text-center text-slate-500 bg-slate-900 border border-slate-800 rounded-2xl">
          <Wifi className="h-10 w-10 mx-auto text-slate-600 mb-3" />
          <h3 className="text-sm font-bold text-slate-300">No internet plans found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">
            {searchTerm || statusFilter !== 'ALL'
              ? 'Try adjusting your search query or status filter.'
              : 'Create your first internet plan to configure subscriber speeds and RADIUS bandwidth profiles.'}
          </p>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-all"
          >
            Create Plan
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {plans.map((p) => {
            const numPrice = Number(p.price);
            const gstAmount = (numPrice * Number(p.gstRatePercent || 18.0)) / 100;
            const totalWithGst = numPrice + gstAmount;
            const isPlanActive = p.status === 'ACTIVE';

            return (
              <div
                key={p.id}
                className={`bg-slate-900 border rounded-2xl p-5 flex flex-col justify-between transition-all hover:shadow-xl group relative ${
                  isPlanActive
                    ? 'border-slate-800 hover:border-blue-500/40 hover:shadow-blue-500/5'
                    : 'border-slate-800/60 opacity-80 hover:opacity-100 hover:border-slate-700'
                }`}
              >
                <div>
                  {/* Card Header: Code, Status & Price */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] uppercase font-bold tracking-wider text-blue-400 bg-blue-950/70 border border-blue-500/20 px-2 py-0.5 rounded-md">
                          {p.code}
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border flex items-center gap-1 ${
                            isPlanActive
                              ? 'bg-emerald-950/60 text-emerald-400 border-emerald-500/30'
                              : 'bg-slate-800/80 text-slate-400 border-slate-700/60'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isPlanActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                            }`}
                          />
                          {p.status}
                        </span>
                      </div>
                      <h2 className="text-base font-bold text-slate-100 tracking-tight group-hover:text-blue-300 transition-colors">
                        {p.name}
                      </h2>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-lg font-extrabold text-slate-100 flex items-center justify-end">
                        <IndianRupee className="h-4 w-4" />
                        <span>{numPrice.toLocaleString('en-IN')}</span>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        ₹{totalWithGst.toFixed(0)} incl. {p.gstRatePercent || 18}% GST
                      </div>
                    </div>
                  </div>

                  {/* Plan Description */}
                  {p.description && (
                    <p className="text-xs text-slate-400 mt-2 line-clamp-2 leading-relaxed">
                      {p.description}
                    </p>
                  )}

                  {/* Speeds Display */}
                  <div className="grid grid-cols-2 gap-3 my-4 p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 shadow-inner">
                    <div className="flex items-center gap-2.5">
                      <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <ArrowDownCircle className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-[9px] text-slate-400 uppercase font-semibold">Download</div>
                        <div className="text-xs font-bold text-slate-100">
                          {p.downloadSpeed} {p.speedUnit || 'MBPS'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                        <ArrowUpCircle className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-[9px] text-slate-400 uppercase font-semibold">Upload</div>
                        <div className="text-xs font-bold text-slate-100">
                          {p.uploadSpeed} {p.speedUnit || 'MBPS'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Specs & Commercials */}
                  <div className="space-y-2 text-xs text-slate-300">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-slate-400">
                        <Clock className="h-3.5 w-3.5 text-slate-500" />
                        Validity
                      </span>
                      <span className="font-semibold text-slate-200">
                        {p.validityDays} Days ({p.billingCycle || 'MONTHLY'})
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-slate-400">
                        <Layers className="h-3.5 w-3.5 text-slate-500" />
                        Data Quota
                      </span>
                      <span className="font-medium text-slate-200">
                        {p.dataLimitGb ? `${p.dataLimitGb} GB FUP` : 'Unlimited High-Speed'}
                      </span>
                    </div>

                    {p.burstDownloadMbps && (
                      <div className="flex items-center justify-between text-amber-400">
                        <span className="flex items-center gap-1.5">
                          <Zap className="h-3.5 w-3.5" />
                          Burst Policy
                        </span>
                        <span className="font-mono text-[11px] font-semibold">
                          {p.burstDownloadMbps}M Down / {p.burstUploadMbps}M Up ({p.burstTimeSecs}s)
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className="mt-5 pt-3.5 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  <button
                    onClick={() => setPolicyInspectorPlan(p)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 text-slate-300 hover:text-blue-300 border border-slate-700/60 text-[11px] font-medium transition-all"
                    title="Inspect vendor-neutral policy & RADIUS translation"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    <span>Policy</span>
                  </button>

                  <div className="flex items-center gap-2">
                    {/* Activate / Deactivate Toggle */}
                    <button
                      onClick={() =>
                        toggleStatusMutation.mutate({
                          id: p.id,
                          newStatus: isPlanActive ? 'INACTIVE' : 'ACTIVE',
                        })
                      }
                      disabled={toggleStatusMutation.isPending}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-all ${
                        isPlanActive
                          ? 'bg-rose-950/40 hover:bg-rose-900/50 text-rose-400 border-rose-800/40'
                          : 'bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-400 border-emerald-800/40'
                      }`}
                      title={isPlanActive ? 'Deactivate this plan' : 'Activate this plan'}
                    >
                      <Power className="h-3 w-3" />
                      <span>{isPlanActive ? 'Deactivate' : 'Activate'}</span>
                    </button>

                    {/* Edit Plan Button */}
                    <button
                      onClick={() => handleOpenEdit(p)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-medium transition-all"
                    >
                      <Edit3 className="h-3 w-3" />
                      <span>Edit</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Create Internet Plan */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full max-h-[92vh] overflow-y-auto shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 sticky top-0 bg-slate-900/95 backdrop-blur z-10">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-blue-600/10 text-blue-400 border border-blue-500/20">
                  <Wifi className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-100">Create Internet Plan</h2>
                  <p className="text-[11px] text-slate-400">Configure broadband package details & network rate policy</p>
                </div>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Presets Bar */}
            <div className="px-6 pt-4 pb-1">
              <div className="text-[11px] text-slate-400 font-medium mb-1.5">Quick Plan Templates:</div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => applyPreset(50, 20, 499, '50 Mbps - Home Starter')}
                  className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-blue-600/20 text-slate-300 hover:text-blue-300 border border-slate-700/80 text-[11px] font-medium transition-all"
                >
                  50 Mbps · ₹499
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset(100, 50, 799, '100 Mbps - Standard Fiber')}
                  className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-blue-600/20 text-slate-300 hover:text-blue-300 border border-slate-700/80 text-[11px] font-medium transition-all"
                >
                  100 Mbps · ₹799
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset(200, 100, 999, '200 Mbps - Ultra Gaming')}
                  className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-blue-600/20 text-slate-300 hover:text-blue-300 border border-slate-700/80 text-[11px] font-medium transition-all"
                >
                  200 Mbps · ₹999
                </button>
              </div>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSubmitCreate((data) => createMutation.mutate(data))} className="p-6 space-y-4">
              {/* Field 1: Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Plan Name *</label>
                <input
                  {...registerCreate('name', { required: 'Plan name is required' })}
                  type="text"
                  placeholder="e.g. 100 Mbps - Standard Fiber"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                {createErrors.name && <p className="text-[10px] text-rose-400 mt-1">{createErrors.name.message}</p>}
              </div>

              {/* Field 2: Description */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Description</label>
                <textarea
                  {...registerCreate('description')}
                  rows={2}
                  placeholder="e.g. High-speed broadband plan suitable for 4K streaming and simultaneous home devices."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                />
              </div>

              {/* Speeds & Speed Unit: Fields 3, 4, 5 */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Download Speed *</label>
                  <input
                    {...registerCreate('downloadSpeed', { required: true, valueAsNumber: true, min: 1 })}
                    type="number"
                    placeholder="100"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Upload Speed *</label>
                  <input
                    {...registerCreate('uploadSpeed', { required: true, valueAsNumber: true, min: 1 })}
                    type="number"
                    placeholder="50"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Speed Unit *</label>
                  <select
                    {...registerCreate('speedUnit', { required: true })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="MBPS">Mbps</option>
                    <option value="KBPS">Kbps</option>
                    <option value="GBPS">Gbps</option>
                  </select>
                </div>
              </div>

              {/* Commercials: Fields 6, 7, 8 */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Price (₹ excl. GST) *</label>
                  <input
                    {...registerCreate('price', { required: true, valueAsNumber: true, min: 0 })}
                    type="number"
                    placeholder="799"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Validity (Days) *</label>
                  <input
                    {...registerCreate('validityDays', { required: true, valueAsNumber: true, min: 1 })}
                    type="number"
                    defaultValue={30}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Billing Cycle *</label>
                  <select
                    {...registerCreate('billingCycle', { required: true })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="MONTHLY">Monthly</option>
                    <option value="QUARTERLY">Quarterly</option>
                    <option value="HALF_YEARLY">Half Yearly</option>
                    <option value="ANNUAL">Annual</option>
                    <option value="CUSTOM">Custom</option>
                  </select>
                </div>
              </div>

              {/* Field 9: Status & Optional Plan Code */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Status *</label>
                  <select
                    {...registerCreate('status', { required: true })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="ACTIVE">ACTIVE (Available for subscriptions)</option>
                    <option value="INACTIVE">INACTIVE (Hidden from new sales)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Plan Code <span className="text-slate-500 font-normal">(Optional)</span>
                  </label>
                  <input
                    {...registerCreate('code')}
                    type="text"
                    placeholder="e.g. FIBER-100M"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono uppercase focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Advanced Bandwidth & Burst Allocation Section */}
              <div className="pt-3 border-t border-slate-800">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-amber-400">
                  <input
                    type="checkbox"
                    {...registerCreate('hasBurst')}
                    className="rounded bg-slate-950 border-slate-700 text-amber-500 focus:ring-0"
                  />
                  <span>Configure Burst Bandwidth Profile</span>
                </label>

                {createHasBurst && (
                  <div className="grid grid-cols-2 gap-3 mt-3 p-3.5 rounded-xl bg-slate-950/80 border border-slate-800">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Burst Down (Mbps)</label>
                      <input
                        {...registerCreate('burstDownloadMbps', { valueAsNumber: true })}
                        type="number"
                        placeholder="150"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Burst Up (Mbps)</label>
                      <input
                        {...registerCreate('burstUploadMbps', { valueAsNumber: true })}
                        type="number"
                        placeholder="75"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Threshold (Mbps)</label>
                      <input
                        {...registerCreate('burstThresholdMbps', { valueAsNumber: true })}
                        type="number"
                        placeholder="70"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Burst Time (Secs)</label>
                      <input
                        {...registerCreate('burstTimeSecs', { valueAsNumber: true })}
                        type="number"
                        placeholder="20"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating || createMutation.isPending}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/20 transition-all disabled:opacity-50"
                >
                  {createMutation.isPending ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle className="h-4 w-4" />
                  )}
                  <span>Save Plan</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Internet Plan */}
      {editingPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full max-h-[92vh] overflow-y-auto shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 sticky top-0 bg-slate-900/95 backdrop-blur z-10">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-blue-600/10 text-blue-400 border border-blue-500/20">
                  <Edit3 className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-100">Edit Internet Plan</h2>
                  <p className="text-[11px] text-slate-400">Modifying plan code: {editingPlan.code}</p>
                </div>
              </div>
              <button
                onClick={() => setEditingPlan(null)}
                className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form
              onSubmit={handleSubmitEdit((data) =>
                updateMutation.mutate({ id: editingPlan.id, formData: data }),
              )}
              className="p-6 space-y-4"
            >
              {/* Field 1: Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Plan Name *</label>
                <input
                  {...registerEdit('name', { required: 'Plan name is required' })}
                  type="text"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                {editErrors.name && <p className="text-[10px] text-rose-400 mt-1">{editErrors.name.message}</p>}
              </div>

              {/* Field 2: Description */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Description</label>
                <textarea
                  {...registerEdit('description')}
                  rows={2}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                />
              </div>

              {/* Speeds & Speed Unit: Fields 3, 4, 5 */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Download Speed *</label>
                  <input
                    {...registerEdit('downloadSpeed', { required: true, valueAsNumber: true, min: 1 })}
                    type="number"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Upload Speed *</label>
                  <input
                    {...registerEdit('uploadSpeed', { required: true, valueAsNumber: true, min: 1 })}
                    type="number"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Speed Unit *</label>
                  <select
                    {...registerEdit('speedUnit', { required: true })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="MBPS">Mbps</option>
                    <option value="KBPS">Kbps</option>
                    <option value="GBPS">Gbps</option>
                  </select>
                </div>
              </div>

              {/* Commercials: Fields 6, 7, 8 */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Price (₹ excl. GST) *</label>
                  <input
                    {...registerEdit('price', { required: true, valueAsNumber: true, min: 0 })}
                    type="number"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Validity (Days) *</label>
                  <input
                    {...registerEdit('validityDays', { required: true, valueAsNumber: true, min: 1 })}
                    type="number"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Billing Cycle *</label>
                  <select
                    {...registerEdit('billingCycle', { required: true })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="MONTHLY">Monthly</option>
                    <option value="QUARTERLY">Quarterly</option>
                    <option value="HALF_YEARLY">Half Yearly</option>
                    <option value="ANNUAL">Annual</option>
                    <option value="CUSTOM">Custom</option>
                  </select>
                </div>
              </div>

              {/* Field 9: Status */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Status *</label>
                  <select
                    {...registerEdit('status', { required: true })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="INACTIVE">INACTIVE</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    GST Rate (%):
                  </label>
                  <input
                    {...registerEdit('gstRatePercent', { valueAsNumber: true })}
                    type="number"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Burst Configuration */}
              <div className="pt-3 border-t border-slate-800">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-amber-400">
                  <input
                    type="checkbox"
                    {...registerEdit('hasBurst')}
                    className="rounded bg-slate-950 border-slate-700 text-amber-500 focus:ring-0"
                  />
                  <span>Configure Burst Bandwidth Profile</span>
                </label>

                {editHasBurst && (
                  <div className="grid grid-cols-2 gap-3 mt-3 p-3.5 rounded-xl bg-slate-950/80 border border-slate-800">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Burst Down (Mbps)</label>
                      <input
                        {...registerEdit('burstDownloadMbps', { valueAsNumber: true })}
                        type="number"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Burst Up (Mbps)</label>
                      <input
                        {...registerEdit('burstUploadMbps', { valueAsNumber: true })}
                        type="number"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Threshold (Mbps)</label>
                      <input
                        {...registerEdit('burstThresholdMbps', { valueAsNumber: true })}
                        type="number"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">Burst Time (Secs)</label>
                      <input
                        {...registerEdit('burstTimeSecs', { valueAsNumber: true })}
                        type="number"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingPlan(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isEditing || updateMutation.isPending}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/20 transition-all disabled:opacity-50"
                >
                  {updateMutation.isPending ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle className="h-4 w-4" />
                  )}
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Vendor-Neutral Network Policy Inspector */}
      {policyInspectorPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-emerald-600/10 text-emerald-400 border border-emerald-500/20">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-100">Network Policy Profile</h2>
                  <p className="text-[11px] text-slate-400">
                    Vendor-neutral bandwidth abstraction for {policyInspectorPlan.name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPolicyInspectorPlan(null)}
                className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Abstraction Notice */}
              <div className="p-3 rounded-xl bg-blue-950/30 border border-blue-500/20 text-blue-300 text-xs flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-blue-400" />
                <p className="leading-relaxed">
                  Network policies are vendor-neutral and calculated exclusively by the backend service.
                  The platform translates them dynamically into standard RADIUS and NAS access control rules.
                </p>
              </div>

              {/* Policy Rates */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Bandwidth Rate Allocation
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-slate-500 text-[10px]">Download Speed</div>
                    <div className="font-bold text-slate-200">
                      {policyInspectorPlan.downloadSpeed} {policyInspectorPlan.speedUnit || 'MBPS'}
                    </div>
                    <div className="font-mono text-[10px] text-slate-400">
                      {policyInspectorPlan.networkPolicy?.rateLimit.downloadSpeedBps?.toLocaleString()} bps
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-[10px]">Upload Speed</div>
                    <div className="font-bold text-slate-200">
                      {policyInspectorPlan.uploadSpeed} {policyInspectorPlan.speedUnit || 'MBPS'}
                    </div>
                    <div className="font-mono text-[10px] text-slate-400">
                      {policyInspectorPlan.networkPolicy?.rateLimit.uploadSpeedBps?.toLocaleString()} bps
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                  <span className="text-slate-400">Traffic QoS Priority:</span>
                  <span className="font-mono font-bold text-emerald-400">
                    Priority {policyInspectorPlan.networkPolicy?.qosPriority || 8} (Standard Best Effort)
                  </span>
                </div>
              </div>

              {/* RADIUS Translation (Read-Only From Backend) */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Gauge className="h-3.5 w-3.5 text-slate-500" />
                  <span>Compiled RADIUS Attributes (Server-Calculated)</span>
                </div>

                {policyInspectorPlan.radiusAttributes ? (
                  <div className="space-y-1.5 font-mono text-[11px]">
                    {Object.entries(policyInspectorPlan.radiusAttributes).map(([key, val]) => (
                      <div
                        key={key}
                        className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-900/90 border border-slate-800 text-slate-300"
                      >
                        <span className="text-blue-400 font-semibold">{key}</span>
                        <span className="text-emerald-400 truncate max-w-[240px]" title={String(val)}>
                          {String(val)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">No RADIUS attributes compiled for this plan.</div>
                )}
              </div>

              {/* Close Button */}
              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setPolicyInspectorPlan(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-all"
                >
                  Close Inspector
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
