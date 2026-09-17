'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Radio, ArrowRight, Eye, EyeOff, Building2, User, Mail, Lock, Phone, MapPin, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { getAuthToken, setAuthToken, getApiBase } from '../../lib/api';

export default function RegisterPage() {
  const router = useRouter();

  // Form State
  const [orgName, setOrgName] = useState('');
  const [slug, setSlug] = useState('');
  const [legalName, setLegalName] = useState('');
  const [orgEmail, setOrgEmail] = useState('');
  const [orgPhone, setOrgPhone] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [gstin, setGstin] = useState('');

  // Owner State
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // UI State
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const token = getAuthToken();
    if (token) {
      router.replace('/dashboard');
    }
  }, [router]);

  // Auto-slug generator from organization name
  const handleOrgNameChange = (val: string) => {
    setOrgName(val);
    const generatedSlug = val
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-');
    setSlug(generatedSlug);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Validation
    if (!orgName.trim() || orgName.trim().length < 2) {
      setErrorMessage('ISP / Organization name must be at least 2 characters.');
      return;
    }
    if (!slug.trim() || !/^[a-z0-9-]+$/.test(slug)) {
      setErrorMessage('Tenant slug must contain only lowercase letters, numbers, and hyphens.');
      return;
    }
    if (!orgEmail.trim() || !orgEmail.includes('@')) {
      setErrorMessage('Please enter a valid organization contact email.');
      return;
    }
    if (!orgPhone.trim() || orgPhone.trim().length < 10) {
      setErrorMessage('Please enter a valid 10-digit phone number.');
      return;
    }
    if (!ownerName.trim() || ownerName.trim().length < 2) {
      setErrorMessage('Owner name must be at least 2 characters.');
      return;
    }
    if (!ownerEmail.trim() || !ownerEmail.includes('@')) {
      setErrorMessage('Please enter a valid owner login email.');
      return;
    }
    if (!ownerPassword || ownerPassword.length < 6) {
      setErrorMessage('Owner password must be at least 6 characters.');
      return;
    }
    if (gstin && gstin.trim().length !== 15) {
      setErrorMessage('GSTIN must be exactly 15 characters if provided.');
      return;
    }

    setLoading(true);

    try {
      const apiBase = getApiBase();
      const payload = {
        name: orgName.trim(),
        slug: slug.trim(),
        legalName: legalName.trim() || undefined,
        gstin: gstin.trim() || undefined,
        email: orgEmail.trim(),
        phone: orgPhone.trim(),
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        ownerName: ownerName.trim(),
        ownerEmail: ownerEmail.trim(),
        ownerPassword,
      };

      const res = await fetch(`${apiBase}/auth/register-org`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok || data.success === false) {
        const msg =
          data.error?.message ||
          data.message ||
          'Failed to register ISP organization. Please verify your details.';
        setErrorMessage(Array.isArray(msg) ? msg.join(', ') : msg);
        setLoading(false);
        return;
      }

      const token = data.data?.accessToken;
      if (token) {
        setAuthToken(token);
        setSuccess(true);
        setTimeout(() => {
          router.push('/dashboard');
        }, 800);
      } else {
        // Registration succeeded, redirect to login
        router.push('/login?registered=true');
      }
    } catch (err: any) {
      setErrorMessage(
        err.message?.includes('fetch') || err.message?.includes('Network')
          ? 'Network error. Check if the ISP CRM API server is reachable.'
          : err.message || 'An unexpected error occurred during registration.'
      );
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070d1e] flex flex-col justify-center py-8 sm:py-12 px-3 sm:px-6 lg:px-8 text-slate-100 overflow-x-hidden">
      <div className="sm:mx-auto sm:w-full sm:max-w-xl px-1">
        <div className="flex justify-center items-center gap-3">
          <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold shadow-lg shadow-blue-500/30 shrink-0">
            <Radio className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2">
              ISP CRM
              <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
                SaaS Onboarding
              </span>
            </h1>
            <p className="text-xs text-slate-400 truncate">Create New ISP Organization & Owner Account</p>
          </div>
        </div>

        <div className="mt-6 sm:mt-8 bg-[#0b132b]/80 backdrop-blur-xl border border-slate-800 rounded-2xl p-5 sm:p-8 shadow-2xl shadow-black/60">
          {errorMessage && (
            <div className="mb-6 p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-start gap-3 text-rose-400 text-xs sm:text-sm animate-in fade-in duration-200">
              <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5 text-rose-400" />
              <div className="flex-1 font-medium">{errorMessage}</div>
            </div>
          )}

          {success && (
            <div className="mb-6 p-3.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-start gap-3 text-emerald-400 text-xs sm:text-sm animate-in fade-in duration-200">
              <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5 text-emerald-400" />
              <div className="flex-1 font-medium">ISP Organization registered successfully! Redirecting to dashboard...</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Section 1: ISP Details */}
            <div>
              <h2 className="text-sm font-semibold text-blue-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Building2 className="h-4 w-4" /> ISP Organization Details
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    ISP / Business Name <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={orgName}
                    onChange={(e) => handleOrgNameChange(e.target.value)}
                    placeholder="e.g. Apex Broadband Solutions"
                    className="block w-full px-3 py-2.5 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Tenant Slug <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    placeholder="apex-broadband"
                    className="block w-full px-3 py-2.5 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">Unique identifier for tenant isolation</span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Support / Contact Phone <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="tel"
                    required
                    value={orgPhone}
                    onChange={(e) => setOrgPhone(e.target.value)}
                    placeholder="+919876543210"
                    className="block w-full px-3 py-2.5 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Organization Email <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={orgEmail}
                    onChange={(e) => setOrgEmail(e.target.value)}
                    placeholder="contact@apexisp.com"
                    className="block w-full px-3 py-2.5 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    GSTIN (Optional)
                  </label>
                  <input
                    type="text"
                    maxLength={15}
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value.toUpperCase())}
                    placeholder="27ABCDE1234F1Z5"
                    className="block w-full px-3 py-2.5 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono uppercase"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    City
                  </label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="e.g. Pune"
                    className="block w-full px-3 py-2.5 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    State
                  </label>
                  <input
                    type="text"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    placeholder="e.g. Maharashtra"
                    className="block w-full px-3 py-2.5 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Section 2: Owner Account */}
            <div className="pt-4 border-t border-slate-800/80">
              <h2 className="text-sm font-semibold text-blue-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <User className="h-4 w-4" /> Primary ISP Owner Account
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Owner Full Name <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="e.g. Rajesh Patil"
                    className="block w-full px-3 py-2.5 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Owner Login Email <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                    placeholder="rajesh@apexisp.com"
                    className="block w-full px-3 py-2.5 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Owner Password <span className="text-rose-400">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={ownerPassword}
                      onChange={(e) => setOwnerPassword(e.target.value)}
                      placeholder="••••••••"
                      className="block w-full pl-3 pr-10 py-2.5 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-slate-300"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || success}
              className="w-full flex justify-center items-center gap-2 py-3 px-4 rounded-lg shadow-lg shadow-blue-600/30 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Creating ISP Tenant Organization...</span>
                </>
              ) : (
                <>
                  <span>Create ISP Organization & Get Started</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-slate-800/80 text-center flex flex-col gap-2">
            <p className="text-xs text-slate-400">
              Already have an operator account?{' '}
              <Link href="/login" className="text-blue-400 hover:text-blue-300 font-medium underline">
                Sign In to Console
              </Link>
            </p>
            <p className="text-[11px] text-slate-500">
              Multi-tenant architecture • Direct ISP onboarding • No Super Admin approval required
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
