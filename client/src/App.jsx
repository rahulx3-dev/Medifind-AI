import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import Sidebar, { AnimatedHamburgerIcon } from './components/Sidebar';
import OfflineBanner from './components/OfflineBanner';
import NotificationModal from './components/NotificationModal';
import ConfirmationDialog from './components/ConfirmationDialog';
import ToastAlert from './components/ToastAlert';
import MediFindLogo from './components/MediFindLogo';
import LoaderGrid, { AppLoadingScreen } from './components/ui/loader-grid';
import { useBarbaInit, BarbaCurtainOverlay, BarbaContainer } from './components/ui/BarbaPageTransition';
import { usePortalGreeting } from './utils/greetingUtils';
import MediAssistant from './components/MediAssistant';
const MediFind3DHero = React.lazy(() => import('./components/MediFind3DHero'));
import ParallaxTransition from './components/ParallaxTransition';
import MediFindAiLanding from './components/MediFindAiLanding';
import Footer from './components/Footer';
import AuthPage from './pages/AuthPage';
import { HeroGeometricBackground } from './components/HeroGeometric';
import MedicineSearch from './pages/MedicineSearch';
const PrescriptionUpload = React.lazy(() => import('./pages/PrescriptionUpload'));
const EmergencyLocator = React.lazy(() => import('./pages/EmergencyLocator'));
const OrderTracking = React.lazy(() => import('./pages/OrderTracking'));
const PharmacyDiscovery = React.lazy(() => import('./pages/PharmacyDiscovery'));
const PharmacistPortal = React.lazy(() => import('./pages/PharmacistPortal'));
const AssistantPortal = React.lazy(() => import('./pages/AssistantPortal'));
const AdminDashboard = React.lazy(() => import('./pages/AdminDashboard'));
const UserProfile = React.lazy(() => import('./pages/UserProfile'));
const HealthcareMarketplace = React.lazy(() => import('./pages/HealthcareMarketplace'));
import { enqueueSafeAction, processOfflineQueue } from './utils/offlineActionQueue';
import { broadcastUpdate, subscribeToUpdates } from './utils/realtimeUpdates';
import { calculateMedicinePricing, roundCurrency } from './utils/referencePricing';

function PageLoaderFallback() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16 flex flex-col items-center justify-center min-h-[350px]">
      <div className="w-9 h-9 border-3 border-emerald-500/20 border-t-emerald-600 rounded-full animate-spin mb-3" />
      <span className="text-xs font-semibold text-[#032f28]/70 tracking-wide uppercase animate-pulse">
        Loading clinical view...
      </span>
    </div>
  );
}

