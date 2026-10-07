import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import AvailabilityModal from '../components/AvailabilityModal';
import ConfirmationDialog from '../components/ConfirmationDialog';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import { getMedicineImageUrl } from '../data/medicineImages';
import VoiceSearchModal from '../components/VoiceSearchModal';
import PromptInput from '../components/ui/PromptInput';

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

export default function MedicineSearch({
  onOrderCreated,
  selectedMedicines = [],
  onAddToRequest,
  onUpdateRequestQuantity,
  onRemoveFromRequest,
  onClearRequest,
  onProceedToPharmacies,
  onNavigateToPrescription,
  onNavigateToEmergency
}) {
  const { user } = useAuth();
  const scrollContainerRef = useRef(null);
  const [medicines, setMedicines] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  // Search & Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [filterTag, setFilterTag] = useState('all'); // 'all' | 'rx' | 'otc' | 'instock'
  const [dosageFormFilter, setDosageFormFilter] = useState('ALL'); // 'ALL' | 'Tablet' | 'Capsule' | 'Inhaler' | 'Syrup' | 'Injection'
  const [sortBy, setSortBy] = useState('name-asc'); // 'name-asc' | 'name-desc' | 'price-asc' | 'price-desc'
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [categoryOverrideNote, setCategoryOverrideNote] = useState('');

  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [offlineError, setOfflineError] = useState(null);

  // Availability Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedItemsForModal, setSelectedItemsForModal] = useState([]);

  // Voice search modal state
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);

  // Toast feedback state
  const [feedback, setFeedback] = useState({ show: false, message: '', type: 'success' });
  const showToast = (message, type = 'success') => {
    setFeedback({ show: true, message, type });
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
    const handleOffline = () => { setIsOffline(true); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    fetchMedicines();
    fetchCategories();
  }, [debouncedSearchQuery, selectedCategory]);

  async function fetchMedicines(forceCategory = null) {
    setLoading(true);
    setOfflineError(null);
    setCategoryOverrideNote('');

    if (!navigator.onLine) {
      handleOfflineFallback();
      setLoading(false);
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
      setLoading(false);
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
    setFilterTag('all');
    setDosageFormFilter('ALL');
    setSortBy('name-asc');
    setCategoryOverrideNote('');
    setSearchQuery('');
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
    (sortBy !== 'name-asc' ? 1 : 0);

  // Compute displayed medicines with active filters and sorting
  let displayedMedicines = medicines.filter(med => {
    // 1. Regulatory Status Filter
    if (filterTag === 'rx') {
      const isRx = med.requiresPrescription || med.isEmergency || (med.dosageForm && med.dosageForm.toLowerCase().includes('inhaler')) || med.category?.toLowerCase().includes('antibiotic');
      if (!isRx) return false;
    }
    if (filterTag === 'otc') {
      const isRx = med.requiresPrescription || med.isEmergency || med.category?.toLowerCase().includes('antibiotic');
      if (isRx) return false;
    }
    if (filterTag === 'emergency' && !med.isEmergency) return false;

    // 2. Dosage Form Filter
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
      {/* Top Greeting & Realtime Clinical Status Strip */}
      <section
        className="rounded-3xl p-5 sm:p-6 shadow-md flex flex-col lg:flex-row lg:items-center justify-between gap-4"
        style={{
          background: 'linear-gradient(135deg, #021f1a 0%, #032f28 60%, #053d34 100%)',
          border: '1px solid rgba(52, 211, 153, 0.18)'
        }}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">
              Verified AI Care Protocol Active
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight" style={{ color: '#ffffff' }}>
            Welcome back, {user?.name ? user.name.split(' ')[0] : 'Patient'}
          </h1>
          <p className="text-xs sm:text-sm" style={{ color: '#a7f3d0' }}>
            Manage your prescriptions, explore local clinical inventories, and locate duty pharmacies across Kerala.
          </p>
        </div>

        {/* Network Quick Status Pills */}
        <div
          className="backdrop-blur-sm rounded-2xl p-2.5 flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
          style={{
            background: 'rgba(0,0,0,0.30)',
            border: '1px solid rgba(52, 211, 153, 0.15)'
          }}
        >
          <div className="flex items-center gap-2.5 pr-3 sm:border-r border-emerald-400/20">
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(52,211,153,0.15)' }}>
              <span className="material-symbols-outlined text-lg text-emerald-400">near_me</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-medium leading-none" style={{ color: '#6ee7b7' }}>Location</span>
              <span className="text-xs font-bold" style={{ color: '#ffffff' }}>Chengannur / Alappuzha</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 pr-3 sm:border-r border-emerald-400/20">
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(52,211,153,0.20)' }}>
              <span className="material-symbols-outlined text-lg text-emerald-300">verified_user</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold leading-none" style={{ color: '#6ee7b7' }}>Rx Sync</span>
              <span className="text-xs font-bold" style={{ color: '#34d399' }}>Live OCR Pipeline</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(52,211,153,0.15)' }}>
              <span className="material-symbols-outlined text-lg text-emerald-400">local_pharmacy</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-medium leading-none" style={{ color: '#6ee7b7' }}>Network</span>
              <span className="text-xs font-bold" style={{ color: '#ffffff' }}>Participating Dispensaries</span>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Search & Smart Filter Module (Stitch Screen 8183425688289776459) */}
      <section className="w-full">
        <div className="bg-surface-container-lowest rounded-3xl p-4 sm:p-5 border border-outline-variant/20 shadow-xs space-y-3">
          {/* Main Search Input Capsule with 21st.dev PromptInput spring physics */}
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

          {/* Quick Regulatory Switchers (Stitch lines 48-53) */}
          <div className="flex items-center justify-between gap-3 pt-1 flex-wrap">
            <div className="flex items-center gap-1.5 p-1 bg-surface-container-low rounded-full overflow-x-auto shrink-0">
              <button
                type="button"
                onClick={() => setFilterTag('all')}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                  filterTag === 'all'
                    ? 'bg-primary text-white shadow-xs'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                All Formulations
              </button>
              <button
                type="button"
                onClick={() => setFilterTag('rx')}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                  filterTag === 'rx'
                    ? 'bg-primary text-white shadow-xs'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                Rx Required
              </button>
              <button
                type="button"
                onClick={() => setFilterTag('otc')}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                  filterTag === 'otc'
                    ? 'bg-primary text-white shadow-xs'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                OTC / Non-Rx
              </button>
              <button
                type="button"
                onClick={() => setFilterTag('emergency')}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                  filterTag === 'emergency'
                    ? 'bg-error text-white shadow-xs'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                Emergency Critical
              </button>
            </div>

            {/* Active Filters Reset Shortcut */}
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={handleResetAllFilters}
                className="text-xs text-secondary hover:text-primary font-bold inline-flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-sm">restart_alt</span>
                <span>Reset {activeFilterCount} Filter(s)</span>
              </button>
            )}
          </div>

          {/* Category Scroller Strip */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar pt-1">
            {categories.map(cat => {
              const isActive = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => {
                    setSelectedCategory(cat);
                    setCategoryOverrideNote('');
                  }}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1 ${
                    isActive
                      ? 'bg-primary text-white shadow-xs'
                      : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                  }`}
                >
                  <span>{cat === 'ALL' ? 'All Therapeutic Classes' : cat}</span>
                </button>
              );
            })}
          </div>

          {/* Smart Search Feedback / Category Override Notice */}
          {categoryOverrideNote && (
            <div className="flex items-center justify-between gap-2 p-2.5 px-3.5 rounded-2xl bg-secondary-container/40 border border-secondary/20 text-xs text-primary">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-base">info</span>
                <span>{categoryOverrideNote}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedCategory('ALL');
                  setCategoryOverrideNote('');
                }}
                className="underline font-bold text-secondary hover:text-primary cursor-pointer shrink-0"
              >
                Switch Category to All
              </button>
            </div>
          )}

          {/* Active Category Tag Indicator */}
          {selectedCategory !== 'ALL' && !categoryOverrideNote && (
            <div className="flex items-center justify-between gap-2 p-2 px-3 rounded-xl bg-surface-container-low border border-outline-variant/20 text-xs text-on-surface">
              <div className="flex items-center gap-1.5">
                <span className="text-on-surface-variant">Restricted to therapeutic class:</span>
                <span className="font-bold text-primary">{selectedCategory}</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCategory('ALL')}
                className="inline-flex items-center gap-0.5 text-secondary hover:text-primary font-bold text-xs cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">close</span>
                <span>Show All Classes</span>
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Clinical Filter Feature Modal (Opened via Filter button inside search box) */}
      {showFilterModal && (
        <div className="fixed inset-0 bg-primary/20 backdrop-blur-xs z-50 flex items-center justify-center p-4">
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
                Apply Filters ({displayedMedicines.length} Results)
              </button>
            </div>
          </div>
        </div>
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

      {/* HERO 2-COLUMN ACTION CARDS */}
      <section className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* OCR Prescription Reader Feature Banner (7 cols) */}
        <div className="md:col-span-7 rounded-3xl bg-surface-container-low p-6 sm:p-7 flex flex-col justify-between shadow-xs border border-outline-variant/20 relative overflow-hidden">
          <div className="flex items-start justify-between gap-4 relative z-10">
            <div className="space-y-2 max-w-lg">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container-lowest/80 text-primary text-xs font-bold backdrop-blur-sm">
                <span className="material-symbols-outlined text-sm text-secondary">document_scanner</span>
                <span>OCR Prescription Reader</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-extrabold text-primary tracking-tight">
                Have a Doctor's Prescription?
              </h2>
              <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
                Upload a clear photo or digital e-Rx PDF. MediFind AI instantly parses molecules, detects generic substitutes, and searches stocks across local dispensaries.
              </p>
            </div>
            <div className="hidden sm:flex w-14 h-14 rounded-2xl bg-primary text-white items-center justify-center shrink-0 shadow-md">
              <span className="material-symbols-outlined text-3xl">prescriptions</span>
            </div>
          </div>
          <div className="mt-5 pt-1 flex flex-wrap items-center gap-4 relative z-10">
            <button
              onClick={() => onNavigateToPrescription ? onNavigateToPrescription() : onProceedToPharmacies()}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-primary hover:bg-primary-container text-white font-bold text-xs shadow-xs transition-all"
            >
              <span>Upload Prescription</span>
              <span className="material-symbols-outlined text-sm">arrow_forward</span>
            </button>
            <span className="text-[11px] text-on-surface-variant flex items-center gap-1 font-medium">
              <span className="material-symbols-outlined text-secondary text-sm">lock</span>
              Encrypted Secure Upload
            </span>
          </div>
        </div>

        {/* Emergency Duty Pharmacy Feature Banner (5 cols) */}
        <div className="md:col-span-5 rounded-3xl bg-surface-container-lowest p-6 sm:p-7 flex flex-col justify-between shadow-xs border border-outline-variant/30 relative overflow-hidden">
          <div className="space-y-2 relative z-10">
            <div className="flex items-center justify-between">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-error-container text-on-error-container text-[11px] font-bold">
                <span className="inline-block w-2 h-2 rounded-full bg-error animate-ping"></span>
                <span>Emergency Locator</span>
              </div>
              <span className="text-[11px] text-on-surface-variant font-medium">Regional Coverage</span>
            </div>
            <h3 className="text-lg font-bold text-primary">Emergency Pharmacy Locator</h3>
            <p className="text-xs text-on-surface-variant leading-relaxed">
              Need critical antibiotics, inhalers, or pediatric relief outside standard business hours?
            </p>
          </div>
          <div className="mt-4 pt-1 space-y-3 relative z-10">
            <div className="p-3 rounded-2xl bg-surface-container-low flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container shrink-0">
                  <span className="material-symbols-outlined text-base">schedule</span>
                </div>
                <div>
                  <p className="text-xs font-bold text-on-surface">Participating Pharmacies</p>
                  <p className="text-[11px] text-on-surface-variant">Chengannur, Kerala • Standard business hours</p>
                </div>
              </div>
              <span className="material-symbols-outlined text-secondary text-lg">chevron_right</span>
            </div>
            <button
              onClick={() => onNavigateToEmergency ? onNavigateToEmergency() : onProceedToPharmacies()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-secondary hover:bg-primary-container text-white font-bold text-xs transition-all shadow-xs"
            >
              <span className="material-symbols-outlined text-sm">navigation</span>
              <span>Find Open Duty Pharmacy</span>
            </button>
          </div>
        </div>
      </section>

      {/* Main Two-Column Layout: Catalogue (8 cols) & Side Request Drawer (4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Medicines Catalogue (8 cols) */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          {/* Catalogue Header & Sort Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1">
            <div>
              <h2 className="text-lg font-bold text-primary tracking-tight">Verified Medicine Catalogue</h2>
              <p className="text-xs text-on-surface-variant">
                Showing {displayedMedicines.length} verified therapeutic items available for reservation
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

          {/* Medicines Bento Grid — with slow vertical auto-scroll */}
          {loading ? (
            <LoadingSkeleton type="cards" count={6} />
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
          ) : (
            /* Scroll container — 3 rows visible, content duplicated for seamless loop when unfiltered */
            <div
              className={`medicine-scroll-track ${debouncedSearchQuery.trim() || selectedCategory !== 'ALL' || filterTag !== 'all' ? 'is-filtered' : ''}`}
              style={{ maxHeight: '480px' }}
              ref={scrollContainerRef}
            >
              <div className="medicine-scroll-inner">
                {/* Render medicines (only duplicate when actively idling in full marquee mode) */}
                {((debouncedSearchQuery.trim() || selectedCategory !== 'ALL' || filterTag !== 'all')
                  ? displayedMedicines
                  : [...displayedMedicines, ...displayedMedicines]
                ).map((med, idx) => {
                let alternatives = [];
                if (med.alternativeGenerics) {
                  try {
                    alternatives = JSON.parse(med.alternativeGenerics);
                  } catch (e) {
                    alternatives = med.alternativeGenerics.split(',').map(s => s.trim());
                  }
                }

                const reqItem = (selectedMedicines || []).find(i => i.medicineId === med.id);
                const isRx = med.requiresPrescription || med.isEmergency || (med.dosageForm && med.dosageForm.toLowerCase().includes('inhaler')) || med.category?.toLowerCase().includes('antibiotic');

                return (
                  <article
                    key={`med-${idx}-${med.id}`}
                    className="bg-surface-container-lowest rounded-2xl p-4 shadow-xs hover:shadow-md transition-shadow border border-outline-variant/30 flex flex-col justify-between group"
                  >
                    <div>
                      {/* Product Visual Imagery Well */}
                      <div className="relative w-full h-36 rounded-xl bg-surface-container-low flex items-center justify-center mb-3 overflow-hidden p-2 group-hover:bg-surface-container transition-colors">
                        {getMedicineImageUrl(med) ? (
                          <img
                            src={getMedicineImageUrl(med)}
                            alt={med.brandName}
                            className="w-full h-full object-contain p-1 transition-transform duration-300 group-hover:scale-105"
                            loading="lazy"
                            onError={(e) => {
                              e.target.style.display = 'none';
                              if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                            }}
                          />
                        ) : null}
                        <div
                          style={{ display: getMedicineImageUrl(med) ? 'none' : 'flex' }}
                          className="w-14 h-14 rounded-full bg-secondary-container/40 items-center justify-center text-secondary group-hover:scale-105 transition-transform"
                        >
                          <span className="material-symbols-outlined text-3xl">medication</span>
                        </div>
                        <span className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          isRx ? 'bg-surface-container text-primary' : 'bg-secondary-container text-on-secondary-container'
                        }`}>
                          {isRx ? 'Rx Required' : 'OTC Health'}
                        </span>
                        <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-surface-container-lowest flex items-center justify-center text-secondary shadow-xs">
                          <span className="material-symbols-outlined text-[13px]">shield</span>
                        </span>
                        <div className="absolute bottom-1.5 left-2 px-2 py-0.5 rounded-md bg-white/90 backdrop-blur-sm text-[10px] font-semibold text-primary">
                          {med.dosageForm || 'Oral'} • {med.strength || 'Std'}
                        </div>
                      </div>

                      {/* Header details */}
                      <div className="space-y-0.5">
                        <span className="text-[10px] font-bold text-secondary uppercase tracking-wider block">
                          {med.category || 'Therapeutic'}
                        </span>
                        <h3 className="text-base font-bold text-primary leading-tight">
                          {med.brandName}
                        </h3>
                        <p className="text-[11px] text-on-surface-variant font-medium">
                          Generic: <strong className="text-on-surface">{med.genericName}</strong>
                        </p>
                      </div>

                      {/* Common uses tag */}
                      {med.commonUses && (
                        <p className="text-[11px] text-on-surface-variant/80 line-clamp-1 mt-1">
                          Uses: {med.commonUses}
                        </p>
                      )}

                      {/* Availability Tag */}
                      <div className="mt-3 p-2 rounded-xl bg-surface-container-low flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-secondary animate-pulse"></span>
                          <span className="font-semibold text-secondary">Standardized Network</span>
                        </div>
                        <span className="text-on-surface-variant text-[10px]">Ready for Pickup</span>
                      </div>
                    </div>

                    {/* Footer price & steppers */}
                    <div className="mt-4 pt-3 border-t border-surface-container flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="text-[10px] text-on-surface-variant leading-none">
                          {med.price != null ? 'Unit Price' : 'Pricing'}
                        </span>
                        <span className="text-base font-bold text-primary">
                          {med.price != null ? `₹${med.price}` : 'At pharmacy counter'}
                        </span>
                      </div>

                      {reqItem ? (
                        <div className="flex items-center gap-1.5 bg-surface-container px-2 py-1 rounded-full">
                          <button
                            type="button"
                            onClick={() => onUpdateRequestQuantity && onUpdateRequestQuantity(med.id, reqItem.quantity - 1)}
                            className="w-6 h-6 rounded-full bg-surface-container-lowest text-primary hover:bg-surface-container-high flex items-center justify-center transition-colors"
                          >
                            <span className="material-symbols-outlined text-xs">remove</span>
                          </button>
                          <span className="text-xs font-bold text-primary px-1">{reqItem.quantity}</span>
                          <button
                            type="button"
                            onClick={() => onUpdateRequestQuantity && onUpdateRequestQuantity(med.id, reqItem.quantity + 1)}
                            className="w-6 h-6 rounded-full bg-primary text-white hover:bg-primary-container flex items-center justify-center transition-colors"
                          >
                            <span className="material-symbols-outlined text-xs">add</span>
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (onAddToRequest) {
                              onAddToRequest(med, 1);
                              showToast(`Added ${med.brandName} to medicine request.`, 'success');
                            }
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary hover:bg-primary-container text-white text-xs font-bold shadow-xs transition-all"
                        >
                          <span className="material-symbols-outlined text-sm">add</span>
                          <span>Add</span>
                        </button>
                      )}
                    </div>
                  </article>
                );
                })}
              </div>
            </div>
          )}

          {/* ── PAPER PRESCRIPTION BANNER (Stitch design — after search results) ── */}
          <div className="relative rounded-3xl overflow-hidden mt-2" style={{ background: 'linear-gradient(135deg, #1a4a3a 0%, #0d2d22 60%, #0a2018 100%)' }}>
            {/* Background decorative circle */}
            <div style={{ position: 'absolute', right: '-40px', top: '-40px', width: '200px', height: '200px', borderRadius: '50%', background: 'rgba(255,255,255,0.04)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', right: '60px', bottom: '-60px', width: '280px', height: '280px', borderRadius: '50%', background: 'rgba(255,255,255,0.03)', pointerEvents: 'none' }} />

            <div className="relative z-10 p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
              {/* Left content */}
              <div className="flex-1 space-y-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-bold" style={{ background: 'rgba(255,255,255,0.1)', color: '#a8d5c2' }}>
                  <span className="material-symbols-outlined text-sm" style={{ color: '#5fcba0' }}>receipt_long</span>
                  AUTOMATED Rx SCAN
                </div>
                <h3 className="text-xl sm:text-2xl font-extrabold" style={{ color: '#ffffff' }}>
                  Have a Paper Prescription from your Doctor?
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: '#a8d5c2', maxWidth: '420px' }}>
                  MedFind AI can instantly recognize your written prescription, extract codes, and locate verified neighborhood pharmacy stocks.
                </p>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => onNavigateToPrescription ? onNavigateToPrescription() : null}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full font-bold text-sm transition-all"
                    style={{ background: '#4db88a', color: '#fff', boxShadow: '0 4px 16px rgba(77,184,138,0.35)' }}
                  >
                    <span className="material-symbols-outlined text-sm">upload_file</span>
                    <span>Upload &amp; Attach Rx Prescription</span>
                  </button>
                  <span className="text-xs font-medium flex items-center gap-1" style={{ color: '#7abfa0' }}>
                    <span className="material-symbols-outlined text-sm" style={{ color: '#5fcba0' }}>lock</span>
                    100% compliant encryption for Rx
                  </span>
                </div>
              </div>

              {/* Right — Quick Snap & Match card */}
              <div className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl shrink-0" style={{ background: 'rgba(255,255,255,0.08)', minWidth: '130px' }}>
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(77,184,138,0.25)' }}>
                  <span className="material-symbols-outlined text-2xl" style={{ color: '#5fcba0' }}>photo_camera</span>
                </div>
                <span className="text-xs font-bold text-center" style={{ color: '#ffffff' }}>Quick Snap</span>
                <span className="text-[10px] text-center" style={{ color: '#7abfa0' }}>&amp; Match</span>
              </div>
            </div>
          </div>

          {/* Genuine Guarantee Informational Strip */}
          <div className="p-4 rounded-2xl bg-surface-container-low flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border border-outline-variant/30 text-xs text-on-surface-variant">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary text-lg">local_pharmacy</span>
              <span>Availability provided by participating pharmacies in Chengannur.</span>
            </div>
            <span className="text-secondary font-bold">Participating Pharmacy Inventory</span>
          </div>
        </div>

        {/* Right Column: Sticky Live Medicine Request Drawer (4 cols) */}
        <aside className="lg:col-span-4 sticky top-24">
          <div className="bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/30 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between pb-3 border-b border-surface-container mb-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-lg">shopping_basket</span>
                <h3 className="text-base font-bold text-primary">Medicine Request</h3>
              </div>
              <span className="bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded-full text-xs font-bold">
                {selectedMedicines.length} item(s)
              </span>
            </div>

            {selectedMedicines.length === 0 ? (
              <div className="py-8 text-center text-on-surface-variant space-y-2">
                <span className="material-symbols-outlined text-3xl text-outline-variant">medication_liquid</span>
                <p className="text-xs">Your medicine request is currently empty.</p>
                <p className="text-[11px] text-outline">Search and click "Add" to stage items for reservation.</p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1 mb-3">
                {selectedMedicines.map(item => {
                  const med = medicines.find(m => m.id === item.medicineId);
                  const isRx = med ? (med.requiresPrescription || med.isEmergency || med.category?.toLowerCase().includes('antibiotic')) : false;

                  return (
                    <div
                      key={item.medicineId}
                      className="p-2.5 rounded-xl bg-surface-container-low flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className="w-8 h-8 rounded-lg bg-surface-container-lowest p-0.5 border border-outline-variant/30 flex items-center justify-center shrink-0 overflow-hidden">
                          {getMedicineImageUrl(item) || getMedicineImageUrl(med) ? (
                            <img
                              src={getMedicineImageUrl(item) || getMedicineImageUrl(med)}
                              alt=""
                              className="w-full h-full object-contain"
                              onError={(e) => {
                                e.target.style.display = 'none';
                              }}
                            />
                          ) : (
                            <span className="material-symbols-outlined text-sm text-secondary">medication</span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-bold text-primary truncate">
                              {item.brandName || med?.brandName || 'Medicine'}
                            </p>
                            {isRx && (
                              <span className="bg-surface-container text-primary text-[9px] font-bold px-1.5 py-0.2 rounded-full shrink-0">
                                Rx
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-on-surface-variant truncate">
                            {med?.genericName || 'Therapeutic Item'}
                          </p>
                        </div>
                      </div>

                      {/* Steppers */}
                      <div className="flex items-center gap-1 bg-surface-container-lowest px-1.5 py-0.5 rounded-full border border-outline-variant/30">
                        {onUpdateRequestQuantity && (
                          <button
                            type="button"
                            onClick={() => onUpdateRequestQuantity(item.medicineId, Math.max(1, (item.quantity || 1) - 1))}
                            className="text-on-surface-variant hover:text-on-surface w-4 h-4 flex items-center justify-center"
                          >
                            <span className="material-symbols-outlined text-xs">remove</span>
                          </button>
                        )}
                        <span className="text-xs font-bold text-on-surface font-mono">{item.quantity || 1}</span>
                        {onUpdateRequestQuantity && (
                          <button
                            type="button"
                            onClick={() => onUpdateRequestQuantity(item.medicineId, (item.quantity || 1) + 1)}
                            className="text-on-surface-variant hover:text-on-surface w-4 h-4 flex items-center justify-center"
                          >
                            <span className="material-symbols-outlined text-xs">add</span>
                          </button>
                        )}
                      </div>

                      {onRemoveFromRequest && (
                        <button
                          type="button"
                          onClick={() => onRemoveFromRequest(item.medicineId)}
                          className="text-on-surface-variant hover:text-error w-5 h-5 flex items-center justify-center transition-colors"
                          title="Remove item"
                        >
                          <span className="material-symbols-outlined text-sm">close</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Prescription Requirement Reminder Callout */}
            {hasRxItemsInRequest && (
              <div className="p-2.5 rounded-xl bg-surface-container-high flex items-start gap-2 mb-3">
                <span className="material-symbols-outlined text-secondary text-base mt-0.5">info</span>
                <div className="space-y-0.5">
                  <p className="text-[11px] text-primary font-bold">Prescription Required For Staged Items</p>
                  <p className="text-[10px] text-on-surface-variant leading-tight">
                    Antibiotics &amp; controlled items require doctor validation. You can link your uploaded Rx during checkout.
                  </p>
                </div>
              </div>
            )}

            {/* Side Action Buttons */}
            {selectedMedicines.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-surface-container">
                <button
                  type="button"
                  onClick={handleCheckAvailabilityForAll}
                  className="w-full py-2 rounded-full bg-surface-container hover:bg-surface-container-high text-primary text-xs font-bold transition-colors flex items-center justify-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-sm text-secondary">explore</span>
                  <span>Check Availability &amp; Ranking</span>
                </button>
                {onProceedToPharmacies && (
                  <button
                    type="button"
                    onClick={onProceedToPharmacies}
                    className="w-full py-2.5 rounded-full bg-primary hover:bg-primary-container text-white text-xs font-bold shadow-xs transition-all flex items-center justify-center gap-1.5"
                  >
                    <span>Proceed to Pharmacy Discovery</span>
                    <span className="material-symbols-outlined text-sm">arrow_forward</span>
                  </button>
                )}
                {onClearRequest && (
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDialog({
                        isOpen: true,
                        title: 'Clear Active Medicine Request?',
                        message: `Are you sure you want to remove all ${selectedMedicines.length} medicine(s) from your staged reservation query?`,
                        confirmLabel: 'Yes, Clear Request',
                        variant: 'danger',
                        impactPoints: [
                          'Staged items will be removed from your reservation queue.',
                          'You can re-add them anytime from the medicine catalog.'
                        ],
                        onConfirm: () => {
                          onClearRequest();
                          showToast('Medicine request cleared.', 'info');
                        }
                      });
                    }}
                    className="w-full py-1 text-center text-[11px] text-tertiary font-bold hover:underline"
                  >
                    Clear Request
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>
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

      {/* Floating Action Feedback / Toast Notification */}
      {feedback.show && (
        <div style={{
          position: 'fixed',
          top: '1.5rem',
          right: '1.5rem',
          zIndex: 9999,
          padding: '0.85rem 1.25rem',
          borderRadius: 16,
          background: feedback.type === 'error' ? '#ffdad6' : '#e0f2eb',
          color: feedback.type === 'error' ? '#93000a' : '#032f28',
          border: `1px solid ${feedback.type === 'error' ? '#ffb4a8' : '#a6cfc5'}`,
          boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          maxWidth: 440
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
            {feedback.type === 'error' ? 'error' : 'check_circle'}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{feedback.message}</span>
          <button
            onClick={() => setFeedback({ show: false, message: '', type: 'success' })}
            style={{ background: 'none', border: 'none', cursor: 'pointer', marginLeft: 'auto', color: 'inherit', display: 'flex', alignItems: 'center' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
          </button>
        </div>
      )}

      {/* Availability Modal */}
      <AvailabilityModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        items={selectedItemsForModal}
        onOrderCreated={onOrderCreated}
        isEmergency={false}
      />
    </div>
  );
}
