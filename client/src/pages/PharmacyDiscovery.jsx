import React, { useState, useEffect } from 'react';
import PharmacyMap from '../components/PharmacyMap';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import ReservationConfirmation from '../components/ReservationConfirmation';
import ReservationSuccess from '../components/ReservationSuccess';

const AREA_LANDMARKS = [
  { name: 'Chengannur area', lat: 9.3200, lon: 76.6160 },
  { name: 'Haripad area', lat: 9.2350, lon: 76.4700 },
  { name: 'Alappuzha area', lat: 9.4981, lon: 76.3388 },
  { name: 'Mavelikkara area', lat: 9.2650, lon: 76.5510 },
  { name: 'Thiruvalla area', lat: 9.3830, lon: 76.5740 }
];

/**
 * PharmacyDiscovery — Exact Stitch Screen Reconstruction (Part 6, 7, 8, 9)
 *
 * Implements:
 * - Stitch Screen `2b95309f81c045f1abea8aab143873f7` (Pharmacy Discovery List + Map)
 * - Stitch Screen `3b0524d631944328ba17f5eb1f3c4673` (Pharmacy Map & Location Exploration)
 * - Part 6A: Stitch Active Request Container showing verified medicines with counts & edit controls
 * - Part 6B/6C: Pharmacy cards with medicine-by-medicine availability breakdown
 * - Part 7: Minimal origin crosshair & interactive map cards
 * - Part 8: Dedicated Location Exploration mode with floating command bar & carousel HUD
 * - Part 9: Direct continuation into Reservation Confirmation -> Reservation Success -> My Orders
 */
