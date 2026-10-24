import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { usePortalGreeting } from '../utils/greetingUtils';
import MediFindLogo from './MediFindLogo';
import ConfirmationDialog from './ConfirmationDialog';
import { AnimatedHamburgerIcon } from './Sidebar';

export default function Navbar({
  activeTab,
  setActiveTab,
  onOpenNotifications,
  unreadNotifsCount = 0,
  medicineRequestCount = 0
}) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme, isDark } = useTheme();
  const { fullName: userDisplayName } = usePortalGreeting(user, user?.role || 'PATIENT');
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
      <header className="sticky top-0 z-50 bg-[#ecfdf7]/90 dark:bg-[#212529]/95 backdrop-blur-xl border-b border-[#e0e8e5] dark:border-[#3d4349] shadow-[0_1px_8px_rgba(3,47,40,0.04)] dark:shadow-[0_1px_8px_rgba(0,0,0,0.3)] transition-colors">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-16 lg:h-20 flex items-center justify-between gap-2 sm:gap-4">
          {/* Left Group: Mobile Hamburger (left-aligned) & Canonical Brand Logo */}
          <div className="flex items-center gap-1.5 sm:gap-3">
            {/* Mobile Hamburger Toggle Button (On the LEFT) */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(prev => !prev)}
              className="lg:hidden w-9 h-9 sm:w-10 sm:h-10 -ml-1 rounded-full flex items-center justify-center transition-transform hover:scale-105 active:scale-95 cursor-pointer shrink-0"
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            >
              <AnimatedHamburgerIcon isOpen={mobileMenuOpen} size={32} color="#032f28" circleColor="#2e685d" />
            </button>

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
              <div className="block sm:hidden">
                <MediFindLogo size="sm" showSubtitle={false} />
              </div>
              <div className="hidden sm:block">
                <MediFindLogo size="md" showSubtitle={true} />
              </div>
            </button>
          </div>

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
                    id: 'healthcare',
                    label: 'Healthcare',
                    icon: 'medical_services',
                    gradientFrom: '#064e3b',
                    gradientTo: '#10b981',
                    ariaLabel: 'Healthcare Professional Marketplace'
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

            {/* PHARMACIST ROLE — Barba Sliding Nav Bar */}
            {user?.role === 'PHARMACIST' && (
              <div className="flex items-center gap-1.5">
                {[
                  { id: 'pharmacist', label: 'Queue', icon: 'inventory_2' },
                  { id: 'inventory', label: 'Inventory', icon: 'medication' },
                  { id: 'profile', label: 'Profile', icon: 'badge' },
                ].map((item) => {
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      id={`nav-${item.id}-btn`}
                      onClick={() => handleTabClick(item.id)}
                      className={`relative px-4 py-2 rounded-full text-xs font-bold transition-colors flex items-center gap-1.5 focus:outline-none cursor-pointer ${
                        isActive ? 'text-white' : 'text-on-surface-variant hover:text-primary hover:bg-surface-container'
                      }`}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="specialist-navbar-barba"
                          transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                          className="absolute inset-0 rounded-full bg-gradient-to-r from-[#032f28] to-[#0a4f43] shadow-[0_2px_12px_rgba(3,47,40,0.3)] -z-0"
                        />
                      )}
                      <span className={`relative z-10 material-symbols-outlined text-[18px] ${isActive ? 'text-[#b0ecdd]' : 'text-primary'}`}>
                        {item.icon}
                      </span>
                      <span className="relative z-10 font-bold">
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* ASSISTANT ROLE — Barba Sliding Nav Bar */}
            {user?.role === 'ASSISTANT' && (
              <div className="flex items-center gap-1.5">
                {[
                  { id: 'assistant', label: 'Available Tasks', icon: 'assignment_turned_in' },
                  { id: 'active', label: 'Active Journey', icon: 'electric_moped' },
                  { id: 'completed', label: 'Dispatches', icon: 'verified' },
                  { id: 'profile', label: 'Profile', icon: 'badge' },
                ].map((item) => {
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      id={`nav-${item.id}-btn`}
                      onClick={() => handleTabClick(item.id)}
                      className={`relative px-4 py-2 rounded-full text-xs font-bold transition-colors flex items-center gap-1.5 focus:outline-none cursor-pointer ${
                        isActive ? 'text-white' : 'text-on-surface-variant hover:text-primary hover:bg-surface-container'
                      }`}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="specialist-navbar-barba"
                          transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                          className="absolute inset-0 rounded-full bg-gradient-to-r from-[#032f28] to-[#0a4f43] shadow-[0_2px_12px_rgba(3,47,40,0.3)] -z-0"
                        />
                      )}
                      <span className={`relative z-10 material-symbols-outlined text-[18px] ${isActive ? 'text-[#b0ecdd]' : 'text-primary'}`}>
                        {item.icon}
                      </span>
                      <span className="relative z-10 font-bold">
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* ADMIN ROLE — Barba Sliding Nav Bar */}
            {user?.role === 'ADMIN' && (
              <div className="flex items-center gap-1.5">
                {[
                  { id: 'admin', label: 'Overview', icon: 'dashboard' },
                  { id: 'users', label: 'Users', icon: 'group' },
                  { id: 'pharmacies', label: 'Pharmacies', icon: 'domain' },
                  { id: 'orders', label: 'Orders', icon: 'receipt_long' },
                  { id: 'emergency', label: 'Logistics', icon: 'local_shipping' },
                  { id: 'activity', label: 'Audit', icon: 'timeline' },
                  { id: 'profile', label: 'Profile', icon: 'badge' },
                ].map((item) => {
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      id={`nav-${item.id}-btn`}
                      onClick={() => handleTabClick(item.id)}
                      className={`relative px-3.5 py-2 rounded-full text-xs font-bold transition-colors flex items-center gap-1.5 focus:outline-none cursor-pointer ${
                        isActive ? 'text-white' : 'text-on-surface-variant hover:text-primary hover:bg-surface-container'
                      }`}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="specialist-navbar-barba"
                          transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                          className="absolute inset-0 rounded-full bg-gradient-to-r from-[#032f28] to-[#0a4f43] shadow-[0_2px_12px_rgba(3,47,40,0.3)] -z-0"
                        />
                      )}
                      <span className={`relative z-10 material-symbols-outlined text-[18px] ${isActive ? 'text-[#b0ecdd]' : 'text-primary'}`}>
                        {item.icon}
                      </span>
                      <span className="relative z-10 font-bold">
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </nav>

          {/* Right Utilities: Notifications, Theme Toggle & User Profile */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            {/* Accessible Theme Toggle Button (Light / Dark) */}
            <button
              id="theme-toggle-btn"
              type="button"
              onClick={toggleTheme}
              className="relative w-10 h-10 rounded-full bg-surface-container-lowest hover:bg-surface-container text-on-surface-variant hover:text-primary flex items-center justify-center border border-outline-variant/30 shadow-sm transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
              aria-label={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
              aria-pressed={isDark}
            >
              <span className="material-symbols-outlined text-xl transition-transform duration-200">
                {isDark ? 'light_mode' : 'dark_mode'}
              </span>
            </button>

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

            {/* Authenticated User Pill Badge (Desktop / sm+) & Mobile Avatar (<sm) */}
            {user && (
              <>
                <button
                  type="button"
                  onClick={() => handleTabClick('profile')}
                  className="sm:hidden w-8 h-8 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center text-xs font-bold uppercase shadow-xs shrink-0 cursor-pointer"
                  title="View Profile"
                >
                  {userDisplayName ? userDisplayName.charAt(0) : 'U'}
                </button>
                <div className="hidden sm:flex items-center gap-2.5 bg-surface-container-lowest px-3 py-1.5 rounded-full border border-outline-variant/30 shadow-sm">
                  <button
                    type="button"
                    onClick={() => handleTabClick('profile')}
                    className="flex items-center gap-2.5 text-left bg-transparent border-none cursor-pointer p-0 hover:opacity-80 transition-opacity"
                    title="View & Edit Profile"
                  >
                    <div className="w-7 h-7 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center text-xs font-bold uppercase">
                      {userDisplayName ? userDisplayName.charAt(0) : 'U'}
                    </div>
                    <div className="flex flex-col text-left leading-none">
                      <span className="text-xs font-bold text-primary truncate max-w-[120px]">
                        {userDisplayName}
                      </span>
                      <span className="text-[10px] font-semibold text-secondary uppercase tracking-wider mt-0.5">
                        {user.role}
                      </span>
                    </div>
                  </button>
                  <button
                    id="auth-logout-btn"
                    onClick={() => setShowLogoutConfirm(true)}
                    className="px-2.5 py-1.5 rounded-xl hover:bg-error-container/40 text-on-surface-variant hover:text-error flex items-center gap-1.5 transition-colors ml-1 cursor-pointer border border-transparent hover:border-error/20 bg-transparent text-xs font-semibold"
                    title="Sign out of MediFind"
                  >
                    <span className="material-symbols-outlined text-base">logout</span>
                    <span className="hidden sm:inline">Sign Out</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Mobile Navigation Sidebar Drawer (Slides in from LEFT only on mobile) */}
        {typeof document !== 'undefined' && ReactDOM.createPortal(
          <AnimatePresence>
            {mobileMenuOpen && (
              <div className="fixed inset-0 z-[9999] lg:hidden">
                {/* Backdrop overlay */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setMobileMenuOpen(false)}
                  className="fixed inset-0 bg-black/50 backdrop-blur-xs"
                />

              {/* Sidebar drawer panel */}
              <motion.aside
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', damping: 26, stiffness: 280 }}
                className="fixed inset-y-0 left-0 w-[290px] max-w-[85vw] bg-[#ecfdf7] dark:bg-[#1a1e22] border-r border-[#cbe4db] dark:border-[#383f45] shadow-2xl flex flex-col z-10 overflow-y-auto"
              >
                {/* Sidebar Header with Brand Logo & Close X */}
                <div className="p-4 border-b border-outline-variant/30 flex items-center justify-between">
                  <MediFindLogo size="sm" showSubtitle={true} />
                  <button
                    type="button"
                    onClick={() => setMobileMenuOpen(false)}
                    className="w-9 h-9 rounded-full flex items-center justify-center text-primary dark:text-surface hover:bg-surface-container/60 cursor-pointer transition-colors"
                    aria-label="Close menu"
                  >
                    <span className="material-symbols-outlined text-xl">close</span>
                  </button>
                </div>

                {/* User Greeting Card at top of Sidebar */}
                {user && (
                  <div className="mx-3 mt-3 p-3 rounded-2xl bg-surface-container-lowest dark:bg-[#252b30] border border-outline-variant/30 flex items-center gap-3 shadow-2xs">
                    <div className="w-10 h-10 rounded-full bg-secondary text-white font-bold flex items-center justify-center text-sm shadow-xs shrink-0 uppercase">
                      {userDisplayName ? userDisplayName.charAt(0) : 'U'}
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-xs font-extrabold text-primary dark:text-surface truncate">
                        {userDisplayName}
                      </span>
                      <span className="text-[10px] font-bold text-secondary uppercase tracking-wider">
                        {user.role} Portal
                      </span>
                    </div>
                  </div>
                )}

                {/* Navigation Links inside Sidebar */}
                <div className="flex-1 p-3 flex flex-col gap-1.5 overflow-y-auto">
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
                        onClick={() => handleTabClick('healthcare')}
                        className={`w-full px-4 py-3 rounded-2xl text-sm font-bold flex items-center gap-2 text-left transition-colors ${
                          activeTab === 'healthcare'
                            ? 'bg-primary text-white shadow-sm'
                            : 'bg-surface-container-lowest text-on-surface hover:bg-surface-container'
                        }`}
                      >
                        <span className="material-symbols-outlined text-lg">medical_services</span>
                        <span>Healthcare Professional Marketplace</span>
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

                  {/* Mobile Theme Toggle Pill Button */}
                  <button
                    type="button"
                    onClick={toggleTheme}
                    className="w-full px-4 py-2.5 rounded-2xl text-xs font-bold flex items-center justify-between text-left transition-colors bg-surface-container-lowest text-on-surface hover:bg-surface-container border border-outline-variant/20 mt-1 cursor-pointer"
                    aria-label={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
                  >
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-base">
                        {isDark ? 'light_mode' : 'dark_mode'}
                      </span>
                      <span>Interface Theme</span>
                    </div>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant">
                      {isDark ? 'Dark Mode' : 'Light Mode'}
                    </span>
                  </button>
                </div>

                {/* Bottom Sign Out */}
                {user && (
                  <div className="p-3 border-t border-outline-variant/30 bg-surface-container-low/40">
                    <button
                      onClick={() => {
                        setMobileMenuOpen(false);
                        setShowLogoutConfirm(true);
                      }}
                      className="w-full px-4 py-2.5 rounded-xl bg-error-container/40 text-error hover:bg-error-container/60 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors"
                    >
                      <span className="material-symbols-outlined text-base">logout</span>
                      <span>Sign Out</span>
                    </button>
                  </div>
                )}
              </motion.aside>
            </div>
          )}
        </AnimatePresence>,
        document.body
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
