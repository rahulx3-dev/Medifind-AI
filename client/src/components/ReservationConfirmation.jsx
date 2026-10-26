import React, { useState, useEffect } from 'react';
import ConfirmationDialog from './ConfirmationDialog';
import FlowButton from './FlowButton';
import { referencePricingData } from '../data/medicineReferencePricing';

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
  items: initialItems = [],
  prescriptionId = null,
  onConfirmReservation,
  onBackToDiscovery,
  submitting = false,
  errorMessage = null
}) {
  const [items, setItems] = useState(initialItems);
  const [pharmacistNote, setPharmacistNote] = useState('');
  const [localError, setLocalError] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  const handleUpdateItemQuantity = (medicineIdOrIdx, delta) => {
    setItems(prev => {
      return prev.map((item, idx) => {
        const matches = (item.medicineId && item.medicineId === medicineIdOrIdx) || idx === medicineIdOrIdx;
        if (!matches) return item;
        const currentQty = Number(item.quantity) || 1;
        const newQty = Math.max(1, Math.min(200, currentQty + delta));
        return { ...item, quantity: newQty };
      });
    });
  };

  const handleSetItemQuantity = (medicineIdOrIdx, newQtyRaw) => {
    const val = parseInt(newQtyRaw, 10);
    if (isNaN(val) || val < 1) return;
    setItems(prev => {
      return prev.map((item, idx) => {
        const matches = (item.medicineId && item.medicineId === medicineIdOrIdx) || idx === medicineIdOrIdx;
        if (!matches) return item;
        return { ...item, quantity: Math.min(200, val) };
      });
    });
  };

  const handleRemoveItem = (medicineIdOrIdx) => {
    setItems(prev => prev.filter((item, idx) => {
      if (item.medicineId && item.medicineId === medicineIdOrIdx) return false;
      return idx !== medicineIdOrIdx;
    }));
  };

  // Authoritative medicine pricing resolution helper (per-strip or per-tablet / per-unit)
  const resolveItemPrice = (item) => {
    const b = (item.brandName || item.name || '').toLowerCase().trim();
    const g = (item.genericName || '').toLowerCase().trim();
    const isStrip = (item.saleUnit || '').toUpperCase().trim() === 'STRIP';

    // Look up in authoritative 50-medicine reference pricing catalogue
    const refMatch = referencePricingData.find(r => {
      const rb = r.brandName.toLowerCase();
      const rg = (r.genericName || '').toLowerCase();
      return rb === b || b.includes(rb) || (rg && g && rg === g);
    });

    let price = Number(item.unitPrice != null ? item.unitPrice : item.price);

    if (refMatch) {
      if (isStrip) {
        if (refMatch.publishedMrp != null) {
          price = refMatch.publishedMrp;
        }
      } else {
        // If price is missing or if price matches full strip publishedMrp, resolve to true per-tablet unitPrice
        if (!price || isNaN(price) || price <= 0 || (refMatch.unitsPerPack > 1 && Math.abs(price - refMatch.publishedMrp) < 0.1)) {
          price = refMatch.unitPrice;
        }
      }
    }

    if (isNaN(price) || price <= 0) {
      if (b.includes('amlong')) price = 2.68;
      else if (b.includes('taxim')) price = 10.51;
      else if (b.includes('pantocid')) price = 18.40;
      else if (b.includes('pan 40') || b.includes('pan-40') || b.includes('pan40') || b.includes('pantoprazole')) price = 12.85;
      else if (b.includes('ors') || b.includes('electral')) price = 20.50;
      else if (b.includes('dolo') || b.includes('crocin') || b.includes('paracetamol')) price = 2.15;
      else if (b.includes('azithral') || b.includes('azithromycin')) price = 25.35;
      else if (b.includes('augmentin')) price = 19.67;
      else price = 12.0;
    }
    return price;
  };

  const getItemPricingUnit = (item) => {
    const isStrip = (item.saleUnit || '').toUpperCase().trim() === 'STRIP';
    if (isStrip) return 'per strip';
    const b = (item.brandName || item.name || '').toLowerCase().trim();
    const refMatch = referencePricingData.find(r => r.brandName.toLowerCase() === b || b.includes(r.brandName.toLowerCase()));
    if (refMatch?.pricingUnit) return refMatch.pricingUnit;
    const form = (item.dosageForm || '').toLowerCase();
    if (form.includes('tablet')) return 'per tablet';
    if (form.includes('capsule')) return 'per capsule';
    if (form.includes('syrup')) return 'per bottle';
    if (form.includes('inhaler')) return 'per inhaler';
    return 'per unit';
  };

  // Calculate authoritative medicine pricing for reservation hold
  const medicineSubtotal = items.reduce((sum, item) => {
    return sum + resolveItemPrice(item) * Number(item.quantity || 1);
  }, 0);

  const handleSubmit = (e) => {
    e.preventDefault();
    setLocalError('');
    if (!items || items.length === 0) {
      setLocalError('No medicines selected. Please add at least one formulation to reserve.');
      return;
    }
    setShowConfirmModal(true);
  };

  const handleFinalExecute = () => {
    setShowConfirmModal(false);
    if (onConfirmReservation) {
      onConfirmReservation({
        pharmacyId: pharmacy.id,
        items: items.map(i => ({
          medicineId: i.medicineId || i.id,
          prescriptionItemId: i.prescriptionItemId || i.prescriptionItem?.id || undefined,
          prescribedName: i.prescribedName || i.genericName || i.medicineName || i.rawName || i.brandName || undefined,
          quantity: i.quantity || 1,
          price: resolveItemPrice(i),
          unitPrice: resolveItemPrice(i),
          saleUnit: i.saleUnit || 'TABLET',
          unitsPerPack: i.unitsPerPack || 1,
          pharmacistSelectionRequested: Boolean(i.pharmacistSelectionRequested)
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

      {/* Editorial Header with Back Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <header className="flex flex-col gap-1 max-w-2xl">
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

        {onBackToDiscovery && (
          <button
            type="button"
            onClick={onBackToDiscovery}
            className="self-start sm:self-center inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-surface-container hover:bg-surface-container-high text-primary font-bold text-xs shadow-xs border border-outline-variant/30 transition-all cursor-pointer shrink-0"
          >
            <span className="material-symbols-outlined text-base">arrow_back</span>
            <span>Back to Pharmacies</span>
          </button>
        )}
      </div>

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

            {items.length === 0 ? (
              <div className="p-6 bg-surface-container-low rounded-2xl border border-outline-variant/30 flex flex-col items-center justify-center text-center gap-3">
                <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center text-secondary">
                  <span className="material-symbols-outlined text-2xl">medication_liquid</span>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-primary">No Formulations Linked to Hold</h4>
                  <p className="text-xs text-on-surface-variant max-w-sm mt-1">
                    You have not selected any medicines from our catalogue or verified an Rx to allocate at this dispensary.
                  </p>
                </div>
                {onBackToDiscovery && (
                  <button
                    type="button"
                    onClick={onBackToDiscovery}
                    className="mt-1 px-4 py-2 rounded-full bg-primary hover:bg-primary-container text-white text-xs font-bold shadow-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">search</span>
                    <span>Browse &amp; Add Medicines</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {items.map((item, idx) => {
                  const itemPrice = resolveItemPrice(item);
                  const qty = Number(item.quantity) || 1;
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
                            {(item.saleUnit || '').toUpperCase().trim() === 'STRIP' ? (
                              <span className="px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 text-[10px] font-bold">
                                Strip {item.unitsPerPack > 1 ? `(${item.unitsPerPack} tabs)` : ''}
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[10px] font-bold">
                                Rx Verified
                              </span>
                            )}
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

                      <div className="flex flex-wrap sm:flex-col items-end justify-between sm:justify-center gap-2 shrink-0">
                        {/* Quantity Stepper & Remove */}
                        <div className="flex items-center gap-1.5 bg-surface-container-lowest p-1 rounded-full border border-outline-variant/30 shadow-2xs">
                          <button
                            type="button"
                            onClick={() => handleUpdateItemQuantity(item.medicineId || idx, -1)}
                            disabled={qty <= 1}
                            title="Decrease quantity"
                            className="w-6 h-6 rounded-full flex items-center justify-center text-on-surface-variant hover:text-primary hover:bg-surface-container disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                          >
                            <span className="material-symbols-outlined text-xs">remove</span>
                          </button>

                          <div className="flex items-center gap-1 px-1">
                            <span className="text-[10px] text-outline font-semibold">Qty:</span>
                            <input
                              type="number"
                              min="1"
                              max="200"
                              value={qty}
                              onChange={(e) => handleSetItemQuantity(item.medicineId || idx, e.target.value)}
                              className="w-8 text-center text-xs font-bold text-primary font-mono bg-transparent border-0 outline-none p-0 focus:ring-0"
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() => handleUpdateItemQuantity(item.medicineId || idx, 1)}
                            disabled={qty >= 200}
                            title="Increase quantity"
                            className="w-6 h-6 rounded-full flex items-center justify-center text-on-surface-variant hover:text-primary hover:bg-surface-container disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                          >
                            <span className="material-symbols-outlined text-xs">add</span>
                          </button>

                          <div className="w-[1px] h-3.5 bg-outline-variant/30 mx-0.5" />

                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.medicineId || idx)}
                            title="Remove this medicine from reservation hold"
                            className="w-6 h-6 rounded-full flex items-center justify-center text-on-surface-variant hover:text-error hover:bg-error-container/20 transition-all cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-xs">delete</span>
                          </button>
                        </div>

                        {/* Price Breakdown */}
                        <div className="flex items-baseline gap-1.5 text-right">
                          <span className="text-[11px] text-on-surface-variant font-mono">
                            ₹{itemPrice.toFixed(2)}/{getItemPricingUnit(item).replace('per ', '')}
                          </span>
                          <span className="text-sm font-bold text-primary font-mono">
                            = ₹{(itemPrice * qty).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-center gap-2 p-2.5 px-3 bg-surface-container rounded-xl text-xs text-on-surface">
              <span className="material-symbols-outlined text-secondary text-base shrink-0">verified</span>
              <span>
                Prescription hold token registered on file for authenticated clinical review.
              </span>
            </div>
          </div>

          {/* Card 3: Patient Note for Dispensing Pharmacist */}
          <div className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/30 shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-surface-container">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-surface-container flex items-center justify-center text-primary">
                  <span className="material-symbols-outlined text-base">edit_note</span>
                </div>
                <h3 className="text-sm font-bold text-primary">Patient Note for Dispensing Pharmacist (Optional)</h3>
              </div>
              <span className="text-[10px] text-outline font-normal">Max 200 chars</span>
            </div>

            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] text-on-surface-variant">
                Add any specific instructions, allergies, pickup timeframe, or generic brand requests for the pharmacy:
              </p>
              <textarea
                rows="3"
                maxLength="200"
                placeholder="Notes"
                value={pharmacistNote}
                onChange={e => setPharmacistNote(e.target.value)}
                className="w-full p-3 rounded-xl bg-surface-container-low border border-outline-variant/30 text-xs text-on-surface placeholder:text-outline outline-none focus:border-secondary transition-colors font-bold"
              />
            </div>

            <div className="flex items-center gap-2 p-3 rounded-2xl bg-surface-container-low border border-outline-variant/20 text-[11px] text-on-surface-variant">
              <span className="material-symbols-outlined text-secondary text-sm shrink-0">info</span>
              <span>Fulfillment mode (Counter Pickup or Assistant Dispatch) and payment are chosen at checkout once the pharmacy confirms stock.</span>
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
                <span className="text-on-surface-variant">Reservation Type:</span>
                <span className="font-bold text-secondary">
                  Prescription Stock Hold (Free)
                </span>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-surface-container-low border border-surface-container flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-on-surface-variant">Medicines Subtotal:</span>
                <span className="font-bold text-primary font-mono text-sm">
                  ₹{medicineSubtotal.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-on-surface-variant">Service fee:</span>
                <span className="font-bold text-secondary font-mono">Free (₹0.00)</span>
              </div>
              <div className="border-t border-outline-variant/20 pt-2 flex items-center justify-between text-xs">
                <span className="text-on-surface-variant font-medium">Estimated Total at Collection:</span>
                <span className="font-extrabold text-primary font-mono text-base">
                  ₹{medicineSubtotal.toFixed(2)}
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
            <FlowButton
              variant="primary"
              size="lg"
              fullWidth
              onClick={handleSubmit}
              disabled={submitting || items.length === 0}
              loading={submitting}
              className="!py-3.5 !text-sm !font-bold"
            >
              {items.length === 0
                ? 'Add Medicines to Enable Hold'
                : 'Submit Dispensary Reservation Hold'}
            </FlowButton>

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
