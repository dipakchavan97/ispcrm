'use client';

import React from 'react';
import {
  Cpu,
  Radio,
  Wifi,
  ShieldCheck,
  ShieldAlert,
  Server,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Info,
} from 'lucide-react';

interface CustomerCpeCardProps {
  customer: any;
  connection?: any;
  subscription?: any;
}

export function CustomerCpeCard({
  customer,
  connection,
  subscription,
}: CustomerCpeCardProps) {
  const observedMac = connection?.callingStationId || null;
  const authorizedMac = customer?.macAddress || null;
  const isMatch = connection?.isMacMatch ?? false;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
      {/* Header */}
      <div className="border-b border-slate-800 pb-3">
        <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <Cpu className="h-4 w-4 text-purple-400" />
          <span>Customer Premise Equipment (CPE) & Hardware Network Map</span>
        </h3>
        <p className="text-xs text-slate-400 mt-0.5">
          Physical device binding, ONT equipment telemetry, and AAA authentication mapping.
        </p>
      </div>

      {/* Visual Relationship Chain */}
      <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 space-y-2">
        <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold block">
          Subscriber Hardware AAA Topology
        </span>
        <div className="flex items-center justify-between gap-2 overflow-x-auto scrollbar-none py-2 text-xs">
          {/* Step 1: Customer */}
          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-700/80 shrink-0 min-w-[120px] text-center">
            <span className="text-[10px] text-slate-400 block">Subscriber</span>
            <span className="font-semibold text-slate-100 block truncate">{customer.name}</span>
          </div>

          <ArrowRight className="h-4 w-4 text-slate-600 shrink-0" />

          {/* Step 2: Subscription */}
          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-700/80 shrink-0 min-w-[120px] text-center">
            <span className="text-[10px] text-blue-400 block">Service Plan</span>
            <span className="font-semibold text-slate-100 block truncate">
              {subscription?.plan?.name || 'Broadband'}
            </span>
          </div>

          <ArrowRight className="h-4 w-4 text-slate-600 shrink-0" />

          {/* Step 3: Service Network */}
          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-700/80 shrink-0 min-w-[130px] text-center">
            <span className="text-[10px] text-emerald-400 block">PPPoE Dial-in</span>
            <span className="font-mono text-emerald-400 block truncate">
              {customer.username || customer.pppoeUsername}
            </span>
          </div>

          <ArrowRight className="h-4 w-4 text-slate-600 shrink-0" />

          {/* Step 4: Physical CPE */}
          <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-700/80 shrink-0 min-w-[150px] text-center">
            <span className="text-[10px] text-purple-400 block">Physical CPE (ONT)</span>
            <span className="font-mono text-xs font-bold text-purple-300 block truncate">
              {observedMac || 'Offline / Unknown'}
            </span>
          </div>

          <ArrowRight className="h-4 w-4 text-slate-600 shrink-0" />

          {/* Step 5: FreeRADIUS Rule */}
          <div
            className={`p-2.5 rounded-lg border shrink-0 min-w-[140px] text-center ${
              authorizedMac
                ? 'bg-purple-950/50 border-purple-500/40 text-purple-300'
                : 'bg-slate-900 border-slate-700/80 text-slate-400'
            }`}
          >
            <span className="text-[10px] block">FreeRADIUS Rule</span>
            <span className="font-bold text-xs block">
              {authorizedMac ? 'Calling-Station-Id Lock' : 'Unrestricted Pool'}
            </span>
          </div>
        </div>
      </div>

      {/* Equipment Telemetry Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        {/* Box 1: Observed Physical CPE Telemetry */}
        <div className="p-3.5 rounded-xl bg-slate-950/40 border border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Radio className="h-3.5 w-3.5 text-blue-400" />
              <span>Observed Physical Device (MikroTik / radacct)</span>
            </span>
            <span
              className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                observedMac ? 'bg-blue-950 text-blue-300' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {observedMac ? 'Active Session' : 'Offline'}
            </span>
          </div>
          <div className="space-y-1.5 leading-relaxed">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Device Calling-Station-Id:</span>
              <span className="font-mono font-bold text-slate-200">{observedMac || '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Access Router:</span>
              <span className="text-slate-300 font-mono">
                {connection?.routerName ? `${connection.routerName} (${connection.nasIp})` : connection?.nasIp || '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Router Interface / Port:</span>
              <span className="font-mono text-slate-300">{connection?.nasPort || '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Framed IP Lease:</span>
              <span className="font-mono text-cyan-400">{connection?.framedIp || '—'}</span>
            </div>
          </div>
        </div>

        {/* Box 2: Authorized AAA Policy */}
        <div className="p-3.5 rounded-xl bg-slate-950/40 border border-slate-800/80 space-y-2">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-semibold text-slate-300 flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-purple-400" />
              <span>Authorized Security Rule (Database / radcheck)</span>
            </span>
            <span
              className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                authorizedMac ? 'bg-purple-950 text-purple-300' : 'bg-amber-950 text-amber-400'
              }`}
            >
              {authorizedMac ? 'Locked' : 'Open'}
            </span>
          </div>
          <div className="space-y-1.5 leading-relaxed">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Authorized MAC Address:</span>
              <span className="font-mono font-bold text-purple-300">
                {authorizedMac || 'Not Bound'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Hardware Lock Enforcement:</span>
              <span className="text-slate-300">
                {authorizedMac ? 'radcheck Calling-Station-Id == MAC' : 'Disabled (Any MAC Permitted)'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Session Match Verification:</span>
              {authorizedMac && observedMac ? (
                <span
                  className={`inline-flex items-center gap-1 font-bold ${
                    isMatch ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {isMatch ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                  <span>{isMatch ? 'Verified Matching' : 'Mismatch Detected'}</span>
                </span>
              ) : (
                <span className="text-slate-500">—</span>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Static / Framed Pool:</span>
              <span className="font-mono text-slate-300">
                {customer.staticIp ? `${customer.staticIp} (Static)` : 'pppoe (Dynamic Pool)'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Clear Guidance Note */}
      <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-start gap-2.5 text-slate-400 text-[11px]">
        <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <strong className="text-slate-300">CPE MAC vs Authorized PPPoE MAC:</strong> The physical CPE (ONT / router)
          transmits its hardware MAC address as the RADIUS Calling-Station-Id during PPPoE link discovery. The Authorized MAC
          is the database policy against which FreeRADIUS validates the dial-in request. If a customer changes their Wi-Fi router or ONT,
          the Authorized MAC must be updated using the Change MAC action.
        </p>
      </div>
    </div>
  );
}
