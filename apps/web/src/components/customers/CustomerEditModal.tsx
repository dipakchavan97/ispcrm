'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  User,
  Phone,
  Wifi,
  MapPin,
  FileCheck,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Eye,
  EyeOff,
  RefreshCw,
  AlertTriangle,
  Check,
  KeyRound,
  Trash2,
  Sparkles,
  Lock,
  Globe,
  Info,
  Network,
} from 'lucide-react';
import { CustomerStatus, normalizeMacAddress } from '@isp-crm/shared';
import { apiFetch } from '../../lib/api';

interface CustomerEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: any;
  connection?: any;
  onSave: (payload: any) => Promise<void>;
  isLoading?: boolean;
}

export function CustomerEditModal({
  isOpen,
  onClose,
  customer,
  connection,
  onSave,
  isLoading = false,
}: CustomerEditModalProps) {
  // Navigation / active section tab
  const [activeSection, setActiveSection] = useState<string>('all');

  // Form Fields State
  const [name, setName] = useState('');
  const [customerCode, setCustomerCode] = useState('');
  const [installationDate, setInstallationDate] = useState('');
  const [mobile, setMobile] = useState('');
  const [phone, setPhone] = useState('');
  const [alternatePhone, setAlternatePhone] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [pppoePassword, setPppoePassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [macAddress, setMacAddress] = useState('');
  const [normalizedMac, setNormalizedMac] = useState<string | null>(null);
  const [macError, setMacError] = useState<string | null>(null);
  const [staticIp, setStaticIp] = useState('');
  const [installationAddress, setInstallationAddress] = useState('');
  const [billingSameAsInstall, setBillingSameAsInstall] = useState(true);
  const [billingAddress, setBillingAddress] = useState('');
  const [area, setArea] = useState('');
  const [city, setCity] = useState('');
  const [stateVal, setStateVal] = useState('');
  const [pincode, setPincode] = useState('');
  const [gstin, setGstin] = useState('');
  const [aadhaarNumber, setAadhaarNumber] = useState('');
  const [status, setStatus] = useState<CustomerStatus>(CustomerStatus.ACTIVE);
  const [notes, setNotes] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [availableZones, setAvailableZones] = useState<any[]>([]);
  const [availableNodes, setAvailableNodes] = useState<any[]>([]);

  // UI state for confirmations
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showMacRemoveConfirm, setShowMacRemoveConfirm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Populate state when opening modal
  useEffect(() => {
    if (isOpen && customer) {
      setName(customer.name || '');
      setCustomerCode(customer.customerCode || '');
      setInstallationDate(
        customer.installationDate
          ? new Date(customer.installationDate).toISOString().split('T')[0]
          : ''
      );
      setMobile(customer.mobile || '');
      setPhone(customer.phone || '');
      setAlternatePhone(customer.alternatePhone || '');
      setEmail(customer.email || '');
      setUsername(customer.username || customer.pppoeUsername || '');
      // PPPoE Password MUST NEVER be populated from existing customer
      setPppoePassword('');
      setShowPassword(false);

      const rawMac = customer.macAddress || '';
      setMacAddress(rawMac);
      if (rawMac) {
        try {
          setNormalizedMac(normalizeMacAddress(rawMac));
        } catch {
          setNormalizedMac(null);
        }
      } else {
        setNormalizedMac(null);
      }
      setMacError(null);

      setStaticIp(customer.staticIp || '');
      const instAddr = customer.installationAddress || '';
      const billAddr = customer.address || '';
      setInstallationAddress(instAddr);
      setBillingAddress(billAddr);
      setBillingSameAsInstall(!billAddr || billAddr === instAddr);

      setArea(customer.area || '');
      setCity(customer.city || '');
      setStateVal(customer.state || '');
      setPincode(customer.pincode || '');
      setGstin(customer.gstin || '');
      setAadhaarNumber(customer.aadhaarNumber || '');
      setStatus(customer.status || CustomerStatus.ACTIVE);
      setNotes(customer.notes || '');
      setZoneId(customer.zoneId || '');
      setNodeId(customer.nodeId || '');

      setFormError(null);
      setFieldErrors({});
      setShowDiscardConfirm(false);
      setShowMacRemoveConfirm(false);
      setActiveSection('all');
    }
  }, [isOpen, customer]);

  useEffect(() => {
    if (isOpen) {
      apiFetch('/zones?limit=100')
        .then((res: any) => {
          setAvailableZones(res?.items || []);
        })
        .catch(() => {
          setAvailableZones([]);
        });
    }
  }, [isOpen]);

  useEffect(() => {
    if (zoneId) {
      apiFetch(`/zones/${zoneId}/nodes`)
        .then((res: any) => {
          setAvailableNodes(res?.items || []);
        })
        .catch(() => {
          setAvailableNodes([]);
        });
    } else {
      setAvailableNodes([]);
    }
  }, [zoneId]);

  // Check if form is dirty (has unsaved modifications)
  const isDirty = useMemo(() => {
    if (!customer) return false;
    const initialInstallAddr = customer.installationAddress || '';
    const initialBillAddr = customer.address || '';
    return (
      name !== (customer.name || '') ||
      mobile !== (customer.mobile || '') ||
      phone !== (customer.phone || '') ||
      alternatePhone !== (customer.alternatePhone || '') ||
      email !== (customer.email || '') ||
      username !== (customer.username || customer.pppoeUsername || '') ||
      pppoePassword.length > 0 ||
      macAddress !== (customer.macAddress || '') ||
      staticIp !== (customer.staticIp || '') ||
      installationAddress !== initialInstallAddr ||
      (billingSameAsInstall ? installationAddress : billingAddress) !== initialBillAddr ||
      area !== (customer.area || '') ||
      city !== (customer.city || '') ||
      stateVal !== (customer.state || '') ||
      pincode !== (customer.pincode || '') ||
      gstin !== (customer.gstin || '') ||
      aadhaarNumber !== (customer.aadhaarNumber || '') ||
      status !== customer.status ||
      notes !== (customer.notes || '') ||
      zoneId !== (customer.zoneId || '') ||
      nodeId !== (customer.nodeId || '')
    );
  }, [
    customer,
    name,
    mobile,
    phone,
    alternatePhone,
    email,
    username,
    pppoePassword,
    macAddress,
    staticIp,
    installationAddress,
    billingSameAsInstall,
    billingAddress,
    area,
    city,
    stateVal,
    pincode,
    gstin,
    aadhaarNumber,
    status,
    notes,
  ]);

  if (!isOpen || !customer) return null;

  const isOnline = connection?.isOnline ?? false;

  // Handle MAC address input changes
  const handleMacChange = (val: string) => {
    setMacAddress(val);
    if (!val.trim()) {
      setNormalizedMac(null);
      setMacError(null);
      return;
    }
    try {
      const canonical = normalizeMacAddress(val);
      setNormalizedMac(canonical);
      setMacError(null);
    } catch {
      setNormalizedMac(null);
      setMacError('Invalid MAC format (Expected AA:BB:CC:DD:EE:FF)');
    }
  };

  // Generate cryptographically secure random password
  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
    let result = '';
    const randomVals = new Uint32Array(10);
    crypto.getRandomValues(randomVals);
    for (let i = 0; i < 10; i++) {
      result += chars[randomVals[i] % chars.length];
    }
    setPppoePassword(result);
    setShowPassword(true);
  };

  // Handle close attempt with dirty check
  const handleAttemptClose = () => {
    if (isDirty) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  };

  // Form submission validation & execution
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const errors: Record<string, string> = {};

    // Validate Name
    if (!name.trim()) {
      errors.name = 'Customer full name is required.';
    }

    // Validate Mobile
    const cleanMobile = mobile.trim();
    if (!cleanMobile) {
      errors.mobile = 'Primary mobile number is required.';
    } else if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      errors.mobile = 'Enter a valid 10-digit Indian mobile number.';
    }

    // Validate Email
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = 'Enter a valid email address.';
    }

    // Validate Username
    const cleanUsername = username.trim();
    if (!cleanUsername) {
      errors.username = 'PPPoE username is required.';
    } else if (cleanUsername.length < 3) {
      errors.username = 'PPPoE username must be at least 3 characters.';
    }

    // Validate Password (if provided)
    if (pppoePassword && pppoePassword.length < 4) {
      errors.pppoePassword = 'New password must be at least 4 characters long.';
    }

    // Validate MAC
    let canonicalMac: string | null = null;
    if (macAddress.trim()) {
      try {
        canonicalMac = normalizeMacAddress(macAddress.trim());
      } catch {
        errors.macAddress = 'Invalid MAC address format (Accepts AA:BB:CC:DD:EE:FF).';
      }
    }

    // Validate GSTIN (if provided)
    if (gstin.trim() && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i.test(gstin.trim())) {
      errors.gstin = 'Invalid Indian GSTIN format (e.g. 27AAAAA0000A1Z5).';
    }

    // Validate Aadhaar (if provided)
    if (aadhaarNumber.trim() && !/^\d{12}$/.test(aadhaarNumber.trim())) {
      errors.aadhaarNumber = 'Aadhaar number must be exactly 12 digits.';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError('Please resolve the highlighted validation errors.');
      return;
    }

    // Construct Payload
    const effectiveBillingAddress = billingSameAsInstall
      ? (installationAddress.trim() || customer.address || '')
      : (billingAddress.trim() || installationAddress.trim() || customer.address || '');

    const payload: any = {
      name: name.trim(),
      mobile: cleanMobile,
      phone: phone.trim() || null,
      alternatePhone: alternatePhone.trim() || null,
      email: email.trim() || null,
      username: cleanUsername,
      installationAddress: installationAddress.trim() || null,
      address: effectiveBillingAddress,
      area: area.trim() || null,
      city: city.trim() || null,
      state: stateVal.trim() || null,
      pincode: pincode.trim() || null,
      staticIp: staticIp.trim() || null,
      gstin: gstin.trim() ? gstin.trim().toUpperCase() : null,
      aadhaarNumber: aadhaarNumber.trim() || null,
      status,
      notes: notes.trim() || null,
      zoneId: zoneId ? zoneId : null,
      nodeId: nodeId ? nodeId : null,
    };

    if (installationDate) {
      payload.installationDate = new Date(installationDate).toISOString();
    }

    // Only include pppoePassword if non-empty string
    if (pppoePassword && pppoePassword.trim().length > 0) {
      payload.pppoePassword = pppoePassword;
    }

    // MAC Address: Send normalized string or explicit null if cleared
    if (macAddress.trim()) {
      payload.macAddress = canonicalMac;
    } else {
      payload.macAddress = null;
    }

    try {
      await onSave(payload);
    } catch (err: any) {
      setFormError(err?.message || 'Failed to update customer profile. Please try again.');
    }
  };

  const sections = [
    { id: 'all', label: 'All Fields' },
    { id: 'personal', label: 'Personal', icon: User },
    { id: 'contact', label: 'Contact', icon: Phone },
    { id: 'service', label: 'Service & PPPoE', icon: Wifi },
    { id: 'address', label: 'Address', icon: MapPin },
    { id: 'kyc', label: 'Tax & KYC', icon: FileCheck },
    { id: 'settings', label: 'Settings & Notes', icon: Settings },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/85 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden my-auto">
        {/* Sticky Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800 shrink-0 bg-slate-900">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white font-bold flex items-center justify-center shrink-0 shadow-md shadow-blue-500/20">
              <User className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold text-slate-100 truncate">
                  Edit Customer Profile
                </h2>
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-blue-400 border border-slate-700">
                  {customer.customerCode}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                    isOnline
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                    }`}
                  />
                  {isOnline ? 'Online' : 'Offline'}
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate mt-0.5">
                {customer.name} • PPPoE:{' '}
                <span className="font-mono text-slate-300 font-medium">
                  {customer.username || customer.pppoeUsername}
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleAttemptClose}
            className="text-slate-400 hover:text-slate-200 p-2 min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg hover:bg-slate-800 transition-colors shrink-0"
            aria-label="Close edit profile modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Section Navigation Tabs */}
        <div className="flex items-center gap-1 px-4 sm:px-6 py-2 border-b border-slate-800/80 bg-slate-950/50 overflow-x-auto shrink-0 scrollbar-none text-xs">
          {sections.map((sec) => {
            const Icon = sec.icon;
            const isActive = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => setActiveSection(sec.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors min-h-[32px] ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                {Icon && <Icon className="h-3.5 w-3.5" />}
                <span>{sec.label}</span>
              </button>
            );
          })}
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="p-4 sm:p-6 space-y-6 text-xs overflow-y-auto flex-1 min-h-0">
            {/* Global Error Alert */}
            {formError && (
              <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/40 flex items-start gap-2.5 text-rose-300 text-xs">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-rose-400" />
                <span>{formError}</span>
              </div>
            )}

            {/* Active Session Warning Banner */}
            {isOnline && (
              <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/40 flex items-start gap-3 text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                <div className="space-y-0.5 text-xs">
                  <span className="font-bold text-amber-300 block">Customer is Currently Online</span>
                  <p className="text-[11px] text-amber-200/80 leading-relaxed">
                    Changing the PPPoE username, password, or authorized MAC address will update the
                    FreeRADIUS database. Changes will take effect on the customer’s next connection
                    dial-in or session renewal.
                  </p>
                </div>
              </div>
            )}

            {/* SECTION A: PERSONAL INFORMATION */}
            {(activeSection === 'all' || activeSection === 'personal') && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                  <User className="h-4 w-4 text-blue-400" />
                  <h3 className="font-bold text-slate-200 uppercase tracking-wider text-[11px]">
                    Personal Information
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Full Name */}
                  <div className="md:col-span-2">
                    <label className="text-slate-300 font-semibold block mb-1">
                      Customer Full Name <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Rahul Sharma"
                      className={`w-full min-h-[42px] bg-slate-950 border rounded-xl px-3 py-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                        fieldErrors.name ? 'border-rose-500' : 'border-slate-800'
                      }`}
                    />
                    {fieldErrors.name && (
                      <span className="text-rose-400 text-[10px] block mt-1">{fieldErrors.name}</span>
                    )}
                  </div>

                  {/* Customer Code (Read-Only) */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-slate-300 font-semibold block">Customer Code</label>
                      <span className="text-[10px] text-slate-400 flex items-center gap-1" title="Immutable identifier">
                        <Lock className="h-3 w-3 text-slate-400" /> Read-Only
                      </span>
                    </div>
                    <input
                      type="text"
                      disabled
                      value={customerCode}
                      className="w-full min-h-[42px] bg-slate-950/60 border border-slate-800/80 rounded-xl px-3 py-2 text-slate-400 font-mono cursor-not-allowed"
                    />
                    <span className="text-[10px] text-slate-400 block mt-1">
                      Customer code is tenant-immutable to protect ledger history.
                    </span>
                  </div>

                  {/* Installation Date */}
                  <div>
                    <label className="text-slate-300 font-semibold block mb-1">
                      Installation Date
                    </label>
                    <input
                      type="date"
                      value={installationDate}
                      onChange={(e) => setInstallationDate(e.target.value)}
                      className="w-full min-h-[42px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* SECTION B: CONTACT INFORMATION */}
            {(activeSection === 'all' || activeSection === 'contact') && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                  <Phone className="h-4 w-4 text-emerald-400" />
                  <h3 className="font-bold text-slate-200 uppercase tracking-wider text-[11px]">
                    Contact Information
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Primary Mobile */}
                  <div>
                    <label className="text-slate-300 font-semibold block mb-1">
                      Primary Mobile <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="tel"
                      value={mobile}
                      onChange={(e) => setMobile(e.target.value)}
                      placeholder="e.g. 9876543210"
                      maxLength={10}
                      className={`w-full min-h-[42px] bg-slate-950 border rounded-xl px-3 py-2 text-slate-100 font-mono placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                        fieldErrors.mobile ? 'border-rose-500' : 'border-slate-800'
                      }`}
                    />
                    {fieldErrors.mobile && (
                      <span className="text-rose-400 text-[10px] block mt-1">{fieldErrors.mobile}</span>
                    )}
                  </div>

                  {/* Alternate Phone */}
                  <div>
                    <label className="text-slate-300 font-semibold block mb-1">
                      Alternate Phone / Mobile
                    </label>
                    <input
                      type="tel"
                      value={alternatePhone}
                      onChange={(e) => setAlternatePhone(e.target.value)}
                      placeholder="e.g. 9876543211"
                      className="w-full min-h-[42px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  {/* Landline / Office Phone */}
                  <div>
                    <label className="text-slate-300 font-semibold block mb-1">Landline / Phone</label>
                    <input
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="e.g. 020-2567890"
                      className="w-full min-h-[42px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  {/* Email Address */}
                  <div className="md:col-span-2">
                    <label className="text-slate-300 font-semibold block mb-1">Email Address</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="e.g. customer@example.com"
                      className={`w-full min-h-[42px] bg-slate-950 border rounded-xl px-3 py-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                        fieldErrors.email ? 'border-rose-500' : 'border-slate-800'
                      }`}
                    />
                    {fieldErrors.email && (
                      <span className="text-rose-400 text-[10px] block mt-1">{fieldErrors.email}</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* SECTION C: SERVICE & PPPoE CREDENTIALS */}
            {(activeSection === 'all' || activeSection === 'service') && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                  <Wifi className="h-4 w-4 text-cyan-400" />
                  <h3 className="font-bold text-slate-200 uppercase tracking-wider text-[11px]">
                    Service & PPPoE Credentials
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* PPPoE Username */}
                  <div>
                    <label className="text-slate-300 font-semibold block mb-1">
                      PPPoE Username <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="e.g. user@ispcrm or username"
                      className={`w-full min-h-[42px] bg-slate-950 border rounded-xl px-3 py-2 text-emerald-400 font-mono font-semibold placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                        fieldErrors.username ? 'border-rose-500' : 'border-slate-800'
                      }`}
                    />
                    {fieldErrors.username ? (
                      <span className="text-rose-400 text-[10px] block mt-1">
                        {fieldErrors.username}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 block mt-1">
                        Changing username atomically migrates RADIUS authentication records and
                        purges the previous identity.
                      </span>
                    )}
                  </div>

                  {/* PPPoE Password */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-slate-300 font-semibold block">PPPoE Password</label>
                      <button
                        type="button"
                        onClick={generatePassword}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-400 hover:text-blue-300 transition-colors"
                        title="Generate strong random password"
                      >
                        <Sparkles className="h-3 w-3" />
                        <span>Generate Secure</span>
                      </button>
                    </div>

                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={pppoePassword}
                        onChange={(e) => setPppoePassword(e.target.value)}
                        placeholder="•••••••• (Leave blank to keep current password)"
                        className={`w-full min-h-[42px] bg-slate-950 border rounded-xl pl-3 pr-10 py-2 text-slate-100 font-mono placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                          fieldErrors.pppoePassword ? 'border-rose-500' : 'border-slate-800'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1 rounded-md"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {fieldErrors.pppoePassword ? (
                      <span className="text-rose-400 text-[10px] block mt-1">
                        {fieldErrors.pppoePassword}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 block mt-1">
                        Leave blank to preserve current password. Existing password is never exposed.
                      </span>
                    )}
                  </div>

                  {/* Authorized MAC Address */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-slate-300 font-semibold block">Authorized MAC Address</label>
                      {macAddress.trim() && (
                        <button
                          type="button"
                          onClick={() => setShowMacRemoveConfirm(true)}
                          className="text-[11px] text-rose-400 hover:text-rose-300 font-semibold inline-flex items-center gap-1"
                        >
                          <Trash2 className="h-3 w-3" />
                          <span>Remove Restriction</span>
                        </button>
                      )}
                    </div>

                    <div className="relative">
                      <input
                        type="text"
                        value={macAddress}
                        onChange={(e) => handleMacChange(e.target.value)}
                        placeholder="e.g. 0A:F8:44:0E:8C:17"
                        className={`w-full min-h-[42px] bg-slate-950 border rounded-xl pl-3 pr-8 py-2 font-mono uppercase text-purple-300 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                          macError || fieldErrors.macAddress ? 'border-rose-500' : 'border-slate-800'
                        }`}
                      />
                      <div className="absolute right-2.5 top-1/2 -translate-y-1/2" title={normalizedMac ? 'Valid MAC format' : 'No MAC lock'}>
                        {normalizedMac ? (
                          <ShieldCheck className="h-4 w-4 text-purple-400" />
                        ) : (
                          <ShieldAlert className="h-4 w-4 text-slate-500" />
                        )}
                      </div>
                    </div>

                    {macError || fieldErrors.macAddress ? (
                      <span className="text-rose-400 text-[10px] block mt-1">
                        {macError || fieldErrors.macAddress}
                      </span>
                    ) : normalizedMac ? (
                      <span className="text-[10px] text-purple-400 block mt-1 font-mono">
                        Enforced as: {normalizedMac} (FreeRADIUS Calling-Station-Id ==)
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 block mt-1">
                        Locks dial-in strictly to this CPE hardware. Leave blank for unconstrained dial-in.
                      </span>
                    )}
                  </div>

                  {/* Static IP Address */}
                  <div>
                    <label className="text-slate-300 font-semibold block mb-1">
                      Static IP (Framed-IP-Address)
                    </label>
                    <input
                      type="text"
                      value={staticIp}
                      onChange={(e) => setStaticIp(e.target.value)}
                      placeholder="e.g. 10.100.1.25"
                      className="w-full min-h-[42px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <span className="text-[10px] text-slate-400 block mt-1">
                      Assigns fixed Framed-IP-Address upon PPPoE session establishment.
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* SECTION D: ADDRESS */}
            {(activeSection === 'all' || activeSection === 'address') && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                  <MapPin className="h-4 w-4 text-indigo-400" />
                  <h3 className="font-bold text-slate-200 uppercase tracking-wider text-[11px]">
                    Installation & Billing Address
                  </h3>
                </div>

                <div className="space-y-4">
                  {/* Installation Address */}
                  <div>
                    <label className="text-slate-300 font-semibold block mb-1">
                      Installation Address (Service Premises)
                    </label>
                    <input
                      type="text"
                      value={installationAddress}
                      onChange={(e) => {
                        setInstallationAddress(e.target.value);
                        if (billingSameAsInstall) {
                          setBillingAddress(e.target.value);
                        }
                      }}
                      placeholder="e.g. Flat 402, Building B, Green Palms Society"
                      className="w-full min-h-[42px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  {/* Mirror Checkbox */}
                  <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={billingSameAsInstall}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setBillingSameAsInstall(checked);
                        if (checked) {
                          setBillingAddress(installationAddress);
                        }
                      }}
                      className="h-4 w-4 rounded bg-slate-950 border-slate-700 text-blue-600 focus:ring-0 focus:ring-offset-0"
                    />
                    <span className="text-xs text-slate-300 font-medium">
                      Billing address is the same as installation address
                    </span>
                  </label>

                  {/* Billing Address (if distinct) */}
                  {!billingSameAsInstall && (
                    <div>
                      <label className="text-slate-300 font-semibold block mb-1">
                        Billing Address (Official Invoice Address)
                      </label>
                      <input
                        type="text"
                        value={billingAddress}
                        onChange={(e) => setBillingAddress(e.target.value)}
                        placeholder="e.g. Registered Corporate Office, baner Road"
                        className="w-full min-h-[42px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  )}

                  {/* Geographic Details */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="text-slate-300 font-semibold block mb-1">Area / Locality</label>
                      <input
                        type="text"
                        value={area}
                        onChange={(e) => setArea(e.target.value)}
                        placeholder="e.g. Kothrud"
                        className="w-full min-h-[42px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="text-slate-300 font-semibold block mb-1">City</label>
                      <input
                        type="text"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        placeholder="e.g. Pune"
                        className="w-full min-h-[42px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="text-slate-300 font-semibold block mb-1">State</label>
                      <input
                        type="text"
                        value={stateVal}
                        onChange={(e) => setStateVal(e.target.value)}
                        placeholder="e.g. Maharashtra"
                        className="w-full min-h-[42px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="text-slate-300 font-semibold block mb-1">Pincode</label>
                      <input
                        type="text"
                        value={pincode}
                        onChange={(e) => setPincode(e.target.value)}
                        placeholder="e.g. 411038"
                        maxLength={6}
                        className="w-full min-h-[42px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  {/* Coverage Zone & Distribution Node */}
                  <div className="pt-3 border-t border-slate-800/80">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-2 flex items-center gap-1.5">
                      <Network className="h-3.5 w-3.5 text-blue-400" />
                      <span>Coverage Zone & Distribution Node</span>
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-slate-300 font-semibold block mb-1">Coverage Zone</label>
                        <select
                          value={zoneId}
                          onChange={(e) => {
                            setZoneId(e.target.value);
                            setNodeId('');
                          }}
                          className="w-full min-h-[42px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="">— Optional / No Zone Assigned —</option>
                          {availableZones.map((z) => (
                            <option key={z.id} value={z.id}>
                              {z.name} ({z._count?.nodes ?? 0} nodes)
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-slate-300 font-semibold block mb-1">Distribution Node</label>
                        <select
                          value={nodeId}
                          onChange={(e) => {
                            const chosenNodeId = e.target.value;
                            setNodeId(chosenNodeId);
                            if (chosenNodeId && !zoneId) {
                              const found = availableNodes.find((n) => n.id === chosenNodeId);
                              if (found?.zoneId) {
                                setZoneId(found.zoneId);
                              }
                            }
                          }}
                          disabled={!zoneId && availableNodes.length === 0}
                          className="w-full min-h-[42px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                        >
                          <option value="">
                            {zoneId ? '— Optional / No Node Assigned —' : '— Select Zone First —'}
                          </option>
                          {availableNodes.map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.name} ({n.status})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SECTION E: TAX & KYC */}
            {(activeSection === 'all' || activeSection === 'kyc') && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                  <FileCheck className="h-4 w-4 text-purple-400" />
                  <h3 className="font-bold text-slate-200 uppercase tracking-wider text-[11px]">
                    Tax & KYC Identification
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* GSTIN */}
                  <div>
                    <label className="text-slate-300 font-semibold block mb-1">
                      GSTIN (Goods & Services Tax ID)
                    </label>
                    <input
                      type="text"
                      value={gstin}
                      onChange={(e) => setGstin(e.target.value.toUpperCase())}
                      placeholder="e.g. 27AAAAA0000A1Z5"
                      maxLength={15}
                      className={`w-full min-h-[42px] bg-slate-950 border rounded-xl px-3 py-2 font-mono uppercase text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                        fieldErrors.gstin ? 'border-rose-500' : 'border-slate-800'
                      }`}
                    />
                    {fieldErrors.gstin ? (
                      <span className="text-rose-400 text-[10px] block mt-1">
                        {fieldErrors.gstin}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 block mt-1">
                        Printed on Indian GST tax invoices for B2B input tax credit.
                      </span>
                    )}
                  </div>

                  {/* Aadhaar Number */}
                  <div>
                    <label className="text-slate-300 font-semibold block mb-1">
                      Aadhaar Card Number
                    </label>
                    <input
                      type="text"
                      value={aadhaarNumber}
                      onChange={(e) => setAadhaarNumber(e.target.value.replace(/\D/g, ''))}
                      placeholder="e.g. 123456789012"
                      maxLength={12}
                      className={`w-full min-h-[42px] bg-slate-950 border rounded-xl px-3 py-2 font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                        fieldErrors.aadhaarNumber ? 'border-rose-500' : 'border-slate-800'
                      }`}
                    />
                    {fieldErrors.aadhaarNumber ? (
                      <span className="text-rose-400 text-[10px] block mt-1">
                        {fieldErrors.aadhaarNumber}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 block mt-1">
                        12-digit Indian national identity number for telecom KYC verification.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* SECTION F: SETTINGS & NOTES */}
            {(activeSection === 'all' || activeSection === 'settings') && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                  <Settings className="h-4 w-4 text-amber-400" />
                  <h3 className="font-bold text-slate-200 uppercase tracking-wider text-[11px]">
                    Account Lifecycle & Operator Notes
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Account Status */}
                  <div>
                    <label className="text-slate-300 font-semibold block mb-1">
                      Subscriber Status
                    </label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as CustomerStatus)}
                      className="w-full min-h-[42px] bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value={CustomerStatus.ACTIVE}>ACTIVE</option>
                      <option value={CustomerStatus.PENDING}>PENDING</option>
                      <option value={CustomerStatus.SUSPENDED}>SUSPENDED</option>
                      <option value={CustomerStatus.EXPIRED}>EXPIRED</option>
                      <option value={CustomerStatus.TERMINATED}>TERMINATED</option>
                    </select>
                    <span className="text-[10px] text-slate-400 block mt-1">
                      Transitions respect FreeRADIUS locks, CoA Disconnect, and lifecycle FSM.
                    </span>
                  </div>

                  {/* Notes */}
                  <div className="md:col-span-2">
                    <label className="text-slate-300 font-semibold block mb-1">
                      Operator Notes & Premises Details
                    </label>
                    <textarea
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="e.g. Router mounted near balcony, customer requested evening installation, etc."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Sticky Footer */}
          <div className="flex items-center justify-between gap-3 p-4 sm:p-5 border-t border-slate-800 shrink-0 bg-slate-900/95 backdrop-blur">
            <div className="text-[11px] text-slate-400 hidden sm:block">
              {isDirty ? (
                <span className="inline-flex items-center gap-1 text-amber-400 font-semibold">
                  <Info className="h-3.5 w-3.5" />
                  <span>Unsaved changes</span>
                </span>
              ) : (
                <span>No unsaved modifications</span>
              )}
            </div>

            <div className="flex items-center gap-3 ml-auto">
              <button
                type="button"
                onClick={handleAttemptClose}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={isLoading}
                className="flex items-center justify-center gap-2 min-h-[40px] px-6 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/20 disabled:opacity-50 transition-all"
              >
                {isLoading && <RefreshCw className="h-4 w-4 animate-spin" />}
                <span>{isLoading ? 'Saving Changes...' : 'Save Changes'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Discard Changes Warning Dialog */}
      {showDiscardConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-400">
              <AlertTriangle className="h-5 w-5" />
              <h4 className="font-bold text-slate-100 text-sm">Discard Unsaved Changes?</h4>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              You have unsaved edits on this customer profile. Leaving now will discard all your changes.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowDiscardConfirm(false)}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Continue Editing
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDiscardConfirm(false);
                  onClose();
                }}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md shadow-rose-600/20"
              >
                Discard Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove MAC Restriction Confirmation Dialog */}
      {showMacRemoveConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <ShieldAlert className="h-5 w-5" />
              <h4 className="font-bold text-slate-100 text-sm">Remove MAC Restriction?</h4>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Removing the authorized MAC address will permit this subscriber account to authenticate
              from <strong>any device or router</strong>. Calling-Station-Id enforcement will be
              disabled in FreeRADIUS.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowMacRemoveConfirm(false)}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Keep Restriction
              </button>
              <button
                type="button"
                onClick={() => {
                  setMacAddress('');
                  setNormalizedMac(null);
                  setMacError(null);
                  setShowMacRemoveConfirm(false);
                }}
                className="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md shadow-rose-600/20"
              >
                Confirm Removal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
