import React, { useState } from 'react';
import MediFindLogo from './MediFindLogo';

/**
 * Centered Circular Footer — Adapted faithfully from 21st.dev Stacked Circular Footer reference.
 *
 * Preserves the reference's:
 * - Overall centered composition & visual symmetry
 * - MediFind brand & neutral factual product mission
 * - Centered navigation arrangement with subtle bullet separators
 * - Circular social/action icon treatment with smooth Apple-like hover/spring physics
 * - Email / subscribe pill interaction for network updates
 * - Typography hierarchy and clean surface treatment
 * - Strict removal of fabricated network metrics and fake hotline cards
 */
export default function Footer({ onNavigate, role = 'PATIENT' }) {
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');

  const handleSubscribe = (e) => {
    e.preventDefault();
    if (email && email.includes('@')) {
      setNotice('Email update service will launch with verified pharmacy integration in Phase 6.1H.');
      setTimeout(() => setNotice(''), 5000);
      setEmail('');
    }
  };

  // Circular action icons with Apple-like micro-motion & spring hover
  const circularActions = [
    {
      id: 'pharmacies',
      label: 'Pharmacy Directory',
      icon: 'storefront',
      onClick: () => onNavigate && onNavigate('pharmacies'),
      title: 'Browse accredited community pharmacies'
    },
    {
      id: 'emergency',
      label: '24/7 Duty Locator',
      icon: 'local_hospital',
      onClick: () => onNavigate && onNavigate('emergency'),
      title: 'Find active duty and emergency pharmacies'
    },
    {
      id: 'prescription',
      label: 'Prescription OCR',
      icon: 'document_scanner',
      onClick: () => onNavigate && onNavigate('prescription'),
      title: 'Digital prescription scanning & validation'
    },
    {
      id: 'orders',
      label: 'Fulfillment Tracking',
      icon: 'package_2',
      onClick: () => onNavigate && onNavigate('orders'),
      title: 'Order status & counter verification'
    },
    {
      id: 'profile',
      label: 'Account & Security',
      icon: 'manage_accounts',
      onClick: () => onNavigate && onNavigate('profile'),
      title: 'Patient profile and security preferences'
    }
  ];

  return (
    <footer className="mt-auto border-t border-[#e0e8e5] bg-[#f7faf9]/95 backdrop-blur-md pt-12 pb-8 px-4 sm:px-6 lg:px-8 text-on-surface">
      <div className="max-w-4xl mx-auto flex flex-col items-center text-center">
        
        {/* 1. Centered Brand & Factual Tagline */}
        <div className="flex flex-col items-center gap-2.5 mb-6">
          <MediFindLogo size="lg" showSubtitle={false} />
          <p className="text-xs sm:text-sm text-on-surface-variant max-w-md font-medium leading-relaxed">
            Prescription-based medicine access and pharmacy discovery across local communities.
          </p>
        </div>

        {/* 2. Centered Navigation Arrangement */}
        {role === 'PATIENT' ? (
          <nav aria-label="Footer navigation" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-semibold text-on-surface-variant mb-8">
            <button
              type="button"
              onClick={() => onNavigate && onNavigate('medicines')}
              className="hover:text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md px-1 py-0.5 cursor-pointer"
            >
              Medicine Search
            </button>
            <span className="text-outline-variant/40" aria-hidden="true">&bull;</span>
            <button
              type="button"
              onClick={() => onNavigate && onNavigate('prescription')}
              className="hover:text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md px-1 py-0.5 cursor-pointer"
            >
              Prescription OCR
            </button>
            <span className="text-outline-variant/40" aria-hidden="true">&bull;</span>
            <button
              type="button"
              onClick={() => onNavigate && onNavigate('pharmacies')}
              className="hover:text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md px-1 py-0.5 cursor-pointer"
            >
              Pharmacy Discovery
            </button>
            <span className="text-outline-variant/40" aria-hidden="true">&bull;</span>
            <button
              type="button"
              onClick={() => onNavigate && onNavigate('emergency')}
              className="hover:text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md px-1 py-0.5 cursor-pointer"
            >
              24/7 Emergency Locator
            </button>
            <span className="text-outline-variant/40" aria-hidden="true">&bull;</span>
            <button
              type="button"
              onClick={() => onNavigate && onNavigate('orders')}
              className="hover:text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md px-1 py-0.5 cursor-pointer"
            >
              My Orders &amp; Tracking
            </button>
            <span className="text-outline-variant/40" aria-hidden="true">&bull;</span>
            <button
              type="button"
              onClick={() => onNavigate && onNavigate('profile')}
              className="hover:text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md px-1 py-0.5 cursor-pointer"
            >
              Patient Profile
            </button>
          </nav>
        ) : (
          <nav aria-label="Portal navigation" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-semibold text-on-surface-variant mb-8">
            <span>Specialist Operations Center</span>
            <span className="text-outline-variant/40" aria-hidden="true">&bull;</span>
            <span>Inventory Verification</span>
            <span className="text-outline-variant/40" aria-hidden="true">&bull;</span>
            <span>Role-Based Audit Logging</span>
          </nav>
        )}

        {/* 3. Circular Action / Resource Icon Treatment (Reference Circular Pattern) */}
        <div className="flex items-center justify-center gap-3 mb-8" aria-label="Quick Actions">
          {circularActions.map(action => (
            <button
              key={action.id}
              type="button"
              onClick={action.onClick}
              title={action.title}
              aria-label={action.label}
              className="w-11 h-11 rounded-full bg-white border border-[#dbe6e1] text-[#032f28] shadow-xs flex items-center justify-center hover:bg-[#e0f2eb] hover:border-[#b0ecdd] hover:scale-110 active:scale-95 transition-all duration-200 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="material-symbols-outlined text-[20px]">{action.icon}</span>
            </button>
          ))}
        </div>

        {/* 4. Email / Subscribe Interaction (Reference Email Subscribe Style) */}
        <div className="w-full max-w-sm mb-10">
          <form onSubmit={handleSubscribe} className="relative flex items-center">
            <div className="relative w-full flex items-center rounded-full bg-white border border-[#dbe6e1] p-1.5 shadow-xs focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all">
              <span className="material-symbols-outlined text-outline text-[18px] ml-2.5 mr-1 shrink-0" aria-hidden="true">
                mail
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Stay updated on pharmacy access..."
                aria-label="Email address for network updates"
                className="w-full bg-transparent text-xs text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none px-1"
              />
              <button
                type="submit"
                aria-label="Submit email address"
                className="w-8 h-8 rounded-full bg-primary hover:bg-primary-container text-white flex items-center justify-center shrink-0 transition-transform active:scale-90 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">
                  arrow_forward
                </span>
              </button>
            </div>
          </form>
          {notice && (
            <p className="text-[11px] text-secondary font-medium mt-1.5 animate-in fade-in">
              {notice}
            </p>
          )}
        </div>

        {/* 5. Subtle Separator */}
        <div className="w-full max-w-xl h-px bg-outline-variant/30 mb-6" />

        {/* 6. Clean, Neutral Legal & Disclosure Block */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 w-full max-w-2xl text-[11px] text-on-surface-variant font-medium">
          <div>
            &copy; 2026 MediFind AI &bull; Prescription-based medicine access and pharmacy discovery
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200/60 text-emerald-800 text-[10px] font-semibold">
              Participating Pharmacies &bull; Academic Project
            </span>
          </div>
        </div>

      </div>
    </footer>
  );
}
