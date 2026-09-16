'use client';

import React from 'react';
import { Users, Phone, MapPin, Edit, ShieldCheck, Mail, Building } from 'lucide-react';
import { maskAadhaar } from '../../lib/formatters';

interface CustomerSubscriberInfoCardProps {
  customer: any;
  onEditProfile: () => void;
}

export function CustomerSubscriberInfoCard({
  customer,
  onEditProfile,
}: CustomerSubscriberInfoCardProps) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <Users className="h-4 w-4 text-blue-400" />
          <span>Subscriber Information</span>
        </h3>
        <button
          type="button"
          onClick={onEditProfile}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-colors min-h-[36px]"
        >
          <Edit className="h-3.5 w-3.5" />
          <span>Edit Details</span>
        </button>
      </div>

      {/* Two-Column Info Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
        {/* Left Column: Contact Details */}
        <div className="space-y-3.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 border-b border-slate-800/80 pb-1.5">
            <Phone className="h-3.5 w-3.5 text-blue-400" />
            <span>Contact Information</span>
          </div>

          <div className="space-y-3">
            <div>
              <span className="text-[11px] text-slate-400 block font-medium">Primary Mobile</span>
              {customer?.mobile ? (
                <a
                  href={`tel:${customer.mobile}`}
                  className="font-mono text-sm font-bold text-slate-200 hover:text-blue-400 inline-block mt-0.5"
                >
                  {customer.mobile}
                </a>
              ) : (
                <span className="text-slate-400 text-sm">—</span>
              )}
            </div>

            <div>
              <span className="text-[11px] text-slate-400 block font-medium">Email Address</span>
              {customer?.email ? (
                <a
                  href={`mailto:${customer.email}`}
                  className="text-sm text-slate-200 hover:text-blue-400 block truncate mt-0.5"
                >
                  {customer.email}
                </a>
              ) : (
                <span className="text-slate-400 text-sm">—</span>
              )}
            </div>

            <div>
              <span className="text-[11px] text-slate-400 block font-medium">Alternate Phone</span>
              <span className="font-mono text-sm text-slate-300 block mt-0.5">
                {customer?.phone && customer.phone !== customer.mobile ? customer.phone : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Right Column: Service Location */}
        <div className="space-y-3.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 border-b border-slate-800/80 pb-1.5">
            <MapPin className="h-3.5 w-3.5 text-emerald-400" />
            <span>Service & Billing Location</span>
          </div>

          <div className="space-y-3">
            <div>
              <span className="text-[11px] text-slate-400 block font-medium">Installation Address</span>
              <span className="text-sm text-slate-200 block mt-0.5 leading-relaxed">
                {customer?.installationAddress || customer?.address || '—'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-[11px] text-slate-400 block font-medium">City & State</span>
                <span className="text-sm text-slate-200 block mt-0.5">
                  {[customer?.city, customer?.state].filter(Boolean).join(', ') || '—'}
                </span>
              </div>

              <div>
                <span className="text-[11px] text-slate-400 block font-medium">Area & PIN</span>
                <span className="text-sm font-mono text-slate-200 block mt-0.5">
                  {[customer?.area, customer?.pincode].filter(Boolean).join(' • ') || '—'}
                </span>
              </div>
            </div>

            <div>
              <span className="text-[11px] text-slate-400 block font-medium">Billing Address</span>
              <span className="text-xs text-slate-300 block mt-0.5">
                {customer?.address || 'Same as installation address'}
              </span>
            </div>

            {/* Zone & Node Network Placement */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800/60">
              <div>
                <span className="text-[11px] text-slate-400 block font-medium">Network Zone</span>
                {customer?.zone?.name ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-400 mt-0.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-sky-400"></span>
                    {customer.zone.name}
                  </span>
                ) : (
                  <span className="text-slate-500 text-xs mt-0.5 block">Unassigned</span>
                )}
              </div>
              <div>
                <span className="text-[11px] text-slate-400 block font-medium">Distribution Node</span>
                {customer?.node?.name ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 mt-0.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                    {customer.node.name}
                  </span>
                ) : (
                  <span className="text-slate-500 text-xs mt-0.5 block">Unassigned</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Statutory KYC Footer Summary */}
      <div className="pt-3 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs bg-slate-950/40 p-3 rounded-xl">
        <div>
          <span className="text-[10px] text-slate-400 uppercase tracking-wider block">GSTIN</span>
          <span className="font-mono text-xs font-semibold text-slate-300">
            {customer?.gstin || 'Unregistered'}
          </span>
        </div>
        <div>
          <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Aadhaar</span>
          <span className="font-mono text-xs font-semibold text-slate-300">
            {maskAadhaar(customer?.aadhaarNumber)}
          </span>
        </div>
        <div>
          <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Registration Date</span>
          <span className="text-xs text-slate-300">
            {customer?.createdAt ? new Date(customer.createdAt).toLocaleDateString() : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}
