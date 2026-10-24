import React, { useState, useEffect } from 'react';
import { subscribeToUpdates } from '../utils/realtimeUpdates';
import CheckoutPage from './CheckoutPage';
import FlowButton from './FlowButton';

/**
 * ReservationSuccess — Live Dynamic Dispensary Reservation Screen
 *
 * - Real-time subscription to order status updates (PENDING -> CONFIRMED -> READY_FOR_PICKUP)
 * - Dynamic Hero Status Banner that morphs when pharmacy confirms reservation
 * - Live Dispensing Timeline with active progression
 * - Instant Checkout trigger allowing patient to choose fulfillment mode (Pickup / Assistant Delivery) and pay
 */
export default function ReservationSuccess({
  order,
  pharmacy,
  items = [],
  onProceedToOrders,
  onProceedToCheckout,
  onNavigateToCatalogue
}) {
  const [currentOrder, setCurrentOrder] = useState(order);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [copied, setCopied] = useState(false);

  // Reference code display
  const targetOrderId = currentOrder?.id || order?.id;
  const refCode = targetOrderId
    ? `#MND-${targetOrderId.slice(0, 6).toUpperCase()}`
    : '#MND-7829-STJ';

  const copyRefCode = () => {
    try {
      navigator.clipboard.writeText(refCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (_) {}
  };

  // Real-time synchronization: listen for pharmacy confirmation & poll order
  useEffect(() => {
    if (!targetOrderId) return;

    const fetchLatestOrder = async () => {
      const token = localStorage.getItem('medifind_token');
      if (!token) return;
      try {
        const res = await fetch(`/api/orders/${targetOrderId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success && data.order) {
          setCurrentOrder(data.order);
        }
      } catch (_) {}
    };

    // Initial sync
    fetchLatestOrder();

    // Instant event reaction from same or other tabs
    const unsub = subscribeToUpdates((event) => {
      if (['ORDER_STATUS_UPDATED', 'PAYMENT_COMPLETED', 'FULFILLMENT_SELECTED'].includes(event?.type)) {
        if (!event.payload?.orderId || event.payload?.orderId === targetOrderId) {
          if (event.payload?.newStatus) {
            setCurrentOrder(prev => ({
              ...prev,
              status: event.payload.newStatus
            }));
          }
          fetchLatestOrder();
        }
      }
    });

    // Background heartbeat poll every 8s while waiting (paused if tab hidden)
    const timer = setInterval(() => {
      if (!document.hidden) {
        fetchLatestOrder();
      }
    }, 8000);

    return () => {
      unsub();
      clearInterval(timer);
    };
  }, [targetOrderId]);

  const status = currentOrder?.status || 'PENDING';
  const isConfirmed = status === 'CONFIRMED';
  const isReady = status === 'READY_FOR_PICKUP';
  const isCompleted = status === 'COMPLETED';
  const isPaid = currentOrder?.payment?.status === 'PAID';
  const isCounterPay = currentOrder?.payment?.method === 'COUNTER' || currentOrder?.payment?.method === 'PAY_AT_COUNTER';
  const isCheckoutComplete = Boolean(currentOrder?.fulfillmentType) && (isPaid || isCounterPay);

  const estimatedTotal = currentOrder?.totalAmount || items.reduce((sum, item) => {
    const price = Number(item.price != null ? item.price : (item.unitPrice != null ? item.unitPrice : 0));
    const qty = item.quantity || 1;
    return sum + (price * qty);
  }, 0);

  const handleOpenCheckout = () => {
    if (onProceedToCheckout) {
      onProceedToCheckout(targetOrderId);
    } else {
      setShowCheckoutModal(true);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-6 font-body-md text-on-surface">
      {/* Success Hero Status Banner */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-container via-[#173a34] to-primary p-6 sm:p-10 text-white shadow-xl">
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-start sm:items-center gap-5">
            <div className="relative shrink-0">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-secondary-container/20 flex items-center justify-center text-[#b3eee0]">
                <span className="material-symbols-outlined text-4xl sm:text-5xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                  {isConfirmed ? 'check_circle' : isReady ? 'inventory_2' : 'task_alt'}
                </span>
              </div>
              <span className="absolute inset-0 rounded-full ring-4 ring-secondary-container/30 animate-ping opacity-60 pointer-events-none" />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-3 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-xs font-bold tracking-wide">
                  TRANSMISSION VERIFIED
                </span>

                {isConfirmed ? (
                  <span className="flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-[#b0ecdd] text-[#00201b] text-xs font-bold shadow-xs">
                    <span className="w-2 h-2 rounded-full bg-[#1b4d43] animate-pulse" />
                    RESERVATION CONFIRMED BY DISPENSARY
                  </span>
                ) : isReady ? (
                  <span className="flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-[#c1ebe1] text-[#00201b] text-xs font-bold shadow-xs">
                    <span className="material-symbols-outlined text-sm">verified</span>
                    READY FOR COUNTER PICKUP
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-[#ffdad4] text-[#410100] text-xs font-semibold">
                    <span className="w-2 h-2 rounded-full bg-[#7e1208] animate-ping" />
                    PHARMACY REVIEW IN PROGRESS
                  </span>
                )}
              </div>

              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                {isConfirmed
                  ? 'Reservation Confirmed & Stock Earmarked!'
                  : isReady
                  ? 'Medicines Ready for Counter Pickup!'
                  : 'Reservation Request Successfully Transmitted!'}
              </h1>

              <p className="text-xs sm:text-sm text-[#e3f5ee]/90 max-w-2xl leading-relaxed">
                {isConfirmed ? (
                  <>
                    <strong className="text-[#b3eee0] font-semibold">{pharmacy?.name || 'The dispensary'}</strong> has confirmed your prescription hold! Stock is secured at the counter. Please choose your fulfillment mode and payment to finalize.
                  </>
                ) : isReady ? (
                  <>
                    Your medicines are quarantined and staged for pickup at <strong className="text-[#b3eee0] font-semibold">{pharmacy?.name || 'the dispensary'}</strong>. Present your 4-digit PIN at the counter.
                  </>
                ) : (
                  <>
                    Your medicine hold request has been routed directly to <strong className="text-[#b3eee0] font-semibold">{pharmacy?.name || 'the selected dispensary'}</strong>. The dispensary desk has received the verified prescription and is inspecting shelf stock.
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Reference Token Box */}
          <div className="shrink-0 flex flex-col gap-1 bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/20 sm:min-w-[280px]">
            <span className="text-[10px] text-[#e3f5ee]/70 uppercase font-semibold tracking-wider">
              Dynamic Reservation Ref
            </span>
            <div className="flex items-center justify-between gap-3">
              <span className="text-lg font-bold font-mono tracking-wider text-white">
                {refCode}
              </span>
              <button
                type="button"
                onClick={copyRefCode}
                className="px-3 py-1 rounded-full bg-[#b3eee0] hover:bg-[#97d2c4] text-[#00201b] text-xs font-bold transition-all flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-sm">content_copy</span>
                <span>{copied ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>
            {(currentOrder?.verificationPin || order?.verificationPin) && (
              <div className="mt-2 pt-2 border-t border-white/20 flex items-center justify-between">
                <span className="text-[10px] text-[#b3eee0] font-bold uppercase tracking-wider">Pickup PIN:</span>
                <span className="text-base font-black font-mono tracking-widest text-[#00201b] bg-[#b3eee0] px-2.5 py-0.5 rounded-lg shadow-xs">
                  {currentOrder?.verificationPin || order?.verificationPin}
                </span>
              </div>
            )}
            <span className="text-[11px] text-[#e3f5ee]/70 mt-1">
              {isConfirmed
                ? 'Status: Verified & Awaiting Checkout'
                : 'Estimated Pharmacist Response: 15–30 mins'}
            </span>
          </div>
        </div>
      </section>

      {/* Main Content 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (7 cols): What Happens Next & Live Timeline */}
        <div className="lg:col-span-7 flex flex-col gap-5">
          {/* Action Callout if Confirmed */}
          {isConfirmed && !isCheckoutComplete && (
            <div className="bg-[#ffffff] rounded-3xl p-5 border-2 border-[#2e685d] shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-full bg-[#e0f2eb] text-[#2e685d] flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-xl">shopping_cart_checkout</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#032f28]">Dispensary Approved Reservation!</h3>
                  <p className="text-xs text-[#52605b] mt-0.5 leading-relaxed">
                    Choose whether you will collect at counter or dispatch an Assistant, and finalize settlement.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleOpenCheckout}
                className="w-full sm:w-auto px-5 py-2.5 rounded-full bg-[#2e685d] hover:bg-[#1e453e] text-white text-xs font-extrabold shadow-md transition-all flex items-center justify-center gap-1.5 shrink-0"
              >
                <span className="material-symbols-outlined text-sm">arrow_forward</span>
                <span>Choose Mode &amp; Pay</span>
              </button>
            </div>
          )}

          {/* Live Dispensing Timeline Card */}
          <div className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/30 shadow-sm flex flex-col gap-5">
            <div className="flex items-center justify-between pb-3 border-b border-surface-container">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-primary">
                  <span className="material-symbols-outlined text-lg">timeline</span>
                </div>
                <h2 className="text-base font-bold text-primary">Live Dispensing Timeline</h2>
              </div>
              <span className={`text-[11px] font-bold font-mono px-2.5 py-0.5 rounded-full ${isConfirmed ? 'bg-[#b0ecdd] text-[#00201b]' : 'bg-surface-container text-on-surface-variant'}`}>
                Status: {status}
              </span>
            </div>

            {/* Step Progression */}
            <div className="flex flex-col relative pl-2">
              {/* Step 1: Complete */}
              <div className="flex items-start gap-3.5 pb-6 relative">
                <div className="absolute left-3.5 top-7 bottom-0 w-0.5 bg-secondary-container" />
                <div className="w-7 h-7 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center shrink-0 z-10 shadow-xs font-bold text-xs">
                  ✓
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-on-surface">Prescription Validated</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-surface-container text-secondary font-medium">Verified</span>
                  </div>
                  <p className="text-[11px] text-on-surface-variant mt-0.5">
                    Prescription signature and medicine names electronically verified against standardized pharmacopeia.
                  </p>
                </div>
              </div>

              {/* Step 2: Complete */}
              <div className="flex items-start gap-3.5 pb-6 relative">
                <div className="absolute left-3.5 top-7 bottom-0 w-0.5 bg-secondary-container" />
                <div className="w-7 h-7 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center shrink-0 z-10 shadow-xs font-bold text-xs">
                  <span className="material-symbols-outlined text-sm">send</span>
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-on-surface">Reservation Transmitted to Apothecary</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-surface-container text-secondary font-medium">Transmitted</span>
                  </div>
                  <p className="text-[11px] text-on-surface-variant mt-0.5">
                    Encrypted prescription payload delivered to {pharmacy?.name || 'pharmacy'} queue.
                  </p>
                </div>
              </div>

              {/* Step 3: Pharmacist Inspection */}
              <div className="flex items-start gap-3.5 pb-6 relative">
                <div className={`absolute left-3.5 top-7 bottom-0 w-0.5 ${isConfirmed ? 'bg-secondary-container' : 'bg-surface-container-high'}`} />
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 z-10 shadow-sm ${isConfirmed ? 'bg-secondary-container text-on-secondary-container font-bold text-xs' : 'bg-primary text-white ring-4 ring-secondary-container/40'}`}>
                  {isConfirmed ? '✓' : <span className="material-symbols-outlined text-sm animate-spin">sync</span>}
                </div>
                <div className={`flex flex-col gap-1 p-3.5 rounded-2xl w-full border ${isConfirmed ? 'bg-[#e0f2eb]/60 border-[#2e685d]/30' : 'bg-surface-container-low border-secondary/20'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="text-xs font-bold text-primary">Pharmacist Inspection &amp; Physical Stock Hold</span>
                    {isConfirmed ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#2e685d] text-white font-bold">
                        Stock Earmarked
                      </span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-white font-medium animate-pulse">
                        In Progress (15–30m)
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-on-surface-variant leading-relaxed">
                    {isConfirmed
                      ? 'Pharmacist has inspected shelf stock, verified batch expiration dates, and earmarked your requested medicines.'
                      : 'Dispensing pharmacist is reviewing medicine batches, verifying expiration seals, and placing items into a secure 24-hour reservation locker.'}
                  </p>
                </div>
              </div>

              {/* Step 4: Mode Selection & Payment */}
              <div className={`flex items-start gap-3.5 pb-6 relative ${isConfirmed ? 'opacity-100' : 'opacity-60'}`}>
                <div className="absolute left-3.5 top-7 bottom-0 w-0.5 bg-surface-container-high" />
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 z-10 text-xs ${isConfirmed ? 'bg-[#2e685d] text-white ring-4 ring-[#2e685d]/30' : 'bg-surface-container-high text-on-surface-variant'}`}>
                  <span className="material-symbols-outlined text-sm">shopping_cart_checkout</span>
                </div>
                <div className="flex flex-col w-full">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-on-surface">Choose Fulfillment Mode &amp; Payment</span>
                    {isConfirmed && !isCheckoutComplete && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#ba1a1a] text-white font-bold animate-pulse">
                        Action Required
                      </span>
                    )}
                    {isCheckoutComplete && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#2e685d] text-white font-bold">
                        Selected &amp; Confirmed
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-on-surface-variant mt-0.5 leading-relaxed">
                    {isCheckoutComplete
                      ? `Fulfillment chosen: ${currentOrder?.fulfillmentType || 'Counter Pickup'}. Settlement confirmed.`
                      : 'Select Counter Pickup or Medicine Access Assistant home delivery, and finalize settlement mode.'}
                  </p>
                  {isConfirmed && !isCheckoutComplete && (
                    <div className="mt-2 w-fit">
                      <FlowButton
                        size="sm"
                        variant="primary"
                        onClick={handleOpenCheckout}
                      >
                        Proceed to Checkout
                      </FlowButton>
                    </div>
                  )}
                </div>
              </div>

              {/* Step 5: Final Collection */}
              <div className={`flex items-start gap-3.5 relative ${isCheckoutComplete ? 'opacity-100' : 'opacity-60'}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 z-10 text-xs ${isReady ? 'bg-[#10b981] text-white' : 'bg-surface-container-high text-on-surface-variant'}`}>
                  <span className="material-symbols-outlined text-sm">verified_user</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-on-surface">PIN Verification &amp; Medicine Release</span>
                  <p className="text-[11px] text-on-surface-variant mt-0.5">
                    Present your 4-digit verification PIN upon counter pickup or assistant handover.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Notification Alert Capsule */}
          <div className="bg-surface-container rounded-2xl p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-surface-container-lowest text-secondary flex items-center justify-center shrink-0 shadow-xs">
                <span className="material-symbols-outlined text-xl">phonelink_ring</span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-bold text-on-surface">Real-Time Sync Active</span>
                <span className="text-[11px] text-on-surface-variant">Live updates connected to dispensary queue and notification center</span>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-secondary-container text-on-secondary-container text-[10px] font-bold shrink-0">
              Active Sync
            </span>
          </div>
        </div>

        {/* Right Column (5 cols): Pharmacy Summary & Financial Breakdown */}
        <div className="lg:col-span-5 flex flex-col gap-5 sticky top-24">
          <div className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/30 shadow-md flex flex-col gap-4">
            {pharmacy?.isTestRecord ? (
              <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-error-container text-on-error-container text-[10px] font-bold w-fit">
                <span className="material-symbols-outlined text-xs">science</span>
                <span>TEST DATA — NOT A PARTICIPATING PHARMACY</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[10px] font-bold w-fit">
                <span className="material-symbols-outlined text-xs">verified</span>
                <span>Participating Pharmacy</span>
              </div>
            )}

            <div>
              <span className="text-[10px] text-secondary font-bold uppercase tracking-wider block">Dispensing Partner</span>
              <h3 className="text-lg font-bold text-primary">{pharmacy?.name || 'Selected Dispensary'}</h3>
              <p className="text-xs text-on-surface-variant mt-0.5">{pharmacy?.address || 'Dispensary Location'}</p>
            </div>

            {/* Reserved Medicines List */}
            <div className="flex flex-col gap-2 pt-2 border-t border-surface-container">
              <span className="text-[10px] font-bold text-outline uppercase tracking-wider">
                Reserved Formulations ({items.length})
              </span>
              {items.map((i, idx) => (
                <div key={idx} className="flex items-center justify-between p-2.5 rounded-xl bg-surface-container-low text-xs">
                  <div className="flex flex-col">
                    <span className="font-bold text-primary">{i.brandName}</span>
                    <span className="text-[11px] text-on-surface-variant">Qty: x{i.quantity || 1}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[10px] font-bold">
                    Rx Verified
                  </span>
                </div>
              ))}
            </div>

            {/* 24-hr Hold Notice */}
            <div className="flex items-center gap-2 p-3 rounded-2xl bg-secondary-container/30 text-xs text-on-secondary-container">
              <span className="material-symbols-outlined text-base shrink-0">lock_clock</span>
              <span>Stock reservation secured for 24 hours. No re-allocation permitted.</span>
            </div>

            {/* Financial Breakdown Notice */}
            <div className="p-3.5 rounded-2xl bg-surface-container-low border border-surface-container flex flex-col gap-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-on-surface-variant">Charged to Card Online:</span>
                <span className="font-bold text-secondary font-mono text-sm">
                  {isPaid ? `₹${(currentOrder?.totalAmount || estimatedTotal).toFixed(2)} (PAID)` : '₹0.00'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-on-surface-variant font-medium">Est. Total:</span>
                <span className="font-extrabold text-primary font-mono text-base">₹{Number(estimatedTotal || 0).toFixed(2)}</span>
              </div>
              <span className="text-[10px] text-outline pt-1 border-t border-outline-variant/20">
                {isPaid
                  ? 'Payment completed via Razorpay escrow.'
                  : 'Final amount settled via chosen checkout method or at counter.'}
              </span>
            </div>

            {/* Primary Action Buttons */}
            <div className="flex flex-col gap-2.5 pt-2">
              {/* Highlighted Checkout Button when Confirmed */}
              {isConfirmed && !isCheckoutComplete && (
                <FlowButton
                  fullWidth
                  size="lg"
                  variant="primary"
                  onClick={handleOpenCheckout}
                >
                  Proceed to Checkout &amp; Choose Mode
                </FlowButton>
              )}

              <FlowButton
                fullWidth
                size="md"
                variant={isConfirmed && !isCheckoutComplete ? 'secondary' : 'primary'}
                onClick={onProceedToOrders}
                className="!py-3 !text-xs !font-bold"
              >
                View Full Order Journey
              </FlowButton>

              <div className="flex items-center gap-2">
                {onNavigateToCatalogue && (
                  <button
                    type="button"
                    onClick={onNavigateToCatalogue}
                    className="flex-1 py-2 rounded-full bg-surface-container hover:bg-surface-container-high text-primary font-semibold text-xs transition-colors"
                  >
                    Medicine Catalogue
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex-1 py-2 rounded-full bg-surface-container-lowest border border-outline-variant/30 text-on-surface-variant hover:text-primary text-xs font-semibold shadow-xs flex items-center justify-center gap-1 transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">print</span>
                  <span>Print Slip</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Embedded Checkout Modal */}
      {showCheckoutModal && (
        <CheckoutPage
          orderId={targetOrderId}
          onClose={() => setShowCheckoutModal(false)}
          onPaymentSuccess={() => {
            setShowCheckoutModal(false);
            if (onProceedToOrders) {
              onProceedToOrders();
            }
          }}
        />
      )}
    </div>
  );
}
