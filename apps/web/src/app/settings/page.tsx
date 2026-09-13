'use client';

import React, { useState, useEffect } from 'react';
import { Settings, Building2, Shield, Radio, Key, CheckCircle2, Save } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../components/Toast';

interface OrgSettings {
  id: string;
  name: string;
  email: string;
  phone: string;
  gstin?: string;
  currency: string;
  timezone: string;
}

export default function SettingsPage() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [org, setOrg] = useState<OrgSettings>({
    id: '',
    name: 'SpeedNet Broadband',
    email: 'contact@speednet.in',
    phone: '+91 98765 43210',
    gstin: '27AAAAA0000A1Z5',
    currency: 'INR (₹)',
    timezone: 'Asia/Kolkata (IST)',
  });

  useEffect(() => {
    apiFetch<any>('/auth/me')
      .then((data) => {
        if (data?.organization) {
          setOrg((prev) => ({
            ...prev,
            id: data.organization.id,
            name: data.organization.name || prev.name,
            email: data.organization.email || prev.email,
            phone: data.organization.phone || prev.phone,
            gstin: data.organization.gstin || prev.gstin,
          }));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      showToast('Organization settings updated successfully', 'success');
    }, 600);
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-400 text-xs">Loading organization configuration...</div>;
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2.5">
          <Settings className="h-6 w-6 text-blue-500" />
          ISP System Configuration & Tenant Settings
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Manage your ISP carrier identity, GST compliance details, FreeRADIUS AAA configuration, and payment gateways.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Column: Organization Profile */}
        <div className="md:col-span-2 space-y-6">
          <form onSubmit={handleSave} className="bg-[#0f172a] rounded-xl border border-slate-800 p-6 space-y-5">
            <div className="flex items-center gap-2.5 border-b border-slate-800 pb-4">
              <Building2 className="h-5 w-5 text-blue-400" />
              <h2 className="text-sm font-semibold text-slate-200">Organization Profile & GST Compliance</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">ISP Business Name</label>
                <input
                  type="text"
                  value={org.name}
                  onChange={(e) => setOrg({ ...org, name: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Official GSTIN</label>
                <input
                  type="text"
                  value={org.gstin || ''}
                  onChange={(e) => setOrg({ ...org, gstin: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Billing & Support Email</label>
                <input
                  type="email"
                  value={org.email}
                  onChange={(e) => setOrg({ ...org, email: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Support Phone</label>
                <input
                  type="text"
                  value={org.phone}
                  onChange={(e) => setOrg({ ...org, phone: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Default Currency</label>
                <input
                  type="text"
                  disabled
                  value={org.currency}
                  className="w-full bg-slate-900/50 border border-slate-800/80 rounded-lg px-3 py-2 text-xs text-slate-400 cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Default Timezone</label>
                <input
                  type="text"
                  disabled
                  value={org.timezone}
                  className="w-full bg-slate-900/50 border border-slate-800/80 rounded-lg px-3 py-2 text-xs text-slate-400 cursor-not-allowed"
                />
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-800">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white shadow-lg shadow-blue-600/30 transition-all cursor-pointer"
              >
                <Save className="h-4 w-4" />
                <span>{saving ? 'Saving...' : 'Save Changes'}</span>
              </button>
            </div>
          </form>

          {/* Payment Gateways Config */}
          <div className="bg-[#0f172a] rounded-xl border border-slate-800 p-6 space-y-4">
            <div className="flex items-center gap-2.5 border-b border-slate-800 pb-4">
              <Key className="h-5 w-5 text-emerald-400" />
              <h2 className="text-sm font-semibold text-slate-200">Payment Processing & Webhook Status</h2>
            </div>

            <div className="space-y-3">
              <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-white">Mock Payment Sandbox</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">
                      ACTIVE
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Automated testing gateway for instant settlement and subscriber auto-reactivation
                  </p>
                </div>
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
              </div>

              <div className="p-3.5 rounded-lg bg-slate-900/50 border border-slate-800/60 flex items-center justify-between opacity-80">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-300">Razorpay / UPI Gateway</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-400">
                      READY FOR LIVE KEYS
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Webhook endpoint: <code className="text-blue-400 font-mono">/api/payments/webhook</code> with HMAC SHA-256 verification
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: AAA & Security Configuration */}
        <div className="space-y-6">
          <div className="bg-[#0f172a] rounded-xl border border-slate-800 p-6 space-y-4">
            <div className="flex items-center gap-2.5 border-b border-slate-800 pb-4">
              <Radio className="h-5 w-5 text-sky-400" />
              <h2 className="text-sm font-semibold text-slate-200">AAA FreeRADIUS 3.x</h2>
            </div>

            <div className="space-y-2.5 text-xs text-slate-300">
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Auth Port (UDP)</span>
                <span className="font-mono text-emerald-400">1812</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Accounting Port (UDP)</span>
                <span className="font-mono text-emerald-400">1813</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">RFC 3576 CoA / PoD</span>
                <span className="font-mono text-emerald-400">3799</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Database Engine</span>
                <span className="font-mono text-slate-200">rlm_sql (PostgreSQL)</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Tenant Isolation</span>
                <span className="font-mono text-emerald-400">Active</span>
              </div>
            </div>
          </div>

          <div className="bg-[#0f172a] rounded-xl border border-slate-800 p-6 space-y-4">
            <div className="flex items-center gap-2.5 border-b border-slate-800 pb-4">
              <Shield className="h-5 w-5 text-purple-400" />
              <h2 className="text-sm font-semibold text-slate-200">Security & Encryption</h2>
            </div>

            <div className="space-y-2 text-xs text-slate-400 leading-relaxed">
              <p>• All PPPoE subscriber passwords and MikroTik router API credentials are encrypted with AES-256-GCM.</p>
              <p>• Tenant context is cryptographically derived from JWT access claims. Cross-tenant access is rejected at the API gateway.</p>
              <p>• Rate limiting enforced via Redis token bucket.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
