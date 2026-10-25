import React, { useState, useEffect, useMemo } from 'react';
import PharmacyMap from '../components/PharmacyMap';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import ReservationConfirmation from '../components/ReservationConfirmation';
import ReservationSuccess from '../components/ReservationSuccess';
import { broadcastUpdate } from '../utils/realtimeUpdates';
import { referencePricingData } from '../data/medicineReferencePricing';
import RollingNumber from '../components/ui/RollingNumber';
import FlowButton from '../components/FlowButton';

const AREA_LANDMARKS = [
  { name: 'Chengannur area', lat: 9.3170, lon: 76.6145 },
  { name: 'Haripad area', lat: 9.2350, lon: 76.4700 },
  { name: 'Kallissery area', lat: 9.3250, lon: 76.6200 },
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
  onClearSelectedMedicines,
  onRemoveMedicine,
  onUpdateQuantity,
  prescriptionId = null
}) {
  const [inMemoryCoords, setInMemoryCoords] = useState(null);
  const [selectedTown, setSelectedTown] = useState('Chengannur area');
  const [radiusKm, setRadiusKm] = useState(30);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState('best-match');
  const [gpsStatus, setGpsStatus] = useState('Detecting GPS...');
  const [isLocating, setIsLocating] = useState(false);
  const [activeMedicineTab, setActiveMedicineTab] = useState('all');

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
  // Persisted in sessionStorage so navigating away and returning to 'pharmacy' stays in checkout if no order was placed yet
  const [reservationFlow, setReservationFlow] = useState(() => {
    try {
      const saved = sessionStorage.getItem('medifind_pending_reservation_flow');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.stage === 'confirm' && parsed.pharmacy && Array.isArray(parsed.items) && parsed.items.length > 0) {
          return parsed;
        }
      }
    } catch (_) {}
    return null;
  });
  const [reservationSubmitting, setReservationSubmitting] = useState(false);
  const [reservationError, setReservationError] = useState(null);

  // Sync reservationFlow to sessionStorage whenever it changes
  useEffect(() => {
    try {
      if (reservationFlow && reservationFlow.stage === 'confirm') {
        sessionStorage.setItem('medifind_pending_reservation_flow', JSON.stringify(reservationFlow));
      } else {
        sessionStorage.removeItem('medifind_pending_reservation_flow');
      }
    } catch (_) {}
  }, [reservationFlow]);

  // Listen for direct reservation events (e.g. from Medi AI assistant)
  useEffect(() => {
    const handleDirectReservationEvent = (e) => {
      if (e?.detail && e.detail.stage === 'confirm' && e.detail.pharmacy) {
        setReservationFlow(e.detail);
      }
    };
    window.addEventListener('medifind_open_reservation', handleDirectReservationEvent);
    return () => window.removeEventListener('medifind_open_reservation', handleDirectReservationEvent);
  }, []);

  // Mini-search medicine selector state (if no active request items)
  const [medSelectorOpen, setMedSelectorOpen] = useState(false);
  const [miniSearchQuery, setMiniSearchQuery] = useState('');
  const [miniSearchResults, setMiniSearchResults] = useState([]);
  const [miniSearching, setMiniSearching] = useState(false);
  const [selectedCatalogMed, setSelectedCatalogMed] = useState(null);
  const [selectedQty, setSelectedQty] = useState(1);
  const [selectorError, setSelectorError] = useState('');
  const [selectedPharmacyForDetails, setSelectedPharmacyForDetails] = useState(null);

  const hasActiveMedicines = Array.isArray(selectedMedicines) && selectedMedicines.length > 0;

  // Auto-detect patient GPS location on mount
  const handleDetectCurrentLocation = () => {
    if (!navigator.geolocation) {
      setGpsStatus('GPS Unavailable');
      setInMemoryCoords({ lat: 9.3170, lon: 76.6145 });
      setSelectedTown('Chengannur area');
      return;
    }
    setIsLocating(true);
    setGpsStatus('Detecting GPS...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setInMemoryCoords({ lat: latitude, lon: longitude });
        setSelectedTown('Live GPS Location');
        setGpsStatus('Live GPS Active');
        setIsLocating(false);
      },
      (err) => {
        console.warn('Geolocation fallback to Chengannur center:', err.message);
        setInMemoryCoords({ lat: 9.3170, lon: 76.6145 });
        setSelectedTown('Chengannur area');
        setGpsStatus('Chengannur (Default)');
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  };

  useEffect(() => {
    handleDetectCurrentLocation();
  }, []);

  // Dynamic Medicine Tabs for switching and showing distance to selected medicine
  const availableMedicineTabs = useMemo(() => {
    const list = [{ id: 'all', name: 'All Medicines' }];
    const seen = new Set(['all', 'all medicines']);

    if (selectedMedicines && selectedMedicines.length > 0) {
      selectedMedicines.forEach(m => {
        const name = m.brandName || m.name;
        if (name && !seen.has(name.toLowerCase())) {
          seen.add(name.toLowerCase());
          list.push({ id: m.id || m.medicineId || name, name });
        }
      });
    }

    pharmacies.forEach(p => {
      (p.availability || []).forEach(a => {
        if (a.brandName && !seen.has(a.brandName.toLowerCase())) {
          seen.add(a.brandName.toLowerCase());
          list.push({ id: a.medicineId || a.brandName, name: a.brandName });
        }
      });
      (p.inventory || []).forEach(inv => {
        const bName = inv.brandName || inv.medicine?.brandName;
        if (bName && !seen.has(bName.toLowerCase())) {
          seen.add(bName.toLowerCase());
          list.push({ id: inv.medicineId || inv.id || bName, name: bName });
        }
      });
    });

    if (list.length === 1) {
      // Default common clinical catalog medicines for quick distance checks
      ['Pan 40', 'Brufen 400', 'Dolo 650', 'Amoxicillin 500'].forEach(name => {
        if (!seen.has(name.toLowerCase())) {
          seen.add(name.toLowerCase());
          list.push({ id: name.toLowerCase().replace(/\s+/g, '-'), name });
        }
      });
    }

    return list.slice(0, 6);
  }, [selectedMedicines, pharmacies]);


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
        const token = localStorage.getItem('medifind_token');
        let matchEndpoint = '/api/pharmacies/match-availability';
        let matchBody = {
          items: payloadItems,
          lat,
          lon,
          isEmergency
        };

        if (prescriptionId && !String(prescriptionId).startsWith('mock-') && token) {
          matchEndpoint = `/api/prescriptions/${prescriptionId}/match-availability`;
          matchBody = { lat, lon, isEmergency };
        }

        let matchRes = await fetch(matchEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify(matchBody)
        });

        // If prescription-specific matching failed and we have staged payload items, fallback to item matching
        if (!matchRes.ok && matchEndpoint.includes('/api/prescriptions/') && payloadItems.length > 0) {
          console.warn('Prescription-specific availability matching returned', matchRes.status, '— falling back to direct item matching');
          matchRes = await fetch('/api/pharmacies/match-availability', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify({
              items: payloadItems,
              lat,
              lon,
              isEmergency
            })
          });
        }

        const matchData = await matchRes.json().catch(() => ({}));
        if (!matchRes.ok) {
          const errMsg = matchData.error || matchData.message || `Status ${matchRes.status}`;
          throw new Error(`Unable to evaluate dispensary stock: ${errMsg}`);
        }
        if (matchData.success && matchData.results) {
          setAvailabilityResults(matchData.results);
          // Extract pharmacy objects
          const pharms = matchData.results.map(r => {
            const rawAvail = r.itemStockDetails || r.availability || [];
            const availability = rawAvail.map(item => ({
              medicineId: item.medicineId,
              brandName: item.medicineName || item.brandName || 'Prescription Medicine',
              genericName: item.genericName,
              strength: item.strength,
              dosageForm: item.dosageForm,
              requestedQuantity: item.requestedQty || item.requestedQuantity || 1,
              stock: item.availableStock != null ? item.availableStock : (item.stock != null ? item.stock : 0),
              isAvailable: item.inStock ?? (item.availableStock > 0 || item.stock > 0),
              isLowStock: (item.availableStock > 0 && item.availableStock <= 10) || (item.stock > 0 && item.stock <= 10),
              unitPrice: item.unitPrice != null ? item.unitPrice : (item.price != null ? item.price : null),
              itemSubtotal: item.itemSubtotal != null ? item.itemSubtotal : null,
              hasVerifiedPrice: item.hasVerifiedPrice ?? (item.unitPrice != null),
              status: item.status || (item.inStock ? 'AVAILABLE' : 'OUT_OF_STOCK'),
              matchClassification: item.matchClassification || null,
              mismatchReason: item.mismatchReason || null,
              stockLastUpdated: item.stockLastUpdated
            }));

            const matchedCount = r.matchedItemsCount ?? r.matchedCount ?? availability.filter(a => a.isAvailable).length;
            const totalRequested = r.totalRequested || availability.length || 1;
            const isFullMatch = r.availabilityStatus === 'FULL_MATCH' || r.isFullMatch === true || (matchedCount === totalRequested && totalRequested > 0);

            return {
              ...r.pharmacy,
              distanceKm: r.distanceKm,
              totalScore: r.totalScore || r.score,
              isFullMatch,
              matchedCount,
              totalRequested,
              availability,
              isTotalCostComplete: r.isTotalCostComplete,
              pricingStatus: r.pricingStatus,
              pricingNote: r.pricingNote,
              totalEstimatedCost: r.totalEstimatedCost,
              availabilityStatus: r.availabilityStatus || (isFullMatch ? 'FULL_MATCH' : (matchedCount > 0 ? 'PARTIAL_MATCH' : 'OUT_OF_STOCK')),
              availabilitySummary: isFullMatch
                ? `All ${totalRequested} of ${totalRequested} Available`
                : `${matchedCount} of ${totalRequested} Available`
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

    // STRICT GUARD: If patient has not selected any medicines, DO NOT create a 0-item reservation hold!
    if (items.length === 0) {
      setSelectedPharmacyForDetails(pharmacy);
      return;
    }

    // Filter out items that are NOT available at this pharmacy based on real inventory match
    const availableItems = items.filter(i => {
      const medId = i.medicineId || i.id;
      const nameLower = (i.brandName || i.medicineName || i.name || '').toLowerCase().trim();
      const matchAvail = (pharmacy.availability || []).find(a => 
        (a.medicineId && (a.medicineId === medId)) || 
        (nameLower && (a.brandName || '').toLowerCase().includes(nameLower))
      );
      if (matchAvail) {
        return matchAvail.isAvailable === true;
      }
      const matchInv = (pharmacy.inventory || []).find(inv => 
        (inv.medicineId && (inv.medicineId === medId)) || 
        (nameLower && ((inv.medicine?.brandName || inv.brandName || '').toLowerCase().includes(nameLower)))
      );
      if (matchInv) {
        return (matchInv.stock != null ? matchInv.stock > 0 : true);
      }
      // If item was directly passed with explicit availability flag
      if (i.isAvailable !== undefined) {
        return Boolean(i.isAvailable);
      }
      return false;
    });

    // If no requested medicines are available at this dispensary, notify patient
    if (availableItems.length === 0) {
      alert(`None of the requested medicines are currently in stock at ${pharmacy.name}. Please select a participating dispensary that has available stock.`);
      return;
    }

    const normalizedItems = availableItems.map(i => {
      const medId = i.medicineId || i.id;
      const nameLower = (i.brandName || i.medicineName || i.name || '').toLowerCase().trim();
      const matchAvail = (pharmacy.availability || []).find(a => 
        (a.medicineId && (a.medicineId === medId)) || 
        (nameLower && (a.brandName || '').toLowerCase().includes(nameLower))
      );
      const matchInv = (pharmacy.inventory || []).find(inv => 
        (inv.medicineId && (inv.medicineId === medId)) || 
        (nameLower && ((inv.medicine?.brandName || inv.brandName || '').toLowerCase().includes(nameLower)))
      );

      // Check authoritative 50-medicine catalog
      const ref = referencePricingData.find(r => 
        r.brandName.toLowerCase() === nameLower ||
        nameLower.includes(r.brandName.toLowerCase()) ||
        (r.genericName && nameLower.includes(r.genericName.toLowerCase()))
      );

      let resolvedPrice = null;
      if (matchAvail?.unitPrice != null) {
        resolvedPrice = matchAvail.unitPrice;
      } else if (matchInv?.price != null) {
        resolvedPrice = matchInv.price;
      } else if (ref && ref.unitPrice != null) {
        resolvedPrice = ref.unitPrice;
      } else if (i.unitPrice != null) {
        resolvedPrice = i.unitPrice;
      } else if (i.price != null) {
        resolvedPrice = i.price;
      }

      // If price happens to be the full strip MRP while pack has multiple units, convert to per-tablet unit price
      if (ref && ref.unitsPerPack > 1 && resolvedPrice && Math.abs(resolvedPrice - ref.publishedMrp) < 0.1) {
        resolvedPrice = ref.unitPrice;
      }

      return {
        medicineId: medId,
        brandName: i.brandName || i.medicineName || matchAvail?.brandName || matchInv?.medicine?.brandName || matchInv?.brandName || i.name || 'Prescription Medicine',
        genericName: i.genericName || matchAvail?.genericName || matchInv?.medicine?.genericName || ref?.genericName || '',
        strength: i.strength || matchAvail?.strength || matchInv?.medicine?.strength || ref?.strength || '',
        quantity: i.quantity || i.requestedQuantity || i.requestedQty || 1,
        price: resolvedPrice,
        unitPrice: resolvedPrice,
        pricingUnit: ref?.pricingUnit || matchAvail?.pricingUnit || 'per tablet'
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
    const finalData = {
      ...reservationData,
      ...(prescriptionId && !String(prescriptionId).startsWith('mock-') ? { prescriptionId } : {})
    };
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(finalData)
      });
      const data = await res.json();
      if (data.success && data.order) {
        broadcastUpdate('ORDER_CREATED', { order: data.order });
        if (onClearSelectedMedicines) {
          onClearSelectedMedicines();
        }
        try { localStorage.removeItem('medifind_prescription_session'); } catch (_) {}
        try { sessionStorage.removeItem('medifind_rx_image'); } catch (_) {}
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

  // Closest pharmacy stocking the active medicine tab
  const nearestPharmacyForSelectedMed = useMemo(() => {
    if (activeMedicineTab === 'all') return displayedPharmacies[0] || null;

    const matched = displayedPharmacies.find(p => {
      const inAvail = (p.availability || []).some(a => 
        a.brandName?.toLowerCase().includes(activeMedicineTab.toLowerCase()) && a.isAvailable
      );
      const inInv = (p.inventory || []).some(inv => 
        (inv.brandName || inv.medicine?.brandName)?.toLowerCase().includes(activeMedicineTab.toLowerCase())
      );
      return inAvail || inInv;
    });

    return matched || displayedPharmacies[0] || null;
  }, [activeMedicineTab, displayedPharmacies]);

  // When active medicine tab changes, highlight that pharmacy on map
  useEffect(() => {
    if (activeMedicineTab !== 'all' && nearestPharmacyForSelectedMed) {
      setSelectedPharmacyForMap(nearestPharmacyForSelectedMed);
    }
  }, [activeMedicineTab, nearestPharmacyForSelectedMed]);

  const activeCenter = (inMemoryCoords && inMemoryCoords.lat != null && inMemoryCoords.lon != null)
    ? [Number(inMemoryCoords.lat) || 9.3170, Number(inMemoryCoords.lon) || 76.6145]
    : [AREA_LANDMARKS[0]?.lat || 9.3170, AREA_LANDMARKS[0]?.lon || 76.6145];

  // Selected store and travel time estimates
  const activeSelectedStore = selectedPharmacyForMap || displayedPharmacies[0] || null;

  const storeDistanceKm = useMemo(() => {
    if (!activeSelectedStore) return '0.3';
    if (activeSelectedStore.distanceKm != null) return String(activeSelectedStore.distanceKm);
    const userLat = activeCenter[0];
    const userLon = activeCenter[1];
    const sLat = (typeof activeSelectedStore.latitude === 'number' && !isNaN(activeSelectedStore.latitude))
      ? activeSelectedStore.latitude
      : (activeSelectedStore.name?.toLowerCase().includes('max care') ? 9.3186 : 9.3150);
    const sLon = (typeof activeSelectedStore.longitude === 'number' && !isNaN(activeSelectedStore.longitude))
      ? activeSelectedStore.longitude
      : (activeSelectedStore.name?.toLowerCase().includes('max care') ? 76.6135 : 76.6110);
    if (userLat && userLon && sLat && sLon) {
      const R = 6371;
      const dLat = (sLat - userLat) * Math.PI / 180;
      const dLon = (sLon - userLon) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(userLat * Math.PI / 180) * Math.cos(sLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return (R * c).toFixed(1);
    }
    return '0.3';
  }, [activeSelectedStore, activeCenter]);

  const travelEstimates = useMemo(() => {
    const d = parseFloat(storeDistanceKm) || 0.3;
    const walkMin = Math.max(1, Math.round((d / 4.5) * 60));
    const bikeMin = Math.max(1, Math.round((d / 28) * 60));
    const carMin = Math.max(1, Math.round((d / 22) * 60));
    return {
      walk: walkMin >= 60 ? `${Math.floor(walkMin / 60)}h ${walkMin % 60}m` : `${walkMin} min`,
      bike: bikeMin >= 60 ? `${Math.floor(bikeMin / 60)}h ${bikeMin % 60}m` : `${bikeMin} min`,
      car: carMin >= 60 ? `${Math.floor(carMin / 60)}h ${carMin % 60}m` : `${carMin} min`
    };
  }, [storeDistanceKm]);

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
      <div className="relative w-full h-[380px] sm:h-[480px] lg:h-[calc(100vh-140px)] lg:min-h-[600px] overflow-hidden flex flex-col font-body-md text-on-surface">
        {/* Full-bleed Leaflet Map */}
        <div className="absolute inset-0 w-full h-full z-0">
          <PharmacyMap
            pharmacies={displayedPharmacies}
            center={activeCenter}
            radiusKm={radiusKm}
            height="100%"
            selectedPharmacyId={currentPharm?.id}
            selectedPharmacy={currentPharm}
            onSelectPharmacy={(p) => {
              const idx = displayedPharmacies.findIndex(x => x.id === p.id);
              if (idx >= 0) setSelectedMapIndex(idx);
              setSelectedPharmacyForMap(p);
            }}
            activeRequestItems={selectedMedicines}
            selectedMedicineName={activeMedicineTab !== 'all' ? activeMedicineTab : null}
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

              {/* Medicine Distance & GPS Indicator */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-surface-container-low text-xs">
                  <span className="material-symbols-outlined text-secondary text-base">medication</span>
                  <div className="flex flex-col text-left leading-tight">
                    <span className="text-[10px] text-on-surface-variant font-medium">Selected Medicine</span>
                    <span className="font-bold text-primary">{activeMedicineTab === 'all' ? 'All Dispensaries' : activeMedicineTab}</span>
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
                Show All (<RollingNumber value={pharmacies.length} />)
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
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          {/* Active Prescription Dossier Card / Directory Header Card (7 cols) - Balanced & Symmetrical with Route Box */}
          <div className="lg:col-span-7 bg-surface-container-low rounded-2xl p-3.5 sm:p-4 border border-outline-variant/30 flex flex-col justify-between gap-3 shadow-xs">
            {/* Header: Title, Icon, Item Count & Clear Action */}
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-surface-container">
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-full ${hasActiveMedicines ? 'bg-secondary-container text-on-secondary-container' : 'bg-primary/10 text-primary'} flex items-center justify-center shrink-0 shadow-xs`}>
                  <span className="material-symbols-outlined text-base">
                    {hasActiveMedicines ? 'prescriptions' : 'storefront'}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-secondary uppercase tracking-wider block leading-none">
                    {hasActiveMedicines ? 'Verified Prescription Request' : 'Participating Dispensaries'}
                  </span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-xs font-bold text-primary">
                      {hasActiveMedicines
                        ? `${selectedMedicines.length} Formulation${selectedMedicines.length === 1 ? '' : 's'} Linked`
                        : `${displayedPharmacies.length} Accredited Kerala Pharmacies`}
                    </span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] font-medium text-on-surface-variant">
                      {hasActiveMedicines ? 'Live Dispensary Query' : 'Live Network Directory'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {hasActiveMedicines ? (
                  <span className="px-2.5 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[11px] font-bold flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs">verified</span>
                    <span>Rx Verified</span>
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs">explore</span>
                    <span>Directory Mode</span>
                  </span>
                )}
                {onClearSelectedMedicines && selectedMedicines.length > 0 && (
                  <button
                    type="button"
                    onClick={onClearSelectedMedicines}
                    className="flex items-center gap-0.5 text-[11px] font-semibold text-tertiary hover:text-error hover:bg-surface-container px-2 py-0.5 rounded-lg transition-colors cursor-pointer"
                    title="Clear selected prescription batch"
                  >
                    <span className="material-symbols-outlined text-xs">close</span>
                    <span>Clear</span>
                  </button>
                )}
              </div>
            </div>

            {/* Content: Selected Medicines or Directory Exploration Prompt */}
            {hasActiveMedicines ? (
              <div className="flex flex-wrap gap-2 py-0.5">
                {selectedMedicines.map(m => {
                  const mId = m.medicineId || m.id;
                  const qty = Number(m.quantity) || 1;
                  return (
                    <div
                      key={mId}
                      className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-surface-container-lowest border border-outline-variant/30 text-xs shadow-2xs hover:border-secondary transition-all"
                    >
                      <span className="material-symbols-outlined text-sm text-secondary">medication</span>
                      <span className="font-bold text-primary">{m.brandName}</span>
                      
                      {/* Quantity Stepper & Direct Editable Input */}
                      <div className="flex items-center bg-surface-container-low rounded-lg p-0.5 border border-outline-variant/30">
                        {onUpdateQuantity && (
                          <button
                            type="button"
                            onClick={() => onUpdateQuantity(mId, Math.max(1, qty - 1))}
                            disabled={qty <= 1}
                            title="Decrease quantity"
                            className="w-5 h-5 rounded-md flex items-center justify-center text-on-surface-variant hover:text-primary hover:bg-surface-container disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                          >
                            <span className="material-symbols-outlined text-[11px]">remove</span>
                          </button>
                        )}

                        <input
                          type="number"
                          min="1"
                          max="200"
                          value={qty}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val) && val >= 1 && onUpdateQuantity) {
                              onUpdateQuantity(mId, Math.min(200, val));
                            }
                          }}
                          className="w-7 text-center text-[11px] font-bold text-primary font-mono bg-transparent border-0 outline-none p-0 focus:ring-0"
                          title="Click to edit quantity"
                        />

                        {onUpdateQuantity && (
                          <button
                            type="button"
                            onClick={() => onUpdateQuantity(mId, Math.min(200, qty + 1))}
                            disabled={qty >= 200}
                            title="Increase quantity"
                            className="w-5 h-5 rounded-md flex items-center justify-center text-on-surface-variant hover:text-primary hover:bg-surface-container disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                          >
                            <span className="material-symbols-outlined text-[11px]">add</span>
                          </button>
                        )}
                      </div>

                      {/* Remove Button */}
                      {onRemoveMedicine && (
                        <button
                          type="button"
                          onClick={() => onRemoveMedicine(mId)}
                          title={`Remove ${m.brandName} from request queue`}
                          className="w-5 h-5 rounded-md flex items-center justify-center text-outline hover:text-error hover:bg-error-container/20 transition-all cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-xs">close</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-2xl bg-surface-container-lowest border border-outline-variant/30 text-xs gap-3 shadow-2xs">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-secondary shrink-0">
                    <span className="material-symbols-outlined text-base">explore</span>
                  </div>
                  <div>
                    <span className="font-bold text-primary block">Dispensary Directory Mode Active</span>
                    <span className="text-on-surface-variant text-[11px]">
                      No active medicines in request queue. Add medicines from our catalogue or upload an Rx to check shelf availability:
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setMedSelectorOpen(true)}
                    className="px-3.5 py-1.5 rounded-full bg-primary hover:bg-primary-container text-white text-xs font-bold shadow-xs cursor-pointer whitespace-nowrap flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-sm">search</span>
                    <span>Add Medicine</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      window.history.pushState(null, '', '/prescription');
                      window.dispatchEvent(new PopStateEvent('popstate'));
                    }}
                    className="px-3.5 py-1.5 rounded-full bg-secondary-container hover:bg-secondary-fixed text-on-secondary-container text-xs font-bold shadow-xs cursor-pointer whitespace-nowrap flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-sm">upload_file</span>
                    <span>Upload Rx</span>
                  </button>
                </div>
              </div>
            )}

            {/* Footer Status Row (Matches the right card's footer) */}
            <div className="pt-2 border-t border-surface-container/70 flex items-center justify-between text-[11px] text-on-surface-variant flex-wrap gap-2">
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-xs text-secondary">
                  {hasActiveMedicines ? 'lock' : 'check_circle'}
                </span>
                <span>
                  {hasActiveMedicines ? (
                    <>Dispensation Bay Hold: <strong>24-Hour Locker Reservation Ready</strong></>
                  ) : (
                    <>Dispensary Network: <strong>Verified Kerala Partner Pharmacies</strong></>
                  )}
                </span>
              </span>
              <span className="text-secondary font-semibold">
                {hasActiveMedicines ? 'Online Copay: ₹0.00 (Pay at Pickup)' : 'Dispensing: In-Store Counter & Doorstep Delivery'}
              </span>
            </div>
          </div>

          {/* Store Directions & Estimated Travel Box (GPS On + Store Name Chips + Walk/Bike/Car Travel Times) */}
          <div className="lg:col-span-5 bg-surface-container-low rounded-2xl p-3.5 sm:p-4 border border-outline-variant/30 flex flex-col gap-2.5 shadow-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center shrink-0 shadow-xs">
                  <span className="material-symbols-outlined text-base">directions</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-secondary uppercase tracking-wider">Store Route &amp; Travel Time</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-primary truncate max-w-[190px]">
                      {activeSelectedStore?.name || 'Selected Pharmacy'}
                    </span>
                  </div>
                </div>
              </div>

              {/* GPS ON Status Indicator with click to re-detect */}
              <button
                type="button"
                onClick={handleDetectCurrentLocation}
                disabled={isLocating}
                title="GPS is active. Click to refresh live coordinates."
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all shadow-xs shrink-0 bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100 cursor-pointer"
              >
                <span className={`w-2 h-2 rounded-full bg-emerald-600 ${isLocating ? 'animate-ping' : 'animate-pulse'}`} />
                <span>{isLocating ? 'Locating...' : 'GPS ON'}</span>
              </button>
            </div>

            {/* Store Name Chips */}
            <div className="flex flex-wrap gap-1.5 pt-1.5 border-t border-surface-container">
              {displayedPharmacies.map((p, idx) => {
                const isSelected = (activeSelectedStore?.id === p.id) || (!activeSelectedStore && idx === 0);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelectedPharmacyForMap(p);
                      setSelectedMapIndex(idx);
                    }}
                    className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      isSelected
                        ? 'bg-primary text-white shadow-xs'
                        : 'bg-surface-container-lowest text-on-surface hover:bg-surface-container hover:text-primary border border-outline-variant/30'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[13px] opacity-80">local_pharmacy</span>
                    <span>{p.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-surface-container text-secondary'
                    }`}>
                      #{idx + 1}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Distance & Travel Time Mode Badges (Walk, Bike, Car) */}
            <div className="pt-2 border-t border-surface-container/70 flex items-center justify-between gap-2 flex-wrap text-[11px]">
              <div className="flex items-center gap-1.5 bg-surface-container-lowest px-2.5 py-1 rounded-full border border-outline-variant/20 shadow-2xs">
                <span className="material-symbols-outlined text-xs text-[#0066cc]">near_me</span>
                <span className="text-on-surface-variant font-medium">Distance:</span>
                <strong className="text-primary font-black">{storeDistanceKm} km</strong>
              </div>

              <div className="flex items-center gap-1.5">
                {/* Walk */}
                <div className="flex items-center gap-1 bg-surface-container-lowest px-2 py-0.5 rounded-full border border-outline-variant/20 shadow-2xs" title="Estimated walking travel time">
                  <span className="material-symbols-outlined text-xs text-emerald-700">directions_walk</span>
                  <span className="font-extrabold text-[10px] text-primary">{travelEstimates.walk}</span>
                </div>

                {/* Bike */}
                <div className="flex items-center gap-1 bg-surface-container-lowest px-2 py-0.5 rounded-full border border-outline-variant/20 shadow-2xs" title="Estimated two-wheeler / bike travel time">
                  <span className="material-symbols-outlined text-xs text-blue-700">two_wheeler</span>
                  <span className="font-extrabold text-[10px] text-primary">{travelEstimates.bike}</span>
                </div>

                {/* Car */}
                <div className="flex items-center gap-1 bg-surface-container-lowest px-2 py-0.5 rounded-full border border-outline-variant/20 shadow-2xs" title="Estimated driving / car travel time">
                  <span className="material-symbols-outlined text-xs text-secondary">directions_car</span>
                  <span className="font-extrabold text-[10px] text-primary">{travelEstimates.car}</span>
                </div>
              </div>
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
              All Matching (<RollingNumber value={pharmacies.length} />)
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
          <span>List (<RollingNumber value={displayedPharmacies.length} />)</span>
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
            <div className="flex flex-col gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/30 flex flex-col gap-4 shadow-sm animate-pulse">
                  <div className="flex items-center justify-between">
                    <div className="w-36 h-4 rounded-full bg-surface-container" />
                    <div className="w-24 h-4 rounded-full bg-surface-container" />
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-surface-container shrink-0" />
                    <div className="flex-1 flex flex-col gap-2">
                      <div className="w-3/5 h-4 rounded-full bg-surface-container" />
                      <div className="w-2/5 h-3 rounded-full bg-surface-container" />
                    </div>
                  </div>
                  <div className="w-full h-12 rounded-2xl bg-surface-container-low" />
                  <div className="flex items-center gap-2 pt-2 border-t border-surface-container">
                    <div className="flex-1 h-10 rounded-full bg-surface-container" />
                    <div className="w-28 h-10 rounded-full bg-surface-container" />
                  </div>
                </div>
              ))}
            </div>
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
              const isClosed = isCurrentlyOpen === false;
              const openNote = p.computedOpenStatus?.note || (isCurrentlyOpen ? 'Open Now' : 'Closed');
              const isSelected = selectedPharmacyForMap?.id === p.id;
              const availabilityList = p.availability || [];
              const availableCount = p.matchedCount != null
                ? p.matchedCount
                : (availabilityList.length > 0 ? availabilityList.filter(a => a.isAvailable).length : (p.inventory?.length || 0));
              const totalRequested = p.totalRequested || availabilityList.length || 0;
              const hasNoMedicinesAvailable = (totalRequested > 0 && availableCount === 0) || (availabilityList.length > 0 && availabilityList.every(a => !a.isAvailable));

              return (
                <article
                  key={p.id}
                  onClick={() => setSelectedPharmacyForMap(p)}
                  className={`rounded-3xl p-6 pl-7 border shadow-sm transition-all duration-200 flex flex-col gap-4 relative overflow-hidden cursor-pointer hover:-translate-y-1 hover:shadow-md ${
                    isClosed
                      ? 'opacity-65 grayscale-[15%] bg-surface-container-low/70 border-dashed border-rose-300'
                      : hasNoMedicinesAvailable && !isSelected
                      ? 'opacity-80 bg-surface-container-lowest'
                      : 'bg-surface-container-lowest'
                  } ${
                    isSelected ? 'border-primary ring-2 ring-primary/10 shadow-md' : 'border-outline-variant/30 hover:border-secondary'
                  }`}
                >
                  {/* Left Accent Bar matching patient orders card */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      bottom: 0,
                      width: 6,
                      background: isClosed ? '#ef4444' : isSelected ? '#032f28' : '#2e685d',
                      zIndex: 10
                    }}
                  />
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
                    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold ${
                      hasNoMedicinesAvailable
                        ? 'bg-[#ffdad6] text-error'
                        : 'bg-secondary-container text-on-secondary-container'
                    }`}>
                      <span className="material-symbols-outlined text-sm">{hasNoMedicinesAvailable ? 'cancel' : 'check_circle'}</span>
                      <span>
                        {p.availabilitySummary && !p.availabilitySummary.includes('undefined')
                          ? p.availabilitySummary
                          : (p.matchedCount != null && p.totalRequested != null
                              ? `${p.matchedCount} of ${p.totalRequested} Available`
                              : (p.availability?.length ? `${p.availability.filter(a => a.isAvailable).length} of ${p.availability.length} Available` : 'Available Stock'))}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container text-primary text-xs font-medium">
                      <span className="material-symbols-outlined text-xs">navigation</span>
                      <span>{p.distanceKm != null ? `${p.distanceKm} km` : 'Chengannur'}</span>
                    </span>
                    {isClosed ? (
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-rose-100 text-rose-800 border border-rose-300 text-xs font-bold shadow-2xs">
                        <span className="material-symbols-outlined text-xs text-rose-600 animate-pulse">lock_clock</span>
                        <span>{p.computedOpenStatus?.badgeText || `Closed • Opens at ${p.computedOpenStatus?.opensAt || 'scheduled hours'}`}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-300 text-xs font-medium">
                        <span className="material-symbols-outlined text-xs text-emerald-700">schedule</span>
                        <span>{p.computedOpenStatus?.badgeText || openNote}</span>
                      </span>
                    )}
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
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1 text-on-surface-variant">
                        <span className="material-symbols-outlined text-sm text-secondary">payments</span>
                        Estimated Cost
                      </span>
                      <span className="font-bold text-primary flex items-center gap-1">
                        {p.totalEstimatedCost != null ? `₹${p.totalEstimatedCost}` : 'Price unlisted'}
                        {p.isTotalCostComplete === false && p.totalEstimatedCost != null && (
                          <span className="text-[10px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full font-semibold">Partial</span>
                        )}
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
                              className={`flex items-center justify-between p-2.5 rounded-xl border text-xs transition-all ${
                                isAvail
                                  ? 'bg-surface-container-low border-outline-variant/20'
                                  : 'bg-surface-container-lowest/70 border-error/20 opacity-55 saturate-[0.75] hover:opacity-85'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${
                                  isAvail ? 'bg-secondary' : 'bg-error/70'
                                }`} />
                                <div className="flex flex-col">
                                  <span className={`font-bold ${isAvail ? 'text-primary' : 'text-on-surface-variant line-through decoration-error/40'}`}>
                                    {av.brandName}
                                  </span>
                                  <span className="text-[11px] text-on-surface-variant/80">
                                    {av.strength ? `${av.strength} • ` : ''}{av.dosageForm ? `${av.dosageForm} • ` : ''}{av.requestedQuantity || 1} unit(s) requested
                                  </span>
                                </div>
                              </div>
                              <div className="text-right flex items-center gap-2">
                                <div className="flex flex-col items-end gap-0.5">
                                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold inline-block ${
                                    isAvail
                                      ? 'bg-secondary-container text-on-secondary-container'
                                      : 'bg-[#ffdad6] text-error'
                                  }`}>
                                    {av.status === 'CLINICAL_MISMATCH'
                                      ? 'Non-Equivalent'
                                      : (isAvail
                                          ? (av.status === 'INSUFFICIENT_STOCK' ? `Low Stock (${av.stock})` : 'Available')
                                          : (av.status === 'UNKNOWN' ? 'Stock Unknown' : 'Not available at this pharmacy'))}
                                  </span>
                                  {av.unitPrice != null ? (
                                    <span className="text-[10px] text-on-surface-variant font-mono">
                                      ₹{Number(av.unitPrice).toFixed(2)}/{av.pricingUnit ? av.pricingUnit.replace('per ', '') : 'tab'} {av.itemSubtotal ? `(subtotal ₹${Number(av.itemSubtotal).toFixed(2)})` : ''}
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-outline italic">Price unlisted</span>
                                  )}
                                </div>

                                {onRemoveMedicine && av.medicineId && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onRemoveMedicine(av.medicineId);
                                    }}
                                    title={`Remove ${av.brandName} from search request`}
                                    className="p-1 rounded-lg text-outline hover:text-error hover:bg-error-container/20 transition-all cursor-pointer"
                                  >
                                    <span className="material-symbols-outlined text-sm">delete</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Closed Pharmacy Alert Banner */}
                  {isClosed && (
                    <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-900 flex items-center justify-between gap-2 shadow-2xs">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-rose-600 text-base shrink-0">timer</span>
                        <div>
                          <strong>Dispensary Closed:</strong> Patients cannot reserve while closed. Reopens at <strong>{p.computedOpenStatus?.opensAt || 'scheduled hours'}</strong>.
                        </div>
                      </div>
                      {p.computedOpenStatus?.timeRemainingFormatted && (
                        <span className="px-2.5 py-1 rounded-full bg-rose-200 text-rose-900 font-black text-[11px] shrink-0 font-mono">
                          in {p.computedOpenStatus.timeRemainingFormatted}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Action Buttons: Inspect & Select Pharmacy -> Reservation Confirmation */}
                  <div className="pt-2 flex flex-col sm:flex-row items-center gap-2 border-t border-surface-container">
                    {!hasActiveMedicines ? (
                      <div className="flex flex-col sm:flex-row items-center gap-2 w-full">
                        <FlowButton
                          variant="primary"
                          size="md"
                          fullWidth
                          onClick={() => {
                            setSelectedPharmacyForMap(p);
                            setMedSelectorOpen(true);
                          }}
                          className="!py-2.5 !text-xs !font-bold"
                          title="Select medicines from catalogue to reserve at this dispensary"
                        >
                          Select Medicines to Reserve
                        </FlowButton>
                        <FlowButton
                          variant="secondary"
                          size="md"
                          onClick={() => setSelectedPharmacyForDetails(p)}
                          className="w-full sm:w-auto !py-2.5 !text-xs !font-semibold whitespace-nowrap"
                          title="View pharmacy hours, services, and location details"
                        >
                          Hours &amp; Info
                        </FlowButton>
                      </div>
                    ) : (
                      <div className="flex-1 w-full">
                        <FlowButton
                          variant="primary"
                          size="md"
                          fullWidth
                          disabled={hasNoMedicinesAvailable || isClosed}
                          onClick={() => {
                            if (!hasNoMedicinesAvailable && !isClosed) {
                              handleInitiateReservation(p, selectedMedicines.length > 0 ? selectedMedicines : availabilityList);
                            }
                          }}
                          className={`!py-3 !text-xs !font-bold ${
                            isClosed || hasNoMedicinesAvailable ? '!opacity-50 !cursor-not-allowed' : ''
                          }`}
                          title={
                            isClosed
                              ? `Dispensary is closed. Reservations cannot be placed. Opens at ${p.computedOpenStatus?.opensAt || 'scheduled hours'}.`
                              : hasNoMedicinesAvailable
                              ? 'No requested medications are available at this pharmacy'
                              : 'Inspect & Select Pharmacy'
                          }
                        >
                          {isClosed
                            ? `Closed • Opens at ${p.computedOpenStatus?.opensAt || 'scheduled hours'}`
                            : hasNoMedicinesAvailable
                            ? 'No Stock Available'
                            : 'Inspect & Select Pharmacy'}
                        </FlowButton>
                      </div>
                    )}
                    <div className="w-full sm:w-auto shrink-0">
                      <FlowButton
                        variant="secondary"
                        size="md"
                        onClick={() => {
                          setSelectedPharmacyForMap(p);
                          const idx = displayedPharmacies.findIndex(x => x.id === p.id);
                          if (idx >= 0) setSelectedMapIndex(idx);
                          setViewMode('map-exploration');
                        }}
                        className="w-full sm:w-auto !py-3 !px-5 !text-xs !font-bold whitespace-nowrap"
                      >
                        View on Map
                      </FlowButton>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>

        {/* Right Column: Leaflet Map (5 cols = ~42%) */}
        <div id="side-pharmacy-map" className={`lg:col-span-5 lg:sticky lg:top-24 h-[340px] sm:h-[420px] lg:h-[520px] ${mobileTab === 'list' ? 'hidden lg:block' : 'block'}`}>
          <PharmacyMap
            pharmacies={displayedPharmacies}
            center={activeCenter}
            radiusKm={radiusKm}
            height="100%"
            selectedPharmacyId={selectedPharmacyForMap?.id}
            selectedPharmacy={selectedPharmacyForMap}
            onSelectPharmacy={(p) => {
              setSelectedPharmacyForMap(p);
              handleInitiateReservation(p, selectedMedicines.length > 0 ? selectedMedicines : availabilityList);
            }}
            activeRequestItems={selectedMedicines}
            selectedMedicineName={activeMedicineTab !== 'all' ? activeMedicineTab : null}
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
                placeholder="Search"
                value={miniSearchQuery}
                onChange={e => setMiniSearchQuery(e.target.value)}
                autoFocus
                className="w-full h-11 pl-9 pr-3 rounded-xl bg-surface-container-low border border-outline-variant/30 text-xs text-on-surface outline-none focus:border-secondary font-bold"
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

      {/* Pharmacy Information & Operating Profile Modal */}
      {selectedPharmacyForDetails && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest rounded-3xl max-w-lg w-full p-6 border border-outline-variant/30 shadow-2xl flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-secondary-container text-on-secondary-container flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-2xl">local_pharmacy</span>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-bold text-secondary uppercase tracking-wider bg-surface-container px-2 py-0.5 rounded-full">
                      Participating Dispensary
                    </span>
                    {selectedPharmacyForDetails.isVerified && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                        <span className="material-symbols-outlined text-xs">verified</span>
                        Verified
                      </span>
                    )}
                  </div>
                  <h3 className="text-lg font-bold text-primary mt-0.5">
                    {selectedPharmacyForDetails.name}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPharmacyForDetails(null)}
                className="w-8 h-8 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface-variant flex items-center justify-center cursor-pointer transition-colors"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>

            <div className="flex flex-col gap-2.5 p-3.5 rounded-2xl bg-surface-container-low text-xs border border-outline-variant/20">
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-sm text-secondary shrink-0 mt-0.5">location_on</span>
                <span className="text-on-surface-variant leading-relaxed">
                  {selectedPharmacyForDetails.address}
                  {selectedPharmacyForDetails.distanceKm != null && (
                    <strong className="text-primary font-bold block mt-0.5">
                      {selectedPharmacyForDetails.distanceKm} km away from your location
                    </strong>
                  )}
                </span>
              </div>
              {selectedPharmacyForDetails.phone && (
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm text-secondary shrink-0">call</span>
                  <span className="text-primary font-semibold font-mono">{selectedPharmacyForDetails.phone}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-sm text-secondary shrink-0">schedule</span>
                <span className="text-on-surface-variant">
                  Operating Status: <strong className="text-primary">{selectedPharmacyForDetails.computedOpenStatus?.badgeText || (selectedPharmacyForDetails.computedOpenStatus?.isCurrentlyOpen ? 'Open Now' : 'Open for Orders')}</strong>
                </span>
              </div>
            </div>

            {/* Prompt to add medicine before reserving */}
            <div className="p-3.5 rounded-2xl bg-secondary-container/30 border border-secondary/20 flex flex-col gap-2 text-xs">
              <div className="flex items-center gap-2 text-secondary font-bold">
                <span className="material-symbols-outlined text-base">info</span>
                <span>To Reserve or Request Delivery:</span>
              </div>
              <p className="text-on-surface-variant leading-relaxed">
                Add the medicine you need from our verified catalog or upload a prescription. We will query this pharmacy&apos;s live inventory in real time.
              </p>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-surface-container flex-wrap">
              {selectedPharmacyForDetails.googleMapsUrl && (
                <a
                  href={selectedPharmacyForDetails.googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-surface-container hover:bg-surface-container-high text-secondary text-xs font-bold transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">map</span>
                  <span>Open in Google Maps</span>
                </a>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => setSelectedPharmacyForDetails(null)}
                  className="px-4 py-2 rounded-full bg-surface-container text-primary text-xs font-semibold cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPharmacyForDetails(null);
                    setMedSelectorOpen(true);
                  }}
                  className="px-4 py-2 rounded-full bg-primary hover:bg-primary-container text-white text-xs font-bold shadow-xs cursor-pointer flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-sm">search</span>
                  <span>+ Add Medicines to Request</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
