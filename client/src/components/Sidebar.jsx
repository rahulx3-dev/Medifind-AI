import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { usePortalGreeting } from '../utils/greetingUtils';
import MediFindLogo from './MediFindLogo';

/**
 * Animated Sidebar — Adapted from 21st.dev / BeUI Animated Sidebar
 * Supports:
 * - EXPANDED (full labels + descriptions) <-> COLLAPSED (icon rail)
 * - Spring morph transition (stiffness: 380, damping: 35, mass: 0.75)
 * - Shared layout active route background indicator
 * - Keyboard shortcut ('b') to toggle collapse
 * - Mobile slide-over drawer with focus management & body scroll lock
 * - Tooltip on hover in collapsed mode
 * - Prefers-reduced-motion awareness
 */
/**
 * AnimatedHamburgerIcon — Authentic Barba.js Menu Trigger Animation
 * Matches https://barba.js.org/docs/getstarted/lifecycle/ exactly:
 * - Outer circle stroke dashoffset sweep
 * - 3 horizontal bars:
 *   - Top bar: drops to 50% & rotates +45deg
 *   - Middle bar: slides out to the right (translate(200%, -50%)) & fades to opacity 0
 *   - Bottom bar: rises to 50% & rotates -45deg
 *   - Easing: cubic-bezier(0.16, 1, 0.3, 1) & 0.4s duration
 */
export function AnimatedHamburgerIcon({
  isOpen = false,
  size = 36,
  color = '#032f28',
  circleColor = '#2e685d',
  className = '',
  onClick
}) {
  return (
    <div
      onClick={onClick}
      className={`barba-menu-trigger ${isOpen ? 'is-open' : ''} ${className}`}
      style={{
        width: size,
        height: size,
        color: color,
        flexShrink: 0
      }}
      aria-label={isOpen ? 'Close menu' : 'Open menu'}
    >
      {/* Barba Circular Stroke Shape */}
      <svg
        viewBox="0 0 50 50"
        className="barba-menu-trigger__shape"
        style={{ color: circleColor }}
      >
        <circle r="23" cx="25" cy="25" />
      </svg>

      {/* 3 Animated Horizontal Bars matching Barba.js */}
      <span className="barba-menu-trigger__bar" />
      <span className="barba-menu-trigger__bar" />
      <span className="barba-menu-trigger__bar" />
    </div>
  );
}

