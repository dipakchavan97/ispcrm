'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import {
  LifeBuoy,
  Search,
  Plus,
  Filter,
  CheckCircle2,
  AlertCircle,
  Clock,
  User,
  Phone,
  MapPin,
  Wifi,
  Radio,
  Trash2,
  Check,
  ChevronLeft,
  ChevronRight,
  X,
  ExternalLink,
  MessageSquare,
  Send,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { StatusBadge } from '../../components/StatusBadge';
import { TableSkeleton, MetricSkeleton } from '../../components/LoadingSkeleton';
import { EmptyState } from '../../components/EmptyState';
import { useToast } from '../../components/Toast';

export type TicketCategory =
  | 'FIBER_CUT'
  | 'SLOW_SPEED'
  | 'ROUTER_OFFLINE'
  | 'AUTH_FAILURE'
  | 'BILLING_ISSUE'
  | 'NEW_INSTALLATION'
  | 'TECHNICAL'
  | 'GENERAL';

export type TicketPriority = 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';
export type TicketStatus = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'WAITING_CUSTOMER' | 'RESOLVED' | 'CLOSED';

export interface TicketCommentItem {
  id: string;
  authorName: string;
  comment: string;
  isInternal: boolean;
  createdAt: string;
}

export interface TicketItem {
  id: string;
  ticketNumber: string;
  customerId?: string | null;
  title: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  assignedTo?: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: {
    id: string;
    customerCode: string;
    name: string;
    mobile: string;
    username?: string;
  } | null;
  comments?: TicketCommentItem[];
}

interface CustomerOption {
  id: string;
  name: string;
  customerCode: string;
  mobile: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  FIBER_CUT: 'Optical Fiber Cut (Red LOS)',
  SLOW_SPEED: 'Bandwidth / Speed Issue',
  ROUTER_OFFLINE: 'Router Offline / Power Loss',
  AUTH_FAILURE: 'PPPoE Auth / Login Failure',
  BILLING_ISSUE: 'Billing & Invoice Dispute',
  NEW_INSTALLATION: 'New Field Installation',
  TECHNICAL: 'Technical Fault',
  GENERAL: 'General Query',
};

