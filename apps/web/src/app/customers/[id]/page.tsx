'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Users,
  Wifi,
  Receipt,
  History,
  IndianRupee,
  RefreshCw,
  X,
  LifeBuoy,
  Cpu,
  FileCheck2,
  Zap,
  Activity,
  BarChart3,
  Globe,
  Radio,
  Clock,
  AlertCircle,
  CreditCard,
  FileDown,
  Download,
  Eye,
  CheckCircle2,
} from 'lucide-react';
import { apiFetch, downloadInvoicePdf } from '../../../lib/api';
import { ConfirmationModal } from '../../../components/ConfirmationModal';
import { CardSkeleton } from '../../../components/LoadingSkeleton';
import { useToast } from '../../../components/Toast';
import { CustomerStatus } from '@isp-crm/shared';

// Modular Customer Profile Components
import { CustomerHeader } from '../../../components/customers/CustomerHeader';
import { CustomerStatusMetrics } from '../../../components/customers/CustomerStatusMetrics';
import { CustomerAlertsBanner } from '../../../components/customers/CustomerAlertsBanner';
import { CustomerConnectionCard } from '../../../components/customers/CustomerConnectionCard';
import { CustomerUsageCard } from '../../../components/customers/CustomerUsageCard';
import { CustomerMacCard } from '../../../components/customers/CustomerMacCard';
import { CustomerPackageCard } from '../../../components/customers/CustomerPackageCard';
import { CustomerPackageHistoryCard } from '../../../components/customers/CustomerPackageHistoryCard';
import { CustomerBillingCard } from '../../../components/customers/CustomerBillingCard';
import { CustomerSubscriberInfoCard } from '../../../components/customers/CustomerSubscriberInfoCard';
import { CustomerRecentActivity } from '../../../components/customers/CustomerRecentActivity';
import { CustomerInvoicesTab } from '../../../components/customers/CustomerInvoicesTab';
import { CustomerPaymentsTab } from '../../../components/customers/CustomerPaymentsTab';
import { CustomerTicketsTab } from '../../../components/customers/CustomerTicketsTab';
import { CustomerKycCard } from '../../../components/customers/CustomerKycCard';
import { CustomerCpeCard } from '../../../components/customers/CustomerCpeCard';
import { CustomerAuditCard } from '../../../components/customers/CustomerAuditCard';

// Modals & Menus
import { CustomerEditModal } from '../../../components/customers/CustomerEditModal';
import { CustomerMoreActionsMenu } from '../../../components/customers/CustomerMoreActionsMenu';
import { CustomerAccessRequestsModal } from '../../../components/customers/CustomerAccessRequestsModal';
import { MacManagementModal } from '../../../components/customers/MacManagementModal';
import { ChangePasswordModal } from '../../../components/customers/ChangePasswordModal';
import { SpeedOverrideModal } from '../../../components/customers/SpeedOverrideModal';
import { CafPrintModal } from '../../../components/customers/CafPrintModal';
import { DirectMessageModal } from '../../../components/customers/DirectMessageModal';
import { CustomerAlertsModal, OperationalAlert } from '../../../components/customers/CustomerAlertsModal';

interface CustomerDetails {
  id: string;
  organizationId: string;
  customerCode: string;
  name: string;
  mobile: string;
  phone?: string | null;
  email?: string | null;
  alternatePhone?: string | null;
  address: string;
  installationAddress?: string | null;
  area?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  zoneId?: string | null;
  nodeId?: string | null;
  zone?: { id: string; name: string; description?: string } | null;
  node?: { id: string; name: string; description?: string } | null;
  aadhaarNumber?: string | null;
  gstin?: string | null;
  username: string;
  pppoeUsername?: string | null;
  pppoePassword?: string;
  staticIp?: string | null;
  macAddress?: string | null;
  status: CustomerStatus;
  installationDate?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  subscriptions?: Array<{
    id: string;
    status: string;
    startDate: string;
    endDate: string;
    price: number | string;
    billingCycle: string;
    autoRenew: boolean;
    gracePeriodDays: number;
    plan: {
      id: string;
      name: string;
      code: string;
      downloadSpeedMbps?: number;
      uploadSpeedMbps?: number;
      price: number | string;
      rateLimitString?: string;
      gstRatePercent?: number;
      validityDays?: number;
      durationDays?: number;
    };
  }>;
  invoices?: Array<{
    id: string;
    invoiceNumber: string;
    invoiceDate: string;
    dueDate: string;
    totalAmount: string | number;
    paidAmount: string | number;
    status: string;
    subtotal?: string | number;
    cgst?: string | number;
    sgst?: string | number;
    igst?: string | number;
  }>;
  payments?: Array<{
    id: string;
    receiptNumber: string;
    amount: string | number;
    paymentMethod: string;
    status: string;
    paidAt: string;
    transactionRef?: string | null;
    invoiceId?: string | null;
  }>;
  auditLogs?: Array<{
    id: string;
    action: string;
    entityType: string;
    details?: any;
    createdAt: string;
    adminUser?: {
      id: string;
      name: string;
      email: string;
    } | null;
  }>;
}

