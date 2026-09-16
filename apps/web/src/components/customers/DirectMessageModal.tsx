'use client';

import React, { useState } from 'react';
import {
  X,
  MessageCircle,
  Mail,
  Send,
  ExternalLink,
  Sparkles,
} from 'lucide-react';

interface DirectMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: any;
  subscription?: any;
  initialChannel?: 'whatsapp' | 'email';
}

export function DirectMessageModal({
  isOpen,
  onClose,
  customer,
  subscription,
  initialChannel = 'whatsapp',
}: DirectMessageModalProps) {
  const [channel, setChannel] = useState<'whatsapp' | 'email'>(initialChannel);
  const [template, setTemplate] = useState('expiry');
  const [subject, setSubject] = useState('Notice regarding your Internet Connection');

  React.useEffect(() => {
    if (isOpen && initialChannel) {
      setChannel(initialChannel);
    }
  }, [isOpen, initialChannel]);

  const planName = subscription?.plan?.name || 'Broadband Plan';
  const expiryDate = subscription?.endDate
    ? new Date(subscription.endDate).toLocaleDateString()
    : 'soon';

  const defaultMessages: Record<string, string> = {
    expiry: `Hello ${customer?.name || 'Customer'}, this is a gentle reminder that your Internet plan (${planName}) is scheduled to expire on ${expiryDate}. Please renew your account to avoid service interruption. Thank you, CloudPay ISP.`,
    payment: `Dear ${customer?.name || 'Customer'}, you have a pending balance on your Internet account (${customer?.customerCode || ''}). Please clear your dues at the earliest or click your online payment link. Thank you.`,
    credentials: `Hello ${customer?.name || 'Customer'}, your PPPoE broadband account is active. Dial-in username: ${customer?.username || customer?.pppoeUsername || ''}. Bandwidth: ${subscription?.plan?.downloadSpeedMbps || 50} Mbps.`,
    custom: `Hello ${customer?.name || 'Customer'},\n\n`,
  };

  const [message, setMessage] = useState(defaultMessages.expiry);

  if (!isOpen) return null;

  const handleTemplateChange = (t: string) => {
    setTemplate(t);
    setMessage(defaultMessages[t] || defaultMessages.custom);
  };

  const handleSend = () => {
    if (channel === 'whatsapp') {
      const cleanMobile = (customer?.mobile || '').replace(/\D/g, '');
      const phoneParam = cleanMobile.length === 10 ? `91${cleanMobile}` : cleanMobile;
      const url = `https://wa.me/${phoneParam}?text=${encodeURIComponent(message)}`;
      window.open(url, '_blank');
    } else {
      const email = customer?.email || '';
      const url = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
      window.open(url, '_blank');
    }
    onClose();
  };

  const isMissingContact = channel === 'whatsapp' ? !customer?.mobile : !customer?.email;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden my-auto">
        {/* Sticky Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800 shrink-0 bg-slate-900">
          <div className="flex items-center gap-2.5">
            <MessageCircle className="h-5 w-5 text-emerald-400" />
            <div>
              <h3 className="text-base font-bold text-slate-100">Direct Customer Communication</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Send WhatsApp or Email notice directly to {customer?.name}
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

        {/* Body */}
        <div className="p-4 sm:p-6 space-y-4 text-xs overflow-y-auto flex-1 min-h-0">
          {/* Channel Selector */}
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-950 border border-slate-800">
            <button
              type="button"
              onClick={() => setChannel('whatsapp')}
              className={`flex items-center justify-center gap-2 py-2 rounded-lg font-semibold transition-colors min-h-[38px] ${
                channel === 'whatsapp'
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <MessageCircle className="h-4 w-4" />
              <span>WhatsApp ({customer?.mobile || 'No Mobile'})</span>
            </button>

            <button
              type="button"
              onClick={() => setChannel('email')}
              className={`flex items-center justify-center gap-2 py-2 rounded-lg font-semibold transition-colors min-h-[38px] ${
                channel === 'email'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Mail className="h-4 w-4" />
              <span>Email ({customer?.email ? 'On File' : 'No Email'})</span>
            </button>
          </div>

          {/* Configuration Notice */}
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-[11px] text-slate-400 space-y-1">
            <div className="font-semibold text-slate-300 flex items-center gap-1.5">
              <span>Provider Status:</span>
              <span className="text-amber-400">Direct Client Intent</span>
            </div>
            {channel === 'whatsapp' ? (
              <p className="leading-relaxed">
                Automated background WhatsApp Business API (e.g. WATI / Interakt) is not configured.
                Launching will open WhatsApp Web or Desktop app with this recipient and message pre-formatted.
              </p>
            ) : (
              <p className="leading-relaxed">
                Automated background SMTP / SES email worker is not configured.
                Launching will open your default email client (mailto:) with recipient, subject, and body pre-populated.
              </p>
            )}
          </div>

          {/* Missing Contact Alert */}
          {isMissingContact && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-[11px]">
              <strong>Missing Contact Information:</strong>{' '}
              {channel === 'whatsapp'
                ? 'Subscriber does not have a registered mobile number. Please edit their profile first.'
                : 'Subscriber does not have a registered email address. Please edit their profile first.'}
            </div>
          )}

          {/* Quick Template Selector */}
          <div className="space-y-1.5">
            <label className="text-slate-300 font-semibold block flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              <span>Message Preset Template</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => handleTemplateChange('expiry')}
                className={`p-2 rounded-lg border text-left truncate transition-colors ${
                  template === 'expiry'
                    ? 'bg-blue-950 border-blue-600 text-blue-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                Expiry Reminder
              </button>
              <button
                type="button"
                onClick={() => handleTemplateChange('payment')}
                className={`p-2 rounded-lg border text-left truncate transition-colors ${
                  template === 'payment'
                    ? 'bg-blue-950 border-blue-600 text-blue-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                Payment Due
              </button>
              <button
                type="button"
                onClick={() => handleTemplateChange('credentials')}
                className={`p-2 rounded-lg border text-left truncate transition-colors ${
                  template === 'credentials'
                    ? 'bg-blue-950 border-blue-600 text-blue-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                Credentials
              </button>
              <button
                type="button"
                onClick={() => handleTemplateChange('custom')}
                className={`p-2 rounded-lg border text-left truncate transition-colors ${
                  template === 'custom'
                    ? 'bg-blue-950 border-blue-600 text-blue-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                Custom Text
              </button>
            </div>
          </div>

          {channel === 'email' && (
            <div className="space-y-1.5">
              <label className="text-slate-300 font-semibold block">Email Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full min-h-[40px] bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-slate-100 text-xs focus:outline-none focus:border-blue-500"
              />
            </div>
          )}

          {/* Message Textarea */}
          <div className="space-y-1.5">
            <label className="text-slate-300 font-semibold block">Message Body</label>
            <textarea
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700/80 rounded-xl p-3 text-slate-100 text-xs focus:outline-none focus:border-emerald-500 leading-relaxed"
            />
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
            type="button"
            onClick={handleSend}
            disabled={isMissingContact}
            className={`min-h-[40px] px-5 py-2 rounded-xl text-white text-xs font-semibold shadow-lg inline-flex items-center gap-2 transition-all disabled:opacity-50 ${
              channel === 'whatsapp'
                ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/20'
                : 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/20'
            }`}
          >
            <Send className="h-3.5 w-3.5" />
            <span>Launch {channel === 'whatsapp' ? 'WhatsApp' : 'Email Client'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
