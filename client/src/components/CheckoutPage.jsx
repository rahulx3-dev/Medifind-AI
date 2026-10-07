/**
 * MediFind AI — Checkout & Payment Component (Clinical Sage Design)
 *
 * SECURITY:
 * - RAZORPAY_KEY_SECRET is NEVER sent to this component.
 * - Only razorpayKeyId (public key) is used here.
 * - Amount is always from backend calculation.
 * - Payment identifiers sent to verify-payment are exactly what Razorpay returns.
 * - Payment is blocked when offline with a clear message.
 */

import React, { useState, useEffect, useCallback } from 'react';
import FlowButton from './FlowButton';

const FULFILLMENT_OPTIONS = [
  {
    value: 'PICKUP',
    label: 'Counter Pickup',
    description: 'Collect your medicines at the pharmacy counter. Free of charge.',
    icon: 'storefront',
    requiresAddress: false
  },
  {
    value: 'DELIVERY',
    label: 'Pharmacy Delivery',
    description: 'Selected pharmacy delivers directly to your address.',
    icon: 'local_shipping',
    requiresAddress: true
  },
  {
    value: 'ASSISTANT_DELIVERY',
    label: 'Medicine Access Assistant',
    description: 'A registered MediFind Assistant provides non-clinical support — medicine collection, pharmacy visits, companion, delivery, or digital assistance.',
    icon: 'support_agent',
    requiresAddress: true
  }
];

function getFulfillmentFeeInfo(optValue, checkout) {
  if (optValue === 'PICKUP') return { fee: 0, label: 'Free' };
  if (optValue === 'DELIVERY') {
    const fee = checkout?.totals?.deliveryFee ?? checkout?.deliveryFee ?? (checkout?.totals?.fulfillmentFee && checkout?.fulfillmentType === 'DELIVERY' ? checkout.totals.fulfillmentFee : 0);
    return { fee, label: fee > 0 ? `₹${fee.toFixed(2)}` : 'Free' };
  }
  if (optValue === 'ASSISTANT_DELIVERY') {
    const fee = checkout?.totals?.fulfillmentFee && checkout?.fulfillmentType === 'ASSISTANT_DELIVERY' ? checkout.totals.fulfillmentFee : 80;
    return { fee, label: `₹${fee.toFixed(2)}` };
  }
  return { fee: 0, label: 'Free' };
}

// Non-clinical service types for Medicine Access Assistant
const ASSISTANT_SERVICE_TYPES = [
  {
    value: 'MEDICINE_COLLECTION',
    label: 'Medicine Collection',
    icon: 'medication',
    description: 'Collect your reserved medicines from the pharmacy on your behalf.'
  },
  {
    value: 'PHARMACY_VISIT',
    label: 'Pharmacy Visit',
    icon: 'store',
    description: 'Visit the pharmacy on your behalf to complete a pharmacy-access task.'
  },
  {
    value: 'PHARMACY_COMPANION',
    label: 'Pharmacy Companion',
    icon: 'group',
    description: 'Accompany you to the pharmacy — ideal for elderly or mobility-impaired patients.'
  },
  {
    value: 'MEDICINE_DELIVERY',
    label: 'Medicine Delivery',
    icon: 'home_pin',
    description: 'Collect your reserved medicines and assist with delivery to your location.'
  },
  {
    value: 'DIGITAL_ASSISTANCE',
    label: 'MediFind Digital Assistance',
    icon: 'devices',
    description: 'Help navigating the MediFind platform, uploading documents, or tracking orders.'
  },
  {
    value: 'PHARMACY_COMMS',
    label: 'Pharmacy Communication',
    icon: 'forum',
    description: 'Assist with non-clinical communication with the participating pharmacy.'
  },
  {
    value: 'RESTOCK_ASSISTANCE',
    label: 'Restock / Availability Help',
    icon: 'inventory',
    description: 'Assist with the medicine availability or restock inquiry process.'
  },
  {
    value: 'PRESCRIPTION_ASSISTANCE',
    label: 'Prescription Upload Assistance',
    icon: 'upload_file',
    description: 'Help capture or upload a prescription document. The assistant does not interpret or modify it.'
  }
];

// Service types that do NOT require a physical patient address
const NON_ADDRESS_SERVICE_TYPES = ['DIGITAL_ASSISTANCE', 'PRESCRIPTION_ASSISTANCE', 'PHARMACY_COMMS'];

// Return human-readable label for a service type enum value
function getAssistantServiceLabel(value) {
  const found = ASSISTANT_SERVICE_TYPES.find(s => s.value === value);
  return found ? found.label : (value?.replace(/_/g, ' ') || 'Assistant Service');
}

