'use client';

import React from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Edit,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Clock,
} from 'lucide-react';

interface CustomerMacCardProps {
  customer: any;
  connection?: any;
  onChangeMac: () => void;
  onResetMac: () => void;
  isResetting?: boolean;
}

export function CustomerMacCard({
  customer,
  connection,
  onChangeMac,
  onResetMac,
  isResetting = false,
}: CustomerMacCardProps) {
  const isPending = Boolean(customer?.macResetPending);
  const isBound = Boolean(customer?.macAddress) && !isPending;
  const observedMac = connection?.callingStationId || null;
  const isMacMatch = connection?.isMacMatch ?? true;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-100 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-purple-400" />
          <span>MAC Authentication</span>
        </h2>

        {isPending ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-bold bg-amber-950/80 text-amber-300 border border-amber-500/40">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
            </span>
            <span>WAITING FOR NEW DEVICE</span>
          </span>
        ) : isBound ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-500/30">
            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
            <span>AUTHORIZED</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-bold bg-slate-800 text-slate-400 border border-slate-700">
            <span>○ UNRESTRICTED</span>
          </span>
        )}
      </div>

      {/* Security Details Panel */}
      <div className="space-y-3.5 text-xs">
        {isPending ? (
          <div className="space-y-3 bg-amber-950/20 p-4 rounded-xl border border-amber-800/40">
            <div className="flex items-start gap-2.5">
              <Clock className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="text-[11px] text-amber-400 uppercase tracking-wider block font-bold">
                  MAC Status: WAITING FOR NEW DEVICE
                </span>
                <p className="text-xs text-slate-200 leading-relaxed font-medium">
                  Old MAC removed. The next successful PPPoE login will automatically register its device MAC.
                </p>
              </div>
            </div>

            {observedMac && (
              <div className="pt-2 border-t border-amber-900/30">
                <span className="text-[11px] text-slate-400 uppercase tracking-wider block font-medium">
                  Currently Attempting Device
                </span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="font-mono text-sm font-semibold text-amber-200">
                    {observedMac}
                  </span>
                  <span className="text-[11px] text-amber-400">
                    (Ready to register upon next authentication)
                  </span>
                </div>
              </div>
            )}

            <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
              Have the subscriber power-cycle or connect their new CPE / router. The hardware MAC will be permanently authorized upon dial-in.
            </p>
          </div>
        ) : isBound ? (
          <div className="space-y-3 bg-slate-950/40 p-4 rounded-xl border border-slate-800/80">
            <div>
              <span className="text-[11px] text-slate-400 uppercase tracking-wider block font-medium">
                Authorized MAC
              </span>
              <span className="font-mono text-base font-bold text-purple-300 block tracking-wider mt-0.5">
                {customer.macAddress}
              </span>
            </div>

            {observedMac && (
              <div className="pt-2 border-t border-slate-800/80">
                <span className="text-[11px] text-slate-400 uppercase tracking-wider block font-medium">
                  Observed Dial-In Device
                </span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="font-mono text-sm font-semibold text-slate-200">
                    {observedMac}
                  </span>
                  {isMacMatch ? (
                    <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Device matches authorization</span>
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold text-rose-400 flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      <span>Mismatch detected</span>
                    </span>
                  )}
                </div>
              </div>
            )}

            <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
              This subscriber can authenticate only from the authorized MAC address. FreeRADIUS validates RADIUS Calling-Station-Id before establishing the PPPoE session.
            </p>
          </div>
        ) : (
          <div className="space-y-2 bg-slate-950/40 p-4 rounded-xl border border-slate-800/80">
            <span className="text-sm font-semibold text-slate-300 block">
              No MAC Restriction Active
            </span>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Subscriber can authenticate from any device or ONT equipment using their PPPoE credentials. You can bind an authorized hardware MAC address below to lock access.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <button
            type="button"
            onClick={onChangeMac}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs shadow-lg shadow-purple-600/20 transition-all min-h-[40px]"
          >
            <Edit className="h-3.5 w-3.5" />
            <span>{isPending ? 'Manual MAC Override' : isBound ? 'Change MAC' : 'Bind MAC Address'}</span>
          </button>

          {isBound && (
            <button
              type="button"
              onClick={onResetMac}
              disabled={isResetting}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 font-semibold text-xs transition-colors min-h-[40px] disabled:opacity-50"
              title="Reset MAC to auto-learn the next connected device"
            >
              <RotateCcw className={`h-3.5 w-3.5 text-amber-400 ${isResetting ? 'animate-spin' : ''}`} />
              <span>{isResetting ? 'Resetting...' : 'Reset MAC'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
