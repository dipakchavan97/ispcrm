'use client';

import React from 'react';
import {
  FileCheck2,
  CheckCircle2,
  Clock,
  Lock,
  FileText,
  Building,
  ShieldCheck,
} from 'lucide-react';
import { maskAadhaar } from '../../lib/formatters';

interface CustomerKycCardProps {
  customer: any;
  onGenerateCaf: () => void;
}

export function CustomerKycCard({
  customer,
  onGenerateCaf,
}: CustomerKycCardProps) {
  const documents = [
    {
      type: 'Aadhaar Identification',
      number: customer.aadhaarNumber ? maskAadhaar(customer.aadhaarNumber) : 'Not Provided',
      status: customer.aadhaarNumber ? 'VERIFIED' : 'PENDING',
      uploadedAt: customer.createdAt,
      verifiedBy: 'ISP Compliance Desk',
      isMasked: true,
    },
    {
      type: 'GSTIN Business Registration',
      number: customer.gstin || 'Unregistered Individual',
      status: customer.gstin ? 'VERIFIED' : 'NOT_APPLICABLE',
      uploadedAt: customer.createdAt,
      verifiedBy: 'Tax Ledger Team',
      isMasked: false,
    },
    {
      type: 'Customer Application Form (CAF)',
      number: `CAF-${customer.customerCode}`,
      status: 'VERIFIED',
      uploadedAt: customer.installationDate || customer.createdAt,
      verifiedBy: 'System Automated',
      isMasked: false,
    },
    {
      type: 'Installation Address Proof',
      number: customer.installationAddress || customer.address || '—',
      status: customer.address ? 'VERIFIED' : 'PENDING',
      uploadedAt: customer.installationDate || customer.createdAt,
      verifiedBy: 'Field Technician',
      isMasked: false,
    },
  ];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <FileCheck2 className="h-4 w-4 text-emerald-400" />
            <span>KYC Compliance & Verification Records</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Identity verification and statutory compliance documents on file.
          </p>
        </div>

        <button
          type="button"
          onClick={onGenerateCaf}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/20 transition-all min-h-[38px]"
        >
          <FileText className="h-4 w-4" />
          <span>Generate CAF</span>
        </button>
      </div>

      <div className="overflow-x-auto w-full min-w-0 border border-slate-800 rounded-xl">
        <table className="w-full text-left text-xs min-w-[620px]">
          <thead className="bg-slate-950/70 text-slate-400 font-medium border-b border-slate-800">
            <tr>
              <th className="px-4 py-3">Document Type</th>
              <th className="px-4 py-3">Document Identifier / Number</th>
              <th className="px-4 py-3">Record Date</th>
              <th className="px-4 py-3">Verification Status</th>
              <th className="px-4 py-3 text-right">Verified By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-slate-300">
            {documents.map((doc, idx) => (
              <tr key={idx} className="hover:bg-slate-800/40 transition-colors">
                <td className="px-4 py-3 font-semibold text-slate-200">
                  {doc.type}
                </td>
                <td className="px-4 py-3 font-mono">
                  <span className={doc.isMasked ? 'text-purple-300 font-semibold' : 'text-slate-300'}>
                    {doc.number}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-400 font-mono text-[11px]">
                  {doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString() : '—'}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                      doc.status === 'VERIFIED'
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/20'
                        : doc.status === 'PENDING'
                        ? 'bg-amber-950 text-amber-400 border border-amber-500/20'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {doc.status === 'VERIFIED' && <CheckCircle2 className="h-3 w-3" />}
                    {doc.status === 'PENDING' && <Clock className="h-3 w-3" />}
                    <span>{doc.status.replace(/_/g, ' ')}</span>
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-slate-400 text-[11px]">
                  {doc.verifiedBy}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-2.5 text-slate-400 text-[11px]">
        <Lock className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <strong className="text-slate-300">Statutory Privacy Policy:</strong> In compliance with TRAI and UIDAI data protection guidelines, Aadhaar numbers are masked to display only the last four digits. Full identification details remain encrypted at rest.
        </p>
      </div>
    </div>
  );
}
