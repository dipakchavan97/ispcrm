'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import {
  Users,
  Search,
  UserPlus,
  Wifi,
  Phone,
  Mail,
  MapPin,
  ShieldCheck,
  Power,
  RefreshCw,
  X,
  CheckCircle,
  AlertCircle,
  Edit,
  Eye,
  ChevronLeft,
  ChevronRight,
  Calendar,
  FileText,
  Clock,
  History,
  Tag,
  ArrowRight,
  Filter,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { StatusBadge } from '../../components/StatusBadge';
import { CustomerStatus } from '@isp-crm/shared';

interface Plan {
  id: string;
  name: string;
  code: string;
  downloadSpeedMbps: number;
  uploadSpeedMbps: number;
  price: number;
  rateLimitString: string;
}

interface Subscription {
  id: string;
  status: string;
  startDate: string;
  endDate: string;
  plan: Plan;
}

interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  details: any;
  createdAt: string;
  adminUser?: {
    id: string;
    name: string;
    email: string;
  } | null;
}

interface Customer {
  id: string;
  organizationId: string;
  customerCode: string;
  name: string;
  mobile: string;
  phone?: string;
  email?: string | null;
  address: string;
  installationAddress?: string;
  area?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  username: string;
  pppoeUsername?: string;
  status: CustomerStatus;
  installationDate?: string | null;
  notes?: string | null;
  staticIp?: string | null;
  subscriptions?: Subscription[];
  auditLogs?: AuditLog[];
  createdAt: string;
  updatedAt: string;
}

