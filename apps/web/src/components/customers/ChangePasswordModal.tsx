'use client';

import React, { useState } from 'react';
import {
  X,
  KeyRound,
  Eye,
  EyeOff,
  RefreshCw,
  Lock,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (password: string) => Promise<void>;
  isLoading?: boolean;
  username: string;
}

export function ChangePasswordModal({
  isOpen,
  onClose,
  onSave,
  isLoading = false,
  username,
}: ChangePasswordModalProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || password.length < 4) {
      setError('Password must be at least 4 characters long');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    try {
      await onSave(password);
      setPassword('');
      setConfirmPassword('');
      setError(null);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to update PPPoE password');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden my-auto">
        {/* Sticky Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800 shrink-0 bg-slate-900">
          <div className="flex items-center gap-2.5">
            <KeyRound className="h-5 w-5 text-cyan-400" />
            <div>
              <h3 className="text-base font-bold text-slate-100">Change PPPoE Password</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Update dial-in credentials for{' '}
                <span className="font-mono text-emerald-400 font-semibold">{username}</span>
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="p-4 sm:p-6 space-y-4 text-xs overflow-y-auto flex-1 min-h-0">
            {error && (
              <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 flex items-center gap-2 text-rose-300">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-slate-300 font-semibold block">New PPPoE Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter new password"
                  required
                  className="w-full min-h-[42px] bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 pr-10 text-slate-100 font-mono text-sm focus:outline-none focus:border-cyan-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-slate-300 font-semibold block">Confirm New Password</label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-type new password"
                required
                className="w-full min-h-[42px] bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-slate-100 font-mono text-sm focus:outline-none focus:border-cyan-500 transition-colors"
              />
            </div>

            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-2.5 text-slate-400 leading-relaxed">
              <Lock className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <p>
                Updating this credential immediately rewrites <code className="text-cyan-300">Cleartext-Password</code> in FreeRADIUS radcheck for all realm candidates.
              </p>
            </div>
          </div>

          {/* Sticky Footer */}
          <div className="flex items-center justify-end gap-2.5 p-4 sm:p-5 border-t border-slate-800 shrink-0 bg-slate-900/95 backdrop-blur">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="min-h-[40px] px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-lg shadow-cyan-600/20 disabled:opacity-50 inline-flex items-center gap-2 transition-all"
            >
              {isLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
              <span>Update Password</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
