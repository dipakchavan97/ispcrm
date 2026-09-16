'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';
import { normalizeMacAddress } from '@isp-crm/shared';

interface MacManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentMac: string | null;
  onSave: (mac: string | null) => Promise<void>;
  isLoading?: boolean;
}

export function MacManagementModal({
  isOpen,
  onClose,
  currentMac,
  onSave,
  isLoading = false,
}: MacManagementModalProps) {
  const [macInput, setMacInput] = useState('');
  const [normalizedPreview, setNormalizedPreview] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMacInput(currentMac || '');
      setNormalizedPreview(currentMac || null);
      setValidationError(null);
    }
  }, [isOpen, currentMac]);

  if (!isOpen) return null;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setMacInput(raw);

    if (!raw.trim()) {
      setNormalizedPreview(null);
      setValidationError(null);
      return;
    }

    try {
      const canonical = normalizeMacAddress(raw);
      setNormalizedPreview(canonical);
      setValidationError(null);
    } catch (err: any) {
      setNormalizedPreview(null);
      setValidationError('Invalid MAC format (Accepts AA:BB:CC:DD:EE:FF, AA-BB-CC..., or compact hex)');
    }
  };

  const handleSave = async () => {
    if (!macInput.trim()) {
      await onSave(null);
      onClose();
      return;
    }

    try {
      const canonical = normalizeMacAddress(macInput);
      await onSave(canonical);
      onClose();
    } catch (err: any) {
      setValidationError('Please enter a valid MAC address');
    }
  };

  const handleClear = async () => {
    setMacInput('');
    setNormalizedPreview(null);
    await onSave(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden my-auto">
        {/* Sticky Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800 shrink-0 bg-slate-900">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-5 w-5 text-purple-400" />
            <div>
              <h3 className="text-base font-bold text-slate-100">Authorized MAC Management</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Hardware-lock subscriber PPPoE dial-in to an authorized CPE device
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg hover:bg-slate-800 transition-colors"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 min-h-0 space-y-4 text-xs">
          {/* Current Status */}
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
            <span className="text-slate-400">Current Status:</span>
            <span
              className={`font-mono text-xs font-bold px-2.5 py-1 rounded-full ${
                currentMac
                  ? 'bg-purple-950 text-purple-300 border border-purple-500/30'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {currentMac ? `Bound: ${currentMac}` : 'Unrestricted (No Lock)'}
            </span>
          </div>

          {/* MAC Input */}
          <div className="space-y-1.5">
            <label className="text-slate-300 font-semibold block">
              Physical CPE MAC Address:
            </label>
            <input
              type="text"
              value={macInput}
              onChange={handleInputChange}
              placeholder="e.g. 0A:F8:44:0E:8C:17 or 0af8440e8c17"
              className="w-full min-h-[42px] bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-slate-100 font-mono text-sm focus:outline-none focus:border-purple-500 uppercase transition-colors"
            />
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Accepts standard formats: <code className="text-slate-400">AA:BB:CC:DD:EE:FF</code>,{' '}
              <code className="text-slate-400">AA-BB-CC-DD-EE-FF</code>,{' '}
              <code className="text-slate-400">AABB.CCDD.EEFF</code>, or raw hex.
            </p>
          </div>

          {/* Normalization Preview */}
          {normalizedPreview && (
            <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-emerald-400 uppercase tracking-wider block font-semibold">
                  Canonical FreeRADIUS MAC Preview:
                </span>
                <span className="font-mono text-base font-bold text-emerald-300 mt-0.5 block">
                  {normalizedPreview}
                </span>
              </div>
              <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
            </div>
          )}

          {/* Validation Error */}
          {validationError && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 flex items-center gap-2 text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
              <span>{validationError}</span>
            </div>
          )}

          {/* Policy Information */}
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1.5 text-slate-400 leading-relaxed">
            <p>
              <strong className="text-slate-200">Enforcement Action:</strong> Saving this MAC updates
              customer records and synchronizes <code className="text-purple-300">Calling-Station-Id == MAC</code> in FreeRADIUS radcheck.
            </p>
            <p>
              Dial-in attempts from any other hardware address will receive an instantaneous <code className="text-rose-400">Access-Reject</code> before session start.
            </p>
          </div>
        </div>

        {/* Sticky Footer */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-t border-slate-800 shrink-0 bg-slate-900/95 backdrop-blur">
          {currentMac ? (
            <button
              type="button"
              onClick={handleClear}
              disabled={isLoading}
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 text-xs font-semibold border border-amber-500/30 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Remove Lock (Unbind)</span>
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={isLoading || (Boolean(macInput.trim()) && !normalizedPreview)}
              className="min-h-[40px] px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/20 disabled:opacity-50 inline-flex items-center gap-2 transition-all"
            >
              {isLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
              <span>Save & Enforce MAC</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
