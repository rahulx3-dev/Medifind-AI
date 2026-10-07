import React, { useState, useEffect, useCallback } from 'react';
import CheckoutPage from '../components/CheckoutPage';
import ConfirmationDialog from '../components/ConfirmationDialog';
import RadialOrbitalTimeline from '../components/RadialOrbitalTimeline';
import { SkeletonMap } from '../components/LoadingSkeleton';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
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

  const medicineSubtotal = (ord.medicineSubtotal != null && Number(ord.medicineSubtotal) > 0)
    ? Number(ord.medicineSubtotal)
    : calculatedMedSubtotal;

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

export default function OrderTracking({ initialOrderId = null, initialCheckoutOrderId = null, onNavigate }) {
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
  const [assistantFlowSimulate, setAssistantFlowSimulate] = useState(false);
  const [confirmingReceipt, setConfirmingReceipt] = useState(false);

  const handleOpenCheckout = (orderId) => {
    setCheckoutOrderId(orderId);
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', `/checkout/${orderId}`);
    }
  };

  const handleCloseCheckout = () => {
    setCheckoutOrderId(null);
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/checkout/')) {
      window.history.pushState(null, '', '/');
    }
    fetchOrders(checkoutOrderId);
  };

  const handlePaymentSuccess = () => {
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/checkout/')) {
      window.history.pushState(null, '', '/');
    }
    fetchOrders(checkoutOrderId);
  };

  const fetchOrderDetails = useCallback(async (orderId) => {
    if (!orderId) return;
    setLoadingDetails(true);
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
      console.error('Failed to load order details:', err);
    } finally {
      setLoadingDetails(false);
    }
  }, []);

  const fetchOrders = useCallback(async (targetSelectId = null) => {
    setLoading(true);
    setError(null);
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch('/api/orders', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        const orderList = data.orders || [];
        setOrders(orderList);

        // '__clear__' sentinel means: refresh list without re-selecting anything
        if (targetSelectId === '__clear__') return;

        const selId = targetSelectId || selectedOrderId || initialOrderId;
        if (selId) {
          const found = orderList.find(o => o.id === selId);
          if (found) {
            setSelectedOrderId(found.id);
            fetchOrderDetails(found.id);
          }
        }
      } else {
        setError(data.error || 'Failed to load orders.');
      }
    } catch (err) {
      setError('Network communication error. Unable to retrieve orders.');
    } finally {
      setLoading(false);
    }
  }, [selectedOrderId, initialOrderId, fetchOrderDetails]);

  useEffect(() => {
    fetchOrders(initialOrderId);
  }, [initialOrderId]);

  useEffect(() => {
    if (!actionFeedback) return;
    const timer = setTimeout(() => setActionFeedback(null), 4000);
    return () => clearTimeout(timer);
  }, [actionFeedback]);

  const handleOpenTracking = (order) => {
    setSelectedOrderId(order.id);
    setSelectedOrderDetails(order);
    fetchOrderDetails(order.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBackToList = () => {
    setSelectedOrderId(null);
    setSelectedOrderDetails(null);
    // Pass '__clear__' sentinel so fetchOrders does NOT re-select the previously
    // viewed order via its stale closure value of selectedOrderId.
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
        setActionFeedback({ type: 'success', message: 'Order reservation cancelled successfully.' });
        setCancellingOrderId(null);
        fetchOrders(orderId);
      } else {
        setActionFeedback({ type: 'error', message: data.error || 'Failed to cancel order.' });
      }
    } catch (err) {
      setActionFeedback({ type: 'error', message: 'Network error cancelling order.' });
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
      } else {
        setActionFeedback({ type: 'error', message: data.error || 'Failed to confirm receipt.' });
      }
    } catch (err) {
      setActionFeedback({ type: 'error', message: 'Network error confirming receipt.' });
    } finally {
      setConfirmingReceipt(false);
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

    // 4 PIN Digits — strictly from server verificationPin, never fallback to fabricated PIN
    const pinStr = (!isTerminal && detailOrder.verificationPin) ? detailOrder.verificationPin : '';
    const pinDigits = pinStr ? pinStr.padEnd(4, '0').slice(0, 4).split('') : ['—', '—', '—', '—'];

    // Journey Steps: 1: Confirmation, 2: Payment, 3: Preparing, 4: Ready, 5: Completed
    let currentStepIndex = 1;
    if (isPending) currentStepIndex = 1;
    else if (isConfirmed && !isPaid) currentStepIndex = 2;
    else if (isConfirmed && isPaid) currentStepIndex = 3;
    else if (isReady) currentStepIndex = 4;
    else if (isCompleted) currentStepIndex = 5;
    else if (isTerminal) currentStepIndex = 0;

    return (
      <div style={{ background: '#ecfdf7', minHeight: '100vh', fontFamily: "'Plus Jakarta Sans', sans-serif", paddingBottom: '4rem' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '1.5rem' }}>

          {/* Top Metadata Breadcrumb & Context Header */}
          <div style={{ paddingTop: '1.5rem', paddingBottom: '1.5rem', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button
                onClick={handleBackToList}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  color: '#2e685d',
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_back</span>
                <span>Back to My Orders</span>
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <h1 style={{ fontSize: 28, fontWeight: 800, color: '#032f28', margin: 0, letterSpacing: '-0.02em' }}>
                  Order Tracking &amp; Fulfillment Journey
                </h1>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#b0ecdd', color: '#336c61', padding: '0.25rem 0.75rem', borderRadius: 99, fontSize: 12, fontWeight: 700 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2e685d' }}></span>
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

          {/* PRIMARY ACTION SYSTEM: Prominent Unambiguous Next Action Hero (Stitch Screen f93a243ff9114238bcdca6e5ef837fc7) */}
          <section style={{
            background: 'linear-gradient(135deg, #032f28 0%, #1e453e 50%, #173731 100%)',
            color: '#ffffff',
            borderRadius: 24,
            padding: '2rem',
            boxShadow: '0 12px 36px rgba(3,47,40,0.18)',
            marginBottom: '2rem',
            position: 'relative',
            overflow: 'hidden'
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '2rem', alignItems: 'center' }}>

              {/* Action Context (7 cols) */}
              <div style={{ gridColumn: 'span 7', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
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
                  <span>{isCancelled ? 'Reservation Cancelled' : isRejected ? 'Reservation Rejected' : isReady ? 'Action Required by You' : isPending ? 'Review In Progress' : 'Live Clinical Status'}</span>
                </div>

                <h2 style={{ fontSize: 32, fontWeight: 800, color: '#ffffff', margin: 0, letterSpacing: '-0.02em' }}>
                  {isCancelled ? 'Reservation Cancelled' : isRejected ? 'Reservation Rejected' : isReady ? 'Ready for Pickup' : isPending ? 'Awaiting Pharmacy Confirmation' : (isConfirmed && !isPaid) ? 'Action Required: Payment Pending' : isCompleted ? 'Dispensation Completed' : 'Prescription Staged & Packing'}
                </h2>

                <p style={{ fontSize: 15, color: '#c1ebe1', margin: 0, lineHeight: 1.5, maxWidth: 540 }}>
                  {isCancelled
                    ? 'This order reservation has been cancelled. No medicines are reserved or staged for pickup.'
                    : isRejected
                    ? 'This reservation request could not be fulfilled by the dispensary and has been marked rejected.'
                    : isReady
                    ? 'Your prescription medicines have been verified, packaged, and quarantined at the dispensary counter. You can collect your order now.'
                    : isPending
                    ? 'The licensed pharmacist is reviewing your prescription and confirming stock allocation.'
                    : (isConfirmed && !isPaid)
                    ? 'Pharmacy has verified stock availability. Complete secure escrow payment to trigger packing.'
                    : isCompleted
                    ? 'Medicines have been handed over and authenticated via secure PIN verification.'
                    : 'Your order is confirmed and currently being batch packaged in a temperature-controlled dispensary bay.'}
                </p>

                {isTerminal ? (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem', background: 'rgba(255,218,214,0.15)', backdropFilter: 'blur(8px)', padding: '0.85rem 1rem', borderRadius: 14, maxWidth: 540 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#ffb4a8', marginTop: 1 }}>block</span>
                    <p style={{ fontSize: 12, color: '#ffdad6', margin: 0, lineHeight: 1.4 }}>
                      {isCancelled ? 'This reservation was cancelled. The pickup token and dispensation bay hold have been voided.' : 'This reservation was rejected by the dispensary. The pickup token has been voided.'}
                    </p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem', background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)', padding: '0.85rem 1rem', borderRadius: 14, maxWidth: 540 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#c1ebe1', marginTop: 1 }}>verified_user</span>
                    <p style={{ fontSize: 12, color: '#c1ebe1', margin: 0, lineHeight: 1.4 }}>
                      Show this PIN and your valid Government/Clinical ID to <strong style={{ color: '#ffffff' }}>Dr. Sarah Vance, PharmD</strong> at <strong style={{ color: '#ffffff' }}>Counter 2</strong>.
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

                  {isConfirmed && !isPaid && (
                    <button
                      onClick={() => handleOpenCheckout(detailOrder.id)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        padding: '0.75rem 1.5rem',
                        borderRadius: 99,
                        background: '#c1ebe1',
                        color: '#00201b',
                        border: 'none',
                        fontSize: 13,
                        fontWeight: 800,
                        cursor: 'pointer',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#032f28' }}>credit_card</span>
                      <span>Proceed to Checkout (Razorpay Test)</span>
                    </button>
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

                  {detailOrder.status === 'PENDING' && (
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

              {/* Distinct 4-Digit Pickup PIN Card (5 cols) */}
              <div style={{ gridColumn: 'span 5', display: 'flex', justifyContent: 'center' }}>
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
                      {isTerminal ? 'TOKEN INACTIVE' : 'DISPENSING TOKEN'}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: isTerminal ? '#93000a' : '#2e685d', background: isTerminal ? '#ffdad6' : '#b0ecdd', padding: '0.15rem 0.55rem', borderRadius: 99 }}>
                      {isTerminal ? 'VOIDED' : 'Bay #04'}
                    </span>
                  </div>

                  <span style={{ fontSize: 12, fontWeight: 600, color: isTerminal ? '#93000a' : '#414846', margin: '0.75rem 0 0.5rem 0' }}>
                    {isTerminal ? `Pickup PIN Voided (${detailOrder.status})` : 'Patient Pickup Verification PIN'}
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
                    <p style={{ fontSize: 11, color: isTerminal ? '#93000a' : '#717976', margin: 0 }}>
                      {isTerminal ? 'Single-use clinical release code has been voided.' : <>Valid today until <strong style={{ color: '#032f28' }}>10:30 PM</strong> • Single-use clinical release code</>}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

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
              {[
                { step: '01', title: 'Pharmacy Confirmation', desc: 'Prescription verified by apothecary', isDone: currentStepIndex > 1, isActive: currentStepIndex === 1 },
                { step: '02', title: 'Payment', desc: `₹${(detailOrder.totalAmount || 0).toFixed(2)} confirmed paid`, isDone: currentStepIndex > 2, isActive: currentStepIndex === 2 },
                { step: '03', title: 'Preparing', desc: 'Medicines checked & batch packaged', isDone: currentStepIndex > 3, isActive: currentStepIndex === 3 },
                { step: '04', title: 'Ready for Pickup', desc: 'Locked in temperature-controlled counter', isDone: currentStepIndex > 4, isActive: currentStepIndex === 4 },
                { step: '05', title: 'Completed', desc: 'Handover confirmed & receipt issued', isDone: currentStepIndex >= 5, isActive: false }
              ].map((st, i) => (
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

          {/* FULFILLMENT DEDICATED VISUAL & CONTEXT (Two-column layout: 7 cols left, 5 cols right) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '1.5rem', marginBottom: '2rem', alignItems: 'start' }}>

            {/* Left Column: Pharmacy Collection Details & Visual Map Anchor (7 cols) */}
            <div style={{ gridColumn: 'span 7', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
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
                    <span style={{ fontWeight: 700, color: '#2e685d' }}>Academic Project Partner</span>
                  </div>
                )}
              </section>
            </div>

            {/* Right Column: Status History & Prescribed Package Summary (5 cols) */}
            <div style={{ gridColumn: 'span 5', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

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
                            <span style={{ fontWeight: 700, color: '#032f28' }}>₹{pricing.platformFee.toFixed(2)}</span>
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
                            {pricing.medicineSubtotal != null
                              ? `₹${pricing.totalAmount.toFixed(2)}`
                              : 'MRP / counter pricing at pharmacy'}
                          </span>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </section>
            </div>
          </div>

          {/* BOTTOM ASSISTANT SERVICE DEMONSTRATION / EXPLANATORY BOX */}
          <section style={{ background: '#e0f2eb', borderRadius: 24, padding: '1.75rem', boxShadow: '0 2px 8px rgba(3,47,40,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid #d5e6e0', paddingBottom: '1rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#032f28', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 22 }}>swap_horizontal_circle</span>
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <h3 style={{ fontSize: 16, fontWeight: 800, color: '#032f28', margin: 0 }}>Medicine Access Assistant Architecture</h3>
                    <span style={{ fontSize: 10, fontWeight: 700, background: '#2e685d', color: '#ffffff', padding: '0.15rem 0.55rem', borderRadius: 99 }}>Tandem Subsystem</span>
                  </div>
                  <p style={{ fontSize: 12, color: '#414846', margin: '0.2rem 0 0 0' }}>
                    Looking for Assistant Service? When selected, AssistantTask progression runs in tandem: <strong style={{ color: '#032f28' }}>Available → Accepted → In Progress → Handover → Confirmed</strong>.
                  </p>
                </div>
              </div>

              {/* Mode Toggle Trigger */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: '#ffffff', padding: '0.25rem', borderRadius: 99, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <button
                  onClick={() => setAssistantFlowSimulate(false)}
                  style={{
                    padding: '0.35rem 0.95rem',
                    borderRadius: 99,
                    border: 'none',
                    background: !assistantFlowSimulate ? '#032f28' : 'transparent',
                    color: !assistantFlowSimulate ? '#ffffff' : '#414846',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Counter Pickup (Active)
                </button>
                <button
                  onClick={() => setAssistantFlowSimulate(true)}
                  style={{
                    padding: '0.35rem 0.95rem',
                    borderRadius: 99,
                    border: 'none',
                    background: assistantFlowSimulate ? '#032f28' : 'transparent',
                    color: assistantFlowSimulate ? '#ffffff' : '#414846',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Simulate Assistant Service Flow
                </button>
              </div>
            </div>

            {/* 6 Step Progression Pipeline */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem' }}>
              {(() => {
                const sType = detailOrder?.assistantServiceType || detailOrder?.assistantTask?.serviceType;
                const isDelivery = sType === 'MEDICINE_DELIVERY';
                const isCollection = sType === 'MEDICINE_COLLECTION';

                const steps = isDelivery ? [
                  { step: 1, title: 'Available', desc: 'Task broadcast to fleet' },
                  { step: 2, title: 'Accepted', desc: 'Assistant assigned' },
                  { step: 3, title: 'Collecting', desc: 'Pickup at pharmacy' },
                  { step: 4, title: 'In Transit', desc: 'En route to destination' },
                  { step: 5, title: 'Delivered', desc: 'Arrived at delivery address' },
                  { step: 6, title: 'Confirmed', desc: 'Handover PIN verified' }
                ] : isCollection ? [
                  { step: 1, title: 'Available', desc: 'Task broadcast to fleet' },
                  { step: 2, title: 'Accepted', desc: 'Assistant assigned' },
                  { step: 3, title: 'Collecting', desc: 'Pickup at pharmacy' },
                  { step: 4, title: 'In Transit', desc: 'Ready for handover' },
                  { step: 5, title: 'Delivered', desc: 'Ready at handover point' },
                  { step: 6, title: 'Confirmed', desc: 'Handover PIN verified' }
                ] : [
                  { step: 1, title: 'Available', desc: 'Task broadcast to fleet' },
                  { step: 2, title: 'Accepted', desc: 'Assistant assigned' },
                  { step: 3, title: 'Collecting', desc: 'Service initiated' },
                  { step: 4, title: 'In Transit', desc: 'Assistance in progress' },
                  { step: 5, title: 'Delivered', desc: 'Assistance rendered' },
                  { step: 6, title: 'Confirmed', desc: 'Service confirmed with PIN' }
                ];

                return steps.map(p => (
                  <div key={p.step} style={{ background: '#ffffff', borderRadius: 12, padding: '0.75rem', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
                    <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#dbece5', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#032f28', marginBottom: '0.35rem' }}>
                      {p.step}
                    </span>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#032f28' }}>{p.title}</div>
                    <div style={{ fontSize: 10, color: '#717976', marginTop: '0.15rem' }}>{p.desc}</div>
                  </div>
                ));
              })()}
            </div>
          </section>

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
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '1.5rem' }}>

        {/* Header & Clinical Overview Row */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#b0ecdd', color: '#2e685d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>verified</span>
                </span>
                <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#2e685d' }}>
                  VERIFIED PATIENT PORTAL
                </span>
              </div>
              <h1 style={{ fontSize: 36, fontWeight: 800, color: '#032f28', margin: 0, letterSpacing: '-0.02em' }}>
                My Orders
              </h1>
              <p style={{ fontSize: 14, color: '#414846', margin: '0.35rem 0 0 0', maxWidth: 640 }}>
                Track your verified medicine requests, fulfillment timelines, and dispensations across our clinical network.
              </p>
            </div>

            {/* Clinical Network Badge */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: '#ffffff', border: '1px solid #c0c8c5', padding: '0.45rem 1rem', borderRadius: 99, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#2e685d' }}></div>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#032f28' }}>Pharmacy Network Live</span>
              <span style={{ color: '#c0c8c5' }}>•</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#2e685d', background: '#e0f2eb', padding: '0.1rem 0.45rem', borderRadius: 99 }}>
                Encrypted
              </span>
            </div>
          </div>

          {/* 4 Metric Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
            {/* Metric 1: Active Orders */}
            <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.25rem', border: '1px solid #e0f2eb', boxShadow: '0 2px 8px rgba(3,47,40,0.04)', position: 'relative', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: '#b0ecdd', color: '#2e685d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 24 }}>timelapse</span>
                </div>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#032f28', lineHeight: 1 }}>{activeOrdersCount}</div>
                  <div style={{ fontSize: 12, color: '#717976', marginTop: '0.25rem' }}>Active Orders</div>
                </div>
              </div>
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, background: '#2e685d' }}></div>
            </div>

            {/* Metric 2: Awaiting Confirmation */}
            <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.25rem', border: '1px solid #e0f2eb', boxShadow: '0 2px 8px rgba(3,47,40,0.04)', position: 'relative', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: '#e0f2eb', color: '#717976', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 24 }}>hourglass_empty</span>
                </div>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#032f28', lineHeight: 1 }}>{pendingCount}</div>
                  <div style={{ fontSize: 12, color: '#717976', marginTop: '0.25rem' }}>Awaiting Confirmation</div>
                </div>
              </div>
            </div>

            {/* Metric 3: Ready for Pickup */}
            <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.25rem', border: '1px solid #e0f2eb', boxShadow: '0 2px 8px rgba(3,47,40,0.04)', position: 'relative', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: '#c1ebe1', color: '#032f28', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 24 }}>storefront</span>
                </div>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#032f28', lineHeight: 1 }}>{readyCount}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#2e685d', marginTop: '0.25rem' }}>Ready for Pickup</div>
                </div>
              </div>
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 4, background: '#c1ebe1' }}></div>
            </div>

            {/* Metric 4: Completed */}
            <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.25rem', border: '1px solid #e0f2eb', boxShadow: '0 2px 8px rgba(3,47,40,0.04)', position: 'relative', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: '#dbece5', color: '#414846', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 24 }}>task_alt</span>
                </div>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#032f28', lineHeight: 1 }}>{completedCount}</div>
                  <div style={{ fontSize: 12, color: '#717976', marginTop: '0.25rem' }}>Completed</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Filter & Search Control Bar */}
        <section style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
          {/* Search Input */}
          <div style={{ position: 'relative', flex: 1, minWidth: 280, maxWidth: 440 }}>
            <span className="material-symbols-outlined" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#717976', fontSize: 18 }}>
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search order reference or pharmacy..."
              style={{
                width: '100%',
                padding: '0.65rem 1rem 0.65rem 2.65rem',
                borderRadius: 99,
                background: '#ffffff',
                border: '1px solid #c0c8c5',
                fontSize: 13,
                color: '#032f28',
                outline: 'none',
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
              }}
            />
          </div>

          {/* Filter Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', overflowX: 'auto', background: '#e0f2eb', padding: '0.35rem', borderRadius: 99 }}>
            {[
              { id: 'ALL', label: `All (${orders.length})` },
              { id: 'ACTIVE', label: `Active (${activeOrdersCount})` },
              { id: 'COMPLETED', label: `Completed (${completedCount})` },
              { id: 'CANCELLED', label: `Cancelled (${cancelledCount})` },
              { id: 'REJECTED', label: `Rejected (${rejectedCount})` }
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
                  whiteSpace: 'nowrap'
                }}
              >
                {f.label}
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
              const isPaid = ord.payment?.status === 'PAID';
              const pin = ord.verificationPin;

              return (
                <article
                  key={ord.id}
                  style={{
                    background: '#ffffff',
                    borderRadius: 20,
                    border: '1px solid #e0f2eb',
                    boxShadow: '0 2px 10px rgba(3,47,40,0.04)',
                    overflow: 'hidden',
                    position: 'relative'
                  }}
                >
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    bottom: 0,
                    width: 6,
                    background: isReady ? '#2e685d' : isConfirmed ? '#336c61' : '#c0c8c5'
                  }} />

                  {/* Top Metadata Header Strip */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '0.75rem',
                    padding: '1rem 1.5rem 1rem 1.75rem',
                    background: '#f8faf9',
                    borderBottom: '1px solid #e6f8f1'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 15, fontWeight: 800, color: '#032f28' }}>
                        Order #{ord.orderNumber || ord.id.slice(0, 10).toUpperCase()}
                      </span>
                      <StatusBadge status={ord.status} />
                      <PaymentBadge payment={ord.payment} />
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
                      <span style={{ fontSize: 11, color: '#717976' }}>•</span>
                      <span style={{ fontSize: 12, color: '#717976' }}>
                        {new Date(ord.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    {/* Pickup PIN Capsule */}
                    {pin && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: '#ffffff', padding: '0.3rem 0.85rem', borderRadius: 99, border: '1px solid #c0c8c5', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>pin</span>
                        <span style={{ fontSize: 11, color: '#717976', fontWeight: 600 }}>Secure PIN:</span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: '#032f28', fontFamily: 'monospace', letterSpacing: '0.1em' }}>
                          {pin}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Middle Content Split */}
                  <div style={{ padding: '1.5rem 1.5rem 1.5rem 1.75rem', display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '1.5rem', alignItems: 'center' }}>

                    {/* Pharmacy & Items (8 cols) */}
                    <div style={{ gridColumn: 'span 8', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
                            <span style={{ color: '#717976' }}>×{it.quantity}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Actions & Total (4 cols) */}
                    <div style={{ gridColumn: 'span 4', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.75rem', borderLeft: '1px solid #e6f8f1', paddingLeft: '1.5rem' }}>
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
                                ₹{totalAmount.toFixed(2)}
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

                        {isConfirmed && !isPaid && (
                          <button
                            onClick={() => handleOpenCheckout(ord.id)}
                            style={{
                              width: '100%',
                              padding: '0.55rem 1rem',
                              borderRadius: 99,
                              background: '#c1ebe1',
                              color: '#00201b',
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
                            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>credit_card</span>
                            <span>Checkout &amp; Pay</span>
                          </button>
                        )}

                        {ord.status === 'PENDING' && (
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
                        )}
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
