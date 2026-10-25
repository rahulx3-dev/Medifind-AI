import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import AvailabilityModal from '../components/AvailabilityModal';
import ConfirmationDialog from '../components/ConfirmationDialog';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import { getMedicineImageUrl } from '../data/medicineImages';
import { getVerifiedPrice, getVerifiedUnitPrice, getVerifiedPackSize, roundCurrency } from '../utils/referencePricing';
import { triggerToast } from '../components/ToastAlert';
import VoiceSearchModal from '../components/VoiceSearchModal';
import PromptInput from '../components/ui/PromptInput';
import ChipGradientBg from '../components/ui/ChipGradientBg';
import { useRealtimeRefresh } from '../utils/realtimeUpdates';
import { usePortalGreeting } from '../utils/greetingUtils';
import RollingNumber from '../components/ui/RollingNumber';

/* ── Vertical scroll animation styles ───────────────────────────────────── */
const scrollAnimStyles = `
@keyframes medicineScrollUp {
  0%   { transform: translateY(0); }
  100% { transform: translateY(-50%); }
}
.medicine-scroll-track {
  overflow: hidden;
  position: relative;
}
.medicine-scroll-inner {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  animation: medicineScrollUp 28s linear infinite;
  will-change: transform;
}
.medicine-scroll-inner:hover,
.medicine-scroll-track.is-filtered .medicine-scroll-inner {
  animation-play-state: paused;
}
@media (max-width: 1279px) {
  .medicine-scroll-inner { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 639px) {
  .medicine-scroll-inner { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .medicine-scroll-inner {
    animation: none !important;
    transform: none !important;
  }
}
`;

function validateCachedCatalog(cachedStr) {
  if (!cachedStr || typeof cachedStr !== 'string') return null;
  try {
    const data = JSON.parse(cachedStr);
    if (!data || typeof data !== 'object') return null;
    if (!Array.isArray(data.medicines) || data.medicines.length === 0) return null;
    const valid = data.medicines.every(m =>
      m && typeof m === 'object' &&
      typeof m.id === 'string' && m.id.length > 0 &&
      typeof m.brandName === 'string' && m.brandName.length > 0 &&
      typeof m.category === 'string'
    );
    if (!valid) return null;
    return data.medicines;
  } catch (e) {
    return null;
  }
}

const HEALTH_CONCERNS = [
  { id: 'diabetes', label: 'Diabetes & Endocrine', icon: 'bloodtype', keywords: ['diabetes', 'diabetic', 'metformin', 'glimepiride', 'insulin', 'glycomet'] },
  { id: 'heart', label: 'Heart & BP', icon: 'cardiology', keywords: ['cardio', 'heart', 'hypertensive', 'statin', 'amlodipine', 'atorvastatin', 'telmisartan'] },
  { id: 'stomach', label: 'Gastroenterology', icon: 'medication_liquid', keywords: ['gastro', 'antacid', 'ppi', 'pantoprazole', 'pan 40', 'digene', 'omeprazole', 'rabeprazole'] },
  { id: 'respiratory', label: 'Respiratory & Chest', icon: 'air', keywords: ['respiratory', 'inhaler', 'asthma', 'bronchodilator', 'montair', 'levocetirizine', 'asthalin', 'cough'] },
  { id: 'pain', label: 'Pain & Orthopedics', icon: 'healing', keywords: ['analgesic', 'nsaid', 'paracetamol', 'dolo', 'brufen', 'ibuprofen', 'combiflam', 'pain'] },
  { id: 'infections', label: 'Anti-infectives', icon: 'vaccines', keywords: ['antibiotic', 'antimicrobial', 'azithromycin', 'taxim', 'amoxicillin', 'cefixime', 'ciprofloxacin'] },
  { id: 'skin', label: 'Dermatology & Skin', icon: 'sanitizer', keywords: ['dermatology', 'topical', 'antifungal', 'candid', 'betnovate', 'clotrimazole', 'skin'] },
];

export const THERAPEUTIC_GROUPS = [
  {
    id: 'pain',
    label: 'Pain & Analgesics',
    icon: 'healing',
    badge: 'Fast Relief',
    match: m => /analgesic|nsaid|antipyretic|pain|antispasmodic/i.test(m?.category || '') || /dolo|crocin|combiflam|paracetamol|brufen|tramadol|meftal|zerodol|saridon|voveran/i.test(m?.brandName || '')
  },
  {
    id: 'antibiotics',
    label: 'Antibiotics & Anti-infectives',
    icon: 'vaccines',
    badge: 'Clinical Rx',
    match: m => /antibiotic|antimicrobial|antibacterial|antiprotozoal/i.test(m?.category || '') || /augmentin|azithral|ciplox|taxim|monocef|flagyl|avelox|amoxyclav|zifi|doxy/i.test(m?.brandName || '')
  },
  {
    id: 'gastro',
    label: 'Gastrointestinal Care',
    icon: 'medication_liquid',
    badge: 'Digestive Health',
    match: m => /proton pump|ppi|antacid|laxative|probiotic|antiemetic|h2 receptor|mucosal|gastro/i.test(m?.category || '') || /pan|pantocid|omez|rantac|emeset|digene|cremaffin|econorm|sucrafil|razo/i.test(m?.brandName || '')
  },
  {
    id: 'cardiac_chronic',
    label: 'Cardiac, BP & Chronic Care',
    icon: 'cardiology',
    badge: 'Daily Maintenance',
    match: m => /antihypertensive|calcium channel|antidiabetic|antiplatelet|lipid|beta blocker|thyroid|cardio|statin/i.test(m?.category || '') || /telma|amlong|glycomet|januvia|ecosprin|atorva|betaloc|eltroxin|forxiga|nebicard/i.test(m?.brandName || '')
  },
  {
    id: 'respiratory_emergency',
    label: 'Respiratory & Emergency Care',
    icon: 'emergency',
    badge: 'Critical & Emergency',
    match: m => /bronchodilator|emergency|corticosteroid|antihistamine|diuretic|inhaler|allergy/i.test(m?.category || '') || /asthalin|sorbitrate|adrenaline|deriphyllin|budecort|allegra|cetcip|omnacortil|lasix|atropine/i.test(m?.brandName || '')
  }
];

