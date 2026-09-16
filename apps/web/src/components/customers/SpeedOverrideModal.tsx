'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Gauge,
  RefreshCw,
  Zap,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

interface SpeedOverrideModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentDownload?: number;
  currentUpload?: number;
  onSave: (downloadMbps: number, uploadMbps: number) => Promise<void>;
  isLoading?: boolean;
}

export function SpeedOverrideModal({
  isOpen,
  onClose,
  currentDownload = 50,
  currentUpload = 50,
  onSave,
  isLoading = false,
}: SpeedOverrideModalProps) {
  const [download, setDownload] = useState(currentDownload);
  const [upload, setUpload] = useState(currentUpload);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDownload(currentDownload || 50);
      setUpload(currentUpload || 50);
      setError(null);
    }
  }, [isOpen, currentDownload, currentUpload]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (download <= 0 || upload <= 0) {
      setError('Speed values must be greater than 0');
      return;
    }

    try {
      await onSave(Number(download), Number(upload));
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to apply speed override');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden my-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800 shrink-0 bg-slate-900">
          <div className="flex items-center gap-2.5">
            <Gauge className="h-5 w-5 text-amber-400" />
            <div>
              <h3 className="text-base font-bold text-slate-100">Override Subscriber Speed</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Temporarily throttle or boost MikroTik rate limit in FreeRADIUS
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="p-4 sm:p-6 space-y-4 text-xs overflow-y-auto flex-1 min-h-0">
            {error && (
              <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 flex items-center gap-2 text-rose-300">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                <span>{error}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold block">Download (Mbps)</label>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={download}
                  onChange={(e) => setDownload(Number(e.target.value))}
                  required
                  className="w-full min-h-[42px] bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-slate-100 font-mono text-sm focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold block">Upload (Mbps)</label>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={upload}
                  onChange={(e) => setUpload(Number(e.target.value))}
                  required
                  className="w-full min-h-[42px] bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-slate-100 font-mono text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            {/* Preview Box */}
            <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/30 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-amber-400 uppercase tracking-wider block font-semibold">
                  Resulting MikroTik-Rate-Limit:
                </span>
                <span className="font-mono text-base font-bold text-amber-300 mt-0.5 block">
                  {upload}M/{download}M
                </span>
              </div>
              <Zap className="h-5 w-5 text-amber-400 shrink-0" />
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
              This updates <code className="text-amber-300">radreply</code> and dispatches a real-time
              RFC 3576 Change-of-Authorization (CoA) packet to adjust active session queue speeds instantly.
            </p>
          </div>

          {/* Footer */}
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
              className="min-h-[40px] px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold shadow-lg shadow-amber-600/20 disabled:opacity-50 inline-flex items-center gap-2 transition-all"
            >
              {isLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
              <span>Apply Speed Override</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
