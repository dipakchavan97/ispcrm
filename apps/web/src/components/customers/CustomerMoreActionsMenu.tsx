'use client';

import React, { useEffect, useRef } from 'react';
import {
  Radio,
  Power,
  RotateCw,
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  RefreshCw,
  Zap,
  Gauge,
  FileText,
  CreditCard,
  MessageCircle,
  Mail,
  IndianRupee,
  Receipt,
  LifeBuoy,
  Edit,
  X,
  History,
  Trash2,
  Calendar,
} from 'lucide-react';
import { CustomerStatus } from '@isp-crm/shared';

interface CustomerMoreActionsMenuProps {
  isOpen: boolean;
  onClose: () => void;
  customer: any;
  connection?: any;
  subscription?: any;
  onEditProfile: () => void;
  onDisconnect: () => void;
  onSuspend: () => void;
  onReactivate: () => void;
  onChangeMac: () => void;
  onResetMac: () => void;
  onChangePassword: () => void;
  onRenewPackage: () => void;
  onChangePackage: () => void;
  onOverrideSpeed: () => void;
  onGenerateCaf: () => void;
  onGeneratePaymentLink: () => void;
  onDirectMessage: () => void;
  onWhatsApp: () => void;
  onEmail: () => void;
  onRecordPayment: () => void;
  onCreateInvoice: () => void;
  onAddTicket: () => void;
  onViewAccessRequests: () => void;
  onCancelSubscription: () => void;
}