export default function CheckoutPage({ orderId, onClose, onPaymentSuccess }) {
  const [step, setStep] = useState('loading');
  const [checkout, setCheckout] = useState(null);
  const [selectedFulfillment, setSelectedFulfillment] = useState(null);
  const [selectedServiceType, setSelectedServiceType] = useState(null);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState(null);
  const [isAddingNewAddress, setIsAddingNewAddress] = useState(false);
  const [newAddressForm, setNewAddressForm] = useState({
    label: 'Home',
    addressLine1: '',
    addressLine2: '',
    landmark: '',
    city: 'Chengannur',
    state: 'Kerala',
    postalCode: '689121'
  });
  const [availableAssistants, setAvailableAssistants] = useState([]);
  const [selectedAssistantId, setSelectedAssistantId] = useState(null);
  const [loadingAssistants, setLoadingAssistants] = useState(false);
  const [error, setError] = useState(null);
  const [paymentData, setPaymentData] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const token = localStorage.getItem('medifind_token');

  const fetchCheckout = useCallback(async () => {
    setStep('loading');
    setError(null);
    try {
      const res = await fetch(`/api/checkout/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Failed to load checkout.');
        setStep('error');
        return;
      }
      setCheckout(data.checkout);
      const c = data.checkout;
      if (c.payment?.status === 'PAID') {
        setStep('success');
        setPaymentData(c.payment);
      } else if (c.payment?.status === 'FAILED') {
        setStep('failed');
        setPaymentData(c.payment);
      } else if (c.fulfillmentType) {
        setSelectedFulfillment(c.fulfillmentType);
        if (c.assistantServiceType) {
          setSelectedServiceType(c.assistantServiceType);
        }
        setDeliveryAddress(c.deliveryAddress || '');
        setStep('payment');
      } else {
        setStep('fulfillment');
      }
    } catch (err) {
      setError('Network error. Please check your connection.');
      setStep('error');
    }
  }, [orderId, token]);

  useEffect(() => {
    if (!orderId) return;
    fetchCheckout();
  }, [fetchCheckout]);

  useEffect(() => {
    async function fetchAddresses() {
      if (!token) return;
      try {
        const res = await fetch('/api/addresses', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success && Array.isArray(data.addresses) && data.addresses.length > 0) {
          setSavedAddresses(data.addresses);
          const defaultAddr = data.addresses.find(a => a.isDefault) || data.addresses[0];
          if (defaultAddr && !deliveryAddress) {
            setSelectedAddressId(defaultAddr.id);
            const formatted = `${defaultAddr.addressLine1}${defaultAddr.addressLine2 ? ', ' + defaultAddr.addressLine2 : ''}${defaultAddr.landmark ? ', Near ' + defaultAddr.landmark : ''}, ${defaultAddr.city}, ${defaultAddr.state} - ${defaultAddr.postalCode}`;
            setDeliveryAddress(formatted);
          }
        }
      } catch (e) {
        console.error('Failed to load saved addresses:', e);
      }
    }
    fetchAddresses();
  }, [token]);

  useEffect(() => {
    if (selectedFulfillment !== 'ASSISTANT_DELIVERY' || !selectedServiceType || !token) {
      setAvailableAssistants([]);
      return;
    }
    async function fetchAssistants() {
      setLoadingAssistants(true);
      try {
        const res = await fetch(`/api/assistant/discover?serviceType=${selectedServiceType}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success && Array.isArray(data.assistants)) {
          setAvailableAssistants(data.assistants);
        }
      } catch (e) {
        console.error('Failed to load available assistants:', e);
      } finally {
        setLoadingAssistants(false);
      }
    }
    fetchAssistants();
  }, [selectedFulfillment, selectedServiceType, token]);

  async function handleFulfillmentSelect() {
    if (!navigator.onLine) { setStep('offline'); return; }
    if (!selectedFulfillment) { setError('Please select a fulfillment option.'); return; }
    // Address is required for DELIVERY and ASSISTANT_DELIVERY physical services
    // (NOT required for DIGITAL_ASSISTANCE, PRESCRIPTION_ASSISTANCE, PHARMACY_COMMS)
    const assistantNeedsAddress = selectedFulfillment === 'ASSISTANT_DELIVERY' &&
      !NON_ADDRESS_SERVICE_TYPES.includes(selectedServiceType);
    const option = FULFILLMENT_OPTIONS.find(o => o.value === selectedFulfillment);
    const needsAddress = selectedFulfillment === 'DELIVERY' || assistantNeedsAddress;
    if (needsAddress && (!deliveryAddress || deliveryAddress.trim() === '')) {
      setError('Please enter a service location address.');
      return;
    }
    if (selectedFulfillment === 'ASSISTANT_DELIVERY') {
      if (!selectedServiceType) {
        setError('Please select the type of service you need from your Medicine Access Assistant.');
        return;
      }
      if (!selectedAssistantId) {
        setError('Please select a specific Medicine Access Assistant for this service.');
        return;
      }
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const body = {
        fulfillmentType: selectedFulfillment,
        deliveryAddress: deliveryAddress.trim() || undefined,
        addressId: selectedAddressId || undefined,
        assistantId: selectedAssistantId || undefined
      };
      if (selectedFulfillment === 'ASSISTANT_DELIVERY') {
        body.assistantServiceType = selectedServiceType;
      }
      const res = await fetch(`/api/checkout/${orderId}/fulfillment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!data.success) { setError(data.error || 'Failed to set fulfillment.'); return; }
      setCheckout(prev => ({ ...prev, fulfillmentType: selectedFulfillment, deliveryAddress: deliveryAddress.trim() || null, totals: data.totals }));
      setStep('payment');
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePayNow() {
    if (!navigator.onLine) { setStep('offline'); return; }
    const totals = getTotals();
    if (totals?.medicineSubtotal == null || totals?.totalAmount == null) {
      setError('Online payment is not available because medicine prices must be confirmed at the pharmacy counter. Please pay at the pharmacy counter upon pickup.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const createRes = await fetch(`/api/checkout/${orderId}/create-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      });
      const createData = await createRes.json();
      if (!createData.success) {
        if (createData.configurationRequired) {
          setError('Online payment is not configured. Please contact the administrator to set up Razorpay test credentials.');
        } else {
          setError(createData.error || 'Failed to initiate payment.');
        }
        setStep('payment');
        return;
      }
      const { gatewayOrderId, amount, currency } = createData.payment;
      const razorpayKeyId = createData.razorpayKeyId;
      if (!razorpayKeyId) {
        setError('Razorpay key ID is not configured. Please add RAZORPAY_KEY_ID to the server environment.');
        return;
      }
      if (!window.Razorpay) { await loadRazorpayScript(); }
      setStep('processing');
      const options = {
        key: razorpayKeyId,
        amount: Math.round(amount * 100),
        currency: currency || 'INR',
        name: 'MediFind AI',
        description: `Order #${checkout?.orderNumber}`,
        order_id: gatewayOrderId,
        handler: async function(response) { await handlePaymentSuccess(response); },
        modal: { ondismiss: function() { setStep('payment'); setError('Payment was cancelled. You can try again.'); } },
        prefill: {},
        theme: { color: '#032f28' }
      };
      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', async function(response) {
        setStep('failed');
        setError(`Payment failed: ${response.error.description || 'Unknown error'}. You can retry.`);
      });
      rzp.open();
    } catch (err) {
      setError('Failed to open payment gateway. Please try again.');
      setStep('payment');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePaymentSuccess(razorpayResponse) {
    if (!navigator.onLine) { setStep('offline'); return; }
    setStep('processing');
    try {
      const verifyRes = await fetch(`/api/checkout/${orderId}/verify-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          razorpay_order_id: razorpayResponse.razorpay_order_id,
          razorpay_payment_id: razorpayResponse.razorpay_payment_id,
          razorpay_signature: razorpayResponse.razorpay_signature
        })
      });
      const verifyData = await verifyRes.json();
      if (verifyData.success) {
        setPaymentData(verifyData.payment);
        setStep('success');
        if (onPaymentSuccess) onPaymentSuccess();
      } else {
        setError(verifyData.error || 'Payment verification failed.');
        setStep('failed');
      }
    } catch (err) {
      setError('Network error during payment verification. Please contact support with your payment ID.');
      setStep('failed');
    }
  }

  async function handleRetryPayment() {
    if (!navigator.onLine) { setStep('offline'); return; }
    setIsSubmitting(true);
    setError(null);
    try {
      const retryRes = await fetch(`/api/checkout/${orderId}/retry-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      });
      const retryData = await retryRes.json();
      if (!retryData.success) { setError(retryData.error || 'Failed to retry payment.'); return; }
      await fetchCheckout();
      setStep('payment');
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function loadRazorpayScript() {
    return new Promise((resolve, reject) => {
      if (document.getElementById('razorpay-script')) { resolve(); return; }
      const script = document.createElement('script');
      script.id = 'razorpay-script';
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load Razorpay script'));
      document.head.appendChild(script);
    });
  }

  function getTotals() {
    if (checkout?.totals) {
      return {
        ...checkout.totals,
        platformFee: checkout.totals.platformFee != null ? checkout.totals.platformFee : 2.0,
        requiresCounterPayment: checkout.totals.medicineSubtotal == null || checkout.totals.totalAmount == null
      };
    }
    if (!checkout?.items) return null;
    const allPriced = checkout.items.length > 0 && checkout.items.every(i => i.unitPrice != null && Number(i.unitPrice) > 0);
    const medicineSubtotal = allPriced
      ? checkout.items.reduce((s, i) => s + (Number(i.unitPrice || 0) * Number(i.quantity || 1)), 0)
      : null;
    const ft = selectedFulfillment || checkout.fulfillmentType || 'PICKUP';
    const opt = FULFILLMENT_OPTIONS.find(o => o.value === ft);
    const fulfillmentFee = opt?.fee || 0;
    const platformFee = 2.0;
    const totalAmount = medicineSubtotal != null
      ? parseFloat((medicineSubtotal + fulfillmentFee + platformFee).toFixed(2))
      : null;
    return {
      medicineSubtotal: medicineSubtotal != null ? parseFloat(medicineSubtotal.toFixed(2)) : null,
      fulfillmentFee,
      platformFee,
      totalAmount,
      currency: 'INR',
      requiresCounterPayment: medicineSubtotal === null
    };
  }

  // Common card wrapper styles
  const overlayStyle = {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: 'rgba(3,47,40,0.65)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
  };
  const panelStyle = {
    background: '#ffffff', border: '1px solid #e0f2eb',
    borderRadius: 24, width: '100%', maxWidth: 580,
    maxHeight: '92vh', overflowY: 'auto',
    boxShadow: '0 24px 64px -12px rgba(3,47,40,0.25)'
  };

  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>

        {/* Progress Header */}
        <div style={{ background: '#e0f2eb', padding: '0.75rem 1.5rem', borderRadius: '24px 24px 0 0', borderBottom: '1px solid #c0c8c5' }}>
          <nav style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 12, fontWeight: 600, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#2e685d' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, fontVariationSettings: "'FILL' 1" }}>check_circle</span>
              Pharmacy Confirmed
            </div>
            <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#c0c8c5' }}>chevron_right</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: '#1e453e', color: '#8ab2a9', padding: '3px 12px', borderRadius: 99 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#a6cfc5' }}></span>
              {step === 'fulfillment' ? 'Fulfillment (Active)' : step === 'payment' || step === 'processing' ? 'Payment (Active)' : 'Checkout'}
            </div>
            <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#c0c8c5' }}>chevron_right</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', opacity: 0.6, color: '#414846' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>radio_button_unchecked</span>
              {step === 'success' ? 'Confirmed' : 'Confirmation (Next)'}
            </div>
          </nav>
        </div>

        {/* Panel Header */}
        <div style={{ padding: '1.5rem 1.5rem 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', borderBottom: '1px solid #e0f2eb', paddingBottom: '1rem', marginBottom: '0' }}>
          <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#032f28', margin: 0 }}>
                {step === 'success' ? 'Payment Confirmed' :
                 step === 'failed' ? 'Payment Failed' :
                 step === 'processing' ? 'Processing Payment...' :
                 step === 'fulfillment' ? 'Checkout & Fulfillment Selection' :
                 'Complete Payment'}
              </h2>
              {step === 'fulfillment' && (
                <span style={{ fontSize: 11, fontWeight: 700, background: '#b0ecdd', color: '#336c61', padding: '2px 10px', borderRadius: 99 }}>
                  CONFIRMED DISPENSARY RESERVATION
                </span>
              )}
            </div>
            {checkout && step !== 'success' && step !== 'failed' && (
              <p style={{ fontSize: 13, color: '#414846', marginTop: '0.35rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
                <span>Order confirmed by <strong style={{ color: '#032f28' }}>{checkout.pharmacy?.name}</strong></span>
                <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#c0c8c5', display: 'inline-block' }}></span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: '#e0f2eb', color: '#032f28', padding: '1px 8px', borderRadius: 6 }}>
                  Ref #{checkout.orderNumber}
                </span>
              </p>
            )}
          </div>
          {step !== 'processing' && (
            <button
              onClick={onClose}
              style={{ background: '#e6f8f1', border: '1px solid #c0c8c5', borderRadius: 99, padding: '0.35rem 0.75rem', color: '#414846', cursor: 'pointer', fontSize: 13, fontWeight: 600, flexShrink: 0 }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle' }}>close</span>
            </button>
          )}
        </div>

        <div style={{ padding: '1.5rem' }}>

          {/* ── Loading ── */}
          {step === 'loading' && (
            <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid #b0ecdd', borderTopColor: '#2e685d', animation: 'co-spin 1s linear infinite', margin: '0 auto 1rem' }} />
              <style>{`@keyframes co-spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`}</style>
              <p style={{ color: '#414846' }}>Loading checkout...</p>
            </div>
          )}

          {/* ── Error ── */}
          {step === 'error' && (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#ffdad6', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 28, color: '#ba1a1a' }}>error</span>
              </div>
              <p style={{ color: '#93000a', marginBottom: '1.5rem', fontSize: 14 }}>{error}</p>
              <button onClick={fetchCheckout} style={{ padding: '0.65rem 1.5rem', borderRadius: 99, background: '#032f28', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>
                Retry
              </button>
            </div>
          )}

          {/* ── Offline ── */}
          {step === 'offline' && (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#ffdad6', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 28, color: '#ba1a1a' }}>wifi_off</span>
              </div>
              <h3 style={{ color: '#032f28', fontSize: 18, fontWeight: 700, marginBottom: '0.5rem' }}>No Internet Connection</h3>
              <p style={{ color: '#414846', fontSize: 14, marginBottom: '1.5rem' }}>Payment requires an active internet connection.</p>
              <button onClick={() => { if (navigator.onLine) setStep('payment'); }} style={{ padding: '0.65rem 1.5rem', borderRadius: 99, background: '#032f28', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>
                Check Connection
              </button>
            </div>
          )}

          {/* ── Processing ── */}
          {step === 'processing' && (
            <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
              <div style={{ width: 52, height: 52, borderRadius: '50%', border: '4px solid #b0ecdd', borderTopColor: '#2e685d', animation: 'co-spin 1s linear infinite', margin: '0 auto 1.25rem' }} />
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#032f28', marginBottom: '0.5rem' }}>Verifying Payment...</h3>
              <p style={{ fontSize: 14, color: '#414846' }}>Please do not close this window.</p>
            </div>
          )}

          {/* ── Fulfillment Selection ── */}
          {step === 'fulfillment' && checkout && (
            <div>
              {/* Pharmacy Card */}
              <div style={{ background: '#e6f8f1', border: '1px solid #b0ecdd', borderRadius: 16, padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#b0ecdd', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 22, color: '#2e685d' }}>local_pharmacy</span>
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: '#032f28' }}>{checkout.pharmacy?.name}</span>
                      {checkout.pharmacy?.isTestRecord ? (
                        <span style={{ fontSize: 11, fontWeight: 600, background: '#fef3c7', color: '#92400e', padding: '1px 8px', borderRadius: 99, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          TEST DATA
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, fontWeight: 600, background: '#e0f2eb', color: '#2e685d', padding: '1px 8px', borderRadius: 99, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          Participating Pharmacy
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2e685d' }}></span>
                      <span style={{ fontSize: 12, color: '#2e685d', fontWeight: 600 }}>Reservation Confirmed</span>
                      {checkout.pharmacy?.isTestRecord && (
                        <span style={{ fontSize: 12, color: '#717976', fontFamily: 'var(--font-mono)' }}>NOT A PARTICIPATING PHARMACY</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Order Items */}
              <div style={{ background: '#fff', border: '1px solid #e0f2eb', borderRadius: 16, padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#032f28' }}>medication</span>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: '#032f28', margin: 0 }}>
                    Confirmed Prescriptions ({checkout.items?.length || 0} items)
                  </h3>
                  <span style={{ fontSize: 11, fontWeight: 700, background: '#e0f2eb', color: '#2e685d', padding: '1px 8px', borderRadius: 99, marginLeft: 'auto' }}>
                    Dispense Lock Active
                  </span>
                </div>
                {checkout.items?.map((item, idx) => {
                  const bName = item.brandName || item.medicine?.brandName || item.medicine?.name || item.name || 'Prescription Medicine';
                  const hasPrice = item.unitPrice != null && Number(item.unitPrice) > 0;
                  const uPrice = hasPrice ? Number(item.unitPrice) : null;
                  const qty = Number(item.quantity || 1);
                  return (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 0.75rem', background: '#e6f8f1', borderRadius: 10, marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#032f28' }}>pill</span>
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: '#0f1e1b' }}>{bName}</div>
                          <div style={{ fontSize: 12, color: '#414846' }}>
                            Qty: {qty} • {uPrice != null ? `₹${uPrice.toFixed(2)} each` : 'MRP / counter pricing at pharmacy'}
                          </div>
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: '#032f28' }}>
                        {uPrice != null ? `₹${(qty * uPrice).toFixed(2)}` : 'MRP / counter pricing at pharmacy'}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Fulfillment Options */}
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#032f28', marginBottom: '0.75rem' }}>How would you like to receive your medicine?</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '1rem' }}>
                {FULFILLMENT_OPTIONS.filter(opt => opt.value !== 'DELIVERY' || checkout.pharmacy?.deliveryAvailable).map(opt => {
                  const isSelected = selectedFulfillment === opt.value;
                  return (
                    <div
                      key={opt.value}
                      onClick={() => {
                        setSelectedFulfillment(opt.value);
                        setError(null);
                      }}
                      style={{
                        padding: '1rem 1.25rem', borderRadius: 14,
                        cursor: 'pointer',
                        border: isSelected ? '2px solid #032f28' : '1.5px solid #e0f2eb',
                        background: isSelected ? '#e6f8f1' : '#fff',
                        display: 'flex', alignItems: 'center', gap: '1rem',
                        transition: 'all 0.15s'
                      }}
                    >
                      <div style={{ width: 44, height: 44, borderRadius: '50%', background: isSelected ? '#1e453e' : '#e0f2eb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 22, color: isSelected ? '#8ab2a9' : '#2e685d' }}>{opt.icon}</span>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 15, color: '#032f28' }}>
                          {opt.label}
                        </div>
                        <div style={{ fontSize: 12, color: '#414846', marginTop: '0.2rem' }}>
                          {opt.description}
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 16, color: '#2e685d', whiteSpace: 'nowrap' }}>
                        {getFulfillmentFeeInfo(opt.value, checkout).label}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Non-clinical Disclaimer & Service Type Selector for ASSISTANT_DELIVERY */}
              {selectedFulfillment === 'ASSISTANT_DELIVERY' && (
                <div style={{ marginBottom: '1rem' }}>
                  {/* Disclaimer */}
                  <div style={{
                    background: '#fffbeb',
                    border: '1.5px solid #fde68a',
                    borderRadius: 12,
                    padding: '0.75rem 1rem',
                    marginBottom: '0.75rem',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.6rem'
                  }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#92400e', flexShrink: 0, marginTop: 1 }}>info</span>
                    <p style={{ margin: 0, fontSize: 12, color: '#78350f', lineHeight: 1.5 }}>
                      <strong>Non-Clinical Service Only.</strong> Medicine Access Assistants provide non-clinical assistance only. They do not diagnose, prescribe, change medicines, or provide medical advice.
                    </p>
                  </div>

                  {/* Service Type Selector */}
                  <h4 style={{ fontSize: 13, fontWeight: 700, color: '#032f28', margin: '0 0 0.5rem 0' }}>
                    Select Service Type <span style={{ color: '#ba1a1a' }}>*</span>
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {ASSISTANT_SERVICE_TYPES.map(svc => {
                      const isSvcSelected = selectedServiceType === svc.value;
                      return (
                        <div
                          key={svc.value}
                          onClick={() => { setSelectedServiceType(svc.value); setError(null); }}
                          style={{
                            padding: '0.75rem 1rem',
                            borderRadius: 12,
                            cursor: 'pointer',
                            border: isSvcSelected ? '2px solid #032f28' : '1.5px solid #e0f2eb',
                            background: isSvcSelected ? '#e6f8f1' : '#fafcfb',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            transition: 'all 0.12s'
                          }}
                        >
                          <span
                            className="material-symbols-outlined"
                            style={{ fontSize: 20, color: isSvcSelected ? '#032f28' : '#2e685d', flexShrink: 0 }}
                          >
                            {svc.icon}
                          </span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700, fontSize: 13, color: '#032f28' }}>{svc.label}</div>
                            <div style={{ fontSize: 11, color: '#414846', marginTop: '0.15rem' }}>{svc.description}</div>
                          </div>
                          {isSvcSelected && (
                            <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d', flexShrink: 0 }}>check_circle</span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Specific Assistant Selector */}
                  {selectedServiceType && (
                    <div style={{ marginTop: '0.85rem' }}>
                      <h4 style={{ fontSize: 13, fontWeight: 700, color: '#032f28', margin: '0 0 0.5rem 0' }}>
                        Select Assistant
                      </h4>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        {/* Specific available assistants list */}
                        {loadingAssistants && (
                          <div style={{ fontSize: 12, color: '#717976', fontStyle: 'italic', padding: '0.4rem 0' }}>
                            Loading active assistants with this capability...
                          </div>
                        )}

                        {!loadingAssistants && availableAssistants.map(asst => {
                          const isAsstSelected = selectedAssistantId === asst.id;
                          return (
                            <div
                              key={asst.id}
                              onClick={() => setSelectedAssistantId(asst.id)}
                              style={{
                                padding: '0.65rem 0.85rem',
                                borderRadius: 10,
                                border: isAsstSelected ? '2px solid #2e685d' : '1px solid #d5e6e0',
                                background: isAsstSelected ? '#ffffff' : '#f8fafc',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between'
                              }}
                            >
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                  <span style={{ fontWeight: 700, fontSize: 12, color: '#032f28' }}>{asst.name}</span>
                                  <span style={{ fontSize: 10, fontWeight: 700, background: '#e0f2eb', color: '#2e685d', padding: '1px 6px', borderRadius: 99 }}>
                                    Available
                                  </span>
                                </div>
                                {asst.bio && (
                                  <div style={{ fontSize: 11, color: '#414846', marginTop: '0.15rem' }}>{asst.bio}</div>
                                )}
                              </div>
                              {isAsstSelected && (
                                <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d' }}>check_circle</span>
                              )}
                            </div>
                          );
                        })}

                        {!loadingAssistants && availableAssistants.length === 0 && (
                          <div style={{ fontSize: 12, color: '#ba1a1a', background: '#fff8f6', border: '1px solid #ffdad6', borderRadius: 10, padding: '0.6rem 0.85rem' }}>
                            No active assistants currently available with capability for this service. Please select another service or try again later.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Address Input & Saved Address Selector — only shown when the service requires a physical location */}
              {(() => {
                const isDelivery = selectedFulfillment === 'DELIVERY';
                const isAssistantPhysical = selectedFulfillment === 'ASSISTANT_DELIVERY' &&
                  selectedServiceType && !NON_ADDRESS_SERVICE_TYPES.includes(selectedServiceType);
                const showAddress = isDelivery || isAssistantPhysical;
                if (!showAddress) return null;
                const isAssistant = selectedFulfillment === 'ASSISTANT_DELIVERY';

                const handleSelectSaved = (addr) => {
                  setSelectedAddressId(addr.id);
                  setIsAddingNewAddress(false);
                  const formatted = `${addr.addressLine1}${addr.addressLine2 ? ', ' + addr.addressLine2 : ''}${addr.landmark ? ', Near ' + addr.landmark : ''}, ${addr.city}, ${addr.state} - ${addr.postalCode}`;
                  setDeliveryAddress(formatted);
                };

                const handleSaveNewAddress = async () => {
                  if (!newAddressForm.addressLine1 || newAddressForm.addressLine1.trim().length < 5) {
                    setError('Please enter a valid street / address (at least 5 characters).');
                    return;
                  }
                  try {
                    const res = await fetch('/api/addresses', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify(newAddressForm)
                    });
                    const data = await res.json();
                    if (data.success && data.address) {
                      setSavedAddresses(prev => [data.address, ...prev]);
                      setSelectedAddressId(data.address.id);
                      setIsAddingNewAddress(false);
                      setDeliveryAddress(data.formattedAddress || `${newAddressForm.addressLine1}, ${newAddressForm.city}, ${newAddressForm.state} - ${newAddressForm.postalCode}`);
                    } else {
                      setError(data.error || 'Failed to save address.');
                    }
                  } catch (e) {
                    setError('Error saving new address.');
                  }
                };

                return (
                  <div style={{ marginBottom: '1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <label style={{ fontSize: 13, fontWeight: 700, color: '#032f28' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4, color: '#2e685d' }}>home_pin</span>
                        {isAssistant ? 'Service Location Address' : 'Delivery Address'} <span style={{ color: '#ba1a1a' }}>*</span>
                      </label>
                      {savedAddresses.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsAddingNewAddress(!isAddingNewAddress);
                            if (!isAddingNewAddress) {
                              setSelectedAddressId(null);
                              setDeliveryAddress('');
                            }
                          }}
                          style={{ background: 'none', border: 'none', color: '#2e685d', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{isAddingNewAddress ? 'list' : 'add'}</span>
                          <span>{isAddingNewAddress ? 'Choose Saved Address' : '+ New Address'}</span>
                        </button>
                      )}
                    </div>

                    {/* Saved Addresses Radio List */}
                    {savedAddresses.length > 0 && !isAddingNewAddress && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' }}>
                        {savedAddresses.map(addr => {
                          const isSelected = selectedAddressId === addr.id;
                          return (
                            <div
                              key={addr.id}
                              onClick={() => handleSelectSaved(addr)}
                              style={{
                                padding: '0.75rem 1rem',
                                borderRadius: 12,
                                border: isSelected ? '2px solid #2e685d' : '1px solid #d5e6e0',
                                background: isSelected ? '#ffffff' : '#f8fafc',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                                <span style={{ fontSize: 12, fontWeight: 700, color: '#032f28', textTransform: 'uppercase' }}>
                                  {addr.label || 'Home'}
                                </span>
                                {addr.isDefault && (
                                  <span style={{ fontSize: 10, fontWeight: 700, background: '#e0f2eb', color: '#2e685d', padding: '2px 8px', borderRadius: 99 }}>
                                    Default
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 12, color: '#414846', lineHeight: 1.4 }}>
                                {addr.addressLine1}{addr.addressLine2 ? `, ${addr.addressLine2}` : ''}, {addr.city}, {addr.state} - {addr.postalCode}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Manual or New Address Input */}
                    {(savedAddresses.length === 0 || isAddingNewAddress) && (
                      <div style={{ background: '#f8fafc', border: '1px solid #d5e6e0', borderRadius: 12, padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.5rem' }}>
                          <input
                            type="text"
                            placeholder="Label (e.g. Home)"
                            value={newAddressForm.label}
                            onChange={e => setNewAddressForm({ ...newAddressForm, label: e.target.value })}
                            style={{ padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid #c0c8c5', fontSize: 13 }}
                          />
                          <input
                            type="text"
                            placeholder="Flat / House / Street Address *"
                            value={newAddressForm.addressLine1}
                            onChange={e => {
                              setNewAddressForm({ ...newAddressForm, addressLine1: e.target.value });
                              setDeliveryAddress(e.target.value);
                            }}
                            style={{ padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid #c0c8c5', fontSize: 13 }}
                          />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                          <input
                            type="text"
                            placeholder="City"
                            value={newAddressForm.city}
                            onChange={e => setNewAddressForm({ ...newAddressForm, city: e.target.value })}
                            style={{ padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid #c0c8c5', fontSize: 13 }}
                          />
                          <input
                            type="text"
                            placeholder="State"
                            value={newAddressForm.state}
                            onChange={e => setNewAddressForm({ ...newAddressForm, state: e.target.value })}
                            style={{ padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid #c0c8c5', fontSize: 13 }}
                          />
                          <input
                            type="text"
                            placeholder="PIN Code"
                            value={newAddressForm.postalCode}
                            onChange={e => setNewAddressForm({ ...newAddressForm, postalCode: e.target.value })}
                            style={{ padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid #c0c8c5', fontSize: 13 }}
                          />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                          <button
                            type="button"
                            onClick={handleSaveNewAddress}
                            style={{ background: '#2e685d', color: '#ffffff', border: 'none', borderRadius: 8, padding: '0.45rem 1rem', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                          >
                            Save & Use Address
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Dynamic Live Cost Summary in Fulfillment Step */}
              {(() => {
                const hasPricedItems = (checkout.items || []).some(it => it.unitPrice != null && Number(it.unitPrice) > 0);
                const subtotal = hasPricedItems
                  ? (checkout.items || []).reduce((sum, it) => sum + (Number(it.unitPrice || 0) * Number(it.quantity || 1)), 0)
                  : null;
                const opt = FULFILLMENT_OPTIONS.find(o => o.value === selectedFulfillment);
                const feeInfo = opt ? getFulfillmentFeeInfo(opt.value, checkout) : { fee: 0, label: 'Free' };
                const fee = feeInfo.fee;
                const platformFee = 2.0;
                const grandTotal = (subtotal != null ? subtotal : 0) + fee + platformFee;
                return (
                  <div style={{ background: '#e6f8f1', border: '1.5px solid #b0ecdd', borderRadius: 16, padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#414846', marginBottom: '0.35rem' }}>
                      <span>Medicines Subtotal ({checkout.items?.length || 0} formulation{checkout.items?.length === 1 ? '' : 's'}):</span>
                      <span style={{ fontWeight: 600, color: '#032f28' }}>
                        {subtotal != null ? `₹${subtotal.toFixed(2)}` : 'MRP / counter pricing at pharmacy'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: 13, color: '#414846', marginBottom: '0.35rem' }}>
                      <div>
                        <span>
                          {selectedFulfillment === 'ASSISTANT_DELIVERY'
                            ? 'Assistant Service Fee:'
                            : `Fulfillment (${opt ? opt.label : 'Select method above'}):`}
                        </span>
                        {selectedFulfillment === 'ASSISTANT_DELIVERY' && selectedServiceType && (
                          <div style={{ fontSize: 12, color: '#2e685d', fontWeight: 600, marginTop: '0.15rem' }}>
                            Service: {getAssistantServiceLabel(selectedServiceType)}
                          </div>
                        )}
                      </div>
                      <span style={{ fontWeight: 600, color: '#2e685d' }}>{feeInfo.label}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#414846', marginBottom: '0.5rem' }}>
                      <span>Platform Fee:</span>
                      <span style={{ fontWeight: 600, color: '#032f28' }}>₹{platformFee.toFixed(2)}</span>
                    </div>
                    <div style={{ borderTop: '1px solid #c0c8c5', paddingTop: '0.5rem', display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 700, color: '#032f28' }}>
                      <span>Estimated Total Amount:</span>
                      <span style={{ fontSize: 18, color: '#032f28' }}>
                        {subtotal != null ? `₹${grandTotal.toFixed(2)}` : 'MRP / counter pricing at pharmacy'}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {error && (
                <div style={{ background: '#ffdad6', border: '1px solid #ba1a1a', borderRadius: 10, padding: '0.65rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#93000a', fontSize: 13 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>error</span>
                  {error}
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button onClick={onClose} style={{ padding: '0.75rem 1.25rem', borderRadius: 99, background: '#e0f2eb', border: '1px solid #c0c8c5', color: '#414846', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
                  Cancel
                </button>
                <FlowButton
                  onClick={handleFulfillmentSelect}
                  disabled={isSubmitting || !selectedFulfillment || (selectedFulfillment === 'ASSISTANT_DELIVERY' && !selectedServiceType)}
                  loading={isSubmitting}
                  fullWidth
                  style={{ flex: 1 }}
                >
                  Continue to Payment
                </FlowButton>
              </div>
            </div>
          )}

          {/* ── Payment Step ── */}
          {step === 'payment' && checkout && (
            <div>
              {/* Order Summary */}
              <div style={{ background: '#e6f8f1', border: '1px solid #b0ecdd', borderRadius: 16, padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#414846', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Order Reference</div>
                <div style={{ fontFamily: 'var(--font-mono)', color: '#032f28', fontWeight: 700, fontSize: 18 }}>#{checkout.orderNumber}</div>
                <div style={{ fontSize: 13, color: '#414846', marginTop: '0.25rem' }}>{checkout.pharmacy?.name}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.75rem' }}>
                  {checkout.items?.map((item, idx) => (
                    <span key={idx} style={{ fontSize: 12, padding: '2px 10px', background: '#b0ecdd', borderRadius: 99, color: '#336c61', fontWeight: 600 }}>
                      {item.brandName} × {item.quantity}
                    </span>
                  ))}
                </div>
              </div>

              {/* Totals */}
              {(() => {
                const totals = getTotals();
                const ft = selectedFulfillment || checkout.fulfillmentType;
                if (!totals) return null;
                const platformFeeVal = totals.platformFee != null ? totals.platformFee : 2.0;
                return (
                  <div style={{ background: '#fff', border: '1px solid #e0f2eb', borderRadius: 16, padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#414846', marginBottom: '0.4rem' }}>
                      <span>Medicine Subtotal</span>
                      <span style={{ fontWeight: 600, color: '#032f28' }}>
                        {totals.medicineSubtotal != null ? `₹${totals.medicineSubtotal?.toFixed(2)}` : 'MRP / counter pricing at pharmacy'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: 14, color: '#414846', marginBottom: '0.4rem' }}>
                      <div>
                        <div style={{ fontWeight: 700, color: '#032f28' }}>
                          {ft === 'ASSISTANT_DELIVERY'
                            ? 'Assistant Service Fee'
                            : ft === 'PICKUP'
                            ? 'Counter Pickup'
                            : ft === 'DELIVERY'
                            ? 'Home Delivery (Pharmacy)'
                            : ft?.replace(/_/g, ' ')}
                        </div>
                        {ft === 'ASSISTANT_DELIVERY' && (selectedServiceType || checkout.assistantServiceType) && (
                          <div style={{ fontSize: 12, color: '#2e685d', fontWeight: 600, marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>support_agent</span>
                            <span>Service: {getAssistantServiceLabel(selectedServiceType || checkout.assistantServiceType)}</span>
                          </div>
                        )}
                      </div>
                      <span style={{ fontWeight: 600, color: '#032f28' }}>{totals.fulfillmentFee === 0 ? 'Free (₹0.00)' : `₹${totals.fulfillmentFee?.toFixed(2)}`}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: '#414846', marginBottom: '0.75rem', paddingBottom: '0.75rem', borderBottom: '1px solid #e0f2eb' }}>
                      <span>Platform Fee</span>
                      <span style={{ fontWeight: 600, color: '#032f28' }}>₹{platformFeeVal.toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 18, color: '#032f28' }}>
                      <span>Total Payable</span>
                      <span>
                        {totals.medicineSubtotal != null
                          ? `₹${totals.totalAmount?.toFixed(2)}`
                          : 'MRP / counter pricing at pharmacy'}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Delivery address — only shown if relevant to selected service */}
              {checkout.deliveryAddress && !NON_ADDRESS_SERVICE_TYPES.includes(selectedServiceType || checkout.assistantServiceType) && (
                <div style={{ background: '#e6f8f1', borderRadius: 10, padding: '0.65rem 1rem', marginBottom: '1rem', fontSize: 13, color: '#414846', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d', flexShrink: 0, marginTop: 1 }}>location_on</span>
                  <span><strong style={{ color: '#032f28' }}>{checkout.fulfillmentType === 'ASSISTANT_DELIVERY' ? 'Service Location:' : 'Delivery to:'}</strong> {checkout.deliveryAddress}</span>
                </div>
              )}

              {/* Unpriced Medicine Counter Payment Notice */}
              {getTotals()?.requiresCounterPayment && (
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: '0.85rem 1rem', marginBottom: '1rem', fontSize: 13, color: '#92400e', display: 'flex', alignItems: 'flex-start', gap: '0.5rem', lineHeight: 1.4 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#d97706', flexShrink: 0, marginTop: 1 }}>storefront</span>
                  <div>
                    <strong style={{ color: '#78350f' }}>Counter Pricing Notice:</strong> Authoritative medicine prices are confirmed by the pharmacist at pickup. Online payment is unavailable for unpriced medicines; please pay at the pharmacy counter.
                  </div>
                </div>
              )}

              {error && (
                <div style={{ background: '#ffdad6', border: '1px solid #ba1a1a', borderRadius: 10, padding: '0.65rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'flex-start', gap: '0.5rem', color: '#93000a', fontSize: 13 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>error</span>
                  <span>{error}</span>
                </div>
              )}

              {/* Security Notice */}
              {!getTotals()?.requiresCounterPayment && (
                <div style={{ background: '#e6f8f1', border: '1px solid #b0ecdd', borderRadius: 10, padding: '0.65rem 1rem', fontSize: 12, color: '#414846', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>shield</span>
                  Payments are processed securely by Razorpay TEST MODE. We never store card details or CVV.
                </div>
              )}

              {!navigator.onLine && (
                <div style={{ background: '#ffdad6', borderRadius: 10, padding: '0.65rem 1rem', marginBottom: '1rem', fontSize: 13, color: '#93000a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>wifi_off</span>
                  You are currently offline. Payment requires internet connectivity.
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button onClick={() => { setStep('fulfillment'); setError(null); }} style={{ padding: '0.75rem 1.25rem', borderRadius: 99, background: '#e0f2eb', border: '1px solid #c0c8c5', color: '#414846', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
                  ← Back
                </button>
                {getTotals()?.requiresCounterPayment ? (
                  <button
                    onClick={() => {
                      if (onClose) onClose();
                      window.location.href = `/orders/${orderId}`;
                    }}
                    style={{ flex: 1, padding: '0.75rem', borderRadius: 99, background: '#2e685d', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>storefront</span>
                    Pay at Pharmacy Counter
                  </button>
                ) : (
                  <FlowButton
                    onClick={handlePayNow}
                    disabled={isSubmitting}
                    loading={isSubmitting}
                    fullWidth
                    iconLeft="credit_card"
                    style={{ flex: 1 }}
                  >
                    {isSubmitting ? 'Initiating...' : `Pay ₹${getTotals()?.totalAmount?.toFixed(2) || '...'}`}
                  </FlowButton>
                )}
              </div>
            </div>
          )}

          {/* ── Success ── */}
          {step === 'success' && (
            <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#e0f2eb', border: '2px solid #b0ecdd', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 40, color: '#2e685d', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
              </div>
              <h3 style={{ fontSize: 22, fontWeight: 700, color: '#032f28', marginBottom: '0.5rem' }}>Payment Successful!</h3>
              <p style={{ color: '#414846', fontSize: 14, marginBottom: '1.5rem' }}>Your payment has been verified. Fulfillment is now in progress.</p>
              {paymentData && (
                <div style={{ background: '#e6f8f1', border: '1px solid #b0ecdd', borderRadius: 14, padding: '1rem 1.25rem', marginBottom: '1.5rem', textAlign: 'left' }}>
                  {[
                    { label: 'Amount Paid', value: `₹${paymentData.amount}` },
                    { label: 'Method', value: paymentData.method },
                    { label: 'Status', value: paymentData.status, highlight: true },
                    paymentData.paidAt && { label: 'Paid At', value: new Date(paymentData.paidAt).toLocaleString() }
                  ].filter(Boolean).map((row, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', fontSize: 14 }}>
                      <span style={{ color: '#414846' }}>{row.label}</span>
                      <span style={{ fontWeight: 700, color: row.highlight ? '#2e685d' : '#0f1e1b' }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              )}
              <FlowButton onClick={onClose} size="lg">
                View Order Tracking
              </FlowButton>
            </div>
          )}

          {/* ── Failed ── */}
          {step === 'failed' && (
            <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#ffdad6', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 40, color: '#ba1a1a', fontVariationSettings: "'FILL' 1" }}>cancel</span>
              </div>
              <h3 style={{ fontSize: 20, fontWeight: 700, color: '#ba1a1a', marginBottom: '0.5rem' }}>Payment Failed</h3>
              {error && <p style={{ color: '#414846', fontSize: 14, marginBottom: '1.5rem' }}>{error}</p>}
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={handleRetryPayment}
                  disabled={isSubmitting}
                  style={{ padding: '0.7rem 1.5rem', borderRadius: 99, background: '#032f28', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>refresh</span>
                  {isSubmitting ? 'Retrying...' : 'Retry Payment'}
                </button>
                <button onClick={onClose} style={{ padding: '0.7rem 1.5rem', borderRadius: 99, background: '#e0f2eb', border: '1px solid #c0c8c5', color: '#414846', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
                  Close
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
