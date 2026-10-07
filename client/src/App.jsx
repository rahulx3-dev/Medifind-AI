import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import OfflineBanner from './components/OfflineBanner';
import NotificationModal from './components/NotificationModal';
import MediFindLogo from './components/MediFindLogo';
import MediAssistant from './components/MediAssistant';
const MediFind3DHero = React.lazy(() => import('./components/MediFind3DHero'));
import ParallaxTransition from './components/ParallaxTransition';
import Footer from './components/Footer';
import AuthPage from './pages/AuthPage';
import MedicineSearch from './pages/MedicineSearch';
import PrescriptionUpload from './pages/PrescriptionUpload';
import EmergencyLocator from './pages/EmergencyLocator';
import OrderTracking from './pages/OrderTracking';
import PharmacyDiscovery from './pages/PharmacyDiscovery';
import PharmacistPortal from './pages/PharmacistPortal';
import AssistantPortal from './pages/AssistantPortal';
import AdminDashboard from './pages/AdminDashboard';
import UserProfile from './pages/UserProfile';
import { enqueueSafeAction, processOfflineQueue } from './utils/offlineActionQueue';

const ROLE_ALLOWED_TABS = {
  PATIENT: ['medicines', 'prescription', 'pharmacies', 'emergency', 'orders', 'profile'],
  PHARMACIST: ['pharmacist', 'profile'],
  ASSISTANT: ['assistant', 'profile'],
  ADMIN: ['admin', 'profile']
};

const ROLE_DEFAULT_TAB = {
  PATIENT: 'medicines',
  PHARMACIST: 'pharmacist',
  ASSISTANT: 'assistant',
  ADMIN: 'admin'
};