export default function PharmacyDiscovery({
  onOrderCreated,
  selectedMedicines = [],
  onClearSelectedMedicines
}) {
  const [inMemoryCoords, setInMemoryCoords] = useState(null);
  const [selectedTown, setSelectedTown] = useState('Chengannur area');
  const [radiusKm, setRadiusKm] = useState(30);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState('best-match');

  // Filter Pills (matching Stitch)
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'full' | 'open' | 'emergency' | 'delivery'

  // View Mode: 'split' (Screen 6) | 'map-exploration' (Screen 7 / Part 8)
  const [viewMode, setViewMode] = useState('split');
  const [mobileTab, setMobileTab] = useState('list'); // 'list' | 'map' on mobile

  // Data & State
  const [pharmacies, setPharmacies] = useState([]);
  const [availabilityResults, setAvailabilityResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPharmacyForMap, setSelectedPharmacyForMap] = useState(null);
  const [selectedMapIndex, setSelectedMapIndex] = useState(0);

  // Reservation Flow: null | { stage: 'confirm' | 'success', pharmacy, items, order }
  const [reservationFlow, setReservationFlow] = useState(null);
  const [reservationSubmitting, setReservationSubmitting] = useState(false);
  const [reservationError, setReservationError] = useState(null);

  // Mini-search medicine selector state (if no active request items)
  const [medSelectorOpen, setMedSelectorOpen] = useState(false);
  const [miniSearchQuery, setMiniSearchQuery] = useState('');
  const [miniSearchResults, setMiniSearchResults] = useState([]);
  const [miniSearching, setMiniSearching] = useState(false);
  const [selectedCatalogMed, setSelectedCatalogMed] = useState(null);
  const [selectedQty, setSelectedQty] = useState(1);
  const [selectorError, setSelectorError] = useState('');

  // Fetch / Evaluate pharmacies & stock availability
  useEffect(() => {
    fetchPharmaciesAndAvailability();
  }, [inMemoryCoords, selectedTown, radiusKm, filterMode, selectedMedicines]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced mini-search
  useEffect(() => {
    if (!miniSearchQuery || miniSearchQuery.trim().length < 2) {
      setMiniSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setMiniSearching(true);
      try {
        const res = await fetch(`/api/medicines/search?query=${encodeURIComponent(miniSearchQuery.trim())}`);
        const data = await res.json();
        if (data.success) {
          setMiniSearchResults(data.medicines || []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setMiniSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [miniSearchQuery]);

  async function fetchPharmaciesAndAvailability() {
    setLoading(true);
    setError(null);
    try {
      const townObj = AREA_LANDMARKS.find(t => t.name === selectedTown) || AREA_LANDMARKS[0];
      const lat = inMemoryCoords ? inMemoryCoords.lat : townObj.lat;
      const lon = inMemoryCoords ? inMemoryCoords.lon : townObj.lon;

      // 1. If active request medicines exist, call match-availability for authoritative ranking & stock
      if (selectedMedicines && selectedMedicines.length > 0) {
        const payloadItems = selectedMedicines.map(m => ({
          medicineId: m.medicineId || m.id,
          brandName: m.brandName,
          quantity: m.quantity || 1
        }));

        const isEmergency = filterMode === 'emergency';
        const matchRes = await fetch('/api/pharmacies/match-availability', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: payloadItems,
            lat,
            lon,
            isEmergency
          })
        });

        if (!matchRes.ok) {
          throw new Error(`Unable to evaluate dispensary stock (Status ${matchRes.status}). Please try again.`);
        }

        const matchData = await matchRes.json();
        if (matchData.success && matchData.results) {
          setAvailabilityResults(matchData.results);
          // Extract pharmacy objects
          const pharms = matchData.results.map(r => {
            const rawAvail = r.itemStockDetails || r.availability || [];
            const availability = rawAvail.map(item => ({
              medicineId: item.medicineId,
              brandName: item.medicineName || item.brandName || 'Prescription Medicine',
              requestedQuantity: item.requestedQty || item.requestedQuantity || 1,
              stock: item.availableStock != null ? item.availableStock : (item.stock != null ? item.stock : 0),
              isAvailable: item.inStock ?? (item.availableStock > 0 || item.stock > 0),
              isLowStock: (item.availableStock > 0 && item.availableStock <= 10) || (item.stock > 0 && item.stock <= 10),
              unitPrice: item.unitPrice != null ? item.unitPrice : (item.price != null ? item.price : null),
              stockLastUpdated: item.stockLastUpdated
            }));

            return {
              ...r.pharmacy,
              distanceKm: r.distanceKm,
              totalScore: r.totalScore || r.score,
              isFullMatch: r.isFullMatch,
              matchedCount: r.matchedCount,
              totalRequested: r.totalRequested,
              availability,
              availabilitySummary: r.isFullMatch
                ? `All ${r.totalRequested} of ${r.totalRequested} In Stock`
                : `${r.matchedCount} of ${r.totalRequested} Available`
            };
          });
          setPharmacies(pharms);
          if (pharms.length > 0 && !selectedPharmacyForMap) {
            setSelectedPharmacyForMap(pharms[0]);
            setSelectedMapIndex(0);
          }
          setLoading(false);
          return;
        }
      }

      // 2. Standard Search Fallback if no active medicines requested
      const params = new URLSearchParams({
        lat: lat.toString(),
        lon: lon.toString(),
        radiusKm: radiusKm.toString()
      });

      if (filterMode === 'open') params.append('openNow', 'true');
      if (filterMode === 'emergency') params.append('is24x7', 'true');

      const res = await fetch(`/api/pharmacies/search?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Unable to fetch nearby pharmacies (Status ${res.status}). Please check network connectivity.`);
      }
      const data = await res.json();
      if (data.success) {
        const pharms = (data.pharmacies || []).map(p => ({
          ...p,
          availabilitySummary: 'Dispensary Shelf Stock'
        }));
        setPharmacies(pharms);
        setAvailabilityResults([]);
        if (pharms.length > 0 && !selectedPharmacyForMap) {
          setSelectedPharmacyForMap(pharms[0]);
          setSelectedMapIndex(0);
        }
      } else {
        throw new Error(data.error || 'Server returned an unsuccessful response while discovering pharmacies.');
      }
    } catch (err) {
      console.error('Error fetching pharmacies and availability:', err);
      setError(err.message || 'Unable to connect to dispensary network. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }

  const handleSelectTown = (town) => {
    setSelectedTown(town.name);
    setInMemoryCoords({ lat: town.lat, lon: town.lon });
  };

  // Select pharmacy -> Proceed to Reservation Confirmation (Part 9)
  const handleInitiateReservation = (pharmacy, itemsToReserve = null) => {
    let items = (Array.isArray(itemsToReserve) && itemsToReserve.length > 0)
      ? itemsToReserve
      : (selectedMedicines && selectedMedicines.length > 0 ? selectedMedicines : []);

    if (items.length === 0) {
      try {
        const savedReq = localStorage.getItem('medifind_medicine_request');
        if (savedReq) {
          const parsed = JSON.parse(savedReq);
          if (Array.isArray(parsed) && parsed.length > 0) items = parsed;
        }
      } catch (_) {}
    }

    // Fallback: If still empty, grab first stocked item from pharmacy or catalogue
    if (items.length === 0 && pharmacy.inventory && pharmacy.inventory.length > 0) {
      items = pharmacy.inventory.slice(0, 1).map(inv => ({
        medicineId: inv.medicineId || inv.id,
        brandName: inv.brandName || inv.medicine?.brandName || 'Prescription Medicine',
        quantity: 1,
        price: inv.price != null ? inv.price : null
      }));
    }

    const normalizedItems = items.map(i => {
      const medId = i.medicineId || i.id;
      const matchAvail = (pharmacy.availability || []).find(a => (a.medicineId || a.id) === medId);
      const matchInv = (pharmacy.inventory || []).find(inv => (inv.medicineId || inv.id) === medId);
      const resolvedPrice = i.price != null ? i.price : (i.unitPrice != null ? i.unitPrice : (matchAvail?.unitPrice != null ? matchAvail.unitPrice : (matchInv?.price != null ? matchInv.price : null)));
      return {
        medicineId: medId,
        brandName: i.brandName || i.medicineName || matchAvail?.brandName || matchInv?.medicine?.brandName || matchInv?.brandName || i.name || 'Prescription Medicine',
        genericName: i.genericName || matchAvail?.genericName || matchInv?.medicine?.genericName || '',
        strength: i.strength || matchAvail?.strength || matchInv?.medicine?.strength || '',
        quantity: i.quantity || i.requestedQuantity || i.requestedQty || 1,
        price: resolvedPrice,
        unitPrice: resolvedPrice
      };
    });

    setReservationFlow({
      stage: 'confirm',
      pharmacy,
      items: normalizedItems
    });
  };

  // Submit Reservation to Real Backend API (Part 9 & 10)
  const handleExecuteReservation = async (reservationData) => {
    setReservationSubmitting(true);
    setReservationError(null);
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(reservationData)
      });
      const data = await res.json();
      if (data.success && data.order) {
        // Transition to Reservation Success screen
        setReservationFlow(prev => ({
          stage: 'success',
          order: data.order,
          pharmacy: prev.pharmacy,
          items: prev.items
        }));
      } else {
        setReservationError(data.error || 'Failed to submit reservation hold request.');
      }
    } catch (err) {
      setReservationError('Communication error with server. Please check your connection.');
    } finally {
      setReservationSubmitting(false);
    }
  };

  // Filter and sort pharmacies
  const displayedPharmacies = pharmacies.filter(p => {
    if (filterMode === 'full' && !p.isFullMatch) return false;
    if (filterMode === 'open' && !p.computedOpenStatus?.isCurrentlyOpen) return false;
    if (filterMode === 'emergency' && !p.is24x7) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return p.name?.toLowerCase().includes(q) || p.address?.toLowerCase().includes(q);
  }).sort((a, b) => {
    if (sortOption === 'distance') return (a.distanceKm || 0) - (b.distanceKm || 0);
    if (sortOption === 'score') return (b.totalScore || 0) - (a.totalScore || 0);
    return 0; // Default order (from backend algorithm)
  });

  const activeCenter = inMemoryCoords
    ? [inMemoryCoords.lat, inMemoryCoords.lon]
    : [AREA_LANDMARKS[0].lat, AREA_LANDMARKS[0].lon];

  // ── RENDER RESERVATION STAGES (Part 9) ──────────────────────────────────
  if (reservationFlow?.stage === 'confirm') {
    return (
      <ReservationConfirmation
        pharmacy={reservationFlow.pharmacy}
        items={reservationFlow.items}
        onConfirmReservation={handleExecuteReservation}
        onBackToDiscovery={() => setReservationFlow(null)}
        submitting={reservationSubmitting}
        errorMessage={reservationError}
      />
    );
  }

  if (reservationFlow?.stage === 'success') {
    return (
      <ReservationSuccess
        order={reservationFlow.order}
        pharmacy={reservationFlow.pharmacy}
        items={reservationFlow.items}
        onProceedToOrders={() => {
          const ord = reservationFlow.order;
          setReservationFlow(null);
          if (onOrderCreated) onOrderCreated(ord);
        }}
        onNavigateToCatalogue={() => setReservationFlow(null)}
      />
    );
  }

  // ── RENDER SCREEN 7: PHARMACY MAP & LOCATION EXPLORATION (Part 8) ────────
  if (viewMode === 'map-exploration') {
    const currentPharm = displayedPharmacies[selectedMapIndex] || displayedPharmacies[0];
    return (
      <div className="relative w-full h-[calc(100vh-140px)] min-h-[600px] overflow-hidden flex flex-col font-body-md text-on-surface">
        {/* Full-bleed Leaflet Map */}
        <div className="absolute inset-0 w-full h-full z-0">
          <PharmacyMap
            pharmacies={displayedPharmacies}
            center={activeCenter}
            radiusKm={radiusKm}
            height="100%"
            selectedPharmacyId={currentPharm?.id}
            onSelectPharmacy={(p) => {
              const idx = displayedPharmacies.findIndex(x => x.id === p.id);
              if (idx >= 0) setSelectedMapIndex(idx);
              setSelectedPharmacyForMap(p);
            }}
            activeRequestItems={selectedMedicines}
          />
        </div>

        {/* FLOATING TOP OVERLAY COMMAND BAR (Stitch Screen 3b0524d631944328ba17f5eb1f3c4673) */}
        <div className="relative z-20 w-full max-w-7xl mx-auto px-4 pt-4 pointer-events-none">
          <div className="flex flex-col gap-2 pointer-events-auto">
            <div className="p-2 sm:p-2.5 rounded-2xl bg-surface-container-lowest/90 backdrop-blur-xl shadow-lg border border-outline-variant/30 flex flex-wrap items-center justify-between gap-3">
              {/* Back to Split List View */}
              <div className="flex items-center flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setViewMode('split')}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-surface-container-low text-primary hover:bg-primary hover:text-white transition-all text-xs font-bold shadow-xs"
                >
                  <span className="material-symbols-outlined text-base">arrow_back</span>
                  <span>Switch to Split List View</span>
                </button>

                {/* Active Prescription Request Capsule */}
                {selectedMedicines.length > 0 && (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-container text-xs text-on-surface">
                    <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
                    <span className="font-bold text-secondary uppercase tracking-wider text-[10px]">Active Request</span>
                    <span className="font-semibold text-primary truncate max-w-xs">
                      {selectedMedicines.length} Verified ({selectedMedicines.map(m => m.brandName).join(', ')})
                    </span>
                  </div>
                )}
              </div>

              {/* Search Origin Selector */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-surface-container-low text-xs">
                  <span className="material-symbols-outlined text-secondary text-base">near_me</span>
                  <div className="flex flex-col text-left leading-tight">
                    <span className="text-[10px] text-on-surface-variant font-medium">Search Origin</span>
                    <span className="font-bold text-primary">{selectedTown} ({radiusKm} km)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
              <button
                onClick={() => setFilterMode('all')}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold shadow-xs whitespace-nowrap transition-all ${
                  filterMode === 'all' ? 'bg-primary text-white' : 'bg-white/90 backdrop-blur-md text-on-surface hover:bg-surface-container'
                }`}
              >
                Show All ({pharmacies.length})
              </button>
              <button
                onClick={() => setFilterMode('full')}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold shadow-xs whitespace-nowrap transition-all flex items-center gap-1 ${
                  filterMode === 'full' ? 'bg-primary text-white' : 'bg-white/90 backdrop-blur-md text-on-surface hover:bg-surface-container'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-secondary" />
                <span>Full Availability</span>
              </button>
              <button
                onClick={() => setFilterMode('emergency')}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold shadow-xs whitespace-nowrap transition-all flex items-center gap-1 ${
                  filterMode === 'emergency' ? 'bg-tertiary-container text-white' : 'bg-white/90 backdrop-blur-md text-error hover:bg-[#ffdad6]'
                }`}
              >
                <span className="material-symbols-outlined text-sm">emergency</span>
                <span>24/7 Emergency</span>
              </button>
            </div>
          </div>
        </div>

        {/* BOTTOM-LEFT: SELECTED PHARMACY INTERACTIVE FLOATING CARD (Stitch Pin HUD) */}
        {currentPharm && (
          <div className="relative mt-auto w-full z-20 pointer-events-none p-4 md:p-6">
            <div className="max-w-xl pointer-events-auto bg-surface-container-lowest/95 backdrop-blur-xl rounded-3xl shadow-2xl p-5 border border-outline-variant/30 flex flex-col gap-3">
              {/* Status Banner */}
              {currentPharm.isTestRecord ? (
                <div className="flex items-center justify-between gap-2 bg-error-container text-on-error-container px-3 py-1 rounded-xl text-[11px] font-bold">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-xs">science</span>
                    <span>TEST DATA — NOT A PARTICIPATING PHARMACY</span>
                  </div>
                  <span className="font-mono text-[10px]">SANDBOX-RX</span>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2 bg-secondary-container text-on-secondary-container px-3 py-1 rounded-xl text-[11px] font-bold">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-xs">verified</span>
                    <span>Participating Pharmacy</span>
                  </div>
                  <span className="font-mono text-[10px]">VERIFIED-PARTICIPANT</span>
                </div>
              )}

              {/* Pharmacy Header & Carousel Steps */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-secondary">
                      {currentPharm.distanceKm != null ? `${currentPharm.distanceKm} km away` : 'Chengannur area'}
                    </span>
                    <span className="text-outline text-[10px]">•</span>
                    <span className="text-[11px] text-on-surface-variant font-medium">
                      {currentPharm.computedOpenStatus?.isCurrentlyOpen ? 'Open Now' : 'Open for Orders'}
                    </span>
                  </div>
                  <h3 className="text-base font-extrabold text-primary tracking-tight mt-0.5">
                    {currentPharm.name}
                  </h3>
                  <p className="text-xs text-on-surface-variant mt-0.5">{currentPharm.address}</p>
                </div>

                {/* Carousel Controls */}
                <div className="flex items-center gap-1 bg-surface-container-low px-2 py-1 rounded-full shrink-0">
                  <button
                    onClick={() => setSelectedMapIndex(prev => Math.max(0, prev - 1))}
                    disabled={selectedMapIndex === 0}
                    className="w-6 h-6 rounded-full flex items-center justify-center text-primary disabled:opacity-30"
                  >
                    <span className="material-symbols-outlined text-sm">chevron_left</span>
                  </button>
                  <span className="text-xs font-semibold px-1 text-on-surface-variant">
                    {selectedMapIndex + 1} / {displayedPharmacies.length}
                  </span>
                  <button
                    onClick={() => setSelectedMapIndex(prev => Math.min(displayedPharmacies.length - 1, prev + 1))}
                    disabled={selectedMapIndex === displayedPharmacies.length - 1}
                    className="w-6 h-6 rounded-full flex items-center justify-center text-primary disabled:opacity-30"
                  >
                    <span className="material-symbols-outlined text-sm">chevron_right</span>
                  </button>
                </div>
              </div>

              {/* Status & Availability Breakdown */}
              <div className="p-3 rounded-2xl bg-surface-container-low flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-primary flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-sm text-secondary">verified</span>
                    {currentPharm.availabilitySummary || 'Dispensary Inventory'}
                  </span>
                  <span className="text-[11px] text-secondary font-medium">
                    {currentPharm.isTestRecord || currentPharm.testDataNote ? 'Availability from test inventory' : 'Inventory verified'}
                  </span>
                </div>

                {currentPharm.availability && currentPharm.availability.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1 border-t border-outline-variant/20">
                    {currentPharm.availability.map((av, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2 rounded-xl bg-surface-container-lowest text-[11px]">
                        <span className="font-semibold text-primary">{av.brandName}</span>
                        <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                          av.isAvailable ? 'bg-secondary-container text-on-secondary-container' : 'bg-error-container text-on-error-container'
                        }`}>
                          {av.isAvailable ? `In Stock (${av.stock})` : 'Out of Stock'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Select Pharmacy CTA */}
              <button
                type="button"
                onClick={() => handleInitiateReservation(currentPharm)}
                className="w-full py-3 rounded-full bg-primary hover:bg-primary-container text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2"
              >
                <span>Reserve at this Pharmacy</span>
                <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── RENDER SCREEN 6: PHARMACY DISCOVERY (SPLIT LIST + MAP VIEW) ──────────
  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-6 font-body-md text-on-surface">
      {/* 6A — Top Context: Active Request / Verified Items Bar (Stitch Screen 2b95309f81c045f1abea8aab143873f7) */}
      <section className="bg-surface-container-lowest rounded-3xl p-5 sm:p-6 border border-outline-variant/30 shadow-sm flex flex-col gap-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
          {/* Active Request Card (7 cols) */}
          <div className="lg:col-span-7 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-secondary animate-pulse" />
                <span className="text-[11px] font-bold text-secondary uppercase tracking-wider">
                  Active Prescription Request
                </span>
                <span className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[11px] font-bold">
                  {selectedMedicines.length} Item{selectedMedicines.length === 1 ? '' : 's'} Linked
                </span>
              </div>
              {onClearSelectedMedicines && selectedMedicines.length > 0 && (
                <button
                  type="button"
                  onClick={onClearSelectedMedicines}
                  className="text-xs font-semibold text-tertiary hover:underline"
                >
                  Clear Request
                </button>
              )}
            </div>

            {selectedMedicines.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 mt-1">
                {selectedMedicines.map(m => (
                  <div
                    key={m.medicineId || m.id}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-container-low border border-outline-variant/30 text-xs"
                  >
                    <span className="material-symbols-outlined text-sm text-secondary">medication</span>
                    <span className="font-bold text-primary">{m.brandName}</span>
                    <span className="text-[11px] font-mono text-on-surface-variant font-medium bg-surface-container-lowest px-1.5 py-0.2 rounded">
                      x{m.quantity || 1}
                    </span>
                    <span className="text-[10px] text-secondary font-bold">✓ Verified</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-between p-3 rounded-2xl bg-surface-container-low border border-outline-variant/20 text-xs">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-secondary text-base">info</span>
                  <span className="text-on-surface-variant">
                    No verified prescription items linked yet. Search a formulation to test dispensary availability:
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setMedSelectorOpen(true)}
                  className="px-3 py-1 rounded-full bg-primary text-white text-xs font-bold shadow-xs"
                >
                  + Add Medicine
                </button>
              </div>
            )}
          </div>

          {/* Search Origin Tile (5 cols) */}
          <div className="lg:col-span-5 bg-surface-container-low rounded-2xl p-4 border border-outline-variant/30 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-base">near_me</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-secondary uppercase tracking-wider">Search Origin &amp; Radius</span>
                  <span className="text-xs font-bold text-primary">{selectedTown} ({radiusKm} km zone)</span>
                </div>
              </div>
              <span className="text-[10px] text-on-surface-variant bg-surface-container px-2 py-0.5 rounded-full font-medium">
                No GPS Stored
              </span>
            </div>

            {/* Quick Town Selectors */}
            <div className="flex flex-wrap gap-1 pt-1 border-t border-surface-container">
              {AREA_LANDMARKS.map(t => (
                <button
                  key={t.name}
                  onClick={() => handleSelectTown(t)}
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold transition-all ${
                    selectedTown === t.name
                      ? 'bg-primary text-white shadow-xs'
                      : 'bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container'
                  }`}
                >
                  {t.name.replace(' area', '')}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Filter Bar & Sorting Row (Stitch Screen 2b95309f81c045f1abea8aab143873f7 lines 101-136) */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-3 border-t border-surface-container">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 no-scrollbar">
            <button
              onClick={() => setFilterMode('all')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                filterMode === 'all'
                  ? 'bg-primary text-white shadow-xs'
                  : 'bg-surface-container-low text-on-surface hover:bg-surface-container'
              }`}
            >
              All Matching ({pharmacies.length})
            </button>

            <button
              onClick={() => setFilterMode('full')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 ${
                filterMode === 'full'
                  ? 'bg-primary text-white shadow-xs'
                  : 'bg-surface-container-low text-on-surface hover:bg-surface-container'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-secondary" />
              <span>Full Availability</span>
            </button>

            <button
              onClick={() => setFilterMode('open')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                filterMode === 'open'
                  ? 'bg-primary text-white shadow-xs'
                  : 'bg-surface-container-low text-on-surface hover:bg-surface-container'
              }`}
            >
              Open Now
            </button>

            <button
              onClick={() => setFilterMode('emergency')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1 ${
                filterMode === 'emergency'
                  ? 'bg-tertiary-container text-white shadow-xs'
                  : 'bg-surface-container-low text-error hover:bg-[#ffdad6]/40'
              }`}
            >
              <span className="material-symbols-outlined text-sm">emergency</span>
              <span>24/7 Emergency</span>
            </button>

            {/* Switch to Full Map Exploration Mode button (Part 8) */}
            <button
              onClick={() => setViewMode('map-exploration')}
              className="px-3.5 py-1.5 rounded-full text-xs font-bold bg-secondary-container text-on-secondary-container hover:bg-secondary-fixed transition-colors flex items-center gap-1 shrink-0"
            >
              <span className="material-symbols-outlined text-sm">explore</span>
              <span>Full Map Exploration</span>
            </button>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end md:self-auto">
            <span className="text-[11px] text-on-surface-variant font-medium">Ranked by:</span>
            <select
              value={sortOption}
              onChange={e => setSortOption(e.target.value)}
              className="h-8 px-3 rounded-full bg-surface-container-low border border-outline-variant/30 text-xs font-bold text-primary outline-none cursor-pointer"
            >
              <option value="best-match">Best Match &amp; Proximity</option>
              <option value="distance">Shortest Distance</option>
              <option value="score">Availability Score</option>
            </select>
          </div>
        </div>
      </section>

      {/* Mobile Tab Switcher (List vs Map) */}
      <div className="lg:hidden flex items-center bg-surface-container-low p-1 rounded-full border border-outline-variant/30 w-full max-w-xs mx-auto">
        <button
          type="button"
          onClick={() => setMobileTab('list')}
          className={`flex-1 py-1.5 px-3 rounded-full text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
            mobileTab === 'list'
              ? 'bg-primary text-white shadow-xs'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-sm">view_list</span>
          <span>List ({displayedPharmacies.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('map')}
          className={`flex-1 py-1.5 px-3 rounded-full text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
            mobileTab === 'map'
              ? 'bg-primary text-white shadow-xs'
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-sm">map</span>
          <span>Map View</span>
        </button>
      </div>

      {/* Main Split View: 55% List Area / 45% Map Area (Stitch Screen 2b95309f81c045f1abea8aab143873f7 lines 137-380) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Pharmacy Result Cards (7 cols = ~58%) */}
        <div className={`lg:col-span-7 flex flex-col gap-4 ${mobileTab === 'map' ? 'hidden lg:flex' : 'flex'}`}>
          {loading ? (
            <LoadingSkeleton type="table" count={4} />
          ) : error ? (
            <ErrorState
              title="Dispensary Discovery Offline / Error"
              message={error}
              onRetry={fetchPharmaciesAndAvailability}
            />
          ) : displayedPharmacies.length === 0 ? (
            <EmptyState
              icon="storefront"
              title="No participating dispensaries match your criteria"
              description="No pharmacies meet your active filters within this perimeter. Expand the search radius or reset filters."
              actionText="Expand Radius to 30km"
              onAction={() => setRadiusKm(30)}
            />
          ) : (
            displayedPharmacies.map((p, idx) => {
              const isCurrentlyOpen = p.computedOpenStatus?.isCurrentlyOpen;
              const openNote = p.computedOpenStatus?.note || (isCurrentlyOpen ? 'Open Now' : 'Closed');
              const isSelected = selectedPharmacyForMap?.id === p.id;
              const availabilityList = p.availability || [];

              return (
                <article
                  key={p.id}
                  className={`bg-surface-container-lowest rounded-3xl p-6 border shadow-sm transition-all flex flex-col gap-4 relative overflow-hidden ${
                    isSelected ? 'border-primary ring-2 ring-primary/10 shadow-md' : 'border-outline-variant/30 hover:border-secondary'
                  }`}
                >
                  {/* Compliance Flag & Verification Badge */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    {(p.isVerified || p.verificationStatus === 'VERIFIED') && !p.isTestRecord ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-secondary bg-surface-container px-2.5 py-0.5 rounded-full">
                        <span className="material-symbols-outlined text-xs">verified</span>
                        <span>Participating Pharmacy</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-error-container text-on-error-container text-[11px] font-bold">
                        <span className="material-symbols-outlined text-xs">science</span>
                        <span>TEST DATA — NOT A PARTICIPATING PHARMACY</span>
                      </span>
                    )}
                    {p.licenseNumber && !p.licenseNumber.startsWith('TEST-') && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-on-surface-variant bg-surface-container-low px-2 py-0.5 rounded-full">
                        <span className="material-symbols-outlined text-xs">badge</span>
                        <span>Lic. #{p.licenseNumber}</span>
                      </span>
                    )}
                  </div>

                  {/* Header & Ranking Metadata */}
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pt-1">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold text-primary tracking-tight">{p.name}</h2>
                        <span className="w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center text-[10px] font-bold">
                          {idx + 1}
                        </span>
                      </div>
                      <p className="text-xs text-on-surface-variant flex items-center gap-1 mt-0.5">
                        <span className="material-symbols-outlined text-sm text-secondary">location_on</span>
                        <span>{p.address} • <strong>{p.distanceKm != null ? `${p.distanceKm} km away` : 'Chengannur area'}</strong></span>
                      </p>
                    </div>

                    {p.googleMapsUrl && (
                      <div className="text-left sm:text-right shrink-0">
                        <a
                          href={p.googleMapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-secondary/10 hover:bg-secondary/20 text-secondary text-xs font-bold transition-colors"
                        >
                          <span className="material-symbols-outlined text-sm">map</span>
                          <span>Google Maps</span>
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Ranking Badges */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-secondary-container text-on-secondary-container text-xs font-bold">
                      <span className="material-symbols-outlined text-sm">check_circle</span>
                      <span>{p.availabilitySummary || 'Available Stock'}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container text-primary text-xs font-medium">
                      <span className="material-symbols-outlined text-xs">navigation</span>
                      <span>{p.distanceKm != null ? `${p.distanceKm} km` : 'Chengannur'}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container text-on-surface-variant text-xs font-medium">
                      <span className="material-symbols-outlined text-xs text-secondary">schedule</span>
                      <span>{openNote}</span>
                    </span>
                  </div>

                  {/* Operational Breakdown */}
                  <div className="p-3 rounded-2xl bg-surface-container-low text-xs flex flex-col gap-1.5 border border-outline-variant/20">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1 text-on-surface-variant">
                        <span className="material-symbols-outlined text-sm text-secondary">shopping_bag</span>
                        Dispensing Method
                      </span>
                      <span className="font-bold text-primary">In-Store Counter &amp; Assistant Dispatch</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1 text-on-surface-variant">
                        <span className="material-symbols-outlined text-sm text-secondary">history</span>
                        Availability Freshness
                      </span>
                      <span className="text-secondary font-medium">
                        {p.lastUpdated ? `Availability last updated: ${new Date(p.lastUpdated).toLocaleDateString()}` : 'Pharmacy-Provided Data'}
                      </span>
                    </div>
                  </div>

                  {/* Part 6B: Medicine Fulfillment Breakdown Details (Exact medicine-by-medicine breakdown!) */}
                  {availabilityList.length > 0 && (
                    <div className="flex flex-col gap-1.5 pt-1">
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block">
                        Inventory Verification Breakdown ({availabilityList.length} Item{availabilityList.length === 1 ? '' : 's'}):
                      </span>
                      <div className="flex flex-col gap-1.5">
                        {availabilityList.map((av, avIdx) => {
                          const isAvail = av.isAvailable;
                          return (
                            <div
                              key={avIdx}
                              className="flex items-center justify-between p-2.5 rounded-xl bg-surface-container-low border border-outline-variant/20 text-xs"
                            >
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${
                                  isAvail ? 'bg-secondary' : 'bg-error'
                                }`} />
                                <div className="flex flex-col">
                                  <span className="font-bold text-primary">{av.brandName}</span>
                                  <span className="text-[11px] text-on-surface-variant">
                                    {av.requestedQuantity || 1} unit(s) requested
                                  </span>
                                </div>
                              </div>
                              <div className="text-right">
                                <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold inline-block ${
                                  isAvail
                                    ? 'bg-secondary-container text-on-secondary-container'
                                    : 'bg-[#ffdad6] text-error'
                                }`}>
                                  {isAvail ? 'Available' : 'Not available at this pharmacy'}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Action Buttons: Inspect & Select Pharmacy -> Reservation Confirmation */}
                  <div className="pt-2 flex flex-col sm:flex-row items-center gap-2 border-t border-surface-container">
                    <button
                      type="button"
                      onClick={() => handleInitiateReservation(p, selectedMedicines.length > 0 ? selectedMedicines : availabilityList)}
                      className="w-full sm:flex-1 py-3 px-4 rounded-full bg-primary hover:bg-primary-container text-white font-bold text-xs shadow-sm transition-all flex items-center justify-center gap-2"
                    >
                      <span>Inspect &amp; Select Pharmacy</span>
                      <span className="material-symbols-outlined text-sm">arrow_forward</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPharmacyForMap(p);
                        const idx = displayedPharmacies.findIndex(x => x.id === p.id);
                        if (idx >= 0) setSelectedMapIndex(idx);
                        setViewMode('map-exploration');
                      }}
                      className="w-full sm:w-auto py-3 px-5 rounded-full bg-surface-container hover:bg-surface-container-high text-primary font-bold text-xs transition-colors flex items-center justify-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-sm">place</span>
                      <span>View on Map</span>
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>

        {/* Right Column: Leaflet Map (5 cols = ~42%) */}
        <div id="side-pharmacy-map" className={`lg:col-span-5 sticky top-24 ${mobileTab === 'list' ? 'hidden lg:block' : 'block'}`}>
          <PharmacyMap
            pharmacies={displayedPharmacies}
            center={activeCenter}
            radiusKm={radiusKm}
            height="520px"
            selectedPharmacyId={selectedPharmacyForMap?.id}
            onSelectPharmacy={(p) => {
              setSelectedPharmacyForMap(p);
              handleInitiateReservation(p, selectedMedicines.length > 0 ? selectedMedicines : availabilityList);
            }}
            activeRequestItems={selectedMedicines}
          />
        </div>
      </div>

      {/* Mini-Search Medicine Selector Modal */}
      {medSelectorOpen && (
        <div
          className="fixed inset-0 z-[1100] flex items-center justify-center p-4 bg-on-surface/50 backdrop-blur-sm"
          onClick={() => setMedSelectorOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-surface-container-lowest rounded-3xl p-6 sm:p-7 shadow-2xl border border-outline-variant/30 flex flex-col gap-4 animate-in zoom-in-95 duration-150"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-surface-container">
              <h3 className="text-lg font-bold text-primary">Select Medicine to Evaluate Stock</h3>
              <button
                onClick={() => setMedSelectorOpen(false)}
                className="w-8 h-8 rounded-full hover:bg-surface-container text-on-surface-variant flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-base pointer-events-none">
                search
              </span>
              <input
                type="text"
                placeholder="Type brand name (e.g. Paracetamol, Dolo, Augmentin)..."
                value={miniSearchQuery}
                onChange={e => setMiniSearchQuery(e.target.value)}
                autoFocus
                className="w-full h-11 pl-9 pr-3 rounded-xl bg-surface-container-low border border-outline-variant/30 text-xs text-on-surface outline-none focus:border-secondary"
              />
            </div>

            {miniSearching ? (
              <div className="py-6 text-center text-xs text-on-surface-variant">Searching catalog...</div>
            ) : miniSearchResults.length > 0 ? (
              <div className="max-h-52 overflow-y-auto flex flex-col gap-1 border border-outline-variant/30 rounded-2xl p-1 bg-surface-container-low">
                {miniSearchResults.map(m => {
                  const isChosen = selectedCatalogMed?.id === m.id;
                  return (
                    <div
                      key={m.id}
                      onClick={() => { setSelectedCatalogMed(m); setSelectorError(''); }}
                      className={`p-2.5 rounded-xl cursor-pointer flex items-center justify-between transition-colors ${
                        isChosen ? 'bg-secondary-container/50 text-on-secondary-container' : 'hover:bg-surface-container'
                      }`}
                    >
                      <div className="flex flex-col text-xs">
                        <span className="font-bold text-primary">{m.brandName}</span>
                        <span className="text-[11px] text-on-surface-variant">{m.genericName} • {m.category}</span>
                      </div>
                      {isChosen && (
                        <span className="material-symbols-outlined text-secondary text-base">check_circle</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : miniSearchQuery.trim().length >= 2 ? (
              <div className="py-6 text-center text-xs text-on-surface-variant">No medicines matched &quot;{miniSearchQuery}&quot;.</div>
            ) : (
              <div className="py-6 text-center text-xs text-on-surface-variant">Type at least 2 characters to search catalog formulations.</div>
            )}

            {selectedCatalogMed && (
              <div className="p-3 rounded-2xl bg-surface-container flex items-center justify-between text-xs">
                <div>
                  <span className="text-[10px] text-secondary font-bold uppercase block">Selected:</span>
                  <span className="font-bold text-primary">{selectedCatalogMed.brandName}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-on-surface-variant">Qty:</span>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={selectedQty}
                    onChange={e => setSelectedQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-14 h-8 text-center rounded-lg bg-white border border-outline-variant/30 text-xs font-mono"
                  />
                </div>
              </div>
            )}

            {selectorError && (
              <p className="text-xs text-error font-medium">{selectorError}</p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-surface-container">
              <button
                onClick={() => setMedSelectorOpen(false)}
                className="px-4 py-2 rounded-full bg-surface-container text-primary text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!selectedCatalogMed) {
                    setSelectorError('Please select a medicine formulation.');
                    return;
                  }
                  handleInitiateReservation(displayedPharmacies[0], [{
                    medicineId: selectedCatalogMed.id,
                    brandName: selectedCatalogMed.brandName,
                    quantity: selectedQty
                  }]);
                  setMedSelectorOpen(false);
                }}
                disabled={!selectedCatalogMed}
                className="px-5 py-2 rounded-full bg-primary hover:bg-primary-container text-white text-xs font-bold disabled:opacity-50 transition-all"
              >
                Evaluate &amp; Select
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
