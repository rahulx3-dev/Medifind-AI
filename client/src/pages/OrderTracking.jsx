import React, { useState, useEffect, useCallback, useRef } from 'react';
import CheckoutPage from '../components/CheckoutPage';
import FlowButton from '../components/FlowButton';
import ConfirmationDialog from '../components/ConfirmationDialog';
import RadialOrbitalTimeline from '../components/RadialOrbitalTimeline';
import { SkeletonMap } from '../components/LoadingSkeleton';
import ErrorState from '../components/ErrorState';
import { broadcastUpdate, useRealtimeRefresh, subscribeToUpdates } from '../utils/realtimeUpdates';
import PatientClarificationCard from '../components/PatientClarificationCard';
import AnimatedStatCard from '../components/ui/AnimatedStatCard';
import RollingNumber from '../components/ui/RollingNumber';
import { useAuth } from '../context/AuthContext';
import { usePortalGreeting } from '../utils/greetingUtils';
const FulfillmentMapBox = React.lazy(() => import('../components/FulfillmentMapBox'));

const STATUS_CONFIG = {
  PENDING: { label: 'Awaiting Review', icon: 'schedule', bg: '#ffdad4', color: '#5a0100', border: '#ffb4a8' },
  CONFIRMED: { label: 'Confirmed', icon: 'verified', bg: '#b0ecdd', color: '#336c61', border: '#97d2c4' },
  READY_FOR_PICKUP: { label: 'Ready for Pickup', icon: 'storefront', bg: '#b0ecdd', color: '#336c61', border: '#2e685d' },
  COMPLETED: { label: 'Completed', icon: 'check_circle', bg: '#e0f2eb', color: '#032f28', border: '#a6cfc5' },
  CANCELLED: { label: 'Cancelled', icon: 'cancel', bg: '#ffdad6', color: '#93000a', border: '#ffb4a8' },
  REJECTED: { label: 'Rejected', icon: 'block', bg: '#ffdad6', color: '#93000a', border: '#ffb4a8' }
};

const PAYMENT_CONFIG = {
  PAID: { label: 'Paid', icon: 'check_circle', bg: '#b0ecdd', color: '#336c61' },
  FAILED: { label: 'Payment Failed', icon: 'error', bg: '#ffdad6', color: '#93000a' },
  REFUNDED: { label: 'Refunded', icon: 'currency_rupee', bg: '#e0f2eb', color: '#2e685d' },
  PENDING: { label: 'Payment Pending', icon: 'pending', bg: '#e0f2eb', color: '#414846' }
};

const ASSISTANT_SERVICE_CONFIG = {
  MEDICINE_COLLECTION: { label: 'Medicine Collection', icon: 'medication' },
  PHARMACY_VISIT: { label: 'Pharmacy Visit', icon: 'store' },
  PHARMACY_COMPANION: { label: 'Pharmacy Companion', icon: 'group' },
  MEDICINE_DELIVERY: { label: 'Medicine Delivery', icon: 'home_pin' },
  DIGITAL_ASSISTANCE: { label: 'Digital Assistance', icon: 'devices' },
  PHARMACY_COMMS: { label: 'Pharmacy Communication', icon: 'forum' },
  RESTOCK_ASSISTANCE: { label: 'Restock Assistance', icon: 'inventory' },
  PRESCRIPTION_ASSISTANCE: { label: 'Prescription Assistance', icon: 'upload_file' }
};

function getAssistantServiceLabel(type) {
  if (!type) return 'Medicine Access Assistant';
  return ASSISTANT_SERVICE_CONFIG[type]?.label || type.replace(/_/g, ' ');
}

function getItemUnitPrice(it) {
  if (it && typeof it.unitPrice === 'number' && it.unitPrice > 0) {
    return it.unitPrice;
  }
  return null;
}

function calculateOrderPricing(ord) {
  if (!ord) return { medicineSubtotal: null, deliveryFee: 0, platformFee: 0, totalAmount: 0 };
  const items = ord.items || [];
  const hasPricedItems = items.some(it => getItemUnitPrice(it) !== null);

  let calculatedMedSubtotal = null;
  if (hasPricedItems) {
    calculatedMedSubtotal = items.reduce((sum, it) => {
      const p = getItemUnitPrice(it) || 0;
      return sum + (p * (Number(it.quantity) || 1));
    }, 0);
  }

  const medSubtotal = calculatedMedSubtotal;
  const medicineSubtotal = (ord.medicineSubtotal != null && Number(ord.medicineSubtotal) > 0)
    ? Number(ord.medicineSubtotal)
    : medSubtotal;

  const deliveryFee = Number(ord.deliveryFee) || 0;
  const platformFee = Number(ord.platformFee) || 0;
  const totalAmount = (ord.totalAmount != null && Number(ord.totalAmount) > 0)
    ? Number(ord.totalAmount)
    : ((medicineSubtotal || 0) + deliveryFee + platformFee);

  return { medicineSubtotal, deliveryFee, platformFee, totalAmount };
}

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.PENDING;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.3rem',
      background: cfg.bg,
      color: cfg.color,
      fontSize: 11,
      fontWeight: 700,
      padding: '3px 10px',
      borderRadius: 99
    }}>
      <span className="material-symbols-outlined" style={{ fontSize: 13 }}>{cfg.icon}</span>
      {cfg.label}
    </span>
  );
}

function PaymentBadge({ payment }) {
  if (!payment) return <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: '#e0f2eb', color: '#717976', fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99 }}>Payment Uninitiated</span>;
  if (payment.method === 'COUNTER' || payment.method === 'PAY_AT_COUNTER') {
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3rem',
        background: '#e0f2eb',
        color: '#2e685d',
        fontSize: 11,
        fontWeight: 700,
        padding: '3px 10px',
        borderRadius: 99
      }}>
        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>storefront</span>
        Pay at Counter
      </span>
    );
  }
  const cfg = PAYMENT_CONFIG[payment.status] || PAYMENT_CONFIG.PENDING;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.3rem',
      background: cfg.bg,
      color: cfg.color,
      fontSize: 11,
      fontWeight: 700,
      padding: '3px 10px',
      borderRadius: 99
    }}>
      <span className="material-symbols-outlined" style={{ fontSize: 13 }}>{cfg.icon}</span>
      {cfg.label}
    </span>
  );
}