export function CustomerMoreActionsMenu({
  isOpen,
  onClose,
  customer,
  connection,
  subscription,
  onEditProfile,
  onDisconnect,
  onSuspend,
  onReactivate,
  onChangeMac,
  onResetMac,
  onChangePassword,
  onRenewPackage,
  onChangePackage,
  onOverrideSpeed,
  onGenerateCaf,
  onGeneratePaymentLink,
  onDirectMessage,
  onWhatsApp,
  onEmail,
  onRecordPayment,
  onCreateInvoice,
  onAddTicket,
  onViewAccessRequests,
  onCancelSubscription,
}: CustomerMoreActionsMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isSuspended = customer?.status === CustomerStatus.SUSPENDED;
  const isOnline = connection?.isOnline ?? false;
  const hasMac = Boolean(customer?.macAddress);
  const hasActiveSub = Boolean(subscription);

  const handleAction = (fn: () => void) => {
    onClose();
    fn();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      {/* Click outside backdrop */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Menu Modal / Dialog */}
      <div
        ref={menuRef}
        className="relative z-10 bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[88vh] flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/95 shrink-0">
          <div>
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <span>Operations & Actions</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Select an action for <strong className="text-slate-200">{customer?.name}</strong> (
              <span className="font-mono text-blue-400">{customer?.customerCode}</span>)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center"
            aria-label="Close actions menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Action Groups Body */}
        <div className="overflow-y-auto p-4 sm:p-6 space-y-6 flex-1 text-xs">
          {/* GROUP 1: CONNECTION OPERATIONS */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-1">
              Connection & Session
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleAction(onDisconnect)}
                disabled={!isOnline}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 disabled:opacity-40 disabled:hover:bg-slate-950/60 text-left transition-all min-h-[44px]"
              >
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 shrink-0">
                  <Radio className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-slate-200">Force Disconnect Session</div>
                  <div className="text-[11px] text-slate-400">Send RFC 3576 Packet of Disconnect (PoD)</div>
                </div>
              </button>

              {isSuspended ? (
                <button
                  type="button"
                  onClick={() => handleAction(onReactivate)}
                  className="flex items-center gap-3 p-3 rounded-xl bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-500/30 text-slate-200 text-left transition-all min-h-[44px]"
                >
                  <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 shrink-0">
                    <RotateCw className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-semibold text-emerald-300">Reactivate Account</div>
                    <div className="text-[11px] text-slate-400">Restore plan bandwidth limits in FreeRADIUS</div>
                  </div>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleAction(onSuspend)}
                  className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/60 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-500/30 text-slate-200 text-left transition-all min-h-[44px]"
                >
                  <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 shrink-0">
                    <Power className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-semibold text-rose-300">Suspend Account</div>
                    <div className="text-[11px] text-slate-400">Throttle bandwidth or reject authentication</div>
                  </div>
                </button>
              )}
            </div>
          </div>

          {/* GROUP 2: NETWORK & AAA CONFIGURATION */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-1">
              Network & AAA Configuration
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleAction(onChangeMac)}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 text-left transition-all min-h-[44px]"
              >
                <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400 shrink-0">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-slate-200">{hasMac ? 'Change Authorized MAC' : 'Bind Authorized MAC'}</div>
                  <div className="text-[11px] text-slate-400">Lock dial-in to specific ONT/CPE hardware</div>
                </div>
              </button>

              {hasMac && (
                <button
                  type="button"
                  onClick={() => handleAction(onResetMac)}
                  className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 text-left transition-all min-h-[44px]"
                >
                  <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 shrink-0">
                    <ShieldAlert className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-semibold text-slate-200">Reset MAC Restriction</div>
                    <div className="text-[11px] text-slate-400">Allow subscriber to dial in from any device</div>
                  </div>
                </button>
              )}

              <button
                type="button"
                onClick={() => handleAction(onChangePassword)}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 text-left transition-all min-h-[44px]"
              >
                <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 shrink-0">
                  <KeyRound className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-slate-200">Change PPPoE Password</div>
                  <div className="text-[11px] text-slate-400">Update credentials in radcheck and database</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleAction(onOverrideSpeed)}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 text-left transition-all min-h-[44px]"
              >
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 shrink-0">
                  <Gauge className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-slate-200">Override Bandwidth Speed</div>
                  <div className="text-[11px] text-slate-400">Temporary rate-limit override via RFC 3576 CoA</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleAction(onViewAccessRequests)}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 text-left transition-all min-h-[44px]"
              >
                <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 shrink-0">
                  <History className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-slate-200">View RADIUS Access Requests</div>
                  <div className="text-[11px] text-slate-400">Inspect recent dial-in accepts and rejects</div>
                </div>
              </button>
            </div>
          </div>

          {/* GROUP 3: BILLING & SUBSCRIPTIONS */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-1">
              Billing & Subscriptions
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleAction(onRenewPackage)}
                disabled={!hasActiveSub}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 disabled:opacity-40 text-left transition-all min-h-[44px]"
              >
                <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 shrink-0">
                  <RefreshCw className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-slate-200">Renew Internet Package</div>
                  <div className="text-[11px] text-slate-400">Extend validity for the active broadband plan</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleAction(onChangePackage)}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 text-left transition-all min-h-[44px]"
              >
                <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 shrink-0">
                  <Zap className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-slate-200">Change Internet Package</div>
                  <div className="text-[11px] text-slate-400">Upgrade or switch to a different plan tier</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleAction(onRecordPayment)}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 text-left transition-all min-h-[44px]"
              >
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                  <IndianRupee className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-slate-200">Record Payment</div>
                  <div className="text-[11px] text-slate-400">Collect cash, UPI, or online payment receipt</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleAction(onCreateInvoice)}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 text-left transition-all min-h-[44px]"
              >
                <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 shrink-0">
                  <Receipt className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-slate-200">Generate GST Invoice</div>
                  <div className="text-[11px] text-slate-400">Issue tax invoice for subscription or addon charges</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleAction(onGeneratePaymentLink)}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 text-left transition-all min-h-[44px]"
              >
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                  <CreditCard className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-slate-200">Copy Payment Link</div>
                  <div className="text-[11px] text-slate-400">Send direct customer payment portal URL</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleAction(onAddTicket)}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 text-left transition-all min-h-[44px]"
              >
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 shrink-0">
                  <LifeBuoy className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-slate-200">Open Support Ticket</div>
                  <div className="text-[11px] text-slate-400">File a fiber cut, speed issue, or general inquiry</div>
                </div>
              </button>
            </div>
          </div>

          {/* GROUP 4: DOCUMENTS & COMMUNICATION */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-1">
              Documents & Communication
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleAction(onGenerateCaf)}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 text-left transition-all min-h-[44px]"
              >
                <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 shrink-0">
                  <FileText className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-slate-200">Generate CAF</div>
                  <div className="text-[11px] text-slate-400">Preview & download statutory Customer Application Form (PDF)</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleAction(onWhatsApp)}
                disabled={!customer?.mobile}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 disabled:opacity-40 text-left transition-all min-h-[44px]"
              >
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                  <MessageCircle className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-slate-200">WhatsApp Message</div>
                  <div className="text-[11px] text-slate-400">Send billing or renewal reminder via WhatsApp</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleAction(onEmail)}
                disabled={!customer?.email}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 disabled:opacity-40 text-left transition-all min-h-[44px]"
              >
                <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 shrink-0">
                  <Mail className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-slate-200">Send Email</div>
                  <div className="text-[11px] text-slate-400">Compose email to subscriber&apos;s registered address</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleAction(onEditProfile)}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 text-left transition-all min-h-[44px]"
              >
                <div className="p-2 rounded-lg bg-slate-500/10 text-slate-300 shrink-0">
                  <Edit className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-slate-200">Edit Subscriber Profile</div>
                  <div className="text-[11px] text-slate-400">Update name, contact, addresses, and static IP</div>
                </div>
              </button>
            </div>
          </div>

          {/* GROUP 5: DANGER ZONE */}
          <div className="space-y-2 pt-2 border-t border-slate-800/80">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-rose-400 px-1">
              Danger Zone
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleAction(onCancelSubscription)}
                disabled={!hasActiveSub}
                className="flex items-center gap-3 p-3 rounded-xl bg-rose-950/20 hover:bg-rose-950/40 border border-rose-500/20 hover:border-rose-500/40 text-slate-200 disabled:opacity-40 text-left transition-all min-h-[44px]"
              >
                <div className="p-2 rounded-lg bg-rose-500/20 text-rose-400 shrink-0">
                  <Trash2 className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-rose-300">Cancel Active Subscription</div>
                  <div className="text-[11px] text-slate-400">Revoke internet access and cancel plan</div>
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-colors min-h-[40px]"
          >
            Close Menu
          </button>
        </div>
      </div>
    </div>
  );
}