export default function TicketsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const limit = 10;

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [newCommentContent, setNewCommentContent] = useState('');

  // 1. Fetch Real Customer Options for Ticket Creation
  const { data: customersData } = useQuery<{ items: CustomerOption[] }>({
    queryKey: ['customers-for-tickets'],
    queryFn: () => apiFetch<{ items: CustomerOption[] }>('/customers?limit=200'),
  });

  // 2. Fetch Tickets from Backend API
  const {
    data: tickets = [],
    isLoading: isLoadingTickets,
    refetch: refetchTickets,
    isRefetching,
  } = useQuery<TicketItem[]>({
    queryKey: ['tickets-list'],
    queryFn: () => apiFetch<TicketItem[]>('/tickets'),
  });

  // 3. Fetch Selected Ticket with Comments
  const {
    data: selectedTicket,
    isLoading: isLoadingSelected,
  } = useQuery<TicketItem>({
    queryKey: ['ticket-detail', selectedTicketId],
    queryFn: () => apiFetch<TicketItem>(`/tickets/${selectedTicketId}`),
    enabled: Boolean(selectedTicketId),
  });

  // 4. Create Ticket Mutation
  const createMutation = useMutation({
    mutationFn: (body: any) => apiFetch('/tickets', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (newTkt: any) => {
      toast.success(`Ticket ${newTkt.ticketNumber} created successfully`, 'Helpdesk Ticket Opened');
      setIsCreateModalOpen(false);
      resetCreateForm();
      queryClient.invalidateQueries({ queryKey: ['tickets-list'] });
      queryClient.invalidateQueries({ queryKey: ['tickets-stats'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to create ticket', 'Error');
    },
  });

  // 5. Update Status / Assignment Mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) =>
      apiFetch(`/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success('Ticket updated', 'Status Updated');
      queryClient.invalidateQueries({ queryKey: ['tickets-list'] });
      queryClient.invalidateQueries({ queryKey: ['ticket-detail', selectedTicketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets-stats'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to update ticket', 'Update Error');
    },
  });

  // 6. Add Comment Mutation
  const addCommentMutation = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) =>
      apiFetch(`/tickets/${id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ comment, isInternal: false }),
      }),
    onSuccess: () => {
      setNewCommentContent('');
      toast.success('Comment added to ticket history', 'Comment Posted');
      queryClient.invalidateQueries({ queryKey: ['ticket-detail', selectedTicketId] });
      queryClient.invalidateQueries({ queryKey: ['tickets-list'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to add comment', 'Error');
    },
  });

  // Create Ticket Form
  const {
    register,
    handleSubmit,
    reset: resetCreateForm,
  } = useForm({
    defaultValues: {
      customerId: '',
      category: 'TECHNICAL',
      priority: 'MEDIUM',
      title: '',
      description: '',
      assignedTo: 'Support Desk',
    },
  });

  const onSubmitCreate = (data: any) => {
    if (!data.title.trim()) {
      toast.error('Ticket subject/title is required', 'Validation Error');
      return;
    }
    if (!data.description.trim()) {
      toast.error('Issue description is required', 'Validation Error');
      return;
    }

    createMutation.mutate({
      customerId: data.customerId || null,
      category: data.category,
      priority: data.priority,
      title: data.title.trim(),
      description: data.description.trim(),
      assignedTo: data.assignedTo?.trim() || null,
    });
  };

  // Filter & Search Logic
  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
      if (priorityFilter !== 'ALL' && t.priority !== priorityFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchNum = t.ticketNumber.toLowerCase().includes(q);
        const matchTitle = t.title.toLowerCase().includes(q);
        const matchCust = t.customer?.name?.toLowerCase().includes(q) || false;
        const matchUser = t.customer?.username?.toLowerCase().includes(q) || false;
        if (!matchNum && !matchTitle && !matchCust && !matchUser) return false;
      }
      return true;
    });
  }, [tickets, statusFilter, priorityFilter, search]);

  const totalPages = Math.ceil(filteredTickets.length / limit) || 1;
  const paginatedTickets = useMemo(() => {
    const start = (page - 1) * limit;
    return filteredTickets.slice(start, start + limit);
  }, [filteredTickets, page, limit]);

  const openTicketsCount = tickets.filter((t) => t.status === 'OPEN').length;
  const inProgressCount = tickets.filter((t) => t.status === 'IN_PROGRESS').length;
  const urgentCount = tickets.filter((t) => t.priority === 'URGENT' && t.status !== 'CLOSED').length;
  const resolvedCount = tickets.filter((t) => t.status === 'RESOLVED' || t.status === 'CLOSED').length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2.5">
              <LifeBuoy className="h-6 w-6 text-amber-500" />
              Subscriber Helpdesk & Support Tickets
            </h1>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-semibold">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live DB
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            End-to-end incident management, fiber cut diagnostics, and technician escalation workflows
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => refetchTickets()}
            disabled={isRefetching}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition-colors cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? 'animate-spin text-blue-400' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/20 transition-all cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Open Ticket</span>
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-[11px] font-medium uppercase text-slate-400">Open Tickets</p>
          <p className="text-2xl font-bold text-amber-400 mt-1">{openTicketsCount}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Awaiting staff diagnosis</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-[11px] font-medium uppercase text-slate-400">In Progress</p>
          <p className="text-2xl font-bold text-blue-400 mt-1">{inProgressCount}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Assigned to technician</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-[11px] font-medium uppercase text-slate-400">Urgent Escalations</p>
          <p className="text-2xl font-bold text-rose-400 mt-1">{urgentCount}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">High priority SLA alerts</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-[11px] font-medium uppercase text-slate-400">Resolved / Closed</p>
          <p className="text-2xl font-bold text-emerald-400 mt-1">{resolvedCount}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Tickets completed</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ticket #, subject, subscriber..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="OPEN">OPEN</option>
            <option value="IN_PROGRESS">IN_PROGRESS</option>
            <option value="RESOLVED">RESOLVED</option>
            <option value="CLOSED">CLOSED</option>
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
          >
            <option value="ALL">All Priorities</option>
            <option value="URGENT">URGENT</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </select>
        </div>
      </div>

      {/* Tickets Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
        {isLoadingTickets ? (
          <TableSkeleton rows={5} cols={5} />
        ) : paginatedTickets.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={LifeBuoy}
              title="No Support Tickets Found"
              description="No tickets match your filter criteria or no tickets have been opened yet."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 uppercase font-mono text-[10px] border-b border-slate-800">
                <tr>
                  <th className="px-5 py-3">Ticket #</th>
                  <th className="px-5 py-3">Subscriber</th>
                  <th className="px-5 py-3">Subject & Category</th>
                  <th className="px-5 py-3">Priority</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Assigned To</th>
                  <th className="px-5 py-3">Created</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-slate-300">
                {paginatedTickets.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedTicketId(t.id)}
                    className="hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <td className="px-5 py-3 font-mono font-bold text-blue-400">
                      {t.ticketNumber}
                    </td>
                    <td className="px-5 py-3">
                      {t.customer ? (
                        <div>
                          <p className="font-semibold text-white">{t.customer.name}</p>
                          <p className="text-[10px] text-slate-400 font-mono">
                            {t.customer.customerCode} • {t.customer.mobile}
                          </p>
                        </div>
                      ) : (
                        <span className="text-slate-500 italic">General / Unassigned</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-100 max-w-xs truncate">{t.title}</p>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {CATEGORY_LABELS[t.category] || t.category}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase ${
                          t.priority === 'URGENT'
                            ? 'bg-rose-950/80 text-rose-400 border border-rose-800/60'
                            : t.priority === 'HIGH'
                            ? 'bg-amber-950/80 text-amber-400 border border-amber-800/60'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {t.priority}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-5 py-3 text-slate-400">
                      {t.assignedTo || 'Unassigned'}
                    </td>
                    <td className="px-5 py-3 text-slate-500 font-mono text-[11px]">
                      {new Date(t.createdAt).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                      })}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTicketId(t.id);
                        }}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium transition-colors"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-3 bg-slate-950/40 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <span>Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 transition-colors"
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Ticket Detail & Discussion Drawer Modal */}
      {selectedTicket && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-[#0f172a] border border-slate-800 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
              <div className="flex items-center gap-3">
                <span className="font-mono font-bold text-blue-400 text-sm">{selectedTicket.ticketNumber}</span>
                <StatusBadge status={selectedTicket.status} />
              </div>
              <button
                onClick={() => setSelectedTicketId(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5 flex-1">
              <div>
                <h3 className="text-base font-bold text-white">{selectedTicket.title}</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed bg-slate-950 p-3 rounded-lg border border-slate-800">
                  {selectedTicket.description}
                </p>
              </div>

              {selectedTicket.customer && (
                <div className="p-3.5 rounded-lg bg-blue-950/20 border border-blue-800/30 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold text-slate-200">{selectedTicket.customer.name}</span>
                    <span className="text-slate-400 font-mono block text-[11px]">
                      {selectedTicket.customer.customerCode} • {selectedTicket.customer.mobile}
                    </span>
                  </div>
                  <Link
                    href={`/customers/${selectedTicket.customer.id}`}
                    className="flex items-center gap-1 text-blue-400 hover:text-blue-300 font-medium"
                  >
                    <span>Customer 360</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )}

              {/* Status Update Control */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800">
                <span className="text-xs text-slate-400 font-medium">Update Status:</span>
                {(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as TicketStatus[]).map((st) => (
                  <button
                    key={st}
                    disabled={selectedTicket.status === st || updateMutation.isPending}
                    onClick={() => updateMutation.mutate({ id: selectedTicket.id, body: { status: st } })}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                      selectedTicket.status === st
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>

              {/* Comments History */}
              <div className="space-y-3 pt-3 border-t border-slate-800">
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5 text-blue-400" />
                  Staff Notes & Discussion ({selectedTicket.comments?.length || 0})
                </h4>

                {(!selectedTicket.comments || selectedTicket.comments.length === 0) ? (
                  <p className="text-xs text-slate-500 italic">No notes posted yet on this ticket.</p>
                ) : (
                  <div className="space-y-2.5">
                    {selectedTicket.comments.map((cm) => (
                      <div key={cm.id} className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                          <span className="font-semibold text-blue-400">{cm.authorName}</span>
                          <span className="font-mono">{new Date(cm.createdAt).toLocaleString('en-IN')}</span>
                        </div>
                        <p className="text-xs text-slate-300">{cm.comment}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add Comment Input */}
                <div className="flex gap-2 pt-2">
                  <input
                    type="text"
                    value={newCommentContent}
                    onChange={(e) => setNewCommentContent(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newCommentContent.trim()) {
                        addCommentMutation.mutate({ id: selectedTicket.id, comment: newCommentContent.trim() });
                      }
                    }}
                    placeholder="Add diagnostic notes or operator comment..."
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    disabled={!newCommentContent.trim() || addCommentMutation.isPending}
                    onClick={() => addCommentMutation.mutate({ id: selectedTicket.id, comment: newCommentContent.trim() })}
                    className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>Post</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Open Ticket Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-[#0f172a] border border-slate-800 rounded-2xl max-w-lg w-full shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <LifeBuoy className="h-5 w-5 text-blue-500" />
                Open Support Ticket
              </h3>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmitCreate)} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Subscriber (Optional)</label>
                <select
                  {...register('customerId')}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">General / Network Infrastructure Issue</option>
                  {customersData?.items?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.customerCode}) - {c.mobile}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Category</label>
                  <select
                    {...register('category')}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="FIBER_CUT">Fiber Cut (LOS)</option>
                    <option value="SLOW_SPEED">Slow Speed</option>
                    <option value="ROUTER_OFFLINE">Router Offline</option>
                    <option value="AUTH_FAILURE">PPPoE Auth Failure</option>
                    <option value="BILLING_ISSUE">Billing Issue</option>
                    <option value="TECHNICAL">Technical Fault</option>
                    <option value="GENERAL">General</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Priority</label>
                  <select
                    {...register('priority')}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                    <option value="URGENT">URGENT</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Subject / Issue Title *</label>
                <input
                  type="text"
                  required
                  {...register('title')}
                  placeholder="e.g. Red Optical light blinking on ONT"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Description *</label>
                <textarea
                  rows={3}
                  required
                  {...register('description')}
                  placeholder="Detail subscriber symptom, optical power readings, or router logs..."
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Assigned Staff / Tech</label>
                <input
                  type="text"
                  {...register('assignedTo')}
                  placeholder="Field Technician name"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-700 text-xs text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white shadow-lg shadow-blue-600/30 disabled:opacity-50"
                >
                  {createMutation.isPending ? 'Opening Ticket...' : 'Open Ticket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