export default function OrderTracking({ initialOrderId = null, initialCheckoutOrderId = null, onClearInitialOrderId = () => {}, onNavigate }) {
  const { user } = useAuth();
  const { firstName: patientFirstName, timeGreet: patientTimeGreet, icon: patientGreetIcon } = usePortalGreeting(user, 'PATIENT');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedOrderId, setSelectedOrderId] = useState(initialOrderId || initialCheckoutOrderId);
  const [selectedOrderDetails, setSelectedOrderDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [checkoutOrderId, setCheckoutOrderId] = useState(initialCheckoutOrderId || null);
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [cancellingOrderId, setCancellingOrderId] = useState(null);
  const [actionFeedback, setActionFeedback] = useState(null);
  const [confirmingReceipt, setConfirmingReceipt] = useState(false);

  // Synchronous tracking refs to eliminate stale closure resurrecting detail view on background refresh
  const selectedOrderIdRef = useRef(selectedOrderId);
  const initialOrderIdConsumedRef = useRef(Boolean(selectedOrderId));

  useEffect(() => {
    selectedOrderIdRef.current = selectedOrderId;
  }, [selectedOrderId]);

  const handleOpenCheckout = (orderId) => {
    setCheckoutOrderId(orderId);
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', `/checkout/${orderId}`);
    }
  };

  const handleCloseCheckout = () => {
    const closedOrderId = checkoutOrderId;
    setCheckoutOrderId(null);
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/checkout/')) {
      window.history.pushState(null, '', '/');
    }
    fetchOrders(closedOrderId);
    if (closedOrderId) {
      fetchOrderDetails(closedOrderId);
    }
    broadcastUpdate('CHECKOUT_CLOSED', { orderId: closedOrderId });
  };

  const handlePaymentSuccess = () => {
    const paidOrderId = checkoutOrderId;
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/checkout/')) {
      window.history.pushState(null, '', '/');
    }
    fetchOrders(paidOrderId);
    if (paidOrderId) {
      fetchOrderDetails(paidOrderId);
    }
    broadcastUpdate('PAYMENT_COMPLETED', { orderId: paidOrderId });
  };

  const fetchOrderDetails = useCallback(async (orderId, isBackground = false) => {
    if (!orderId) return;
    if (!isBackground) setLoadingDetails(true);
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.order) {
        setSelectedOrderDetails(data.order);
      }
    } catch (err) {
      if (!isBackground) console.error('Failed to load order details:', err);
    } finally {
      if (!isBackground) setLoadingDetails(false);
    }
  }, []);

  const fetchOrders = useCallback(async (targetSelectId = null, isBackground = false) => {
    if (!isBackground) {
      setLoading(true);
      setError(null);
    }
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch('/api/orders', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        const orderList = data.orders || [];
        setOrders(orderList);

        // Explicit '__clear__' sentinel: list refresh with no active selection
        if (targetSelectId === '__clear__') return;

        // Determine selection without resurrecting back-navigated orders
        let selId = targetSelectId;
        if (!selId && selectedOrderIdRef.current) {
          selId = selectedOrderIdRef.current;
        } else if (!selId && !initialOrderIdConsumedRef.current && initialOrderId) {
          selId = initialOrderId;
          initialOrderIdConsumedRef.current = true;
        }

        // Only select and fetch details if the user hasn't explicitly navigated back to the list
        if (selId && selectedOrderIdRef.current !== null) {
          const found = orderList.find(o => o.id === selId);
          if (found) {
            setSelectedOrderId(found.id);
            selectedOrderIdRef.current = found.id;
            fetchOrderDetails(found.id, isBackground);
          }
        }
      } else {
        if (!isBackground) setError(data.error || 'Failed to load orders.');
      }
    } catch (err) {
      if (!isBackground) setError('Network communication error. Unable to retrieve orders.');
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, [initialOrderId, fetchOrderDetails]);

  useEffect(() => {
    fetchOrders(initialOrderId);
  }, [initialOrderId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to instant order status change events for immediate optimistic UI reaction
  useEffect(() => {
    const unsub = subscribeToUpdates((event) => {
      if (['ORDER_STATUS_UPDATED', 'PAYMENT_COMPLETED', 'FULFILLMENT_SELECTED', 'ORDER_CREATED', 'ASSISTANT_TASK_ACCEPTED', 'ASSISTANT_TASK_PROGRESSED'].includes(event?.type)) {
        const { orderId, newStatus } = event.payload || {};
        if (orderId && newStatus) {
          setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
          setSelectedOrderDetails(prev => {
            if (prev && prev.id === orderId) {
              return { ...prev, status: newStatus };
            }
            return prev;
          });
        }
        if (selectedOrderIdRef.current) {
          fetchOrderDetails(selectedOrderIdRef.current, true);
        }
        fetchOrders(null, true);
      }
    });
    return unsub;
  }, []);

  // Real-time automatic background refresh (heartbeat + event triggers)
  useRealtimeRefresh({
    onRefresh: () => {
      fetchOrders(null, true);
      if (selectedOrderIdRef.current) {
        fetchOrderDetails(selectedOrderIdRef.current, true);
      }
    },
    interval: 10000
  });

  useEffect(() => {
    if (!actionFeedback) return;
    const timer = setTimeout(() => setActionFeedback(null), 4000);
    return () => clearTimeout(timer);
  }, [actionFeedback]);

  const handleOpenTracking = (order) => {
    selectedOrderIdRef.current = order.id;
    initialOrderIdConsumedRef.current = true;
    setSelectedOrderId(order.id);
    setSelectedOrderDetails(order);
    fetchOrderDetails(order.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBackToList = () => {
    selectedOrderIdRef.current = null;
    initialOrderIdConsumedRef.current = true;
    setSelectedOrderId(null);
    setSelectedOrderDetails(null);
    onClearInitialOrderId?.();
    fetchOrders('__clear__');
  };

  const handleConfirmCancelOrder = async (orderId) => {
    setActionFeedback(null);
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: 'CANCELLED', comment: 'Cancelled by patient' })
      });
      const data = await res.json();
      if (data.success) {
        setActionFeedback({ type: 'success', message: 'Order reservation cancelled successfully. Allocated inventory hold released.' });
        setTimeout(() => setActionFeedback(null), 5000);
        setCancellingOrderId(null);
        fetchOrders(orderId);
        fetchOrderDetails(orderId);
        broadcastUpdate('ORDER_CANCELLED', { orderId });
      } else {
        setActionFeedback({ type: 'error', message: data.error || 'Failed to cancel order.' });
        setTimeout(() => setActionFeedback(null), 6000);
      }
    } catch (err) {
      setActionFeedback({ type: 'error', message: 'Network error cancelling order.' });
      setTimeout(() => setActionFeedback(null), 6000);
    }
  };

  const handleConfirmReceipt = async (orderId) => {
    if (!orderId) return;
    setConfirmingReceipt(true);
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch(`/api/orders/${orderId}/confirm-receipt`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.success) {
        setActionFeedback({ type: 'success', message: 'Receipt confirmed successfully! Service completed.' });
        fetchOrders(orderId);
        fetchOrderDetails(orderId);
        broadcastUpdate('ORDER_COMPLETED', { orderId });
      } else {
        setActionFeedback({ type: 'error', message: data.error || 'Failed to confirm receipt.' });
      }
    } catch (err) {
      setActionFeedback({ type: 'error', message: 'Network error confirming receipt.' });
    } finally {
      setConfirmingReceipt(false);
    }
  };

  const [submittingFollowUp, setSubmittingFollowUp] = useState(false);

  const handleSubmitFollowUp = async (orderId, followUpState) => {
    if (!orderId || !followUpState) return;
    setSubmittingFollowUp(true);
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch(`/api/orders/${orderId}/follow-up`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ followUpState })
      });
      const data = await res.json();
      if (data.success) {
        setActionFeedback({ type: 'success', message: `Follow-up status recorded: ${followUpState.replace(/_/g, ' ')}` });
        fetchOrders(orderId, true);
        fetchOrderDetails(orderId, false);
      } else {
        setActionFeedback({ type: 'error', message: data.error || 'Failed to record follow-up status.' });
      }
    } catch (err) {
      setActionFeedback({ type: 'error', message: 'Network error submitting follow-up status.' });
    } finally {
      setSubmittingFollowUp(false);
    }
  };

  // Metrics counts for Stitch metric summary cards
  const activeOrdersCount = orders.filter(o => ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'].includes(o.status)).length;
  const pendingCount = orders.filter(o => o.status === 'PENDING').length;
  const readyCount = orders.filter(o => o.status === 'READY_FOR_PICKUP').length;
  const completedCount = orders.filter(o => o.status === 'COMPLETED').length;
  const cancelledCount = orders.filter(o => o.status === 'CANCELLED').length;
  const rejectedCount = orders.filter(o => o.status === 'REJECTED').length;

  // Filtered orders list
  const filteredOrders = orders.filter(ord => {
    if (activeFilter === 'ACTIVE' && !['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'].includes(ord.status)) return false;
    if (activeFilter === 'COMPLETED' && ord.status !== 'COMPLETED') return false;
    if (activeFilter === 'CANCELLED' && ord.status !== 'CANCELLED') return false;
    if (activeFilter === 'REJECTED' && ord.status !== 'REJECTED') return false;

    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const matchNum = (ord.orderNumber || ord.id || '').toLowerCase().includes(q);
    const matchPhar = (ord.pharmacy?.name || '').toLowerCase().includes(q);
    const matchMeds = (ord.items || []).some(i => (i.medicine?.brandName || i.medicine?.name || '').toLowerCase().includes(q));
    return matchNum || matchPhar || matchMeds;
  });

  const detailOrder = selectedOrderDetails || (selectedOrderId ? orders.find(o => o.id === selectedOrderId) : null);

  // ─────────────────────────────────────────────────────────────
  // VIEW 1: STITCH SCREEN f93a243ff9114238bcdca6e5ef837fc7 (ORDER TRACKING / FULFILLMENT JOURNEY)
  // ─────────────────────────────────────────────────────────────
  if (detailOrder) {
    const isReady = detailOrder.status === 'READY_FOR_PICKUP';
    const isCompleted = detailOrder.status === 'COMPLETED';
    const isConfirmed = detailOrder.status === 'CONFIRMED';
    const isPending = detailOrder.status === 'PENDING';
    const isCancelled = detailOrder.status === 'CANCELLED';
    const isRejected = detailOrder.status === 'REJECTED';
    const isTerminal = isCancelled || isRejected;
    const isPaid = detailOrder.payment?.status === 'PAID';
    const isCounterPay = detailOrder.payment?.method === 'COUNTER' || detailOrder.payment?.method === 'PAY_AT_COUNTER';
    const isCheckoutComplete = Boolean(detailOrder.fulfillmentType) && (isPaid || isCounterPay);

    const isAssistantDelivery = detailOrder.fulfillmentType === 'ASSISTANT_DELIVERY' || detailOrder.fulfillmentType === 'DELIVERY' || Boolean(detailOrder.assistantTask);
    const assistantTask = detailOrder.assistantTask;
    const assistantStatus = assistantTask?.status;
    const assistantName = assistantTask?.assistant?.name || 'Delivery Partner';

    // Separate security codes: Delivery OTP for delivery orders, Pickup PIN for counter pickup
    const activeCode = isAssistantDelivery ? detailOrder.deliveryOtp : detailOrder.verificationPin;
    const pinStr = (!isTerminal && activeCode) ? activeCode : '';
    const pinDigits = pinStr ? pinStr.padEnd(4, '0').slice(0, 4).split('') : ['—', '—', '—', '—'];

    let heroBadge = isCancelled ? 'Reservation Cancelled' : isRejected ? 'Reservation Rejected' : isReady ? 'Action Required by You' : isPending ? 'Review In Progress' : 'Live Clinical Status';
    let heroTitle = isCancelled ? 'Reservation Cancelled' : isRejected ? 'Reservation Rejected' : isReady ? 'Ready for Pickup' : isPending ? 'Awaiting Pharmacy Confirmation' : (isConfirmed && !isPaid && !isCounterPay) ? 'Reservation Approved: Choose Mode & Pay' : isCompleted ? 'Dispensation Completed' : 'Medicines Staged & Packing';
    let heroDesc = isCancelled
      ? 'This order reservation has been cancelled. No medicines are reserved or staged for pickup.'
      : isRejected
      ? 'This reservation request could not be fulfilled by the dispensary and has been marked rejected.'
      : isReady
      ? 'Your prescription medicines have been verified, packaged, and quarantined at the dispensary counter. You can collect your order now.'
      : isPending
      ? 'The licensed pharmacist is reviewing your prescription and confirming stock allocation.'
      : (isConfirmed && !isPaid && !isCounterPay)
      ? 'The pharmacy has verified and earmarked your medicines! Please select your fulfillment mode (Counter Pickup or Assistant Delivery) and payment method to proceed.'
      : isCompleted
      ? 'Medicines have been handed over and authenticated via secure PIN verification.'
      : 'Your order is confirmed and currently being batch packaged in a temperature-controlled dispensary bay.';

    if (isAssistantDelivery && isCheckoutComplete && !isTerminal) {
      if (isCompleted || assistantStatus === 'CONFIRMED') {
        heroBadge = 'Delivery Completed • Verified';
        heroTitle = 'Order Delivered & Verified';
        heroDesc = 'Your medicines have been safely delivered to your doorstep and confirmed via 4-digit PIN authentication.';
      } else if (assistantStatus === 'DELIVERED') {
        heroBadge = 'Partner at Doorstep • PIN Verification';
        heroTitle = 'Partner Arrived at Your Doorstep';
        heroDesc = `Your delivery partner (${assistantName}) has arrived at your address. Please provide your 4-digit Handover PIN to receive your medication package.`;
      } else if (assistantStatus === 'IN_TRANSIT') {
        heroBadge = 'Medicines Collected • Out for Delivery';
        heroTitle = 'Medicines Collected • Out for Delivery';
        heroDesc = `Your delivery partner (${assistantName}) collected your verified medicines from ${detailOrder.pharmacy?.name || 'the pharmacy'} and is currently on the way to your doorstep.`;
      } else if (assistantStatus === 'COLLECTING') {
        heroBadge = 'At Dispensary • Collecting Package';
        heroTitle = 'Collecting Medicines at Pharmacy';
        heroDesc = `Your delivery partner (${assistantName}) is at ${detailOrder.pharmacy?.name || 'the dispensary counter'} inspecting and securing your temperature-controlled medication package.`;
      } else if (assistantStatus === 'ACCEPTED') {
        heroBadge = 'Task Accepted • On the Way to Pharmacy';
        heroTitle = 'Partner Heading to Pharmacy';
        heroDesc = `Your delivery partner (${assistantName}) has accepted the dispatch request and is heading to the dispensary to pick up your order.`;
      } else if (assistantStatus === 'ASSIGNED' || !assistantStatus) {
        heroBadge = 'Delivery Partner Assigned';
        heroTitle = 'Delivery Partner Assigned';
        heroDesc = `Your order has been assigned to ${assistantName}. Awaiting partner acceptance to start collection.`;
      }
    }

    // Journey Steps: 1: Confirmation, 2: Checkout / Payment, 3: Preparing, 4: Ready, 5: Completed
    let currentStepIndex = 1;
    if (isPending) currentStepIndex = 1;
    else if (isConfirmed && !isCheckoutComplete) currentStepIndex = 2;
    else if (isConfirmed && isCheckoutComplete) currentStepIndex = 3;
    else if (isReady) currentStepIndex = 4;
    else if (isCompleted) currentStepIndex = 5;
    else if (isTerminal) currentStepIndex = 0;

    return (
      <div style={{ background: '#ecfdf7', minHeight: '100vh', fontFamily: "'Plus Jakarta Sans', sans-serif", paddingBottom: '4rem' }}>
        <div className="w-full max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-6">

          {/* Top Metadata Breadcrumb & Context Header */}
          <div className="pt-1 pb-3 sm:py-4 flex items-start sm:items-end justify-between flex-wrap gap-2.5 sm:gap-4">
            <div className="flex flex-col gap-1.5 sm:gap-2">
              <button
                onClick={handleBackToList}
                className="inline-flex items-center gap-1.5 text-secondary hover:text-primary font-bold text-xs sm:text-sm cursor-pointer p-0 bg-transparent border-none transition-colors"
              >
                <span className="material-symbols-outlined text-base sm:text-lg">arrow_back</span>
                <span>Back to My Orders</span>
              </button>

              <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                <h1 className="text-xl sm:text-3xl font-extrabold text-[#032f28] tracking-tight m-0">
                  Order Tracking &amp; Fulfillment Journey
                </h1>
                <div className="inline-flex items-center gap-1.5 bg-[#b0ecdd] text-[#336c61] px-2.5 py-1 rounded-full text-xs font-bold">
                  <span className="w-2 h-2 rounded-full bg-[#2e685d]"></span>
                  <span>#{detailOrder.orderNumber || detailOrder.id?.slice(0, 10).toUpperCase()}</span>
                  <span>•</span>
                  <span>{detailOrder.pharmacy?.name || 'Participating Dispensary'}</span>
                </div>
              </div>
            </div>

            {/* Quick Micro-Badges */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#ffffff', padding: '0.4rem 0.85rem', borderRadius: 99, boxShadow: '0 1px 3px rgba(0,0,0,0.05)', fontSize: 12, color: '#032f28', fontWeight: 600 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>check_circle</span>
                <span>Status: {detailOrder.status.replace(/_/g, ' ')}</span>
              </div>
              {detailOrder.fulfillmentType === 'ASSISTANT_DELIVERY' ? (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#e0f2eb', padding: '0.4rem 0.85rem', borderRadius: 99, fontSize: 12, color: '#032f28', fontWeight: 700 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>support_agent</span>
                  <span>Fulfillment: Medicine Access Assistant</span>
                  {(detailOrder.assistantServiceType || detailOrder.assistantTask?.serviceType) && (
                    <>
                      <span style={{ color: '#717976' }}>•</span>
                      <span style={{ color: '#1e453e' }}>Service: {getAssistantServiceLabel(detailOrder.assistantServiceType || detailOrder.assistantTask?.serviceType)}</span>
                    </>
                  )}
                </div>
              ) : detailOrder.fulfillmentType === 'DELIVERY' ? (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#e0f2eb', padding: '0.4rem 0.85rem', borderRadius: 99, fontSize: 12, color: '#032f28', fontWeight: 700 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>local_shipping</span>
                  <span>Fulfillment: Pharmacy Delivery</span>
                </div>
              ) : (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#e0f2eb', padding: '0.4rem 0.85rem', borderRadius: 99, fontSize: 12, color: '#032f28', fontWeight: 700 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>storefront</span>
                  <span>Fulfillment: Counter Pickup</span>
                </div>
              )}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#e0f2eb', padding: '0.4rem 0.85rem', borderRadius: 99, fontSize: 11, color: '#414846' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 15, color: '#2e685d' }}>thermostat</span>
                <span>Cold Chain Preserved (4°C)</span>
              </div>
            </div>
          </div>

          {/* Gate 5 Immediate Urgent Care Guidance Banner */}
          {detailOrder.orderType === 'EMERGENCY' && (
            <div style={{
              background: '#fff8f6',
              border: '2px solid #ba1a1a',
              borderRadius: 20,
              padding: '1.25rem 1.5rem',
              marginBottom: '1.25rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '1rem',
              boxShadow: '0 4px 16px rgba(186,26,26,0.1)'
            }}>
              <div style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: '#ffdad6',
                color: '#93000a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: 26 }}>e911_emergency</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: '#93000a', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Immediate Emergency Clinical Guidance
                  </span>
                  <span style={{ background: '#ba1a1a', color: '#ffffff', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 99 }}>
                    CRITICAL
                  </span>
                </div>
                <p style={{ fontSize: 13, color: '#410002', margin: '0.35rem 0 0.5rem 0', lineHeight: 1.5 }}>
                  This order involves critical/emergency medication. <strong>Do not wait for dispensary response or pickup if symptoms are worsening.</strong> If experiencing chest pain, acute breathlessness, sudden numbness, or anaphylaxis, immediately contact national ambulance services (<strong>108 / 112</strong>) or visit the nearest trauma emergency center.
                </p>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: 12, fontWeight: 700, color: '#ba1a1a' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>call</span>
                  <span>Ambulance Direct: 108 • National Emergency: 112</span>
                </div>
              </div>
            </div>
          )}

          {/* Gate 5 Pharmacy Responsiveness & Patient Status Bar */}
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            background: '#ffffff',
            borderRadius: 16,
            padding: '0.85rem 1.25rem',
            marginBottom: '1.25rem',
            border: '1px solid #c0c8c5',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#414846' }}>Status Line:</span>

              {/* Pharmacy Responsiveness */}
              {detailOrder.pharmacyResponseStatus === 'PHARMACY_UNRESPONSIVE' ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#ffdad6', color: '#93000a', padding: '0.25rem 0.75rem', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>timer_off</span>
                  Dispensary Unresponsive (&gt;15 mins)
                </span>
              ) : detailOrder.pharmacyResponseStatus === 'AWAITING_PHARMACY_RESPONSE' ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#e0f2eb', color: '#2e685d', padding: '0.25rem 0.75rem', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>hourglass_top</span>
                  Awaiting Dispensary Confirmation
                </span>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#e0f2eb', color: '#032f28', padding: '0.25rem 0.75rem', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>store</span>
                  Dispensary Responded
                </span>
              )}

              {/* Patient Purchase Status */}
              {detailOrder.patientPurchaseStatus === 'AWAITING_PATIENT_PURCHASE' ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#fff3d6', color: '#7a4f00', padding: '0.25rem 0.75rem', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>shopping_cart_checkout</span>
                  Awaiting Patient Purchase
                </span>
              ) : detailOrder.patientPurchaseStatus === 'PURCHASED' ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#b0ecdd', color: '#336c61', padding: '0.25rem 0.75rem', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>check_circle</span>
                  Purchased
                </span>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#f0f4f2', color: '#717976', padding: '0.25rem 0.75rem', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>cancel</span>
                  Not Purchased
                </span>
              )}

              {/* Follow-up State Tag */}
              {detailOrder.followUpState && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#d7e3ff', color: '#003366', padding: '0.25rem 0.75rem', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>feedback</span>
                  Follow-up: {detailOrder.followUpState.replace(/_/g, ' ')}
                </span>
              )}
            </div>

            {/* Resume Prescription Workflow link if order is linked to a prescription */}
            {detailOrder.prescriptionId && (
              <a
                href={`/prescriptions/upload?id=${detailOrder.prescriptionId}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  color: '#2e685d',
                  fontSize: 12,
                  fontWeight: 700,
                  textDecoration: 'none'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>receipt_long</span>
                <span>View / Resume Prescription Slip &rarr;</span>
              </a>
            )}
          </div>

          {/* Gate 5 Patient Follow-Up Feedback Card */}
          {(isTerminal || isPending || detailOrder.pharmacyResponseStatus === 'PHARMACY_UNRESPONSIVE' || detailOrder.followUpState) && (
            <div style={{
              background: '#ffffff',
              borderRadius: 20,
              padding: '1.25rem 1.5rem',
              marginBottom: '1.25rem',
              border: '1px solid #c0c8c5',
              boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#2e685d' }}>rate_review</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#032f28' }}>
                    Patient Follow-Up &amp; Procurement Status
                  </span>
                </div>
                {detailOrder.followUpState && (
                  <span style={{ background: '#b0ecdd', color: '#336c61', padding: '0.2rem 0.65rem', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>
                    Recorded: {detailOrder.followUpState.replace(/_/g, ' ')}
                  </span>
                )}
              </div>

              <p style={{ fontSize: 12, color: '#414846', margin: 0 }}>
                {detailOrder.pharmacyResponseStatus === 'PHARMACY_UNRESPONSIVE'
                  ? 'The dispensary has not responded within 15 minutes. Help us assist you by letting us know your status:'
                  : isCancelled
                  ? 'Your reservation was cancelled. Please let us know if you obtained these medicines elsewhere:'
                  : isRejected
                  ? 'The pharmacy could not fulfill this request. How would you like to proceed?'
                  : 'Please keep your procurement status updated to help coordinate care:'}
              </p>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', paddingTop: '0.25rem' }}>
                <button
                  onClick={() => handleSubmitFollowUp(detailOrder.id, 'PURCHASED_HERE')}
                  disabled={submittingFollowUp || detailOrder.followUpState === 'PURCHASED_HERE'}
                  style={{
                    padding: '0.45rem 0.85rem',
                    borderRadius: 99,
                    border: '1px solid #2e685d',
                    background: detailOrder.followUpState === 'PURCHASED_HERE' ? '#2e685d' : '#e0f2eb',
                    color: detailOrder.followUpState === 'PURCHASED_HERE' ? '#ffffff' : '#032f28',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: detailOrder.followUpState === 'PURCHASED_HERE' ? 'default' : 'pointer',
                    opacity: submittingFollowUp ? 0.6 : 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 15 }}>storefront</span>
                  <span>Purchased Here</span>
                </button>

                <button
                  onClick={() => handleSubmitFollowUp(detailOrder.id, 'PURCHASED_ELSEWHERE')}
                  disabled={submittingFollowUp || detailOrder.followUpState === 'PURCHASED_ELSEWHERE'}
                  style={{
                    padding: '0.45rem 0.85rem',
                    borderRadius: 99,
                    border: '1px solid #c0c8c5',
                    background: detailOrder.followUpState === 'PURCHASED_ELSEWHERE' ? '#032f28' : '#ffffff',
                    color: detailOrder.followUpState === 'PURCHASED_ELSEWHERE' ? '#ffffff' : '#414846',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: detailOrder.followUpState === 'PURCHASED_ELSEWHERE' ? 'default' : 'pointer',
                    opacity: submittingFollowUp ? 0.6 : 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 15 }}>local_pharmacy</span>
                  <span>Purchased Elsewhere</span>
                </button>

                <button
                  onClick={() => handleSubmitFollowUp(detailOrder.id, 'NOT_PURCHASED')}
                  disabled={submittingFollowUp || detailOrder.followUpState === 'NOT_PURCHASED'}
                  style={{
                    padding: '0.45rem 0.85rem',
                    borderRadius: 99,
                    border: '1px solid #ffdad6',
                    background: detailOrder.followUpState === 'NOT_PURCHASED' ? '#ba1a1a' : '#fff8f6',
                    color: detailOrder.followUpState === 'NOT_PURCHASED' ? '#ffffff' : '#93000a',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: detailOrder.followUpState === 'NOT_PURCHASED' ? 'default' : 'pointer',
                    opacity: submittingFollowUp ? 0.6 : 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 15 }}>close</span>
                  <span>Did Not Purchase</span>
                </button>

                <button
                  onClick={() => handleSubmitFollowUp(detailOrder.id, 'NEEDS_MORE_HELP')}
                  disabled={submittingFollowUp || detailOrder.followUpState === 'NEEDS_MORE_HELP'}
                  style={{
                    padding: '0.45rem 0.85rem',
                    borderRadius: 99,
                    border: '1px solid #ffd8e4',
                    background: detailOrder.followUpState === 'NEEDS_MORE_HELP' ? '#b01050' : '#fff0f5',
                    color: detailOrder.followUpState === 'NEEDS_MORE_HELP' ? '#ffffff' : '#b01050',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: detailOrder.followUpState === 'NEEDS_MORE_HELP' ? 'default' : 'pointer',
                    opacity: submittingFollowUp ? 0.6 : 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 15 }}>medical_services</span>
                  <span>Needs Clinical Help</span>
                </button>
              </div>
            </div>
          )}

          {/* Prescription Clarification Alert / Action Card */}
          <PatientClarificationCard
            orderId={detailOrder.id}
            pharmacyName={detailOrder.pharmacy?.name}
            onClarificationSubmitted={() => fetchOrderDetails(detailOrder.id, true)}
          />

          {/* PRIMARY ACTION SYSTEM: Prominent Unambiguous Next Action Hero (Stitch Screen f93a243ff9114238bcdca6e5ef837fc7) */}
          <section
            className="p-5 sm:p-8 rounded-3xl mb-8 relative overflow-hidden text-white"
            style={{
              background: 'linear-gradient(135deg, #032f28 0%, #1e453e 50%, #173731 100%)',
              boxShadow: '0 12px 36px rgba(3,47,40,0.18)'
            }}
          >
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-center">

              {/* Action Context (7 cols on desktop, full width on mobile) */}
              <div className="lg:col-span-7 flex flex-col gap-3">
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  background: '#c1ebe1',
                  color: '#00201b',
                  padding: '0.25rem 0.75rem',
                  borderRadius: 99,
                  fontSize: 11,
                  fontWeight: 700,
                  width: 'fit-content'
                }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: isTerminal ? '#ffb4a8' : '#2e685d' }}></span>
                  <span>{heroBadge}</span>
                </div>

                <h2 style={{ fontSize: 32, fontWeight: 800, color: '#ffffff', margin: 0, letterSpacing: '-0.02em' }}>
                  {heroTitle}
                </h2>

                <p style={{ fontSize: 15, color: '#c1ebe1', margin: 0, lineHeight: 1.5, maxWidth: 540 }}>
                  {heroDesc}
                </p>

                {isTerminal ? (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem', background: 'rgba(255,218,214,0.15)', backdropFilter: 'blur(8px)', padding: '0.85rem 1rem', borderRadius: 14, maxWidth: 540 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#ffb4a8', marginTop: 1 }}>block</span>
                    <p style={{ fontSize: 12, color: '#ffdad6', margin: 0, lineHeight: 1.4 }}>
                      {isCancelled ? 'This reservation was cancelled. The pickup token and dispensation bay hold have been voided.' : 'This reservation was rejected by the dispensary. The pickup token has been voided.'}
                    </p>
                  </div>
                ) : isAssistantDelivery ? (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem', background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)', padding: '0.85rem 1rem', borderRadius: 14, maxWidth: 540 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#c1ebe1', marginTop: 1 }}>verified_user</span>
                    <p style={{ fontSize: 12, color: '#c1ebe1', margin: 0, lineHeight: 1.4 }}>
                      Share this <strong style={{ color: '#ffffff' }}>4-digit Handover PIN</strong> with your delivery partner <strong style={{ color: '#ffffff' }}>({assistantName})</strong> when they arrive at your doorstep to verify custody and complete delivery.
                    </p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem', background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)', padding: '0.85rem 1rem', borderRadius: 14, maxWidth: 540 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#c1ebe1', marginTop: 1 }}>verified_user</span>
                    <p style={{ fontSize: 12, color: '#c1ebe1', margin: 0, lineHeight: 1.4 }}>
                      Show this PIN and your valid Government/Clinical ID to the <strong style={{ color: '#ffffff' }}>Supervising Dispensing Pharmacist</strong> at the <strong style={{ color: '#ffffff' }}>Dispensation Counter</strong>.
                    </p>
                  </div>
                )}

                {/* CTAs */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', paddingTop: '0.5rem' }}>
                  {detailOrder.assistantTask?.status === 'DELIVERED' && (
                    <button
                      onClick={() => handleConfirmReceipt(detailOrder.id)}
                      disabled={confirmingReceipt}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        padding: '0.75rem 1.5rem',
                        borderRadius: 99,
                        background: '#10b981',
                        color: '#ffffff',
                        border: 'none',
                        fontSize: 13,
                        fontWeight: 800,
                        cursor: confirmingReceipt ? 'not-allowed' : 'pointer',
                        boxShadow: '0 4px 12px rgba(16,185,129,0.3)'
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>verified</span>
                      <span>{confirmingReceipt ? 'Confirming...' : 'Confirm Receipt & Complete Handover'}</span>
                    </button>
                  )}

                  {detailOrder.isParentOrder ? (
                    <div style={{ background: '#e0f2eb', color: '#032f28', padding: '0.65rem 1.25rem', borderRadius: 99, fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d' }}>call_split</span>
                      <span>Split Order: Checkout each dispensary order individually below</span>
                    </div>
                  ) : isConfirmed && !isCheckoutComplete && (
                    <FlowButton
                      size="lg"
                      style={{
                        background: '#10b981',
                        color: '#ffffff',
                        border: '1.5px solid #34d399',
                        '--fb-color': '#ffffff',
                        '--fb-color-hover': '#00201b',
                        '--fb-circle-bg': '#a7f3d0',
                        '--fb-border': '#34d399',
                        fontWeight: 800,
                        fontSize: 14,
                        boxShadow: '0 4px 18px rgba(16, 185, 129, 0.45)'
                      }}
                      onClick={() => handleOpenCheckout(detailOrder.id)}
                    >
                      Choose Mode &amp; Proceed to Pay
                    </FlowButton>
                  )}

                  {isConfirmed && isCounterPay && (
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        padding: '0.75rem 1.5rem',
                        borderRadius: 99,
                        background: '#e0f2eb',
                        color: '#2e685d',
                        fontSize: 13,
                        fontWeight: 800,
                        boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>storefront</span>
                      <span>Pay at Counter Selected</span>
                    </div>
                  )}

                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(detailOrder.pharmacy?.address || detailOrder.pharmacy?.name || 'Pharmacy')}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      padding: '0.75rem 1.5rem',
                      borderRadius: 99,
                      background: '#c1ebe1',
                      color: '#00201b',
                      textDecoration: 'none',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#032f28' }}>directions</span>
                    <span>Get Directions to Pharmacy</span>
                  </a>

                  {detailOrder.pharmacy?.phone && (
                    <a
                      href={`tel:${detailOrder.pharmacy.phone}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        padding: '0.75rem 1.25rem',
                        borderRadius: 99,
                        background: 'rgba(255,255,255,0.12)',
                        color: '#ffffff',
                        textDecoration: 'none',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>call</span>
                      <span>Contact Pharmacist</span>
                    </a>
                  )}

                  {['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'].includes(detailOrder.status) && !isPaid && !isTerminal && (
                    <button
                      onClick={() => setCancellingOrderId(detailOrder.id)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        padding: '0.75rem 1.25rem',
                        borderRadius: 99,
                        background: '#ffdad6',
                        color: '#93000a',
                        border: 'none',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>cancel</span>
                      <span>Cancel Reservation</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Distinct 4-Digit Pickup PIN Card (5 cols on desktop, full width on mobile) */}
              <div className="lg:col-span-5 flex justify-center w-full">
                <div style={{
                  width: '100%',
                  maxWidth: 360,
                  background: '#ffffff',
                  borderRadius: 20,
                  padding: '1.5rem',
                  boxShadow: '0 16px 40px rgba(0,0,0,0.2)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  textAlign: 'center'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', borderBottom: '1px solid #e0f2eb', paddingBottom: '0.65rem' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: isTerminal ? '#93000a' : '#717976', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 15, color: isTerminal ? '#93000a' : '#2e685d' }}>{isTerminal ? 'block' : 'lock'}</span>
                      {isTerminal ? 'TOKEN INACTIVE' : (isAssistantDelivery ? (pinStr ? 'DELIVERY OTP' : 'AWAITING DISPATCH') : (pinStr ? 'DISPENSING TOKEN' : 'AWAITING STAGING'))}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: isTerminal ? '#93000a' : '#2e685d', background: isTerminal ? '#ffdad6' : '#b0ecdd', padding: '0.15rem 0.55rem', borderRadius: 99 }}>
                      {isTerminal ? 'VOIDED' : (isAssistantDelivery ? 'Doorstep Handover' : 'Bay #04')}
                    </span>
                  </div>

                  <span style={{ fontSize: 12, fontWeight: 600, color: isTerminal ? '#93000a' : '#414846', margin: '0.75rem 0 0.5rem 0' }}>
                    {isTerminal
                      ? (isAssistantDelivery ? `Delivery OTP Voided (${detailOrder.status})` : `Pickup PIN Voided (${detailOrder.status})`)
                      : (isAssistantDelivery
                          ? (pinStr ? 'Doorstep Delivery Handover OTP' : 'OTP Revealed Upon Assistant Collection')
                          : (pinStr ? 'Patient Pickup Verification PIN' : 'PIN Generated Upon Pharmacy Staging'))}
                  </span>

                  {/* Large 4-digit PIN layout */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.65rem', margin: '0.5rem 0' }}>
                    {pinDigits.map((d, idx) => (
                      <div
                        key={idx}
                        style={{
                          width: 58,
                          height: 72,
                          borderRadius: 14,
                          background: isTerminal ? '#ffdad6' : '#e6f8f1',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 32,
                          fontWeight: 800,
                          color: isTerminal ? '#93000a' : '#032f28',
                          boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.05)',
                          border: isTerminal ? '1px solid #ffb4a8' : '1px solid #c0c8c5'
                        }}
                      >
                        {d}
                      </div>
                    ))}
                  </div>

                  {/* Micro Barcode Simulation */}
                  <div style={{ width: '100%', marginTop: '0.75rem', paddingTop: '0.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px', height: 24, opacity: isTerminal ? 0.2 : 0.6, width: '80%' }}>
                      {[2, 4, 1, 3, 2, 5, 1, 2, 4, 2, 1, 3, 2, 4, 1].map((w, i) => (
                        <span key={i} style={{ width: w, height: '100%', background: isTerminal ? '#93000a' : '#032f28', borderRadius: 1 }} />
                      ))}
                    </div>
                    <p style={{ fontSize: 11, color: isTerminal ? '#93000a' : '#717976', margin: 0, textAlign: 'center' }}>
                      {isTerminal
                        ? 'Single-use security code has been voided.'
                        : (isAssistantDelivery
                            ? (pinStr
                                ? <>Provide this <strong style={{ color: '#032f28' }}>4-digit OTP</strong> to your delivery assistant at your doorstep.</>
                                : 'Your Delivery OTP will appear here once your delivery assistant collects the medication package from the dispensary.')
                            : (pinStr
                                ? <>Show this <strong style={{ color: '#032f28' }}>4-digit PIN</strong> to the pharmacist at the dispensary counter.</>
                                : 'Your Pickup PIN will appear here once the pharmacist prepares and marks your order Ready for Pickup.'))}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Gate 4: Participating Dispensary Child Orders Section for Multi-Pharmacy Split Order */}
          {detailOrder.isParentOrder && (
            <section style={{
              background: '#ffffff',
              borderRadius: 24,
              padding: '1.75rem',
              boxShadow: '0 2px 12px rgba(3,47,40,0.04)',
              border: '1.5px solid #b0ecdd',
              marginBottom: '2rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid #e0f2eb', paddingBottom: '1rem', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#032f28', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8ab2a9' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 22 }}>call_split</span>
                  </div>
                  <div>
                    <h3 style={{ fontSize: 18, fontWeight: 800, color: '#032f28', margin: 0 }}>
                      Participating Dispensary Orders ({detailOrder.childOrders?.length || 0})
                    </h3>
                    <p style={{ fontSize: 12, color: '#414846', margin: 0 }}>
                      Independent inventory confirmation, checkout, and handover PIN for each dispensary
                    </p>
                  </div>
                </div>

                <div style={{ background: '#e0f2eb', color: '#032f28', padding: '0.35rem 0.85rem', borderRadius: 99, fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>account_balance_wallet</span>
                  <span>Single ₹2.00 Platform Fee Ledger Enforced</span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem' }}>
                {(detailOrder.childOrders || []).map((child, idx) => {
                  const childIsPaid = child.payment?.status === 'PAID';
                  const childIsCounter = child.payment?.method === 'COUNTER' || child.payment?.method === 'PAY_AT_COUNTER';
                  const childCheckoutDone = Boolean(child.fulfillmentType) && (childIsPaid || childIsCounter);
                  const childCanCheckout = child.status === 'CONFIRMED' && !childCheckoutDone;
                  const childFee = Number(child.platformFee) || 0;

                  return (
                    <div
                      key={child.id || idx}
                      style={{
                        background: '#f8faf9',
                        border: '1px solid #c0c8c5',
                        borderRadius: 18,
                        padding: '1.25rem',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: '1rem'
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: '#2e685d', background: '#e0f2eb', padding: '2px 8px', borderRadius: 99 }}>
                            Dispensary #{idx + 1}
                          </span>
                          <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#032f28' }}>
                            Ref #{child.orderNumber}
                          </span>
                        </div>

                        <h4 style={{ fontSize: 16, fontWeight: 800, color: '#032f28', margin: '0 0 0.25rem 0' }}>
                          {child.pharmacy?.name || 'Local Community Dispensary'}
                        </h4>
                        <p style={{ fontSize: 12, color: '#414846', margin: '0 0 0.75rem 0' }}>
                          {child.pharmacy?.address || 'Dispensary Address'}
                        </p>

                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                          <StatusBadge status={child.status} />
                          <PaymentBadge payment={child.payment} />
                        </div>

                        {/* Items */}
                        <div style={{ background: '#ffffff', border: '1px solid #e0f2eb', borderRadius: 12, padding: '0.65rem 0.85rem', marginBottom: '0.75rem' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#717976', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                            Allocated Medicines
                          </div>
                          {(child.items || []).map((it, iIdx) => (
                            <div key={iIdx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#032f28', marginBottom: '0.2rem' }}>
                              <span>{it.medicine?.brandName || it.brandName || 'Medicine'}</span>
                              <strong style={{ color: '#2e685d' }}>×{it.quantity}</strong>
                            </div>
                          ))}
                        </div>

                        {/* Financials */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: '#414846', padding: '0.5rem 0', borderTop: '1px solid #e0f2eb', borderBottom: '1px solid #e0f2eb' }}>
                          <div>
                            Subtotal: <strong style={{ color: '#032f28' }}>{child.medicineSubtotal != null ? `₹${Number(child.medicineSubtotal).toFixed(2)}` : 'MRP'}</strong>
                          </div>
                          <div style={{ color: childFee > 0 ? '#032f28' : '#2e685d', fontWeight: 600 }}>
                            Fee: {childFee > 0 ? `₹${childFee.toFixed(2)}` : '₹0.00 (Sibling covered)'}
                          </div>
                        </div>

                        {child.verificationPin && (
                          <div style={{ marginTop: '0.75rem', background: '#e6f8f1', border: '1px solid #b0ecdd', borderRadius: 12, padding: '0.6rem', textAlign: 'center' }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: '#414846', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              Dispensary Handover PIN
                            </div>
                            <div style={{ fontFamily: 'monospace', fontSize: 24, fontWeight: 800, color: '#032f28', letterSpacing: '0.2em' }}>
                              {child.verificationPin}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Checkout action */}
                      <div>
                        {childCanCheckout ? (
                          <FlowButton
                            fullWidth
                            size="sm"
                            variant="primary"
                            onClick={() => handleOpenCheckout(child.id)}
                          >
                            Proceed to Checkout ({child.pharmacy?.name?.slice(0, 16) || 'Dispensary'})
                          </FlowButton>
                        ) : childCheckoutDone ? (
                          <div style={{ textAlign: 'center', color: '#2e685d', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', padding: '0.4rem 0' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check_circle</span>
                            <span>Fulfillment &amp; Checkout Confirmed</span>
                          </div>
                        ) : (
                          <div style={{ textAlign: 'center', color: '#717976', fontSize: 12, fontStyle: 'italic', padding: '0.4rem 0' }}>
                            Awaiting dispensary confirmation before checkout
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* MAIN VISUAL TIMELINE: "Your Medicine Journey" (Stitch Stepper) */}
          <section style={{
            background: '#ffffff',
            borderRadius: 24,
            padding: '1.75rem',
            boxShadow: '0 2px 12px rgba(3,47,40,0.04)',
            border: '1px solid #e0f2eb',
            marginBottom: '2rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid #e0f2eb', paddingBottom: '1rem', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#c1ebe1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#032f28' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }}>timeline</span>
                </div>
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 800, color: '#032f28', margin: 0 }}>Your Medicine Journey</h3>
                  <p style={{ fontSize: 12, color: '#717976', margin: 0 }}>Live end-to-end pharmacy verification &amp; fulfillment states</p>
                </div>
              </div>

              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: '#e0f2eb', color: '#032f28', padding: '0.25rem 0.75rem', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2e685d' }}></span>
                <span>Real-time Rx Pipeline Synchronized</span>
              </div>
            </div>

            {isTerminal && (
              <div style={{ marginBottom: '1.25rem', padding: '0.85rem 1.25rem', borderRadius: 14, background: '#ffdad6', color: '#93000a', display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>error</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>
                  {isCancelled ? 'Order journey stopped: This reservation was cancelled by the patient.' : 'Order journey stopped: This reservation was rejected by the dispensary.'}
                </span>
              </div>
            )}

            {/* Horizontal Multi-step Stepper (5 Steps) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              {(isAssistantDelivery && isCheckoutComplete ? [
                {
                  step: '01',
                  title: 'Order Confirmed & Paid',
                  desc: `₹${(detailOrder.totalAmount || 0).toFixed(2)} confirmed paid online`,
                  isDone: true,
                  isActive: false
                },
                {
                  step: '02',
                  title: 'Partner Assigned',
                  desc: assistantName ? `${assistantName} assigned` : 'Dispatched to delivery partner',
                  isDone: ['ACCEPTED', 'COLLECTING', 'IN_TRANSIT', 'DELIVERED', 'CONFIRMED'].includes(assistantStatus) || isCompleted,
                  isActive: assistantStatus === 'ASSIGNED' || (!assistantStatus && isCheckoutComplete)
                },
                {
                  step: '03',
                  title: 'Collecting at Pharmacy',
                  desc: `Verifying at ${detailOrder.pharmacy?.name || 'dispensary counter'}`,
                  isDone: ['IN_TRANSIT', 'DELIVERED', 'CONFIRMED'].includes(assistantStatus) || isCompleted,
                  isActive: ['ACCEPTED', 'COLLECTING'].includes(assistantStatus)
                },
                {
                  step: '04',
                  title: 'Out for Delivery',
                  desc: 'In transit to your doorstep',
                  isDone: ['DELIVERED', 'CONFIRMED'].includes(assistantStatus) || isCompleted,
                  isActive: assistantStatus === 'IN_TRANSIT'
                },
                {
                  step: '05',
                  title: 'Doorstep PIN Handover',
                  desc: 'Verified via 4-digit PIN',
                  isDone: assistantStatus === 'CONFIRMED' || isCompleted,
                  isActive: assistantStatus === 'DELIVERED'
                }
              ] : [
                { step: '01', title: 'Pharmacy Confirmation', desc: 'Prescription verified by apothecary', isDone: currentStepIndex > 1, isActive: currentStepIndex === 1 },
                { step: '02', title: 'Payment', desc: `₹${(detailOrder.totalAmount || 0).toFixed(2)} confirmed paid`, isDone: currentStepIndex > 2, isActive: currentStepIndex === 2 },
                { step: '03', title: 'Preparing', desc: 'Medicines checked & batch packaged', isDone: currentStepIndex > 3, isActive: currentStepIndex === 3 },
                { step: '04', title: 'Ready for Pickup', desc: 'Locked in temperature-controlled counter', isDone: currentStepIndex > 4, isActive: currentStepIndex === 4 },
                { step: '05', title: 'Completed', desc: 'Handover confirmed & receipt issued', isDone: currentStepIndex >= 5, isActive: false }
              ]).map((st, i) => (
                <div
                  key={i}
                  style={{
                    borderRadius: 16,
                    padding: '1rem',
                    background: st.isActive ? '#032f28' : st.isDone ? '#e6f8f1' : '#f5faf8',
                    color: st.isActive ? '#ffffff' : '#032f28',
                    border: st.isActive ? '2px solid #2e685d' : '1px solid #e0f2eb',
                    boxShadow: st.isActive ? '0 8px 24px rgba(3,47,40,0.15)' : 'none',
                    transform: st.isActive ? 'scale(1.02)' : 'none',
                    transition: 'all 0.2s',
                    position: 'relative'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: st.isActive ? '#c1ebe1' : st.isDone ? '#2e685d' : '#d5e6e0',
                      color: st.isActive ? '#032f28' : st.isDone ? '#ffffff' : '#717976',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 14,
                      fontWeight: 700
                    }}>
                      {st.isDone ? <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check</span> : st.step}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: st.isActive ? '#c1ebe1' : '#717976', textTransform: 'uppercase' }}>
                      Step {st.step}
                    </span>
                  </div>

                  <h4 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 0.25rem 0', color: st.isActive ? '#ffffff' : '#032f28' }}>
                    {st.title}
                  </h4>
                  <p style={{ fontSize: 11, margin: 0, color: st.isActive ? '#c1ebe1' : '#717976', lineHeight: 1.4 }}>
                    {st.desc}
                  </p>

                  <div style={{ marginTop: '0.75rem', fontSize: 11, fontWeight: 700, color: st.isActive ? '#c1ebe1' : st.isDone ? '#2e685d' : '#717976', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    {st.isActive ? (
                      <>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#c1ebe1' }}></span>
                        <span>Live Status</span>
                      </>
                    ) : st.isDone ? (
                      <>
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>done_all</span>
                        <span>Completed</span>
                      </>
                    ) : (
                      <span>Pending</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Radial / Orbital Fulfillment Dynamics Visualization */}
          <div style={{ marginBottom: '2rem' }}>
            <RadialOrbitalTimeline
              orderStatus={detailOrder.status}
              assistantTaskStatus={detailOrder.assistantTask?.status}
              isAssistantDelivery={detailOrder.orderType === 'ASSISTED_DELIVERY' || detailOrder.fulfillmentType === 'ASSISTANT_DELIVERY' || detailOrder.fulfillmentType === 'DELIVERY'}
            />
          </div>

          {/* FULFILLMENT & SERVICE OVERVIEW CARD */}
          <section style={{
            background: '#ffffff',
            borderRadius: 20,
            padding: '1.25rem 1.75rem',
            border: '1px solid #e0f2eb',
            boxShadow: '0 2px 10px rgba(3,47,40,0.04)',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1.25rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                background: '#e0f2eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#032f28'
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: 24, color: '#2e685d' }}>
                  {detailOrder.fulfillmentType === 'ASSISTANT_DELIVERY' ? 'support_agent' : detailOrder.fulfillmentType === 'DELIVERY' ? 'local_shipping' : 'storefront'}
                </span>
              </div>
              <div>
                <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#717976', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Fulfillment
                </span>
                <span style={{ display: 'block', fontSize: 16, fontWeight: 800, color: '#032f28' }}>
                  {detailOrder.fulfillmentType === 'ASSISTANT_DELIVERY'
                    ? 'Medicine Access Assistant'
                    : detailOrder.fulfillmentType === 'DELIVERY'
                    ? 'Pharmacy Delivery'
                    : 'Counter Pickup'}
                </span>
              </div>

              {detailOrder.fulfillmentType === 'ASSISTANT_DELIVERY' && (detailOrder.assistantServiceType || detailOrder.assistantTask?.serviceType) && (
                <>
                  <div style={{ width: 1, height: 32, background: '#e0f2eb' }} />
                  <div>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#717976', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Service
                    </span>
                    <span style={{ display: 'block', fontSize: 15, fontWeight: 800, color: '#1e453e' }}>
                      {getAssistantServiceLabel(detailOrder.assistantServiceType || detailOrder.assistantTask?.serviceType)}
                    </span>
                  </div>
                </>
              )}

              {detailOrder.fulfillmentType === 'ASSISTANT_DELIVERY' && detailOrder.assistantTask?.assistant?.name && (
                <>
                  <div style={{ width: 1, height: 32, background: '#e0f2eb' }} />
                  <div>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#717976', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Assigned Assistant
                    </span>
                    <span style={{ display: 'block', fontSize: 15, fontWeight: 800, color: '#032f28' }}>
                      {detailOrder.assistantTask.assistant.name}
                    </span>
                  </div>
                </>
              )}

              {detailOrder.fulfillmentType === 'ASSISTANT_DELIVERY' && detailOrder.assistantTask?.status && (
                <>
                  <div style={{ width: 1, height: 32, background: '#e0f2eb' }} />
                  <div>
                    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#717976', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Task Status
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: 12, fontWeight: 800, color: detailOrder.assistantTask.status === 'CONFIRMED' ? '#2e685d' : '#032f28', background: '#e0f2eb', padding: '0.2rem 0.65rem', borderRadius: 99 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                        {detailOrder.assistantTask.status === 'CONFIRMED' ? 'check_circle' : detailOrder.assistantTask.status === 'DELIVERED' ? 'local_shipping' : 'schedule'}
                      </span>
                      {detailOrder.assistantTask.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                </>
              )}
            </div>

            {detailOrder.fulfillmentType === 'ASSISTANT_DELIVERY' && detailOrder.deliveryAddress && !['DIGITAL_ASSISTANCE', 'PRESCRIPTION_ASSISTANCE', 'PHARMACY_COMMS'].includes(detailOrder.assistantServiceType || detailOrder.assistantTask?.serviceType) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: 12, color: '#414846', background: '#f5faf8', padding: '0.5rem 0.85rem', borderRadius: 12, border: '1px solid #e0f2eb' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>location_on</span>
                <span><strong>Service Location:</strong> {detailOrder.deliveryAddress}</span>
              </div>
            )}
          </section>

          {/* FULFILLMENT DEDICATED VISUAL & CONTEXT (Two-column layout: 7 cols left, 5 cols right on desktop, stacked on mobile) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-8 items-start">

            {/* Left Column: Pharmacy Collection Details & Visual Map Anchor (7 cols) */}
            <div className="lg:col-span-7 flex flex-col gap-6">
              <section style={{ background: '#ffffff', borderRadius: 24, padding: '1.75rem', border: '1px solid #e0f2eb', boxShadow: '0 2px 10px rgba(3,47,40,0.04)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <span style={{ background: '#e0f2eb', color: '#414846', fontSize: 10, fontWeight: 700, padding: '0.15rem 0.55rem', borderRadius: 99, textTransform: 'uppercase' }}>Apothecary Hub</span>
                      {((detailOrder.pharmacy?.isVerified || detailOrder.pharmacy?.verificationStatus === 'VERIFIED') && !detailOrder.pharmacy?.isTestRecord) ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#2e685d', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>verified</span>
                          Participating Pharmacy
                        </span>
                      ) : (
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#92400e', background: '#fef3c7', padding: '0.15rem 0.5rem', borderRadius: 99, border: '1px solid #fde68a' }}>
                          TEST DATA — NOT A PARTICIPATING PHARMACY
                        </span>
                      )}
                    </div>
                    <h3 style={{ fontSize: 20, fontWeight: 800, color: '#032f28', margin: 0 }}>
                      {detailOrder.pharmacy?.name || 'Participating Pharmacy'}
                    </h3>
                  </div>

                  <div style={{ width: 44, height: 44, borderRadius: 14, background: '#e6f8f1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#032f28' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 24 }}>local_pharmacy</span>
                  </div>
                </div>

                {/* Location Map: Fulfillment MapLibre Geo Visualization */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <React.Suspense fallback={<SkeletonMap height="300px" />}>
                    <FulfillmentMapBox
                      pharmacy={detailOrder.pharmacy}
                      destination={
                        detailOrder.deliveryAddress
                          ? {
                              address: detailOrder.deliveryAddress,
                              latitude: detailOrder.destinationLatitude ?? null,
                              longitude: detailOrder.destinationLongitude ?? null
                            }
                          : null
                      }
                      orderStatus={detailOrder.status}
                      height="300px"
                    />
                  </React.Suspense>
                </div>

                {/* Key Pharmacy Info Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                  <div style={{ background: '#e6f8f1', borderRadius: 14, padding: '1rem', display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                    <span className="material-symbols-outlined" style={{ color: '#2e685d', fontSize: 22 }}>schedule</span>
                    <div>
                      <span style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#717976' }}>Operating Hours</span>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: '#032f28' }}>Open until 10:30 PM</span>
                      <span style={{ display: 'block', fontSize: 11, color: '#414846' }}>Dispensary counter open continuously</span>
                    </div>
                  </div>

                  <div style={{ background: '#e6f8f1', borderRadius: 14, padding: '1rem', display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                    <span className="material-symbols-outlined" style={{ color: '#2e685d', fontSize: 22 }}>storefront</span>
                    <div>
                      <span style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#717976' }}>Counter Instructions</span>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: '#032f28' }}>{isTerminal ? 'Counter Hold Inactive' : 'Counter 2 (Rx Rapid Release)'}</span>
                      <span style={{ display: 'block', fontSize: 11, color: '#414846' }}>
                        {isTerminal ? `This reservation is inactive (${detailOrder.status.toLowerCase()}). No counter collection is active.` : `Tell staff you have a MediFind AI reservation. Provide PIN ${pinStr}.`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Address Line */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#e0f2eb', padding: '0.85rem 1rem', borderRadius: 14, marginBottom: '1rem', fontSize: 12, color: '#032f28' }}>
                  <span className="material-symbols-outlined" style={{ color: '#2e685d', fontSize: 18 }}>location_on</span>
                  <span><strong>Address:</strong> {detailOrder.pharmacy?.address || 'Dispensary Location'}</span>
                </div>

                {/* Verification Notice */}
                {detailOrder.pharmacy?.isTestRecord ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#dbece5', padding: '0.75rem 1rem', borderRadius: 14, fontSize: 11, color: '#414846' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#717976' }}>science</span>
                      <strong>VERIFICATION NOTICE:</strong>
                      <span>TEST DATA — NOT A PARTICIPATING PHARMACY</span>
                    </div>
                    <span style={{ fontWeight: 700, color: '#2e685d' }}>Sandboxed Environment</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#e0f2eb', padding: '0.75rem 1rem', borderRadius: 14, fontSize: 11, color: '#032f28' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#10b981' }}>verified</span>
                      <strong>STATUS:</strong>
                      <span>Participating Pharmacy (Chengannur)</span>
                    </div>
                    <span style={{ fontWeight: 700, color: '#2e685d' }}>Verified Clinical Partner</span>
                  </div>
                )}
              </section>
            </div>

            {/* Right Column: Status History & Prescribed Package Summary (5 cols) */}
            <div className="lg:col-span-5 flex flex-col gap-6">

              {/* Order Status History (Audit Log) */}
              <section style={{ background: '#ffffff', borderRadius: 24, padding: '1.5rem', border: '1px solid #e0f2eb', boxShadow: '0 2px 10px rgba(3,47,40,0.04)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', borderBottom: '1px solid #e0f2eb', paddingBottom: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span className="material-symbols-outlined" style={{ color: '#032f28', fontSize: 20 }}>history_toggle_off</span>
                    <h3 style={{ fontSize: 15, fontWeight: 800, color: '#032f28', margin: 0 }}>Order Status History</h3>
                  </div>
                  <span style={{ fontSize: 11, color: '#717976' }}>Live Audit Log</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', position: 'relative', paddingLeft: '1.25rem' }}>
                  <div style={{ position: 'absolute', left: 6, top: 4, bottom: 4, width: 2, background: '#d5e6e0' }}></div>

                  {(detailOrder.statusHistory && detailOrder.statusHistory.length > 0 ? detailOrder.statusHistory : [
                    { status: 'Order Placed', createdAt: detailOrder.createdAt, comment: 'Prescription digitally approved and verified.' },
                    { status: detailOrder.status, createdAt: detailOrder.updatedAt || detailOrder.createdAt, comment: 'Fulfillment protocol staged.' }
                  ]).map((h, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      <div style={{
                        position: 'absolute',
                        left: -18,
                        top: 2,
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        background: i === 0 ? '#2e685d' : '#032f28',
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10
                      }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 10 }}>check</span>
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem' }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#032f28' }}>{h.status.replace(/_/g, ' ')}</span>
                          <span style={{ fontSize: 10, color: '#717976' }}>{new Date(h.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <p style={{ fontSize: 11, color: '#414846', margin: '0.15rem 0 0 0' }}>
                          {h.comment || 'System status updated.'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Items in Sealed Package & Detailed Billing Breakdown */}
              <section style={{ background: '#ffffff', borderRadius: 24, padding: '1.5rem', border: '1px solid #e0f2eb', boxShadow: '0 2px 10px rgba(3,47,40,0.04)' }}>
                {(() => {
                  const pricing = calculateOrderPricing(detailOrder);
                  const isSettled = detailOrder.status === 'COMPLETED' || detailOrder.payment?.status === 'PAID';
                  return (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: '#032f28', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <span className="material-symbols-outlined" style={{ color: '#2e685d', fontSize: 18 }}>medication</span>
                          Items in Sealed Package ({detailOrder.items?.length || 0})
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#336c61', background: '#b0ecdd', padding: '0.15rem 0.55rem', borderRadius: 99 }}>
                          Cold Chain Verified
                        </span>
                      </div>

                      {/* Itemized Medicine List with Unit Price and Subtotal */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                        {(detailOrder.items || []).map((it, idx) => {
                          const unitPrice = getItemUnitPrice(it);
                          const qty = Number(it.quantity) || 1;
                          const itemSubtotal = unitPrice != null ? unitPrice * qty : null;
                          return (
                            <div key={idx} style={{ background: '#f8faf9', borderRadius: 14, padding: '0.85rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', border: '1px solid #e2ece7' }}>
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 800, color: '#032f28' }}>
                                  {it.medicine?.brandName || it.medicine?.name || it.name || 'Prescription Medicine'}
                                </div>
                                <div style={{ fontSize: 11, color: '#52605c', marginTop: '2px' }}>
                                  {it.medicine?.dosageForm || 'Oral'} • {unitPrice != null ? `₹${unitPrice.toFixed(2)} each` : 'MRP / counter pricing at pharmacy'} • Batch #MF-{it.id ? it.id.slice(0, 4).toUpperCase() : '57D4'}
                                </div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <span style={{ fontSize: 11, fontWeight: 700, background: '#e0f2eb', padding: '0.2rem 0.55rem', borderRadius: 99, color: '#032f28', marginRight: '0.5rem' }}>
                                  Qty: {qty}
                                </span>
                                <span style={{ fontSize: 13, fontWeight: 800, color: '#032f28' }}>
                                  {itemSubtotal != null ? `₹${itemSubtotal.toFixed(2)}` : 'MRP at counter'}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Detailed Cost Breakdown Summary Card */}
                      <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid #e0f2eb', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#52605c' }}>
                          <span>Medicine Subtotal</span>
                          <span style={{ fontWeight: 700, color: '#032f28' }}>
                            {pricing.medicineSubtotal != null ? `₹${pricing.medicineSubtotal.toFixed(2)}` : 'MRP / counter pricing at pharmacy'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#52605c' }}>
                          <span>
                            {detailOrder.fulfillmentType === 'ASSISTANT_DELIVERY' ? 'Assistant Service Fee' : 'Fulfillment & Service Fee'}
                          </span>
                          <span style={{ fontWeight: 700, color: '#032f28' }}>
                            {pricing.deliveryFee > 0
                              ? `₹${pricing.deliveryFee.toFixed(2)}`
                              : '₹0.00 (Counter Pickup)'}
                          </span>
                        </div>
                        {pricing.platformFee > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#52605c' }}>
                            <span>Platform Fee</span>
                            <span style={{ fontWeight: 700, color: '#032f28' }}>
                              <RollingNumber prefix="₹" value={pricing.platformFee.toFixed(2)} />
                            </span>
                          </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#52605c' }}>
                          <span>Dispensing & Clinical Check</span>
                          <span style={{ fontWeight: 700, color: '#059669' }}>Included</span>
                        </div>

                        {/* Grand Total Line */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1.5px dashed #cbd5e1', fontSize: 15 }}>
                          <div>
                            <span style={{ fontWeight: 800, color: '#032f28', display: 'block' }}>
                              {isSettled ? 'Total Amount Paid' : 'Total Amount Payable'}
                            </span>
                            <span style={{ fontSize: 11, color: '#717976' }}>
                              {isSettled
                                ? (detailOrder.payment?.status === 'PAID' ? 'Settled online via UPI/Card' : 'Settled at pharmacy counter')
                                : (detailOrder.orderType === 'ASSISTED_DELIVERY' ? 'Pay upon assistant handover' : 'Pay at pickup counter')}
                            </span>
                          </div>
                          <span style={{ fontWeight: 900, color: '#032f28', fontSize: 20 }}>
                            {pricing.medicineSubtotal != null ? (
                              <RollingNumber prefix="₹" value={pricing.totalAmount.toFixed(2)} />
                            ) : (
                              'MRP / counter pricing at pharmacy'
                            )}
                          </span>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </section>
            </div>
          </div>
        </div>

        {/* Razorpay Checkout Modal */}
        {checkoutOrderId && (
          <CheckoutPage
            orderId={checkoutOrderId}
            onClose={handleCloseCheckout}
            onPaymentSuccess={handlePaymentSuccess}
          />
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // VIEW 2: STITCH SCREEN 702dca9d989c4f3fae71585f1340dd2d (MY ORDERS)
  // ─────────────────────────────────────────────────────────────
  return (
    <div style={{ background: '#ecfdf7', minHeight: '100vh', fontFamily: "'Plus Jakarta Sans', sans-serif", paddingBottom: '4rem' }}>
      <div className="w-full max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-6 flex flex-col gap-3 sm:gap-5">

        {/* Smart Patient Greeting Header matching Patient Homescreen */}
        <section className="flex items-baseline justify-between flex-wrap gap-2 pt-1 pb-1">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-primary tracking-tight flex items-center gap-2 flex-wrap">
              <span className="material-symbols-outlined text-emerald-600 dark:text-emerald-400 text-2xl select-none">
                {patientGreetIcon}
              </span>
              <span>
                {patientTimeGreet}, <span className="text-secondary">{patientFirstName || 'there'}</span>
              </span>
            </h1>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Verified Clinical Rx Network &middot; Chengannur, Kerala
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border border-outline-variant/30 bg-surface-container-low text-xs font-medium text-on-surface-variant">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_6px_2px_rgba(52,211,153,0.5)]"></span>
            </span>
            <span>Network Live</span>
          </div>
        </section>

        {/* Header & Clinical Overview Row */}
        <section className="flex flex-col gap-2 sm:gap-3">
          <div className="flex items-end justify-between flex-wrap gap-2 sm:gap-4">
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="w-5 h-5 rounded-full bg-[#b0ecdd] text-[#2e685d] flex items-center justify-center">
                  <span className="material-symbols-outlined text-xs">verified</span>
                </span>
                <span className="text-[10px] sm:text-xs font-extrabold uppercase tracking-wider text-[#2e685d]">
                  VERIFIED PATIENT PORTAL
                </span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-[#032f28] tracking-tight m-0">
                My Orders
              </h2>
              <p className="text-xs sm:text-sm text-[#414846] mt-0.5 max-w-xl">
                Track your verified medicine requests, fulfillment timelines, and dispensations across our clinical network.
              </p>
            </div>

            {/* Clinical Network Badge */}
            <div className="inline-flex items-center gap-2 bg-white border border-[#c0c8c5] px-3 py-1.5 rounded-full shadow-2xs">
              <div className="w-2 h-2 rounded-full bg-[#2e685d]"></div>
              <span className="text-xs font-bold text-[#032f28]">Pharmacy Network Live</span>
              <span className="text-[#c0c8c5]">•</span>
              <span className="text-[11px] font-bold text-[#2e685d] bg-[#e0f2eb] px-2 py-0.5 rounded-full">
                Encrypted
              </span>
            </div>
          </div>

          {/* 4 Metric Summary Cards: 2x2 grid on mobile, 4-col on desktop */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 pt-1">
            {/* Metric 1: Active Orders */}
            <AnimatedStatCard
              icon="timelapse"
              value={activeOrdersCount}
              label="Active Orders"
              iconBg="#b0ecdd"
              iconColor="#2e685d"
              accentColor="#2e685d"
              barWidth="100%"
              delay={0}
              refreshKey={orders.length}
            />

            {/* Metric 2: Awaiting Confirmation */}
            <AnimatedStatCard
              icon="hourglass_empty"
              value={pendingCount}
              label="Awaiting Confirm"
              iconBg="#e0f2eb"
              iconColor="#717976"
              accentColor="#717976"
              hasBottomBar={false}
              delay={0.06}
              refreshKey={orders.length}
            />

            {/* Metric 3: Ready for Pickup */}
            <AnimatedStatCard
              icon="storefront"
              value={readyCount}
              label="Ready Pickup"
              iconBg="#c1ebe1"
              iconColor="#032f28"
              accentColor="#c1ebe1"
              barWidth="100%"
              delay={0.12}
              refreshKey={orders.length}
            />

            {/* Metric 4: Completed */}
            <AnimatedStatCard
              icon="task_alt"
              value={completedCount}
              label="Completed"
              iconBg="#dbece5"
              iconColor="#414846"
              accentColor="#2e685d"
              hasBottomBar={false}
              delay={0.18}
              refreshKey={orders.length}
            />
          </div>
        </section>

        {/* Filter & Search Control Bar */}
        <section style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
          {/* Search Input */}
          <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 440, width: '100%' }}>
            <span className="material-symbols-outlined" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#717976', fontSize: 18 }}>
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search"
              style={{
                width: '100%',
                padding: '0.65rem 1rem 0.65rem 2.65rem',
                borderRadius: 99,
                background: '#ffffff',
                border: '1px solid #c0c8c5',
                fontSize: 13,
                color: '#032f28',
                fontWeight: 700,
                outline: 'none',
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
              }}
            />
          </div>

          {/* Filter Pills */}
          <div className="no-scrollbar" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', overflowX: 'auto', background: '#e0f2eb', padding: '0.35rem', borderRadius: 99, maxWidth: '100%' }}>
            {[
              { id: 'ALL', label: 'All', count: orders.length },
              { id: 'ACTIVE', label: 'Active', count: activeOrdersCount },
              { id: 'COMPLETED', label: 'Completed', count: completedCount },
              { id: 'CANCELLED', label: 'Cancelled', count: cancelledCount },
              { id: 'REJECTED', label: 'Rejected', count: rejectedCount }
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setActiveFilter(f.id)}
                style={{
                  padding: '0.4rem 0.95rem',
                  borderRadius: 99,
                  border: 'none',
                  background: activeFilter === f.id ? '#032f28' : 'transparent',
                  color: activeFilter === f.id ? '#ffffff' : '#414846',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem'
                }}
              >
                <span>{f.label}</span>
                <span style={{ opacity: 0.9 }}>
                  (<RollingNumber value={f.count} />)
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Action Feedback Banner */}
        {actionFeedback && (
          <div style={{
            background: actionFeedback.type === 'success' ? '#e0f2eb' : '#ffdad6',
            border: `1px solid ${actionFeedback.type === 'success' ? '#2e685d' : '#ba1a1a'}`,
            borderRadius: 14,
            padding: '0.75rem 1.25rem',
            marginBottom: '1.25rem',
            color: actionFeedback.type === 'success' ? '#032f28' : '#ba1a1a',
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              {actionFeedback.type === 'success' ? 'check_circle' : 'error'}
            </span>
            <span>{actionFeedback.message}</span>
          </div>
        )}

        {/* Orders Stream */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid #b0ecdd', borderTopColor: '#2e685d', animation: 'spin 1s linear infinite', margin: '0 auto 1rem' }} />
            <style>{`@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`}</style>
            <p style={{ fontWeight: 700, color: '#032f28' }}>Loading your orders...</p>
          </div>
        ) : error ? (
          <ErrorState
            title="Unable to load orders"
            message={error}
            onRetry={fetchOrders}
            retryText="Retry Loading Orders"
            className="my-4"
          />
        ) : filteredOrders.length === 0 ? (
          <div style={{ background: '#ffffff', borderRadius: 24, padding: '4rem 2rem', textAlign: 'center', border: '1px solid #e0f2eb' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#e0f2eb', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', color: '#2e685d' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 32 }}>package_2</span>
            </div>
            <h3 style={{ fontSize: 20, fontWeight: 700, color: '#032f28', margin: '0 0 0.5rem 0' }}>
              {activeFilter === 'ALL' ? 'No Orders Yet' : `No ${activeFilter.toLowerCase()} orders`}
            </h3>
            <p style={{ fontSize: 14, color: '#717976', margin: '0 auto 1.5rem', maxWidth: 420 }}>
              Search medicines or upload a prescription to reserve items at participating dispensaries.
            </p>
            {onNavigate && activeFilter === 'ALL' && (
              <button
                type="button"
                onClick={() => onNavigate('medicines')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.65rem 1.5rem',
                  borderRadius: 99,
                  background: '#2e685d',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: 14,
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(46,104,93,0.2)'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>search</span>
                Find Medicines
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {filteredOrders.map(ord => {
              const isReady = ord.status === 'READY_FOR_PICKUP';
              const isConfirmed = ord.status === 'CONFIRMED';
              const isCancelled = ord.status === 'CANCELLED';
              const isRejected = ord.status === 'REJECTED';
              const isPaid = ord.payment?.status === 'PAID';
              const pin = ord.verificationPin;

              return (
                <article
                  key={ord.id}
                  className={`rounded-2xl sm:rounded-3xl border overflow-hidden relative transition-all duration-200 ${
                    isCancelled
                      ? 'bg-[#fafafa] border-dashed border-[#d1d5db] opacity-70 grayscale-[20%]'
                      : 'bg-white border-[#e0f2eb] shadow-2xs hover:shadow-md'
                  }`}
                >
                  <div className={`absolute top-0 left-0 bottom-0 w-1.5 ${
                    isCancelled ? 'bg-[#9ca3af]' : isReady ? 'bg-[#2e685d]' : isConfirmed ? 'bg-[#336c61]' : '#c0c8c5'
                  }`} />

                  {/* Top Metadata Header Strip */}
                  <div className="flex items-center justify-between flex-wrap gap-2 px-3 py-2 sm:px-5 sm:py-3 bg-[#f8faf9] border-b border-[#e6f8f1]">
                    <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                      <span className="text-xs sm:text-sm font-extrabold text-[#032f28]">
                        Order #{ord.orderNumber || ord.id.slice(0, 10).toUpperCase()}
                      </span>
                      <StatusBadge status={ord.status} />
                      <PaymentBadge payment={ord.payment} />
                      {ord.isParentOrder && (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          background: '#032f28',
                          color: '#8ab2a9',
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '3px 10px',
                          borderRadius: 99
                        }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 13 }}>call_split</span>
                          <span>Multi-Pharmacy Split Order ({ord.childOrders?.length || 0} Dispensaries)</span>
                        </span>
                      )}
                      {ord.parentOrder && (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          background: '#e0f2eb',
                          color: '#032f28',
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '3px 10px',
                          borderRadius: 99,
                          border: '1px solid #b0ecdd'
                        }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#2e685d' }}>link</span>
                          <span>Part of Split #{ord.parentOrder.orderNumber}</span>
                        </span>
                      )}
                      {ord.fulfillmentType === 'ASSISTANT_DELIVERY' && (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          background: '#e0f2eb',
                          color: '#032f28',
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '3px 10px',
                          borderRadius: 99,
                          border: '1px solid #b0ecdd'
                        }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#2e685d' }}>support_agent</span>
                          <span>Medicine Access Assistant: {getAssistantServiceLabel(ord.assistantServiceType || ord.assistantTask?.serviceType)}</span>
                        </span>
                      )}
                      {ord.orderType === 'EMERGENCY' && (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          background: '#ffdad6',
                          color: '#93000a',
                          fontSize: 11,
                          fontWeight: 800,
                          padding: '3px 10px',
                          borderRadius: 99,
                          border: '1px solid #ffb4a8'
                        }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#ba1a1a' }}>emergency</span>
                          <span>Emergency / Urgent Care</span>
                        </span>
                      )}
                      {ord.pharmacyResponseStatus === 'PHARMACY_UNRESPONSIVE' && (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          background: '#ffdad6',
                          color: '#93000a',
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '3px 10px',
                          borderRadius: 99,
                          border: '1px solid #ffb4a8'
                        }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#ba1a1a' }}>timer_off</span>
                          <span>Dispensary Unresponsive (&gt;15m)</span>
                        </span>
                      )}
                      {ord.patientPurchaseStatus === 'AWAITING_PATIENT_PURCHASE' && (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          background: '#fff3d6',
                          color: '#7a4f00',
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '3px 10px',
                          borderRadius: 99,
                          border: '1px solid #ffe082'
                        }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 13 }}>shopping_cart_checkout</span>
                          <span>Awaiting Checkout</span>
                        </span>
                      )}
                      {ord.followUpState && (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          background: '#d7e3ff',
                          color: '#003366',
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '3px 10px',
                          borderRadius: 99,
                          border: '1px solid #b4c8f5'
                        }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 13 }}>feedback</span>
                          <span>Follow-up: {ord.followUpState.replace(/_/g, ' ')}</span>
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: '#717976' }}>•</span>
                      <span style={{ fontSize: 12, color: '#717976' }}>
                        {new Date(ord.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    {/* Pickup PIN Capsule */}
                    {pin && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: '#ffffff', padding: '0.3rem 0.85rem', borderRadius: 99, border: '1px solid #c0c8c5', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>pin</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#032f28', fontFamily: 'monospace', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                          PIN: <RollingNumber value={pin} />
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Body Content (12-Col Responsive Grid) */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 sm:gap-6 p-3 sm:p-6">
                    {/* Pharmacy & Items (8 cols on desktop) */}
                    <div className="col-span-1 md:col-span-8 flex flex-col gap-2.5 sm:gap-3">
                      {ord.isParentOrder && ord.childOrders?.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#032f28', fontWeight: 800, fontSize: 14 }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d' }}>call_split</span>
                              <span>Participating Dispensaries ({ord.childOrders.length}):</span>
                            </div>
                            <span style={{ fontSize: 11, color: '#2e685d', fontWeight: 700, background: '#e0f2eb', padding: '2px 8px', borderRadius: 99 }}>
                              Single ₹2.00 Platform Fee Ledger Enforced
                            </span>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                            {ord.childOrders.map((child, cIdx) => {
                              const childIsPaid = child.payment?.status === 'PAID';
                              const childIsCounter = child.payment?.method === 'COUNTER' || child.payment?.method === 'PAY_AT_COUNTER';
                              const childCheckoutDone = Boolean(child.fulfillmentType) && (childIsPaid || childIsCounter);
                              const childCanCheckout = child.status === 'CONFIRMED' && !childCheckoutDone;
                              const childFee = Number(child.platformFee) || 0;

                              return (
                                <div
                                  key={child.id || cIdx}
                                  style={{
                                    background: '#f8faf9',
                                    border: '1px solid #d5e6e0',
                                    borderRadius: 14,
                                    padding: '0.75rem 1rem',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.5rem'
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                      <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>local_pharmacy</span>
                                      <strong style={{ fontSize: 13, color: '#032f28' }}>{child.pharmacy?.name || 'Local Dispensary'}</strong>
                                      <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#717976' }}>#{child.orderNumber}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                      <StatusBadge status={child.status} />
                                      <PaymentBadge payment={child.payment} />
                                      {child.verificationPin && (
                                        <span style={{ fontSize: 11, background: '#ffffff', border: '1px solid #c0c8c5', padding: '1px 6px', borderRadius: 6, fontFamily: 'monospace', fontWeight: 700, color: '#032f28', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                                          PIN: <RollingNumber value={child.verificationPin} />
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', fontSize: 12 }}>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                                      {(child.items || []).map((it, idx) => (
                                        <span key={idx} style={{ background: '#ffffff', border: '1px solid #c0c8c5', padding: '1px 8px', borderRadius: 99, color: '#032f28', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                                          {it.medicine?.brandName || it.brandName || 'Medicine'} ×<RollingNumber value={it.quantity} />
                                        </span>
                                      ))}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                      <span style={{ color: '#717976', fontSize: 11 }}>
                                        Fee: {childFee > 0 ? `₹${childFee.toFixed(2)}` : '₹0.00 (Sibling covered)'}
                                      </span>
                                      {childCanCheckout && (
                                        <button
                                          type="button"
                                          onClick={() => handleOpenCheckout(child.id)}
                                          style={{
                                            padding: '0.35rem 0.85rem',
                                            borderRadius: 99,
                                            background: '#032f28',
                                            color: '#ffffff',
                                            border: 'none',
                                            fontSize: 11,
                                            fontWeight: 700,
                                            cursor: 'pointer',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '0.3rem'
                                          }}
                                        >
                                          <span className="material-symbols-outlined" style={{ fontSize: 13 }}>shopping_cart_checkout</span>
                                          <span>Checkout ({child.pharmacy?.name?.slice(0, 15) || 'Dispensary'})</span>
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem' }}>
                            <div style={{ width: 44, height: 44, borderRadius: 12, background: '#e6f8f1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#032f28', flexShrink: 0 }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 22 }}>local_pharmacy</span>
                            </div>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <h3 style={{ fontSize: 16, fontWeight: 800, color: '#032f28', margin: 0 }}>
                                  {ord.pharmacy?.name || 'Local Community Dispensary'}
                                </h3>
                                <span style={{ fontSize: 11, color: '#2e685d', fontWeight: 700, background: '#e0f2eb', padding: '0.1rem 0.5rem', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                                  <span className="material-symbols-outlined" style={{ fontSize: 12 }}>navigation</span>
                                  0.8 km
                                </span>
                              </div>
                              <p style={{ fontSize: 12, color: '#414846', margin: '0.2rem 0 0 0' }}>
                                {ord.pharmacy?.address || 'Dispensary Location'}
                              </p>
                            </div>
                          </div>

                          {/* Assistant Service Pill for Assistant Fulfillment */}
                          {ord.fulfillmentType === 'ASSISTANT_DELIVERY' && (
                            <div style={{
                              background: '#e0f2eb',
                              borderRadius: 12,
                              padding: '0.65rem 1rem',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              flexWrap: 'wrap',
                              gap: '0.5rem',
                              border: '1px solid #b0ecdd'
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', fontSize: 13 }}>
                                <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#2e685d' }}>support_agent</span>
                                <div>
                                  <span style={{ fontWeight: 800, display: 'block', fontSize: 12, color: '#032f28' }}>Medicine Access Assistant</span>
                                  <span style={{ color: '#1e453e', fontWeight: 700, fontSize: 13 }}>
                                    {getAssistantServiceLabel(ord.assistantServiceType || ord.assistantTask?.serviceType)}
                                  </span>
                                </div>
                              </div>
                              {ord.deliveryAddress && !['DIGITAL_ASSISTANCE', 'PRESCRIPTION_ASSISTANCE', 'PHARMACY_COMMS'].includes(ord.assistantServiceType || ord.assistantTask?.serviceType) && (
                                <div style={{ fontSize: 11, color: '#414846', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                  <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#2e685d' }}>location_on</span>
                                  <span>{ord.deliveryAddress}</span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Items Preview */}
                          <div style={{ background: '#f5faf8', borderRadius: 14, padding: '0.75rem 1rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                            {(ord.items || []).map((it, idx) => (
                              <div key={idx} style={{ background: '#ffffff', border: '1px solid #c0c8c5', borderRadius: 99, padding: '0.25rem 0.75rem', fontSize: 12, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                <span style={{ fontWeight: 700, color: '#032f28' }}>
                                  {it.medicine?.brandName || it.medicine?.name || it.name || 'Medicine'}
                                </span>
                                <span style={{ color: '#717976', display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}>
                                  ×<RollingNumber value={it.quantity} />
                                </span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Actions & Total (4 cols on desktop) */}
                    <div className="col-span-1 md:col-span-4 flex flex-col items-start md:items-end gap-3 pt-3 md:pt-0 border-t md:border-t-0 md:border-l border-[#e6f8f1] md:pl-6">
                      <div style={{ textAlign: 'right' }}>
                        {(() => {
                          const { totalAmount } = calculateOrderPricing(ord);
                          const isPaid = ord.payment?.status === 'PAID';
                          const isCompleted = ord.status === 'COMPLETED';
                          const isPreCheckout = ord.status === 'PENDING' && (Number(ord.totalAmount) === 0) && !isPaid;
                          return (
                            <>
                              <span style={{ display: 'block', fontSize: 11, color: '#717976', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.3px' }}>
                                {isCompleted ? 'Total Amount' : (isPreCheckout ? 'Order Value' : (isPaid ? 'Total Paid' : 'Total Price'))}
                              </span>
                              <span style={{ fontSize: 22, fontWeight: 800, color: '#032f28' }}>
                                <RollingNumber prefix="₹" value={totalAmount.toFixed(2)} />
                              </span>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.25rem', marginTop: '0.25rem' }}>
                                <span style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: '2px 8px',
                                  borderRadius: 99,
                                  background: isPaid ? '#d1fae5' : '#f0fdf4',
                                  color: isPaid ? '#065f46' : '#166534',
                                  border: '1px solid #bbf7d0',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '3px'
                                }}>
                                  <span className="material-symbols-outlined" style={{ fontSize: 12 }}>
                                    {isPaid || isCompleted ? 'check_circle' : 'payments'}
                                  </span>
                                  {isPaid
                                    ? 'Paid Online'
                                    : (isCompleted
                                        ? 'Settled at Counter'
                                        : (ord.orderType === 'ASSISTED_DELIVERY' ? 'Pay upon Delivery' : 'Pay at Counter'))}
                                </span>
                              </div>
                            </>
                          );
                        })()}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%', maxWidth: 220 }}>
                        <button
                          onClick={() => handleOpenTracking(ord)}
                          style={{
                            width: '100%',
                            padding: '0.65rem 1.25rem',
                            borderRadius: 99,
                            background: '#032f28',
                            color: '#ffffff',
                            border: 'none',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.4rem',
                            boxShadow: '0 2px 6px rgba(3,47,40,0.15)'
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>timeline</span>
                          <span>Track Fulfillment Journey</span>
                        </button>

                        {(() => {
                          if (ord.isParentOrder) {
                            return (
                              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '0.45rem 0.65rem', fontSize: 11, color: '#166534', fontWeight: 600, textAlign: 'center' }}>
                                Split aggregate order: checkout each participating dispensary individually above.
                              </div>
                            );
                          }

                          const ordIsPaid = ord.payment?.status === 'PAID';
                          const ordIsCounter = ord.payment?.method === 'COUNTER' || ord.payment?.method === 'PAY_AT_COUNTER';
                          const ordIsCheckoutComplete = Boolean(ord.fulfillmentType) && (ordIsPaid || ordIsCounter);

                          if (ord.status === 'CONFIRMED' && !ordIsCheckoutComplete) {
                            return (
                              <FlowButton
                                fullWidth
                                size="sm"
                                variant="secondary"
                                onClick={() => handleOpenCheckout(ord.id)}
                              >
                                Proceed to Checkout
                              </FlowButton>
                            );
                          }
                          return null;
                        })()}

                        {(() => {
                          const ordIsPaid = ord.payment?.status === 'PAID';
                          const ordIsTerminal = ['COMPLETED', 'CANCELLED', 'REJECTED'].includes(ord.status);
                          const canCancel = ['PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'].includes(ord.status) && !ordIsPaid && !ordIsTerminal;

                          if (canCancel) {
                            return (
                              <button
                                onClick={() => setCancellingOrderId(ord.id)}
                                style={{
                                  width: '100%',
                                  padding: '0.5rem 1rem',
                                  borderRadius: 99,
                                  background: '#ffdad6',
                                  color: '#93000a',
                                  border: 'none',
                                  fontSize: 12,
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '0.35rem'
                                }}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 15 }}>cancel</span>
                                <span>Cancel Reservation</span>
                              </button>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* High-Stakes Action Confirmation Modal */}
      {cancellingOrderId && (
        <ConfirmationDialog
          isOpen={!!cancellingOrderId}
          title="Cancel Medicine Reservation?"
          message="Are you sure you want to cancel this prescription reservation? The allocated inventory hold at the dispensary will be released immediately."
          impactPoints={[
            'The reserved batch stock will be returned to public pharmacy inventory.',
            'Active pickup window and dispensing queue priority will be revoked.',
            'A new prescription screening or reservation must be submitted to re-order.'
          ]}
          confirmText="Yes, Cancel Reservation"
          cancelText="Keep Reservation"
          isDestructive={true}
          onConfirm={() => handleConfirmCancelOrder(cancellingOrderId)}
          onCancel={() => setCancellingOrderId(null)}
        />
      )}

      {/* Floating Action Feedback / Toast Notification */}
      {actionFeedback && (
        <div style={{
          position: 'fixed',
          top: '1.5rem',
          right: '1.5rem',
          zIndex: 9999,
          padding: '1rem 1.25rem',
          borderRadius: 16,
          background: actionFeedback.type === 'error' ? '#ffdad6' : '#e0f2eb',
          color: actionFeedback.type === 'error' ? '#93000a' : '#032f28',
          border: `1px solid ${actionFeedback.type === 'error' ? '#ffb4a8' : '#a6cfc5'}`,
          boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          maxWidth: 440,
          animation: 'fadeIn 0.2s ease-in-out'
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
            {actionFeedback.type === 'error' ? 'error' : 'check_circle'}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{actionFeedback.message}</span>
          <button
            onClick={() => setActionFeedback(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', marginLeft: 'auto', color: 'inherit', display: 'flex', alignItems: 'center' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
          </button>
        </div>
      )}

      {/* Razorpay Checkout Modal */}
      {checkoutOrderId && (
        <CheckoutPage
          orderId={checkoutOrderId}
          onClose={handleCloseCheckout}
          onPaymentSuccess={handlePaymentSuccess}
        />
      )}
    </div>
  );
}
