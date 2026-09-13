'use client';

import React from 'react';
import { AlertTriangle, AlertCircle, Info, RefreshCw, X } from 'lucide-react';

export interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'primary';
  isLoading?: boolean;
}

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  isLoading = false,
}: ConfirmationModalProps) {
  if (!isOpen) return null;

  let Icon = AlertTriangle;
  let iconBg = 'bg-rose-500/10 border-rose-500/20 text-rose-400';
  let buttonBg = 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/40';

  if (variant === 'warning') {
    Icon = AlertCircle;
    iconBg = 'bg-amber-500/10 border-amber-500/20 text-amber-400';
    buttonBg = 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-900/40';
  } else if (variant === 'primary') {
    Icon = Info;
    iconBg = 'bg-blue-500/10 border-blue-500/20 text-blue-400';
    buttonBg = 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/40';
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-xl border flex items-center justify-center shrink-0 ${iconBg}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100">{title}</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="text-slate-400 hover:text-slate-200 transition-colors p-1 rounded-lg hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">{message}</p>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold shadow-lg transition-all disabled:opacity-50 ${buttonBg}`}
          >
            {isLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
            <span>{confirmText}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