export default function MedicineSearch({
  onOrderCreated,
  selectedMedicines = [],
  onAddToRequest,
  onUpdateRequestQuantity,
  onRemoveFromRequest,
  onClearRequest,
  onProceedToPharmacies,
  onNavigateToPrescription,
  onNavigateToEmergency,
  onNavigateToOrders,
  onNavigateToHealthcare
}) {
  const { user } = useAuth();
  const { isDark } = useTheme();
  const scrollContainerRef = useRef(null);
  const [medicines, setMedicines] = useState(() => {
    try {
      const cached = localStorage.getItem('medifind_offline_catalog');
      return validateCachedCatalog(cached) || [];
    } catch {
      return [];
    }
  });
  const [categories, setCategories] = useState(() => {
    try {
      const cached = localStorage.getItem('medifind_offline_catalog');
      const validMeds = validateCachedCatalog(cached);
      if (validMeds && validMeds.length > 0) {
        return ['ALL', ...Array.from(new Set(validMeds.map(m => m.category).filter(Boolean)))];
      }
      return [];
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = useState(() => {
    try {
      const cached = localStorage.getItem('medifind_offline_catalog');
      return !(validateCachedCatalog(cached)?.length > 0);
    } catch {
      return true;
    }
  });

  // Search & Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedCategoryTab, setSelectedCategoryTab] = useState('ALL');
  const [filterTag, setFilterTag] = useState('all'); // 'all' | 'rx' | 'otc' | 'instock'
  const [dosageFormFilter, setDosageFormFilter] = useState('ALL'); // 'ALL' | 'Tablet' | 'Capsule' | 'Inhaler' | 'Syrup' | 'Injection'
  const [sortBy, setSortBy] = useState('name-asc'); // 'name-asc' | 'name-desc' | 'price-asc' | 'price-desc'
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [categoryOverrideNote, setCategoryOverrideNote] = useState('');
  const [selectedHealthConcern, setSelectedHealthConcern] = useState(null);

  // Carousel banner state & auto-advance timer
  const [bannerSlide, setBannerSlide] = useState(0);
  const [isCarouselPaused, setIsCarouselPaused] = useState(false);

  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [offlineError, setOfflineError] = useState(null);

  // Availability Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedItemsForModal, setSelectedItemsForModal] = useState([]);

  // Dedicated Reservation Cart Card State
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);

  // Voice search modal state
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);

  // Network live status – pings backend every 30s
  const [networkLive, setNetworkLive] = useState(null); // null = checking, true = live, false = offline

  // Smart display name & dynamic time-of-day greeting — reactive to profile edits
  const { firstName: patientFirstName, timeGreet: patientTimeGreet, icon: patientGreetIcon } = usePortalGreeting(user, 'PATIENT');

  // Toast feedback state
  const [feedback, setFeedback] = useState({ show: false, message: '', type: 'success' });
  const showToast = (message, type = 'success') => {
    setFeedback({ show: true, message, type });
    triggerToast({
      title: type === 'error' ? 'Notice' : 'Success',
      message,
      variant: type === 'error' ? 'destructive' : type
    });
    setTimeout(() => setFeedback({ show: false, message: '', type: 'success' }), 4000);
  };

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    variant: 'danger',
    impactPoints: [],
    onConfirm: () => {}
  });

  // Debounce search query so typing automatically and smoothly triggers search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const handleOnline = () => { setIsOffline(false); setOfflineError(null); fetchMedicines(); fetchCategories(); };
    const handleOffline = () => { setIsOffline(true); setNetworkLive(false); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Periodic backend health check for Network Live indicator
  useEffect(() => {
    let alive = true;
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/medicines/categories', { method: 'GET', signal: AbortSignal.timeout(5000) });
        if (alive) setNetworkLive(res.ok);
      } catch {
        if (alive) setNetworkLive(false);
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => { alive = false; clearInterval(interval); };
  }, []);

  useEffect(() => {
    fetchCategories();
  }, []);

  useEffect(() => {
    fetchMedicines();
  }, [debouncedSearchQuery, selectedCategory]);

  // Real-time automatic background refresh (heartbeat + event triggers)
  useRealtimeRefresh({
    onRefresh: () => {
      fetchMedicines(null, true);
    },
    interval: 30000
  });

  async function fetchMedicines(forceCategory = null, isBackground = false) {
    if (!isBackground) {
      setLoading(true);
      setOfflineError(null);
      setCategoryOverrideNote('');
    }

    if (!navigator.onLine) {
      handleOfflineFallback();
      if (!isBackground) setLoading(false);
      return;
    }

    try {
      const effectiveCategory = forceCategory !== null ? forceCategory : selectedCategory;
      const q = debouncedSearchQuery.trim();

      const params = new URLSearchParams();
      if (q) params.append('query', q);
      if (effectiveCategory !== 'ALL') params.append('category', effectiveCategory);

      const res = await fetch(`/api/medicines/search?${params.toString()}`);
      const data = await res.json();

      if (data.success) {
        let results = data.medicines || [];

        // SMART SEARCH RECOVERY: If a search query was typed with a specific category selected,
        // and returns 0 results, automatically query across ALL categories so the user finds the medicine!
        if (results.length === 0 && q && effectiveCategory !== 'ALL') {
          const allCatRes = await fetch(`/api/medicines/search?query=${encodeURIComponent(q)}`);
          const allCatData = await allCatRes.json();
          if (allCatData.success && (allCatData.medicines || []).length > 0) {
            results = allCatData.medicines;
            setCategoryOverrideNote(`No results in "${effectiveCategory}". Found ${results.length} formulation(s) across All Categories.`);
          }
        }

        setMedicines(results);

        if (!q && effectiveCategory === 'ALL') {
          localStorage.setItem('medifind_offline_catalog', JSON.stringify({
            timestamp: Date.now(),
            version: '1.0.0',
            medicines: results
          }));
        }
      } else {
        handleOfflineFallback();
      }
    } catch (err) {
      console.warn('Network error, attempting offline fallback:', err);
      handleOfflineFallback();
    } finally {
      if (!isBackground) setLoading(false);
    }
  }

  function handleOfflineFallback() {
    setIsOffline(true);
    const cachedStr = localStorage.getItem('medifind_offline_catalog');
    const validMeds = validateCachedCatalog(cachedStr);

    if (validMeds) {
      let filtered = validMeds;
      const q = (debouncedSearchQuery || searchQuery).toLowerCase().trim();
      if (q) {
        filtered = filtered.filter(m =>
          m.brandName?.toLowerCase().includes(q) ||
          m.genericName?.toLowerCase().includes(q) ||
          m.category?.toLowerCase().includes(q) ||
          m.commonUses?.toLowerCase().includes(q)
        );
      }
      if (selectedCategory !== 'ALL') {
        const catFiltered = filtered.filter(m => m.category?.toLowerCase().includes(selectedCategory.toLowerCase()));
        if (catFiltered.length > 0 || !q) {
          filtered = catFiltered;
        } else if (q) {
          setCategoryOverrideNote(`No results in "${selectedCategory}". Showing all matches for "${q}".`);
        }
      }
      setMedicines(filtered);
      setOfflineError(null);

      const uniqueCats = ['ALL', ...Array.from(new Set(validMeds.map(m => m.category).filter(Boolean)))];
      setCategories(uniqueCats);
    } else {
      localStorage.removeItem('medifind_offline_catalog');
      setMedicines([]);
      setOfflineError('You are currently offline and no valid cached medicine catalogue was found. Please reconnect.');
    }
  }

  async function fetchCategories() {
    if (!navigator.onLine) return;
    try {
      const res = await fetch('/api/medicines/categories');
      const data = await res.json();
      if (data.success) {
        setCategories(['ALL', ...data.categories]);
      }
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  }

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchMedicines();
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setCategoryOverrideNote('');
  };

  const handleResetAllFilters = () => {
    setSelectedCategory('ALL');
    setSelectedCategoryTab('ALL');
    setFilterTag('all');
    setDosageFormFilter('ALL');
    setSortBy('name-asc');
    setCategoryOverrideNote('');
    setSearchQuery('');
    setSelectedHealthConcern(null);
  };

  const handleCheckAvailability = (med) => {
    if (onAddToRequest) {
      onAddToRequest(med, 1);
    }
    setSelectedItemsForModal([{ medicineId: med.id, brandName: med.brandName, quantity: 1 }]);
    setModalOpen(true);
  };

  const handleCheckAvailabilityForAll = () => {
    if (!selectedMedicines || selectedMedicines.length === 0) return;
    setSelectedItemsForModal(
      selectedMedicines.map(m => ({
        medicineId: m.medicineId,
        brandName: m.brandName,
        quantity: m.quantity || 1
      }))
    );
    setModalOpen(true);
  };

  // Count active clinical filters applied
  const activeFilterCount = (selectedCategory !== 'ALL' ? 1 : 0) +
    (filterTag !== 'all' ? 1 : 0) +
    (dosageFormFilter !== 'ALL' ? 1 : 0) +
    (selectedHealthConcern ? 1 : 0) +
    (sortBy !== 'name-asc' ? 1 : 0);

  // Compute displayed medicines with active filters and sorting
  let displayedMedicines = medicines.filter(med => {
    // 1. Health Concern Focus Filter
    if (selectedHealthConcern) {
      const concernObj = HEALTH_CONCERNS.find(c => c.id === selectedHealthConcern);
      if (concernObj) {
        const text = `${med.brandName} ${med.genericName} ${med.category || ''} ${med.commonUses || ''}`.toLowerCase();
        const matches = concernObj.keywords.some(k => text.includes(k.toLowerCase()));
        if (!matches) return false;
      }
    }

    // 2. Regulatory Status Filter
    if (filterTag === 'rx') {
      const isRx = med.requiresPrescription || med.isEmergency || (med.dosageForm && med.dosageForm.toLowerCase().includes('inhaler')) || med.category?.toLowerCase().includes('antibiotic');
      if (!isRx) return false;
    }
    if (filterTag === 'otc') {
      const isRx = med.requiresPrescription || med.isEmergency || med.category?.toLowerCase().includes('antibiotic');
      if (isRx) return false;
    }
    if (filterTag === 'emergency' && !med.isEmergency) return false;

    // 3. Dosage Form Filter
    if (dosageFormFilter !== 'ALL') {
      if (!med.dosageForm?.toLowerCase().includes(dosageFormFilter.toLowerCase())) return false;
    }

    return true;
  });

  // 3. Sorting
  displayedMedicines.sort((a, b) => {
    if (sortBy === 'name-asc') return (a.brandName || '').localeCompare(b.brandName || '');
    if (sortBy === 'name-desc') return (b.brandName || '').localeCompare(a.brandName || '');
    const priceA = a.price != null && !isNaN(a.price) ? Number(a.price) : null;
    const priceB = b.price != null && !isNaN(b.price) ? Number(b.price) : null;
    if (sortBy === 'price-asc') {
      if (priceA === null && priceB === null) return 0;
      if (priceA === null) return 1;
      if (priceB === null) return -1;
      return priceA - priceB;
    }
    if (sortBy === 'price-desc') {
      if (priceA === null && priceB === null) return 0;
      if (priceA === null) return 1;
      if (priceB === null) return -1;
      return priceB - priceA;
    }
    return 0;
  });

  const hasRxItemsInRequest = (selectedMedicines || []).some(item => {
    const med = medicines.find(m => m.id === item.medicineId);
    return med ? (med.isEmergency || med.requiresPrescription || med.category?.toLowerCase().includes('antibiotic')) : false;
  });

  const bannerSlides = [
    {
      tag: "Prescription OCR Pipeline",
      title: "Need medicines from a doctor's prescription?",
      desc: "Upload a physical prescription or e-Rx PDF. MediFind automatically extracts your items and locates matching stocks across Chengannur dispensaries.",
      buttonText: "Upload & Verify Rx",
      action: () => (onNavigateToPrescription ? onNavigateToPrescription() : onProceedToPharmacies()),
      background: isDark
        ? 'linear-gradient(135deg, #0d2821 0%, #11362d 50%, #0a1f1a 100%)'
        : 'linear-gradient(135deg, #e8f5e9 0%, #f4faf7 50%, #e0f2eb 100%)',
      decorBg: isDark ? 'rgba(52, 211, 153, 0.08)' : 'rgba(18, 128, 95, 0.08)',
      badgeBg: isDark ? 'rgba(52, 211, 153, 0.16)' : 'rgba(18, 128, 95, 0.12)',
      badgeColor: isDark ? '#6ee7b7' : '#0b4a3c',
      buttonBg: isDark ? '#10b981' : '#032f28',
      buttonColor: isDark ? '#02201b' : '#ffffff',
      icon: 'document_scanner'
    },
    {
      tag: "24/7 Night Duty Network",
      title: "Urgent & Late-Night Medicine Access",
      desc: "Find duty pharmacies open right now near Central Junction, Bethenny & MC Road with emergency critical inhalers, cardiac medicines and injectables.",
      buttonText: "Find Duty Pharmacy",
      action: () => (onNavigateToEmergency ? onNavigateToEmergency() : onProceedToPharmacies()),
      background: isDark
        ? 'linear-gradient(135deg, #08283b 0%, #0c334b 50%, #051926 100%)'
        : 'linear-gradient(135deg, #e0f2fe 0%, #f8fafc 50%, #f0f9ff 100%)',
      decorBg: isDark ? 'rgba(56, 189, 248, 0.08)' : 'rgba(2, 132, 199, 0.08)',
      badgeBg: isDark ? 'rgba(56, 189, 248, 0.16)' : 'rgba(2, 132, 199, 0.12)',
      badgeColor: isDark ? '#7dd3fc' : '#0369a1',
      buttonBg: '#0284c7',
      buttonColor: '#ffffff',
      icon: 'local_hospital'
    },
    {
      tag: "Zero-Markup Direct Pricing",
      title: "Verified Retail Inventory with Counter Pickup",
      desc: "Reserve authenticated medicines directly at licensed dispensaries. Zero markups, instant counter verification, and guaranteed batch tracking.",
      buttonText: "Explore Full Inventory",
      action: () => {
        const el = document.getElementById('catalog-grid-anchor');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      },
      background: isDark
        ? 'linear-gradient(135deg, #301f06 0%, #40290a 50%, #201403 100%)'
        : 'linear-gradient(135deg, #fef3c7 0%, #fffdf5 50%, #fef9c3 100%)',
      decorBg: isDark ? 'rgba(245, 158, 11, 0.08)' : 'rgba(217, 119, 6, 0.08)',
      badgeBg: isDark ? 'rgba(245, 158, 11, 0.16)' : 'rgba(217, 119, 6, 0.12)',
      badgeColor: isDark ? '#fde047' : '#92400e',
      buttonBg: isDark ? '#d97706' : '#b45309',
      buttonColor: '#ffffff',
      icon: 'verified'
    },
    {
      tag: "Doorstep Clinical Services",
      title: "Book Certified Nurses & At-Home Clinical Care",
      desc: "Schedule licensed home healthcare professionals for IV infusions, wound dressing, vitals monitoring, and physiotherapy in Chengannur.",
      buttonText: "Book Home Care Visit",
      action: () => (onNavigateToHealthcare ? onNavigateToHealthcare('services') : onProceedToPharmacies()),
      background: isDark
        ? 'linear-gradient(135deg, #261244 0%, #34185c 50%, #170b2c 100%)'
        : 'linear-gradient(135deg, #ede9fe 0%, #fdf4ff 50%, #fae8ff 100%)',
      decorBg: isDark ? 'rgba(168, 85, 247, 0.08)' : 'rgba(124, 58, 237, 0.08)',
      badgeBg: isDark ? 'rgba(168, 85, 247, 0.16)' : 'rgba(124, 58, 237, 0.12)',
      badgeColor: isDark ? '#d8b4fe' : '#5b21b6',
      buttonBg: isDark ? '#8b5cf6' : '#6d28d9',
      buttonColor: '#ffffff',
      icon: 'home_health'
    },
    {
      tag: "1-on-1 Clinical Tele-Assistance",
      title: "Direct Pharmacist Consultation & Second Opinion",
      desc: "Speak with registered clinical pharmacists in English, Malayalam, or Hindi. Verify dosages, check drug-drug interactions, and resolve prescription doubts.",
      buttonText: "Consult Clinical Officer",
      action: () => (onNavigateToHealthcare ? onNavigateToHealthcare('clinical-assistance') : (onNavigateToPrescription ? onNavigateToPrescription() : onProceedToPharmacies())),
      background: isDark
        ? 'linear-gradient(135deg, #092e28 0%, #0e3d36 50%, #051d19 100%)'
        : 'linear-gradient(135deg, #ccfbf1 0%, #f0fdfa 50%, #e0f2fe 100%)',
      decorBg: isDark ? 'rgba(20, 184, 166, 0.08)' : 'rgba(13, 148, 136, 0.08)',
      badgeBg: isDark ? 'rgba(20, 184, 166, 0.16)' : 'rgba(13, 148, 136, 0.12)',
      badgeColor: isDark ? '#5eead4' : '#115e59',
      buttonBg: isDark ? '#14b8a6' : '#0f766e',
      buttonColor: isDark ? '#02201b' : '#ffffff',
      icon: 'support_agent'
    },
    {
      tag: "Universal Rx Matching",
      title: "Multi-Pharmacy Smart Split Order Fulfillment",
      desc: "Missing medicines from a single shop? MediFind automatically splits your prescription across nearby verified Chengannur dispensaries with unified single checkout.",
      buttonText: "Find Nearby Dispensaries",
      action: () => (onProceedToPharmacies ? onProceedToPharmacies() : (onNavigateToPrescription ? onNavigateToPrescription() : null)),
      background: isDark
        ? 'linear-gradient(135deg, #2b2306 0%, #3a2e0a 50%, #1b1603 100%)'
        : 'linear-gradient(135deg, #fefce8 0%, #fffbeb 50%, #fef3c7 100%)',
      decorBg: isDark ? 'rgba(234, 179, 8, 0.08)' : 'rgba(202, 138, 4, 0.08)',
      badgeBg: isDark ? 'rgba(234, 179, 8, 0.16)' : 'rgba(202, 138, 4, 0.12)',
      badgeColor: isDark ? '#fde047' : '#854d0e',
      buttonBg: isDark ? '#ca8a04' : '#a16207',
      buttonColor: '#ffffff',
      icon: 'call_split'
    },
    {
      tag: "Home Diagnostic Lab Tests",
      title: "At-Home Blood Sample Collection & Pathology",
      desc: "Certified phlebotomists collect blood & diagnostic samples right at your doorstep. Fast accredited pathology results sent straight to your portal.",
      buttonText: "Explore Diagnostic Tests",
      action: () => (onNavigateToHealthcare ? onNavigateToHealthcare('services') : onProceedToPharmacies()),
      background: isDark
        ? 'linear-gradient(135deg, #350b16 0%, #46101f 50%, #22060d 100%)'
        : 'linear-gradient(135deg, #ffe4e6 0%, #fff1f2 50%, #fce7f3 100%)',
      decorBg: isDark ? 'rgba(244, 63, 94, 0.08)' : 'rgba(225, 29, 72, 0.08)',
      badgeBg: isDark ? 'rgba(244, 63, 94, 0.16)' : 'rgba(225, 29, 72, 0.12)',
      badgeColor: isDark ? '#fda4af' : '#9f1239',
      buttonBg: isDark ? '#f43f5e' : '#be123c',
      buttonColor: '#ffffff',
      icon: 'biotech'
    }
  ];

  useEffect(() => {
    if (isCarouselPaused) return;
    const timer = setInterval(() => {
      setBannerSlide(prev => (prev + 1) % bannerSlides.length);
    }, 5500);
    return () => clearInterval(timer);
  }, [isCarouselPaused, bannerSlides.length]);

  const orderAgainMedicines = medicines.slice(0, 6);

  const renderMedicineCard = (med, idx = 0) => {
    const reqItem = (selectedMedicines || []).find(i => i.medicineId === med.id);
    const isRx = med.requiresPrescription || med.isEmergency || (med.dosageForm && med.dosageForm.toLowerCase().includes('inhaler')) || med.category?.toLowerCase().includes('antibiotic');
    const imgUrl = getMedicineImageUrl(med);
    const rawPrice = getVerifiedPrice(med);
    const packPrice = rawPrice != null ? Number(rawPrice) : 32.28;
    const unitsPerPack = med.unitsPerPack || 1;
    const rawUnitPrice = getVerifiedUnitPrice(med);
    const unitPrice = rawUnitPrice != null ? Number(rawUnitPrice) : (unitsPerPack > 1 ? roundCurrency(packPrice / unitsPerPack) : packPrice);
    const packQuantity = getVerifiedPackSize(med);
    const allowIndividual = unitsPerPack > 1 && (
      (med.dosageForm || '').toLowerCase().includes('tablet') ||
      (med.dosageForm || '').toLowerCase().includes('capsule')
    );

    return (
      <article
        key={`card-${med.id}-${idx}`}
        className="bg-white rounded-xl sm:rounded-2xl p-2.5 sm:p-3 shadow-2xs hover:shadow-md transition-all border border-[#e2e8f0] hover:border-[#1b7058]/40 flex flex-col justify-between group h-full"
      >
        <div>
          {/* Product Visual Imagery Well */}
          <div className="relative w-full h-20 sm:h-28 rounded-lg sm:rounded-xl bg-[#f8fafc] border border-[#edf2f7] flex items-center justify-center mb-2 sm:mb-2.5 overflow-hidden p-1.5 sm:p-2 group-hover:bg-white group-hover:border-[#1b7058]/30 transition-all shadow-2xs">
            {imgUrl ? (
              <img
                src={imgUrl}
                alt={med.brandName}
                className="w-full h-full object-contain mix-blend-multiply transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
                onError={(e) => {
                  e.target.style.display = 'none';
                  if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                }}
              />
            ) : null}
            <div
              style={{ display: imgUrl ? 'none' : 'flex' }}
              className="w-8 h-8 sm:w-11 sm:h-11 rounded-full bg-secondary-container/40 items-center justify-center text-secondary group-hover:scale-105 transition-transform"
            >
              <span className="material-symbols-outlined text-lg sm:text-2xl">medication</span>
            </div>
            {isRx && (
              <span className="absolute top-1 left-1 sm:top-2 sm:left-2 px-1.5 sm:px-2 py-0.5 rounded-full text-[8px] sm:text-[9px] font-extrabold bg-[#0a3d34]/90 text-white backdrop-blur-xs shadow-2xs">
                Rx
              </span>
            )}
          </div>

          {/* Clean Visual Hierarchy: Name and Quantity */}
          <div className="space-y-0.5">
            <h3 className="text-xs sm:text-sm font-bold text-primary leading-tight line-clamp-1">
              {med.brandName}
            </h3>
            <p className="text-[10px] sm:text-[11px] text-on-surface-variant font-medium">
              {packQuantity}
            </p>
          </div>
        </div>

        {/* Footer: Verified Price & Add / Stepper Button */}
        <div className="mt-2 pt-2 sm:mt-2.5 sm:pt-2 border-t border-surface-container flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
          <div className="flex flex-col">
            <span className="text-[8px] sm:text-[9px] text-on-surface-variant uppercase tracking-wider font-semibold">
              {allowIndividual ? 'Strip MRP' : 'Price'}
            </span>
            <span className="text-xs sm:text-sm font-bold text-primary">
              ₹{packPrice.toFixed(2)}
            </span>
            {allowIndividual && (
              <span className="text-[8px] sm:text-[9px] text-secondary font-medium">
                ₹{unitPrice.toFixed(2)} / tab
              </span>
            )}
          </div>

          {reqItem ? (
            <div className="flex items-center justify-between sm:justify-start gap-1 bg-surface-container px-1.5 py-0.5 rounded-full w-full sm:w-auto">
              <button
                type="button"
                onClick={() => onUpdateRequestQuantity && onUpdateRequestQuantity(med.id, reqItem.quantity - 1)}
                className="w-5 h-5 rounded-full bg-surface-container-lowest text-primary hover:bg-surface-container-high flex items-center justify-center transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-xs">remove</span>
              </button>
              <span className="text-[10px] font-bold text-primary px-1">
                {reqItem.quantity} {reqItem.saleUnit === 'TABLET' ? 'tab' : 'strip'}
              </span>
              <button
                type="button"
                onClick={() => onUpdateRequestQuantity && onUpdateRequestQuantity(med.id, reqItem.quantity + 1)}
                className="w-5 h-5 rounded-full bg-primary text-white hover:bg-primary-container flex items-center justify-center transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-xs">add</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 w-full sm:w-auto">
              {allowIndividual && (
                <button
                  type="button"
                  title={`Add 1 tablet at ₹${unitPrice.toFixed(2)}`}
                  onClick={() => {
                    if (onAddToRequest) {
                      onAddToRequest({
                        ...med,
                        publishedMrp: packPrice,
                        unitPrice: unitPrice,
                        unitsPerPack,
                        price: unitPrice,
                        packSize: packQuantity,
                        dosageForm: med.dosageForm
                      }, 1, false, 'TABLET');
                      triggerToast(`Added 1 tablet of ${med.brandName} (₹${unitPrice.toFixed(2)})`, 'success');
                    }
                  }}
                  className="px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-full bg-surface-container border border-primary/20 text-primary text-[9px] sm:text-[10px] font-bold hover:bg-surface-container-high transition-all cursor-pointer active:scale-95 flex-1 sm:flex-none text-center"
                >
                  +1 Tab
                </button>
              )}
              <button
                type="button"
                title={allowIndividual ? `Add 1 strip of ${unitsPerPack} at ₹${packPrice.toFixed(2)}` : `Add ${med.brandName} at ₹${packPrice.toFixed(2)}`}
                onClick={() => {
                  if (onAddToRequest) {
                    onAddToRequest({
                      ...med,
                      publishedMrp: packPrice,
                      unitPrice: unitPrice,
                      unitsPerPack,
                      price: packPrice,
                      packSize: packQuantity,
                      dosageForm: med.dosageForm
                    }, 1, false, allowIndividual ? 'STRIP' : 'UNIT');
                    triggerToast(`Added ${med.brandName} (${allowIndividual ? 'Strip of ' + unitsPerPack : '1 Pack'}) to request.`, 'success');
                  }
                }}
                className="inline-flex items-center justify-center gap-0.5 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full bg-primary hover:bg-primary-container text-white text-[9px] sm:text-[10px] font-bold shadow-xs transition-all cursor-pointer active:scale-95 flex-1 sm:flex-none text-center"
              >
                <span className="material-symbols-outlined text-xs">add</span>
                <span>{allowIndividual ? 'Strip' : 'Add'}</span>
              </button>
            </div>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-6">
      {/* Inject scroll animation styles + voice mic pulse */}
      <style>{scrollAnimStyles + `
        @keyframes voiceMicPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(46,104,93,0.3); }
          50% { box-shadow: 0 0 0 5px rgba(46,104,93,0); }
        }
      `}</style>

      {/* Voice Search Modal */}
      <VoiceSearchModal
        isOpen={voiceModalOpen}
        onClose={() => setVoiceModalOpen(false)}
        onResult={(text) => {
          setSearchQuery(text);
          setDebouncedSearchQuery(text);
        }}
      />
      {/* Smart Patient Greeting Header */}
      <div className="flex items-baseline justify-between flex-wrap gap-2 pt-1 pb-1">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-primary tracking-tight flex items-center gap-2 flex-wrap">
            <span className="material-symbols-outlined text-emerald-600 dark:text-emerald-400 text-2xl select-none">
              {patientGreetIcon}
            </span>
            <span>
              {patientTimeGreet}, <span className="text-secondary">{patientFirstName || 'there'}</span>
            </span>
          </h1>
          <p className="text-xs text-on-surface-variant mt-0.5">
            Verified Clinical Rx Network &middot; Chengannur, Kerala
          </p>
        </div>
        <div className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
          networkLive === false
            ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-400'
            : 'bg-surface-container-low border-outline-variant/30 text-on-surface-variant'
        }`}>
          {networkLive === false ? (
            <span className="relative flex h-2.5 w-2.5">
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
            </span>
          ) : (
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_6px_2px_rgba(52,211,153,0.5)]"></span>
            </span>
          )}
          <span>{networkLive === false ? 'Offline' : networkLive === null ? 'Connecting…' : 'Network Live'}</span>
        </div>
      </div>

      {/* Interactive Search & Action Bar (Tata 1mg Shaded Grey Location & Search System) */}
      <section className="w-full space-y-2">
        <div className="w-full flex items-center justify-between sm:justify-start gap-2.5 sm:gap-3 flex-wrap">
          {/* Distinct Location Pill (Tata 1mg Shaded Grey Style) */}
          <div
            title="Current fulfillment territory: Chengannur, Kerala"
            className="inline-flex items-center gap-2 px-3.5 py-2 sm:py-2.5 rounded-xl sm:rounded-2xl bg-[#f1f4f6] hover:bg-[#e8ecf0] border border-[#e2e8f0] hover:border-[#cbd5e1] shadow-2xs text-xs sm:text-sm font-bold text-[#1e293b] transition-all shrink-0 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[19px] text-[#475569]">location_on</span>
            <span>Chengannur</span>
            <span className="material-symbols-outlined text-[17px] text-[#64748b] hover:text-[#1b7058] transition-colors" title="Locate via GPS">my_location</span>
          </div>

          {/* Main Search Input Capsule: Full width on mobile, flexible row on desktop */}
          <div className="w-full sm:w-auto flex-1 min-w-[200px] order-last sm:order-none">
            <PromptInput
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onSubmit={handleSearchSubmit}
              onOpenVoice={() => setVoiceModalOpen(true)}
              onOpenFilters={() => setShowFilterModal(!showFilterModal)}
              activeFilterCount={activeFilterCount}
              selectedCategory={selectedCategory}
              categories={categories}
              onSelectCategory={(cat) => handleCategorySelect(cat)}
              isRecording={false}
            />
          </div>

          {/* Standout Reserve / Request Cart Trigger Button */}
          <button
            type="button"
            onClick={() => setCartDrawerOpen(true)}
            title="View your staged reservation cart and items"
            className="inline-flex items-center gap-2 px-4 py-2 sm:py-2.5 rounded-xl sm:rounded-2xl bg-[#0a3d34] hover:bg-[#145744] text-white shadow-xs text-xs sm:text-sm font-bold transition-all cursor-pointer shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">shopping_cart</span>
            <span>Reserve</span>
            {selectedMedicines.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-[#34d399] text-[#0a3d34] shadow-xs inline-flex items-center">
                <RollingNumber value={selectedMedicines.length} />
              </span>
            )}
          </button>
        </div>

        {/* Active Filter Indicator & Reset (Shown only when filters are active) */}
        {(activeFilterCount > 0 || categoryOverrideNote || selectedCategory !== 'ALL' || filterTag !== 'all') && (
          <div className="flex items-center justify-between gap-2 pt-1 px-1 flex-wrap">
              <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                <span className="material-symbols-outlined text-sm text-secondary">tune</span>
                <span>
                  {categoryOverrideNote || (selectedCategory !== 'ALL' ? `Filtered by ${selectedCategory}` : `Active Filters (${activeFilterCount})`)}
                </span>
              </div>
              <button
                type="button"
                onClick={handleResetAllFilters}
                className="text-xs text-secondary hover:text-primary font-bold inline-flex items-center gap-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">restart_alt</span>
                <span>Reset Filters</span>
              </button>
            </div>
          )}
      </section>

      {/* Clinical Filter Feature Modal (Opened via Filter button inside search box) */}
      {showFilterModal && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div className="fixed inset-0 bg-primary/40 backdrop-blur-xs z-[9999] flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest rounded-3xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-outline-variant/30 space-y-5 animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-surface-container pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-secondary-container flex items-center justify-center text-secondary">
                  <span className="material-symbols-outlined text-lg">tune</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-primary">Clinical Catalogue Filters</h3>
                  <p className="text-[11px] text-on-surface-variant">Narrow therapeutics by regulatory status and dosage form</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowFilterModal(false)}
                className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface hover:bg-surface-container-high transition-colors"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>

            {/* 1. Regulatory Status */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-primary uppercase tracking-wide">
                Regulatory / Prescription Protocol
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'all', label: 'All Formulations', desc: 'Prescription & Over-the-counter' },
                  { id: 'rx', label: 'Rx Required', desc: 'Licensed doctor Rx needed' },
                  { id: 'otc', label: 'OTC (Non-Rx)', desc: 'General sale list items' },
                  { id: 'emergency', label: 'Emergency Critical', desc: 'Life-saving critical meds' }
                ].map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setFilterTag(item.id)}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      filterTag === item.id
                        ? 'border-secondary bg-secondary-container/30 text-primary'
                        : 'border-outline-variant/30 bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
                    }`}
                  >
                    <div className="text-xs font-bold text-primary">{item.label}</div>
                    <div className="text-[10px] text-on-surface-variant mt-0.5">{item.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 2. Dosage Form */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-primary uppercase tracking-wide">
                Dosage Formulation
              </label>
              <div className="flex flex-wrap gap-1.5">
                {['ALL', 'Tablet', 'Capsule', 'Inhaler', 'Syrup', 'Injection'].map(form => (
                  <button
                    key={form}
                    type="button"
                    onClick={() => setDosageFormFilter(form)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                      dosageFormFilter === form
                        ? 'bg-primary text-white shadow-xs'
                        : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
                    }`}
                  >
                    {form === 'ALL' ? 'All Dosage Forms' : form}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. Sort By */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-primary uppercase tracking-wide">
                Sort Order
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'name-asc', label: 'Name: A to Z' },
                  { id: 'name-desc', label: 'Name: Z to A' },
                  { id: 'price-asc', label: 'Price: Low to High' },
                  { id: 'price-desc', label: 'Price: High to Low' }
                ].map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSortBy(opt.id)}
                    className={`p-2 rounded-xl text-xs font-bold text-center border transition-all ${
                      sortBy === opt.id
                        ? 'bg-primary text-white border-primary'
                        : 'bg-surface-container-low text-on-surface-variant border-outline-variant/30 hover:bg-surface-container'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-surface-container">
              <button
                type="button"
                onClick={handleResetAllFilters}
                className="text-xs font-bold text-tertiary hover:underline"
              >
                Reset All Filters
              </button>
              <button
                type="button"
                onClick={() => setShowFilterModal(false)}
                className="px-6 py-2 rounded-full bg-primary hover:bg-primary-container text-white text-xs font-bold shadow-xs transition-all"
              >
                Apply Filters (<RollingNumber value={displayedMedicines.length} /> Results)
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Offline Alerts */}
      {isOffline && !offlineError && (
        <div className="p-3 bg-tertiary-container/20 border border-tertiary-container text-tertiary rounded-2xl flex items-center gap-2 text-xs font-semibold">
          <span className="material-symbols-outlined text-base">cloud_off</span>
          <span>Operating in Offline Mode: Showing cached regional catalogue snapshot. Live stock is temporarily frozen.</span>
        </div>
      )}

      {offlineError && (
        <div className="p-3 bg-error-container text-error rounded-2xl flex items-center gap-2 text-xs font-semibold">
          <span className="material-symbols-outlined text-base">wifi_off</span>
          <span>{offlineError}</span>
        </div>
      )}

      {/* Quick Actions Rail on mobile / Grid on desktop */}
      <section className="flex sm:grid overflow-x-auto sm:overflow-visible pb-2 sm:pb-0 gap-2.5 sm:gap-3.5 sm:grid-cols-3 lg:grid-cols-5 no-scrollbar shrink-0">
        {/* 1. Upload Prescription Card - Celtics (soft-clover) */}
        <button
          type="button"
          onClick={() => onNavigateToPrescription ? onNavigateToPrescription() : onProceedToPharmacies()}
          className="relative overflow-hidden p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-emerald-200/80 dark:border-emerald-900/50 hover:border-emerald-400 dark:hover:border-emerald-600 text-left hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 flex flex-col gap-1.5 sm:gap-2 group cursor-pointer shadow-xs min-h-[110px] sm:min-h-[135px] justify-between bg-white dark:bg-[#0c1815] min-w-[140px] sm:min-w-0 flex-1 shrink-0"
        >
          <ChipGradientBg presetKey="celtics" />
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-white/90 dark:bg-[#132c24]/90 backdrop-blur-md border border-emerald-100 dark:border-emerald-800/40 text-emerald-800 dark:text-emerald-300 flex items-center justify-center text-lg sm:text-xl group-hover:scale-105 transition-transform shadow-xs relative z-10">
            <span className="material-symbols-outlined text-lg sm:text-xl">description</span>
          </div>
          <div className="relative z-10 flex flex-col gap-0.5">
            <strong className="text-xs sm:text-base font-bold text-emerald-950 dark:text-emerald-100 leading-tight">Upload prescription</strong>
            <span className="text-[10px] sm:text-xs text-emerald-800/90 dark:text-emerald-400 leading-tight font-medium">We read it and check stock</span>
          </div>
        </button>

        {/* 2. Emergency Pharmacy Card - Full circle (soft-orbit) */}
        <button
          type="button"
          onClick={() => onNavigateToEmergency ? onNavigateToEmergency() : onProceedToPharmacies()}
          className="relative overflow-hidden p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-rose-200/80 dark:border-rose-900/50 hover:border-rose-400 dark:hover:border-rose-600 text-left hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 flex flex-col gap-1.5 sm:gap-2 group cursor-pointer shadow-xs min-h-[110px] sm:min-h-[135px] justify-between bg-white dark:bg-[#0c1815] min-w-[140px] sm:min-w-0 flex-1 shrink-0"
        >
          <ChipGradientBg presetKey="full-circle" />
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-white/90 dark:bg-[#2c1318]/90 backdrop-blur-md border border-rose-100 dark:border-rose-800/40 text-rose-700 dark:text-rose-300 flex items-center justify-center text-lg sm:text-xl group-hover:scale-105 transition-transform shadow-xs relative z-10">
            <span className="material-symbols-outlined text-lg sm:text-xl">e911_emergency</span>
          </div>
          <div className="relative z-10 flex flex-col gap-0.5">
            <strong className="text-xs sm:text-base font-bold text-rose-950 dark:text-rose-100 leading-tight">Emergency pharmacy</strong>
            <span className="text-[10px] sm:text-xs text-rose-800/90 dark:text-rose-400 leading-tight font-medium">Open duty pharmacies now</span>
          </div>
        </button>

        {/* 3. Home Healthcare Services Card - Endless return (soft-ring) */}
        <button
          type="button"
          onClick={() => onNavigateToHealthcare ? onNavigateToHealthcare('services') : onProceedToPharmacies()}
          className="relative overflow-hidden p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-purple-200/80 dark:border-purple-900/50 hover:border-purple-400 dark:hover:border-purple-600 text-left hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 flex flex-col gap-1.5 sm:gap-2 group cursor-pointer shadow-xs min-h-[110px] sm:min-h-[135px] justify-between bg-white dark:bg-[#0c1815] min-w-[140px] sm:min-w-0 flex-1 shrink-0"
        >
          <ChipGradientBg presetKey="endless-return" />
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-white/90 dark:bg-[#23132c]/90 backdrop-blur-md border border-purple-100 dark:border-purple-800/40 text-purple-800 dark:text-purple-300 flex items-center justify-center text-lg sm:text-xl group-hover:scale-105 transition-transform shadow-xs relative z-10">
            <span className="material-symbols-outlined text-lg sm:text-xl">home_health</span>
          </div>
          <div className="relative z-10 flex flex-col gap-0.5">
            <strong className="text-xs sm:text-base font-bold text-purple-950 dark:text-purple-100 leading-tight">Home healthcare</strong>
            <span className="text-[10px] sm:text-xs text-purple-800/90 dark:text-purple-400 leading-tight font-medium">Book nurse or clinician</span>
          </div>
        </button>

        {/* 4. Clinical Tele-Help Card - Room to rise (soft-arch) */}
        <button
          type="button"
          onClick={() => onNavigateToHealthcare ? onNavigateToHealthcare('clinical-assistance') : onProceedToPharmacies()}
          className="relative overflow-hidden p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-teal-200/80 dark:border-teal-900/50 hover:border-teal-400 dark:hover:border-teal-600 text-left hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 flex flex-col gap-1.5 sm:gap-2 group cursor-pointer shadow-xs min-h-[110px] sm:min-h-[135px] justify-between bg-white dark:bg-[#0c1815] min-w-[140px] sm:min-w-0 flex-1 shrink-0"
        >
          <ChipGradientBg presetKey="room-to-rise" />
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-white/90 dark:bg-[#132c28]/90 backdrop-blur-md border border-teal-100 dark:border-teal-800/40 text-teal-800 dark:text-teal-300 flex items-center justify-center text-lg sm:text-xl group-hover:scale-105 transition-transform shadow-xs relative z-10">
            <span className="material-symbols-outlined text-lg sm:text-xl">support_agent</span>
          </div>
          <div className="relative z-10 flex flex-col gap-0.5">
            <strong className="text-xs sm:text-base font-bold text-teal-950 dark:text-teal-100 leading-tight">Clinical tele-help</strong>
            <span className="text-[10px] sm:text-xs text-teal-800/90 dark:text-teal-400 leading-tight font-medium">Pharmacist second opinion</span>
          </div>
        </button>

        {/* 5. Track & Reorder Request Card - Squared away (soft-square) */}
        <button
          type="button"
          onClick={() => onNavigateToOrders ? onNavigateToOrders() : onProceedToPharmacies()}
          className="relative overflow-hidden p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-sky-200/80 dark:border-sky-900/50 hover:border-sky-400 dark:hover:border-sky-600 text-left hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 flex flex-col gap-1.5 sm:gap-2 group cursor-pointer shadow-xs min-h-[110px] sm:min-h-[135px] justify-between bg-white dark:bg-[#0c1815] min-w-[140px] sm:min-w-0 flex-1 shrink-0"
        >
          <ChipGradientBg presetKey="squared-away" />
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-white/90 dark:bg-[#13232c]/90 backdrop-blur-md border border-sky-100 dark:border-sky-800/40 text-sky-800 dark:text-sky-300 flex items-center justify-center text-lg sm:text-xl group-hover:scale-105 transition-transform shadow-xs relative z-10">
            <span className="material-symbols-outlined text-lg sm:text-xl">package_2</span>
          </div>
          <div className="relative z-10 flex flex-col gap-0.5">
            <strong className="text-xs sm:text-base font-bold text-sky-950 dark:text-sky-100 leading-tight">Track &amp; reorder</strong>
            <span className="text-[10px] sm:text-xs text-sky-800/90 dark:text-sky-400 leading-tight font-medium">Real-time pickup &amp; delivery</span>
          </div>
        </button>
      </section>

      {/* Modern Light Minimalist Carousel Banner */}
      <section
        className="relative rounded-3xl overflow-hidden border border-outline-variant/20 shadow-xs group"
        onMouseEnter={() => setIsCarouselPaused(true)}
        onMouseLeave={() => setIsCarouselPaused(false)}
      >
        <div
          className="flex transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${bannerSlide * 100}%)` }}
        >
          {bannerSlides.map((slide, sIdx) => (
            <div
              key={sIdx}
              className="min-w-full p-4 sm:p-8 flex flex-col justify-center gap-1.5 sm:gap-2 relative overflow-hidden"
              style={{ background: slide.background, minHeight: '140px' }}
            >
              <div
                style={{
                  position: 'absolute',
                  right: '-10px',
                  top: '-10px',
                  width: '180px',
                  height: '180px',
                  borderRadius: '50%',
                  background: slide.decorBg,
                  pointerEvents: 'none'
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  right: '90px',
                  bottom: '-30px',
                  width: '120px',
                  height: '120px',
                  borderRadius: '50%',
                  background: slide.decorBg,
                  pointerEvents: 'none'
                }}
              />

              <div className="relative z-10 space-y-1.5 sm:space-y-2 max-w-xl">
                <span
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                  style={{ background: slide.badgeBg, color: slide.badgeColor }}
                >
                  <span className="material-symbols-outlined text-xs">{slide.icon}</span>
                  <span>{slide.tag}</span>
                </span>
                <h3 className="text-base sm:text-2xl font-bold text-primary tracking-tight">
                  {slide.title}
                </h3>
                <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed max-w-lg line-clamp-2 sm:line-clamp-none">
                  {slide.desc}
                </p>
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={slide.action}
                    className="inline-flex items-center gap-2 px-4 sm:px-5 py-1.5 sm:py-2 rounded-full font-bold text-xs shadow-xs transition-all cursor-pointer hover:opacity-90"
                    style={{ background: slide.buttonBg, color: slide.buttonColor }}
                  >
                    <span>{slide.buttonText}</span>
                    <span className="material-symbols-outlined text-sm">arrow_forward</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Previous & Next Carousel Navigation Chevrons */}
        <button
          type="button"
          onClick={() => setBannerSlide(prev => (prev - 1 + bannerSlides.length) % bannerSlides.length)}
          aria-label="Previous Slide"
          className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/80 hover:bg-white text-primary flex items-center justify-center shadow-xs backdrop-blur-xs opacity-0 group-hover:opacity-100 transition-opacity z-20 cursor-pointer"
        >
          <span className="material-symbols-outlined text-lg">chevron_left</span>
        </button>
        <button
          type="button"
          onClick={() => setBannerSlide(prev => (prev + 1) % bannerSlides.length)}
          aria-label="Next Slide"
          className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/80 hover:bg-white text-primary flex items-center justify-center shadow-xs backdrop-blur-xs opacity-0 group-hover:opacity-100 transition-opacity z-20 cursor-pointer"
        >
          <span className="material-symbols-outlined text-lg">chevron_right</span>
        </button>

        {/* Dots Indicator */}
        <div className="absolute bottom-4 right-6 flex items-center gap-1.5 z-20">
          {bannerSlides.map((_, dotIdx) => (
            <button
              key={dotIdx}
              type="button"
              onClick={() => setBannerSlide(dotIdx)}
              className={`h-2 rounded-full transition-all cursor-pointer ${
                bannerSlide === dotIdx ? 'w-6 bg-primary' : 'w-2 bg-primary/25 hover:bg-primary/50'
              }`}
              aria-label={`Go to slide ${dotIdx + 1}`}
            />
          ))}
        </div>
      </section>

      {/* Shop by health concern - Minimalist Clinical Chip Strip */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-secondary text-lg">clinical_notes</span>
            <h2 className="text-base sm:text-lg font-bold text-primary">Shop by Health Concern</h2>
          </div>
          {selectedHealthConcern ? (
            <button
              type="button"
              onClick={() => setSelectedHealthConcern(null)}
              className="text-xs font-bold text-secondary hover:text-primary cursor-pointer flex items-center gap-1"
            >
              <span>Show All</span>
              <span className="material-symbols-outlined text-xs">close</span>
            </button>
          ) : (
            <span className="text-xs text-on-surface-variant font-medium">Filter by therapeutic specialty</span>
          )}
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          <button
            type="button"
            onClick={() => setSelectedHealthConcern(null)}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer shrink-0 border ${
              !selectedHealthConcern
                ? 'bg-[#0a3d34] text-white border-[#0a3d34] shadow-xs'
                : 'bg-white border-[#d8eae3] text-[#0a3d34] hover:bg-[#f2faf7] hover:border-[#1b7058] shadow-xs'
            }`}
          >
            <span className="material-symbols-outlined text-base">tune</span>
            <span>All Specialties</span>
          </button>
          {HEALTH_CONCERNS.map(concern => {
            const isSelected = selectedHealthConcern === concern.id;
            return (
              <button
                key={concern.id}
                type="button"
                onClick={() => setSelectedHealthConcern(prev => prev === concern.id ? null : concern.id)}
                className={`px-4 py-2 rounded-full text-sm font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer shrink-0 border ${
                  isSelected
                    ? 'bg-[#0a3d34] text-white border-[#0a3d34] shadow-xs'
                    : 'bg-white border-[#d8eae3] text-[#0a3d34] hover:bg-[#f2faf7] hover:border-[#1b7058] shadow-xs'
                }`}
              >
                <span className={`material-symbols-outlined text-base ${isSelected ? 'text-[#34d399]' : 'text-[#12805f]'}`}>
                  {concern.icon}
                </span>
                <span>{concern.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Main Full-Width Medicines Catalogue Layout */}
      <div className="w-full flex flex-col gap-6">
        {/* Section 1: Order Again (Essential Refills) */}
        <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-primary">Order again</h2>
                <p className="text-[11px] text-on-surface-variant">Quick refill essential therapeutic formulations</p>
              </div>
              {onNavigateToOrders && (
                <button
                  type="button"
                  onClick={onNavigateToOrders}
                  className="text-xs font-bold text-secondary hover:text-primary cursor-pointer"
                >
                  Past requests →
                </button>
              )}
            </div>

            {/* Horizontal scroll rail */}
            <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
              {orderAgainMedicines.map((med, idx) => (
                <div key={med.id || idx} className="shrink-0 w-52 sm:w-56">
                  {renderMedicineCard(med, idx)}
                </div>
              ))}
            </div>
          </section>

          {/* Section 2: Frequently Requested / Categorized Catalogue */}
          <section id="catalog-grid-anchor" className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-primary tracking-tight">Frequently requested</h2>
                <p className="text-xs text-on-surface-variant flex items-center gap-1">
                  Showing <RollingNumber value={displayedMedicines.length} /> verified therapeutic items across categories
                </p>
              </div>

              {/* Quick Sort Dropdown */}
              <div className="flex items-center gap-2 text-xs">
                <span className="text-on-surface-variant font-medium">Sort by:</span>
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value)}
                  className="bg-surface-container-low border border-outline-variant/30 text-on-surface font-semibold text-xs rounded-full px-3 py-1 outline-none cursor-pointer"
                >
                  <option value="name-asc">Name: A to Z</option>
                  <option value="name-desc">Name: Z to A</option>
                  <option value="price-asc">Price: Low to High</option>
                  <option value="price-desc">Price: High to Low</option>
                </select>
              </div>
            </div>

            {/* Category Navigation Pills */}
            <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto pb-1 no-scrollbar flex-nowrap">
              <button
                type="button"
                onClick={() => setSelectedCategoryTab('ALL')}
                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer ${
                  selectedCategoryTab === 'ALL'
                    ? 'bg-[#0a3d34] text-white shadow-xs'
                    : 'bg-surface-container-low hover:bg-surface-container text-on-surface-variant'
                }`}
              >
                All Categories
              </button>
              {THERAPEUTIC_GROUPS.map((grp) => {
                const count = displayedMedicines.filter(grp.match).length;
                return (
                  <button
                    key={grp.id}
                    type="button"
                    onClick={() => setSelectedCategoryTab(grp.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 cursor-pointer inline-flex items-center gap-1.5 ${
                      selectedCategoryTab === grp.id
                        ? 'bg-[#0a3d34] text-white shadow-xs'
                        : 'bg-surface-container-low hover:bg-surface-container text-on-surface-variant'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[15px]">{grp.icon}</span>
                    <span>{grp.label}</span>
                    {count > 0 && (
                      <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-extrabold ${
                        selectedCategoryTab === grp.id ? 'bg-white/20 text-white' : 'bg-surface-container-high text-on-surface-variant'
                      }`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {loading ? (
              <LoadingSkeleton type="cards" count={8} />
            ) : displayedMedicines.length === 0 ? (
              <EmptyState
                icon="search_off"
                title="No formulations found"
                description={
                  searchQuery
                    ? `No medicine matched "${searchQuery}". Try searching generic chemical names or resetting filters.`
                    : 'No formulations found under current category or filters.'
                }
                actionText="Reset All Filters"
                onAction={handleResetAllFilters}
              />
            ) : selectedCategoryTab === 'ALL' && !searchQuery.trim() ? (
              /* Categorized Sections with Variety — prevents flat 50 dump */
              <div className="space-y-6">
                {THERAPEUTIC_GROUPS.map((grp) => {
                  const grpMeds = displayedMedicines.filter(grp.match);
                  if (grpMeds.length === 0) return null;
                  const varietyShowcase = grpMeds.slice(0, 5);
                  return (
                    <div
                      key={grp.id}
                      className="space-y-3 p-3.5 sm:p-4 rounded-2xl bg-surface-container-lowest border border-outline-variant/20 shadow-2xs"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-[#0a3d34]/10 text-[#0a3d34] flex items-center justify-center shrink-0">
                            <span className="material-symbols-outlined text-lg">{grp.icon}</span>
                          </div>
                          <div>
                            <h3 className="text-xs sm:text-sm font-bold text-primary flex items-center gap-2">
                              <span>{grp.label}</span>
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary-container/40 text-secondary">
                                {grp.badge}
                              </span>
                            </h3>
                            <p className="text-[11px] text-on-surface-variant font-medium">
                              {grpMeds.length} verified formulations in this category
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedCategoryTab(grp.id)}
                          className="text-xs font-bold text-secondary hover:text-primary transition-colors cursor-pointer inline-flex items-center gap-1 px-3 py-1 rounded-full bg-surface-container-low hover:bg-surface-container"
                        >
                          <span>View All ({grpMeds.length})</span>
                          <span className="material-symbols-outlined text-sm">arrow_forward</span>
                        </button>
                      </div>

                      {/* Compact grid with ref image card size */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 gap-2.5 sm:gap-3.5">
                        {varietyShowcase.map((med, idx) => renderMedicineCard(med, idx))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Specific Category or Search Filter Results */
              <div className="space-y-3">
                {selectedCategoryTab !== 'ALL' && (
                  <div className="flex items-center justify-between pb-1">
                    <span className="text-xs font-bold text-primary flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm text-secondary">
                        {THERAPEUTIC_GROUPS.find(g => g.id === selectedCategoryTab)?.icon || 'category'}
                      </span>
                      <span>
                        Showing all {
                          (THERAPEUTIC_GROUPS.find(g => g.id === selectedCategoryTab)
                            ? displayedMedicines.filter(THERAPEUTIC_GROUPS.find(g => g.id === selectedCategoryTab).match)
                            : displayedMedicines
                          ).length
                        } items in {THERAPEUTIC_GROUPS.find(g => g.id === selectedCategoryTab)?.label}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedCategoryTab('ALL')}
                      className="text-xs text-secondary hover:text-primary font-bold cursor-pointer"
                    >
                      Show All Categories
                    </button>
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5 gap-2.5 sm:gap-3.5">
                  {(selectedCategoryTab !== 'ALL'
                    ? displayedMedicines.filter(THERAPEUTIC_GROUPS.find(g => g.id === selectedCategoryTab)?.match || (() => true))
                    : displayedMedicines
                  ).map((med, idx) => renderMedicineCard(med, idx))}
                </div>
              </div>
            )}
          </section>



          {/* Minimalist Trust & Safety Assurance */}
          <section className="pt-4 border-t border-outline-variant/20">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* 1. Verified Dispensaries */}
              <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-gradient-to-br from-emerald-50/70 via-white to-teal-50/40 border border-emerald-200/70 shadow-xs">
                <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0 border border-emerald-200">
                  <span className="material-symbols-outlined text-base">verified</span>
                </div>
                <div>
                  <h4 className="text-xs font-bold text-emerald-950">Verified Dispensaries</h4>
                  <p className="text-[11px] text-emerald-800/80 leading-relaxed mt-0.5">
                    Licensed &amp; inspected under Kerala State Drugs Control standards.
                  </p>
                </div>
              </div>

              {/* 2. Confidential Prescription Handling */}
              <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-gradient-to-br from-cyan-50/70 via-white to-blue-50/40 border border-cyan-200/70 shadow-xs">
                <div className="w-8 h-8 rounded-full bg-cyan-100 text-cyan-800 flex items-center justify-center shrink-0 border border-cyan-200">
                  <span className="material-symbols-outlined text-base">lock</span>
                </div>
                <div>
                  <h4 className="text-xs font-bold text-cyan-950">Confidential Prescription Handling</h4>
                  <p className="text-[11px] text-cyan-800/80 leading-relaxed mt-0.5">
                    Prescriptions are encrypted and processed securely for dispensing only.
                  </p>
                </div>
              </div>

              {/* 3. Emergency Support */}
              <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-gradient-to-br from-amber-50/70 via-white to-orange-50/40 border border-amber-200/70 shadow-xs">
                <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 border border-amber-200">
                  <span className="material-symbols-outlined text-base">support_agent</span>
                </div>
                <div>
                  <h4 className="text-xs font-bold text-amber-950">Emergency Support</h4>
                  <p className="text-[11px] text-amber-800/80 leading-relaxed mt-0.5">
                    24/7 duty pharmacy coordination across Chengannur network dispensaries.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-3 py-2 px-1 flex items-center justify-between text-[11px] text-on-surface-variant">
              <span>Availability synced directly with participating pharmacy inventories in Chengannur.</span>
              <span className="font-bold text-secondary">Kerala Drugs Control Audited</span>
            </div>
          </section>
        </div>

      {/* ── ACTIVE MEDICINE REQUEST — Sticky Bottom Action Bar (Stitch design) ── */}
      {selectedMedicines.length > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 200,
            background: 'rgba(255,255,255,0.97)',
            backdropFilter: 'blur(16px)',
            borderTop: '1px solid rgba(30,69,62,0.12)',
            boxShadow: '0 -4px 24px rgba(30,69,62,0.10)',
            padding: '0.75rem 1.5rem',
          }}
        >
          <div style={{ maxWidth: '80rem', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            {/* Left: label + count badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
              <span className="material-symbols-outlined" style={{ color: '#2e685d', fontSize: '22px' }}>shopping_basket</span>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#032f28' }}>Active Medicine Request</span>
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                minWidth: '22px', height: '22px', borderRadius: '999px',
                background: '#2e685d', color: '#fff', fontSize: '11px', fontWeight: 800, padding: '0 6px'
              }}>
                {selectedMedicines.length} {selectedMedicines.length === 1 ? 'Item' : 'Items'}
              </span>
            </div>

            {/* Right: action buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleCheckAvailabilityForAll}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  padding: '0.5rem 1.25rem', borderRadius: '999px',
                  border: '1.5px solid #2e685d', background: 'transparent',
                  color: '#2e685d', fontWeight: 700, fontSize: '12px', cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>visibility</span>
                View Items
              </button>
              {onProceedToPharmacies && (
                <button
                  type="button"
                  onClick={onProceedToPharmacies}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                    padding: '0.5rem 1.5rem', borderRadius: '999px',
                    background: '#2e685d', color: '#fff',
                    fontWeight: 700, fontSize: '12px', cursor: 'pointer',
                    boxShadow: '0 2px 12px rgba(46,104,93,0.25)', border: 'none',
                    transition: 'all 0.15s'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>local_pharmacy</span>
                  Check Pharmacy Availability
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* High-Stakes Action Confirmation Modal */}
      <ConfirmationDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        impactPoints={confirmDialog.impactPoints || []}
        confirmText={confirmDialog.confirmLabel || confirmDialog.confirmText}
        cancelText={confirmDialog.cancelLabel || confirmDialog.cancelText}
        isDestructive={confirmDialog.variant === 'danger' || confirmDialog.isDestructive}
        onConfirm={() => {
          confirmDialog.onConfirm();
          setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        }}
        onCancel={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
      />

      {/* Availability Modal */}
      <AvailabilityModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        items={selectedItemsForModal}
        onOrderCreated={onOrderCreated}
        isEmergency={false}
      />

      {/* Dedicated Reservation Cart Card / Slide-Over Modal */}
      {typeof document !== 'undefined' && ReactDOM.createPortal(
        <AnimatePresence>
          {cartDrawerOpen && (
            <div className="fixed inset-0 z-[9999] flex justify-end overflow-hidden">
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.28, ease: 'easeInOut' }}
                className="fixed inset-0 bg-black/60 backdrop-blur-xs cursor-pointer"
                onClick={() => setCartDrawerOpen(false)}
              />

              {/* Cart Card Panel */}
              <motion.aside
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 28, stiffness: 260, mass: 0.85 }}
                className="relative z-10 w-full max-w-md bg-surface-container-lowest h-full shadow-2xl flex flex-col justify-between border-l border-outline-variant/30"
              >
            {/* Cart Header */}
            <div className="p-5 border-b border-surface-container flex items-center justify-between bg-surface-container-low/50">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-secondary-container text-secondary flex items-center justify-center">
                  <span className="material-symbols-outlined text-xl">shopping_cart</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-primary">Reservation Cart</h3>
                  <p className="text-[11px] text-on-surface-variant font-medium">
                    {selectedMedicines.length} {selectedMedicines.length === 1 ? 'item' : 'items'} staged for dispensary reservation
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCartDrawerOpen(false)}
                className="w-8 h-8 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface flex items-center justify-center transition-colors cursor-pointer"
                title="Close Cart"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            {/* Cart Items Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3">
              {/* Prescription Reminder Callout */}
              {hasRxItemsInRequest && (
                <div className="p-3 rounded-2xl bg-secondary-container/30 border border-secondary/20 flex items-start gap-2.5">
                  <span className="material-symbols-outlined text-secondary text-lg shrink-0 mt-0.5">prescriptions</span>
                  <div className="space-y-0.5 text-xs text-primary">
                    <p className="font-bold">Prescription Required</p>
                    <p className="text-[11px] text-on-surface-variant leading-tight">
                      Some staged formulations require a valid doctor's prescription during pharmacy pickup or counter dispensing.
                    </p>
                  </div>
                </div>
              )}

              {selectedMedicines.length === 0 ? (
                <div className="py-16 px-4 flex flex-col items-center justify-center text-center gap-3 text-on-surface-variant">
                  <div className="w-16 h-16 rounded-3xl bg-surface-container-low flex items-center justify-center text-secondary">
                    <span className="material-symbols-outlined text-3xl">remove_shopping_cart</span>
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-primary">Your Reservation Cart is Empty</h4>
                    <p className="text-xs text-on-surface-variant max-w-xs mt-1">
                      Search and click &ldquo;+ Add&rdquo; on any medicines or scan an Rx to stage items here.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCartDrawerOpen(false)}
                    className="mt-2 px-5 py-2 rounded-full bg-primary text-white text-xs font-bold shadow-xs hover:opacity-90 cursor-pointer"
                  >
                    Browse Medicines
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedMedicines.map(item => {
                    const fullMed = medicines.find(m => m.id === item.medicineId) || {};
                    const isRx = fullMed.requiresPrescription || fullMed.isEmergency || item.requiresPrescription;
                    const imgUrl = getMedicineImageUrl(fullMed);
                    const isStrip = item.saleUnit === 'STRIP';
                    const unitPrice = item.effectiveUnitPrice != null ? Number(item.effectiveUnitPrice) : (
                      getVerifiedPrice(fullMed) != null ? Number(getVerifiedPrice(fullMed)) : (item.price != null ? Number(item.price) : null)
                    );
                    const lineTotal = item.subtotal != null ? Number(item.subtotal) : (unitPrice != null ? unitPrice * (item.quantity || 1) : null);
                    const unitLabel = isStrip
                      ? ((item.quantity || 1) > 1 ? 'strips' : 'strip')
                      : ((fullMed.dosageForm || item.dosageForm || 'tablet').toLowerCase().includes('capsule')
                          ? ((item.quantity || 1) > 1 ? 'capsules' : 'capsule')
                          : ((fullMed.dosageForm || item.dosageForm || 'tablet').toLowerCase().includes('bottle')
                              ? 'bottle'
                              : ((item.quantity || 1) > 1 ? 'tablets' : 'tablet')));

                    return (
                      <div
                        key={item.medicineId}
                        className="p-3.5 rounded-2xl bg-surface-container-lowest border border-outline-variant/30 shadow-xs flex items-center gap-3 justify-between"
                      >
                        {/* Thumbnail */}
                        <div className="w-12 h-12 rounded-xl bg-surface-container-low border border-outline-variant/20 flex items-center justify-center shrink-0 overflow-hidden p-1">
                          {imgUrl ? (
                            <img src={imgUrl} alt={item.brandName} className="w-full h-full object-contain" />
                          ) : (
                            <span className="material-symbols-outlined text-secondary text-xl">medication</span>
                          )}
                        </div>

                        {/* Details */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <h4 className="text-xs font-bold text-primary truncate">{item.brandName}</h4>
                            <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                              isRx ? 'bg-error-container/40 text-error' : 'bg-secondary-container/40 text-secondary'
                            }`}>
                              {isRx ? 'Rx' : 'OTC'}
                            </span>
                          </div>
                          <p className="text-[10px] text-on-surface-variant truncate">
                            {fullMed.genericName || fullMed.category || 'Clinical formulation'}
                          </p>
                          <div className="text-[11px] font-bold text-primary mt-1">
                            {unitPrice != null ? (
                              <>
                                ₹{unitPrice.toFixed(2)} <span className="text-[10px] text-on-surface-variant font-normal">/ {unitLabel}</span>
                                {item.quantity > 1 && lineTotal != null && (
                                  <span className="text-[10px] text-on-surface-variant font-normal ml-1">
                                    (₹{lineTotal.toFixed(2)} total)
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-[10px] text-on-surface-variant italic">Counter payment required</span>
                            )}
                          </div>
                        </div>

                        {/* Stepper & Delete */}
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="flex items-center border border-outline-variant/40 rounded-full bg-surface-container-low p-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                if ((item.quantity || 1) <= 1) {
                                  if (onRemoveFromRequest) onRemoveFromRequest(item.medicineId);
                                } else {
                                  if (onUpdateRequestQuantity) onUpdateRequestQuantity(item.medicineId, (item.quantity || 1) - 1);
                                }
                              }}
                              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
                              title="Decrease"
                            >
                              -
                            </button>
                            <span className="w-6 text-center text-xs font-bold text-primary font-mono">
                              {item.quantity || 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                if (onUpdateRequestQuantity) onUpdateRequestQuantity(item.medicineId, (item.quantity || 1) + 1);
                              }}
                              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
                              title="Increase"
                            >
                              +
                            </button>
                          </div>

                          {onRemoveFromRequest && (
                            <button
                              type="button"
                              onClick={() => onRemoveFromRequest(item.medicineId)}
                              className="w-7 h-7 rounded-full text-on-surface-variant hover:text-error hover:bg-error-container/30 flex items-center justify-center transition-colors cursor-pointer"
                              title="Remove item"
                            >
                              <span className="material-symbols-outlined text-sm">delete</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Cart Footer Summary & CTA */}
            {selectedMedicines.length > 0 && (
              <div className="p-4 sm:p-5 border-t border-surface-container bg-surface-container-low/40 space-y-3">
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between text-on-surface-variant">
                    <span>Total Medicines Staged</span>
                    <span className="font-bold text-primary">
                      <RollingNumber value={selectedMedicines.length} />
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-on-surface-variant">
                    <span>Advance Payment Required</span>
                    <span className="font-bold text-secondary">₹0 (Zero)</span>
                  </div>
                  <div className="flex items-center justify-between text-sm font-bold text-primary pt-1 border-t border-outline-variant/20">
                    <span>Estimated Total MRP</span>
                    <span>
                      <RollingNumber
                        prefix="₹"
                        value={selectedMedicines.reduce((acc, curr) => {
                          const sub = curr.subtotal != null ? Number(curr.subtotal) : (
                            curr.effectiveUnitPrice != null ? Number(curr.effectiveUnitPrice) * (curr.quantity || 1) : (
                              curr.price != null ? Number(curr.price) * (curr.quantity || 1) : 0
                            )
                          );
                          return acc + sub;
                        }, 0).toFixed(2)}
                      />
                    </span>
                  </div>
                </div>

                <div className="p-2 rounded-xl bg-surface-container text-[11px] text-on-surface-variant leading-tight flex items-center gap-2">
                  <span className="material-symbols-outlined text-secondary text-base shrink-0">verified_user</span>
                  <span>You pay only at the dispensary after stock and batch confirmation.</span>
                </div>

                <div className="space-y-2 pt-1">
                  {onProceedToPharmacies && (
                    <button
                      type="button"
                      onClick={() => {
                        setCartDrawerOpen(false);
                        onProceedToPharmacies();
                      }}
                      className="w-full py-3 rounded-full bg-primary hover:bg-primary-container text-white text-xs font-bold shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-base">local_pharmacy</span>
                      <span>Find Pharmacies &amp; Reserve</span>
                      <span className="material-symbols-outlined text-sm">arrow_forward</span>
                    </button>
                  )}

                  {onClearRequest && (
                    <button
                      type="button"
                      onClick={() => {
                        onClearRequest();
                      }}
                      className="w-full py-2 text-center text-xs font-semibold text-on-surface-variant hover:text-error transition-colors cursor-pointer"
                    >
                      Clear All Staged Items
                    </button>
                  )}
                </div>
              </div>
            )}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )}
    </div>
  );
}