interface CustomerListResponse {
  items: Customer[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface CustomerFormData {
  name: string;
  customerCode: string;
  mobile: string;
  email?: string;
  address: string;
  area?: string;
  city?: string;
  state?: string;
  pincode?: string;
  username: string;
  pppoePassword?: string;
  status: CustomerStatus;
  installationDate?: string;
  notes?: string;
  planId?: string;
  staticIp?: string;
}

const ALL_STATUSES = [
  'ALL',
  CustomerStatus.LEAD,
  CustomerStatus.PENDING,
  CustomerStatus.ACTIVE,
  CustomerStatus.SUSPENDED,
  CustomerStatus.EXPIRED,
  CustomerStatus.TERMINATED,
];

export default function CustomersPage() {
  const queryClient = useQueryClient();

  // Search, Filters & Pagination State
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [areaFilter, setAreaFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  // Modals & Drawers State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  // Status Change Dialog State
  const [statusChangeTarget, setStatusChangeTarget] = useState<Customer | null>(null);
  const [nextStatus, setNextStatus] = useState<CustomerStatus>(CustomerStatus.ACTIVE);
  const [statusChangeNotes, setStatusChangeNotes] = useState('');

  // Toast Notification
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // 1. Fetch Paginated Customers
  const {
    data: customerData = { items: [], total: 0, page: 1, limit: 10, totalPages: 1 },
    isLoading,
    refetch,
  } = useQuery<CustomerListResponse>({
    queryKey: ['customers', page, limit, statusFilter, searchTerm, areaFilter, cityFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      params.append('page', page.toString());
      params.append('limit', limit.toString());
      if (statusFilter !== 'ALL') params.append('status', statusFilter);
      if (searchTerm) params.append('search', searchTerm);
      if (areaFilter) params.append('area', areaFilter);
      if (cityFilter) params.append('city', cityFilter);
      return apiFetch<CustomerListResponse>(`/customers?${params.toString()}`);
    },
  });

  // 2. Fetch Selected Customer Details (with Audit Trail & Subscriptions)
  const { data: customerDetails, isLoading: isDetailsLoading } = useQuery<Customer>({
    queryKey: ['customer', selectedCustomerId],
    queryFn: () => apiFetch<Customer>(`/customers/${selectedCustomerId}`),
    enabled: !!selectedCustomerId,
  });

  // 3. Fetch Available Internet Plans for creation
  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ['plans'],
    queryFn: () => apiFetch<Plan[]>('/plans'),
  });

  // Forms
  const createForm = useForm<CustomerFormData>({
    defaultValues: {
      status: CustomerStatus.LEAD,
      state: 'Maharashtra',
      city: 'Mumbai',
    },
  });

  const editForm = useForm<CustomerFormData>();

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: CustomerFormData) =>
      apiFetch('/customers', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setIsCreateModalOpen(false);
      createForm.reset();
      showNotification('Customer registered & audit log recorded successfully!');
    },
    onError: (err: any) => {
      showNotification(err.message || 'Failed to create customer', 'error');
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CustomerFormData> }) =>
      apiFetch(`/customers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: (updatedCustomer) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer', editingCustomer?.id] });
      setEditingCustomer(null);
      showNotification(`Customer '${updatedCustomer.name}' updated & audit log saved!`);
    },
    onError: (err: any) => {
      showNotification(err.message || 'Failed to update customer', 'error');
    },
  });

  const statusTransitionMutation = useMutation({
    mutationFn: ({ id, status, notes }: { id: string; status: CustomerStatus; notes?: string }) =>
      apiFetch(`/customers/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, notes }),
      }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer', statusChangeTarget?.id] });
      setStatusChangeTarget(null);
      setStatusChangeNotes('');
      showNotification(res.message || 'Customer status updated & audit log recorded!');
    },
    onError: (err: any) => {
      showNotification(err.message || 'Status transition failed', 'error');
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/customers/${id}/disconnect`, { method: 'POST' }),
    onSuccess: (data: any) => {
      showNotification(data.message || 'RFC 3576 Disconnect-Request sent to router.');
    },
    onError: (err: any) => {
      showNotification(err.message || 'Disconnect failed', 'error');
    },
  });

  // Handlers
  const handleOpenEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    editForm.reset({
      name: customer.name,
      customerCode: customer.customerCode,
      mobile: customer.mobile || customer.phone || '',
      email: customer.email || '',
      address: customer.address || customer.installationAddress || '',
      area: customer.area || '',
      city: customer.city || '',
      state: customer.state || '',
      pincode: customer.pincode || '',
      username: customer.username || customer.pppoeUsername || '',
      status: customer.status,
      installationDate: customer.installationDate ? customer.installationDate.split('T')[0] : '',
      notes: customer.notes || '',
      staticIp: customer.staticIp || '',
    });
  };

  const handleOpenStatusChange = (customer: Customer, targetStatus?: CustomerStatus) => {
    setStatusChangeTarget(customer);
    setNextStatus(targetStatus || customer.status);
    setStatusChangeNotes('');
  };

  const onFilterStatusClick = (status: string) => {
    setStatusFilter(status);
    setPage(1);
  };

  const onSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setPage(1);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
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
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-600/10 text-blue-400 border border-blue-500/20">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2.5">
                <span>Customer Management</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-950 text-blue-400 border border-blue-800 font-mono">
                  {customerData.total} Total
                </span>
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Subscriber lifecycle, FreeRADIUS PPPoE provisioning, and multi-tenant audit logs.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition-all"
            title="Refresh list"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => {
              createForm.reset({
                status: CustomerStatus.LEAD,
                state: 'Maharashtra',
                city: 'Mumbai',
              });
              setIsCreateModalOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/20 transition-all"
          >
            <UserPlus className="h-4 w-4" />
            <span>Create Customer</span>
          </button>
        </div>
      </div>

      {/* Search & Filters Toolbar */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search by name, code, mobile, or username..."
              value={searchTerm}
              onChange={onSearchChange}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-8 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
            />
            {searchTerm && (
              <button
                onClick={() => {
                  setSearchTerm('');
                  setPage(1);
                }}
                className="absolute right-2.5 top-2.5 text-slate-500 hover:text-slate-300"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Area & City Filters */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <input
                type="text"
                placeholder="Filter area..."
                value={areaFilter}
                onChange={(e) => {
                  setAreaFilter(e.target.value);
                  setPage(1);
                }}
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 w-32 sm:w-36"
              />
              {areaFilter && (
                <button
                  onClick={() => {
                    setAreaFilter('');
                    setPage(1);
                  }}
                  className="absolute right-2 top-2 text-slate-500 hover:text-slate-300"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="relative">
              <input
                type="text"
                placeholder="Filter city..."
                value={cityFilter}
                onChange={(e) => {
                  setCityFilter(e.target.value);
                  setPage(1);
                }}
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 w-32 sm:w-36"
              />
              {cityFilter && (
                <button
                  onClick={() => {
                    setCityFilter('');
                    setPage(1);
                  }}
                  className="absolute right-2 top-2 text-slate-500 hover:text-slate-300"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Status Filter Tabs (LEAD, PENDING, ACTIVE, SUSPENDED, EXPIRED, TERMINATED) */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-1 border-t border-slate-800/60">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mr-2 shrink-0 flex items-center gap-1">
            <Filter className="h-3 w-3" /> Status:
          </span>
          {ALL_STATUSES.map((st) => (
            <button
              key={st}
              onClick={() => onFilterStatusClick(st)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all shrink-0 ${
                statusFilter === st
                  ? 'bg-blue-600 text-white shadow-sm font-semibold'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-800/80'
              }`}
            >
              {st === 'ALL' ? 'All Customers' : st}
            </button>
          ))}
        </div>
      </div>

      {/* Customer List Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800 uppercase tracking-wider text-[11px]">
              <tr>
                <th className="px-4 py-3.5">Customer / Contact</th>
                <th className="px-4 py-3.5">PPPoE Username</th>
                <th className="px-4 py-3.5">Location & Area</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5">Installation Date</th>
                <th className="px-4 py-3.5">Notes</th>
                <th className="px-4 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center text-slate-500">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto text-blue-500 mb-2" />
                    Fetching customers from database...
                  </td>
                </tr>
              ) : customerData.items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center text-slate-500">
                    <Users className="h-8 w-8 mx-auto text-slate-600 mb-2" />
                    No customers found matching your criteria.
                  </td>
                </tr>
              ) : (
                customerData.items.map((c) => {
                  const mobileNum = c.mobile || c.phone || 'N/A';
                  const isSuspended = c.status === CustomerStatus.SUSPENDED;

                  return (
                    <tr key={c.id} className="hover:bg-slate-800/30 transition-colors group">
                      {/* Name & Code */}
                      <td className="px-4 py-3.5">
                        <div
                          onClick={() => setSelectedCustomerId(c.id)}
                          className="font-semibold text-slate-100 hover:text-blue-400 cursor-pointer flex items-center gap-1.5"
                        >
                          <span>{c.name}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                          <span className="font-mono text-blue-400/90">{c.customerCode}</span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3 text-slate-500" />
                            {mobileNum}
                          </span>
                        </div>
                      </td>

                      {/* PPPoE Username */}
                      <td className="px-4 py-3.5">
                        <div className="font-mono text-xs font-medium text-emerald-400 bg-emerald-950/40 border border-emerald-500/20 px-2 py-0.5 rounded inline-block">
                          {c.username || c.pppoeUsername}
                        </div>
                        {c.staticIp && (
                          <div className="text-[10px] font-mono text-cyan-400 mt-1">IP: {c.staticIp}</div>
                        )}
                      </td>

                      {/* Location & Area */}
                      <td className="px-4 py-3.5">
                        <div className="max-w-[200px] truncate text-slate-300 flex items-center gap-1" title={c.address || c.installationAddress}>
                          <MapPin className="h-3 w-3 text-slate-500 shrink-0" />
                          <span>{c.address || c.installationAddress}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {[c.area, c.city, c.pincode].filter(Boolean).join(', ') || '—'}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5">
                        <StatusBadge status={c.status} />
                      </td>

                      {/* Installation Date */}
                      <td className="px-4 py-3.5 text-slate-400">
                        {c.installationDate ? (
                          <span className="flex items-center gap-1 font-mono text-[11px]">
                            <Calendar className="h-3 w-3 text-slate-500" />
                            {new Date(c.installationDate).toLocaleDateString()}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>

                      {/* Notes Preview */}
                      <td className="px-4 py-3.5 text-slate-400 max-w-[160px]">
                        <p className="truncate text-[11px]" title={c.notes || ''}>
                          {c.notes || '—'}
                        </p>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* View Details */}
                          <button
                            onClick={() => setSelectedCustomerId(c.id)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-all"
                            title="View Customer Details & Audit History"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>

                          {/* Edit Customer */}
                          <button
                            onClick={() => handleOpenEdit(c)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-all"
                            title="Edit Customer"
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </button>

                          {/* Quick Status Change */}
                          <button
                            onClick={() => handleOpenStatusChange(c)}
                            className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px] font-medium transition-all"
                            title="Transition Status"
                          >
                            Status
                          </button>

                          {/* Quick Suspend/Reactivate */}
                          {isSuspended ? (
                            <button
                              onClick={() =>
                                statusTransitionMutation.mutate({
                                  id: c.id,
                                  status: CustomerStatus.ACTIVE,
                                  notes: 'Reactivated from quick action',
                                })
                              }
                              className="px-2 py-1 rounded-lg bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-400 border border-emerald-500/30 text-[11px] font-semibold transition-all"
                              title="Reactivate Subscriber"
                            >
                              Reactivate
                            </button>
                          ) : (
                            <button
                              onClick={() =>
                                statusTransitionMutation.mutate({
                                  id: c.id,
                                  status: CustomerStatus.SUSPENDED,
                                  notes: 'Suspended from quick action',
                                })
                              }
                              className="px-2 py-1 rounded-lg bg-amber-950/40 hover:bg-amber-900/60 text-amber-400 border border-amber-500/30 text-[11px] font-semibold transition-all"
                              title="Suspend Subscriber"
                            >
                              Suspend
                            </button>
                          )}

                          {/* Disconnect active PPPoE */}
                          <button
                            onClick={() => disconnectMutation.mutate(c.id)}
                            disabled={disconnectMutation.isPending}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-500/40 transition-all"
                            title="Force Disconnect PPPoE Session (RFC 3576 PoD)"
                          >
                            <Power className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Server-Side Pagination Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3.5 bg-slate-950 border-t border-slate-800 text-xs text-slate-400">
          <div className="flex items-center gap-3">
            <span>
              Showing{' '}
              <strong className="text-slate-200">
                {customerData.total === 0 ? 0 : (customerData.page - 1) * customerData.limit + 1}
              </strong>{' '}
              to{' '}
              <strong className="text-slate-200">
                {Math.min(customerData.page * customerData.limit, customerData.total)}
              </strong>{' '}
              of <strong className="text-slate-200">{customerData.total}</strong> customers
            </span>

            <div className="flex items-center gap-1.5 ml-2">
              <span className="text-[11px] text-slate-500">Per page:</span>
              <select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setPage(1);
                }}
                className="bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 mr-2">
              Page {customerData.page} of {customerData.totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={customerData.page <= 1}
              className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              title="Previous Page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(customerData.totalPages, p + 1))}
              disabled={customerData.page >= customerData.totalPages}
              className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              title="Next Page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: CREATE CUSTOMER (All 15 Fields)                                   */}
      {/* ========================================================================= */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full max-h-[92vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
              <div className="flex items-center gap-2.5">
                <UserPlus className="h-5 w-5 text-blue-400" />
                <h2 className="text-base font-bold text-slate-100">Create New Customer</h2>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={createForm.handleSubmit((formData) => createMutation.mutate(formData))}
              className="p-6 space-y-5"
            >
              {/* Basic Profile */}
              <div>
                <h3 className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-3">
                  1. Profile & Identifiers
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Full Name *</label>
                    <input
                      {...createForm.register('name', { required: 'Name is required' })}
                      type="text"
                      placeholder="e.g. Ramesh Kulkarni"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    {createForm.formState.errors.name && (
                      <p className="text-[10px] text-rose-400 mt-1">{createForm.formState.errors.name.message}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Customer Code *</label>
                    <input
                      {...createForm.register('customerCode', { required: 'Customer code is required' })}
                      type="text"
                      placeholder="e.g. CUST-2026-001"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    {createForm.formState.errors.customerCode && (
                      <p className="text-[10px] text-rose-400 mt-1">{createForm.formState.errors.customerCode.message}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Mobile (10 digits) *</label>
                    <input
                      {...createForm.register('mobile', { required: 'Mobile is required' })}
                      type="text"
                      placeholder="e.g. 9820123456"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    {createForm.formState.errors.mobile && (
                      <p className="text-[10px] text-rose-400 mt-1">{createForm.formState.errors.mobile.message}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
                    <input
                      {...createForm.register('email')}
                      type="email"
                      placeholder="e.g. ramesh@example.com"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Initial Status *</label>
                    <select
                      {...createForm.register('status', { required: true })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value={CustomerStatus.LEAD}>LEAD (New Inquiry)</option>
                      <option value={CustomerStatus.PENDING}>PENDING (Installation)</option>
                      <option value={CustomerStatus.ACTIVE}>ACTIVE (Online)</option>
                      <option value={CustomerStatus.SUSPENDED}>SUSPENDED</option>
                      <option value={CustomerStatus.EXPIRED}>EXPIRED</option>
                      <option value={CustomerStatus.TERMINATED}>TERMINATED</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Installation Date</label>
                    <input
                      {...createForm.register('installationDate')}
                      type="date"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Location Details */}
              <div className="pt-3 border-t border-slate-800">
                <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-3">
                  2. Installation Address & Location
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="sm:col-span-2 md:col-span-4">
                    <label className="block text-xs font-medium text-slate-300 mb-1">Address *</label>
                    <input
                      {...createForm.register('address', { required: 'Address is required' })}
                      type="text"
                      placeholder="e.g. Flat 502, Gokul Towers, Shivaji Nagar"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    {createForm.formState.errors.address && (
                      <p className="text-[10px] text-rose-400 mt-1">{createForm.formState.errors.address.message}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Area / Sector</label>
                    <input
                      {...createForm.register('area')}
                      type="text"
                      placeholder="e.g. Shivaji Nagar"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">City</label>
                    <input
                      {...createForm.register('city')}
                      type="text"
                      placeholder="e.g. Pune"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">State</label>
                    <input
                      {...createForm.register('state')}
                      type="text"
                      placeholder="e.g. Maharashtra"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Pincode</label>
                    <input
                      {...createForm.register('pincode')}
                      type="text"
                      placeholder="e.g. 411005"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* PPPoE Credentials & Provisioning */}
              <div className="pt-3 border-t border-slate-800">
                <h3 className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-3">
                  3. Network Credentials & RADIUS Provisioning
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">PPPoE Username *</label>
                    <input
                      {...createForm.register('username', { required: 'PPPoE Username is required' })}
                      type="text"
                      placeholder="e.g. ramesh_fiber"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                    {createForm.formState.errors.username && (
                      <p className="text-[10px] text-rose-400 mt-1">{createForm.formState.errors.username.message}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">PPPoE Password *</label>
                    <input
                      {...createForm.register('pppoePassword', { required: 'Password is required' })}
                      type="password"
                      placeholder="••••••••"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Internet Plan</label>
                    <select
                      {...createForm.register('planId')}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-purple-500"
                    >
                      <option value="">-- Select Plan --</option>
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.downloadSpeedMbps}M down) - ₹{p.price}/mo
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Static IP (Optional)</label>
                    <input
                      {...createForm.register('staticIp')}
                      type="text"
                      placeholder="e.g. 100.64.1.55"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div className="pt-3 border-t border-slate-800">
                <label className="block text-xs font-medium text-slate-300 mb-1">Customer Notes / History</label>
                <textarea
                  {...createForm.register('notes')}
                  rows={2}
                  placeholder="Special instructions, optical power reading (-18 dBm), router model, etc."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/20 transition-all disabled:opacity-50"
                >
                  {createMutation.isPending ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  <span>Save & Record Audit Log</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: EDIT CUSTOMER (All 15 Fields)                                     */}
      {/* ========================================================================= */}
      {editingCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full max-h-[92vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
              <div className="flex items-center gap-2.5">
                <Edit className="h-5 w-5 text-amber-400" />
                <h2 className="text-base font-bold text-slate-100">
                  Edit Customer: <span className="text-amber-400">{editingCustomer.name}</span>
                </h2>
              </div>
              <button
                onClick={() => setEditingCustomer(null)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={editForm.handleSubmit((formData) =>
                editMutation.mutate({ id: editingCustomer.id, data: formData }),
              )}
              className="p-6 space-y-5"
            >
              {/* Profile Details */}
              <div>
                <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-3">
                  1. Profile & Identifiers
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Full Name *</label>
                    <input
                      {...editForm.register('name', { required: 'Name is required' })}
                      type="text"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Customer Code *</label>
                    <input
                      {...editForm.register('customerCode', { required: 'Code is required' })}
                      type="text"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Mobile (10 digits) *</label>
                    <input
                      {...editForm.register('mobile', { required: 'Mobile is required' })}
                      type="text"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
                    <input
                      {...editForm.register('email')}
                      type="email"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Installation Date</label>
                    <input
                      {...editForm.register('installationDate')}
                      type="date"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Address */}
              <div className="pt-3 border-t border-slate-800">
                <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-3">
                  2. Installation Address & Location
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="sm:col-span-2 md:col-span-4">
                    <label className="block text-xs font-medium text-slate-300 mb-1">Address *</label>
                    <input
                      {...editForm.register('address', { required: 'Address is required' })}
                      type="text"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Area</label>
                    <input
                      {...editForm.register('area')}
                      type="text"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">City</label>
                    <input
                      {...editForm.register('city')}
                      type="text"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">State</label>
                    <input
                      {...editForm.register('state')}
                      type="text"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Pincode</label>
                    <input
                      {...editForm.register('pincode')}
                      type="text"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* PPPoE Credentials */}
              <div className="pt-3 border-t border-slate-800">
                <h3 className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-3">
                  3. Network Credentials
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">PPPoE Username</label>
                    <input
                      {...editForm.register('username')}
                      type="text"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">New PPPoE Password (Optional)</label>
                    <input
                      {...editForm.register('pppoePassword')}
                      type="password"
                      placeholder="Leave blank to keep current"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Static IP</label>
                    <input
                      {...editForm.register('staticIp')}
                      type="text"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div className="pt-3 border-t border-slate-800">
                <label className="block text-xs font-medium text-slate-300 mb-1">Notes</label>
                <textarea
                  {...editForm.register('notes')}
                  rows={3}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingCustomer(null)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editMutation.isPending}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-lg shadow-amber-500/20 transition-all disabled:opacity-50"
                >
                  {editMutation.isPending ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  <span>Save Changes & Log Audit</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: STATUS TRANSITION DIALOG (Audit Logged)                           */}
      {/* ========================================================================= */}
      {statusChangeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <History className="h-4 w-4 text-blue-400" />
                <span>Transition Customer Status</span>
              </h3>
              <button
                onClick={() => setStatusChangeTarget(null)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <p className="text-xs text-slate-400 mb-1">Target Customer:</p>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                <span className="font-semibold text-slate-200 text-xs">{statusChangeTarget.name}</span>
                <StatusBadge status={statusChangeTarget.status} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Select New Status *</label>
              <select
                value={nextStatus}
                onChange={(e) => setNextStatus(e.target.value as CustomerStatus)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value={CustomerStatus.LEAD}>LEAD (New Inquiry)</option>
                <option value={CustomerStatus.PENDING}>PENDING (Installation)</option>
                <option value={CustomerStatus.ACTIVE}>ACTIVE (Enable PPPoE)</option>
                <option value={CustomerStatus.SUSPENDED}>SUSPENDED (Lock PPPoE)</option>
                <option value={CustomerStatus.EXPIRED}>EXPIRED (Validity Ended)</option>
                <option value={CustomerStatus.TERMINATED}>TERMINATED (Decommission)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Reason / Audit Log Notes (Optional)
              </label>
              <textarea
                rows={2}
                value={statusChangeNotes}
                onChange={(e) => setStatusChangeNotes(e.target.value)}
                placeholder="e.g. Subscriber requested temporary pause / Payment verified"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setStatusChangeTarget(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={statusTransitionMutation.isPending}
                onClick={() =>
                  statusTransitionMutation.mutate({
                    id: statusChangeTarget.id,
                    status: nextStatus,
                    notes: statusChangeNotes,
                  })
                }
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow"
              >
                {statusTransitionMutation.isPending && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                <span>Confirm Transition</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* DRAWER / MODAL 4: CUSTOMER DETAILS VIEW (All 15 Fields + Audit Logs)      */}
      {/* ========================================================================= */}
      {selectedCustomerId && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border-l border-slate-800 w-full max-w-2xl h-full overflow-y-auto shadow-2xl p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <div className="flex items-center gap-2.5">
                  <h2 className="text-lg font-bold text-slate-100">
                    {isDetailsLoading ? 'Loading profile...' : customerDetails?.name}
                  </h2>
                  {customerDetails && <StatusBadge status={customerDetails.status} />}
                </div>
                {customerDetails && (
                  <p className="text-xs font-mono text-blue-400 mt-0.5">
                    {customerDetails.customerCode} • ID: {customerDetails.id}
                  </p>
                )}
              </div>
              <button
                onClick={() => setSelectedCustomerId(null)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {isDetailsLoading || !customerDetails ? (
              <div className="py-24 text-center text-slate-500">
                <RefreshCw className="h-7 w-7 animate-spin mx-auto text-blue-500 mb-2" />
                Loading subscriber details & audit trail...
              </div>
            ) : (
              <div className="space-y-6">
                {/* Quick Action Buttons */}
                <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <button
                    onClick={() => handleOpenEdit(customerDetails)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700"
                  >
                    <Edit className="h-3.5 w-3.5 text-amber-400" />
                    <span>Edit Profile</span>
                  </button>
                  <button
                    onClick={() => handleOpenStatusChange(customerDetails)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 text-xs font-medium border border-blue-500/30"
                  >
                    <History className="h-3.5 w-3.5" />
                    <span>Change Status</span>
                  </button>
                  <button
                    onClick={() => disconnectMutation.mutate(customerDetails.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600/10 hover:bg-rose-600/20 text-rose-400 text-xs font-medium border border-rose-500/30"
                  >
                    <Power className="h-3.5 w-3.5" />
                    <span>Disconnect Session</span>
                  </button>
                </div>

                {/* Section 1: Customer Fields Grid (All 15 Fields) */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 text-xs">
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                    <span className="text-[11px] text-slate-500 block mb-1">Mobile</span>
                    <span className="font-semibold text-slate-200 flex items-center gap-1">
                      <Phone className="h-3.5 w-3.5 text-blue-400" />
                      {customerDetails.mobile || customerDetails.phone || '—'}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                    <span className="text-[11px] text-slate-500 block mb-1">Email</span>
                    <span className="font-semibold text-slate-200 truncate flex items-center gap-1" title={customerDetails.email || ''}>
                      <Mail className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                      <span className="truncate">{customerDetails.email || '—'}</span>
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                    <span className="text-[11px] text-slate-500 block mb-1">PPPoE Username</span>
                    <span className="font-mono font-semibold text-emerald-400">
                      {customerDetails.username || customerDetails.pppoeUsername}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                    <span className="text-[11px] text-slate-500 block mb-1">Installation Date</span>
                    <span className="font-semibold text-slate-200 flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5 text-blue-400" />
                      {customerDetails.installationDate
                        ? new Date(customerDetails.installationDate).toLocaleDateString()
                        : '—'}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                    <span className="text-[11px] text-slate-500 block mb-1">Area</span>
                    <span className="font-semibold text-slate-200">{customerDetails.area || '—'}</span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                    <span className="text-[11px] text-slate-500 block mb-1">City / State</span>
                    <span className="font-semibold text-slate-200">
                      {[customerDetails.city, customerDetails.state].filter(Boolean).join(', ') || '—'}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                    <span className="text-[11px] text-slate-500 block mb-1">Pincode</span>
                    <span className="font-mono font-semibold text-slate-200">{customerDetails.pincode || '—'}</span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                    <span className="text-[11px] text-slate-500 block mb-1">Static IP</span>
                    <span className="font-mono font-semibold text-cyan-400">{customerDetails.staticIp || 'Dynamic DHCP'}</span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                    <span className="text-[11px] text-slate-500 block mb-1">Organization ID</span>
                    <span className="font-mono text-[10px] text-slate-400 truncate block" title={customerDetails.organizationId}>
                      {customerDetails.organizationId}
                    </span>
                  </div>
                </div>

                {/* Section 2: Address & Notes */}
                <div className="space-y-3">
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                    <span className="text-[11px] text-slate-500 font-semibold block mb-1">Full Installation Address</span>
                    <p className="text-xs text-slate-200">{customerDetails.address || customerDetails.installationAddress}</p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                    <span className="text-[11px] text-slate-500 font-semibold block mb-1">Notes / Installation Details</span>
                    <p className="text-xs text-slate-300 whitespace-pre-wrap">
                      {customerDetails.notes || 'No customer notes recorded.'}
                    </p>
                  </div>
                </div>

                {/* Section 3: Subscriptions / Plan */}
                <div>
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                    <Wifi className="h-4 w-4 text-blue-400" />
                    <span>Active Subscription & Internet Plan</span>
                  </h3>
                  {customerDetails.subscriptions && customerDetails.subscriptions.length > 0 ? (
                    <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-slate-100 text-sm">
                          {customerDetails.subscriptions[0].plan.name}
                        </div>
                        <div className="text-xs text-slate-400 font-mono mt-0.5">
                          {customerDetails.subscriptions[0].plan.downloadSpeedMbps}M Down /{' '}
                          {customerDetails.subscriptions[0].plan.uploadSpeedMbps}M Up
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1">
                          Valid: {new Date(customerDetails.subscriptions[0].startDate).toLocaleDateString()} to{' '}
                          {new Date(customerDetails.subscriptions[0].endDate).toLocaleDateString()}
                        </div>
                      </div>
                      <StatusBadge status={customerDetails.subscriptions[0].status} />
                    </div>
                  ) : (
                    <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-500 italic text-center">
                      No active subscription plan attached.
                    </div>
                  )}
                </div>

                {/* Section 4: Audit Logs Timeline (CREATE, UPDATE, STATUS_CHANGE) */}
                <div>
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                    <History className="h-4 w-4 text-emerald-400" />
                    <span>Audit Logs Timeline</span>
                  </h3>

                  {!customerDetails.auditLogs || customerDetails.auditLogs.length === 0 ? (
                    <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-500 italic text-center">
                      No audit history found for this subscriber.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {customerDetails.auditLogs.map((log) => {
                        const isCreate = log.action === 'CREATE';
                        const isStatus = log.action === 'STATUS_CHANGE';

                        return (
                          <div
                            key={log.id}
                            className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-xs flex items-start justify-between gap-3"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                                    isCreate
                                      ? 'bg-blue-950 text-blue-400 border border-blue-800'
                                      : isStatus
                                      ? 'bg-amber-950 text-amber-400 border border-amber-800'
                                      : 'bg-slate-800 text-slate-300 border border-slate-700'
                                  }`}
                                >
                                  {log.action}
                                </span>
                                <span className="text-slate-400 text-[11px]">
                                  by <strong className="text-slate-200">{log.adminUser?.name || 'System'}</strong>
                                </span>
                              </div>

                              {/* Details formatting */}
                              {isStatus && log.details ? (
                                <p className="text-slate-300 text-xs flex items-center gap-1.5">
                                  <span>{log.details.oldStatus}</span>
                                  <ArrowRight className="h-3 w-3 text-slate-500" />
                                  <strong className="text-emerald-400">{log.details.newStatus}</strong>
                                  {log.details.notes && (
                                    <span className="text-slate-500 italic ml-1">({log.details.notes})</span>
                                  )}
                                </p>
                              ) : isCreate ? (
                                <p className="text-slate-400 text-[11px]">
                                  Customer profile initialized with code{' '}
                                  <span className="font-mono text-blue-400">{log.details?.customerCode}</span>
                                </p>
                              ) : (
                                <p className="text-slate-400 text-[11px]">
                                  Profile attributes updated: {Object.keys(log.details?.updatedFields || log.details || {}).join(', ')}
                                </p>
                              )}
                            </div>

                            <div className="text-[11px] text-slate-500 font-mono shrink-0 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {new Date(log.createdAt).toLocaleString()}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