type TabKey =
  | 'overview'
  | 'connection'
  | 'usage'
  | 'subscriptions'
  | 'billing'
  | 'invoices'
  | 'payments'
  | 'tickets'
  | 'kyc'
  | 'cpe'
  | 'audit'
  | 'details';

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const customerId = params?.id as string;

  // Default tab is OVERVIEW
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  // Modals visibility state
  const [isMoreActionsOpen, setIsMoreActionsOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSuspendConfirmOpen, setIsSuspendConfirmOpen] = useState(false);
  const [isReactivateConfirmOpen, setIsReactivateConfirmOpen] = useState(false);
  const [isDisconnectConfirmOpen, setIsDisconnectConfirmOpen] = useState(false);
  const [isMacModalOpen, setIsMacModalOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isSpeedOverrideModalOpen, setIsSpeedOverrideModalOpen] = useState(false);
  const [isAccessRequestsModalOpen, setIsAccessRequestsModalOpen] = useState(false);
  const [isCafModalOpen, setIsCafModalOpen] = useState(false);
  const [isDirectMessageModalOpen, setIsDirectMessageModalOpen] = useState(false);
  const [isAlertsModalOpen, setIsAlertsModalOpen] = useState(false);
  const [isResetMacConfirmOpen, setIsResetMacConfirmOpen] = useState(false);
  const [isRenewConfirmOpen, setIsRenewConfirmOpen] = useState(false);
  const [isChangePlanModalOpen, setIsChangePlanModalOpen] = useState(false);
  const [isCancelSubConfirmOpen, setIsCancelSubConfirmOpen] = useState(false);
  const [directMessageChannel, setDirectMessageChannel] = useState<'whatsapp' | 'email'>('whatsapp');
  const [selectedNewPlanId, setSelectedNewPlanId] = useState('');
  const [autoGeneratedInvoice, setAutoGeneratedInvoice] = useState<any | null>(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const handleDownloadPdf = async (invoiceId: string, invoiceNumber: string) => {
    try {
      setIsDownloadingPdf(true);
      await downloadInvoicePdf(invoiceId, invoiceNumber);
      toast.success(`Invoice ${invoiceNumber} downloaded successfully`, 'PDF Downloaded');
    } catch (err: any) {
      toast.error(err.message || 'Failed to download PDF', 'Download Error');
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  // 1. Fetch Detailed Customer Profile
  const {
    data: customer,
    isLoading,
    isError,
    refetch: refetchCustomer,
  } = useQuery<CustomerDetails>({
    queryKey: ['customer-detail', customerId],
    queryFn: () => apiFetch<CustomerDetails>(`/customers/${customerId}`),
    enabled: !!customerId,
  });

  // 2. Fetch Real RADIUS Live Connection Telemetry
  const {
    data: connection,
    isLoading: isConnectionLoading,
    refetch: refetchConnection,
  } = useQuery<any>({
    queryKey: ['customer-connection', customerId],
    queryFn: () => apiFetch<any>(`/customers/${customerId}/connection`),
    enabled: !!customerId,
    staleTime: 10_000,
  });

  // 3. Fetch Real RADIUS radacct Data Usage (Today, Month, Lifetime)
  const {
    data: usage,
    isLoading: isUsageLoading,
    refetch: refetchUsage,
  } = useQuery<any>({
    queryKey: ['customer-usage', customerId],
    queryFn: () => apiFetch<any>(`/customers/${customerId}/usage`),
    enabled: !!customerId,
    staleTime: 30_000,
  });

  // 4. Fetch Recent RADIUS Authentication Attempts (radpostauth)
  const {
    data: accessRequests = [],
    isLoading: isAccessRequestsLoading,
    refetch: refetchAccessRequests,
  } = useQuery<any[]>({
    queryKey: ['customer-access-requests', customerId],
    queryFn: () => apiFetch<any[]>(`/customers/${customerId}/access-requests`),
    enabled: !!customerId,
  });

  // 5. Fetch Customer Helpdesk Tickets
  const { data: customerTickets = [] } = useQuery<any[]>({
    queryKey: ['customer-tickets', customerId],
    queryFn: () => apiFetch<any[]>(`/tickets?customerId=${customerId}`),
    enabled: !!customerId,
  });

  // 6. Fetch Available Plans (for plan assignment/change)
  const { data: plans = [] } = useQuery<any[]>({
    queryKey: ['plans'],
    queryFn: () => apiFetch<any[]>('/plans'),
  });

  // Active Internet Subscription
  const activeSubscription = useMemo(() => {
    if (!customer?.subscriptions || customer.subscriptions.length === 0) return undefined;
    return (
      customer.subscriptions.find((s) => s.status === 'ACTIVE') ||
      customer.subscriptions[0]
    );
  }, [customer?.subscriptions]);

  // Derived Operational Alerts (Real data only)
  const operationalAlerts = useMemo<OperationalAlert[]>(() => {
    if (!customer) return [];
    const alerts: OperationalAlert[] = [];

    // 1. Account suspended
    if (customer.status === CustomerStatus.SUSPENDED) {
      alerts.push({
        id: 'suspended',
        type: 'danger',
        title: 'Subscriber Account Suspended',
        description: 'Internet service authentication is currently disabled by administrative order.',
        actionLabel: 'Reactivate Account',
        onAction: () => setIsReactivateConfirmOpen(true),
      });
    }

    // 2. Overdue Invoices
    const overdueInvoices = customer.invoices?.filter((inv) => {
      if (inv.status === 'PAID' || inv.status === 'CANCELLED') return false;
      return new Date(inv.dueDate) < new Date();
    });

    if (overdueInvoices && overdueInvoices.length > 0) {
      alerts.push({
        id: 'overdue-invoices',
        type: 'danger',
        title: `${overdueInvoices.length} Overdue Tax Invoice${overdueInvoices.length === 1 ? '' : 's'}`,
        description: 'Payment has not been recorded past the statutory due date.',
        actionLabel: 'View Invoices',
        onAction: () => setActiveTab('invoices'),
      });
    }

    // 3. Subscription Expiring or Expired
    if (activeSubscription?.endDate) {
      const expiry = new Date(activeSubscription.endDate);
      const now = new Date();
      const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        alerts.push({
          id: 'sub-expired',
          type: 'danger',
          title: 'Internet Package Expired',
          description: `Validity expired on ${expiry.toLocaleDateString('en-GB')}. Subscriber requires renewal.`,
          actionLabel: 'Renew Package',
          onAction: () => setIsRenewConfirmOpen(true),
        });
      } else if (diffDays <= 5) {
        alerts.push({
          id: 'sub-expiring',
          type: 'warning',
          title: `Package Expiring in ${diffDays} Day${diffDays === 1 ? '' : 's'}`,
          description: `Subscription ends on ${expiry.toLocaleDateString('en-GB')}. Renew before validity ends.`,
          actionLabel: 'Renew Package',
          onAction: () => setIsRenewConfirmOpen(true),
        });
      }
    }

    // 4. MAC Mismatch Telemetry
    if (connection?.isOnline && customer.macAddress && !connection.isMacMatch) {
      alerts.push({
        id: 'mac-mismatch',
        type: 'danger',
        title: 'Authorized vs Observed MAC Mismatch',
        description: `Calling-Station-Id (${connection.callingStationId}) does not match authorized MAC (${customer.macAddress}).`,
        actionLabel: 'Update Authorized MAC',
        onAction: () => setIsMacModalOpen(true),
      });
    }

    // 5. MAC Binding Status
    if (!customer.macAddress) {
      alerts.push({
        id: 'no-mac-bound',
        type: 'warning',
        title: 'No Authorized MAC Restriction Bound',
        description: 'Account is unlocked. Any CPE equipment with credentials can authenticate.',
        actionLabel: 'Bind Authorized MAC',
        onAction: () => setIsMacModalOpen(true),
      });
    }

    // 6. Recent Authentication Rejects
    const recentRejects = accessRequests.filter((ar) => ar.reply === 'Access-Reject');
    if (recentRejects.length > 0) {
      alerts.push({
        id: 'recent-rejects',
        type: 'warning',
        title: `${recentRejects.length} RADIUS Access-Reject Event${recentRejects.length === 1 ? '' : 's'}`,
        description: 'Recent dial-in attempts were rejected. Verify password or MAC binding.',
        actionLabel: 'View RADIUS History',
        onAction: () => setIsAccessRequestsModalOpen(true),
      });
    }

    return alerts;
  }, [customer, connection, activeSubscription, accessRequests]);

  // Calculation preview for the enhanced Renewal Confirmation Modal
  const renewalPreview = useMemo(() => {
    if (!activeSubscription) return null;
    const now = new Date();
    const currentEnd = activeSubscription.endDate ? new Date(activeSubscription.endDate) : null;
    const startDate = currentEnd && currentEnd > now ? currentEnd : now;
    const validityDays = activeSubscription.plan?.validityDays || 30;
    const endDate = new Date(startDate.getTime() + validityDays * 24 * 60 * 60 * 1000);
    const basePrice = Number(activeSubscription.price || activeSubscription.plan?.price || 0);
    const gstRatePercent = activeSubscription.plan?.gstRatePercent !== undefined ? Number(activeSubscription.plan.gstRatePercent) : 18.0;
    const gstAmount = Math.round((basePrice * (gstRatePercent / 100)) * 100) / 100;
    const totalAmount = basePrice + gstAmount;

    return {
      startDate,
      endDate,
      validityDays,
      basePrice,
      gstRatePercent,
      gstAmount,
      totalAmount,
    };
  }, [activeSubscription]);

  // --- MUTATIONS ---

  // 1. Update Profile Mutation
  const updateMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch(`/customers/${customerId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: (updatedCust: any, variables: any) => {
      let toastMsg = 'Subscriber profile updated successfully';
      if (variables?.username && variables.username !== customer?.username) {
        toastMsg += '. PPPoE username migrated.';
      }
      if (variables?.pppoePassword) {
        toastMsg += '. PPPoE credentials synchronized.';
      }
      if (variables?.macAddress !== undefined) {
        toastMsg += '. MAC restriction updated.';
      }
      toast.success(toastMsg, 'Profile Saved');
      setIsEditModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['customer-detail', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer-connection', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to update subscriber profile', 'Update Failed');
    },
  });

  // 2. Change / Reset MAC Mutation
  const changeMacMutation = useMutation({
    mutationFn: (mac: string | null) =>
      apiFetch(`/customers/${customerId}`, {
        method: 'PATCH',
        body: JSON.stringify({ macAddress: mac }),
      }),
    onSuccess: (_, mac) => {
      if (mac) {
        toast.success(`Authorized MAC set to ${mac}. FreeRADIUS Calling-Station-Id enforced.`, 'MAC Bound');
      } else {
        toast.success('Authorized MAC restriction removed. Any hardware may dial in.', 'MAC Reset');
      }
      setIsMacModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['customer-detail', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer-connection', customerId] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to update MAC address', 'MAC Update Failed');
    },
  });

  // 2b. Reset MAC Mutation (Auto-learn next device MAC)
  const resetMacMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/customers/${customerId}/reset-mac`, {
        method: 'POST',
      }),
    onSuccess: () => {
      toast.success(
        'Old MAC removed. The next successful PPPoE login will automatically register its device MAC.',
        'MAC Reset Initiated'
      );
      setIsResetMacConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ['customer-detail', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer-connection', customerId] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to reset authorized MAC', 'Reset Failed');
      setIsResetMacConfirmOpen(false);
    },
  });

  // 3. Change PPPoE Password Mutation
  const changePasswordMutation = useMutation({
    mutationFn: (pppoePassword: string) =>
      apiFetch(`/customers/${customerId}`, {
        method: 'PATCH',
        body: JSON.stringify({ pppoePassword }),
      }),
    onSuccess: () => {
      toast.success('PPPoE password updated and synchronized with radcheck.', 'Password Changed');
      setIsPasswordModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['customer-detail', customerId] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to update PPPoE password', 'Password Update Failed');
    },
  });

  // 4. Bandwidth Speed Override Mutation
  const overrideSpeedMutation = useMutation({
    mutationFn: ({ downloadMbps, uploadMbps }: { downloadMbps: number; uploadMbps: number }) =>
      apiFetch(`/customers/${customerId}/override-speed`, {
        method: 'POST',
        body: JSON.stringify({ downloadMbps, uploadMbps }),
      }),
    onSuccess: (res: any) => {
      toast.success(
        res?.message || 'Speed override applied and RFC 3576 CoA dispatched.',
        'Bandwidth Adjusted'
      );
      setIsSpeedOverrideModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['customer-connection', customerId] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to override bandwidth speed', 'Speed Override Failed');
    },
  });

  // 5. Suspend Subscriber Mutation
  const suspendMutation = useMutation({
    mutationFn: () => apiFetch(`/customers/${customerId}/suspend`, { method: 'POST' }),
    onSuccess: () => {
      toast.success(`Subscriber ${customer?.name} suspended and session dropped`, 'Customer Suspended');
      setIsSuspendConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ['customer-detail', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer-connection', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to suspend subscriber', 'Suspension Failed');
      setIsSuspendConfirmOpen(false);
    },
  });

  // 6. Reactivate Subscriber Mutation
  const reactivateMutation = useMutation({
    mutationFn: () => apiFetch(`/customers/${customerId}/reactivate`, { method: 'POST' }),
    onSuccess: () => {
      toast.success(`Subscriber ${customer?.name} reactivated with restored bandwidth`, 'Customer Reactivated');
      setIsReactivateConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ['customer-detail', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer-connection', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to reactivate subscriber', 'Reactivation Failed');
      setIsReactivateConfirmOpen(false);
    },
  });

  // 7. Force Disconnect Session Mutation (PoD)
  const disconnectMutation = useMutation({
    mutationFn: () => apiFetch(`/customers/${customerId}/disconnect`, { method: 'POST' }),
    onSuccess: () => {
      toast.success(`RFC 3576 Disconnect-Request (PoD) sent for ${customer?.username}`, 'Session Terminated');
      setIsDisconnectConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ['customer-connection', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer-usage', customerId] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to disconnect active session', 'Disconnect Failed');
      setIsDisconnectConfirmOpen(false);
    },
  });

  // 8. Renew Package Mutation
  const renewPackageMutation = useMutation({
    mutationFn: (subId: string) => apiFetch<any>(`/subscriptions/${subId}/renew`, { method: 'POST' }),
    onSuccess: (res: any) => {
      const invMsg = res?.invoice?.invoiceNumber ? ` (Invoice #${res.invoice.invoiceNumber})` : '';
      toast.success(`Subscription plan validity renewed successfully.${invMsg}`, 'Package Renewed');
      setIsRenewConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ['customer-detail', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer-connection', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer-invoices', customerId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      if (res?.invoice) {
        setAutoGeneratedInvoice(res.invoice);
      }
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to renew subscription', 'Renewal Failed');
      setIsRenewConfirmOpen(false);
    },
  });

  // 9. Change Package / Upgrade Mutation
  const changePlanMutation = useMutation({
    mutationFn: ({ subId, planId }: { subId: string; planId: string }) =>
      apiFetch<any>(`/subscriptions/${subId}/upgrade`, {
        method: 'POST',
        body: JSON.stringify({ planId, reason: 'Operator profile upgrade' }),
      }),
    onSuccess: (res: any) => {
      const invMsg = res?.invoice?.invoiceNumber ? ` (Invoice #${res.invoice.invoiceNumber})` : '';
      toast.success(`Internet package changed successfully.${invMsg}`, 'Plan Changed');
      setIsChangePlanModalOpen(false);
      setSelectedNewPlanId('');
      queryClient.invalidateQueries({ queryKey: ['customer-detail', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer-connection', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer-invoices', customerId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      if (res?.invoice) {
        setAutoGeneratedInvoice(res.invoice);
      }
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to upgrade internet package', 'Change Plan Failed');
    },
  });

  // 9b. Assign New Package Mutation (First-time assignment)
  const assignPlanMutation = useMutation({
    mutationFn: ({ planId }: { planId: string }) =>
      apiFetch<any>('/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          planId,
          startDate: new Date().toISOString(),
        }),
      }),
    onSuccess: (res: any) => {
      const invMsg = res?.invoice?.invoiceNumber ? ` (Invoice #${res.invoice.invoiceNumber})` : '';
      toast.success(`Internet package assigned and subscription activated.${invMsg}`, 'Plan Assigned');
      setIsChangePlanModalOpen(false);
      setSelectedNewPlanId('');
      queryClient.invalidateQueries({ queryKey: ['customer-detail', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer-connection', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer-invoices', customerId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      if (res?.invoice) {
        setAutoGeneratedInvoice(res.invoice);
      }
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to assign internet package', 'Assignment Failed');
    },
  });

  // 10. Cancel Package Mutation
  const cancelPackageMutation = useMutation({
    mutationFn: (subId: string) =>
      apiFetch(`/subscriptions/${subId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Operator requested cancellation' }),
      }),
    onSuccess: () => {
      toast.success('Subscription cancelled and dial-in restricted.', 'Package Cancelled');
      setIsCancelSubConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ['customer-detail', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer-connection', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to cancel subscription', 'Cancellation Failed');
      setIsCancelSubConfirmOpen(false);
    },
  });

  // Helper Actions
  const handleResetMac = () => {
    setIsResetMacConfirmOpen(true);
  };

  const handleOpenRenew = () => {
    if (!activeSubscription) {
      toast.error('No active subscription found to renew.', 'Renewal Unavailable');
      return;
    }
    setIsRenewConfirmOpen(true);
  };

  const handleGeneratePaymentLink = async () => {
    if (!customer) return;
    const url = `${window.location.origin}/invoices?customerId=${customer.id}`;

    let copied = false;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        // Fallback to execCommand below
      }
    }
    if (!copied && typeof document !== 'undefined') {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = url;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        copied = document.execCommand('copy');
        document.body.removeChild(textArea);
      } catch {
        copied = false;
      }
    }

    if (copied) {
      toast.success(
        'External payment gateway (RAZORPAY_KEY_ID) not configured; copied customer invoice settlement URL to clipboard.',
        'Payment Link Copied'
      );
    } else {
      toast.error(
        `Clipboard unavailable. Customer payment URL: ${url}`,
        'Copy Link Failed'
      );
    }
  };

  const handleWhatsApp = () => {
    setDirectMessageChannel('whatsapp');
    setIsDirectMessageModalOpen(true);
  };

  const handleEmail = () => {
    setDirectMessageChannel('email');
    setIsDirectMessageModalOpen(true);
  };

  // Loading State
  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1440px] mx-auto pb-12">
        <div className="flex items-center gap-3">
          <Link
            href="/customers"
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="h-7 w-56 bg-slate-800 rounded-xl animate-pulse" />
        </div>
        <CardSkeleton count={3} />
      </div>
    );
  }

  // Error State
  if (isError || !customer) {
    return (
      <div className="space-y-6 max-w-[1440px] mx-auto pb-12">
        <Link
          href="/customers"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Subscribers</span>
        </Link>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center shadow-xl">
          <AlertCircle className="h-10 w-10 text-rose-400 mx-auto mb-3" />
          <h2 className="text-base font-semibold text-slate-100 mb-1">Subscriber Not Found</h2>
          <p className="text-xs text-slate-400 max-w-md mx-auto mb-6 leading-relaxed">
            The requested customer profile could not be loaded or may belong to another organization.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => refetchCustomer()}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold"
            >
              Retry
            </button>
            <Link
              href="/customers"
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
            >
              Subscriber Directory
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1440px] mx-auto pb-16 overflow-x-hidden">
      {/* 1. SUBSCRIBER IDENTITY HEADER */}
      <CustomerHeader
        customer={customer}
        connection={connection}
        currentSubscription={activeSubscription}
        onDisconnect={() => setIsDisconnectConfirmOpen(true)}
        onSuspend={() => setIsSuspendConfirmOpen(true)}
        onReactivate={() => setIsReactivateConfirmOpen(true)}
        onRenewPackage={handleOpenRenew}
        onRecordPayment={() => router.push(`/payments?customerId=${customer.id}`)}
        onOpenMoreActions={() => setIsMoreActionsOpen(true)}
      />

      {/* 2. 4-CARD SUBSCRIBER STATUS SUMMARY */}
      <CustomerStatusMetrics
        customer={customer}
        connection={connection}
        subscription={activeSubscription}
      />

      {/* SUCCESSFUL AUTOMATIC INVOICE GENERATED BANNER */}
      {autoGeneratedInvoice && (
        <div className="bg-gradient-to-r from-emerald-950/80 via-slate-900 to-slate-900 border border-emerald-500/40 rounded-2xl p-4 sm:p-5 shadow-xl animate-fadeIn flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0 text-emerald-400">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/30">
                  Tax Invoice Auto-Generated
                </span>
                <span className="font-mono text-xs font-bold text-slate-200">
                  #{autoGeneratedInvoice.invoiceNumber}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1">
                New service validity has been activated. Official GST Tax Invoice for{' '}
                <span className="font-bold text-emerald-400">
                  ₹{Number(autoGeneratedInvoice.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>{' '}
                was generated.
                {autoGeneratedInvoice.servicePeriodStart && autoGeneratedInvoice.servicePeriodEnd && (
                  <span className="ml-1 text-slate-400">
                    Period:{' '}
                    <strong className="text-slate-200">
                      {new Date(autoGeneratedInvoice.servicePeriodStart).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}{' '}
                      –{' '}
                      {new Date(autoGeneratedInvoice.servicePeriodEnd).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </strong>
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto shrink-0 justify-end flex-wrap">
            <button
              type="button"
              onClick={() => {
                setActiveTab('invoices');
              }}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
            >
              View Invoices
            </button>
            <button
              type="button"
              disabled={isDownloadingPdf}
              onClick={() => handleDownloadPdf(autoGeneratedInvoice.id, autoGeneratedInvoice.invoiceNumber)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/20 transition-all disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{isDownloadingPdf ? 'Downloading...' : 'Download PDF'}</span>
            </button>
            <button
              type="button"
              onClick={() => router.push(`/payments?customerId=${customer.id}&invoiceId=${autoGeneratedInvoice.id}`)}
              className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/20 transition-all"
            >
              Record Payment
            </button>
            <button
              type="button"
              onClick={() => setAutoGeneratedInvoice(null)}
              className="p-2 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800/80"
              title="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* 3. OPERATIONAL ALERTS BANNER (High-priority attention) */}
      <CustomerAlertsBanner
        alerts={operationalAlerts}
        onOpenAllAlerts={() => setIsAlertsModalOpen(true)}
      />

      {/* 4. MAIN NAVIGATION TABS */}
      <div className="space-y-5">
        {/* Scrollable Tab Navigation Bar */}
        <div className="flex items-center gap-1.5 border-b border-slate-800 pb-2 overflow-x-auto scrollbar-none w-full min-w-0">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all shrink-0 min-h-[40px] ${
              activeTab === 'overview'
                ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Activity className="h-3.5 w-3.5" />
            <span>Overview</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('connection')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all shrink-0 min-h-[40px] ${
              activeTab === 'connection'
                ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Radio className="h-3.5 w-3.5" />
            <span>Connection & RADIUS</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('usage')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all shrink-0 min-h-[40px] ${
              activeTab === 'usage'
                ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            <span>Data Usage</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('subscriptions')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all shrink-0 min-h-[40px] ${
              activeTab === 'subscriptions'
                ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Wifi className="h-3.5 w-3.5" />
            <span>Subscription History ({customer.subscriptions?.length || 0})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('invoices')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all shrink-0 min-h-[40px] ${
              activeTab === 'invoices'
                ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Receipt className="h-3.5 w-3.5" />
            <span>Invoices ({customer.invoices?.length || 0})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('payments')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all shrink-0 min-h-[40px] ${
              activeTab === 'payments'
                ? 'bg-emerald-600/15 text-emerald-400 border border-emerald-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <IndianRupee className="h-3.5 w-3.5" />
            <span>Payments ({customer.payments?.length || 0})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('tickets')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all shrink-0 min-h-[40px] ${
              activeTab === 'tickets'
                ? 'bg-amber-600/15 text-amber-400 border border-amber-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <LifeBuoy className="h-3.5 w-3.5" />
            <span>Tickets ({customerTickets.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('kyc')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all shrink-0 min-h-[40px] ${
              activeTab === 'kyc'
                ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <FileCheck2 className="h-3.5 w-3.5" />
            <span>KYC Compliance</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('cpe')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all shrink-0 min-h-[40px] ${
              activeTab === 'cpe'
                ? 'bg-purple-600/15 text-purple-400 border border-purple-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Cpu className="h-3.5 w-3.5" />
            <span>CPE & Network</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('audit')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all shrink-0 min-h-[40px] ${
              activeTab === 'audit'
                ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <History className="h-3.5 w-3.5" />
            <span>Audit Trail ({customer.auditLogs?.length || 0})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('details')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all shrink-0 min-h-[40px] ${
              activeTab === 'details'
                ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            <span>Full Profile</span>
          </button>
        </div>

        {/* 5. TAB CONTENT AREAS */}
        <div className="min-w-0">
          {/* TAB: OVERVIEW (Home Screen) */}
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Main Column (~60-65%): Live Connection + Package + Usage */}
              <div className="lg:col-span-7 xl:col-span-8 space-y-6 min-w-0">
                <CustomerConnectionCard
                  connection={connection}
                  isLoading={isConnectionLoading}
                  onRefresh={() => refetchConnection()}
                  onViewAccessRequests={() => setIsAccessRequestsModalOpen(true)}
                />

                <CustomerPackageCard
                  subscription={activeSubscription}
                  onRenew={handleOpenRenew}
                  onChangePlan={() => setIsChangePlanModalOpen(true)}
                  onOverrideSpeed={() => setIsSpeedOverrideModalOpen(true)}
                />

                <CustomerUsageCard
                  usage={usage}
                  isLoading={isUsageLoading}
                  onRefresh={() => refetchUsage()}
                />
              </div>

              {/* Sidebar Column (~35-40%): Billing + MAC + Contact & Location + Recent Activity */}
              <div className="lg:col-span-5 xl:col-span-4 space-y-6 min-w-0">
                <CustomerBillingCard
                  invoices={customer.invoices || []}
                  payments={customer.payments || []}
                  onCreateInvoice={() => router.push(`/invoices?customerId=${customer.id}`)}
                  onRecordPayment={() => router.push(`/payments?customerId=${customer.id}`)}
                  onGeneratePaymentLink={handleGeneratePaymentLink}
                />

                <CustomerMacCard
                  customer={customer}
                  connection={connection}
                  onChangeMac={() => setIsMacModalOpen(true)}
                  onResetMac={handleResetMac}
                  isResetting={resetMacMutation.isPending}
                />

                <CustomerSubscriberInfoCard
                  customer={customer}
                  onEditProfile={() => setIsEditModalOpen(true)}
                />

                <CustomerRecentActivity
                  auditLogs={customer.auditLogs || []}
                  accessRequests={accessRequests}
                  payments={customer.payments || []}
                />
              </div>
            </div>
          )}

          {/* TAB: CONNECTION */}
          {activeTab === 'connection' && (
            <div className="space-y-6">
              <CustomerConnectionCard
                connection={connection}
                isLoading={isConnectionLoading}
                onRefresh={() => refetchConnection()}
                onViewAccessRequests={() => setIsAccessRequestsModalOpen(true)}
              />

              {/* Dedicated RADIUS Access Requests Table */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                      <Radio className="h-4 w-4 text-blue-400" />
                      <span>Recent RADIUS Authentication Attempts (radpostauth)</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Dial-in audit records logged directly by FreeRADIUS.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => refetchAccessRequests()}
                    disabled={isAccessRequestsLoading}
                    className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isAccessRequestsLoading ? 'animate-spin text-blue-400' : ''}`} />
                  </button>
                </div>

                {accessRequests.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-xs">
                    No authentication attempts recorded in radpostauth.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                          <th className="pb-3 px-3">Date & Time</th>
                          <th className="pb-3 px-3">Username</th>
                          <th className="pb-3 px-3">RADIUS Result</th>
                          <th className="pb-3 px-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {accessRequests.map((req) => (
                          <tr key={req.id} className="hover:bg-slate-800/30">
                            <td className="py-3 px-3 font-mono text-slate-300">
                              {new Date(req.authdate).toLocaleString()}
                            </td>
                            <td className="py-3 px-3 font-mono text-slate-200">
                              {req.username}
                            </td>
                            <td className="py-3 px-3">
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                  req.reply === 'Access-Accept'
                                    ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-rose-950/80 text-rose-400 border border-rose-500/30'
                                }`}
                              >
                                {req.reply}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-slate-400">
                              {req.reply === 'Access-Accept'
                                ? 'Authenticated & Granted'
                                : 'Credentials / MAC Rejected'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB: USAGE */}
          {activeTab === 'usage' && (
            <div className="space-y-6">
              <CustomerUsageCard
                usage={usage}
                isLoading={isUsageLoading}
                onRefresh={() => refetchUsage()}
              />
            </div>
          )}

          {/* TAB: SUBSCRIPTIONS */}
          {activeTab === 'subscriptions' && (
            <div className="space-y-6">
              <CustomerPackageCard
                subscription={activeSubscription}
                onRenew={handleOpenRenew}
                onChangePlan={() => setIsChangePlanModalOpen(true)}
                onOverrideSpeed={() => setIsSpeedOverrideModalOpen(true)}
              />
              <CustomerPackageHistoryCard subscriptions={customer.subscriptions || []} />
            </div>
          )}

          {/* TAB: BILLING */}
          {activeTab === 'billing' && (
            <div className="space-y-6">
              <CustomerBillingCard
                invoices={customer.invoices || []}
                payments={customer.payments || []}
                onCreateInvoice={() => router.push(`/invoices?customerId=${customer.id}`)}
                onRecordPayment={() => router.push(`/payments?customerId=${customer.id}`)}
                onGeneratePaymentLink={handleGeneratePaymentLink}
              />
              <CustomerInvoicesTab
                invoices={customer.invoices || []}
                onCreateInvoice={() => router.push(`/invoices?customerId=${customer.id}`)}
                onRecordPayment={(inv) =>
                  router.push(`/payments?customerId=${customer.id}&invoiceId=${inv?.id || ''}`)
                }
              />
            </div>
          )}

          {/* TAB: INVOICES */}
          {activeTab === 'invoices' && (
            <CustomerInvoicesTab
              invoices={customer.invoices || []}
              onCreateInvoice={() => router.push(`/invoices?customerId=${customer.id}`)}
              onRecordPayment={(inv) =>
                router.push(`/payments?customerId=${customer.id}&invoiceId=${inv?.id || ''}`)
              }
            />
          )}

          {/* TAB: PAYMENTS */}
          {activeTab === 'payments' && (
            <CustomerPaymentsTab
              payments={customer.payments || []}
              onRecordPayment={() => router.push(`/payments?customerId=${customer.id}`)}
            />
          )}

          {/* TAB: TICKETS */}
          {activeTab === 'tickets' && (
            <CustomerTicketsTab
              tickets={customerTickets || []}
              onOpenNewTicket={() => router.push(`/tickets?customerId=${customer.id}`)}
            />
          )}

          {/* TAB: KYC */}
          {activeTab === 'kyc' && (
            <CustomerKycCard
              customer={customer}
              onGenerateCaf={() => setIsCafModalOpen(true)}
            />
          )}

          {/* TAB: CPE */}
          {activeTab === 'cpe' && (
            <CustomerCpeCard
              customer={customer}
              connection={connection}
              subscription={activeSubscription}
            />
          )}

          {/* TAB: AUDIT */}
          {activeTab === 'audit' && (
            <CustomerAuditCard auditLogs={customer.auditLogs || []} />
          )}

          {/* TAB: FULL DETAILS */}
          {activeTab === 'details' && (
            <CustomerSubscriberInfoCard
              customer={customer}
              onEditProfile={() => setIsEditModalOpen(true)}
            />
          )}
        </div>
      </div>

      {/* ============================================================ */}
      {/* MODALS & OPERATIONS MENUS                                    */}
      {/* ============================================================ */}

      {/* 1. Categorized More Actions Menu */}
      <CustomerMoreActionsMenu
        isOpen={isMoreActionsOpen}
        onClose={() => setIsMoreActionsOpen(false)}
        customer={customer}
        connection={connection}
        subscription={activeSubscription}
        onEditProfile={() => setIsEditModalOpen(true)}
        onDisconnect={() => setIsDisconnectConfirmOpen(true)}
        onSuspend={() => setIsSuspendConfirmOpen(true)}
        onReactivate={() => setIsReactivateConfirmOpen(true)}
        onChangeMac={() => setIsMacModalOpen(true)}
        onResetMac={handleResetMac}
        onChangePassword={() => setIsPasswordModalOpen(true)}
        onRenewPackage={handleOpenRenew}
        onChangePackage={() => setIsChangePlanModalOpen(true)}
        onOverrideSpeed={() => setIsSpeedOverrideModalOpen(true)}
        onGenerateCaf={() => setIsCafModalOpen(true)}
        onGeneratePaymentLink={handleGeneratePaymentLink}
        onDirectMessage={() => setIsDirectMessageModalOpen(true)}
        onWhatsApp={handleWhatsApp}
        onEmail={handleEmail}
        onRecordPayment={() => router.push(`/payments?customerId=${customer.id}`)}
        onCreateInvoice={() => router.push(`/invoices?customerId=${customer.id}&action=create`)}
        onAddTicket={() => router.push(`/tickets?customerId=${customer.id}&action=create`)}
        onViewAccessRequests={() => setIsAccessRequestsModalOpen(true)}
        onCancelSubscription={() => setIsCancelSubConfirmOpen(true)}
      />

      {/* 2. Enhanced Customer Master Data Edit Modal */}
      <CustomerEditModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        customer={customer}
        connection={connection}
        onSave={async (payload) => {
          await updateMutation.mutateAsync(payload);
        }}
        isLoading={updateMutation.isPending}
      />

      {/* 3. MAC Management Modal */}
      <MacManagementModal
        isOpen={isMacModalOpen}
        onClose={() => setIsMacModalOpen(false)}
        currentMac={customer.macAddress || null}
        onSave={async (mac) => {
          await changeMacMutation.mutateAsync(mac);
        }}
        isLoading={changeMacMutation.isPending}
      />

      {/* 4. Change PPPoE Password Modal */}
      <ChangePasswordModal
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
        username={customer.username || customer.pppoeUsername || customer.name}
        onSave={async (newPassword) => {
          await changePasswordMutation.mutateAsync(newPassword);
        }}
        isLoading={changePasswordMutation.isPending}
      />

      {/* 5. Bandwidth Speed Override Modal */}
      <SpeedOverrideModal
        isOpen={isSpeedOverrideModalOpen}
        onClose={() => setIsSpeedOverrideModalOpen(false)}
        currentDownload={activeSubscription?.plan?.downloadSpeedMbps || 50}
        currentUpload={activeSubscription?.plan?.uploadSpeedMbps || 50}
        onSave={async (downloadMbps, uploadMbps) => {
          await overrideSpeedMutation.mutateAsync({ downloadMbps, uploadMbps });
        }}
        isLoading={overrideSpeedMutation.isPending}
      />

      {/* 6. RADIUS Access Requests History Modal */}
      <CustomerAccessRequestsModal
        isOpen={isAccessRequestsModalOpen}
        onClose={() => setIsAccessRequestsModalOpen(false)}
        accessRequests={accessRequests}
        isLoading={isAccessRequestsLoading}
        onRefresh={() => refetchAccessRequests()}
        customerUsername={customer.username || customer.pppoeUsername || ''}
      />

      {/* 7. Customer Application Form (CAF) Modal */}
      <CafPrintModal
        isOpen={isCafModalOpen}
        onClose={() => setIsCafModalOpen(false)}
        customer={customer}
        subscription={activeSubscription}
      />

      {/* 8. Direct Message Modal */}
      <DirectMessageModal
        isOpen={isDirectMessageModalOpen}
        onClose={() => setIsDirectMessageModalOpen(false)}
        customer={customer}
        subscription={activeSubscription}
        initialChannel={directMessageChannel}
      />

      {/* 9. Operational Alerts Modal */}
      <CustomerAlertsModal
        isOpen={isAlertsModalOpen}
        onClose={() => setIsAlertsModalOpen(false)}
        alerts={operationalAlerts}
      />

      {/* 10. Change Package Modal */}
      {isChangePlanModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden my-auto">
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800 shrink-0 bg-slate-900">
              <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <Zap className="h-4 w-4 text-blue-400" />
                <span>Change Internet Package</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsChangePlanModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 min-h-[36px] min-w-[36px] flex items-center justify-center"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-4 text-xs overflow-y-auto flex-1">
              <div>
                <span className="text-slate-400 block mb-1">Current Package</span>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-semibold text-slate-200">
                  {activeSubscription?.plan?.name || 'No Active Plan'} (
                  {activeSubscription?.plan?.downloadSpeedMbps || 0} Mbps)
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1 font-medium">Select New Plan *</label>
                <select
                  value={selectedNewPlanId}
                  onChange={(e) => setSelectedNewPlanId(e.target.value)}
                  className="w-full min-h-[40px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 text-xs focus:outline-none focus:border-blue-500"
                >
                  <option value="">-- Choose Internet Plan --</option>
                  {plans.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.downloadSpeedMbps} Mbps / ₹{p.price})
                    </option>
                  ))}
                </select>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed bg-blue-950/30 border border-blue-800/40 p-3 rounded-xl">
                Switching package immediately updates FreeRADIUS Mikrotik-Rate-Limit attributes and
                triggers an RFC 3576 CoA bandwidth re-rate.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 p-4 border-t border-slate-800 bg-slate-900/95">
              <button
                type="button"
                onClick={() => setIsChangePlanModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!selectedNewPlanId || changePlanMutation.isPending || assignPlanMutation.isPending}
                onClick={() => {
                  if (activeSubscription?.id && selectedNewPlanId) {
                    changePlanMutation.mutate({
                      subId: activeSubscription.id,
                      planId: selectedNewPlanId,
                    });
                  } else if (selectedNewPlanId) {
                    assignPlanMutation.mutate({
                      planId: selectedNewPlanId,
                    });
                  }
                }}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/20 disabled:opacity-50 min-h-[38px]"
              >
                {(changePlanMutation.isPending || assignPlanMutation.isPending) && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                <span>{activeSubscription ? 'Apply Plan Upgrade' : 'Assign & Activate Plan'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 11. Enhanced Renew Package Confirmation Modal with Service Period & GST Preview */}
      {isRenewConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden my-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800 shrink-0 bg-slate-900">
              <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-blue-400" />
                <span>Renew Internet Package</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsRenewConfirmOpen(false)}
                className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 min-h-[36px] min-w-[36px] flex items-center justify-center"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-4 sm:p-6 space-y-4 text-xs overflow-y-auto flex-1">
              {/* Subscriber & Plan Summary */}
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span>Subscriber</span>
                  <span className="font-semibold text-slate-200">{customer.name} ({customer.customerCode})</span>
                </div>
                <div className="flex items-center justify-between text-slate-400">
                  <span>Current Package</span>
                  <span className="font-bold text-blue-400">
                    {activeSubscription?.plan?.name || 'Broadband Plan'} ({activeSubscription?.plan?.downloadSpeedMbps || 0} Mbps)
                  </span>
                </div>
              </div>

              {/* Service Validity Extension Box */}
              {renewalPreview && (
                <div className="p-4 rounded-xl bg-blue-950/20 border border-blue-800/40 space-y-2.5">
                  <span className="text-[11px] uppercase tracking-wider font-bold text-blue-400 block">
                    New Extended Service Period
                  </span>
                  <div className="flex items-center justify-between text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px]">SERVICE FROM</span>
                      <strong className="text-slate-100 font-mono text-sm">
                        {renewalPreview.startDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </strong>
                    </div>
                    <span className="text-slate-500 font-bold">➔</span>
                    <div className="text-right">
                      <span className="text-slate-400 block text-[10px]">SERVICE UNTIL</span>
                      <strong className="text-emerald-400 font-mono text-sm">
                        {renewalPreview.endDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </strong>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-400 text-center pt-1 border-t border-blue-900/40">
                    Validity extension: <strong className="text-slate-200">{renewalPreview.validityDays} Days</strong>
                  </div>
                </div>
              )}

              {/* Billing & Tax Preview */}
              {renewalPreview && (
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Base Plan Charge</span>
                    <span className="font-mono text-slate-200">₹{renewalPreview.basePrice.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400">
                    <span>GST ({renewalPreview.gstRatePercent}% SAC 998422)</span>
                    <span className="font-mono text-slate-200">₹{renewalPreview.gstAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between font-bold text-sm text-slate-100 pt-2 border-t border-slate-800">
                    <span>Total Tax Invoice Amount</span>
                    <span className="font-mono text-emerald-400">₹{renewalPreview.totalAmount.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* Automatic Invoice Notice */}
              <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-800/40 flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-emerald-200 leading-relaxed">
                  <strong>Automatic GST Tax Invoicing:</strong> Confirming renewal will immediately extend subscriber validity in FreeRADIUS and auto-generate a compliant GST Tax Invoice with the exact service period.
                </p>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 p-4 border-t border-slate-800 bg-slate-900/95">
              <button
                type="button"
                onClick={() => setIsRenewConfirmOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={renewPackageMutation.isPending || !activeSubscription?.id}
                onClick={() => {
                  if (activeSubscription?.id) {
                    renewPackageMutation.mutate(activeSubscription.id);
                  }
                }}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/20 disabled:opacity-50 min-h-[38px]"
              >
                {renewPackageMutation.isPending && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                <span>{renewPackageMutation.isPending ? 'Renewing...' : 'Renew & Generate Invoice'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 12. Suspend Confirmation Modal */}
      <ConfirmationModal
        isOpen={isSuspendConfirmOpen}
        onClose={() => setIsSuspendConfirmOpen(false)}
        onConfirm={() => suspendMutation.mutate()}
        title="Suspend Subscriber Account"
        message={`Are you sure you want to suspend "${customer.name}" (${customer.customerCode})? This will immediately throttle bandwidth or reject RADIUS auth and disconnect any active session.`}
        confirmText="Suspend Subscriber"
        variant="danger"
        isLoading={suspendMutation.isPending}
      />

      {/* 13. Reactivate Confirmation Modal */}
      <ConfirmationModal
        isOpen={isReactivateConfirmOpen}
        onClose={() => setIsReactivateConfirmOpen(false)}
        onConfirm={() => reactivateMutation.mutate()}
        title="Reactivate Subscriber Account"
        message={`Are you sure you want to reactivate "${customer.name}"? This will restore plan bandwidth limits in FreeRADIUS and permit PPPoE dial-in.`}
        confirmText="Reactivate Subscriber"
        variant="primary"
        isLoading={reactivateMutation.isPending}
      />

      {/* 14. Force Disconnect Session Confirmation Modal */}
      <ConfirmationModal
        isOpen={isDisconnectConfirmOpen}
        onClose={() => setIsDisconnectConfirmOpen(false)}
        onConfirm={() => disconnectMutation.mutate()}
        title="Force Disconnect PPPoE Session"
        message={`Send an RFC 3576 Disconnect-Request (PoD) for subscriber "${customer.username || customer.pppoeUsername}"? This will terminate the active session on the MikroTik router.`}
        confirmText="Disconnect Now"
        variant="warning"
        isLoading={disconnectMutation.isPending}
      />

      {/* 15. Reset MAC Confirmation Modal */}
      <ConfirmationModal
        isOpen={isResetMacConfirmOpen}
        onClose={() => setIsResetMacConfirmOpen(false)}
        onConfirm={() => resetMacMutation.mutate()}
        title="Reset this customer's authorized device?"
        message="The current device will no longer be authorized. The next successful PPPoE login will automatically register the new device."
        confirmText="Reset Authorized MAC"
        variant="warning"
        isLoading={resetMacMutation.isPending}
      />

      {/* 16. Cancel Active Subscription Confirmation Modal (Danger Zone) */}
      <ConfirmationModal
        isOpen={isCancelSubConfirmOpen}
        onClose={() => setIsCancelSubConfirmOpen(false)}
        onConfirm={() => {
          if (activeSubscription?.id) {
            cancelPackageMutation.mutate(activeSubscription.id);
          }
        }}
        title="Cancel Active Subscription (Danger Zone)"
        message={`Are you sure you want to cancel the active subscription for "${customer.name}" (${customer.customerCode})? This will immediately revoke broadband internet access and terminate any live PPPoE session. Historical invoices, payments, and account data will be strictly preserved.`}
        confirmText="Cancel Subscription Now"
        variant="danger"
        isLoading={cancelPackageMutation.isPending}
      />
    </div>
  );
}