const ROLE_ALLOWED_TABS = {
  PATIENT: ['medicines', 'prescription', 'pharmacies', 'emergency', 'orders', 'healthcare', 'profile'],
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

function parseRouteFromLocation() {
  if (typeof window === 'undefined') return { tab: 'medicines', subTab: 'services', checkoutId: null };
  const pathname = window.location.pathname.toLowerCase();

  if (pathname.startsWith('/checkout/')) {
    const parts = window.location.pathname.split('/checkout/');
    return { tab: 'orders', subTab: null, checkoutId: parts[1]?.trim() || null };
  }
  if (pathname === '/clinical-assistance' || pathname === '/tele-assistance' || pathname === '/assistance') {
    return { tab: 'healthcare', subTab: 'clinical-assistance', checkoutId: null };
  }
  if (pathname === '/appointments' || pathname === '/my-appointments') {
    return { tab: 'healthcare', subTab: 'my-appointments', checkoutId: null };
  }
  if (pathname === '/professionals' || pathname === '/clinicians' || pathname === '/nurses') {
    return { tab: 'healthcare', subTab: 'professionals', checkoutId: null };
  }
  if (pathname === '/healthcare' || pathname === '/services' || pathname === '/homecare') {
    return { tab: 'healthcare', subTab: 'services', checkoutId: null };
  }
  if (pathname === '/prescription' || pathname === '/upload-prescription' || pathname === '/ocr') {
    return { tab: 'prescription', subTab: null, checkoutId: null };
  }
  if (pathname === '/pharmacies' || pathname === '/discovery' || pathname === '/stores') {
    return { tab: 'pharmacies', subTab: null, checkoutId: null };
  }
  if (pathname === '/emergency' || pathname === '/emergency-locator' || pathname === '/duty') {
    return { tab: 'emergency', subTab: null, checkoutId: null };
  }
  if (pathname === '/orders' || pathname === '/tracking' || pathname === '/my-orders') {
    return { tab: 'orders', subTab: null, checkoutId: null };
  }
  if (pathname === '/profile' || pathname === '/account') {
    return { tab: 'profile', subTab: null, checkoutId: null };
  }
  if (pathname === '/pharmacist') {
    return { tab: 'pharmacist', subTab: null, checkoutId: null };
  }
  if (pathname === '/assistant') {
    return { tab: 'assistant', subTab: null, checkoutId: null };
  }
  if (pathname === '/admin') {
    return { tab: 'admin', subTab: null, checkoutId: null };
  }
  return { tab: 'medicines', subTab: 'services', checkoutId: null };
}

function MainApp() {
  useBarbaInit();
  const { user, loading, logout } = useAuth();
  const { fullName: userDisplayName, firstName: userFirstName, timeGreet: userTimeGreet, icon: userGreetIcon } = usePortalGreeting(user, user?.role || 'PHARMACIST');
  const [showNonPatientLogoutConfirm, setShowNonPatientLogoutConfirm] = useState(false);
  const initialRouteRef = useRef(null);
  if (!initialRouteRef.current) {
    initialRouteRef.current = parseRouteFromLocation();
  }

  const [initialCheckoutOrderId, setInitialCheckoutOrderId] = useState(() => initialRouteRef.current.checkoutId);
  const [activeTab, setActiveTab] = useState(() => initialRouteRef.current.tab);
  const [healthcareSubTab, setHealthcareSubTab] = useState(() => initialRouteRef.current.subTab || 'services');
  const [selectedOrderIdForTracking, setSelectedOrderIdForTracking] = useState(initialRouteRef.current.checkoutId);
  const [notifModalOpen, setNotifModalOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifsCount, setUnreadNotifsCount] = useState(0);

  const navigateToTab = useCallback((tab, subTab = null, options = {}) => {
    setActiveTab(tab);
    if (tab === 'healthcare' && subTab) {
      setHealthcareSubTab(subTab);
    }
    if (typeof window !== 'undefined' && !options.skipHistory) {
      let path = '/' + tab;
      if (tab === 'medicines') path = '/';
      else if (tab === 'healthcare') {
        if (subTab === 'clinical-assistance') path = '/clinical-assistance';
        else if (subTab === 'my-appointments') path = '/appointments';
        else if (subTab === 'professionals') path = '/professionals';
        else path = '/healthcare';
      }
      if (window.location.pathname !== path) {
        window.history.pushState({ tab, subTab }, '', path);
      }
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const parsed = parseRouteFromLocation();
      setActiveTab(parsed.tab);
      if (parsed.subTab) setHealthcareSubTab(parsed.subTab);
      if (parsed.checkoutId) {
        setInitialCheckoutOrderId(parsed.checkoutId);
        setSelectedOrderIdForTracking(parsed.checkoutId);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

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
  const [activePrescriptionId, setActivePrescriptionId] = useState(null);

  // Sync medicine request to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('medifind_medicine_request', JSON.stringify(selectedMedicines));
    } catch (e) {
      console.error('Failed to persist medicine request:', e);
    }
  }, [selectedMedicines]);

  // Medicine request helpers with authoritative sale units and pack pricing
  const addToMedicineRequest = (medicine, quantity = 1, isExact = false, saleUnit = null) => {
    if (!medicine || (!medicine.id && !medicine.brandName && !medicine.name)) return;
    const medId = medicine.id || `med-item-${(medicine.brandName || medicine.name || 'custom').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const effectiveMed = { ...medicine, id: medId };
    const qty = parseInt(quantity, 10) || 1;
    setSelectedMedicines(prev => {
      const unitsPerPack = effectiveMed.unitsPerPack || 1;
      const targetSaleUnit = saleUnit || effectiveMed.saleUnit || (
        unitsPerPack > 1 && ((effectiveMed.dosageForm || '').toLowerCase().includes('tablet') || (effectiveMed.dosageForm || '').toLowerCase().includes('capsule'))
          ? (qty < unitsPerPack ? 'TABLET' : 'STRIP')
          : 'UNIT'
      );
      const publishedMrp = effectiveMed.publishedMrp != null ? roundCurrency(effectiveMed.publishedMrp) : (effectiveMed.price != null ? roundCurrency(effectiveMed.price) : null);
      const unitPrice = effectiveMed.unitPrice != null ? roundCurrency(effectiveMed.unitPrice) : (publishedMrp ? roundCurrency(publishedMrp / unitsPerPack) : null);

      const pricing = calculateMedicinePricing({
        publishedMrp,
        unitPrice,
        unitsPerPack,
        dosageForm: effectiveMed.dosageForm || 'Tablet',
        saleUnit: targetSaleUnit,
        quantity: qty
      });

      const idx = prev.findIndex(item => item.medicineId === medId && (item.saleUnit === targetSaleUnit || !item.saleUnit));
      if (idx >= 0) {
        const updated = [...prev];
        const newQty = isExact ? qty : Math.min(500, (updated[idx].quantity || 1) + qty);
        const updatedPricing = calculateMedicinePricing({
          publishedMrp,
          unitPrice,
          unitsPerPack,
          dosageForm: medicine.dosageForm || 'Tablet',
          saleUnit: targetSaleUnit,
          quantity: newQty
        });
        updated[idx] = {
          ...updated[idx],
          quantity: newQty,
          saleUnit: targetSaleUnit,
          effectiveUnitPrice: updatedPricing.effectiveUnitPrice,
          price: updatedPricing.effectiveUnitPrice,
          unitPrice: updatedPricing.unitPrice,
          publishedMrp: updatedPricing.publishedMrp,
          subtotal: updatedPricing.lineTotal
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
          saleUnit: targetSaleUnit,
          unitsPerPack,
          packSize: medicine.packSize || (unitsPerPack > 1 ? `Strip of ${unitsPerPack}` : `1 ${medicine.dosageForm || 'Unit'}`),
          publishedMrp: pricing.publishedMrp,
          unitPrice: pricing.unitPrice,
          effectiveUnitPrice: pricing.effectiveUnitPrice,
          price: pricing.effectiveUnitPrice,
          subtotal: pricing.lineTotal
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
      prev.map(item => {
        if (item.medicineId !== medicineId) return item;
        const newQty = Math.min(500, qty);
        const pricing = calculateMedicinePricing({
          publishedMrp: item.publishedMrp,
          unitPrice: item.unitPrice,
          unitsPerPack: item.unitsPerPack || 1,
          dosageForm: item.dosageForm || 'Tablet',
          saleUnit: item.saleUnit || 'TABLET',
          quantity: newQty
        });
        return {
          ...item,
          quantity: newQty,
          subtotal: pricing.lineTotal,
          price: pricing.effectiveUnitPrice
        };
      })
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

  // Poll notifications only if authenticated (realtime responsive interval with 401 termination guard)
  const prevUnreadRef = useRef(0);
  useEffect(() => {
    if (!user) return;
    let intervalId = null;
    let isTerminated = false;

    async function fetchNotifications() {
      if (isTerminated) return;
      if (document.hidden) return; // Save resources when tab is in background
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
          const newNotifs = data.notifications || [];
          const newCount = data.unreadCount || 0;
          setNotifications(newNotifs);
          setUnreadNotifsCount(newCount);

          // If new notifications arrived, trigger instant data refresh across active views
          if (newCount > prevUnreadRef.current) {
            broadcastUpdate('NEW_NOTIFICATION', { unreadCount: newCount });
          }
          prevUnreadRef.current = newCount;
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

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchNotifications();
      }
    };

    window.addEventListener('online', handleReconnection);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Subscribe to immediate internal update events to refetch notifications without delay
    const unsubscribeUpdates = subscribeToUpdates((event) => {
      if (event.type !== 'NOTIFICATION_RECEIVED' && event.type !== 'NEW_NOTIFICATION') {
        fetchNotifications();
      }
    });

    fetchNotifications();
    intervalId = setInterval(() => {
      if (!document.hidden && navigator.onLine) {
        fetchNotifications();
      }
    }, 20000);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('online', handleReconnection);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribeUpdates();
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

  const handleRemoveNotification = async (notificationId) => {
    if (!notificationId) return;
    const removedNotif = notifications.find(n => n.id === notificationId);

    // Optimistically remove from state immediately
    setNotifications(prev => prev.filter(n => n.id !== notificationId));
    if (removedNotif && !removedNotif.isRead) {
      setUnreadNotifsCount(prev => Math.max(0, prev - 1));
    }

    if (!navigator.onLine) {
      try {
        enqueueSafeAction({
          type: 'DELETE_NOTIFICATION',
          endpoint: `/api/notifications/${notificationId}`,
          method: 'DELETE'
        });
      } catch (e) {
        console.error('Failed to queue offline safe action:', e);
      }
      return;
    }

    const token = localStorage.getItem('medifind_token');
    try {
      await fetch(`/api/notifications/${notificationId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (e) {
      console.error('Error removing notification:', e);
    }
  };

  const handleOrderCreated = (newOrder) => {
    if (newOrder && newOrder.id) {
      setSelectedOrderIdForTracking(newOrder.id);
    }
    // Also clear the temporary medicine request and prescription session now that an order has been created
    clearMedicineRequest();
    try { localStorage.removeItem('medifind_prescription_session'); } catch (_) {}
    try { sessionStorage.removeItem('medifind_rx_image'); } catch (_) {}
    setActiveTab('orders');
  };

  // Landing view state & full-screen static Auth overlay
  const [authRevealed, setAuthRevealed] = useState(false);
  const [pendingTargetTab, setPendingTargetTab] = useState(null);

  const scrollToAuth = useCallback(() => {
    setAuthRevealed(true);
    document.body.style.overflow = 'hidden';
  }, []);

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

  // 1. Initial Session Loading State (App Logo with meaning-aligned motion & LoaderGrid on Barba #A5D6A7 bg)
  if (loading) {
    return <AppLoadingScreen />;
  }

  // 2. Unauthenticated Gate: AI SaaS Landing Page with 3D Hero Sculpture + All Sections + Unscrollable Auth Modal
  if (!user) {
    return (
      <div style={{ position: 'relative', minHeight: '100vh', background: 'var(--nf-page, #0b0b0b)' }}>
        <MediFindAiLanding
          onSignIn={scrollToAuth}
          onNavigate={(target) => {
            if (['medicines', 'prescriptions', 'pharmacies', 'healthcare', 'emergency'].includes(target)) {
              setActiveTab(target);
            } else if (['pharmacist', 'assistant', 'admin'].includes(target)) {
              setNonPatientSubTab(target);
            }
            setPendingTargetTab(target);
            scrollToAuth();
          }}
          user={user}
        />

        {/* 3. Static Full-Screen Auth Overlay with Animated Shader BG (STRICTLY UN-SCROLLABLE) */}
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
                backgroundColor: '#f0fdf8',
                overflow: 'hidden',
                height: '100vh',
                width: '100vw',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              {/* 3D Geometric Shader Background with MediFind Theme Colors (#A5D6A7 animation & #e8f8f2 pale clinical mint) */}
              <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
                <HeroGeometricBackground
                  color1="#A5D6A7"
                  color2="#e8f8f2"
                  speed={0.7}
                />
              </div>

              {/* Floating Back Control - zero vertical screen impact */}
              <motion.button
                type="button"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.25, delay: 0.1 }}
                onClick={() => {
                  setAuthRevealed(false);
                  document.body.style.overflow = '';
                }}
                className="fixed top-4 left-4 sm:top-5 sm:left-5 z-40 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/90 hover:bg-white text-[#032f28] text-xs font-semibold shadow-xs hover:shadow-md border border-emerald-950/10 backdrop-blur-md transition-all active:scale-95 cursor-pointer"
                aria-label="Back to Portal Home"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_back</span>
                <span>Back</span>
              </motion.button>

              {/* Centered Single-Page Auth Card Area */}
              <div
                style={{
                  position: 'relative',
                  zIndex: 10,
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '12px',
                  boxSizing: 'border-box'
                }}
              >
                <AuthPage
                  initialRole={
                    pendingTargetTab === 'pharmacist'
                      ? 'PHARMACY'
                      : pendingTargetTab === 'assistant'
                      ? 'ASSISTANT'
                      : pendingTargetTab === 'admin'
                      ? 'ADMIN'
                      : 'PATIENT'
                  }
                  onLoginSuccess={(role) => {
                    try { sessionStorage.setItem('medifind_auth_entrance', '1'); } catch (_) {}
                    setAuthRevealed(false);
                    document.body.style.overflow = '';
                    if (pendingTargetTab) {
                      if (ROLE_ALLOWED_TABS[role]?.includes(pendingTargetTab)) {
                        setActiveTab(pendingTargetTab);
                      } else {
                        setActiveTab(ROLE_DEFAULT_TAB[role] || 'medicines');
                      }
                      setPendingTargetTab(null);
                    } else {
                      setActiveTab(ROLE_DEFAULT_TAB[role] || 'medicines');
                    }
                  }}
                  onClose={() => {
                    setAuthRevealed(false);
                    document.body.style.overflow = '';
                  }}
                  showBackground={false}
                />
              </div>
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
      <div
        className="min-h-screen flex bg-background text-on-surface"
      >
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
          {user.role === 'ADMIN' ? (
            /* Admin Clean Greeting Header with NO background, interactive badge, larger bold text */
            <header className="px-6 py-5 flex items-center justify-between transition-colors bg-transparent border-none shadow-none">
              <div className="flex items-center gap-4 flex-wrap">
                {/* Mobile hamburger toggle */}
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="md:hidden w-10 h-10 rounded-xl bg-[#e6f8f1] dark:bg-[#1a1d21] hover:bg-[#b0ecdd] text-[#032f28] flex items-center justify-center transition-colors shadow-xs"
                  title="Open sidebar menu"
                  aria-label="Open sidebar menu"
                >
                  <AnimatedHamburgerIcon isOpen={sidebarOpen} size={18} color="#032f28" />
                </button>

                {/* Greeting + Admin Name + Interactive Admin Badge */}
                <div className="flex items-center gap-3.5 select-none flex-wrap">
                  <span className="material-symbols-outlined text-[#2e685d] dark:text-emerald-400 text-3xl">
                    {userGreetIcon || 'wb_sunny'}
                  </span>
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <h1 className="text-2xl sm:text-3xl font-extrabold text-[#032f28] dark:text-[#f8f9fa] tracking-tight leading-snug m-0">
                      {userTimeGreet}, {userDisplayName || userFirstName || 'MediFind System Admin'}!
                    </h1>
                    {/* Interactive Admin Badge */}
                    <button
                      type="button"
                      onClick={() => setNonPatientSubTab('profile')}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#e6f8f1] dark:bg-emerald-950/80 hover:bg-[#b0ecdd] text-[#032f28] dark:text-emerald-300 border border-[#b0ecdd] dark:border-emerald-800 text-xs font-bold font-mono tracking-wide transition-all shadow-xs hover:shadow-sm hover:scale-105 active:scale-95 cursor-pointer"
                      title="Admin Authority Clearance Level 3 • Click to view security dossier"
                    >
                      <span className="w-2 h-2 rounded-full bg-[#2e685d] dark:bg-emerald-400 animate-pulse"></span>
                      <span>SYSTEM ADMIN</span>
                      <span className="material-symbols-outlined text-xs">shield</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Minimal essential utilities */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setNotifModalOpen(true)}
                  className="relative w-9 h-9 rounded-full hover:bg-[#e6f8f1] dark:hover:bg-[#30353a] text-[#032f28] dark:text-[#f8f9fa] flex items-center justify-center transition-colors cursor-pointer"
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
                  onClick={() => setShowNonPatientLogoutConfirm(true)}
                  className="px-3 py-1 rounded-full text-xs font-semibold text-[#52605b] hover:text-[#ba1a1a] hover:bg-[#ffdad6]/40 flex items-center gap-1 transition-colors cursor-pointer"
                  title="Sign out of MediFind"
                >
                  <span className="material-symbols-outlined text-base">logout</span>
                  <span className="hidden sm:inline">Sign Out</span>
                </button>
              </div>
            </header>
          ) : (
            <header className="sticky top-0 z-40 bg-white/95 dark:bg-[#212529]/95 backdrop-blur-xl border-b border-[#e0e8e5] dark:border-[#3d4349] px-4 sm:px-6 h-16 flex items-center justify-between shadow-[0_1px_4px_rgba(3,47,40,0.04)] dark:shadow-[0_1px_8px_rgba(0,0,0,0.3)] transition-colors">
              <div className="flex items-center gap-3">
                {/* Mobile-only open button — sidebar is always visible on md+ */}
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="md:hidden w-10 h-10 rounded-xl bg-[#e6f8f1] dark:bg-[#1a1d21] hover:bg-[#b0ecdd] dark:hover:bg-[#30353a] text-[#032f28] dark:text-[#f8f9fa] flex items-center justify-center transition-colors shadow-xs focus:outline-none focus:ring-2 focus:ring-[#2e685d]"
                  title="Open sidebar menu"
                  aria-label="Open sidebar menu"
                >
                  <AnimatedHamburgerIcon isOpen={sidebarOpen} size={18} color="#032f28" />
                </button>

                <div className="h-5 w-px bg-outline-variant/40 dark:bg-[#3d4349] hidden sm:block"></div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setNonPatientSubTab('tasks')}
                    title={`${user.role === 'PHARMACIST' ? 'Pharmacist Portal' : 'Assistant Portal'} • Click to view operations dashboard`}
                    className="group relative inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r from-[#e0f2eb] to-[#d0ede2] hover:from-[#c8ebe0] hover:to-[#b0ecdd] dark:from-emerald-950/80 dark:to-teal-950/80 text-[#032f28] dark:text-emerald-300 text-xs font-bold font-mono uppercase tracking-wider shrink-0 border border-[#b0ecdd] dark:border-emerald-800 shadow-xs hover:shadow-md transition-all duration-200 transform hover:scale-105 active:scale-95 cursor-pointer overflow-hidden"
                  >
                    {/* Animated Glow Sheen */}
                    <span className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/40 to-transparent pointer-events-none" />
                    
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600"></span>
                    </span>
                    
                    <span className="relative z-10">
                      {user.role === 'PHARMACIST' ? 'Pharmacist Portal' : 'Assistant Portal'}
                    </span>

                    <span className="material-symbols-outlined text-[13px] text-[#2e685d] dark:text-emerald-300 transition-transform group-hover:translate-x-0.5">
                      chevron_right
                    </span>
                  </button>
                  <span className="text-xs font-semibold text-[#2e685d] dark:text-emerald-400">
                    • {
                      nonPatientSubTab === 'profile'
                        ? 'Specialist Profile & Credentials'
                        : user.role === 'PHARMACIST'
                        ? (nonPatientSubTab === 'inventory' ? 'Inventory Management' : 'Reservation Queue')
                        : (nonPatientSubTab === 'active' ? 'Active Delivery Journey' : nonPatientSubTab === 'completed' ? 'Completed Dispatches' : 'Available Tasks')
                    }
                  </span>
                </div>
              </div>

              {/* Right utilities: Network status chip, Notifications, User info */}
              <div className="flex items-center gap-3">
                <div className="hidden lg:flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#e6f8f1] dark:bg-[#1a1d21] text-[11px] font-semibold text-[#032f28] dark:text-[#f8f9fa] border border-[#d5e6e0] dark:border-[#3d4349]">
                  <span className="w-2 h-2 rounded-full bg-[#2e685d] dark:bg-emerald-400 animate-pulse"></span>
                  <span>
                    {user.role === 'PHARMACIST'
                      ? 'Inventory Sync'
                      : (() => {
                          try {
                            const cached = localStorage.getItem('medifind_assistant_profile_cache');
                            if (cached) {
                              const p = JSON.parse(cached);
                              if (p.isAvailable === false) return 'Relay Paused';
                              if (p.assistantType) return 'Relay Active';
                              return 'Setup In Progress';
                            }
                          } catch (e) {}
                          return 'Relay Active';
                        })()}
                  </span>
                </div>

                <button
                  onClick={() => setNotifModalOpen(true)}
                  className="relative w-9 h-9 rounded-full bg-[#e6f8f1] dark:bg-[#1a1d21] hover:bg-[#b0ecdd] dark:hover:bg-[#30353a] text-[#032f28] dark:text-[#f8f9fa] flex items-center justify-center transition-colors shadow-xs"
                  title="View Notifications"
                >
                  <span className="material-symbols-outlined text-xl">notifications</span>
                  {unreadNotifsCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-[#ba1a1a] text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-xs">
                      {unreadNotifsCount > 9 ? '9+' : unreadNotifsCount}
                    </span>
                  )}
                </button>

                <div className="hidden sm:flex items-center gap-2 bg-[#f8fafc] dark:bg-[#1a1d21] p-1 pr-1.5 rounded-full border border-[#e0f2eb] dark:border-[#3d4349] transition-colors shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setNonPatientSubTab('profile')}
                    className="flex items-center gap-2 hover:opacity-85 transition-opacity cursor-pointer bg-transparent border-none p-0"
                    title="View & Edit Profile"
                  >
                    <div className="w-7 h-7 rounded-full bg-[#b0ecdd] dark:bg-emerald-900 text-[#032f28] dark:text-emerald-200 flex items-center justify-center text-xs font-bold uppercase">
                      {userDisplayName ? userDisplayName.charAt(0) : 'U'}
                    </div>
                    <div className="flex flex-col text-left leading-none">
                      <span className="text-xs font-bold text-[#032f28] dark:text-[#f8f9fa] truncate max-w-[130px]">
                        {userDisplayName}
                      </span>
                      <span className="text-[10px] font-semibold text-[#2e685d] dark:text-emerald-400 uppercase tracking-wider mt-0.5">
                        {user.role}
                      </span>
                    </div>
                  </button>
                  <button
                    id="non-patient-logout-btn"
                    onClick={() => setShowNonPatientLogoutConfirm(true)}
                    className="px-2.5 py-1 rounded-full hover:bg-error-container/40 text-on-surface-variant hover:text-error flex items-center gap-1 transition-colors ml-1 cursor-pointer border border-transparent hover:border-error/20 bg-transparent text-xs font-semibold"
                    title="Sign out of MediFind"
                  >
                    <span className="material-symbols-outlined text-base">logout</span>
                    <span className="hidden md:inline">Sign Out</span>
                  </button>
                </div>
              </div>
            </header>
          )}

          <main className="flex-1" data-barba="wrapper">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-2">
              <OfflineBanner />
            </div>

            <AnimatePresence mode="wait">
              <BarbaContainer key={nonPatientSubTab} pageKey={nonPatientSubTab}>
                <Suspense fallback={<PageLoaderFallback />}>
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
                </Suspense>
              </BarbaContainer>
            </AnimatePresence>
          </main>

          {/* Barba.js Signature Dual-Curtain Transition for Specialist Operations */}
          <BarbaCurtainOverlay activeKey={nonPatientSubTab} />

          {/* Real-Time Notifications Modal */}
          <NotificationModal
            isOpen={notifModalOpen}
            onClose={() => setNotifModalOpen(false)}
            notifications={notifications}
            onMarkAllRead={handleMarkAllRead}
            onClearAll={handleClearAll}
            onRemoveNotification={handleRemoveNotification}
            onNotificationClick={handleNotificationClick}
          />

          {/* 21st.dev Stacked Circular Footer for Specialist Operations */}
          <Footer
            onNavigate={(tab) => setNonPatientSubTab(tab)}
            role={user.role}
          />

          {/* Non-Patient Header Logout Confirmation Dialog */}
          <ConfirmationDialog
            isOpen={showNonPatientLogoutConfirm}
            title="Sign out of MediFind AI?"
            message="You will be logged out of your active session. Any saved reservations or operations data will remain securely preserved."
            confirmText="Yes, Sign Out"
            cancelText="Stay Signed In"
            isDestructive={false}
            onConfirm={() => {
              setShowNonPatientLogoutConfirm(false);
              if (logout) logout();
            }}
            onCancel={() => setShowNonPatientLogoutConfirm(false)}
          />
        </div>
      </div>
    );
  }

  // PATIENT ROLE: Top Navbar Layout
  return (
    <div
      className="min-h-screen flex flex-col bg-background text-on-surface"
    >
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={navigateToTab}
        onOpenNotifications={() => setNotifModalOpen(true)}
        unreadNotifsCount={unreadNotifsCount}
        medicineRequestCount={selectedMedicines.length}
      />

      {/* Main Content Area */}
      <main className="flex-1 pb-16" data-barba="wrapper">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
          <OfflineBanner />
        </div>

        <AnimatePresence mode="wait">
          <BarbaContainer key={activeTab} pageKey={activeTab}>
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
                  onClick={() => navigateToTab(ROLE_DEFAULT_TAB[user.role] || 'medicines')}
                  className="px-6 py-2.5 rounded-full bg-primary hover:bg-primary-container text-white font-bold text-sm shadow-sm transition-all"
                >
                  Return to Authorized Portal
                </button>
              </div>
            ) : (
              <Suspense fallback={<PageLoaderFallback />}>
                {activeTab === 'medicines' && (
                  <MedicineSearch
                    onOrderCreated={handleOrderCreated}
                    selectedMedicines={selectedMedicines}
                    onAddToRequest={addToMedicineRequest}
                    onUpdateRequestQuantity={updateRequestQuantity}
                    onRemoveFromRequest={removeFromMedicineRequest}
                    onClearRequest={clearMedicineRequest}
                    onProceedToPharmacies={() => navigateToTab('pharmacies')}
                    onNavigateToPrescription={() => navigateToTab('prescription')}
                    onNavigateToEmergency={() => navigateToTab('emergency')}
                    onNavigateToOrders={() => navigateToTab('orders')}
                    onNavigateToHealthcare={(subTab) => navigateToTab('healthcare', subTab || 'services')}
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
                        }, i.quantity, true);
                      });
                    }}
                    onProceedToPharmacies={(items, rxId) => {
                      if (Array.isArray(items) && items.length > 0) {
                        items.forEach(i => {
                          addToMedicineRequest({
                            id: i.medicineId,
                            brandName: i.brandName,
                            genericName: i.genericName,
                            dosageForm: i.dosageForm,
                            strength: i.strength,
                            price: i.price != null ? i.price : (i.unitPrice != null ? i.unitPrice : null)
                          }, i.quantity, true);
                        });
                      }
                      setActivePrescriptionId(rxId || null);
                      navigateToTab('pharmacies');
                    }}
                  />
                )}

                {activeTab === 'pharmacies' && (
                  <PharmacyDiscovery
                    onOrderCreated={handleOrderCreated}
                    selectedMedicines={selectedMedicines}
                    onClearSelectedMedicines={clearMedicineRequest}
                    onRemoveMedicine={removeFromMedicineRequest}
                    onUpdateQuantity={updateRequestQuantity}
                    prescriptionId={activePrescriptionId}
                  />
                )}

                {activeTab === 'emergency' && (
                  <EmergencyLocator onOrderCreated={handleOrderCreated} />
                )}

                {activeTab === 'orders' && (
                  <OrderTracking
                    initialOrderId={selectedOrderIdForTracking}
                    initialCheckoutOrderId={initialCheckoutOrderId}
                    onClearInitialOrderId={() => {
                      setSelectedOrderIdForTracking(null);
                      setInitialCheckoutOrderId(null);
                    }}
                    onNavigate={(tab) => navigateToTab(tab)}
                  />
                )}

                {activeTab === 'healthcare' && (
                  <HealthcareMarketplace
                    initialSubTab={healthcareSubTab}
                    onNavigate={(tab) => navigateToTab(tab)}
                    onSubTabChange={(subTab) => {
                      setHealthcareSubTab(subTab);
                      let path = '/healthcare';
                      if (subTab === 'clinical-assistance') path = '/clinical-assistance';
                      else if (subTab === 'my-appointments') path = '/appointments';
                      else if (subTab === 'professionals') path = '/professionals';
                      if (window.location.pathname !== path) {
                        window.history.pushState({ tab: 'healthcare', subTab }, '', path);
                      }
                    }}
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
                  <UserProfile role="PATIENT" onNavigate={(tab) => navigateToTab(tab)} />
                )}
              </Suspense>
            )}
          </BarbaContainer>
        </AnimatePresence>
      </main>

      {/* Barba.js Signature Dual-Curtain Transition for Patient Navigation */}
      <BarbaCurtainOverlay activeKey={activeTab} />

      {/* Real-Time Notifications Modal */}
      <NotificationModal
        isOpen={notifModalOpen}
        onClose={() => setNotifModalOpen(false)}
        notifications={notifications}
        onMarkAllRead={handleMarkAllRead}
        onClearAll={handleClearAll}
        onRemoveNotification={handleRemoveNotification}
        onNotificationClick={handleNotificationClick}
      />

      {/* In-App Alerts & Mobile Push / Web Corner Toast */}
      <ToastAlert />

      {/* Medi AI Assistant — floating robot helper exclusively for patients */}
      {(!user || user.role === 'PATIENT') && (
        <MediAssistant
          onNavigate={(tab) => setActiveTab(tab)}
          userRole={user?.role}
          selectedMedicines={selectedMedicines}
          onAddToRequest={addToMedicineRequest}
          onProceedToPharmacies={() => setActiveTab('pharmacies')}
        />
      )}

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