function MainApp() {
  const { user, loading } = useAuth();
  const [initialCheckoutOrderId, setInitialCheckoutOrderId] = useState(() => {
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/checkout/')) {
      const parts = window.location.pathname.split('/checkout/');
      return parts[1]?.trim() || null;
    }
    return null;
  });
  const [activeTab, setActiveTab] = useState(() => initialCheckoutOrderId ? 'orders' : 'medicines');
  const [notifModalOpen, setNotifModalOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifsCount, setUnreadNotifsCount] = useState(0);
  const [selectedOrderIdForTracking, setSelectedOrderIdForTracking] = useState(initialCheckoutOrderId);

  // Non-patient role sidebar tab state & mobile sidebar toggle
  const [nonPatientSubTab, setNonPatientSubTab] = useState(() => {
    if (user?.role === 'PHARMACIST') return 'overview';
    if (user?.role === 'ASSISTANT') return 'available';
    if (user?.role === 'ADMIN') return 'overview';
    return 'overview';
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (user?.role === 'PHARMACIST') setNonPatientSubTab('overview');
    else if (user?.role === 'ASSISTANT') setNonPatientSubTab('available');
    else if (user?.role === 'ADMIN') setNonPatientSubTab('overview');
  }, [user?.role]);

  // Persistent Medicine Request ("My Medicines" personal cart selection)
  const [selectedMedicines, setSelectedMedicines] = useState(() => {
    try {
      const saved = localStorage.getItem('medifind_medicine_request');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.warn('Failed to parse cached medicine request:', e);
    }
    return [];
  });

  // Sync medicine request to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('medifind_medicine_request', JSON.stringify(selectedMedicines));
    } catch (e) {
      console.error('Failed to persist medicine request:', e);
    }
  }, [selectedMedicines]);

  // Medicine request helpers
  const addToMedicineRequest = (medicine, quantity = 1) => {
    if (!medicine || !medicine.id) return;
    const qty = parseInt(quantity, 10) || 1;
    setSelectedMedicines(prev => {
      const idx = prev.findIndex(item => item.medicineId === medicine.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          quantity: Math.min(500, (updated[idx].quantity || 1) + qty)
        };
        return updated;
      }
      return [
        ...prev,
        {
          medicineId: medicine.id,
          brandName: medicine.brandName || medicine.name || 'Prescription Medicine',
          genericName: medicine.genericName || '',
          category: medicine.category || '',
          dosageForm: medicine.dosageForm || '',
          strength: medicine.strength || '',
          quantity: qty,
          price: medicine.price != null ? medicine.price : (medicine.unitPrice != null ? medicine.unitPrice : null),
          unitPrice: medicine.unitPrice != null ? medicine.unitPrice : (medicine.price != null ? medicine.price : null)
        }
      ];
    });
  };

  const updateRequestQuantity = (medicineId, quantity) => {
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      removeFromMedicineRequest(medicineId);
      return;
    }
    setSelectedMedicines(prev =>
      prev.map(item =>
        item.medicineId === medicineId ? { ...item, quantity: Math.min(500, qty) } : item
      )
    );
  };

  const removeFromMedicineRequest = (medicineId) => {
    setSelectedMedicines(prev => prev.filter(item => item.medicineId !== medicineId));
  };

  const clearMedicineRequest = () => {
    setSelectedMedicines([]);
  };

  // Set default tab when user logs in or changes role
  useEffect(() => {
    if (user && ROLE_ALLOWED_TABS[user.role]) {
      if (initialCheckoutOrderId && user.role === 'PATIENT') {
        setActiveTab('orders');
        setSelectedOrderIdForTracking(initialCheckoutOrderId);
        return;
      }
      if (!ROLE_ALLOWED_TABS[user.role].includes(activeTab)) {
        setActiveTab(ROLE_DEFAULT_TAB[user.role] || 'medicines');
      }
    }
  }, [user, initialCheckoutOrderId]);

  // Poll notifications only if authenticated (10s interval with 401 termination guard)
  useEffect(() => {
    if (!user) return;
    let intervalId = null;
    let isTerminated = false;

    async function fetchNotifications() {
      if (isTerminated) return;
      const token = localStorage.getItem('medifind_token');
      if (!token) {
        clearInterval(intervalId);
        return;
      }

      try {
        const res = await fetch('/api/notifications', {
          headers: { Authorization: `Bearer ${token}` }
        });

        // 401 Detection: Session expired or invalid; immediately stop polling
        if (res.status === 401) {
          console.warn('[Notifications] 401 Unauthorized received. Terminating polling loop.');
          isTerminated = true;
          clearInterval(intervalId);
          return;
        }

        const data = await res.json();
        if (data.success) {
          setNotifications(data.notifications || []);
          setUnreadNotifsCount(data.unreadCount || 0);
        }
      } catch (err) {
        // Silent on temporary network glitch
      }
    }

    // Process queued offline safe actions and refresh notifications on reconnect
    const handleReconnection = async () => {
      console.log('[App] Network reconnected: Flushing safe offline queue...');
      await processOfflineQueue();
      fetchNotifications();
    };

    window.addEventListener('online', handleReconnection);

    fetchNotifications();
    // Default interval changed from 5s -> 10s as per approved plan
    intervalId = setInterval(fetchNotifications, 10000);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('online', handleReconnection);
    };
  }, [user]);

  const handleMarkAllRead = async () => {
    // If currently offline, queue safe idempotent mark-read action
    if (!navigator.onLine) {
      try {
        enqueueSafeAction({
          type: 'MARK_ALL_NOTIFICATIONS_READ',
          endpoint: '/api/notifications/mark-all-read',
          method: 'PUT'
        });
        setUnreadNotifsCount(0);
        setNotifications(notifications.map(n => ({ ...n, isRead: true })));
        return;
      } catch (e) {
        console.error('Failed to queue offline safe action:', e);
      }
    }

    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch('/api/notifications/mark-all-read', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setUnreadNotifsCount(0);
        setNotifications(notifications.map(n => ({ ...n, isRead: true })));
      }
    } catch (e) {
      console.error('Error marking notifications as read:', e);
    }
  };

  const handleNotificationClick = (notif) => {
    if (!notif) return;
    const url = notif.linkUrl || '';
    const isEmergency = notif.type === 'EMERGENCY' || url.includes('emergency');

    if (user?.role === 'PATIENT') {
      if (isEmergency) {
        setActiveTab('emergency');
      } else if (url.includes('orders') || notif.orderId) {
        const match = url.match(/\/orders\/([^/?#]+)/);
        const orderId = (match && match[1]) || notif.orderId;
        if (orderId) {
          setSelectedOrderIdForTracking(orderId);
        }
        setActiveTab('orders');
      } else if (url.includes('pharmacies') || notif.type === 'RESTOCK') {
        setActiveTab('pharmacies');
      } else if (url.includes('medicines')) {
        setActiveTab('medicines');
      } else if (url.includes('profile')) {
        setActiveTab('profile');
      }
    } else if (user?.role === 'PHARMACIST') {
      if (url.includes('inventory')) {
        setNonPatientSubTab('inventory');
      } else {
        setNonPatientSubTab('orders');
      }
    } else if (user?.role === 'ASSISTANT') {
      if (url.includes('available')) {
        setNonPatientSubTab('available');
      } else {
        setNonPatientSubTab('active');
      }
    } else if (user?.role === 'ADMIN') {
      if (url.includes('pharmacies')) {
        setNonPatientSubTab('pharmacies');
      } else if (url.includes('inventory')) {
        setNonPatientSubTab('inventory');
      } else {
        setNonPatientSubTab('overview');
      }
    }
  };

  const handleClearAll = async () => {
    // If currently offline, queue safe idempotent clear-all action
    if (!navigator.onLine) {
      try {
        enqueueSafeAction({
          type: 'CLEAR_ALL_NOTIFICATIONS',
          endpoint: '/api/notifications/clear-all',
          method: 'DELETE'
        });
        setNotifications([]);
        setUnreadNotifsCount(0);
        return;
      } catch (e) {
        console.error('Failed to queue offline safe action:', e);
      }
    }

    // Optimistic UI: clear immediately
    setNotifications([]);
    setUnreadNotifsCount(0);

    const token = localStorage.getItem('medifind_token');
    try {
      await fetch('/api/notifications/clear-all', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (e) {
      console.error('Error clearing notifications:', e);
    }
  };

  const handleOrderCreated = (newOrder) => {
    if (newOrder && newOrder.id) {
      setSelectedOrderIdForTracking(newOrder.id);
    }
    // Also clear the temporary medicine request now that an order has been created
    clearMedicineRequest();
    setActiveTab('orders');
  };

  // Auth lock state — once revealed, auth section stays fixed full-screen
  const [authRevealed, setAuthRevealed] = useState(false);
  const authSentinelRef = useRef(null);
  const lenisRef = useRef(null);

  // Initialize unified Lenis smooth scrolling for unauthenticated landing view
  useEffect(() => {
    if (user || authRevealed) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    gsap.registerPlugin(ScrollTrigger);

    let lenis;
    try {
      lenis = new Lenis({
        duration: 1.25,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
        wheelMultiplier: 1.0
      });
      lenisRef.current = lenis;

      lenis.on('scroll', ScrollTrigger.update);
      const updateTicker = (time) => {
        lenis.raf(time * 1000);
      };
      gsap.ticker.add(updateTicker);
      gsap.ticker.lagSmoothing(0);

      return () => {
        gsap.ticker.remove(updateTicker);
        lenis.destroy();
        lenisRef.current = null;
      };
    } catch (e) {
      console.warn('Lenis landing init:', e);
    }
  }, [user, authRevealed]);

  const scrollToHero1 = useCallback(() => {
    if (lenisRef.current) {
      lenisRef.current.scrollTo(0, { duration: 1.2 });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const scrollToHero2 = useCallback(() => {
    const el = document.getElementById('hero-2-section');
    if (lenisRef.current && el) {
      lenisRef.current.scrollTo(el, { duration: 1.2 });
    } else if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  const scrollToAuth = useCallback(() => {
    setAuthRevealed(true);
    document.body.style.overflow = 'hidden';
  }, []);

  // Assisted scroll snapping: small scroll input smoothly sweeps to next section
  useEffect(() => {
    if (user || authRevealed) return;

    let isSnapping = false;
    let touchStartY = 0;

    const performSnap = (direction) => {
      if (isSnapping) return;
      const scrollY = window.scrollY;
      const hero1 = document.getElementById('hero-section');
      const hero2 = document.getElementById('hero-2-section');
      const hero1Height = hero1?.offsetHeight || window.innerHeight;

      if (direction === 'down') {
        // If at Hero 1, small scroll moves to Hero 2
        if (scrollY < hero1Height * 0.4) {
          isSnapping = true;
          scrollToHero2();
          setTimeout(() => { isSnapping = false; }, 900);
        }
        // If on Hero 2, scrolling down reveals Auth
        else if (scrollY >= hero1Height * 0.45) {
          const hero2Bottom = hero2 ? hero2.offsetTop + hero2.offsetHeight : 0;
          if (scrollY + window.innerHeight >= hero2Bottom - 180) {
            isSnapping = true;
            scrollToAuth();
            setTimeout(() => { isSnapping = false; }, 900);
          }
        }
      } else if (direction === 'up') {
        // If on Hero 2 and scrolling up, return to Hero 1
        if (scrollY > 60 && scrollY <= hero1Height * 1.1) {
          isSnapping = true;
          scrollToHero1();
          setTimeout(() => { isSnapping = false; }, 900);
        }
      }
    };

    const handleWheel = (e) => {
      if (Math.abs(e.deltaY) > 18) {
        performSnap(e.deltaY > 0 ? 'down' : 'up');
      }
    };

    const handleTouchStart = (e) => {
      if (e.touches && e.touches[0]) {
        touchStartY = e.touches[0].clientY;
      }
    };

    const handleTouchEnd = (e) => {
      if (e.changedTouches && e.changedTouches[0]) {
        const deltaY = touchStartY - e.changedTouches[0].clientY;
        if (Math.abs(deltaY) > 30) {
          performSnap(deltaY > 0 ? 'down' : 'up');
        }
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: true });
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [user, authRevealed, scrollToHero1, scrollToHero2, scrollToAuth]);

  // Watch sentinel at bottom of parallax to auto-reveal auth on scroll
  useEffect(() => {
    if (user) return;
    const sentinel = authSentinelRef.current;
    if (!sentinel) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setAuthRevealed(true);
          document.body.style.overflow = 'hidden';
        }
      },
      { threshold: 0.2 }
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [user]);

  // Reset body overflow on cleanup / login
  useEffect(() => {
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    if (!user && typeof window !== 'undefined') {
      const search = window.location.search;
      const hash = window.location.hash;
      if (search.includes('login') || search.includes('auth') || hash === '#auth' || hash === '#login') {
        const timer = setTimeout(scrollToAuth, 200);
        return () => clearTimeout(timer);
      }
    }
  }, [user, scrollToAuth]);

  // 1. Initial Session Loading State
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background text-on-surface">
        <div className="text-center flex flex-col items-center gap-4">
          <MediFindLogo size="lg" />
          <div className="w-10 h-10 rounded-full border-3 border-secondary/20 border-t-primary animate-spin" />
          <p className="text-sm font-bold text-primary">Synchronizing Clinical Session...</p>
        </div>
      </div>
    );
  }

  // 2. Unauthenticated Gate: Hero → Parallax → Fixed Auth overlay
  if (!user) {
    // Add dark background to body to prevent white flash
    document.body.classList.add('landing-dark');
    return (
      <div style={{ position: 'relative', background: '#011a15' }}>
        {/* Top Floating Glass Header */}
        <header className="fixed top-0 left-0 right-0 z-50 bg-[#011a15]/90 backdrop-blur-xl border-b border-white/10 px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between" style={{ boxShadow: '0 1px 8px rgba(0,0,0,0.3)' }}>
          <MediFindLogo size="md" showSubtitle={true} inverted={true} />
          <button
            type="button"
            onClick={scrollToAuth}
            className="px-5 py-2.5 rounded-full bg-[#10b981] hover:bg-[#059669] text-white text-xs font-bold shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <span>Sign In / Enter Portal</span>
            <span className="material-symbols-outlined text-base">arrow_forward</span>
          </button>
        </header>

        {/* Scrollable content behind the fixed header */}
        <div style={{ paddingTop: 64 }}>
          {/* 1. 3D Hero */}
          <section id="hero-section" style={{ width: '100%' }}>
            <React.Suspense fallback={
              <div className="w-full min-h-[520px] bg-gradient-to-br from-[#011a15] to-[#032f28] flex flex-col items-center justify-center p-6 text-white/70">
                <div className="w-10 h-10 rounded-full border-3 border-emerald-400/30 border-t-emerald-400 animate-spin mb-3" />
                <span className="text-xs font-semibold tracking-wider text-emerald-300">Loading 3D Access Network…</span>
              </div>
            }>
              <MediFind3DHero
                onProceed={scrollToHero2}
                onDirectLogin={scrollToAuth}
                onNavigateEmergency={scrollToAuth}
              />
            </React.Suspense>
          </section>

          {/* 2. Parallax Transition (Hero 2) */}
          <section id="hero-2-section" style={{ width: '100%' }}>
            <ParallaxTransition onProceed={scrollToAuth} />
          </section>

          {/* Sentinel: when this enters viewport, reveal auth overlay */}
          <div ref={authSentinelRef} style={{ height: 1 }} aria-hidden="true" />
        </div>

        {/* 3. Fixed Full-Screen Auth Overlay with smooth entrance animation */}
        <AnimatePresence>
          {authRevealed && (
            <motion.div
              id="auth-section"
              initial={{ opacity: 0, scale: 0.985 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.985 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 100,
                background: 'linear-gradient(160deg, #ecfdf7 0%, #f0fdf8 50%, #e6f8f1 100%)',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              {/* Auth header bar */}
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 20,
                  background: 'rgba(236,253,247,0.95)',
                  backdropFilter: 'blur(12px)',
                  borderBottom: '1px solid #d5e6e0',
                  padding: '12px 24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthRevealed(false);
                      document.body.style.overflow = '';
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 14px',
                      borderRadius: 9999,
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#032f28',
                      backgroundColor: '#e0f2eb',
                      border: '1px solid #c1ebe1',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_back</span>
                    <span>Back to 3D World</span>
                  </button>
                  <MediFindLogo size="sm" showSubtitle={false} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} className="animate-pulse" />
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#032f28', textTransform: 'uppercase', letterSpacing: '0.15em' }}>Clinical Access Portal</span>
                </div>
              </motion.div>

              {/* AuthPage content */}
              <motion.div
                initial={{ opacity: 0, y: 28, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem' }}
              >
                <AuthPage onLoginSuccess={(role) => {
                  setAuthRevealed(false);
                  document.body.style.overflow = '';
                  setActiveTab(ROLE_DEFAULT_TAB[role] || 'medicines');
                }} showBackground={false} />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // Helper to check if current tab is allowed for user's role
  const isTabAllowed = (tab) => ROLE_ALLOWED_TABS[user?.role]?.includes(tab);

  // Remove the landing dark class now that user is authenticated
  document.body.classList.remove('landing-dark');

  // NON-PATIENT ROLES (PHARMACIST, ASSISTANT, ADMIN): Render Sidebar Navigation instead of Top Navbar
  if (user && user.role !== 'PATIENT') {
    return (
      <div className="min-h-screen flex bg-background text-on-surface">
        {/* Left Slide-over Sidebar Drawer */}
        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          currentTab={nonPatientSubTab}
          onTabChange={setNonPatientSubTab}
          onOpenNotifications={() => setNotifModalOpen(true)}
          unreadNotifsCount={unreadNotifsCount}
        />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
          {/* Top Bar */}
          <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-xl border-b border-[#e0e8e5] px-4 sm:px-6 h-16 flex items-center justify-between shadow-[0_1px_4px_rgba(3,47,40,0.04)]">
            <div className="flex items-center gap-3">
              {/* Mobile-only open button — sidebar is always visible on md+ */}
              <button
                onClick={() => setSidebarOpen(true)}
                className="md:hidden w-10 h-10 rounded-xl bg-[#e6f8f1] hover:bg-[#b0ecdd] text-[#032f28] flex items-center justify-center transition-colors shadow-xs focus:outline-none focus:ring-2 focus:ring-[#2e685d]"
                title="Open sidebar menu"
                aria-label="Open sidebar menu"
              >
                <span className="material-symbols-outlined text-2xl">menu</span>
              </button>

              <div className="h-5 w-px bg-outline-variant/40 hidden sm:block"></div>

              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full bg-[#e0f2eb] text-[#032f28] text-xs font-bold font-mono uppercase tracking-wider">
                  {user.role === 'PHARMACIST' ? 'Pharmacist Portal' : user.role === 'ASSISTANT' ? 'Assistant Portal' : 'Operations Center'}
                </span>
                <span className="text-xs font-semibold text-[#2e685d]">
                  • {
                    nonPatientSubTab === 'profile'
                      ? 'Specialist Profile & Credentials'
                      : user.role === 'PHARMACIST'
                      ? (nonPatientSubTab === 'inventory' ? 'Inventory Management' : 'Reservation Queue')
                      : user.role === 'ASSISTANT'
                      ? (nonPatientSubTab === 'active' ? 'Active Delivery Journey' : nonPatientSubTab === 'completed' ? 'Completed Dispatches' : 'Available Tasks')
                      : (nonPatientSubTab === 'users' ? 'Users Directory' : nonPatientSubTab === 'pharmacies' ? 'Pharmacies Registry' : nonPatientSubTab === 'orders' ? 'Orders Tracking' : nonPatientSubTab === 'emergency' ? 'Emergency & Logistics' : nonPatientSubTab === 'activity' ? 'Audit Timeline' : 'Overview & Metrics')
                  }
                </span>
              </div>
            </div>

            {/* Right utilities: Network status chip, Notifications, User info */}
            <div className="flex items-center gap-3">
              <div className="hidden lg:flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#e6f8f1] text-[11px] font-semibold text-[#032f28] border border-[#d5e6e0]">
                <span className="w-2 h-2 rounded-full bg-[#2e685d] animate-pulse"></span>
                <span>
                  {user.role === 'PHARMACIST' ? 'Inventory Sync' : user.role === 'ASSISTANT' ? 'Relay Active' : 'System Active'}
                </span>
              </div>

              <button
                onClick={() => setNotifModalOpen(true)}
                className="relative w-9 h-9 rounded-full bg-[#e6f8f1] hover:bg-[#b0ecdd] text-[#032f28] flex items-center justify-center transition-colors shadow-xs"
                title="View Notifications"
              >
                <span className="material-symbols-outlined text-xl">notifications</span>
                {unreadNotifsCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-[#ba1a1a] text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-xs">
                    {unreadNotifsCount > 9 ? '9+' : unreadNotifsCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setNonPatientSubTab('profile')}
                className="hidden sm:flex items-center gap-2 bg-[#f8fafc] hover:bg-[#e0f2eb] pl-1 pr-3 py-1 rounded-full border border-[#e0f2eb] transition-colors cursor-pointer"
                title="View & Edit Profile"
              >
                <div className="w-7 h-7 rounded-full bg-[#b0ecdd] text-[#032f28] flex items-center justify-center text-xs font-bold uppercase">
                  {user.name ? user.name.charAt(0) : 'U'}
                </div>
                <span className="text-xs font-bold text-[#032f28] truncate max-w-[120px]">
                  {user.name}
                </span>
              </button>
            </div>
          </header>

          <main className="flex-1">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-2">
              <OfflineBanner />
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={nonPatientSubTab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              >
                {nonPatientSubTab === 'profile' ? (
                  <UserProfile role={user.role} onNavigate={(tab) => setNonPatientSubTab(tab)} />
                ) : (
                  <>
                    {user.role === 'PHARMACIST' && (
                      <PharmacistPortal currentTab={nonPatientSubTab} onTabChange={setNonPatientSubTab} />
                    )}

                    {user.role === 'ASSISTANT' && (
                      <AssistantPortal currentTab={nonPatientSubTab} onTabChange={setNonPatientSubTab} />
                    )}

                    {user.role === 'ADMIN' && (
                      <AdminDashboard currentTab={nonPatientSubTab} onTabChange={setNonPatientSubTab} />
                    )}
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </main>

          {/* Real-Time Notifications Modal */}
          <NotificationModal
            isOpen={notifModalOpen}
            onClose={() => setNotifModalOpen(false)}
            notifications={notifications}
            onMarkAllRead={handleMarkAllRead}
            onClearAll={handleClearAll}
            onNotificationClick={handleNotificationClick}
          />

          {/* Medi AI Assistant — floating robot helper */}
          <MediAssistant
            onNavigate={(tab) => setNonPatientSubTab(tab)}
            userRole={user?.role}
            selectedMedicines={selectedMedicines}
            onAddToRequest={addToMedicineRequest}
            onProceedToPharmacies={() => setNonPatientSubTab('pharmacies')}
          />

          {/* 21st.dev Stacked Circular Footer for Specialist Operations */}
          <Footer
            onNavigate={(tab) => setNonPatientSubTab(tab)}
            role={user.role}
          />
        </div>
      </div>
    );
  }

  // PATIENT ROLE: Top Navbar Layout
  return (
    <div className="min-h-screen flex flex-col bg-background text-on-surface">
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenNotifications={() => setNotifModalOpen(true)}
        unreadNotifsCount={unreadNotifsCount}
        medicineRequestCount={selectedMedicines.length}
      />

      {/* Main Content Area */}
      <main className="flex-1 pb-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
          <OfflineBanner />
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Route Protection */}
            {!isTabAllowed(activeTab) ? (
              <div className="max-w-md mx-auto my-12 p-8 bg-surface-container-lowest rounded-3xl border border-error-container text-center shadow-sm">
                <div className="w-14 h-14 rounded-full bg-error-container text-error flex items-center justify-center mx-auto mb-4">
                  <span className="material-symbols-outlined text-3xl">gpp_maybe</span>
                </div>
                <h2 className="text-xl font-bold text-primary mb-2">
                  Access Restricted (403)
                </h2>
                <p className="text-sm text-on-surface-variant mb-6 leading-relaxed">
                  Your account with role <strong>{user.role}</strong> does not have authorization to view this clinical workflow.
                </p>
                <button
                  onClick={() => setActiveTab(ROLE_DEFAULT_TAB[user.role] || 'medicines')}
                  className="px-6 py-2.5 rounded-full bg-primary hover:bg-primary-container text-white font-bold text-sm shadow-sm transition-all"
                >
                  Return to Authorized Portal
                </button>
              </div>
            ) : (
              <>
                {activeTab === 'medicines' && (
                  <MedicineSearch
                    onOrderCreated={handleOrderCreated}
                    selectedMedicines={selectedMedicines}
                    onAddToRequest={addToMedicineRequest}
                    onUpdateRequestQuantity={updateRequestQuantity}
                    onRemoveFromRequest={removeFromMedicineRequest}
                    onClearRequest={clearMedicineRequest}
                    onProceedToPharmacies={() => setActiveTab('pharmacies')}
                    onNavigateToPrescription={() => setActiveTab('prescription')}
                    onNavigateToEmergency={() => setActiveTab('emergency')}
                  />
                )}

                {activeTab === 'prescription' && (
                  <PrescriptionUpload
                    onOrderCreated={handleOrderCreated}
                    onAddVerifiedToRequest={(verifiedItems) => {
                      (verifiedItems || []).forEach(i => {
                        addToMedicineRequest({
                          id: i.medicineId,
                          brandName: i.brandName,
                          genericName: i.genericName,
                          dosageForm: i.dosageForm,
                          strength: i.strength,
                          price: i.price != null ? i.price : (i.unitPrice != null ? i.unitPrice : null)
                        }, i.quantity);
                      });
                    }}
                    onProceedToPharmacies={(items) => {
                      if (Array.isArray(items) && items.length > 0) {
                        items.forEach(i => {
                          addToMedicineRequest({
                            id: i.medicineId,
                            brandName: i.brandName,
                            genericName: i.genericName,
                            dosageForm: i.dosageForm,
                            strength: i.strength,
                            price: i.price != null ? i.price : (i.unitPrice != null ? i.unitPrice : null)
                          }, i.quantity);
                        });
                      }
                      setActiveTab('pharmacies');
                    }}
                  />
                )}

                {activeTab === 'pharmacies' && (
                  <PharmacyDiscovery
                    onOrderCreated={handleOrderCreated}
                    selectedMedicines={selectedMedicines}
                    onClearSelectedMedicines={clearMedicineRequest}
                  />
                )}

                {activeTab === 'emergency' && (
                  <EmergencyLocator onOrderCreated={handleOrderCreated} />
                )}

                {activeTab === 'orders' && (
                  <OrderTracking
                    initialOrderId={selectedOrderIdForTracking}
                    initialCheckoutOrderId={initialCheckoutOrderId}
                    onNavigate={(tab) => setActiveTab(tab)}
                  />
                )}

                {activeTab === 'pharmacist' && (
                  <PharmacistPortal />
                )}

                {activeTab === 'assistant' && (
                  <AssistantPortal />
                )}

                {activeTab === 'admin' && (
                  <AdminDashboard />
                )}

                {activeTab === 'profile' && (
                  <UserProfile role="PATIENT" onNavigate={(tab) => setActiveTab(tab)} />
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Real-Time Notifications Modal */}
      <NotificationModal
        isOpen={notifModalOpen}
        onClose={() => setNotifModalOpen(false)}
        notifications={notifications}
        onMarkAllRead={handleMarkAllRead}
        onClearAll={handleClearAll}
        onNotificationClick={handleNotificationClick}
      />

      {/* Medi AI Assistant — floating robot helper for patients */}
      <MediAssistant
        onNavigate={(tab) => setActiveTab(tab)}
        userRole={user?.role}
        selectedMedicines={selectedMedicines}
        onAddToRequest={addToMedicineRequest}
        onProceedToPharmacies={() => setActiveTab('pharmacies')}
      />

      {/* 21st.dev Stacked Circular Footer with real MediFind content */}
      <Footer
        onNavigate={(tab) => setActiveTab(tab)}
        role={user?.role}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}

