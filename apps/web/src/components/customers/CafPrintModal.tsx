'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  FileDown,
  ExternalLink,
  Printer,
  FileText,
  AlertCircle,
  RefreshCw,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { fetchCafPdfBlob, downloadCafPdf } from '../../lib/api';
import { useToast } from '../Toast';

interface CafPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: any;
  subscription?: any;
}

export function CafPrintModal({
  isOpen,
  onClose,
  customer,
}: CafPrintModalProps) {
  const toast = useToast();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  // Safely clean up previous Object URL to avoid memory leaks
  const cleanupUrl = useCallback((url: string | null) => {
    if (url) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore revocation errors
      }
    }
  }, []);

  const loadCaf = useCallback(async () => {
    if (!customer?.id) return;
    setIsLoading(true);
    setError(null);

    try {
      const blob = await fetchCafPdfBlob(customer.id, true);
      const url = URL.createObjectURL(blob);
      setBlobUrl((prev) => {
        cleanupUrl(prev);
        return url;
      });
    } catch (err: any) {
      setError(err.message || 'Failed to load Customer Application Form PDF.');
    } finally {
      setIsLoading(false);
    }
  }, [customer?.id, cleanupUrl]);

  // Load PDF on open, cleanup on close/unmount
  useEffect(() => {
    if (isOpen && customer?.id) {
      loadCaf();
    } else {
      setBlobUrl((prev) => {
        cleanupUrl(prev);
        return null;
      });
      setError(null);
      setIsLoading(false);
      setIsDownloading(false);
    }

    return () => {
      setBlobUrl((prev) => {
        cleanupUrl(prev);
        return null;
      });
    };
  }, [isOpen, customer?.id, loadCaf, cleanupUrl]);

  // Handle ESC key to close modal
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    }
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !customer) return null;

  const handleDownload = async () => {
    if (!customer?.id || isDownloading) return;

    try {
      setIsDownloading(true);
      await downloadCafPdf(customer.id, customer.customerCode, customer.name);
      toast.success(
        `CAF document downloaded for ${customer.customerCode || customer.name}`,
        'CAF Downloaded'
      );
    } catch (err: any) {
      toast.error(err.message || 'Could not download CAF PDF', 'Download Error');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleOpenNewTab = () => {
    if (!blobUrl) return;
    const win = window.open(blobUrl, '_blank');
    if (!win) {
      toast.warning('Popup blocked. Please allow popups to open PDF in a new tab.', 'Popup Blocked');
    }
  };

  const handlePrint = () => {
    if (iframeRef.current?.contentWindow) {
      try {
        iframeRef.current.contentWindow.focus();
        iframeRef.current.contentWindow.print();
        return;
      } catch {
        // Viewer plugin security sandbox prevents direct frame print
      }
    }
    // Fallback to opening full tab for native browser print
    handleOpenNewTab();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/85 backdrop-blur-sm animate-fadeIn">
      {/* Click outside to close */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Modal Dialog */}
      <div className="relative z-10 bg-slate-900 border border-slate-800 rounded-2xl max-w-5xl w-full h-[92vh] max-h-[900px] flex flex-col shadow-2xl overflow-hidden my-auto">
        {/* Top Header Bar */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-slate-800 shrink-0 bg-slate-900/95">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm sm:text-base font-bold text-slate-100 truncate">
                  Customer Application Form (CAF)
                </h3>
                <span className="font-mono text-xs font-bold text-blue-400 px-2 py-0.5 rounded bg-blue-950/60 border border-blue-500/30">
                  {customer.customerCode || 'CAF'}
                </span>
                <span className="hidden md:inline-flex items-center gap-1 text-[11px] text-emerald-400 font-semibold bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-500/20">
                  <ShieldCheck className="h-3 w-3" />
                  <span>Statutory Vector PDF</span>
                </span>
              </div>
              <p className="text-[11px] text-slate-400 truncate mt-0.5">
                Subscriber: <strong className="text-slate-300">{customer.name}</strong> • Official DoT & TRAI Subscriber Agreement
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Download Button */}
            <button
              type="button"
              onClick={handleDownload}
              disabled={isDownloading || isLoading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white text-xs font-semibold shadow-lg shadow-blue-600/20 transition-all min-h-[36px]"
              title="Download CAF PDF with customer identifier"
            >
              {isDownloading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="hidden sm:inline">Downloading...</span>
                </>
              ) : (
                <>
                  <FileDown className="h-4 w-4" />
                  <span className="hidden sm:inline">Download CAF PDF</span>
                  <span className="sm:hidden">Download</span>
                </>
              )}
            </button>

            {/* Open in New Tab Button */}
            <button
              type="button"
              onClick={handleOpenNewTab}
              disabled={!blobUrl || isLoading}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 text-xs font-semibold transition-colors min-h-[36px]"
              title="Open vector PDF in standalone browser tab"
            >
              <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
              <span>Full Tab</span>
            </button>

            {/* Print Button */}
            <button
              type="button"
              onClick={handlePrint}
              disabled={!blobUrl || isLoading}
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 text-xs font-semibold transition-colors min-h-[36px]"
              title="Print document"
            >
              <Printer className="h-3.5 w-3.5 text-slate-400" />
              <span>Print</span>
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200 p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl hover:bg-slate-800 transition-colors"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Modal Body: Loading, Error, or Vector PDF Viewer */}
        <div className="flex-1 min-h-0 w-full relative bg-slate-950 flex flex-col">
          {isLoading && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 bg-slate-950/90 text-center space-y-4 animate-fadeIn">
              <div className="relative">
                <div className="h-16 w-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shadow-xl shadow-blue-500/10">
                  <FileText className="h-8 w-8 animate-pulse" />
                </div>
                <div className="absolute -bottom-1 -right-1 p-1 bg-slate-900 rounded-full border border-slate-800 text-blue-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              </div>

              <div className="space-y-1 max-w-sm">
                <h4 className="text-sm font-bold text-slate-100">
                  Generating Customer Application Form...
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Compiling verified subscriber records, plan tariff, and DoT/TRAI statutory terms into an official A4 vector PDF.
                </p>
              </div>
            </div>
          )}

          {error && !isLoading && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 text-center space-y-4 bg-slate-950 animate-fadeIn">
              <div className="h-14 w-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 shadow-xl">
                <AlertCircle className="h-7 w-7" />
              </div>

              <div className="space-y-1.5 max-w-md">
                <h4 className="text-sm font-bold text-slate-100">Unable to Generate CAF</h4>
                <p className="text-xs text-rose-300/90 leading-relaxed bg-rose-950/30 p-3 rounded-xl border border-rose-900/40">
                  {error}
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={loadCaf}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/20 transition-all min-h-[36px]"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Retry Generation</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors min-h-[36px]"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {blobUrl && !isLoading && !error && (
            <iframe
              ref={iframeRef}
              src={blobUrl}
              title={`Customer Application Form - ${customer.customerCode || customer.name}`}
              className="w-full h-full border-0 rounded-b-2xl bg-slate-900"
            />
          )}
        </div>
      </div>
    </div>
  );
}
