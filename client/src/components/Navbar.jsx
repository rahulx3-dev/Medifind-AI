import React, { useState } from 'react';
import { motion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import MediFindLogo from './MediFindLogo';
import ConfirmationDialog from './ConfirmationDialog';

export default function Navbar({
  activeTab,
  setActiveTab,
  onOpenNotifications,
  unreadNotifsCount = 0,
  medicineRequestCount = 0
}) {
  const { user, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const handleTabClick = (tab) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  const handleLogoutConfirm = () => {
    setShowLogoutConfirm(false);
    logout();
  };

  return (
    <>
      <header className="sticky top-0 z-50 bg-[#ecfdf7]/90 backdrop-blur-xl border-b border-[#e0e8e5] shadow-[0_1px_8px_rgba(3,47,40,0.04)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between gap-4">
          {/* Canonical Brand Logo */}
          <button
            onClick={() => {
              if (user?.role === 'PHARMACIST') handleTabClick('pharmacist');
              else if (user?.role === 'ASSISTANT') handleTabClick('assistant');
              else if (user?.role === 'ADMIN') handleTabClick('admin');
              else handleTabClick('medicines');
            }}
            className="flex items-center gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-2xl"
          >
            <MediFindLogo size="md" showSubtitle={true} />
          </button>

          {/* Desktop Navigation Links (Pill Style with Spring Motion) */}
          <nav className="hidden lg:flex items-center gap-1 bg-surface-container-lowest/90 p-1.5 rounded-full border border-outline-variant/30 shadow-xs relative">
            {/* PATIENT ROLE NAVIGATION — 21st.dev GradientMenu Adapted to MediFind Clinical Palette */}
            {user?.role === 'PATIENT' && (
              <div className="flex items-center gap-2">
                {[
                  {
                    id: 'medicines',
                    label: 'Medicines',
                    icon: 'search',
                    gradientFrom: '#032f28',
                    gradientTo: '#059669',
                    badge: medicineRequestCount > 0 ? medicineRequestCount : null,
                    ariaLabel: 'Medicines Search'
                  },
                  {
                    id: 'prescription',
                    label: 'Prescription',
                    icon: 'document_scanner',
                    gradientFrom: '#0f766e',
                    gradientTo: '#0d9488',
                    ariaLabel: 'Prescription OCR'
                  },
                  {
                    id: 'pharmacies',
                    label: 'Pharmacies',
                    icon: 'storefront',
                    gradientFrom: '#047857',
                    gradientTo: '#10b981',
                    ariaLabel: 'Pharmacy Discovery'
                  },
                  {
                    id: 'emergency',
                    label: 'Emergency',
                    icon: 'e911_emergency',
                    gradientFrom: '#9f1239',
                    gradientTo: '#e11d48',
                    ariaLabel: '24/7 Emergency Locator'
                  },
                  {
                    id: 'orders',
                    label: 'Orders',
                    icon: 'local_shipping',
                    gradientFrom: '#065f46',
                    gradientTo: '#059669',
                    ariaLabel: 'My Orders'
                  },
                  {
                    id: 'profile',
                    label: 'Profile',
                    icon: 'account_circle',
                    gradientFrom: '#115e59',
                    gradientTo: '#14b8a6',
                    ariaLabel: 'My Profile'
                  }
                ].map(item => {
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      id={`nav-${item.id}-btn`}
                      onClick={() => handleTabClick(item.id)}
                      aria-label={item.ariaLabel}
                      aria-current={isActive ? 'page' : undefined}
                      title={item.ariaLabel}
                      style={{
                        '--gradient-from': item.gradientFrom,
                        '--gradient-to': item.gradientTo
                      }}
                      className={`relative h-10 rounded-full flex items-center justify-center transition-all duration-300 group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                        isActive
                          ? 'px-4 text-white shadow-sm'
                          : 'w-10 hover:w-32 hover:px-3 text-on-surface-variant hover:text-white'
                      }`}
                    >
                      {/* Active / Hover Gradient Background */}
                      <span
                        className={`absolute inset-0 rounded-full bg-[linear-gradient(135deg,var(--gradient-from),var(--gradient-to))] transition-opacity duration-300 ${
                          isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
                        }`}
                      />

                      {/* Subtle Glow Shadow on hover/active */}
                      <span
                        className={`absolute inset-0 rounded-full bg-[linear-gradient(135deg,var(--gradient-from),var(--gradient-to))] blur-sm -z-10 transition-opacity duration-300 ${
                          isActive ? 'opacity-30' : 'opacity-0 group-hover:opacity-30'
                        }`}
                      />

                      {/* Content: Icon + Label Reveal */}
                      <div className="relative z-10 flex items-center gap-1.5 whitespace-nowrap overflow-hidden">
                        <span className="material-symbols-outlined text-[19px] shrink-0">
                          {item.icon}
                        </span>
                        <span
                          className={`text-xs font-bold transition-all duration-300 ${
                            isActive
                              ? 'inline-block opacity-100'
                              : 'hidden group-hover:inline-block group-focus-visible:inline-block opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
                          }`}
                        >
                          {item.label}
                        </span>
                        {item.badge && (
                          <span className="px-1.5 py-0.2 rounded-full font-extrabold text-[10px] bg-secondary-container text-on-secondary-container shrink-0">
                            {item.badge}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* PHARMACIST ROLE */}
            {user?.role === 'PHARMACIST' && (
              <button
                id="nav-pharmacist-btn"
                onClick={() => handleTabClick('pharmacist')}
                className={`px-5 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === 'pharmacist'
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-on-surface-variant hover:text-primary hover:bg-surface-container'
                }`}
              >
                <span className="material-symbols-outlined text-lg">inventory_2</span>
                <span>Pharmacist Dispatch &amp; Inventory Portal</span>
              </button>
            )}

            {/* ASSISTANT ROLE */}
            {user?.role === 'ASSISTANT' && (
              <button
                id="nav-assistant-btn"
                onClick={() => handleTabClick('assistant')}
                className={`px-5 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === 'assistant'
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-on-surface-variant hover:text-primary hover:bg-surface-container'
                }`}
              >
                <span className="material-symbols-outlined text-lg">directions_bike</span>
                <span>Delivery Assistant Journey</span>
              </button>
            )}

            {/* ADMIN ROLE */}
            {user?.role === 'ADMIN' && (
              <button
                id="nav-admin-btn"
                onClick={() => handleTabClick('admin')}
                className={`px-5 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 ${
                  activeTab === 'admin'
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-on-surface-variant hover:text-primary hover:bg-surface-container'
                }`}
              >
                <span className="material-symbols-outlined text-lg">admin_panel_settings</span>
                <span>Admin Operations Center</span>
              </button>
            )}
          </nav>

          {/* Right Utilities: Notifications & User Profile */}
          <div className="flex items-center gap-3">
            {/* Notification Bell Button */}
            <button
              id="notifications-bell-btn"
              onClick={onOpenNotifications}
              className="relative w-10 h-10 rounded-full bg-surface-container-lowest hover:bg-surface-container text-on-surface-variant hover:text-primary flex items-center justify-center border border-outline-variant/30 shadow-sm transition-colors"
              title="Notifications"
            >
              <span className="material-symbols-outlined text-xl">notifications</span>
              {unreadNotifsCount > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-error text-white text-[11px] font-bold rounded-full flex items-center justify-center shadow-sm">
                  {unreadNotifsCount > 9 ? '9+' : unreadNotifsCount}
                </span>
              )}
            </button>

            {/* Authenticated User Pill Badge */}
            {user && (
              <div className="hidden sm:flex items-center gap-2.5 bg-surface-container-lowest px-3 py-1.5 rounded-full border border-outline-variant/30 shadow-sm">
                <button
                  type="button"
                  onClick={() => handleTabClick('profile')}
                  className="flex items-center gap-2.5 text-left bg-transparent border-none cursor-pointer p-0 hover:opacity-80 transition-opacity"
                  title="View & Edit Profile"
                >
                  <div className="w-7 h-7 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center text-xs font-bold uppercase">
                    {user.name ? user.name.charAt(0) : 'U'}
                  </div>
                  <div className="flex flex-col text-left leading-none">
                    <span className="text-xs font-bold text-primary truncate max-w-[120px]">
                      {user.name}
                    </span>
                    <span className="text-[10px] font-semibold text-secondary uppercase tracking-wider mt-0.5">
                      {user.role}
                    </span>
                  </div>
                </button>
                <button
                  id="auth-logout-btn"
                  onClick={() => setShowLogoutConfirm(true)}
                  className="w-7 h-7 rounded-full hover:bg-error-container/40 text-on-surface-variant hover:text-error flex items-center justify-center transition-colors ml-1 cursor-pointer border-none bg-transparent"
                  title="Sign out of MediFind"
                >
                  <span className="material-symbols-outlined text-base">logout</span>
                </button>
              </div>
            )}

            {/* Mobile Hamburger Toggle Button */}
            <button
              onClick={() => setMobileMenuOpen(prev => !prev)}
              className="lg:hidden w-10 h-10 rounded-full bg-surface-container-lowest text-primary flex items-center justify-center border border-outline-variant/30 shadow-sm"
              aria-label="Toggle menu"
            >
              <span className="material-symbols-outlined text-2xl">
                {mobileMenuOpen ? 'close' : 'menu'}
              </span>
            </button>
          </div>
        </div>

        {/* Mobile Navigation Drawer / Collapsible Bar */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-outline-variant/30 bg-[#ecfdf7] px-4 py-4 flex flex-col gap-2 shadow-lg animate-in slide-in-from-top-2 duration-150">
            {user?.role === 'PATIENT' && (
              <>
                <button
                  onClick={() => handleTabClick('medicines')}
                  className={`w-full px-4 py-3 rounded-2xl text-sm font-bold flex items-center justify-between text-left transition-colors ${
                    activeTab === 'medicines'
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-surface-container-lowest text-on-surface hover:bg-surface-container'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-lg">search</span>
                    <span>Search Medicines</span>
                  </div>
                  {medicineRequestCount > 0 && (
                    <span className="bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded-full text-xs font-bold">
                      {medicineRequestCount} in request
                    </span>
                  )}
                </button>

                <button
                  onClick={() => handleTabClick('prescription')}
                  className={`w-full px-4 py-3 rounded-2xl text-sm font-bold flex items-center gap-2 text-left transition-colors ${
                    activeTab === 'prescription'
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-surface-container-lowest text-on-surface hover:bg-surface-container'
                  }`}
                >
                  <span className="material-symbols-outlined text-lg">document_scanner</span>
                  <span>Prescription Upload &amp; OCR</span>
                </button>

                <button
                  onClick={() => handleTabClick('pharmacies')}
                  className={`w-full px-4 py-3 rounded-2xl text-sm font-bold flex items-center gap-2 text-left transition-colors ${
                    activeTab === 'pharmacies'
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-surface-container-lowest text-on-surface hover:bg-surface-container'
                  }`}
                >
                  <span className="material-symbols-outlined text-lg">storefront</span>
                  <span>Pharmacy Discovery &amp; Stock</span>
                </button>

                <button
                  onClick={() => handleTabClick('emergency')}
                  className={`w-full px-4 py-3 rounded-2xl text-sm font-bold flex items-center gap-2 text-left transition-colors ${
                    activeTab === 'emergency'
                      ? 'bg-tertiary-container text-white shadow-sm'
                      : 'bg-[#ffdad6]/60 text-tertiary hover:bg-[#ffdad6]'
                  }`}
                >
                  <span className="material-symbols-outlined text-lg">e911_emergency</span>
                  <span>24/7 Emergency Locator</span>
                </button>

                <button
                  onClick={() => handleTabClick('orders')}
                  className={`w-full px-4 py-3 rounded-2xl text-sm font-bold flex items-center gap-2 text-left transition-colors ${
                    activeTab === 'orders'
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-surface-container-lowest text-on-surface hover:bg-surface-container'
                  }`}
                >
                  <span className="material-symbols-outlined text-lg">local_shipping</span>
                  <span>My Orders &amp; Reservations</span>
                </button>

                <button
                  onClick={() => handleTabClick('profile')}
                  className={`w-full px-4 py-3 rounded-2xl text-sm font-bold flex items-center gap-2 text-left transition-colors ${
                    activeTab === 'profile'
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-surface-container-lowest text-on-surface hover:bg-surface-container'
                  }`}
                >
                  <span className="material-symbols-outlined text-lg">account_circle</span>
                  <span>My Profile &amp; Records</span>
                </button>
              </>
            )}

            {user?.role === 'PHARMACIST' && (
              <button
                onClick={() => handleTabClick('pharmacist')}
                className={`w-full px-4 py-3 rounded-2xl text-sm font-bold flex items-center gap-2 text-left ${
                  activeTab === 'pharmacist' ? 'bg-primary text-white' : 'bg-surface-container-lowest text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-lg">inventory_2</span>
                <span>Pharmacist Inventory &amp; Dispatch</span>
              </button>
            )}

            {user?.role === 'ASSISTANT' && (
              <button
                onClick={() => handleTabClick('assistant')}
                className={`w-full px-4 py-3 rounded-2xl text-sm font-bold flex items-center gap-2 text-left ${
                  activeTab === 'assistant' ? 'bg-primary text-white' : 'bg-surface-container-lowest text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-lg">directions_bike</span>
                <span>Medicine Access Assistant Portal</span>
              </button>
            )}

            {user?.role === 'ADMIN' && (
              <button
                onClick={() => handleTabClick('admin')}
                className={`w-full px-4 py-3 rounded-2xl text-sm font-bold flex items-center gap-2 text-left ${
                  activeTab === 'admin' ? 'bg-primary text-white' : 'bg-surface-container-lowest text-on-surface'
                }`}
              >
                <span className="material-symbols-outlined text-lg">admin_panel_settings</span>
                <span>Admin Operations Center</span>
              </button>
            )}

            {/* User Profile in Mobile Drawer */}
            {user && (
              <div className="pt-2 border-t border-outline-variant/30 flex items-center justify-between mt-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center font-bold text-xs uppercase">
                    {user.name ? user.name.charAt(0) : 'U'}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-primary">{user.name}</span>
                    <span className="text-[10px] text-secondary font-semibold uppercase">{user.role}</span>
                  </div>
                </div>
                <button
                  onClick={() => setShowLogoutConfirm(true)}
                  className="px-3 py-1.5 rounded-full bg-error-container text-error text-xs font-bold flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-sm">logout</span>
                  <span>Logout</span>
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      {/* Confirmation Dialog on Logout */}
      <ConfirmationDialog
        isOpen={showLogoutConfirm}
        title="Sign out of MediFind AI?"
        message="You will be logged out of your active session. Any saved reservations or orders will remain securely stored."
        confirmText="Yes, Sign Out"
        cancelText="Stay Signed In"
        isDestructive={false}
        onConfirm={handleLogoutConfirm}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </>
  );
}
