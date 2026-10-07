import React, { useState, useEffect } from 'react';
import confetti from 'canvas-confetti';

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
  const [regionName, setRegionName] = useState('Chengannur / Alappuzha, Kerala');
  const [errorMessage, setErrorMessage] = useState(null);

  useEffect(() => {
    if (!isOpen || items.length === 0) return;
    setLoading(true);
    setConfirmedOrder(null);
    setSelectedPharmacy(null);
    setErrorMessage(null);

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
        const res = await fetch('/api/pharmacies/match-availability', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items, lat, lon, isEmergency })
        });
        const data = await res.json();
        if (data.success) {
          setRankedResults(data.results || []);
          if (data.regionName) setRegionName(data.regionName);
        }
      } catch (err) {
        console.error('Error fetching availability ranking:', err);
      } finally {
        setLoading(false);
      }
    }
    evaluateAvailability();
  }, [isOpen, items, isEmergency]);

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
        confetti({ particleCount: 80, spread: 60, origin: { y: 0.5 } });
        // NOTE: Do not invoke onOrderCreated immediately here because App.jsx
        // will switch activeTab to 'orders', unmounting this modal before the user
        // has a chance to read the reservation confirmation and secure PIN.
      } else {
        setErrorMessage(data.error || 'Failed to place reservation.');
      }
    } catch (err) {
      setErrorMessage('Error communicating with server. Please check your connection.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleProceedToOrders = () => {
    const order = confirmedOrder;
    onClose();
    if (onOrderCreated && order) {
      onOrderCreated(order);
    }
  };

  const handleClose = () => {
    const order = confirmedOrder;
    onClose();
    if (onOrderCreated && order) {
      onOrderCreated(order);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(3,47,40,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={handleClose}
    >
      <div
        style={{ background: '#ffffff', borderRadius: 24, width: '100%', maxWidth: 880, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 24px 64px -12px rgba(3,47,40,0.25)', border: '1px solid #e0f2eb' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Step Progress Bar */}
        <div style={{ background: '#e0f2eb', padding: '0.75rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', borderBottom: '1px solid #c0c8c5', borderRadius: '24px 24px 0 0', flexWrap: 'wrap' }}>
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
            <span style={{ fontSize: 12, fontWeight: 700, color: '#032f28' }}>Pharmacy Comparison</span>
          </div>
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#c0c8c5' }}>chevron_right</span>
          <span style={{ fontSize: 12, color: '#717976', opacity: 0.6 }}>Review & Hold</span>
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#c0c8c5' }}>chevron_right</span>
          <span style={{ fontSize: 12, color: '#717976', opacity: 0.5 }}>Confirmation</span>
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
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#032f28', margin: 0, lineHeight: 1.3 }}>Verified Medicine Availability Matrix</h2>
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
        {items.length > 0 && (
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

        {/* Fulfillment Toggle */}
        {!confirmedOrder && !loading && (
          <div style={{ padding: '1rem 1.5rem 0' }}>
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

        {/* Main Content */}
        <div style={{ padding: '1.25rem 1.5rem 1.5rem' }}>
          {confirmedOrder ? (
            /* Confirmation View */
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

              {/* Status explanation alert */}
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
          ) : (
            /* Ranked Pharmacy List */
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
                          <div><span style={{ color: '#717976' }}>Est. Cost: </span><strong style={{ color: '#0f1e1b' }}>₹{result.totalEstimatedCost}</strong></div>
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
