import React, { useState, useEffect } from 'react';
import AvailabilityModal from '../components/AvailabilityModal';
import ConfirmationDialog from '../components/ConfirmationDialog';
import PharmacyMap from '../components/PharmacyMap';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import { buildFallbackSmsUri, buildFallbackTelUri, buildFallbackMessageText } from '../utils/fallbackSms';
import { broadcastUpdate } from '../utils/realtimeUpdates';
import RollingNumber from '../components/ui/RollingNumber';

const FALLBACK_DEFAULT_PHARMACIES = [
  {
    id: '3ba9ba0b-5f5a-41f2-8cde-0b411ebe431d',
    name: 'Max Care Pharmacy',
    address: '20/375, Govt. Hospital Junction, Chengannur, Kerala – 689121, India',
    phone: '4792993291',
    openingHours: '09:30–20:00',
    isParticipating: true
  },
  {
    id: '39b8b88c-a745-4883-a4a5-b9b56ec14e5a',
    name: 'Karuna Medicals',
    address: 'XI/567(1), Chengannur, Kerala – 689121, India',
    phone: '9605718151',
    openingHours: '09:30–19:00',
    isParticipating: true
  }
];

const AREA_LANDMARKS = [
  { name: 'Chengannur area', lat: 9.3200, lon: 76.6160 },
  { name: 'Haripad area', lat: 9.2350, lon: 76.4700 },
  { name: 'Kallissery area', lat: 9.3250, lon: 76.6200 },
  { name: 'Mavelikkara area', lat: 9.2650, lon: 76.5510 },
  { name: 'Thiruvalla area', lat: 9.3830, lon: 76.5740 }
];

function getApproximateAreaName(lat, lon) {
  let closestName = 'Chengannur area';
  let minDiff = Infinity;
  for (const landmark of AREA_LANDMARKS) {
    const diff = Math.hypot(lat - landmark.lat, lon - landmark.lon);
    if (diff < minDiff) {
      minDiff = diff;
      closestName = landmark.name;
    }
  }
  return closestName;
}

