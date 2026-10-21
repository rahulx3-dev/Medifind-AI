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

  // Dynamic role-specific configurations
  const roleConfig = {
    PATIENT: {
      tagline: 'Prescription-based medicine access and pharmacy discovery across local communities.',
      navLinks: [
        { id: 'medicines', label: 'Medicine Search' },
        { id: 'prescription', label: 'Prescription OCR' },
        { id: 'pharmacies', label: 'Pharmacy Discovery' },
        { id: 'emergency', label: '24/7 Emergency Locator' },
        { id: 'orders', label: 'My Orders & Tracking' },
        { id: 'profile', label: 'Patient Profile' }
      ],
      circularActions: [
        { id: 'medicines', label: 'Medicine Search', icon: 'search', title: 'Search accredited catalog formularies' },
        { id: 'prescription', label: 'Prescription OCR', icon: 'document_scanner', title: 'Digital prescription scanning & validation' },
        { id: 'pharmacies', label: 'Pharmacy Directory', icon: 'storefront', title: 'Browse accredited community pharmacies' },
        { id: 'emergency', label: '24/7 Duty Locator', icon: 'local_hospital', title: 'Find active duty and emergency pharmacies' },
        { id: 'orders', label: 'Fulfillment Tracking', icon: 'package_2', title: 'Order status & counter verification' }
      ]
    },
    PHARMACIST: {
      tagline: 'Licensed pharmacy dispensary portal • Real-time stock registry, clinical review & counter fulfillment.',
      navLinks: [
        { id: 'pharmacist', label: 'Dispensary Queue' },
        { id: 'pharmacist', label: 'Inventory Registry' },
        { id: 'pharmacist', label: 'Clinical OCR Reviews' },
        { id: 'pharmacist', label: 'Counter PIN Terminal' },
        { id: 'pharmacist', label: 'Stock Buffer Safety' }
      ],
      circularActions: [
        { id: 'pharmacist', label: 'Dispensary Queue', icon: 'storefront', title: 'View active reservation queue' },
        { id: 'pharmacist', label: 'Stock Registry', icon: 'inventory_2', title: 'Manage pharmacy medicine stock' },
        { id: 'pharmacist', label: 'Clinical Review', icon: 'clinical_notes', title: 'Clinical OCR verification console' },
        { id: 'pharmacist', label: 'PIN Terminal', icon: 'dialpad', title: 'Open counter PIN terminal' },
        { id: 'pharmacist', label: 'Buffer Alerts', icon: 'emergency', title: 'Emergency stock replenishment' }
      ]
    },
    ASSISTANT: {
      tagline: 'Community health logistics & assistance • Secure custody handover and delivery verification.',
      navLinks: [
        { id: 'assistant', label: 'Active Tasks' },
        { id: 'assistant', label: 'Dispatch Route Map' },
        { id: 'assistant', label: 'Custody Handover PIN' },
        { id: 'assistant', label: 'Task History' },
        { id: 'assistant', label: 'Assistant Profile' }
      ],
      circularActions: [
        { id: 'assistant', label: 'Active Missions', icon: 'local_shipping', title: 'Active assistance and delivery missions' },
        { id: 'assistant', label: 'Route Map', icon: 'map', title: 'Interactive transit route map' },
        { id: 'assistant', label: 'Handover PIN', icon: 'dialpad', title: 'Recipient PIN custody handover' },
        { id: 'assistant', label: 'Service Checklist', icon: 'task_alt', title: 'Care and fulfillment protocol' },
        { id: 'assistant', label: 'Profile', icon: 'account_circle', title: 'Assistant profile and credentials' }
      ]
    },
    ADMIN: {
      tagline: 'MediFind Platform Governance • Multi-pharmacy node telemetry & compliance supervision.',
      navLinks: [
        { id: 'admin', label: 'Fleet Telemetry' },
        { id: 'admin', label: 'Professional Verifications' },
        { id: 'admin', label: 'Users Directory' },
        { id: 'admin', label: 'Pharmacies Registry' },
        { id: 'admin', label: 'Orders Ledger' }
      ],
      circularActions: [
        { id: 'admin', label: 'Fleet Telemetry', icon: 'monitoring', title: 'System-wide operational telemetry' },
        { id: 'admin', label: 'Verifications', icon: 'verified_user', title: 'Audit professional practitioner credentials' },
        { id: 'admin', label: 'Users Directory', icon: 'group', title: 'Inspect registered user accounts' },
        { id: 'admin', label: 'Pharmacies', icon: 'domain', title: 'Supervise verified pharmacy nodes' },
        { id: 'admin', label: 'Orders Ledger', icon: 'receipt_long', title: 'Full transaction and dispensing audit trail' }
      ]
    }
  };

  const activeRole = roleConfig[role] ? role : 'PATIENT';
  const currentConfig = roleConfig[activeRole];

  return (
    <footer className="mt-auto border-t border-[#e0e8e5] dark:border-[#1c362e] bg-[#f7faf9]/95 dark:bg-[#07110f]/95 backdrop-blur-md pt-12 pb-8 px-4 sm:px-6 lg:px-8 text-on-surface w-full">
      <div className="w-full max-w-4xl mx-auto flex flex-col items-center justify-center text-center">
        
        {/* 1. Centered Brand & Factual Tagline */}
        <div className="flex flex-col items-center justify-center text-center gap-2.5 mb-6 w-full">
          <div className="flex justify-center items-center w-full">
            <MediFindLogo size="lg" showSubtitle={false} className="justify-center mx-auto" />
          </div>
          <p className="text-xs sm:text-sm text-on-surface-variant max-w-md font-medium leading-relaxed text-center mx-auto">
            {currentConfig.tagline}
          </p>
        </div>

        {/* 2. Centered Role-Specific Navigation Arrangement */}
        <nav aria-label="Portal navigation" className="flex flex-wrap items-center justify-center gap-x-4 sm:gap-x-5 gap-y-2 text-xs font-semibold text-on-surface-variant mb-8 text-center mx-auto">
          {currentConfig.navLinks.map((link, idx) => (
            <React.Fragment key={`${link.id}-${idx}`}>
              {idx > 0 && <span className="text-outline-variant/40" aria-hidden="true">&bull;</span>}
              <button
                type="button"
                onClick={() => onNavigate && onNavigate(link.id)}
                className="hover:text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md px-1 py-0.5 cursor-pointer"
              >
                {link.label}
              </button>
            </React.Fragment>
          ))}
        </nav>

        {/* 3. Circular Action / Resource Icon Treatment */}
        <div className="flex items-center justify-center gap-3 mb-8 w-full" aria-label="Quick Actions">
          {currentConfig.circularActions.map(action => (
            <button
              key={action.id + '-' + action.icon}
              type="button"
              onClick={() => onNavigate && onNavigate(action.id)}
              title={action.title}
              aria-label={action.label}
              className="w-11 h-11 rounded-full bg-white dark:bg-[#10221c] border border-[#dbe6e1] dark:border-[#224237] text-[#032f28] dark:text-[#a7f3d0] shadow-xs flex items-center justify-center hover:bg-[#e0f2eb] dark:hover:bg-[#163028] hover:border-[#b0ecdd] dark:hover:border-[#34d399] hover:scale-110 active:scale-95 transition-all duration-200 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="material-symbols-outlined text-[20px]">{action.icon}</span>
            </button>
          ))}
        </div>

        {/* 4. Email / Subscribe Interaction (Reference Email Subscribe Style) */}
        <div className="w-full max-w-sm mb-10 mx-auto">
          <form onSubmit={handleSubscribe} className="relative flex items-center justify-center">
            <div className="relative w-full flex items-center rounded-full bg-white dark:bg-[#0c1815] border border-[#dbe6e1] dark:border-[#224237] p-1.5 shadow-xs focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all">
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
            <p className="text-[11px] text-secondary font-medium mt-1.5 animate-in fade-in text-center">
              {notice}
            </p>
          )}
        </div>

        {/* 5. Subtle Separator */}
        <div className="w-full max-w-xl h-px bg-outline-variant/30 mb-6 mx-auto" />

        {/* 6. Clean, Neutral Legal & Disclosure Block */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full max-w-2xl text-[11px] text-on-surface-variant font-medium text-center mx-auto">
          <div>
            &copy; 2026 MediFind AI &bull; Prescription-based medicine access and pharmacy discovery
          </div>
          <div className="flex items-center justify-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200/60 text-emerald-800 text-[10px] font-semibold">
              Participating Pharmacies &bull; Verified Clinical Network
            </span>
          </div>
        </div>

      </div>
    </footer>
  );
}
