import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import { broadcastUpdate } from '../utils/realtimeUpdates';

export default function AvailabilityModal({
  isOpen,
  onClose,
  items = [],
  prescriptionId = null,
  onOrderCreated,
  isEmergency = false
}) {
  const [loading, setLoading] = useState(true);
  const [rankedResults, setRankedResults] = useState([]);
  const [selectedPharmacy, setSelectedPharmacy] = useState(null);
  const [orderType, setOrderType] = useState('RESERVATION');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState(null);
  const [confirmedSplitOrder, setConfirmedSplitOrder] = useState(null);
  const [allocationMode, setAllocationMode] = useState('SINGLE'); // 'SINGLE' or 'SPLIT'
  const [splitAllocations, setSplitAllocations] = useState({}); // { [itemKey]: pharmacyId }
  const [regionName, setRegionName] = useState('Chengannur, Kerala');
  const [errorMessage, setErrorMessage] = useState(null);

  // Dedicated stable idempotency key per logical payload for safe retries
  const idempotencyKeyRef = useRef(null);
  const lastPayloadStringRef = useRef(null);

  useEffect(() => {
    if (!isOpen || items.length === 0) return;
    setLoading(true);
    setConfirmedOrder(null);
    setConfirmedSplitOrder(null);
    setSelectedPharmacy(null);
    setErrorMessage(null);
    setAllocationMode('SINGLE');
    idempotencyKeyRef.current = null;
    lastPayloadStringRef.current = null;

    async function evaluateAvailability() {
      let lat = 9.3200;
      let lon = 76.6160;
      try {
        const cfgRes = await fetch('/api/pharmacies/config');
        const cfgData = await cfgRes.json();
        if (cfgData.success && cfgData.config) {
          if (cfgData.config.regionName) setRegionName(cfgData.config.regionName);
          if (cfgData.config.defaultLat) lat = cfgData.config.defaultLat;
          if (cfgData.config.defaultLon) lon = cfgData.config.defaultLon;
        }
      } catch (e) {}
      try {
        const token = localStorage.getItem('medifind_token');
        let endpoint = '/api/pharmacies/match-availability';
        let bodyPayload = { items, lat, lon, isEmergency };

        if (prescriptionId && !String(prescriptionId).startsWith('mock-') && token) {
          endpoint = `/api/prescriptions/${prescriptionId}/match-availability`;
          bodyPayload = { lat, lon, isEmergency };
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify(bodyPayload)
        });
        const data = await res.json();
        if (data.success) {
          const results = data.results || [];
          setRankedResults(results);
          if (data.regionName) setRegionName(data.regionName);

          // Seed default split allocations: map each item to the top-ranked pharmacy stocking it
          if (results.length > 0) {
            const initialMap = {};
            items.forEach((it, idx) => {
              const k = it.id || it.prescriptionItemId || it.medicineId || String(idx);
              const stockingResult = results.find(r =>
                (r.matchedItems || []).some(m =>
                  (m.medicineId && it.medicineId && m.medicineId === it.medicineId) ||
                  (m.brandName && it.brandName && m.brandName.toLowerCase() === it.brandName.toLowerCase())
                )
              ) || results[0];
              if (stockingResult?.pharmacy?.id) {
                initialMap[k] = stockingResult.pharmacy.id;
              }
            });
            setSplitAllocations(initialMap);
          }
        } else if (data.error) {
          setErrorMessage(data.error);
        }
      } catch (err) {
        console.error('Error fetching availability ranking:', err);
      } finally {
        setLoading(false);
      }
    }
    evaluateAvailability();
  }, [isOpen, items, prescriptionId, isEmergency]);

  // Standard Single Pharmacy Order
  const handlePlaceOrder = async (result) => {
    setErrorMessage(null);
    if (orderType === 'ASSISTED_DELIVERY' && (!deliveryAddress || !deliveryAddress.trim())) {
      setErrorMessage('Please enter your doorstep delivery address for assistant dispatch.');
      return;
    }
    setSubmitting(true);
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          pharmacyId: result.pharmacy.id,
          items: items.map(i => ({ medicineId: i.medicineId, quantity: i.quantity || 1 })),
          orderType,
          prescriptionId: prescriptionId || undefined,
          deliveryAddress: orderType === 'ASSISTED_DELIVERY' ? deliveryAddress : undefined,
          notes: isEmergency ? 'Urgent emergency order' : 'Prescription verified reservation'
        })
      });
      const data = await res.json();
      if (data.success) {
        setConfirmedOrder(data.order);
        try { localStorage.removeItem('medifind_prescription_session'); } catch (_) {}
        try { sessionStorage.removeItem('medifind_rx_image'); } catch (_) {}
        confetti({ particleCount: 80, spread: 60, origin: { y: 0.5 } });
        broadcastUpdate('ORDER_CREATED', { order: data.order });
      } else {
        setErrorMessage(data.error || 'Failed to place reservation.');
      }
    } catch (err) {
      setErrorMessage('Error communicating with server. Please check your connection.');
    } finally {
      setSubmitting(false);
    }
  };

  // Gate 4: Multi-Pharmacy Split Order Placement
  const handlePlaceSplitOrder = async () => {
    if (submitting) return; // Guard against double-clicks
    setErrorMessage(null);
    if (!prescriptionId) {
      setErrorMessage('A verified prescription is required for multi-pharmacy split allocation to preserve medicine provenance.');
      return;
    }
    if (orderType === 'ASSISTED_DELIVERY' && (!deliveryAddress || !deliveryAddress.trim())) {
      setErrorMessage('Please enter your doorstep delivery address for assistant dispatch.');
      return;
    }

    const allocations = [];
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      const k = it.id || it.prescriptionItemId || it.medicineId || String(idx);
      const pharId = splitAllocations[k];
      if (pharId) {
        allocations.push({
          pharmacyId: pharId,
          prescriptionItemId: it.id || it.prescriptionItemId,
          quantity: it.quantity || 1
        });
      }
    }

    if (allocations.length === 0) {
      setErrorMessage('Please allocate at least one medicine to a participating pharmacy.');
      return;
    }

    const requestPayload = {
      prescriptionId,
      allocations,
      orderType,
      deliveryAddress: orderType === 'ASSISTED_DELIVERY' ? deliveryAddress : undefined,
      notes: isEmergency ? 'Urgent emergency split reservation' : 'Prescription verified multi-dispensary allocation'
    };
    const payloadString = JSON.stringify(requestPayload);

    // Reuse key for retries of the same logical payload; rotate key if allocations or payload changed
    if (!idempotencyKeyRef.current || lastPayloadStringRef.current !== payloadString) {
      idempotencyKeyRef.current = `mf-split-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      lastPayloadStringRef.current = payloadString;
    }

    setSubmitting(true);
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch('/api/orders/split', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKeyRef.current,
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: payloadString
      });
      const data = await res.json();
      if (data.success) {
        setConfirmedSplitOrder(data);
        try { localStorage.removeItem('medifind_prescription_session'); } catch (_) {}
        try { sessionStorage.removeItem('medifind_rx_image'); } catch (_) {}
        confetti({ particleCount: 90, spread: 70, origin: { y: 0.5 } });
        broadcastUpdate('ORDER_CREATED', { order: data.parentOrder });
      } else {
        setErrorMessage(data.error || 'Failed to place split order allocation.');
      }
    } catch (err) {
      setErrorMessage('Error communicating with server. Please check your connection.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleProceedToOrders = () => {
    const order = confirmedOrder || (confirmedSplitOrder ? confirmedSplitOrder.parentOrder : null);
    onClose();
    if (onOrderCreated && order) {
      onOrderCreated(order);
    }
  };

  const handleClose = () => {
    const order = confirmedOrder || (confirmedSplitOrder ? confirmedSplitOrder.parentOrder : null);
    onClose();
    if (onOrderCreated && order) {
      onOrderCreated(order);
    }
  };

  if (!isOpen) return null;

  // Compute unique pharmacies selected in split allocations
  const uniqueSelectedPharmaciesCount = new Set(Object.values(splitAllocations)).size;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(3,47,40,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem' }}
      onClick={handleClose}
    >
      <div
        style={{ background: '#ffffff', borderRadius: 20, width: '100%', maxWidth: 880, maxHeight: '85dvh', overflowY: 'auto', boxShadow: '0 24px 64px -12px rgba(3,47,40,0.25)', border: '1px solid #e0f2eb' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Step Progress Bar */}
        <div style={{ background: '#e0f2eb', padding: '0.65rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', borderBottom: '1px solid #c0c8c5', borderRadius: '20px 20px 0 0', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#2e685d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#fff' }}>check</span>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#2e685d' }}>Medicine Request Verified</span>
          </div>
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#c0c8c5' }}>chevron_right</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#1e453e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#8ab2a9' }}>compare_arrows</span>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#032f28' }}>
              {allocationMode === 'SPLIT' ? 'Multi-Pharmacy Allocation' : 'Pharmacy Comparison'}
            </span>
          </div>
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#c0c8c5' }}>chevron_right</span>
          <span style={{ fontSize: 12, color: '#717976', opacity: 0.6 }}>Review &amp; Hold</span>
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#c0c8c5' }}>chevron_right</span>
          <span style={{ fontSize: 12, color: (confirmedOrder || confirmedSplitOrder) ? '#2e685d' : '#717976', opacity: (confirmedOrder || confirmedSplitOrder) ? 1 : 0.5, fontWeight: (confirmedOrder || confirmedSplitOrder) ? 700 : 400 }}>
            Confirmation
          </span>
        </div>

        {/* Header */}
        <div style={{ padding: '1.5rem 1.5rem 0 1.5rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, background: '#e0f2eb', color: '#2e685d', padding: '2px 10px', borderRadius: 99, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Live Availability
              </span>
              {isEmergency && (
                <span style={{ fontSize: 11, fontWeight: 700, background: '#ffdad6', color: '#93000a', padding: '2px 10px', borderRadius: 99, textTransform: 'uppercase' }}>
                  24/7 Emergency Mode
                </span>
              )}
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#032f28', margin: 0, lineHeight: 1.3 }}>
              {allocationMode === 'SPLIT' ? 'Split-Order Pharmacy Allocation' : 'Verified Medicine Availability Matrix'}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>my_location</span>
              <span style={{ fontSize: 13, color: '#414846' }}>{regionName} (within 5 km)</span>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#c0c8c5', display: 'inline-block' }}></span>
              <span style={{ fontSize: 12, color: '#2e685d', fontWeight: 600 }}>
                {items.length} medicine(s) requested
              </span>
            </div>
          </div>
          <button
            onClick={handleClose}
            style={{ background: '#e6f8f1', border: '1px solid #c0c8c5', borderRadius: 99, padding: '0.35rem 0.75rem', color: '#414846', cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
          </button>
        </div>

        {/* Medicine Chips */}
        {items.length > 0 && !confirmedOrder && !confirmedSplitOrder && (
          <div style={{ padding: '1rem 1.5rem 0', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem' }}>
            {items.map((it, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#e6f8f1', borderRadius: 12, padding: '0.6rem 1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#1e453e' }}>pill</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#0f1e1b' }}>{it.brandName || `Medicine #${idx + 1}`}</div>
                    <div style={{ fontSize: 12, color: '#414846' }}>Qty: {it.quantity || 1}</div>
                  </div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, background: '#d5e6e0', color: '#032f28', borderRadius: 99, padding: '2px 8px' }}>Verified Rx</span>
              </div>
            ))}
          </div>
        )}

        {/* Allocation Mode Selector & Fulfillment Toggle */}
        {!confirmedOrder && !confirmedSplitOrder && !loading && (
          <div style={{ padding: '1rem 1.5rem 0' }}>
            {/* Split Mode Toggle (available when prescription has multiple items or partial matches) */}
            {prescriptionId && items.length > 1 && (
              <div style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.5rem', background: '#e0f2eb', padding: '0.35rem', borderRadius: 99, border: '1px solid #b0ecdd' }}>
                <button
                  type="button"
                  onClick={() => setAllocationMode('SINGLE')}
                  style={{
                    flex: 1, padding: '0.45rem 1rem', borderRadius: 99,
                    border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                    background: allocationMode === 'SINGLE' ? '#032f28' : 'transparent',
                    color: allocationMode === 'SINGLE' ? '#ffffff' : '#032f28',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                    transition: 'all 0.15s'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 15 }}>storefront</span>
                  Single Dispensary Reservation
                </button>
                <button
                  type="button"
                  onClick={() => setAllocationMode('SPLIT')}
                  style={{
                    flex: 1, padding: '0.45rem 1rem', borderRadius: 99,
                    border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                    background: allocationMode === 'SPLIT' ? '#032f28' : 'transparent',
                    color: allocationMode === 'SPLIT' ? '#ffffff' : '#032f28',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                    transition: 'all 0.15s'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 15 }}>call_split</span>
                  Multi-Pharmacy Split Allocation
                </button>
              </div>
            )}

            {/* Pickup vs Delivery Toggle */}
            <div style={{ display: 'flex', gap: '0.5rem', padding: '0.5rem', background: '#e6f8f1', borderRadius: 99, border: '1px solid #c0c8c5' }}>
              {[
                { value: 'RESERVATION', label: 'Self Pickup Reservation', icon: 'storefront' },
                { value: 'ASSISTED_DELIVERY', label: 'Medicine Access Assistant (Doorstep)', icon: 'electric_moped' }
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setOrderType(opt.value)}
                  style={{
                    flex: 1, padding: '0.5rem 1rem', borderRadius: 99,
                    border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                    background: orderType === opt.value ? '#1e453e' : 'transparent',
                    color: orderType === opt.value ? '#8ab2a9' : '#414846',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{opt.icon}</span>
                  {opt.label}
                </button>
              ))}
            </div>
            {orderType === 'ASSISTED_DELIVERY' && (
              <div style={{ marginTop: '0.75rem' }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#414846', marginBottom: '0.4rem' }}>Doorstep Delivery Address</label>
                <input
                  type="text"
                  value={deliveryAddress}
                  onChange={e => setDeliveryAddress(e.target.value)}
                  placeholder="Enter full street address for assistant dispatch..."
                  style={{ width: '100%', boxSizing: 'border-box', padding: '0.65rem 1rem', borderRadius: 12, border: '1.5px solid #c0c8c5', background: '#fff', fontSize: 14, color: '#0f1e1b', outline: 'none', fontFamily: 'inherit' }}
                />
              </div>
            )}
          </div>
        )}

        {/* Error Banner */}
        {errorMessage && (
          <div style={{ margin: '1rem 1.5rem 0', background: '#ffdad6', border: '1px solid #ba1a1a', borderRadius: 12, padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#93000a', fontSize: 13 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>error</span>
            {errorMessage}
          </div>
        )}

        {/* Main Content Area */}
        <div style={{ padding: '1.25rem 1.5rem 1.5rem' }}>

          {/* ── SPLIT ORDER CONFIRMATION VIEW ── */}
          {confirmedSplitOrder ? (
            <div style={{ textAlign: 'center', padding: '1.5rem 0.5rem' }}>
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#e0f2eb', border: '2px solid #b0ecdd', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 36, color: '#2e685d', fontVariationSettings: "'FILL' 1" }}>call_split</span>
              </div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem', background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 99, padding: '4px 14px', fontSize: 12, fontWeight: 700, color: '#b78103' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>hourglass_empty</span>
                RESERVATION STATUS: PENDING PHARMACY CONFIRMATION
              </div>
              <h3 style={{ fontSize: 22, fontWeight: 800, color: '#032f28', marginBottom: '0.5rem' }}>
                Multi-Dispensary Split Reservation Placed!
              </h3>
              <p style={{ color: '#414846', fontSize: 14, maxWidth: 540, margin: '0 auto 1.25rem', lineHeight: 1.6 }}>
                Parent Order <strong style={{ color: '#032f28' }}>#{confirmedSplitOrder.parentOrder?.orderNumber}</strong> has allocated your requested medicines across{' '}
                <strong style={{ color: '#2e685d' }}>{confirmedSplitOrder.childOrders?.length} participating dispensaries</strong>.
              </p>

              {/* Status explanation alert */}
              <div style={{ background: '#f4fbf7', border: '1px solid #b0ecdd', borderRadius: 14, padding: '0.85rem 1.25rem', maxWidth: 540, margin: '0 auto 1.25rem', textAlign: 'left', fontSize: 13, color: '#1e453e', lineHeight: 1.5 }}>
                <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.3rem', color: '#032f28' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d' }}>info</span>
                  What happens next?
                </div>
                Each dispensary will verify medicine stock and prepare their assigned items independently. You can track progress and checkout each dispensary order individually from your Order Tracking page.
              </div>

              {/* Fee Ledger Notice */}
              <div style={{ background: '#e0f2eb', border: '1px solid #a6cfc5', borderRadius: 12, padding: '0.75rem 1rem', maxWidth: 540, margin: '0 auto 1.5rem', textAlign: 'left', fontSize: 12, color: '#032f28', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d' }}>account_balance_wallet</span>
                <span>
                  <strong>Single Platform Fee Guarantee:</strong> The ₹2.00 platform fee applies at most once across this entire split order. Sibling dispensary orders incur ₹0.00 platform fee.
                </span>
              </div>

              {/* Child Orders Breakdown */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', maxWidth: 680, margin: '0 auto 1.5rem', textAlign: 'left' }}>
                {(confirmedSplitOrder.childOrders || []).map((child, idx) => (
                  <div key={child.id || idx} style={{ background: '#ffffff', border: '1.5px solid #b0ecdd', borderRadius: 16, padding: '1.25rem', boxShadow: '0 2px 8px rgba(3,47,40,0.05)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, background: '#e0f2eb', color: '#2e685d', padding: '2px 8px', borderRadius: 99 }}>
                        Dispensary #{idx + 1}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#717976' }}>
                        Ref #{child.orderNumber}
                      </span>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#032f28', marginBottom: '0.4rem' }}>
                      {child.pharmacyName || child.pharmacy?.name || 'Local Dispensary'}
                    </div>

                    <div style={{ fontSize: 12, color: '#414846', marginBottom: '0.75rem' }}>
                      <div style={{ fontWeight: 600, color: '#717976', marginBottom: '0.2rem' }}>Allocated Medicines:</div>
                      {(child.items || []).map((it, iIdx) => (
                        <div key={iIdx} style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>{it.brandName || 'Medicine'}</span>
                          <span style={{ fontWeight: 700 }}>×{it.quantity}</span>
                        </div>
                      ))}
                    </div>

                    {child.verificationPin && (
                      <div style={{ background: '#f5faf8', borderRadius: 10, padding: '0.5rem', textAlign: 'center', border: '1px solid #d5e6e0' }}>
                        <div style={{ fontSize: 10, color: '#717976', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Pickup PIN</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 800, color: '#032f28', letterSpacing: '0.15em' }}>
                          {child.verificationPin}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Partial Allocation Notice */}
              {confirmedSplitOrder.allocationSummary?.unallocatedItemsCount > 0 && (
                <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 12, padding: '0.75rem 1rem', maxWidth: 540, margin: '0 auto 1.5rem', textAlign: 'left', fontSize: 12, color: '#b78103' }}>
                  <strong>Preserved Remaining Items:</strong> {confirmedSplitOrder.allocationSummary.unallocatedItemsCount} item(s) remain unallocated on your prescription. You can re-match the remaining items at any time without duplicating active orders.
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={handleProceedToOrders}
                  style={{ padding: '0.75rem 2rem', borderRadius: 99, background: '#032f28', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: '0 4px 12px rgba(3,47,40,0.15)' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>receipt_long</span>
                  View My Orders &amp; Track Status →
                </button>
              </div>
            </div>
          ) : confirmedOrder ? (
            /* ── SINGLE ORDER CONFIRMATION VIEW ── */
            <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#e0f2eb', border: '2px solid #b0ecdd', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 36, color: '#2e685d', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
              </div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem', background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 99, padding: '4px 14px', fontSize: 12, fontWeight: 700, color: '#b78103' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>hourglass_empty</span>
                RESERVATION STATUS: PENDING PHARMACY CONFIRMATION
              </div>
              <h3 style={{ fontSize: 22, fontWeight: 700, color: '#032f28', marginBottom: '0.5rem' }}>
                {confirmedOrder.orderType === 'ASSISTED_DELIVERY' ? 'Doorstep Delivery Request Dispatched!' : 'Medicine Reservation Placed!'}
              </h3>
              <p style={{ color: '#414846', fontSize: 14, maxWidth: 520, margin: '0 auto 1rem', lineHeight: 1.6 }}>
                Order <strong style={{ color: '#032f28' }}>#{confirmedOrder.orderNumber}</strong> has been transmitted to{' '}
                <strong style={{ color: '#2e685d' }}>{confirmedOrder.pharmacy?.name}</strong>.
              </p>

              <div style={{ background: '#f4fbf7', border: '1px solid #b0ecdd', borderRadius: 14, padding: '0.85rem 1.25rem', maxWidth: 480, margin: '0 auto 1.5rem', textAlign: 'left', fontSize: 13, color: '#1e453e', lineHeight: 1.5 }}>
                <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.3rem', color: '#032f28' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d' }}>info</span>
                  What happens next?
                </div>
                Your reservation is currently <strong>PENDING</strong> pharmacist verification. The pharmacy will verify stock and prepare your order. Once the pharmacist confirms your reservation, you can proceed to checkout and payment.
              </div>

              {/* PIN Card */}
              <div style={{ background: '#e6f8f1', border: '1.5px solid #b0ecdd', borderRadius: 16, padding: '1.5rem', maxWidth: 400, margin: '0 auto 2rem', textAlign: 'left' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#414846', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                  🔐 Your Secure Handover / Pickup PIN
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 40, fontWeight: 800, color: '#032f28', letterSpacing: '0.25em', textAlign: 'center', padding: '0.5rem 0' }}>
                  {confirmedOrder.verificationPin}
                </div>
                <div style={{ fontSize: 12, color: '#414846', textAlign: 'center', lineHeight: 1.5, marginTop: '0.5rem' }}>
                  {confirmedOrder.orderType === 'ASSISTED_DELIVERY'
                    ? 'Provide this 4-digit PIN to the Medicine Access Assistant upon doorstep arrival.'
                    : 'Present this 4-digit PIN at the pharmacy billing counter to collect your reserved medicines.'}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={handleProceedToOrders}
                  style={{ padding: '0.75rem 2rem', borderRadius: 99, background: '#032f28', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: '0 4px 12px rgba(3,47,40,0.15)' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>receipt_long</span>
                  View My Orders &amp; Track Status →
                </button>
              </div>
            </div>
          ) : loading ? (
            /* Loading State */
            <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', border: '3px solid #b0ecdd', borderTopColor: '#2e685d', animation: 'cs-spin 1s linear infinite', margin: '0 auto 1rem' }} />
              <style>{`@keyframes cs-spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }`}</style>
              <p style={{ fontWeight: 700, color: '#032f28', fontSize: 16 }}>Calculating stock availability &amp; travel distances...</p>
              <p style={{ fontSize: 13, color: '#414846', marginTop: '0.25rem' }}>Executing multi-criteria explainable ranking</p>
            </div>
          ) : rankedResults.length === 0 ? (
            /* Empty State */
            <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#e0f2eb', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 32, color: '#717976' }}>inventory_2</span>
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#032f28', marginBottom: '0.5rem' }}>No Matching Pharmacies Found</h3>
              <p style={{ fontSize: 14, color: '#414846', maxWidth: 400, margin: '0 auto' }}>
                No pharmacies within the search radius currently stock all requested medicines.
              </p>
            </div>
          ) : allocationMode === 'SPLIT' ? (
            /* ── SPLIT ALLOCATION REVIEW & SUBMISSION BUILDER ── */
            <div>
              <div style={{ marginBottom: '1rem', background: '#f8faf9', border: '1px solid #e0f2eb', borderRadius: 14, padding: '0.85rem 1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d' }}>call_split</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#032f28' }}>Multi-Pharmacy Allocation Review</span>
                </div>
                <p style={{ fontSize: 12, color: '#414846', margin: 0 }}>
                  Allocate each prescription item to a participating dispensary. A single ₹2.00 platform fee applies to the entire parent order.
                </p>
              </div>

              {/* Items Allocation Rows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
                {items.map((it, idx) => {
                  const k = it.id || it.prescriptionItemId || it.medicineId || String(idx);
                  const selectedPharId = splitAllocations[k] || '';
                  const selectedResult = rankedResults.find(r => r.pharmacy.id === selectedPharId);
                  const isStocked = selectedResult && (selectedResult.matchedItems || []).some(m =>
                    (m.medicineId && it.medicineId && m.medicineId === it.medicineId) ||
                    (m.brandName && it.brandName && m.brandName.toLowerCase() === it.brandName.toLowerCase())
                  );

                  return (
                    <div
                      key={k}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #e0f2eb',
                        borderRadius: 14,
                        padding: '1rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '0.75rem'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ width: 40, height: 40, borderRadius: 10, background: '#e0f2eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#032f28' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>medication</span>
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#032f28' }}>
                            {it.brandName || `Medicine #${idx + 1}`}
                          </div>
                          <div style={{ fontSize: 12, color: '#717976' }}>
                            Requested Qty: <strong style={{ color: '#032f28' }}>{it.quantity || 1}</strong>
                          </div>
                        </div>
                      </div>

                      {/* Pharmacy Selector */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <label style={{ fontSize: 12, color: '#414846', fontWeight: 600 }}>Dispensary:</label>
                        <select
                          value={selectedPharId}
                          onChange={e => setSplitAllocations(prev => ({ ...prev, [k]: e.target.value }))}
                          style={{
                            padding: '0.45rem 0.85rem',
                            borderRadius: 10,
                            border: '1.5px solid #c0c8c5',
                            fontSize: 13,
                            color: '#032f28',
                            background: '#ffffff',
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          {rankedResults.map(r => {
                            const stocksThis = (r.matchedItems || []).some(m =>
                              (m.medicineId && it.medicineId && m.medicineId === it.medicineId) ||
                              (m.brandName && it.brandName && m.brandName.toLowerCase() === it.brandName.toLowerCase())
                            );
                            return (
                              <option key={r.pharmacy.id} value={r.pharmacy.id}>
                                {r.pharmacy.name} ({r.distanceKm} km) {stocksThis ? '— In Stock' : '— Unverified Stock'}
                              </option>
                            );
                          })}
                        </select>
                        <span style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: 99,
                          background: isStocked ? '#b0ecdd' : '#fff8e1',
                          color: isStocked ? '#336c61' : '#b78103'
                        }}>
                          {isStocked ? 'Stock Verified' : 'Checking Stock'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Split Summary & Submission Bar */}
              <div style={{ background: '#e6f8f1', border: '1px solid #b0ecdd', borderRadius: 16, padding: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#032f28', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d' }}>verified</span>
                    <span>Ready to submit {items.length} medicines across {uniqueSelectedPharmaciesCount} dispensaries</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#414846', marginTop: '0.2rem' }}>
                    Single Platform Fee: <strong>₹2.00</strong> (siblings ₹0.00) • Individual Handover PINs generated
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handlePlaceSplitOrder}
                  disabled={submitting}
                  style={{
                    padding: '0.65rem 1.75rem',
                    borderRadius: 99,
                    background: submitting ? '#e0f2eb' : '#032f28',
                    color: submitting ? '#717976' : '#ffffff',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    boxShadow: '0 4px 12px rgba(3,47,40,0.15)'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    {submitting ? 'hourglass_empty' : 'call_split'}
                  </span>
                  <span>{submitting ? 'Allocating Order...' : 'Confirm Split Reservation'}</span>
                </button>
              </div>
            </div>
          ) : (
            /* ── SINGLE DISPENSARY RANKED PHARMACY LIST ── */
            <div>
              {/* Filter Info */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#032f28' }}>Matching Pharmacies</span>
                  <span style={{ fontSize: 11, fontWeight: 700, background: '#b0ecdd', color: '#336c61', padding: '2px 10px', borderRadius: 99 }}>
                    {rankedResults.length} Available
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: 12, color: '#414846' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#2e685d' }}>tune</span>
                  Ranked by stock completeness, distance &amp; verified status
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', maxHeight: 420, overflowY: 'auto' }}>
                {rankedResults.map((result, idx) => {
                  const p = result.pharmacy;
                  const isTopRank = idx === 0;
                  const isFullMatch = result.availabilityStatus === 'FULL_MATCH';
                  const isPartial = result.availabilityStatus === 'PARTIAL_MATCH';
                  return (
                    <div
                      key={p.id}
                      style={{
                        background: '#ffffff',
                        borderRadius: 16,
                        border: isTopRank ? '2px solid #2e685d' : '1.5px solid #d5e6e0',
                        padding: '1.25rem',
                        position: 'relative',
                        overflow: 'hidden',
                        boxShadow: isTopRank ? '0 4px 20px -4px rgba(30,69,62,0.1)' : '0 2px 8px -2px rgba(30,69,62,0.05)'
                      }}
                    >
                      {/* Side accent bar */}
                      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: isTopRank ? '#2e685d' : (isFullMatch ? '#b0ecdd' : '#ffdad6'), borderRadius: '16px 0 0 16px' }} />
                      <div style={{ paddingLeft: '0.75rem' }}>
                        {/* Header row */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                            <div style={{ width: 44, height: 44, borderRadius: '50%', background: isTopRank ? '#1e453e' : '#e0f2eb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <span style={{ fontSize: 15, fontWeight: 800, color: isTopRank ? '#8ab2a9' : '#032f28' }}>#{idx + 1}</span>
                            </div>
                            <div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                                {isTopRank && (
                                  <span style={{ fontSize: 11, fontWeight: 700, background: '#2e685d', color: '#fff', padding: '2px 10px', borderRadius: 99 }}>
                                    Best Match &amp; {isFullMatch ? '100%' : 'Partial'} Fulfillment
                                  </span>
                                )}
                                {p.isTestRecord ? (
                                  <span style={{ fontSize: 10, fontWeight: 700, background: '#ffdad6', color: '#93000a', padding: '2px 8px', borderRadius: 99, textTransform: 'uppercase' }}>
                                    TEST DATA
                                  </span>
                                ) : (
                                  <span style={{ fontSize: 10, fontWeight: 700, background: '#e0f2eb', color: '#032f28', padding: '2px 8px', borderRadius: 99 }}>
                                    Participating Pharmacy
                                  </span>
                                )}
                                <span style={{
                                  fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 99,
                                  background: isFullMatch ? '#b0ecdd' : isPartial ? '#ffdad6' : '#ffdad6',
                                  color: isFullMatch ? '#336c61' : '#93000a'
                                }}>
                                  {isFullMatch ? 'Complete Match' : isPartial ? 'Partial Match' : 'Out of Stock'}
                                </span>
                                {p.is24x7 && (
                                  <span style={{ fontSize: 10, fontWeight: 700, background: '#e0f2eb', color: '#2e685d', padding: '2px 8px', borderRadius: 99 }}>
                                    24/7 Open
                                  </span>
                                )}
                              </div>
                              <h4 style={{ fontSize: 16, fontWeight: 700, color: '#0f1e1b', margin: 0 }}>{p.name}</h4>
                              <p style={{ fontSize: 12, color: '#414846', display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.2rem' }}>
                                <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#2e685d' }}>location_on</span>
                                {p.address}
                              </p>
                              {p.testDataNote && (
                                <p style={{ fontSize: 11, color: '#93000a', marginTop: '0.25rem', fontWeight: 500 }}>⚠️ {p.testDataNote}</p>
                              )}
                            </div>
                          </div>
                          {/* Score */}
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 800, color: result.scores.totalScore >= 80 ? '#2e685d' : result.scores.totalScore >= 60 ? '#ba1a1a' : '#ba1a1a', lineHeight: 1 }}>
                              {result.scores.totalScore}
                            </div>
                            <div style={{ fontSize: 11, color: '#717976' }}>/100 Match Score</div>
                          </div>
                        </div>

                        {/* Stats Row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', padding: '0.65rem 0', borderTop: '1px solid #e6f8f1', borderBottom: '1px solid #e6f8f1', fontSize: 13, flexWrap: 'wrap' }}>
                          <div><span style={{ color: '#717976' }}>Distance: </span><strong style={{ color: '#0f1e1b' }}>{result.distanceKm} km</strong></div>
                          <div><span style={{ color: '#717976' }}>Stock: </span><strong style={{ color: isFullMatch ? '#2e685d' : '#ba1a1a' }}>{result.matchedItemsCount}/{result.totalRequested} Available</strong></div>
                          <div>
                            <span style={{ color: '#717976' }}>Est. Cost: </span>
                            <strong style={{ color: '#0f1e1b' }}>{result.totalEstimatedCost != null ? `₹${result.totalEstimatedCost}` : 'Unpriced'}</strong>
                            {result.isTotalCostComplete === false && result.totalEstimatedCost != null && (
                              <span style={{ marginLeft: 4, fontSize: 10, color: '#b78103', fontWeight: 600 }}> (Partial)</span>
                            )}
                          </div>
                        </div>

                        {/* AI Explanation */}
                        <div style={{ marginTop: '0.65rem', fontSize: 12, color: '#414846', background: '#e6f8f1', padding: '0.5rem 0.75rem', borderRadius: 8, lineHeight: 1.5 }}>
                          <strong style={{ color: '#032f28' }}>AI Ranking Reason: </strong>
                          {result.explanation}
                        </div>

                        {/* Action Row */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                          {p.phone && p.phone !== 'CONTACT-NOT-AVAILABLE' ? (
                            <a href={`tel:${p.phone}`} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: 12, color: '#2e685d', textDecoration: 'none', background: '#e0f2eb', padding: '0.4rem 0.75rem', borderRadius: 99, fontWeight: 600 }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>call</span>
                              {p.phone}
                            </a>
                          ) : (
                            <span style={{ fontSize: 12, color: '#717976', fontStyle: 'italic' }}>Contact not available</span>
                          )}
                          <button
                            onClick={() => handlePlaceOrder(result)}
                            disabled={submitting}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '0.5rem',
                              padding: '0.55rem 1.25rem', borderRadius: 99,
                              background: submitting ? '#e0f2eb' : '#032f28',
                              color: submitting ? '#414846' : '#fff',
                              border: 'none', cursor: submitting ? 'not-allowed' : 'pointer',
                              fontSize: 13, fontWeight: 700, transition: 'all 0.15s'
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                              {orderType === 'ASSISTED_DELIVERY' ? 'electric_moped' : 'store'}
                            </span>
                            {orderType === 'ASSISTED_DELIVERY' ? 'Dispatch Assistant Here' : 'Reserve at this Pharmacy'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