export default function EmergencyLocator({ onOrderCreated }) {
  const [pharmacies, setPharmacies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [availModalOpen, setAvailModalOpen] = useState(false);
  const [selectedEmergencyMed, setSelectedEmergencyMed] = useState(null);
  const [selectedPharmacyId, setSelectedPharmacyId] = useState(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [filterMode, setFilterMode] = useState('ALL'); // 'ALL' | '24_7' | 'BOTH_READY'
  const [activeTab, setActiveTab] = useState('NETWORK'); // 'NETWORK' | 'RESTOCK' | 'OFFLINE'

  // Restock Notification states
  const [participatingPharmacies, setParticipatingPharmacies] = useState(FALLBACK_DEFAULT_PHARMACIES);
  const [selectedRestockPharmId, setSelectedRestockPharmId] = useState(FALLBACK_DEFAULT_PHARMACIES[0].id);
  const [restockPharmData, setRestockPharmData] = useState(null);
  const [restockLoadingPharm, setRestockLoadingPharm] = useState(false);
  const [myRestockRequests, setMyRestockRequests] = useState([]);
  const [restockSubmittingId, setRestockSubmittingId] = useState(null);
  const [restockFeedback, setRestockFeedback] = useState(null);
  const [restockFilter, setRestockFilter] = useState('OUT_OF_STOCK'); // 'ALL' | 'OUT_OF_STOCK'

  // Offline Fallback SMS Request states (Phase 6.1L.9)
  const [selectedFallbackPharmId, setSelectedFallbackPharmId] = useState(FALLBACK_DEFAULT_PHARMACIES[0].id);
  const [fallbackMedName, setFallbackMedName] = useState('');
  const [fallbackQty, setFallbackQty] = useState('');
  const [fallbackNote, setFallbackNote] = useState('');
  const [fallbackSmsStatus, setFallbackSmsStatus] = useState(null); // null | 'PREPARED'
  const [fallbackSmsError, setFallbackSmsError] = useState(null);
  const [preparedSmsUri, setPreparedSmsUri] = useState('');
  const [preparedMessageText, setPreparedMessageText] = useState('');

  // Search origin coordinates (in memory only, never stored in localStorage or database)
  const [inMemoryCoords, setInMemoryCoords] = useState(null);
  const [locationSource, setLocationSource] = useState('NETWORK_DEFAULT'); // 'GPS' | 'MANUAL_AREA' | 'NETWORK_DEFAULT'
  const [selectedTown, setSelectedTown] = useState('');
  const [areaLabel, setAreaLabel] = useState('Chengannur Central (Default)');
  const [locationStatus, setLocationStatus] = useState('DEFAULT');

  const [networkConfig, setNetworkConfig] = useState({
    regionName: 'Chengannur, Kerala',
    defaultLat: 9.3200,
    defaultLon: 76.6160,
    emergencyHotlines: [
      { label: '112', desc: 'National Emergency', dialable: '112' },
      { label: '108', desc: 'Kerala Ambulance (EMRI)', dialable: '108' },
      { label: '1056', desc: 'Kerala Health Helpline', dialable: '1056' },
      { label: '1800-599-0019', desc: 'AYUSH / Health Helpline (toll-free)', dialable: '18005990019' }
    ]
  });

  // Track online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Fetch initial config
  useEffect(() => {
    async function fetchConfig() {
      try {
        const cfgRes = await fetch('/api/pharmacies/config');
        const cfgData = await cfgRes.json();
        if (cfgData.success && cfgData.config) {
          setNetworkConfig(cfgData.config);
        }
      } catch (err) {
        console.warn('Using default network config fallback:', err);
      }
    }
    fetchConfig();
  }, []);

  // Fetch emergency pharmacies when search coordinates change
  useEffect(() => {
    fetchEmergencyPharmacies();
  }, [inMemoryCoords]);

  async function fetchEmergencyPharmacies() {
    setLoading(true);
    setError(null);
    const lat = inMemoryCoords ? inMemoryCoords.lat : networkConfig.defaultLat;
    const lon = inMemoryCoords ? inMemoryCoords.lon : networkConfig.defaultLon;

    try {
      const res = await fetch(`/api/pharmacies/emergency?lat=${lat}&lon=${lon}`);
      const data = await res.json();
      if (data.success) {
        setPharmacies(data.pharmacies || []);
        if (data.pharmacies && data.pharmacies.length > 0) {
          setSelectedPharmacyId(data.pharmacies[0].id);
        }
      } else {
        setError(data.error || 'Failed to retrieve emergency pharmacies.');
      }
    } catch (err) {
      console.error('Error fetching emergency pharmacies:', err);
      setError('Network communication error. Unable to load emergency pharmacies.');
    } finally {
      setLoading(false);
    }
  }

  // Load participating pharmacies for Restock / Directory / Offline Fallback view
  useEffect(() => {
    async function loadPharmacies() {
      try {
        const res = await fetch('/api/pharmacies');
        const data = await res.json();
        if (data.success && data.pharmacies) {
          const verified = data.pharmacies.filter(p => (p.isVerified || p.verificationStatus === 'VERIFIED') && !p.isTestRecord);
          const finalPharmacies = verified.length > 0 ? verified : FALLBACK_DEFAULT_PHARMACIES;
          setParticipatingPharmacies(finalPharmacies);
          if (finalPharmacies.length > 0) {
            setSelectedRestockPharmId(prev => prev || finalPharmacies[0].id);
            setSelectedFallbackPharmId(prev => prev || finalPharmacies[0].id);
          }
        }
      } catch (err) {
        console.warn('Failed to load participating pharmacies, using offline fallback', err);
        setParticipatingPharmacies(FALLBACK_DEFAULT_PHARMACIES);
        setSelectedRestockPharmId(FALLBACK_DEFAULT_PHARMACIES[0].id);
        setSelectedFallbackPharmId(FALLBACK_DEFAULT_PHARMACIES[0].id);
      }
    }
    loadPharmacies();
  }, []);

  // Load selected pharmacy details for restock view
  useEffect(() => {
    if (!selectedRestockPharmId) return;
    async function loadPharmDetail() {
      setRestockLoadingPharm(true);
      try {
        const res = await fetch(`/api/pharmacies/${selectedRestockPharmId}`);
        const data = await res.json();
        if (data.success && data.pharmacy) {
          setRestockPharmData(data.pharmacy);
        }
      } catch (err) {
        console.warn('Failed to load pharmacy details for restock', err);
      } finally {
        setRestockLoadingPharm(false);
      }
    }
    loadPharmDetail();
  }, [selectedRestockPharmId]);

  // Fetch patient's restock requests
  const fetchMyRestockRequests = async () => {
    const token = localStorage.getItem('medifind_token');
    if (!token) return;
    try {
      const res = await fetch('/api/pharmacies/restock-requests/my', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setMyRestockRequests(data.requests || []);
      }
    } catch (err) {
      console.warn('Failed to fetch user restock requests', err);
    }
  };

  useEffect(() => {
    fetchMyRestockRequests();
  }, []);

  const handleCreateRestockRequest = async (pharmacyId, medicineId) => {
    const token = localStorage.getItem('medifind_token');
    if (!token) {
      setRestockFeedback({ type: 'error', message: 'Please log in as a patient to request restock notifications.' });
      return;
    }
    setRestockSubmittingId(medicineId);
    setRestockFeedback(null);
    try {
      const res = await fetch('/api/pharmacies/restock-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ pharmacyId, medicineId })
      });
      const data = await res.json();
      if (data.success) {
        setRestockFeedback({ type: 'success', message: 'Restock notification request submitted. You will be notified in-app when stock becomes AVAILABLE.' });
        fetchMyRestockRequests();
      } else {
        setRestockFeedback({ type: 'error', message: data.error || 'Failed to submit restock request.' });
      }
    } catch (err) {
      setRestockFeedback({ type: 'error', message: 'Network error submitting restock request.' });
    } finally {
      setRestockSubmittingId(null);
    }
  };

  const handleCancelRestockRequest = async (requestId) => {
    const token = localStorage.getItem('medifind_token');
    if (!token) return;
    try {
      const res = await fetch(`/api/pharmacies/restock-requests/${requestId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setRestockFeedback({ type: 'success', message: 'Restock request cancelled.' });
        fetchMyRestockRequests();
      } else {
        setRestockFeedback({ type: 'error', message: data.error || 'Failed to cancel request.' });
      }
    } catch (err) {
      setRestockFeedback({ type: 'error', message: 'Network error cancelling restock request.' });
    }
  };

  // Phase 6.1L.9: Handle native SMS preparation for offline fallback inquiry
  const handleOpenFallbackSms = () => {
    setFallbackSmsError(null);
    const token = localStorage.getItem('medifind_token');
    if (!token) {
      setFallbackSmsError('Authentication required: Please log in as a patient to contact a participating pharmacy.');
      return;
    }

    const availablePharmacies = participatingPharmacies.length > 0 ? participatingPharmacies : FALLBACK_DEFAULT_PHARMACIES;
    const targetPharm = availablePharmacies.find(p => p.id === selectedFallbackPharmId) || availablePharmacies[0];

    if (!targetPharm || !targetPharm.phone) {
      setFallbackSmsError('Selected pharmacy phone number is unavailable.');
      return;
    }

    if (!fallbackMedName || !fallbackMedName.trim()) {
      setFallbackSmsError('Please specify the medicine name or inquiry context.');
      return;
    }

    try {
      const userJson = localStorage.getItem('medifind_user');
      let patientName = 'Patient';
      if (userJson) {
        try {
          const u = JSON.parse(userJson);
          if (u.name) patientName = u.name;
        } catch (e) {}
      }

      const text = buildFallbackMessageText({
        medicineName: fallbackMedName.trim(),
        quantity: fallbackQty ? fallbackQty.trim() : null,
        patientName,
        customNote: fallbackNote ? fallbackNote.trim() : null
      });

      const uri = buildFallbackSmsUri({
        phone: targetPharm.phone,
        medicineName: fallbackMedName.trim(),
        quantity: fallbackQty ? fallbackQty.trim() : null,
        patientName,
        customNote: fallbackNote ? fallbackNote.trim() : null
      });

      setPreparedMessageText(text);
      setPreparedSmsUri(uri);
      setFallbackSmsStatus('PREPARED');

      // Native browser SMS URI protocol trigger
      window.location.href = uri;
    } catch (err) {
      setFallbackSmsError(err.message || 'Failed to prepare SMS message.');
    }
  };

  // Handle browser geolocation
  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setLocationStatus('DENIED');
      setLocationSource('NETWORK_DEFAULT');
      setAreaLabel('Geolocation not supported (Chengannur Central)');
      return;
    }

    setLocationStatus('LOCATING');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setInMemoryCoords({ lat: latitude, lon: longitude });
        setLocationSource('GPS');
        setSelectedTown('');
        const namedArea = getApproximateAreaName(latitude, longitude);
        setAreaLabel(`GPS Location (${namedArea})`);
        setLocationStatus('GRANTED');
      },
      (err) => {
        console.warn('Geolocation denied or timed out:', err.message);
        setInMemoryCoords(null);
        setLocationSource('NETWORK_DEFAULT');
        setSelectedTown('');
        setAreaLabel('Location access denied (Chengannur Central)');
        setLocationStatus('DENIED');
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  };

  // Handle manual town selection
  const handleSelectManualArea = (townName) => {
    if (!townName) {
      handleResetLocation();
      return;
    }
    const landmark = AREA_LANDMARKS.find(l => l.name === townName);
    if (landmark) {
      setInMemoryCoords({ lat: landmark.lat, lon: landmark.lon });
      setLocationSource('MANUAL_AREA');
      setSelectedTown(landmark.name);
      setAreaLabel(landmark.name);
      setLocationStatus('DEFAULT');
    }
  };

  const handleResetLocation = () => {
    setInMemoryCoords(null);
    setLocationSource('NETWORK_DEFAULT');
    setSelectedTown('');
    setAreaLabel('Chengannur Central (Default)');
    setLocationStatus('DEFAULT');
  };

  const [emergencyDetailPharm, setEmergencyDetailPharm] = useState(null);
  const [selectedEmergencyItem, setSelectedEmergencyItem] = useState(null);
  const [emergencyQty, setEmergencyQty] = useState(1);
  const [emergencyFulfillment, setEmergencyFulfillment] = useState('URGENT_COUNTER'); // 'URGENT_COUNTER' | 'PRIORITY_COURIER'
  const [emergencyDeliveryAddress, setEmergencyDeliveryAddress] = useState('');
  const [emergencyPatientPhone, setEmergencyPatientPhone] = useState('');
  const [emergencyClinicalNote, setEmergencyClinicalNote] = useState('');
  const [emergencySubmitting, setEmergencySubmitting] = useState(false);
  const [emergencyError, setEmergencyError] = useState(null);
  const [emergencySuccessOrder, setEmergencySuccessOrder] = useState(null);

  const handleOpenEmergencyDetail = (pharmacy, defaultItem) => {
    setEmergencyDetailPharm(pharmacy);
    const stockItems = pharmacy.emergencyStockList || pharmacy.emergencyStock || pharmacy.inventory || [];
    const itemToSelect = defaultItem || stockItems[0] || null;
    setSelectedEmergencyItem(itemToSelect);
    setEmergencyQty(1);
    setEmergencyFulfillment('URGENT_COUNTER');
    setEmergencyDeliveryAddress('');
    setEmergencyPatientPhone('');
    setEmergencyClinicalNote('');
    setEmergencyError(null);
    setEmergencySuccessOrder(null);
  };

  const handleConfirmEmergencyHold = async () => {
    if (!emergencyDetailPharm || !selectedEmergencyItem) return;
    if (emergencyFulfillment === 'PRIORITY_COURIER' && (!emergencyDeliveryAddress || !emergencyDeliveryAddress.trim())) {
      setEmergencyError('Doorstep emergency delivery address is required for priority assistant dispatch.');
      return;
    }
    setEmergencySubmitting(true);
    setEmergencyError(null);

    const token = localStorage.getItem('medifind_token');
    const unitPrice = selectedEmergencyItem.price != null ? selectedEmergencyItem.price : 0.0;
    const medSubtotal = unitPrice * emergencyQty;
    const fee = emergencyFulfillment === 'PRIORITY_COURIER' ? 80.0 : 0.0;
    const grandTotal = medSubtotal + fee;

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          pharmacyId: emergencyDetailPharm.id,
          items: [{
            medicineId: selectedEmergencyItem.medicineId || selectedEmergencyItem.id,
            quantity: emergencyQty
          }],
          orderType: emergencyFulfillment === 'PRIORITY_COURIER' ? 'ASSISTED_DELIVERY' : 'EMERGENCY',
          deliveryAddress: emergencyFulfillment === 'PRIORITY_COURIER' ? emergencyDeliveryAddress.trim() : null,
          deliveryNotes: emergencyClinicalNote ? `Emergency Clinical Note: ${emergencyClinicalNote.trim()}` : 'Urgent Emergency Hold Request',
          notes: `Emergency access request — ${emergencyFulfillment === 'PRIORITY_COURIER' ? 'Medicine Access Assistant' : 'Immediate Counter Collection'}`
        })
      });

      const data = await res.json();
      if (data.success && data.order) {
        setEmergencySuccessOrder(data.order);
        broadcastUpdate('ORDER_CREATED', { order: data.order });
      } else {
        setEmergencyError(data.error || 'Failed to submit emergency hold request. Please contact pharmacy directly.');
      }
    } catch (err) {
      setEmergencyError('Network error connecting to pharmacy server. Please call hotline directly.');
    } finally {
      setEmergencySubmitting(false);
    }
  };

  const handleInstantEmergencyReserve = (pharmacy, medName) => {
    const stockItems = pharmacy.emergencyStockList || pharmacy.emergencyStock || pharmacy.inventory || [];
    const matched = stockItems.find(i => (i.brandName || i.medicine?.name || '').toLowerCase() === (medName || '').toLowerCase());
    handleOpenEmergencyDetail(pharmacy, matched || stockItems[0]);
  };

  // Filtered pharmacies based on selection
  const filteredPharmacies = pharmacies.filter(p => {
    const stockCount = (p.emergencyStockList || p.emergencyStock || p.inventory || []).length;
    if (filterMode === '24_7') {
      return p.is24x7 === true;
    }
    if (filterMode === 'BOTH_READY') {
      return stockCount > 0;
    }
    return true;
  });

  const centerCoords = inMemoryCoords
    ? [inMemoryCoords.lat, inMemoryCoords.lon]
    : [networkConfig.defaultLat, networkConfig.defaultLon];

  return (
    <div style={{ background: '#ecfdf7', minHeight: '100vh', paddingBottom: '4rem' }}>
      {/* Top Advisory Bar: Clinical Protocol & Non-Alarmist Emergency Notice */}
      <section style={{ background: '#e0f2eb', borderBottom: '1px solid #d5e6e0', padding: '0.85rem 1.5rem' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#d5e6e0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#032f28', flexShrink: 0 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>medical_services</span>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#2e685d', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Clinical Care Directive
                  </span>
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#c0c8c5' }}></span>
                  <span style={{ fontSize: 13, color: '#414846', fontWeight: 500 }}>
                    MediFind is designed for urgent pharmaceutical discovery &amp; reservation verification.
                  </span>
                </div>
                <p style={{ fontSize: 12, color: '#414846', margin: '2px 0 0 0' }}>
                  Not for acute diagnostic triage or emergency dispatch. For life-threatening emergencies, immediately dial{' '}
                  <strong style={{ color: '#ba1a1a' }}>112 / 108</strong>.
                </p>
              </div>
            </div>

            {/* Quick Emergency Hotlines */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              {networkConfig.emergencyHotlines?.map((h, i) => (
                <a
                  key={i}
                  href={`tel:${h.dialable || h.label}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    background: '#ffffff',
                    padding: '0.3rem 0.75rem',
                    borderRadius: 99,
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#032f28',
                    textDecoration: 'none',
                    border: '1px solid #c0c8c5',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 15, color: '#2e685d' }}>call</span>
                  <span>{h.label} ({h.desc})</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Main Container */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '2rem 1.5rem' }}>
        {/* Offline Banner if active */}
        {isOffline && (
          <div style={{
            background: '#ffdad4',
            border: '1px solid #ffb4a8',
            borderRadius: 16,
            padding: '1rem 1.25rem',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            color: '#410100'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 24, color: '#5a0100' }}>cloud_off</span>
              <div>
                <strong style={{ fontSize: 14 }}>Network Offline Indicator</strong>
                <p style={{ margin: 0, fontSize: 12 }}>
                  Live dispensary inventory feeds cannot be verified. Showing cached historical availability.
                </p>
              </div>
            </div>
            <button
              onClick={fetchEmergencyPharmacies}
              style={{
                background: '#5a0100',
                color: '#ffffff',
                border: 'none',
                borderRadius: 99,
                padding: '0.4rem 1rem',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Reconnect
            </button>
          </div>
        )}

        {/* Header Block & Search Origin */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1.5rem' }}>
            <div>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                background: '#b0ecdd',
                color: '#336c61',
                padding: '0.3rem 0.85rem',
                borderRadius: 99,
                fontSize: 12,
                fontWeight: 700,
                marginBottom: '0.5rem'
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2e685d' }}></span>
                <span>Emergency Access Mode • Real-Time Inventory Scan</span>
              </div>
              <h1 style={{ fontSize: 'clamp(22px, 4vw, 32px)', fontWeight: 700, color: '#032f28', margin: 0, letterSpacing: '-0.02em' }}>
                Emergency Medicine Access
              </h1>
              <p style={{ fontSize: 'clamp(13px, 2.5vw, 16px)', color: '#414846', margin: '0.4rem 0 0 0', maxWidth: 650 }}>
                Find verified nearby pharmacies in {networkConfig.regionName} that stock urgent cardiac vasodilators, bronchodilators, and emergency life-saving agents.
              </p>
            </div>

            {/* Search Origin Control Panel */}
            <div style={{
              background: '#ffffff',
              padding: '1rem 1.25rem',
              borderRadius: 16,
              boxShadow: '0 1px 4px rgba(3,47,40,0.06)',
              border: '1px solid #e0f2eb',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              width: '100%',
              maxWidth: 420
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#717976', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Search Origin
                </span>
                <span style={{ fontSize: 11, color: '#2e685d', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>tune</span> Selected
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#2e685d' }}>location_on</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#0f1e1b' }}>{areaLabel}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', paddingTop: '0.35rem', flexWrap: 'wrap' }}>
                <select
                  value={selectedTown}
                  onChange={e => handleSelectManualArea(e.target.value)}
                  style={{
                    background: '#e6f8f1',
                    border: '1px solid #c0c8c5',
                    borderRadius: 99,
                    padding: '0.25rem 0.65rem',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#032f28',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value="">Manual Area...</option>
                  {AREA_LANDMARKS.map(lm => (
                    <option key={lm.name} value={lm.name}>{lm.name}</option>
                  ))}
                </select>

                <button
                  onClick={handleUseMyLocation}
                  disabled={locationStatus === 'LOCATING'}
                  style={{
                    background: locationSource === 'GPS' ? '#032f28' : '#e0f2eb',
                    color: locationSource === 'GPS' ? '#ffffff' : '#032f28',
                    border: 'none',
                    borderRadius: 99,
                    padding: '0.25rem 0.75rem',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>near_me</span>
                  <span>{locationStatus === 'LOCATING' ? 'Locating...' : 'GPS'}</span>
                </button>

                {inMemoryCoords && (
                  <button
                    onClick={handleResetLocation}
                    title="Reset to default area"
                    style={{
                      background: '#d5e6e0',
                      border: 'none',
                      borderRadius: 99,
                      padding: '0.25rem 0.5rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      color: '#414846'
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>refresh</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Requested Dispensation Bundle Context Capsule */}
          <div style={{
            background: '#e6f8f1',
            padding: '1rem 1.25rem',
            borderRadius: 16,
            border: '1px solid #d5e6e0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#b0ecdd', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#032f28', flexShrink: 0 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 22 }}>prescriptions</span>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#2e685d', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Active Critical Dispensary Filter
                  </span>
                  <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#c0c8c5' }}></span>
                  <span style={{ fontSize: 12, color: '#414846' }}>High-priority matching for emergency stock</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#032f28', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2e685d' }}></span>
                    Cardiovascular &amp; Respiratory Emergency Formulations
                  </span>
                  <span style={{ fontSize: 13, color: '#717976' }}>•</span>
                  <span style={{ fontSize: 13, color: '#414846' }}>Oral Capsules, Inhalers &amp; Injectables</span>
                </div>
              </div>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: '#ffffff',
              padding: '0.4rem 0.85rem',
              borderRadius: 99,
              fontSize: 12,
              fontWeight: 600,
              color: '#2e685d',
              border: '1px solid #c0c8c5'
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>verified</span>
              <span>Verified Pharmacist Network</span>
            </div>
          </div>
        </div>

        {/* Emergency Access Flow Segmented Switcher */}
        <div style={{
          display: 'flex',
          gap: '0.75rem',
          marginBottom: '2rem',
          borderBottom: '2px solid #e0f2eb',
          paddingBottom: '0.75rem',
          flexWrap: 'wrap'
        }}>
          <button
            onClick={() => setActiveTab('NETWORK')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.65rem 1.25rem',
              borderRadius: 99,
              border: activeTab === 'NETWORK' ? '2px solid #032f28' : '1px solid #c0c8c5',
              background: activeTab === 'NETWORK' ? '#032f28' : '#ffffff',
              color: activeTab === 'NETWORK' ? '#ffffff' : '#032f28',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>local_pharmacy</span>
            <span>Emergency Pharmacy Network</span>
          </button>

          <button
            onClick={() => setActiveTab('RESTOCK')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.65rem 1.25rem',
              borderRadius: 99,
              border: activeTab === 'RESTOCK' ? '2px solid #032f28' : '1px solid #c0c8c5',
              background: activeTab === 'RESTOCK' ? '#032f28' : '#ffffff',
              color: activeTab === 'RESTOCK' ? '#ffffff' : '#032f28',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>notifications_active</span>
            <span>Availability / Restock Notification</span>
            {myRestockRequests.length > 0 && (
              <span style={{
                background: activeTab === 'RESTOCK' ? '#34d399' : '#2e685d',
                color: activeTab === 'RESTOCK' ? '#032f28' : '#ffffff',
                borderRadius: 99,
                padding: '2px 8px',
                fontSize: 11,
                fontWeight: 800,
                display: 'inline-flex',
                alignItems: 'center'
              }}>
                <RollingNumber value={myRestockRequests.length} />
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('OFFLINE')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.65rem 1.25rem',
              borderRadius: 99,
              border: activeTab === 'OFFLINE' ? '2px solid #032f28' : '1px solid #c0c8c5',
              background: activeTab === 'OFFLINE' ? '#032f28' : '#ffffff',
              color: activeTab === 'OFFLINE' ? '#ffffff' : '#032f28',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>contact_phone</span>
            <span>Offline / Fallback Request</span>
          </button>
        </div>

        {/* Tab 1: Emergency Pharmacy Network */}
        {activeTab === 'NETWORK' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT COLUMN: Results & Filters (7 cols) */}
          <div className="col-span-1 lg:col-span-7 emergency-list-column">
            {/* Filter Bar */}
            <div style={{
              background: '#ffffff',
              padding: '0.6rem 0.85rem',
              borderRadius: 99,
              boxShadow: '0 1px 4px rgba(3,47,40,0.04)',
              border: '1px solid #e0f2eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '1rem',
              flexWrap: 'wrap',
              gap: '0.5rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingLeft: '0.5rem' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#032f28' }}>Emergency Pharmacies</span>
                <span style={{
                  background: '#b0ecdd',
                  color: '#336c61',
                  borderRadius: 99,
                  padding: '0.15rem 0.6rem',
                  fontSize: 11,
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.2rem'
                }}>
                  <RollingNumber value={filteredPharmacies.length} /> Found
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <button
                  onClick={() => setFilterMode('ALL')}
                  style={{
                    background: filterMode === 'ALL' ? '#032f28' : '#e6f8f1',
                    color: filterMode === 'ALL' ? '#ffffff' : '#414846',
                    border: 'none',
                    borderRadius: 99,
                    padding: '0.35rem 0.85rem',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  All (<RollingNumber value={pharmacies.length} />)
                </button>
                <button
                  onClick={() => setFilterMode('24_7')}
                  style={{
                    background: filterMode === '24_7' ? '#032f28' : '#e6f8f1',
                    color: filterMode === '24_7' ? '#ffffff' : '#414846',
                    border: 'none',
                    borderRadius: 99,
                    padding: '0.35rem 0.85rem',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  24/7 Night Care
                </button>
                <button
                  onClick={() => setFilterMode('BOTH_READY')}
                  style={{
                    background: filterMode === 'BOTH_READY' ? '#032f28' : '#e6f8f1',
                    color: filterMode === 'BOTH_READY' ? '#ffffff' : '#414846',
                    border: 'none',
                    borderRadius: 99,
                    padding: '0.35rem 0.85rem',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  In Stock Only
                </button>
              </div>
            </div>

            {/* Content List */}
            {loading ? (
              <LoadingSkeleton variant="pharmacy-list" count={3} />
            ) : error ? (
              <ErrorState
                title="Emergency Network Communication Issue"
                message={error}
                onRetry={fetchEmergencyPharmacies}
                retryText="Retry Network Query"
                className="my-4"
              />
            ) : filteredPharmacies.length === 0 ? (
              <EmptyState
                icon="emergency_home"
                title="No Emergency-Capable Participating Pharmacies in Network"
                description={`All verified participating pharmacies in ${networkConfig.regionName} operate on daytime business hours only (09:30–19:00 / 09:30–20:00). None currently have 24/7 or emergency dispensing capability registered. Delivery is not supported. MediFind AI strictly shows real network coverage and does not fabricate emergency services, coordinates, or delivery.`}
                actionText="Request Restock Notification"
                onAction={() => setActiveTab('RESTOCK')}
                secondaryActionText="Offline Emergency Directory"
                onSecondaryAction={() => setActiveTab('OFFLINE')}
                suggestions={[
                  {
                    title: 'Dial 112 (National Emergency)',
                    subtitle: 'Immediate medical ambulance & police dispatch',
                    icon: 'call',
                    onClick: () => window.open('tel:112', '_self')
                  },
                  {
                    title: 'Dial 108 (Kerala Ambulance - EMRI)',
                    subtitle: '24/7 emergency ambulance dispatch service',
                    icon: 'emergency',
                    onClick: () => window.open('tel:108', '_self')
                  },
                  {
                    title: 'Dial 1056 (Kerala Health Helpline)',
                    subtitle: 'DISHA 24/7 tele-health & medical advice',
                    icon: 'health_and_safety',
                    onClick: () => window.open('tel:1056', '_self')
                  },
                  {
                    title: 'Request Medicine Restock Alert',
                    subtitle: 'Get notified in-app when daytime pharmacies replenish stock',
                    icon: 'notifications_active',
                    onClick: () => setActiveTab('RESTOCK')
                  }
                ]}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {filteredPharmacies.map((pharmacy) => {
                  const isSelected = selectedPharmacyId === pharmacy.id;
                  const inventoryItems = pharmacy.emergencyStockList || pharmacy.emergencyStock || pharmacy.inventory || [];
                  const distanceStr = pharmacy.distanceKm != null
                    ? `${pharmacy.distanceKm.toFixed(1)} km away`
                    : 'Within service area';

                  return (
                    <article
                      key={pharmacy.id}
                      onClick={() => setSelectedPharmacyId(pharmacy.id)}
                      style={{
                        background: '#ffffff',
                        borderRadius: 20,
                        border: isSelected ? '2px solid #2e685d' : '1px solid #e0f2eb',
                        boxShadow: isSelected ? '0 8px 24px rgba(3,47,40,0.1)' : '0 1px 4px rgba(3,47,40,0.04)',
                        padding: '1.25rem',
                        position: 'relative',
                        overflow: 'hidden',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      {/* Test Data Banner Strip */}
                      <div style={{
                        background: '#d5e6e0',
                        margin: '-1.25rem -1.25rem 1rem -1.25rem',
                        padding: '0.35rem 1.25rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: 11,
                        fontWeight: 700,
                        color: '#414846',
                        letterSpacing: '0.04em'
                      }}>
                        {(pharmacy.isVerified || pharmacy.verificationStatus === 'VERIFIED') && !pharmacy.isTestRecord ? (
                          <span style={{ color: '#032f28', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#10b981' }}>verified</span>
                            Participating Pharmacy
                          </span>
                        ) : (
                          <span>TEST DATA — NOT A PARTICIPATING PHARMACY</span>
                        )}
                        {pharmacy.licenseNumber && !pharmacy.licenseNumber.startsWith('TEST-') && (
                          <span style={{ color: '#2e685d', fontWeight: 600 }}>
                            License #{pharmacy.licenseNumber}
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
                            <span style={{
                              background: '#b0ecdd',
                              color: '#336c61',
                              fontSize: 11,
                              fontWeight: 700,
                              padding: '0.15rem 0.55rem',
                              borderRadius: 99
                            }}>
                              Emergency access available
                            </span>
                            {pharmacy.is24x7 && (
                              <span style={{
                                background: '#032f28',
                                color: '#ffffff',
                                fontSize: 11,
                                fontWeight: 700,
                                padding: '0.15rem 0.55rem',
                                borderRadius: 99
                              }}>
                                Open 24/7
                              </span>
                            )}
                          </div>
                          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#032f28', margin: 0 }}>
                            {pharmacy.name}
                          </h2>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginTop: '0.35rem', fontSize: 13, color: '#414846', flexWrap: 'wrap' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', fontWeight: 600, color: '#0f1e1b' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>near_me</span>
                              {distanceStr}
                            </span>
                            <span>•</span>
                            <span style={{ color: '#2e685d', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2e685d' }}></span>
                              {pharmacy.is24x7 ? '24 Hours Open' : 'Open during business hours only'}
                            </span>
                            <span>•</span>
                            <span style={{ fontSize: 12, color: '#717976' }}>
                              {pharmacy.phone ? `Ph: ${pharmacy.phone}` : 'Verified Node'}
                            </span>
                          </div>
                        </div>

                        <div style={{
                          width: 44,
                          height: 44,
                          borderRadius: '50%',
                          background: '#e6f8f1',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#032f28',
                          flexShrink: 0
                        }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 22 }}>local_pharmacy</span>
                        </div>
                      </div>

                      {/* Stock Itemization */}
                      <div style={{
                        marginTop: '1rem',
                        background: '#e6f8f1',
                        borderRadius: 14,
                        padding: '0.75rem 1rem',
                        border: '1px solid #d5e6e0'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: 12, fontWeight: 700, color: '#032f28', marginBottom: '0.5rem' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>verified</span>
                          <span>Reported Emergency Dispensary Stock:</span>
                        </div>
                        {inventoryItems.length === 0 ? (
                          <span style={{ fontSize: 12, color: '#717976' }}>Contact dispensary directly for instantaneous stock check.</span>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem' }}>
                            {inventoryItems.slice(0, 4).map((item, idx) => {
                              const medLabel = item.brandName || item.medicine?.brandName || item.medicine?.name || item.name || 'Emergency Formulation';
                              const stockQty = item.stock != null ? item.stock : item.quantity;
                              return (
                                <div
                                  key={idx}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenEmergencyDetail(pharmacy, item);
                                  }}
                                  style={{
                                    background: '#ffffff',
                                    padding: '0.4rem 0.75rem',
                                    borderRadius: 99,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    fontSize: 12,
                                    border: '1px solid #c0c8c5',
                                    cursor: 'pointer'
                                  }}
                                >
                                  <span style={{ fontWeight: 600, color: '#0f1e1b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {medLabel}
                                  </span>
                                  <span style={{ color: '#2e685d', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.2rem', flexShrink: 0 }}>
                                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>check_circle</span>
                                    {stockQty ? `${stockQty} in stock` : 'In Stock'}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Action CTA Bar */}
                      <div style={{
                        marginTop: '1rem',
                        paddingTop: '0.75rem',
                        borderTop: '1px solid #e0f2eb',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '0.75rem'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 12, color: '#414846' }}>
                          <span style={{ fontWeight: 600, color: '#032f28' }}>Fulfillment:</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 15, color: '#2e685d' }}>storefront</span>
                            Immediate Pickup
                          </span>
                          <span>•</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 15, color: '#2e685d' }}>electric_moped</span>
                            Assistant Priority
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {pharmacy.phone && (
                            <a
                              href={`tel:${pharmacy.phone}`}
                              onClick={e => e.stopPropagation()}
                              style={{
                                background: '#e6f8f1',
                                color: '#032f28',
                                border: '1px solid #c0c8c5',
                                borderRadius: 99,
                                padding: '0.45rem 0.85rem',
                                fontSize: 12,
                                fontWeight: 600,
                                textDecoration: 'none',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.3rem'
                              }}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>call</span>
                              <span>Call</span>
                            </a>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEmergencyDetail(pharmacy, inventoryItems[0]);
                            }}
                            style={{
                              background: '#032f28',
                              color: '#ffffff',
                              border: 'none',
                              borderRadius: 99,
                              padding: '0.45rem 1.15rem',
                              fontSize: 13,
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                              boxShadow: '0 2px 6px rgba(3,47,40,0.2)'
                            }}
                          >
                            <span>Hold Emergency Stock</span>
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_forward</span>
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: Interactive Leaflet Map (5 cols) */}
          <aside className="col-span-1 lg:col-span-5 lg:sticky lg:top-24 emergency-map-column">
            <div style={{
              background: '#ffffff',
              borderRadius: 20,
              padding: '1rem',
              boxShadow: '0 1px 4px rgba(3,47,40,0.06)',
              border: '1px solid #e0f2eb',
              overflow: 'hidden'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2e685d' }}></span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#032f28' }}>Medical District Vector View</span>
                </div>
                <span style={{ fontSize: 11, color: '#717976', fontWeight: 600 }}>Privacy Preserved</span>
              </div>

              {/* Map Canvas */}
              <div className="h-[320px] sm:h-[420px] lg:h-[580px] rounded-xl overflow-hidden border border-[#d5e6e0]">
                <PharmacyMap
                  pharmacies={pharmacies}
                  center={centerCoords}
                  radiusKm={15}
                  selectedPharmacyId={selectedPharmacyId}
                  onSelectPharmacy={(target) => setSelectedPharmacyId(target && typeof target === 'object' ? target.id : target)}
                />
              </div>

              {/* Bottom Notice */}
              <div style={{
                marginTop: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: 11,
                color: '#717976'
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>info</span>
                <span>Coordinates calculated in-memory only. No location tracking or persistence is performed.</span>
              </div>
            </div>
          </aside>
        </div>
        )}

        {/* Tab 2: Availability / Restock Notification */}
        {activeTab === 'RESTOCK' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Informational Guidance Card */}
            <div style={{
              background: '#ffffff',
              borderRadius: 20,
              padding: '1.5rem',
              border: '1px solid #e0f2eb',
              boxShadow: '0 1px 4px rgba(3,47,40,0.04)'
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: '#e0f2eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#2e685d',
                  flexShrink: 0
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 26 }}>notifications_active</span>
                </div>
                <div>
                  <h2 style={{ fontSize: 20, fontWeight: 700, color: '#032f28', margin: 0 }}>
                    Medicine Availability &amp; Restock Notifications
                  </h2>
                  <p style={{ fontSize: 14, color: '#414846', margin: '0.4rem 0 0 0', lineHeight: 1.5 }}>
                    When an essential medicine is currently marked <strong>OUT OF STOCK</strong> at a participating pharmacy, you can register for an in-app availability notification. As soon as the dispensary updates stock to <strong>AVAILABLE</strong>, an alert will appear in your notification feed.
                  </p>
                  <div style={{
                    marginTop: '0.75rem',
                    padding: '0.65rem 0.85rem',
                    borderRadius: 12,
                    background: '#f8faf9',
                    border: '1px solid #d5e6e0',
                    fontSize: 12,
                    color: '#717976',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem'
                  }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>verified_user</span>
                    <span>
                      <strong>Safety Protocol:</strong> Notifications are triggered strictly by verified dispensary inventory updates. Registering does not guarantee manufacturer supply or promise restocking dates.
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Restock Feedback Alert */}
            {restockFeedback && (
              <div style={{
                padding: '0.85rem 1.25rem',
                borderRadius: 14,
                background: restockFeedback.type === 'success' ? '#e6f8f1' : '#ffdad4',
                border: `1px solid ${restockFeedback.type === 'success' ? '#34d399' : '#ffb4a8'}`,
                color: restockFeedback.type === 'success' ? '#032f28' : '#5a0100',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: 13,
                fontWeight: 600
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                    {restockFeedback.type === 'success' ? 'check_circle' : 'error'}
                  </span>
                  <span>{restockFeedback.message}</span>
                </div>
                <button
                  onClick={() => setRestockFeedback(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
                </button>
              </div>
            )}

            {/* Layout: Inventory Browser (8 cols) + Active Restock Alerts (4 cols) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="col-span-1 lg:col-span-8">
                <div style={{
                  background: '#ffffff',
                  borderRadius: 20,
                  padding: '1.25rem 1.5rem',
                  border: '1px solid #e0f2eb',
                  boxShadow: '0 1px 4px rgba(3,47,40,0.04)',
                  marginBottom: '1rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#717976', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
                        Select Participating Pharmacy
                      </label>
                      <select
                        value={selectedRestockPharmId}
                        onChange={e => setSelectedRestockPharmId(e.target.value)}
                        style={{
                          padding: '0.5rem 0.85rem',
                          borderRadius: 12,
                          border: '1px solid #c0c8c5',
                          fontSize: 14,
                          fontWeight: 600,
                          color: '#032f28',
                          background: '#f8faf9',
                          outline: 'none',
                          minWidth: 280,
                          cursor: 'pointer'
                        }}
                      >
                        {participatingPharmacies.length === 0 ? (
                          <option value="">No participating pharmacies</option>
                        ) : (
                          participatingPharmacies.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.address ? p.address.slice(0, 30) : 'Participating'})
                            </option>
                          ))
                        )}
                      </select>
                    </div>

                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button
                        onClick={() => setRestockFilter('OUT_OF_STOCK')}
                        style={{
                          background: restockFilter === 'OUT_OF_STOCK' ? '#032f28' : '#e6f8f1',
                          color: restockFilter === 'OUT_OF_STOCK' ? '#ffffff' : '#032f28',
                          border: 'none',
                          borderRadius: 99,
                          padding: '0.35rem 0.85rem',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        Out of Stock Only
                      </button>
                      <button
                        onClick={() => setRestockFilter('ALL')}
                        style={{
                          background: restockFilter === 'ALL' ? '#032f28' : '#e6f8f1',
                          color: restockFilter === 'ALL' ? '#ffffff' : '#032f28',
                          border: 'none',
                          borderRadius: 99,
                          padding: '0.35rem 0.85rem',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        All Medicines
                      </button>
                    </div>
                  </div>
                </div>

                {restockLoadingPharm ? (
                  <LoadingSkeleton variant="pharmacy-list" count={3} />
                ) : !restockPharmData || !restockPharmData.inventory || restockPharmData.inventory.length === 0 ? (
                  <div style={{ background: '#ffffff', borderRadius: 20, padding: '2rem', textAlign: 'center', border: '1px solid #e0f2eb', color: '#717976' }}>
                    No medicine inventory items reported for this pharmacy.
                  </div>
                ) : (() => {
                  const filtered = restockPharmData.inventory.filter(item => {
                    const isOos = item.status === 'OUT_OF_STOCK' || (item.stock != null && item.stock === 0);
                    if (restockFilter === 'OUT_OF_STOCK') return isOos;
                    return true;
                  });

                  if (filtered.length === 0) {
                    return (
                      <div style={{ background: '#ffffff', borderRadius: 20, padding: '2.5rem 1.5rem', textAlign: 'center', border: '1px solid #e0f2eb' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 32, color: '#2e685d', marginBottom: '0.5rem' }}>check_circle</span>
                        <h4 style={{ fontSize: 16, fontWeight: 700, color: '#032f28', margin: '0 0 0.35rem 0' }}>All Medicines Currently in Stock</h4>
                        <p style={{ fontSize: 13, color: '#717976', margin: 0 }}>
                          All catalog medications at this dispensary currently have active stock. Switch filter to "All Medicines" to view complete inventory.
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {filtered.map(item => {
                        const med = item.medicine || {};
                        const isOos = item.status === 'OUT_OF_STOCK' || (item.stock != null && item.stock === 0);
                        const activeReq = myRestockRequests.find(r => r.medicineId === item.medicineId && r.pharmacyId === selectedRestockPharmId && r.status === 'ACTIVE');
                        const isSubmitting = restockSubmittingId === item.medicineId;

                        return (
                          <div
                            key={item.id}
                            style={{
                              background: '#ffffff',
                              borderRadius: 16,
                              padding: '1.15rem 1.25rem',
                              border: activeReq ? '2px solid #2e685d' : '1px solid #e0f2eb',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              flexWrap: 'wrap',
                              gap: '1rem',
                              boxShadow: '0 1px 3px rgba(3,47,40,0.04)'
                            }}
                          >
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                                <h4 style={{ fontSize: 16, fontWeight: 700, color: '#032f28', margin: 0 }}>
                                  {item.brandName || med.brandName || med.name}
                                </h4>
                                {med.dosageForm && (
                                  <span style={{ fontSize: 11, background: '#f0f4f2', color: '#414846', padding: '1px 6px', borderRadius: 6, fontWeight: 600 }}>
                                    {med.dosageForm} {med.strength || ''}
                                  </span>
                                )}
                                {med.requiresPrescription && (
                                  <span style={{ fontSize: 10, background: '#ffdad4', color: '#ba1a1a', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>
                                    Rx Required
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 12, color: '#717976' }}>
                                {med.genericName || 'Active pharmaceutical substance'}
                              </div>
                              <div style={{ marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                {isOos ? (
                                  <span style={{
                                    background: '#ffdad4',
                                    color: '#ba1a1a',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    padding: '2px 8px',
                                    borderRadius: 99,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.25rem'
                                  }}>
                                    <span className="material-symbols-outlined" style={{ fontSize: 13 }}>do_not_disturb</span>
                                    OUT OF STOCK
                                  </span>
                                ) : (
                                  <span style={{
                                    background: '#e6f8f1',
                                    color: '#032f28',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    padding: '2px 8px',
                                    borderRadius: 99,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.25rem'
                                  }}>
                                    <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#10b981' }}>check_circle</span>
                                    IN STOCK ({item.stock != null ? item.stock : 'Available'})
                                  </span>
                                )}
                                {item.stockLastUpdated && (
                                  <span style={{ fontSize: 11, color: '#94a3b8' }}>
                                    Updated: {new Date(item.stockLastUpdated).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div>
                              {activeReq ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <span style={{
                                    background: '#e0f2eb',
                                    color: '#2e685d',
                                    fontSize: 12,
                                    fontWeight: 700,
                                    padding: '0.4rem 0.85rem',
                                    borderRadius: 99,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.35rem'
                                  }}>
                                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>notifications_active</span>
                                    Alert Active
                                  </span>
                                  <button
                                    onClick={() => handleCancelRestockRequest(activeReq.id)}
                                    style={{
                                      background: 'transparent',
                                      border: '1px solid #c0c8c5',
                                      color: '#ba1a1a',
                                      fontSize: 12,
                                      fontWeight: 600,
                                      padding: '0.35rem 0.75rem',
                                      borderRadius: 99,
                                      cursor: 'pointer'
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : isOos ? (
                                <button
                                  onClick={() => handleCreateRestockRequest(selectedRestockPharmId, item.medicineId)}
                                  disabled={isSubmitting}
                                  style={{
                                    background: '#032f28',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: 99,
                                    padding: '0.5rem 1.15rem',
                                    fontSize: 13,
                                    fontWeight: 700,
                                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.35rem',
                                    boxShadow: '0 2px 6px rgba(3,47,40,0.15)'
                                  }}
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add_alert</span>
                                  <span>{isSubmitting ? 'Registering...' : 'Notify When Available'}</span>
                                </button>
                              ) : (
                                <span style={{ fontSize: 12, color: '#717976', fontStyle: 'italic' }}>
                                  Available at dispensary counter
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {/* Sidebar: My Restock Alerts (4 cols) */}
              <div className="col-span-1 lg:col-span-4">
                <div style={{
                  background: '#ffffff',
                  borderRadius: 20,
                  padding: '1.25rem',
                  border: '1px solid #e0f2eb',
                  boxShadow: '0 1px 4px rgba(3,47,40,0.04)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#2e685d' }}>notifications</span>
                      <h3 style={{ fontSize: 15, fontWeight: 700, color: '#032f28', margin: 0 }}>
                        My Active Restock Alerts
                      </h3>
                    </div>
                    <span style={{
                      background: '#e0f2eb',
                      color: '#2e685d',
                      borderRadius: 99,
                      padding: '2px 8px',
                      fontSize: 11,
                      fontWeight: 800
                    }}>
                      {myRestockRequests.length}
                    </span>
                  </div>

                  {myRestockRequests.length === 0 ? (
                    <div style={{ padding: '1.5rem 0.5rem', textAlign: 'center', color: '#717976', fontSize: 13 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 32, color: '#c0c8c5', display: 'block', marginBottom: '0.5rem' }}>
                        notifications_off
                      </span>
                      No active restock requests.<br />
                      Select an out-of-stock medicine to receive an in-app alert upon replenishment.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {myRestockRequests.map(req => (
                        <div
                          key={req.id}
                          style={{
                            background: '#f8faf9',
                            borderRadius: 14,
                            padding: '0.85rem 1rem',
                            border: '1px solid #e0f2eb'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: '#032f28' }}>
                                {req.medicine?.brandName || req.medicine?.name || 'Medicine'}
                              </div>
                              <div style={{ fontSize: 11, color: '#2e685d', fontWeight: 600 }}>
                                {req.pharmacy?.name || 'Participating Pharmacy'}
                              </div>
                              <div style={{ fontSize: 10, color: '#717976', marginTop: '0.25rem' }}>
                                Requested: {new Date(req.createdAt).toLocaleDateString()}
                              </div>
                            </div>
                            <button
                              onClick={() => handleCancelRestockRequest(req.id)}
                              title="Cancel Alert"
                              style={{
                                background: '#ffffff',
                                border: '1px solid #c0c8c5',
                                borderRadius: 99,
                                padding: '2px 8px',
                                fontSize: 11,
                                color: '#ba1a1a',
                                fontWeight: 600,
                                cursor: 'pointer'
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Offline / Fallback Request (Phase 6.1L.9) */}
        {activeTab === 'OFFLINE' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Header & Architectural Safety Notice */}
            <div style={{
              background: '#ffffff',
              borderRadius: 20,
              padding: '1.5rem',
              border: '1px solid #e0f2eb',
              boxShadow: '0 1px 4px rgba(3,47,40,0.04)'
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: '#e0f2eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#032f28',
                  flexShrink: 0
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 26 }}>sms</span>
                </div>
                <div style={{ flex: 1 }}>
                  <h2 style={{ fontSize: 20, fontWeight: 700, color: '#032f28', margin: 0 }}>
                    Offline Emergency &amp; Fallback Pathway
                  </h2>
                  <p style={{ fontSize: 14, color: '#414846', margin: '0.4rem 0 0 0', lineHeight: 1.5 }}>
                    Direct user-initiated SMS communication and phone channels for urgent inquiries when online server connectivity is disrupted or offline response is required.
                  </p>

                  <div style={{
                    marginTop: '0.85rem',
                    padding: '0.85rem 1rem',
                    borderRadius: 14,
                    background: '#f8faf9',
                    border: '1px solid #b0ecdd',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.4rem',
                    color: '#032f28',
                    fontSize: 13
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d' }}>verified_user</span>
                      <span>Offline Operating Safety Principles</span>
                    </div>
                    <ul style={{ margin: '0.2rem 0 0 1.2rem', padding: 0, fontSize: 12, color: '#414846', lineHeight: 1.6 }}>
                      <li><strong>Native SMS Only:</strong> Uses your device's native messaging application. MediFind never sends automatic server-side SMS messages.</li>
                      <li><strong>No Online Hold / Order:</strong> Preparing an SMS does NOT create an order, reserve stock, or confirm medicine availability.</li>
                      <li><strong>Unsafe Actions Blocked:</strong> Online reservations, payments, and emergency deliveries remain strictly blocked offline to prevent dangerous stale allocations.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Interactive Fallback SMS Request Section */}
            <div style={{
              background: '#ffffff',
              borderRadius: 20,
              padding: '1.5rem',
              border: '2px solid #b0ecdd',
              boxShadow: '0 2px 8px rgba(3,47,40,0.06)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 24, color: '#032f28' }}>send_to_mobile</span>
                <div>
                  <h3 style={{ fontSize: 17, fontWeight: 800, color: '#032f28', margin: 0 }}>
                    Prepare Fallback SMS to Participating Pharmacy
                  </h3>
                  <p style={{ fontSize: 12, color: '#717976', margin: '0.15rem 0 0 0' }}>
                    Select a verified pharmacy in the network to generate an encoded native SMS inquiry.
                  </p>
                </div>
              </div>

              {/* Feedback Banners */}
              {fallbackSmsStatus === 'PREPARED' && (
                <div style={{
                  marginBottom: '1.25rem',
                  padding: '1rem',
                  borderRadius: 14,
                  background: '#e0f2eb',
                  border: '1px solid #7be495',
                  color: '#032f28'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800, fontSize: 14 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#032f28' }}>mark_chat_read</span>
                    <span>Your messaging app was opened with a prepared message. Confirm and send it yourself.</span>
                  </div>
                  <p style={{ fontSize: 12, color: '#2e685d', margin: '0.4rem 0 0 0', lineHeight: 1.5 }}>
                    Direct offline inquiry — this does NOT reserve medicine or guarantee stock. Please wait for the pharmacy to reply directly to confirm availability.
                  </p>
                  {preparedMessageText && (
                    <div style={{
                      marginTop: '0.65rem',
                      padding: '0.65rem',
                      borderRadius: 10,
                      background: '#ffffff',
                      border: '1px solid #b0ecdd',
                      fontFamily: 'monospace',
                      fontSize: 11,
                      whiteSpace: 'pre-wrap',
                      color: '#032f28'
                    }}>
                      {preparedMessageText}
                    </div>
                  )}
                </div>
              )}

              {fallbackSmsError && (
                <div style={{
                  marginBottom: '1.25rem',
                  padding: '0.85rem 1rem',
                  borderRadius: 14,
                  background: '#fff8f6',
                  border: '1px solid #ffdad4',
                  color: '#ba1a1a',
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }}>error</span>
                  <span>{fallbackSmsError}</span>
                </div>
              )}

              {/* Step 1: Select Pharmacy */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: '#032f28', display: 'block', marginBottom: '0.5rem' }}>
                  1. Select Real Participating Pharmacy
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' }}>
                  {(participatingPharmacies.length > 0 ? participatingPharmacies : FALLBACK_DEFAULT_PHARMACIES).map(p => {
                    const isSelected = selectedFallbackPharmId === p.id;
                    return (
                      <div
                        key={p.id}
                        onClick={() => setSelectedFallbackPharmId(p.id)}
                        style={{
                          padding: '1rem',
                          borderRadius: 14,
                          border: isSelected ? '2px solid #032f28' : '1px solid #c0c8c5',
                          background: isSelected ? '#f2fbf7' : '#ffffff',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.3rem'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 14, fontWeight: 800, color: '#032f28' }}>{p.name}</span>
                          <span className="material-symbols-outlined" style={{ fontSize: 18, color: isSelected ? '#032f28' : '#717976' }}>
                            {isSelected ? 'radio_button_checked' : 'radio_button_unchecked'}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: '#414846' }}>{p.address}</div>
                        <div style={{ fontSize: 12, color: '#2e685d', fontWeight: 600 }}>
                          Hours: {p.openingHours || '09:30–20:00'}
                        </div>
                        <div style={{ fontSize: 12, color: '#032f28', fontWeight: 700, marginTop: '0.2rem' }}>
                          Phone: {p.phone || 'Contact Available'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Step 2: Medicine Inquiry Context */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 700, color: '#032f28', display: 'block', marginBottom: '0.35rem' }}>
                    2. Requested Medicine Name *
                  </label>
                  <input
                    type="text"
                    value={fallbackMedName}
                    onChange={(e) => setFallbackMedName(e.target.value)}
                    placeholder="Medicine"
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      borderRadius: 12,
                      border: '1px solid #c0c8c5',
                      fontSize: 13,
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 700, color: '#032f28', display: 'block', marginBottom: '0.35rem' }}>
                    Quantity (Optional)
                  </label>
                  <input
                    type="text"
                    value={fallbackQty}
                    onChange={(e) => setFallbackQty(e.target.value)}
                    placeholder="Quantity"
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      borderRadius: 12,
                      border: '1px solid #c0c8c5',
                      fontSize: 13,
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: '#032f28', display: 'block', marginBottom: '0.35rem' }}>
                  Additional Note / Context (Optional)
                </label>
                <input
                  type="text"
                  value={fallbackNote}
                  onChange={(e) => setFallbackNote(e.target.value)}
                  placeholder="Notes"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    borderRadius: 12,
                    border: '1px solid #c0c8c5',
                    fontSize: 13,
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              {/* Step 3: Trigger Actions */}
              {(() => {
                const availablePharmacies = participatingPharmacies.length > 0 ? participatingPharmacies : FALLBACK_DEFAULT_PHARMACIES;
                const activePharm = availablePharmacies.find(p => p.id === selectedFallbackPharmId) || availablePharmacies[0];
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <button
                      onClick={handleOpenFallbackSms}
                      style={{
                        background: '#032f28',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: 14,
                        padding: '0.85rem 1.4rem',
                        fontSize: 14,
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        boxShadow: '0 2px 8px rgba(3,47,40,0.2)'
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>sms</span>
                      <span>Contact Pharmacy by SMS</span>
                    </button>

                    {activePharm?.phone && (
                      <a
                        href={buildFallbackTelUri(activePharm.phone)}
                        style={{
                          background: '#ffffff',
                          color: '#032f28',
                          border: '2px solid #032f28',
                          borderRadius: 14,
                          padding: '0.8rem 1.2rem',
                          fontSize: 13,
                          fontWeight: 700,
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem'
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d' }}>call</span>
                        <span>Call Pharmacy ({activePharm.phone})</span>
                      </a>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Lower Grid: Official Emergency Hotlines & Full Telephone Directory */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
              {/* Official Emergency Hotlines */}
              <div style={{
                background: '#ffffff',
                borderRadius: 20,
                padding: '1.5rem',
                border: '1px solid #e0f2eb',
                boxShadow: '0 1px 4px rgba(3,47,40,0.04)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 22, color: '#ba1a1a' }}>emergency</span>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: '#032f28', margin: 0 }}>
                    Official Emergency Hotlines (24/7)
                  </h3>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {networkConfig.emergencyHotlines?.map((h, i) => (
                    <div
                      key={i}
                      style={{
                        background: '#f8faf9',
                        borderRadius: 14,
                        padding: '1rem',
                        border: '1px solid #e0f2eb',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.75rem'
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: '#032f28' }}>
                          {h.label}
                        </div>
                        <div style={{ fontSize: 12, color: '#414846' }}>
                          {h.desc}
                        </div>
                      </div>
                      <a
                        href={`tel:${h.dialable || h.label}`}
                        style={{
                          background: '#032f28',
                          color: '#ffffff',
                          borderRadius: 99,
                          padding: '0.45rem 1rem',
                          fontSize: 13,
                          fontWeight: 700,
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          boxShadow: '0 2px 6px rgba(3,47,40,0.2)'
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>call</span>
                        <span>Call Now</span>
                      </a>
                    </div>
                  ))}
                </div>
              </div>

              {/* Participating Pharmacy Telephone Directory */}
              <div style={{
                background: '#ffffff',
                borderRadius: 20,
                padding: '1.5rem',
                border: '1px solid #e0f2eb',
                boxShadow: '0 1px 4px rgba(3,47,40,0.04)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 22, color: '#2e685d' }}>storefront</span>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: '#032f28', margin: 0 }}>
                    Participating Pharmacy Telephone Directory
                  </h3>
                </div>

                <p style={{ fontSize: 12, color: '#717976', margin: '0 0 1rem 0' }}>
                  Authoritative participating pharmacies in Chengannur for direct daytime telephone inquiries:
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {(participatingPharmacies.length > 0 ? participatingPharmacies : FALLBACK_DEFAULT_PHARMACIES).map(p => (
                    <div
                      key={p.id}
                      style={{
                        background: '#f8faf9',
                        borderRadius: 14,
                        padding: '1rem',
                        border: '1px solid #e0f2eb',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.75rem'
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#032f28' }}>
                          {p.name}
                        </div>
                        <div style={{ fontSize: 12, color: '#717976' }}>
                          {p.address || 'Chengannur, Kerala'}
                        </div>
                        <div style={{ fontSize: 11, color: '#2e685d', fontWeight: 600, marginTop: '0.2rem' }}>
                          Hours: {p.openingHours || '09:30 – 19:00'}
                        </div>
                      </div>
                      {p.phone && (
                        <a
                          href={`tel:${p.phone}`}
                          style={{
                            background: '#e0f2eb',
                            color: '#032f28',
                            borderRadius: 99,
                            padding: '0.45rem 0.95rem',
                            fontSize: 12,
                            fontWeight: 700,
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                            border: '1px solid #b0ecdd'
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 15, color: '#2e685d' }}>call</span>
                          <span>{p.phone}</span>
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Dedicated Stitch Screen: Emergency Pharmacy Detail / Emergency Access Request */}
      {emergencyDetailPharm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9500,
            background: 'rgba(3,47,40,0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem'
          }}
          onClick={() => {
            if (!emergencySubmitting) {
              setEmergencyDetailPharm(null);
              setEmergencySuccessOrder(null);
            }
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 24,
              width: '100%',
              maxWidth: 720,
              maxHeight: '92vh',
              overflowY: 'auto',
              boxShadow: '0 24px 64px -12px rgba(3,47,40,0.3)',
              border: '1px solid #e0f2eb',
              display: 'flex',
              flexDirection: 'column'
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{
              background: '#032f28',
              color: '#ffffff',
              padding: '1.25rem 1.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderRadius: '24px 24px 0 0'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#34d399' }}>emergency</span>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#34d399', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    Emergency Pharmacy Access Request
                  </div>
                  <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#ffffff' }}>
                    {emergencyDetailPharm.name}
                  </h3>
                </div>
              </div>
              <button
                onClick={() => {
                  setEmergencyDetailPharm(null);
                  setEmergencySuccessOrder(null);
                }}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: 99,
                  width: 32,
                  height: 32,
                  color: '#ffffff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            </div>

            {/* Success State */}
            {emergencySuccessOrder ? (
              <div style={{ padding: '2rem 1.5rem', textAlign: 'center' }}>
                <div style={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  background: '#e0f2eb',
                  border: '2px solid #b0ecdd',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 1rem'
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 32, color: '#2e685d' }}>check_circle</span>
                </div>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  marginBottom: '0.75rem',
                  background: '#e6f8f1',
                  border: '1px solid #b0ecdd',
                  borderRadius: 99,
                  padding: '3px 12px',
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#2e685d'
                }}>
                  <span>HOLD PROTOCOL ACTIVE • ORDER #{emergencySuccessOrder.orderNumber}</span>
                </div>
                <h3 style={{ fontSize: 20, fontWeight: 700, color: '#032f28', margin: '0 0 0.5rem 0' }}>
                  Emergency Stock Successfully Reserved
                </h3>
                <p style={{ color: '#414846', fontSize: 13, maxWidth: 500, margin: '0 auto 1.5rem', lineHeight: 1.5 }}>
                  The dispensary at <strong>{emergencyDetailPharm.name}</strong> has been notified to pull your medication from active shelf inventory immediately.
                </p>

                {/* Handover PIN */}
                <div style={{
                  background: '#e6f8f1',
                  border: '1.5px solid #b0ecdd',
                  borderRadius: 16,
                  padding: '1.25rem',
                  maxWidth: 380,
                  margin: '0 auto 1.5rem'
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#2e685d', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.35rem' }}>
                    🔐 Emergency Handover / Collection PIN
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 36, fontWeight: 800, color: '#032f28', letterSpacing: '0.25em' }}>
                    {emergencySuccessOrder.verificationPin || '----'}
                  </div>
                  <div style={{ fontSize: 11, color: '#414846', marginTop: '0.35rem' }}>
                    {emergencyFulfillment === 'PRIORITY_COURIER'
                      ? 'Present this 4-digit PIN to the assistant upon doorstep arrival.'
                      : 'Show this 4-digit PIN at the pharmacy billing counter for instant release.'}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => {
                      const order = emergencySuccessOrder;
                      setEmergencyDetailPharm(null);
                      setEmergencySuccessOrder(null);
                      if (onOrderCreated && order) {
                        onOrderCreated(order);
                      }
                    }}
                    style={{
                      background: '#032f28',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: 99,
                      padding: '0.65rem 1.75rem',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      boxShadow: '0 4px 12px rgba(3,47,40,0.2)'
                    }}
                  >
                    <span>Track Emergency Order Status</span>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_forward</span>
                  </button>
                </div>
              </div>
            ) : (
              /* Detail & Hold Configuration Form */
              <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Pharmacy Identity Snapshot */}
                <div style={{
                  background: '#f8faf9',
                  borderRadius: 14,
                  padding: '1rem',
                  border: '1px solid #e0f2eb',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.75rem'
                }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#717976' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 4, color: '#2e685d' }}>location_on</span>
                      {emergencyDetailPharm.address}
                    </div>
                    <div style={{ fontSize: 11, color: '#2e685d', fontWeight: 600, marginTop: '0.2rem' }}>
                      {((emergencyDetailPharm.isVerified || emergencyDetailPharm.verificationStatus === 'VERIFIED') && !emergencyDetailPharm.isTestRecord)
                        ? ' • Participating Pharmacy'
                        : ' • TEST DATA — NOT A PARTICIPATING PHARMACY'}
                    </div>
                  </div>
                  {emergencyDetailPharm.phone && (
                    <a
                      href={`tel:${emergencyDetailPharm.phone}`}
                      style={{
                        background: '#e0f2eb',
                        color: '#032f28',
                        padding: '0.35rem 0.85rem',
                        borderRadius: 99,
                        fontSize: 12,
                        fontWeight: 600,
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        border: '1px solid #b0ecdd'
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 15 }}>call</span>
                      <span>{emergencyDetailPharm.phone}</span>
                    </a>
                  )}
                </div>

                {/* Available Emergency Stock Selection */}
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Select Required Emergency Formulation
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {(emergencyDetailPharm.emergencyStockList || emergencyDetailPharm.emergencyStock || emergencyDetailPharm.inventory || []).map((inv, idx) => {
                      const isChosen = selectedEmergencyItem && (selectedEmergencyItem.medicineId === inv.medicineId || selectedEmergencyItem.id === inv.id);
                      const title = inv.brandName || inv.medicine?.brandName || inv.medicine?.name || inv.name || 'Emergency Medicine';
                      const subtitle = inv.genericName || inv.medicine?.genericName || inv.dosageForm || 'Prescription item';
                      const price = inv.price != null ? inv.price : 0.0;
                      const stockCount = inv.stock != null ? inv.stock : inv.quantity;

                      return (
                        <div
                          key={idx}
                          onClick={() => setSelectedEmergencyItem(inv)}
                          style={{
                            padding: '0.75rem 1rem',
                            borderRadius: 12,
                            border: isChosen ? '2px solid #2e685d' : '1px solid #e0f2eb',
                            background: isChosen ? '#e6f8f1' : '#ffffff',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 20, color: isChosen ? '#2e685d' : '#94a3b8' }}>
                              {isChosen ? 'radio_button_checked' : 'radio_button_unchecked'}
                            </span>
                            <div>
                              <div style={{ fontSize: 14, fontWeight: 700, color: '#032f28' }}>{title}</div>
                              <div style={{ fontSize: 11, color: '#717976' }}>{subtitle}</div>
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: '#032f28' }}>
                              {price > 0 ? `₹${Number(price).toFixed(2)}` : 'Pay at pickup'}
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#2e685d', background: '#ffffff', padding: '2px 8px', borderRadius: 99, border: '1px solid #c0c8c5' }}>
                              {stockCount ? `${stockCount} available` : 'In stock'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Quantity Control */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#032f28' }}>Requested Emergency Units:</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <button
                      onClick={() => setEmergencyQty(Math.max(1, emergencyQty - 1))}
                      style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #c0c8c5', background: '#fff', cursor: 'pointer', fontWeight: 700 }}
                    >
                      -
                    </button>
                    <span style={{ fontSize: 16, fontWeight: 700, color: '#032f28', minWidth: 24, textAlign: 'center' }}>
                      {emergencyQty}
                    </span>
                    <button
                      onClick={() => setEmergencyQty(Math.min(5, emergencyQty + 1))}
                      style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #c0c8c5', background: '#fff', cursor: 'pointer', fontWeight: 700 }}
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Fulfillment Dispatch Selection */}
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    How would you like to receive your medicine?
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
                    <div
                      onClick={() => setEmergencyFulfillment('URGENT_COUNTER')}
                      style={{
                        border: emergencyFulfillment === 'URGENT_COUNTER' ? '2px solid #2e685d' : '1px solid #e0f2eb',
                        background: emergencyFulfillment === 'URGENT_COUNTER' ? '#e6f8f1' : '#fff',
                        borderRadius: 12,
                        padding: '0.75rem 1rem',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#032f28', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d' }}>storefront</span>
                          In-Store Counter Hold
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#2e685d', background: '#d5e6e0', padding: '1px 6px', borderRadius: 99 }}>
                          FREE
                        </span>
                      </div>
                      <p style={{ fontSize: 11, color: '#717976', margin: 0 }}>
                        Pharmacy holds items behind billing desk for 60 minutes.
                      </p>
                    </div>

                    <div
                      onClick={() => setEmergencyFulfillment('PRIORITY_COURIER')}
                      style={{
                        border: emergencyFulfillment === 'PRIORITY_COURIER' ? '2px solid #2e685d' : '1px solid #e0f2eb',
                        background: emergencyFulfillment === 'PRIORITY_COURIER' ? '#e6f8f1' : '#fff',
                        borderRadius: 12,
                        padding: '0.75rem 1rem',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#032f28', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d' }}>support_agent</span>
                          Medicine Access Assistant
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#032f28' }}>
                          ₹80.00
                        </span>
                      </div>
                      <p style={{ fontSize: 11, color: '#717976', margin: 0 }}>
                        Designated Medicine Access Assistant dispatched for urgent doorstep transit.
                      </p>
                    </div>
                  </div>

                  {emergencyFulfillment === 'PRIORITY_COURIER' && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#414846', marginBottom: '0.35rem' }}>
                        Emergency Delivery Address *
                      </label>
                      <input
                        type="text"
                        value={emergencyDeliveryAddress}
                        onChange={e => setEmergencyDeliveryAddress(e.target.value)}
                        placeholder="Address"
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          padding: '0.6rem 0.85rem',
                          borderRadius: 10,
                          border: '1px solid #c0c8c5',
                          fontSize: 13
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Error Banner */}
                {emergencyError && (
                  <div style={{ background: '#ffdad6', color: '#ba1a1a', padding: '0.65rem 1rem', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>
                    {emergencyError}
                  </div>
                )}

                {/* Pricing Breakdown & Action Button */}
                <div style={{
                  borderTop: '1px solid #e0f2eb',
                  paddingTop: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '1rem'
                }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#717976' }}>
                      Total ({emergencyQty} unit{emergencyQty > 1 ? 's' : ''} + {emergencyFulfillment === 'PRIORITY_COURIER' ? '₹80 Assistant service fee' : 'free hold'}):
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#032f28' }}>
                      ₹{(((selectedEmergencyItem?.price != null ? selectedEmergencyItem.price : 0.0) * emergencyQty) + (emergencyFulfillment === 'PRIORITY_COURIER' ? 80.0 : 0.0)).toFixed(2)}
                    </div>
                  </div>

                  <button
                    onClick={handleConfirmEmergencyHold}
                    disabled={emergencySubmitting || !selectedEmergencyItem}
                    style={{
                      background: '#032f28',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: 99,
                      padding: '0.65rem 1.65rem',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: emergencySubmitting ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      boxShadow: '0 2px 8px rgba(3,47,40,0.2)'
                    }}
                  >
                    <span>{emergencySubmitting ? 'Transmitting Hold...' : 'Confirm Emergency Hold Request'}</span>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>bolt</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Fallback Availability / Reservation Modal */}
      {availModalOpen && (
        <AvailabilityModal
          isOpen={availModalOpen}
          onClose={() => setAvailModalOpen(false)}
          items={selectedEmergencyMed ? [{ name: selectedEmergencyMed, quantity: 1 }] : []}
          isEmergency={true}
          onOrderCreated={(order) => {
            setAvailModalOpen(false);
            if (onOrderCreated) onOrderCreated(order);
          }}
        />
      )}
    </div>
  );
}
