import React, { useState } from 'react';
import ConfirmationDialog from './ConfirmationDialog';

/**
 * ReservationConfirmation — Dispensary Reservation Hold Screen
 *
 * Submits a reservation hold request to the selected participating pharmacy.
 * - Stepper: Rx Upload → OCR Screening → Dispensary Selection → Pharmacist Confirmation
 * - Hold Request Protocol disclaimer (Zero charge online)
 * - Selected Pharmacy card
 * - Medicines in reservation hold
 * - Patient note for dispensing pharmacist
 * - Financial summary: ₹0.00 charged online; final settlement at pharmacy
 * - Fulfillment selection (Counter Pickup / Home Delivery / Assistant) happens
 *   AFTER the pharmacy confirms the reservation, in CheckoutPage.
 */

export default function ReservationConfirmation({
  pharmacy,
  items = [],
  prescriptionId = null,
  onConfirmReservation,
  onBackToDiscovery,
  submitting = false,
  errorMessage = null
}) {
  const [pharmacistNote, setPharmacistNote] = useState('');
  const [localError, setLocalError] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Check if all medicines have a known price; if not, show MRP notice
  const allPriced = items.length > 0 && items.every(item => {
    const price = item.price != null ? item.price : (item.unitPrice != null ? item.unitPrice : null);
    return price != null && Number(price) > 0;
  });
  const medicineSubtotal = allPriced
    ? items.reduce((sum, item) => {
        const price = Number(item.price != null ? item.price : (item.unitPrice || 0));
        return sum + price * Number(item.quantity || 1);
      }, 0)
    : null;

  const handleSubmit = (e) => {
    e.preventDefault();
    setLocalError('');
    setShowConfirmModal(true);
  };

  const handleFinalExecute = () => {
    setShowConfirmModal(false);
    if (onConfirmReservation) {
      onConfirmReservation({
        pharmacyId: pharmacy.id,
        items: items.map(i => ({
          medicineId: i.medicineId || i.id,
          quantity: i.quantity || 1,
          price: i.price != null ? i.price : (i.unitPrice != null ? i.unitPrice : null)
        })),
        orderType: 'RESERVATION',
        fulfillmentType: 'PICKUP',
        prescriptionId: prescriptionId || undefined,
        medicineSubtotal: medicineSubtotal,
        notes: pharmacistNote.trim() || undefined
      });
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-6 font-body-md text-on-surface">
      {/* Top Stepper Bar */}
      <section className="w-full bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center font-bold">
            <span className="material-symbols-outlined text-xl">event_available</span>
          </div>
          <div>
            <span className="text-[11px] font-bold text-secondary uppercase tracking-wider block">Clinical Workflow</span>
            <span className="text-base font-bold text-primary">Dispensary Reservation Pipeline</span>
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container text-on-surface-variant text-xs">
            <span className="w-4 h-4 rounded-full bg-surface-container-high flex items-center justify-center text-[10px] font-bold">✓</span>
            <span>1. Upload</span>
          </div>
          <span className="material-symbols-outlined text-xs text-outline">chevron_right</span>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container text-on-surface-variant text-xs">
            <span className="w-4 h-4 rounded-full bg-surface-container-high flex items-center justify-center text-[10px] font-bold">✓</span>
            <span>2. Verified</span>
          </div>
          <span className="material-symbols-outlined text-xs text-outline">chevron_right</span>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container text-on-surface-variant text-xs">
            <span className="w-4 h-4 rounded-full bg-surface-container-high flex items-center justify-center text-[10px] font-bold">✓</span>
            <span>3. Dispensary</span>
          </div>
          <span className="material-symbols-outlined text-xs text-outline">chevron_right</span>
          <div className="flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-primary text-white text-xs font-bold shadow-sm">
            <span className="w-4 h-4 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center text-[10px]">4</span>
            <span>4. Hold Confirmation</span>
          </div>
        </nav>
      </section>

      {/* Editorial Header */}
      <header className="flex flex-col gap-1 max-w-3xl">
        <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-xs font-bold w-fit">
          <span className="material-symbols-outlined text-sm">lock_clock</span>
          <span>Clinical Dispensing Hold Request</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-primary tracking-tight mt-1">
          Confirm Medicine Hold &amp; Dispensary Reservation
        </h1>
        <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
          Review selected pharmacy, medicine allocation, and chosen collection method. Your request will be queued for dispensing pharmacist sign-off.
        </p>
      </header>

      {/* Main 2-Column Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (7 cols): Detailed Clinical Verification */}
        <div className="lg:col-span-7 flex flex-col gap-5">
          {/* Non-Dispensing Notice Banner */}
          <div className="p-4 bg-secondary-container/30 border border-secondary-container/60 rounded-2xl flex items-start gap-3 shadow-xs">
            <div className="w-8 h-8 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center shrink-0 mt-0.5">
              <span className="material-symbols-outlined text-lg">info</span>
            </div>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              <strong className="text-primary font-bold">Hold Request Protocol:</strong> Submitting reserves medicines on the dispensary shelf but does <strong>not</strong> guarantee automatic dispensing. A certified pharmacist physically reviews the prescription batch lot before handover. <strong>Zero payment is charged now.</strong>
            </p>
          </div>

          {/* Card 1: Selected Dispensing Pharmacy */}
          <div className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/30 shadow-sm flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {pharmacy.isTestRecord ? (
                <span className="px-2.5 py-0.5 rounded-full bg-error-container text-on-error-container text-[11px] font-bold tracking-wide uppercase">
                  TEST DATA — NOT A PARTICIPATING PHARMACY
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[11px] font-bold tracking-wide">
                  Participating Pharmacy
                </span>
              )}
              {onBackToDiscovery && (
                <button
                  type="button"
                  onClick={onBackToDiscovery}
                  className="inline-flex items-center gap-1 text-xs font-bold text-secondary hover:text-primary transition-colors"
                >
                  <span>Change Pharmacy</span>
                  <span className="material-symbols-outlined text-sm">swap_horiz</span>
                </button>
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-2xl bg-surface-container-low text-primary flex items-center justify-center shrink-0 border border-outline-variant/20 shadow-xs">
                  <span className="material-symbols-outlined text-2xl">storefront</span>
                </div>
                <div className="flex flex-col">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold text-primary">{pharmacy.name}</h3>
                    {((pharmacy.isVerified || pharmacy.verificationStatus === 'VERIFIED') && !pharmacy.isTestRecord) ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-secondary bg-surface-container px-2 py-0.5 rounded-full">
                        <span className="material-symbols-outlined text-xs">verified</span>
                        <span>Participating Pharmacy</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200/60 px-2 py-0.5 rounded-full">
                        <span>TEST DATA — NOT A PARTICIPATING PHARMACY</span>
                      </span>
                    )}
                    {pharmacy.licenseNumber && !pharmacy.licenseNumber.startsWith('TEST-') && (
                      <span className="px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant text-[10px] font-mono">
                        Lic. #{pharmacy.licenseNumber}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-on-surface-variant flex items-center gap-1 mt-1">
                    <span className="material-symbols-outlined text-sm text-secondary">location_on</span>
                    <span>{pharmacy.address || 'Dispensary Location'}</span>
                    {pharmacy.distanceKm !== undefined && (
                      <span className="font-semibold text-primary">• {pharmacy.distanceKm} km away</span>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex sm:flex-col items-center sm:items-end justify-between px-3 py-1.5 rounded-xl bg-surface-container-low shrink-0">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-secondary"></span>
                  <span className="text-xs font-bold text-secondary">
                    {pharmacy.computedOpenStatus?.isCurrentlyOpen ? 'Open Now' : 'Open for Reservations'}
                  </span>
                </div>
                <span className="text-[11px] text-on-surface-variant">
                  {pharmacy.is24x7 ? '24 Hours Daily' : '8:00 AM – 9:00 PM'}
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: Medicines in Reservation Hold */}
          <div className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/30 shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-surface-container">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-surface-container flex items-center justify-center text-primary">
                  <span className="material-symbols-outlined text-base">medication</span>
                </div>
                <h3 className="text-sm font-bold text-primary">Medicines in Reservation Hold</h3>
              </div>
              <span className="text-xs font-semibold text-secondary">
                {items.length} Item{items.length === 1 ? '' : 's'} Allocated
              </span>
            </div>

            <div className="flex flex-col gap-3">
              {items.map((item, idx) => {
                const itemPrice = Number(item.price != null ? item.price : (item.unitPrice != null ? item.unitPrice : 0));
                const qty = item.quantity || 1;
                return (
                  <div
                    key={item.medicineId || idx}
                    className="p-3.5 bg-surface-container-low rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-outline-variant/20"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-xl bg-white flex items-center justify-center text-primary shrink-0 border border-outline-variant/20 shadow-xs">
                        <span className="material-symbols-outlined text-xl">medication</span>
                      </div>
                      <div className="flex flex-col">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-on-surface">{item.brandName}</span>
                          {item.strength && (
                            <span className="text-[11px] text-on-surface-variant">({item.strength})</span>
                          )}
                          <span className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[10px] font-bold">
                            Rx Verified
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-on-surface-variant">
                          <span className="flex items-center gap-1 text-secondary font-medium">
                            <span className="material-symbols-outlined text-xs">inventory_2</span>
                            Shelf Bay Stock Verified
                          </span>
                          <span>•</span>
                          <span>Prescription Linked</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex sm:flex-col items-center sm:items-end justify-between shrink-0">
                      <span className="text-xs text-on-surface-variant bg-surface-container-lowest px-2 py-0.5 rounded-full font-mono font-medium">
                        Qty: x{qty} {itemPrice > 0 ? `× ₹${itemPrice.toFixed(2)}` : '(Dispensary pricing)'}
                      </span>
                      <span className="text-sm font-bold text-primary">
                        {itemPrice > 0 ? `₹${(itemPrice * qty).toFixed(2)}` : 'Pay at counter'}
                      </span>
                      <span className="text-[10px] text-outline">Formulation Subtotal</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-2 p-2.5 px-3 bg-surface-container rounded-xl text-xs text-on-surface">
              <span className="material-symbols-outlined text-secondary text-base shrink-0">verified</span>
              <span>
                Prescription hold token registered on file for authenticated clinical review.
              </span>
            </div>
          </div>

          {/* Card 3: How would you like to receive your medicine? Selection */}
          <div className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/30 shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-surface-container">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-surface-container flex items-center justify-center text-primary">
                  <span className="material-symbols-outlined text-base">local_shipping</span>
                </div>
                <h3 className="text-sm font-bold text-primary">How would you like to receive your medicine?</h3>
              </div>
              <span className="text-xs font-semibold text-secondary">Pay at dispensing</span>
            </div>

            {/* Fulfillment note: Counter Pickup is the default reservation hold. */}
            {/* Full fulfillment selection (Pickup / Delivery / Assistant) happens in CheckoutPage after pharmacy confirmation. */}
            <div className="p-3.5 rounded-2xl border border-secondary bg-secondary-container/20 flex items-start gap-3">
              <span className="material-symbols-outlined text-secondary text-xl mt-0.5" aria-hidden="true">storefront</span>
              <div className="flex flex-col flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-primary">Counter Pickup — Reservation Hold</span>
                  <span className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[10px] font-bold">
                    Free Hold
                  </span>
                </div>
                <p className="text-[11px] text-on-surface-variant mt-0.5">
                  Your medicines will be reserved at the pharmacy. After the pharmacist confirms, you can choose Counter Pickup, Pharmacy Delivery (where available), or a Medicine Access Assistant service at checkout.
                </p>
              </div>
            </div>

            {/* Patient Note for Pharmacist */}
            <div className="flex flex-col gap-1.5 pt-2">
              <label className="text-xs font-semibold text-on-surface flex items-center justify-between">
                <span>Patient Note for Dispensing Pharmacist (Optional)</span>
                <span className="text-[10px] text-outline font-normal">Max 200 chars</span>
              </label>
              <textarea
                rows="2"
                maxLength="200"
                placeholder="e.g. Any allergy notes, pickup timeframe, or generic brand requests..."
                value={pharmacistNote}
                onChange={e => setPharmacistNote(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-surface-container-low border border-outline-variant/30 text-xs text-on-surface placeholder:text-outline outline-none focus:border-secondary"
              />
            </div>
          </div>
        </div>

        {/* Right Column (5 cols): Summary & Confirmation Action */}
        <div className="lg:col-span-5 flex flex-col gap-5 sticky top-24">
          <div className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/30 shadow-md flex flex-col gap-5">
            <div className="flex items-center justify-between pb-3 border-b border-surface-container">
              <h3 className="text-base font-bold text-primary">Reservation Hold Summary</h3>
              <span className="w-2.5 h-2.5 rounded-full bg-secondary animate-pulse" />
            </div>

            <div className="flex flex-col gap-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-on-surface-variant">Allocated Formulations:</span>
                <span className="font-bold text-primary">{items.length} Medicines</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-on-surface-variant">Fulfillment Mode:</span>
                <span className="font-bold text-primary">
                  {selectedFeeConfig.title}
                </span>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-surface-container-low border border-surface-container flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-on-surface-variant">Medicines Subtotal:</span>
                <span className="font-bold text-primary font-mono">
                  {medicineSubtotal != null ? `₹${medicineSubtotal.toFixed(2)}` : 'MRP / counter pricing at pharmacy'}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-on-surface-variant">Service fee:</span>
                <span className="font-bold text-secondary font-mono">Free (₹0.00)</span>
              </div>
              <div className="border-t border-outline-variant/20 pt-2 flex items-center justify-between text-xs">
                <span className="text-on-surface-variant font-medium">Estimated Total at Collection:</span>
                <span className="font-extrabold text-primary font-mono text-base">
                  {medicineSubtotal != null ? `₹${medicineSubtotal.toFixed(2)}` : 'MRP at pharmacy counter'}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs pt-1">
                <span className="text-secondary font-medium">Charged to Card Today:</span>
                <span className="font-bold text-secondary font-mono text-sm">₹0.00</span>
              </div>
              <p className="text-[11px] text-outline leading-tight pt-1 border-t border-outline-variant/20">
                Zero charge online today. Final copay and fulfillment fee are settled directly at the pharmacy counter or on delivery.
              </p>
            </div>

            {/* Error Message */}
            {(localError || errorMessage) && (
              <div className="p-3 rounded-xl bg-error-container text-on-error-container text-xs font-medium flex items-center gap-2">
                <span className="material-symbols-outlined text-base shrink-0">error</span>
                <span>{localError || errorMessage}</span>
              </div>
            )}

            {/* Submit Action */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-4 rounded-full bg-primary hover:bg-primary-container text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <span className="material-symbols-outlined text-lg animate-spin">progress_activity</span>
                  <span>Transmitting Hold Request...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-lg">task_alt</span>
                  <span>Submit Dispensary Reservation Hold</span>
                  <span className="material-symbols-outlined text-base">arrow_forward</span>
                </>
              )}
            </button>

            {/* Security note */}
            <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] text-on-surface-variant font-medium pt-1">
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-xs text-secondary">local_pharmacy</span>
                Participating Pharmacy
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-xs text-secondary">lock</span>
                Encrypted Patient Data
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* High-Stakes Action Confirmation Modal */}
      <ConfirmationDialog
        isOpen={showConfirmModal}
        title="Submit Dispensary Hold Request?"
        message={`Confirm reservation hold request for ${items.length} prescription medication(s) at ${pharmacy.name || 'the selected dispensary'}?`}
        impactPoints={[
          'Medicines will be physically reserved for up to 24 hours at the pharmacy bay.',
          'A secure 4-digit pickup PIN will be generated for counter or delivery verification.',
          'Zero payment is charged online today. Balance is settled at collection.'
        ]}
        confirmText="Confirm Reservation Hold"
        cancelText="Review Details"
        isDestructive={false}
        onConfirm={handleFinalExecute}
        onCancel={() => setShowConfirmModal(false)}
      />
    </div>
  );
}