export default function Sidebar({
  isOpen = false,
  onClose = () => {},
  currentTab,
  onTabChange,
  onOpenNotifications,
  unreadNotifsCount = 0
}) {
  const { user, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const { fullName: userDisplayName } = usePortalGreeting(user, user?.role || 'PHARMACIST');
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const drawerRef = useRef(null);
  const previousActiveElement = useRef(null);

  // Keyboard shortcut: 'b' key toggles expanded/collapsed rail on desktop
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if focus is in an input or textarea
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === 'b' || e.key === 'B') {
        setIsCollapsed(prev => !prev);
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Mobile Drawer: Body scroll lock & focus trap
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement;
      document.body.style.overflow = 'hidden';
      if (drawerRef.current) {
        drawerRef.current.focus();
      }
    } else {
      document.body.style.overflow = '';
      if (previousActiveElement.current && previousActiveElement.current.focus) {
        previousActiveElement.current.focus();
      }
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!user || user.role === 'PATIENT') {
    return null;
  }

  const role = user.role;

  // Role-specific navigation items
  const getNavItems = () => {
    if (role === 'PHARMACIST') {
      return [
        {
          id: 'overview',
          label: 'Reservation Queue',
          icon: 'inventory_2',
          description: 'Live order intake, holds & counter verification'
        },
        {
          id: 'inventory',
          label: 'Inventory Management',
          icon: 'medication',
          description: 'Stock buffer quotas & catalogue pricing'
        },
        {
          id: 'profile',
          label: 'Specialist Profile',
          icon: 'badge',
          description: 'Clinical credentials, dispensary bio & avatar'
        }
      ];
    }

    if (role === 'ASSISTANT') {
      return [
        {
          id: 'available',
          label: 'Available Tasks',
          icon: 'assignment_turned_in',
          description: 'Nearby ready dispensary pickups'
        },
        {
          id: 'active',
          label: 'Active Delivery Journey',
          icon: 'electric_moped',
          description: 'Cold-chain transit & PIN handover'
        },
        {
          id: 'completed',
          label: 'Completed Dispatches',
          icon: 'verified',
          description: 'Dispatch history & proof'
        },
        {
          id: 'profile',
          label: 'Assistant Profile',
          icon: 'badge',
          description: 'Vehicle info, territory & status'
        }
      ];
    }

    if (role === 'ADMIN') {
      return [
        {
          id: 'overview',
          label: 'Overview & Metrics',
          icon: 'dashboard',
          description: 'Operations health & critical stock buffer'
        },
        {
          id: 'users',
          label: 'Users Directory',
          icon: 'group',
          description: 'Access roles & registered accounts'
        },
        {
          id: 'pharmacies',
          label: 'Pharmacies Registry',
          icon: 'domain',
          description: 'Network verification & fixture states'
        },
        {
          id: 'orders',
          label: 'Orders Management',
          icon: 'receipt_long',
          description: 'System-wide order tracking & handoffs'
        },
        {
          id: 'emergency',
          label: 'Emergency & Logistics',
          icon: 'local_shipping',
          description: 'Assistant transit ledger & PIN privacy'
        },
        {
          id: 'activity',
          label: 'Activity Audit Timeline',
          icon: 'timeline',
          description: 'Compliance & security audit stream'
        },
        {
          id: 'profile',
          label: 'Administrator Profile',
          icon: 'badge',
          description: 'Executive clearance, security & dossier'
        }
      ];
    }

    return [];
  };

  const navItems = getNavItems();

  // Dynamic assistant profile fetching for dynamic track & relay status
  const [assistantData, setAssistantData] = useState(() => {
    try {
      const saved = localStorage.getItem('medifind_assistant_profile_cache');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });

  useEffect(() => {
    if (role !== 'ASSISTANT') return;
    const token = localStorage.getItem('medifind_token');
    if (!token) return;

    let isMounted = true;
    async function loadAssistantProfile() {
      try {
        const res = await fetch('/api/assistant/profile', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (isMounted && data.success && data.profile) {
          setAssistantData(data.profile);
          try {
            localStorage.setItem('medifind_assistant_profile_cache', JSON.stringify(data.profile));
          } catch (e) {}
        }
      } catch (e) {
        // Fallback gracefully to cache
      }
    }
    loadAssistantProfile();

    const handleStorageUpdate = (e) => {
      if (e.key === 'medifind_assistant_profile_cache' && e.newValue) {
        try {
          setAssistantData(JSON.parse(e.newValue));
        } catch (err) {}
      }
    };
    window.addEventListener('storage', handleStorageUpdate);
    return () => {
      isMounted = false;
      window.removeEventListener('storage', handleStorageUpdate);
    };
  }, [role, user?.id]);

  const getPortalInfo = () => {
    switch (role) {
      case 'PHARMACIST':
        return {
          portalName: 'Pharmacist Portal',
          badge: 'Dispensary Terminal',
          subtext: 'Inventory Sync Network',
          statusBadge: 'Inventory Sync Active'
        };
      case 'ASSISTANT': {
        const hasTrack = Boolean(assistantData?.assistantType);
        const isDelivery = assistantData?.assistantType === 'DELIVERY_ASSISTANT';
        const isHealth = assistantData?.assistantType === 'HEALTHCARE_PROFESSIONAL';
        const isAvailable = assistantData?.isAvailable !== false;
        const opCity = assistantData?.operatingCity || 'Chengannur';

        let badge = 'Assistant Portal';
        let subtext = 'Participation Track Pending';

        if (isDelivery) {
          badge = 'Delivery Assistant';
          subtext = `Logistics Network • ${opCity}`;
        } else if (isHealth) {
          badge = assistantData.professionTitle || 'Healthcare Professional';
          subtext = `Clinical Support • ${assistantData.verificationStatus || 'PENDING'}`;
        } else if (!hasTrack) {
          badge = 'Onboarding Track';
          subtext = 'Choose Delivery or Healthcare';
        }

        let statusBadge = isAvailable ? 'Relay Active' : 'Relay Paused (Off-Duty)';
        if (!hasTrack) {
          statusBadge = 'Setup In Progress';
        }

        return {
          portalName: 'Assistant Portal',
          badge,
          subtext,
          statusBadge
        };
      }
      case 'ADMIN':
        return {
          portalName: 'Operations Center',
          badge: 'Admin Console',
          subtext: 'System Authority',
          statusBadge: 'System Active'
        };
      default:
        return {
          portalName: 'MediFind Portal',
          badge: 'Verified User',
          subtext: 'Medical Access Network',
          statusBadge: 'System Active'
        };
    }
  };

  const portalInfo = getPortalInfo();

  const handleItemClick = (id) => {
    onTabChange(id);
    onClose();
  };

  const springTransition = shouldReduceMotion
    ? { duration: 0 }
    : { type: 'spring', stiffness: 450, damping: 35, mass: 0.8 };

  return (
    <>
      {/* ─── Mobile Backdrop Overlay (strictly mobile-only drawer backdrop) ─────────────────────────────── */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:!hidden transition-opacity duration-300"
          aria-hidden="true"
        />
      )}

      {/* ─── Main Sidebar Element ─────────────────────────────────── */}
      <motion.aside
        ref={drawerRef}
        tabIndex={-1}
        animate={{
          width: isCollapsed ? 80 : 288,
          x: isOpen ? 0 : (typeof window !== 'undefined' && window.innerWidth < 768 ? -320 : 0)
        }}
        transition={springTransition}
        aria-label="Sidebar Navigation"
        className={`
          fixed md:sticky top-0 left-0 bottom-0 z-50 h-screen
          bg-[#ecfdf7] dark:bg-[#212529] text-[#0f1e1b] dark:text-[#f8f9fa] border-r border-[#e0f2eb] dark:border-[#3d4349]
          flex flex-col justify-between overflow-hidden
          ${isOpen ? 'shadow-2xl' : ''}
        `}
      >
        {/* Top Header & Navigation Links */}
        <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden">
          
          {/* Header Brand Bar */}
          <div className="bg-white dark:bg-[#1a1d21] border-b border-[#e0f2eb] dark:border-[#3d4349] flex items-center justify-between transition-colors overflow-hidden"
            style={{ padding: '0.75rem', gap: '0.5rem', minHeight: '60px' }}>

            <AnimatePresence initial={false}>
              {!isCollapsed && (
                <motion.div
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex-1 min-w-0 overflow-hidden"
                >
                  <MediFindLogo size="sm" showSubtitle={false} />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Desktop persistent toggle button (morphs smoothly 3-bars <-> X) */}
            <motion.button
              layout
              type="button"
              onClick={() => setIsCollapsed(prev => !prev)}
              className={`hidden md:flex rounded-full items-center justify-center transition-transform hover:scale-105 active:scale-95 cursor-pointer shrink-0 ${
                isCollapsed ? 'w-full h-10' : 'w-9 h-9'
              }`}
              title={isCollapsed ? 'Expand sidebar (Press B)' : 'Collapse to icon rail (Press B)'}
              aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <AnimatedHamburgerIcon isOpen={!isCollapsed} size={34} color="#032f28" circleColor="#2e685d" />
            </motion.button>

            {/* Mobile close toggle */}
            <button
              type="button"
              onClick={onClose}
              className="md:hidden shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-transform hover:scale-105 active:scale-95 cursor-pointer"
              title="Close drawer"
              aria-label="Close sidebar"
            >
              <AnimatedHamburgerIcon isOpen={true} size={34} color="#032f28" circleColor="#2e685d" />
            </button>
          </div>

          {/* Portal Status Pill Card (Hidden when collapsed) */}
          {!isCollapsed && (
            <div className="p-3">
              <div className="p-2.5 bg-white rounded-2xl border border-[#e0f2eb] shadow-[0_1px_4px_rgba(3,47,40,0.04)] flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#2e685d] animate-pulse shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="font-bold text-[#032f28] text-xs leading-tight truncate">
                      {portalInfo.badge}
                    </span>
                    <span className="text-[10px] text-[#717976] truncate">{portalInfo.subtext}</span>
                  </div>
                </div>
                <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-md bg-[#e6f8f1] text-[#2e685d] border border-[#d5e6e0] shrink-0">
                  GovCloud
                </span>
              </div>
            </div>
          )}

          {/* Navigation Links Menu */}
          <div className="px-2.5 pb-4 space-y-1.5 flex-1 mt-2">
            {!isCollapsed && (
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#717976] font-mono">
                Portal Routes
              </div>
            )}

            {navItems.map((item) => {
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleItemClick(item.id)}
                  title={isCollapsed ? item.label : undefined}
                  className={`w-full relative flex items-center ${
                    isCollapsed ? 'justify-center px-0 py-2.5' : 'justify-between px-3 py-2.5'
                  } rounded-2xl text-left transition-colors group cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
                >
                  {/* Shared Layout Active Indicator */}
                  {isActive && (
                    <motion.div
                      layoutId="sidebar-active-indicator"
                      transition={springTransition}
                      className="absolute inset-0 bg-gradient-to-r from-[#032f28] to-[#0a4f43] rounded-2xl shadow-[0_4px_16px_rgba(3,47,40,0.3)] -z-0"
                    />
                  )}

                  <div className="relative z-10 flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors shrink-0 ${
                        isActive
                          ? 'bg-white/15 text-white'
                          : 'bg-[#e6f8f1] text-[#2e685d] group-hover:bg-[#b0ecdd] group-hover:text-[#032f28]'
                      }`}
                    >
                      <span className="material-symbols-outlined text-lg">
                        {item.icon}
                      </span>
                    </div>

                    {!isCollapsed && (
                      <div className="flex flex-col min-w-0">
                        <span
                          className={`text-xs font-bold tracking-tight truncate ${
                            isActive ? 'text-white' : 'text-[#0f1e1b]'
                          }`}
                        >
                          {item.label}
                        </span>
                        <span
                          className={`text-[10px] truncate ${
                            isActive ? 'text-[#a6cfc5]' : 'text-[#717976]'
                          }`}
                        >
                          {item.description}
                        </span>
                      </div>
                    )}
                  </div>

                  {!isCollapsed && (
                    <span
                      className={`relative z-10 material-symbols-outlined text-base transition-transform group-hover:translate-x-0.5 shrink-0 ${
                        isActive ? 'text-[#b0ecdd]' : 'text-[#c0c8c5]'
                      }`}
                    >
                      chevron_right
                    </span>
                  )}
                </button>
              );
            })}

            {/* Notifications Action */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => {
                  onOpenNotifications();
                  onClose();
                }}
                title={isCollapsed ? 'Notifications' : undefined}
                className={`w-full flex items-center ${
                  isCollapsed ? 'justify-center px-0 py-2.5' : 'justify-between px-3 py-2'
                } rounded-2xl bg-white hover:bg-[#e0f2eb] border border-[#e0f2eb] text-left transition-all cursor-pointer`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="relative w-9 h-9 rounded-xl bg-[#e6f8f1] text-[#2e685d] flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-lg">notifications</span>
                    {unreadNotifsCount > 0 && isCollapsed && (
                      <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-[#ba1a1a] text-white text-[9px] font-bold flex items-center justify-center">
                        {unreadNotifsCount > 9 ? '9+' : unreadNotifsCount}
                      </span>
                    )}
                  </div>
                  {!isCollapsed && (
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-[#032f28]">Notifications</span>
                      <span className="text-[10px] text-[#717976]">System alerts &amp; dispatch</span>
                    </div>
                  )}
                </div>

                {!isCollapsed && (
                  unreadNotifsCount > 0 ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#ba1a1a] text-white shadow-xs">
                      {unreadNotifsCount}
                    </span>
                  ) : (
                    <span className="text-[10px] text-[#717976] font-medium">Clear</span>
                  )
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Section: User Pill & Logout Popover */}
        <div className="p-3 bg-white border-t border-[#e0f2eb] space-y-2.5">
          {!isCollapsed && (
            <div className="p-2 rounded-xl bg-[#e6f8f1] border border-[#d5e6e0] text-[10px] text-[#414846] leading-relaxed">
              <div className="flex items-center gap-1.5 font-bold text-[#032f28] mb-0.5">
                <span className="material-symbols-outlined text-sm text-[#2e685d]">verified_user</span>
                <span>{portalInfo.statusBadge}</span>
              </div>
              <div className="font-semibold text-[#2e685d] truncate">
                {role === 'ASSISTANT' && assistantData?.operatingCity
                  ? `Participating Network • ${assistantData.operatingCity}`
                  : 'Participating Network • Chengannur'}
              </div>
            </div>
          )}

          {/* Theme Toggle Pill in Sidebar */}
          <button
            type="button"
            onClick={toggleTheme}
            title={isCollapsed ? (isDark ? "Switch to Light Mode" : "Switch to Dark Mode") : undefined}
            className={`w-full p-2 rounded-2xl bg-white hover:bg-[#e6f8f1] border border-[#e0f2eb] flex items-center ${
              isCollapsed ? 'justify-center' : 'justify-between'
            } transition-colors cursor-pointer text-left`}
            aria-label={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-[#e6f8f1] text-[#032f28] flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-base">
                  {isDark ? 'light_mode' : 'dark_mode'}
                </span>
              </div>
              {!isCollapsed && (
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-bold text-[#032f28]">Theme</span>
                  <span className="text-[10px] text-[#717976]">{isDark ? 'Dark Mode' : 'Light Mode'}</span>
                </div>
              )}
            </div>
            {!isCollapsed && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#e6f8f1] text-[#2e685d]">
                {isDark ? 'Dark' : 'Light'}
              </span>
            )}
          </button>

          {/* User Profile Pill */}
          <button
            type="button"
            onClick={() => {
              onTabChange('profile');
              onClose();
            }}
            title={isCollapsed ? `Profile: ${userDisplayName}` : 'View & Edit Profile'}
            className={`w-full p-2 rounded-2xl bg-[#f8fafc] hover:bg-[#e6f8f1] border border-[#e0f2eb] flex items-center ${
              isCollapsed ? 'justify-center' : 'gap-2.5'
            } transition-colors cursor-pointer text-left`}
          >
            <div className="w-8 h-8 rounded-full bg-[#b0ecdd] text-[#032f28] flex items-center justify-center text-xs font-extrabold uppercase shrink-0 shadow-xs">
              {userDisplayName ? userDisplayName.charAt(0) : 'U'}
            </div>
            {!isCollapsed && (
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-xs font-bold text-[#032f28] truncate">
                  {userDisplayName}
                </span>
                <span className="text-[10px] font-semibold text-[#2e685d] uppercase tracking-wider truncate">
                  {user.role}
                </span>
              </div>
            )}
            {!isCollapsed && (
              <span className="material-symbols-outlined text-sm text-[#717976]">account_circle</span>
            )}
          </button>

          {/* Full Clickable Logout Button & Label */}
          <button
            type="button"
            id="sidebar-logout-btn"
            onClick={() => setShowLogoutConfirm(true)}
            className={`w-full flex items-center ${
              isCollapsed ? 'justify-center p-2' : 'justify-between px-3 py-2.5'
            } rounded-2xl bg-[#fff5f5] hover:bg-[#ffdad6] border border-[#ffdad6] text-[#ba1a1a] transition-all cursor-pointer shadow-2xs group`}
            title="Sign out of MediFind"
          >
            <div className="flex items-center gap-2.5 pointer-events-none">
              <div className="w-7 h-7 rounded-lg bg-[#ffdad6] group-hover:bg-[#ffb4ab] text-[#ba1a1a] flex items-center justify-center shrink-0 transition-colors">
                <span className="material-symbols-outlined text-sm">logout</span>
              </div>
              {!isCollapsed && (
                <div className="flex flex-col text-left">
                  <span className="text-xs font-bold text-[#ba1a1a] leading-tight">Sign Out</span>
                  <span className="text-[10px] text-[#93000a] leading-tight">End session</span>
                </div>
              )}
            </div>
            {!isCollapsed && (
              <span className="material-symbols-outlined text-xs text-[#ba1a1a]/70 group-hover:translate-x-0.5 transition-transform pointer-events-none">
                chevron_right
              </span>
            )}
          </button>
        </div>
      </motion.aside>

      {/* ─── Centered Logout Confirmation Modal (portal) ───────────── */}
      {ReactDOM.createPortal(
        <AnimatePresence>
          {showLogoutConfirm && (
            <motion.div
              key="logout-modal-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[200] flex items-center justify-center p-4"
              style={{ background: 'rgba(3,47,40,0.45)', backdropFilter: 'blur(6px)' }}
              onClick={() => setShowLogoutConfirm(false)}
            >
              <motion.div
                key="logout-modal-card"
                initial={{ opacity: 0, scale: 0.92, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.92, y: 20 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30, mass: 0.7 }}
                onClick={e => e.stopPropagation()}
                className="w-full max-w-sm bg-white rounded-3xl shadow-2xl border border-[#ffd5cf] overflow-hidden"
              >
                {/* Modal Header */}
                <div className="px-6 pt-6 pb-4 flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-[#fff0ee] flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-2xl text-[#ba1a1a]">logout</span>
                  </div>
                  <div>
                    <p className="text-base font-extrabold text-[#1a0002]">Sign out of MediFind?</p>
                    <p className="text-xs text-[#717976] mt-0.5">
                      Signed in as <span className="font-bold text-[#032f28]">{userDisplayName}</span>
                    </p>
                  </div>
                </div>

                {/* Divider */}
                <div className="h-px bg-[#fde8e5] mx-6" />

                {/* Body */}
                <div className="px-6 py-4">
                  <div className="flex items-start gap-2.5 bg-[#fff8f7] border border-[#ffd5cf] rounded-2xl p-3.5">
                    <span className="material-symbols-outlined text-base text-[#ba1a1a] shrink-0 mt-0.5">info</span>
                    <p className="text-[12px] text-[#93000a] leading-relaxed">
                      Your active session as <strong>{user.role}</strong> will end. Any unsaved changes may be lost.
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="px-6 pb-6 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowLogoutConfirm(false)}
                    className="flex-1 py-3 rounded-2xl bg-[#e6f8f1] hover:bg-[#b0ecdd] text-[#032f28] text-sm font-bold border border-[#c0ddd4] transition-colors cursor-pointer"
                  >
                    Stay Signed In
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowLogoutConfirm(false);
                      onClose();
                      logout();
                    }}
                    className="flex-1 py-3 rounded-2xl bg-[#ba1a1a] hover:bg-[#93000a] text-white text-sm font-bold shadow-md transition-colors cursor-pointer"
                  >
                    Sign Out
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

    </>
  );
}
