import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import ConfirmationDialog from '../components/ConfirmationDialog';
import { broadcastUpdate } from '../utils/realtimeUpdates';

// Curated High-Resolution Preset Avatars
const PRESET_AVATARS = [
  {
    id: 'asst-delivery-1',
    label: 'Logistics Specialist (Male)',
    url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=400'
  },
  {
    id: 'asst-delivery-2',
    label: 'Logistics Specialist (Female)',
    url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400'
  },
  {
    id: 'clinical-specialist',
    label: 'Clinician / Specialist',
    url: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&q=80&w=400'
  },
  {
    id: 'medical-director',
    label: 'Supervising Pharmacist',
    url: 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?auto=format&fit=crop&q=80&w=400'
  },
  {
    id: 'admin-lead',
    label: 'Operations Administrator',
    url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=400'
  }
];

// Curated Hero Banners
const PRESET_BANNERS = [
  {
    id: 'workspace-desk',
    label: 'Operations Command',
    url: 'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&q=80&w=1600'
  },
  {
    id: 'clinical-sage',
    label: 'Clinical Sage Panorama',
    url: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?auto=format&fit=crop&q=80&w=1600'
  },
  {
    id: 'city-dispatch',
    label: 'Transit & Route Network',
    url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&q=80&w=1600'
  }
];

// Authoritative Participating Pharmacies (Exactly 2 in entire platform)
const REAL_PHARMACIES = [
  {
    id: 'max-care-pharmacy',
    name: 'Max Care Pharmacy',
    tag: 'Accredited Dispensary Hub',
    address: '20/375, Govt. Hospital Junction, Chengannur, Kerala – 689121, India',
    phone: '+91 479 299 3291',
    rawPhone: '04792993291',
    hours: '09:30 AM – 08:00 PM',
    mapsUrl: 'https://maps.app.goo.gl/W5EYF7wtx33cLpfL7',
    license: 'KL-ALP-2024-8841',
    features: ['Cold-Chain Storage', 'Prescription Counter', '4-Digit PIN Handover', 'EV Route Access']
  },
  {
    id: 'karuna-medicals',
    name: 'Karuna Medicals',
    tag: 'Accredited Dispensary Hub',
    address: 'XI/567(1), Chengannur, Alappuzha, Kerala – 689121, India',
    phone: '+91 96057 18151',
    rawPhone: '9605718151',
    hours: '09:30 AM – 07:00 PM',
    mapsUrl: 'https://maps.app.goo.gl/jaszQixVujJRX9yc9?g_st=ac',
    license: 'KL-ALP-2023-4102',
    features: ['Digital PIN Dispensary', 'Walk-in Counter', 'Emergency Stock Ready', 'Verified Relay']
  }
];

const KERALA_TOWN_PRESETS = [
  'Chengannur, Kerala',
  'Mavelikara, Kerala',
  'Haripad, Kerala',
  'Thiruvalla, Kerala',
  'Kayamkulam, Kerala',
  'Kallissery, Kerala'
];

export default function UserProfile({ role: propRole, onNavigate }) {
  const { user, setUser } = useAuth();
  const { theme, setTheme } = useTheme();
  const role = propRole || user?.role || 'PATIENT';
  const storageKey = `medifind_user_profile_${user?.id || role}`;

  // Default initial profile tailored per role (Clean real operational attributes only)
  const getDefaultProfile = () => {
    if (role === 'ASSISTANT') {
      return {
        name: user?.name || 'Keerthana Nair',
        email: user?.email || 'assistant@medifind.com',
        phone: user?.phone || '+91 98471 88201',
        title: 'Medicine Access & Dispatch Assistant',
        location: 'Chengannur, Kerala, India',
        operatingCity: 'Chengannur, Kerala',
        operatingRadiusKm: 15,
        vehicleType: 'Electric Two-Wheeler (EV Scooter)',
        verificationStatus: 'PENDING', // Live dynamic: 'APPROVED' | 'PENDING'
        bio: 'Certified community assistant providing doorstep prescription handover, temperature-monitored cold-chain transit, and patient 4-digit PIN verification across Chengannur.',
        joinedDate: 'January 2024',
        workingHours: '08:00 AM – 08:00 PM',
        avatarUrl: PRESET_AVATARS[0].url,
        bannerUrl: PRESET_BANNERS[2].url,
        skills: [
          'Cold-Chain Transit',
          'Doorstep Handover',
          '4-Digit PIN Security',
          'Dispensary Relay',
          'EV Fleet Route',
          'Prescription Check'
        ]
      };
    }
    if (role === 'PHARMACIST') {
      return {
        name: user?.name || 'Dr. Thomas Varghese',
        email: user?.email || 'pharmacist@maxcare.example.com',
        phone: user?.phone || '+91 479 299 3291',
        title: 'Supervising Pharmacist & Dispensary Manager',
        location: 'Govt. Hospital Junction, Chengannur, Kerala',
        pharmacyName: 'Max Care Pharmacy',
        licenseNumber: 'KL-ALP-2024-8841',
        qualification: 'B.Pharm, Registered Pharmacist (KSPC)',
        workingHours: '09:30 AM – 08:00 PM',
        operatingRadiusKm: 12,
        verificationStatus: 'APPROVED',
        bio: 'Supervising registered pharmacist overseeing clinical prescription safety, cold-chain biologics management, tamper-evident packaging, and encrypted patient PIN counter handovers.',
        joinedDate: 'August 2023',
        avatarUrl: PRESET_AVATARS[3].url,
        bannerUrl: PRESET_BANNERS[1].url,
        skills: [
          'Prescription Verification',
          'Cold-Chain Storage',
          'Controlled Substances',
          'Dispensary Protocol',
          'Patient Consultation',
          'Stock Telemetry'
        ]
      };
    }
    if (role === 'ADMIN') {
      return {
        name: user?.name || 'MediFind System Admin',
        email: user?.email || 'admin@medifind.com',
        phone: user?.phone || '+91 479 245 0001',
        title: 'Platform Operations & Security Lead',
        location: 'Operations Command Hub, Chengannur, Kerala',
        clearanceLevel: 'Superuser Level 3 (RBAC)',
        workingHours: '24/7 Operations Monitoring',
        verificationStatus: 'APPROVED',
        bio: 'Platform administrator overseeing real participating pharmacies (Max Care Pharmacy & Karuna Medicals), assistant credential verification queue, and regulatory compliance.',
        joinedDate: 'July 2023',
        avatarUrl: PRESET_AVATARS[4].url,
        bannerUrl: PRESET_BANNERS[0].url,
        skills: [
          'RBAC Governance',
          'Assistant Credentialing',
          'Dispensary Audits',
          'Security Telemetry',
          'Cryptographic PIN Audits',
          'Operations Hub'
        ]
      };
    }
    // PATIENT
    return {
      name: user?.name || 'Rohan Sharma',
      email: user?.email || 'patient@medifind.com',
      phone: user?.phone || '+91 98765 43210',
      title: 'Verified Patient & Prescription Holder',
      location: 'MG Road, Chengannur, Kerala, India',
      bloodGroup: 'O+',
      healthId: 'ABHA-KL-8821-4921',
      verificationStatus: 'APPROVED',
      bio: 'Registered patient utilizing MediFind AI for verified dispensary reservation, certified assistant doorstep collection, and digital prescription tracking.',
      joinedDate: 'October 2024',
      workingHours: 'Home Delivery Contact: 08:00 AM – 09:00 PM',
      avatarUrl: PRESET_AVATARS[1].url,
      bannerUrl: PRESET_BANNERS[0].url,
      skills: [
        'Prescription Management',
        'ABHA Health ID',
        'Doorstep Handover',
        'Emergency Reserving',
        'PIN Authentication'
      ]
    };
  };

  const [profile, setProfile] = useState(() => {
    try {
      const keys = [
        user?.id ? `medifind_user_profile_${user.id}` : null,
        user?.role ? `medifind_user_profile_${user.role}` : null,
        `medifind_user_profile_${role}`,
        storageKey
      ].filter(Boolean);

      for (const k of keys) {
        const saved = localStorage.getItem(k);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.name) {
            const clean = { ...parsed };
            // Strip out deprecated dummy fields if found in old storage
            delete clean.rating;
            delete clean.completedHandovers;
            delete clean.onTimeRate;
            return { ...getDefaultProfile(), ...clean };
          }
        }
      }
    } catch (e) {}
    return getDefaultProfile();
  });

  const [activeTab, setActiveTab] = useState('overview');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isMediaModalOpen, setIsMediaModalOpen] = useState(false);
  const [mediaType, setMediaType] = useState('avatar'); // 'avatar' | 'banner'
  const [copiedKey, setCopiedKey] = useState(null);
  const [feedback, setFeedback] = useState({ show: false, message: '', type: 'success' });
  const [editForm, setEditForm] = useState({ ...profile });
  const fileInputRef = useRef(null);

  // Live Assistant verification sync
  useEffect(() => {
    if (role === 'ASSISTANT') {
      const token = localStorage.getItem('medifind_token');
      if (token) {
        fetch('/api/assistant/profile', {
          headers: { Authorization: `Bearer ${token}` }
        })
          .then(res => res.json())
          .then(data => {
            if (data.success && data.profile) {
              setProfile(prev => ({
                ...prev,
                verificationStatus: data.profile.verificationStatus || 'PENDING',
                assistantType: data.profile.assistantType,
                operatingCity: data.profile.operatingCity || prev.operatingCity,
                operatingRadiusKm: data.profile.operatingRadiusKm || prev.operatingRadiusKm,
                vehicleType: data.profile.vehicleType || prev.vehicleType
              }));
            }
          })
          .catch(() => {});
      }
    }
  }, [role]);

  // Synchronize when authenticated user changes
  useEffect(() => {
    if (user && user.name) {
      setProfile(prev => ({
        ...prev,
        name: user.name,
        email: user.email || prev.email,
        phone: user.phone || prev.phone
      }));
    }
  }, [user]);

  const showToast = (message, type = 'success') => {
    setFeedback({ show: true, message, type });
    setTimeout(() => setFeedback({ show: false, message: '', type: 'success' }), 3200);
  };

  const copyToClipboard = (text, keyName, label) => {
    if (!text) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      setCopiedKey(keyName);
      showToast(`${label} copied to clipboard!`, 'success');
      setTimeout(() => setCopiedKey(null), 2000);
    }
  };

  const saveProfileData = async (updated) => {
    // Strip dummy fields
    delete updated.rating;
    delete updated.completedHandovers;
    delete updated.onTimeRate;

    setProfile(updated);
    try {
      localStorage.setItem(storageKey, JSON.stringify(updated));
      if (user?.role) localStorage.setItem(`medifind_user_profile_${user.role}`, JSON.stringify(updated));
      if (user?.id) localStorage.setItem(`medifind_user_profile_${user.id}`, JSON.stringify(updated));
      localStorage.setItem(`medifind_user_profile_${role}`, JSON.stringify(updated));

      if (setUser) {
        setUser(prev => prev ? ({ ...prev, name: updated.name, phone: updated.phone }) : prev);
      }

      // Persist to database if authenticated
      const token = localStorage.getItem('medifind_token');
      if (token) {
        await fetch('/api/auth/profile', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ name: updated.name, phone: updated.phone })
        }).catch(() => {});
      }

      broadcastUpdate('profile', { role, profile: updated });
      window.dispatchEvent(new Event('medifind_profile_updated'));
      showToast('Profile updated successfully!', 'success');
    } catch (e) {
      console.error('Save error:', e);
    }
  };

  const handleOpenEditModal = () => {
    setEditForm({ ...profile });
    setIsEditModalOpen(true);
  };

  const handleSaveEditModal = (e) => {
    e.preventDefault();
    saveProfileData(editForm);
    setIsEditModalOpen(false);
  };

  const handleOpenMedia = (type) => {
    setMediaType(type);
    setIsMediaModalOpen(true);
  };

  const handleSelectPresetMedia = (url) => {
    if (mediaType === 'avatar') {
      const updated = { ...profile, avatarUrl: url };
      saveProfileData(updated);
    } else {
      const updated = { ...profile, bannerUrl: url };
      saveProfileData(updated);
    }
    setIsMediaModalOpen(false);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        showToast('Image file size must be under 5MB', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const url = ev.target.result;
        if (mediaType === 'avatar') {
          saveProfileData({ ...profile, avatarUrl: url });
        } else {
          saveProfileData({ ...profile, bannerUrl: url });
        }
        setIsMediaModalOpen(false);
      };
      reader.readAsDataURL(file);
    }
  };

  const isApproved = profile.verificationStatus === 'APPROVED';

  // Navigation tab definitions
  const tabs = [
    { id: 'overview', label: 'Overview', icon: 'account_circle' },
    { id: 'territory', label: 'Operating Hub & Radius', icon: 'pin_drop' },
    { id: 'security', label: 'Security & Verification', icon: 'shield' },
    { id: 'pharmacies', label: 'Participating Pharmacies', icon: 'local_pharmacy' }
  ];

  return (
    <div className="w-full min-h-screen bg-[#f4f7f6] dark:bg-[#121517] text-[#1e2925] dark:text-[#f1f5f3] pb-20 transition-colors">
      
      {/* Toast Alert */}
      <AnimatePresence>
        {feedback.show && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className={`fixed top-20 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-xl border text-xs font-bold ${
              feedback.type === 'error'
                ? 'bg-[#ffdad6] text-[#ba1a1a] border-[#ba1a1a]/30'
                : 'bg-[#b0ecdd] text-[#00201b] border-[#2e685d]/30'
            }`}
          >
            <span className="material-symbols-outlined text-base">
              {feedback.type === 'error' ? 'error' : 'check_circle'}
            </span>
            <span>{feedback.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── 1. HERO COVER BANNER WITH INTERACTIVE ACTIONS ── */}
      <div className="relative w-full h-56 sm:h-72 lg:h-80 overflow-hidden bg-[#032f28]">
        <img
          src={profile.bannerUrl || PRESET_BANNERS[0].url}
          alt="Profile Header Banner"
          className="w-full h-full object-cover opacity-90 transition-transform duration-700 hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />

        {/* Top-Right Header Actions */}
        <div className="absolute top-4 right-4 sm:top-6 sm:right-6 flex items-center gap-2 z-20">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            type="button"
            onClick={() => handleOpenMedia('banner')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-black/40 hover:bg-black/65 backdrop-blur-md text-white text-xs font-bold border border-white/20 transition-all shadow-md cursor-pointer"
          >
            <span className="material-symbols-outlined text-sm">photo_camera</span>
            <span className="hidden sm:inline">Change Cover</span>
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            type="button"
            onClick={() => copyToClipboard(window.location.href, 'profileUrl', 'Profile link')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/90 hover:bg-white text-[#032f28] text-xs font-extrabold shadow-md transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-sm">
              {copiedKey === 'profileUrl' ? 'check' : 'share'}
            </span>
            <span>{copiedKey === 'profileUrl' ? 'Link Copied!' : 'Share Profile'}</span>
          </motion.button>
        </div>
      </div>

      {/* ── 2. MAIN WORKSPACE CONTAINER ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-20 sm:-mt-24 relative z-20">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

          {/* ── LEFT COLUMN: IDENTITY & INTERACTIVE CONTACT STACK (4 Cols) ── */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="bg-white dark:bg-[#1a1d21] rounded-3xl p-6 sm:p-7 border border-[#e0f2eb] dark:border-[#2a3036] shadow-md flex flex-col gap-5 text-center sm:text-left transition-colors"
            >
              
              {/* Circular Avatar with Camera Trigger */}
              <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-full border-4 border-white dark:border-[#1a1d21] shadow-xl overflow-hidden mx-auto sm:mx-0 group shrink-0 bg-[#e0f2eb]">
                <img
                  src={profile.avatarUrl}
                  alt={profile.name}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                />
                <button
                  type="button"
                  onClick={() => handleOpenMedia('avatar')}
                  className="absolute inset-0 bg-black/45 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity cursor-pointer backdrop-blur-xs"
                  title="Update profile photo"
                >
                  <span className="material-symbols-outlined text-2xl">photo_camera</span>
                </button>
              </div>

              {/* Name, Headline, and Location */}
              <div>
                <div className="flex items-center justify-center sm:justify-start gap-1.5 flex-wrap">
                  <h1 className="text-2xl sm:text-3xl font-black text-[#032f28] dark:text-[#f8f9fa] tracking-tight">
                    {profile.name}
                  </h1>
                  {isApproved && (
                    <span className="material-symbols-outlined text-[#2e685d] dark:text-emerald-400 text-xl" title="Verified Account">
                      verified
                    </span>
                  )}
                </div>
                <p className="text-xs sm:text-sm font-semibold text-[#414846] dark:text-[#a0aba6] mt-1 leading-snug">
                  {profile.title}
                </p>
                <button
                  type="button"
                  onClick={() => copyToClipboard(profile.location || profile.operatingCity || 'Chengannur, Kerala', 'location', 'Location')}
                  className="inline-flex items-center justify-center sm:justify-start gap-1 text-xs text-[#717976] dark:text-[#889590] mt-2 hover:text-[#032f28] dark:hover:text-emerald-300 transition-colors cursor-pointer group"
                >
                  <span className="material-symbols-outlined text-sm text-[#2e685d] dark:text-emerald-400 group-hover:scale-110 transition-transform">location_on</span>
                  <span>{profile.location || profile.operatingCity || 'Chengannur, Kerala'}</span>
                  <span className="text-[10px] opacity-0 group-hover:opacity-100 text-[#2e685d] font-bold ml-1 transition-opacity">
                    {copiedKey === 'location' ? 'Copied!' : 'Copy'}
                  </span>
                </button>
              </div>

              {/* Primary Interactive Action Buttons */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={handleOpenEditModal}
                  className="w-full py-2.5 px-3 rounded-2xl bg-[#032f28] hover:bg-[#1a4b41] text-white text-xs font-extrabold shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-base">edit</span>
                  <span>Edit Profile</span>
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={() => showToast('Dispatch status is Active and available.', 'success')}
                  className="w-full py-2.5 px-3 rounded-2xl bg-[#e0f2eb] hover:bg-[#b0ecdd] text-[#032f28] text-xs font-extrabold border border-[#2e685d]/30 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span className="w-2 h-2 rounded-full bg-[#2e685d] animate-pulse"></span>
                  <span>Available</span>
                </motion.button>
              </div>

              {/* ── Dynamic Verification Status Card (Interactive) ── */}
              <motion.div
                whileHover={{ scale: 1.01 }}
                className={`p-4 rounded-2xl border text-left flex items-start gap-3 transition-colors ${
                  isApproved
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800'
                    : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800'
                }`}
              >
                <span className={`material-symbols-outlined text-xl mt-0.5 shrink-0 ${
                  isApproved ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
                }`}>
                  {isApproved ? 'verified_user' : 'pending_actions'}
                </span>
                <div className="text-xs">
                  <div className={`font-black uppercase tracking-wider text-[11px] ${
                    isApproved ? 'text-emerald-900 dark:text-emerald-300' : 'text-amber-900 dark:text-amber-300'
                  }`}>
                    {isApproved
                      ? (role === 'ASSISTANT' ? 'Verified Dispatch Partner' : 'Regulatory Approved')
                      : 'Verification Pending Review'}
                  </div>
                  <p className={`mt-0.5 text-[11.5px] leading-relaxed ${
                    isApproved ? 'text-emerald-800 dark:text-emerald-400' : 'text-amber-800 dark:text-amber-400'
                  }`}>
                    {isApproved
                      ? 'Credentials and operational scope verified by MediFind Platform Authority.'
                      : 'Application registered. Awaiting administrator verification before live task allocation.'}
                  </p>
                </div>
              </motion.div>

              {/* ── Verified Operational Capabilities (Interactive chips) ── */}
              <div className="pt-3 border-t border-[#e0f2eb] dark:border-[#2a3036]">
                <h2 className="text-xs font-bold uppercase tracking-wider text-[#717976] dark:text-[#889590] mb-2.5">
                  Verified Operational Scopes
                </h2>
                <div className="flex flex-wrap gap-1.5">
                  {(profile.skills || []).map((skill, idx) => (
                    <motion.span
                      key={idx}
                      whileHover={{ scale: 1.05, y: -1 }}
                      className="px-3 py-1 rounded-full bg-[#f0fdf4] dark:bg-[#1a2e26] text-[#166534] dark:text-[#86efac] border border-[#bbf7d0] dark:border-[#166534] text-[11px] font-bold cursor-default select-none shadow-2xs"
                    >
                      {skill}
                    </motion.span>
                  ))}
                </div>
              </div>

              {/* ── Interactive Contact Stack (Click to Copy) ── */}
              <div className="pt-3 border-t border-[#e0f2eb] dark:border-[#2a3036] flex flex-col gap-2.5 text-xs text-[#414846] dark:text-[#a0aba6]">
                
                {/* Email Chip */}
                <motion.div
                  whileHover={{ x: 2 }}
                  onClick={() => copyToClipboard(profile.email, 'email', 'Email')}
                  className="flex items-center justify-between p-2 rounded-xl hover:bg-[#f8fafc] dark:hover:bg-[#212529] cursor-pointer transition-colors group"
                >
                  <span className="flex items-center gap-2 text-[#717976]">
                    <span className="material-symbols-outlined text-sm text-[#2e685d]">mail</span>
                    <span>Email</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-[#032f28] dark:text-[#f8f9fa] truncate max-w-[170px]">
                      {profile.email}
                    </span>
                    <span className="material-symbols-outlined text-xs text-[#717976] opacity-0 group-hover:opacity-100 transition-opacity">
                      {copiedKey === 'email' ? 'done' : 'content_copy'}
                    </span>
                  </div>
                </motion.div>

                {/* Phone Chip */}
                <motion.div
                  whileHover={{ x: 2 }}
                  onClick={() => copyToClipboard(profile.phone, 'phone', 'Phone')}
                  className="flex items-center justify-between p-2 rounded-xl hover:bg-[#f8fafc] dark:hover:bg-[#212529] cursor-pointer transition-colors group"
                >
                  <span className="flex items-center gap-2 text-[#717976]">
                    <span className="material-symbols-outlined text-sm text-[#2e685d]">call</span>
                    <span>Phone</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-bold text-[#032f28] dark:text-[#f8f9fa]">
                      {profile.phone}
                    </span>
                    <span className="material-symbols-outlined text-xs text-[#717976] opacity-0 group-hover:opacity-100 transition-opacity">
                      {copiedKey === 'phone' ? 'done' : 'content_copy'}
                    </span>
                  </div>
                </motion.div>

                {/* Transit Vehicle Mode */}
                {profile.vehicleType && (
                  <div className="flex items-center justify-between p-2 rounded-xl">
                    <span className="flex items-center gap-2 text-[#717976]">
                      <span className="material-symbols-outlined text-sm text-[#2e685d]">electric_moped</span>
                      <span>Transit Mode</span>
                    </span>
                    <span className="font-semibold text-[#032f28] dark:text-[#f8f9fa] text-right text-[11.5px]">
                      {profile.vehicleType}
                    </span>
                  </div>
                )}

                {/* Network Joined */}
                <div className="flex items-center justify-between p-2 rounded-xl">
                  <span className="flex items-center gap-2 text-[#717976]">
                    <span className="material-symbols-outlined text-sm text-[#2e685d]">calendar_month</span>
                    <span>Member Since</span>
                  </span>
                  <span className="font-semibold text-[#032f28] dark:text-[#f8f9fa]">
                    {profile.joinedDate || '2024'}
                  </span>
                </div>

              </div>

            </motion.div>
          </div>

          {/* ── RIGHT COLUMN: RICH INTERACTIVE TABBED WORKSPACE (8 Cols) ── */}
          <div className="lg:col-span-8 flex flex-col gap-6">

            {/* ── FLUID SLIDING TAB SWITCHER (Using AuthPage motion indicator) ── */}
            <div className="relative flex items-center p-1.5 rounded-2xl bg-white/90 dark:bg-[#1a1d21]/90 backdrop-blur-md border border-[#e0f2eb] dark:border-[#2a3036] shadow-sm gap-1.5 overflow-x-auto">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`relative px-4 py-2.5 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center gap-2 whitespace-nowrap z-10 ${
                      isActive
                        ? 'text-white'
                        : 'text-[#414846] dark:text-[#a0aba6] hover:text-[#032f28] dark:hover:text-white'
                    }`}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="profileActiveTabIndicator"
                        className="absolute inset-0 rounded-xl bg-gradient-to-r from-[#032f28] to-[#0a4f43] dark:from-[#2e685d] dark:to-[#1e453e] shadow-[0_2px_10px_rgba(3,47,40,0.3)] -z-10"
                        transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                      />
                    )}
                    <span className="material-symbols-outlined text-sm">{tab.icon}</span>
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* ── TAB 1: OVERVIEW ── */}
            {activeTab === 'overview' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col gap-6"
              >

                {/* Card 1: Professional Scope & Bio */}
                <motion.div
                  whileHover={{ y: -2 }}
                  className="bg-white dark:bg-[#1a1d21] rounded-3xl p-6 sm:p-7 border border-[#e0f2eb] dark:border-[#2a3036] shadow-sm flex flex-col gap-3 transition-shadow hover:shadow-md"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-extrabold text-[#032f28] dark:text-[#f8f9fa] flex items-center gap-2">
                      <span className="material-symbols-outlined text-lg text-[#2e685d]">person</span>
                      <span>Operational Focus &amp; Profile Summary</span>
                    </h2>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      type="button"
                      onClick={handleOpenEditModal}
                      className="text-xs font-bold text-[#2e685d] dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-sm">edit</span>
                      <span>Edit</span>
                    </motion.button>
                  </div>
                  <p className="text-xs sm:text-sm text-[#414846] dark:text-[#c0c8c5] leading-relaxed">
                    {profile.bio}
                  </p>
                  
                  {/* Verified Service Commitment Banner */}
                  <div className="p-3.5 rounded-2xl bg-[#f0fdf4] dark:bg-[#162720] border border-[#bbf7d0] dark:border-[#1e453e] text-xs text-[#166534] dark:text-emerald-300 flex items-center gap-2.5 mt-1">
                    <span className="material-symbols-outlined text-base text-[#2e685d] shrink-0">verified</span>
                    <span><strong>Service Commitment:</strong> Strict adherence to zero-leakage 4-digit PIN authentication and secure dispensary counter handovers.</span>
                  </div>
                </motion.div>

                {/* Card 2: Real Key Operational Attributes (Clean, No Fake Counters/Ratings) */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  
                  <motion.div
                    whileHover={{ y: -3, scale: 1.01 }}
                    className="bg-white dark:bg-[#1a1d21] rounded-3xl p-5 border border-[#e0f2eb] dark:border-[#2a3036] shadow-sm flex flex-col gap-1.5 transition-all"
                  >
                    <div className="w-8 h-8 rounded-xl bg-[#e0f2eb] dark:bg-[#1a2e26] text-[#2e685d] dark:text-emerald-300 flex items-center justify-center shrink-0 mb-1">
                      <span className="material-symbols-outlined text-base">pin_drop</span>
                    </div>
                    <span className="text-[11px] font-bold text-[#717976] uppercase tracking-wider">Anchor Dispatch Hub</span>
                    <span className="text-sm font-black text-[#032f28] dark:text-[#f8f9fa] truncate">
                      {profile.operatingCity || 'Chengannur, Kerala'}
                    </span>
                    <span className="text-[11px] text-[#2e685d] dark:text-emerald-400 font-semibold">Active Geocoded Anchor</span>
                  </motion.div>

                  <motion.div
                    whileHover={{ y: -3, scale: 1.01 }}
                    className="bg-white dark:bg-[#1a1d21] rounded-3xl p-5 border border-[#e0f2eb] dark:border-[#2a3036] shadow-sm flex flex-col gap-1.5 transition-all"
                  >
                    <div className="w-8 h-8 rounded-xl bg-[#e0f2eb] dark:bg-[#1a2e26] text-[#2e685d] dark:text-emerald-300 flex items-center justify-center shrink-0 mb-1">
                      <span className="material-symbols-outlined text-base">radar</span>
                    </div>
                    <span className="text-[11px] font-bold text-[#717976] uppercase tracking-wider">Service Coverage</span>
                    <span className="text-sm font-black text-[#032f28] dark:text-[#f8f9fa]">
                      {profile.operatingRadiusKm || 15} km Radius
                    </span>
                    <span className="text-[11px] text-[#717976] font-medium">Automatic Route Bounds</span>
                  </motion.div>

                  <motion.div
                    whileHover={{ y: -3, scale: 1.01 }}
                    className="bg-white dark:bg-[#1a1d21] rounded-3xl p-5 border border-[#e0f2eb] dark:border-[#2a3036] shadow-sm flex flex-col gap-1.5 transition-all"
                  >
                    <div className="w-8 h-8 rounded-xl bg-[#e0f2eb] dark:bg-[#1a2e26] text-[#2e685d] dark:text-emerald-300 flex items-center justify-center shrink-0 mb-1">
                      <span className="material-symbols-outlined text-base">lock</span>
                    </div>
                    <span className="text-[11px] font-bold text-[#717976] uppercase tracking-wider">Security Protocol</span>
                    <span className="text-sm font-black text-[#032f28] dark:text-[#f8f9fa]">
                      4-Digit PIN Handover
                    </span>
                    <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-bold">Zero-Fraud Protection</span>
                  </motion.div>

                </div>

                {/* Card 3: Connected Participating Pharmacies (ONLY 2 REAL ONES) */}
                <motion.div
                  whileHover={{ y: -2 }}
                  className="bg-white dark:bg-[#1a1d21] rounded-3xl p-6 sm:p-7 border border-[#e0f2eb] dark:border-[#2a3036] shadow-sm flex flex-col gap-4"
                >
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <h2 className="text-base font-extrabold text-[#032f28] dark:text-[#f8f9fa] flex items-center gap-2">
                        <span className="material-symbols-outlined text-lg text-[#2e685d]">hub</span>
                        <span>Connected Dispensary Hubs ({REAL_PHARMACIES.length} Real Participating Pharmacies)</span>
                      </h2>
                      <p className="text-xs text-[#717976] dark:text-[#889590] mt-0.5">
                        Authoritative licensed dispensaries registered in your dispatch network
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('pharmacies')}
                      className="text-xs font-bold text-[#2e685d] dark:text-emerald-400 hover:underline cursor-pointer"
                    >
                      View Full Details →
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {REAL_PHARMACIES.map((pharm) => (
                      <motion.div
                        key={pharm.id}
                        whileHover={{ scale: 1.01, y: -2 }}
                        className="p-4 rounded-2xl bg-[#f8fafc] dark:bg-[#212529] border border-[#e0f2eb] dark:border-[#2a3036] flex flex-col justify-between gap-3 shadow-2xs"
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-xl bg-[#e0f2eb] dark:bg-[#1a2e26] text-[#2e685d] dark:text-emerald-300 flex items-center justify-center shrink-0">
                            <span className="material-symbols-outlined text-xl">local_pharmacy</span>
                          </div>
                          <div className="text-xs flex-1">
                            <strong className="text-sm text-[#032f28] dark:text-[#f8f9fa] block">
                              {pharm.name}
                            </strong>
                            <span className="text-[#717976] text-[11px] block mt-0.5 line-clamp-2">
                              {pharm.address}
                            </span>
                            <div className="flex items-center gap-2 mt-1.5">
                              <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                                • {pharm.hours}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Direct Action Links */}
                        <div className="flex items-center justify-between pt-2 border-t border-[#e0f2eb] dark:border-[#30363a] text-xs">
                          <a
                            href={`tel:${pharm.rawPhone}`}
                            className="font-mono font-bold text-[#2e685d] dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-sm">call</span>
                            <span>{pharm.phone}</span>
                          </a>
                          <a
                            href={pharm.mapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] font-bold text-[#032f28] dark:text-[#f8f9fa] hover:text-[#2e685d] flex items-center gap-0.5 cursor-pointer"
                          >
                            <span>Maps</span>
                            <span className="material-symbols-outlined text-xs">open_in_new</span>
                          </a>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>

              </motion.div>
            )}

            {/* ── TAB 2: TERRITORY & HUB LOGISTICS ── */}
            {activeTab === 'territory' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="bg-white dark:bg-[#1a1d21] rounded-3xl p-6 sm:p-7 border border-[#e0f2eb] dark:border-[#2a3036] shadow-sm flex flex-col gap-6"
              >
                <div>
                  <h2 className="text-base font-extrabold text-[#032f28] dark:text-[#f8f9fa] flex items-center gap-2">
                    <span className="material-symbols-outlined text-lg text-[#2e685d]">pin_drop</span>
                    <span>Geographic Operating Territory &amp; Radius Configuration</span>
                  </h2>
                  <p className="text-xs text-[#717976] dark:text-[#889590] mt-1">
                    Orders and prescription reservations outside your configured radial threshold are filtered automatically.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  
                  {/* Operating Hub */}
                  <motion.div
                    whileHover={{ scale: 1.01 }}
                    className="p-5 rounded-2xl bg-[#f8fafc] dark:bg-[#212529] border border-[#e0f2eb] dark:border-[#2a3036] flex flex-col gap-2"
                  >
                    <span className="text-[11px] font-bold text-[#717976] uppercase tracking-wider">Anchor Center Hub</span>
                    <span className="text-lg font-black text-[#032f28] dark:text-[#f8f9fa]">
                      {profile.operatingCity || 'Chengannur, Kerala'}
                    </span>
                    <p className="text-xs text-[#717976]">
                      All distance calculations and pharmacy collection relays reference this anchor location.
                    </p>
                    <button
                      type="button"
                      onClick={handleOpenEditModal}
                      className="mt-2 text-xs font-bold text-[#2e685d] dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer self-start"
                    >
                      <span className="material-symbols-outlined text-sm">my_location</span>
                      <span>Update Anchor City</span>
                    </button>
                  </motion.div>

                  {/* Operating Radius */}
                  <motion.div
                    whileHover={{ scale: 1.01 }}
                    className="p-5 rounded-2xl bg-[#f8fafc] dark:bg-[#212529] border border-[#e0f2eb] dark:border-[#2a3036] flex flex-col gap-2"
                  >
                    <span className="text-[11px] font-bold text-[#717976] uppercase tracking-wider">Max Radial Threshold</span>
                    <span className="text-lg font-black text-[#032f28] dark:text-[#f8f9fa]">
                      {profile.operatingRadiusKm || 15} km Radial Distance
                    </span>
                    <p className="text-xs text-[#717976]">
                      Ensures temperature-sensitive cold-chain transit can be completed within 45 minutes safely.
                    </p>
                    <button
                      type="button"
                      onClick={handleOpenEditModal}
                      className="mt-2 text-xs font-bold text-[#2e685d] dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer self-start"
                    >
                      <span className="material-symbols-outlined text-sm">tune</span>
                      <span>Adjust Radius</span>
                    </button>
                  </motion.div>

                </div>

                {/* Quick Kerala Territory Presets */}
                <div className="pt-4 border-t border-[#e0f2eb] dark:border-[#2a3036]">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#717976] dark:text-[#889590] mb-2.5">
                    Nearby Kerala Hub Presets
                  </h3>
                  <div className="flex flex-wrap items-center gap-2">
                    {KERALA_TOWN_PRESETS.map((town) => (
                      <motion.button
                        key={town}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        type="button"
                        onClick={() => saveProfileData({ ...profile, operatingCity: town, location: town })}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                          profile.operatingCity === town
                            ? 'bg-[#032f28] text-white shadow-xs'
                            : 'bg-[#e0f2eb] text-[#032f28] hover:bg-[#b0ecdd]'
                        }`}
                      >
                        {town.split(',')[0]}
                      </motion.button>
                    ))}
                  </div>
                </div>

              </motion.div>
            )}

            {/* ── TAB 3: SECURITY & VERIFICATION ── */}
            {activeTab === 'security' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="bg-white dark:bg-[#1a1d21] rounded-3xl p-6 sm:p-7 border border-[#e0f2eb] dark:border-[#2a3036] shadow-sm flex flex-col gap-6"
              >
                <div>
                  <h2 className="text-base font-extrabold text-[#032f28] dark:text-[#f8f9fa] flex items-center gap-2">
                    <span className="material-symbols-outlined text-lg text-[#2e685d]">shield</span>
                    <span>Security Credentials, Protocol &amp; Verification State</span>
                  </h2>
                  <p className="text-xs text-[#717976] dark:text-[#889590] mt-1">
                    MediFind AI enforces strict cryptographic PIN verification and role-based access control.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  
                  {/* Account Verification Status */}
                  <motion.div
                    whileHover={{ scale: 1.01 }}
                    className="p-5 rounded-2xl bg-[#f8fafc] dark:bg-[#212529] border border-[#e0f2eb] dark:border-[#2a3036] flex flex-col gap-1.5"
                  >
                    <span className="text-[11px] font-bold text-[#717976] uppercase tracking-wider">Verification Authority</span>
                    <span className={`text-base font-black ${isApproved ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                      {isApproved ? 'Verified & Authorized' : 'Pending Administrator Review'}
                    </span>
                    <p className="text-xs text-[#717976] mt-0.5">
                      {isApproved
                        ? 'Account credentials authenticated against official regulatory standard.'
                        : 'Review in progress. Once verified, live task relays will activate.'}
                    </p>
                  </motion.div>

                  {/* 4-Digit Handover PIN Standard */}
                  <motion.div
                    whileHover={{ scale: 1.01 }}
                    className="p-5 rounded-2xl bg-[#f8fafc] dark:bg-[#212529] border border-[#e0f2eb] dark:border-[#2a3036] flex flex-col gap-1.5"
                  >
                    <span className="text-[11px] font-bold text-[#717976] uppercase tracking-wider">Handover Verification</span>
                    <span className="text-base font-black text-[#032f28] dark:text-[#f8f9fa]">
                      4-Digit OTP / PIN Protocol
                    </span>
                    <p className="text-xs text-[#717976] mt-0.5">
                      Ensures medicines can only be released when the patient's generated PIN matches at doorstep or counter.
                    </p>
                  </motion.div>

                  {/* Session Auth Bearer */}
                  <motion.div
                    whileHover={{ scale: 1.01 }}
                    className="p-5 rounded-2xl bg-[#f8fafc] dark:bg-[#212529] border border-[#e0f2eb] dark:border-[#2a3036] flex flex-col gap-1.5"
                  >
                    <span className="text-[11px] font-bold text-[#717976] uppercase tracking-wider">Session Guard</span>
                    <span className="text-base font-black text-[#032f28] dark:text-[#f8f9fa]">
                      JWT Bearer Authentication
                    </span>
                    <p className="text-xs text-[#717976] mt-0.5">
                      Encrypted token authentication with strict role-based capability boundaries.
                    </p>
                  </motion.div>

                  {/* Portal Role */}
                  <motion.div
                    whileHover={{ scale: 1.01 }}
                    className="p-5 rounded-2xl bg-[#f8fafc] dark:bg-[#212529] border border-[#e0f2eb] dark:border-[#2a3036] flex flex-col gap-1.5"
                  >
                    <span className="text-[11px] font-bold text-[#717976] uppercase tracking-wider">Assigned Role</span>
                    <span className="text-base font-black text-[#2e685d] dark:text-emerald-400">
                      {role} Portal User
                    </span>
                    <p className="text-xs text-[#717976] mt-0.5">
                      Configured for {role.toLowerCase()} operations across the MediFind network.
                    </p>
                  </motion.div>

                </div>

              </motion.div>
            )}

            {/* ── TAB 4: REAL PARTICIPATING PHARMACIES (Max Care & Karuna Medicals) ── */}
            {activeTab === 'pharmacies' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="bg-white dark:bg-[#1a1d21] rounded-3xl p-6 sm:p-7 border border-[#e0f2eb] dark:border-[#2a3036] shadow-sm flex flex-col gap-6"
              >
                <div>
                  <h2 className="text-base font-extrabold text-[#032f28] dark:text-[#f8f9fa] flex items-center gap-2">
                    <span className="material-symbols-outlined text-lg text-[#2e685d]">store</span>
                    <span>Accredited Participating Pharmacy Directory</span>
                  </h2>
                  <p className="text-xs text-[#717976] dark:text-[#889590] mt-1">
                    The MediFind platform operates in direct partnership with these 2 licensed pharmacies in Chengannur:
                  </p>
                </div>

                <div className="flex flex-col gap-4">
                  {REAL_PHARMACIES.map((pharm) => (
                    <motion.div
                      key={pharm.id}
                      whileHover={{ scale: 1.008, y: -2 }}
                      className="p-5 rounded-2xl bg-[#f8fafc] dark:bg-[#212529] border border-[#e0f2eb] dark:border-[#2a3036] flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs"
                    >
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-[#e0f2eb] dark:bg-[#1a2e26] text-[#2e685d] dark:text-emerald-300 flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-2xl">local_pharmacy</span>
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-base font-extrabold text-[#032f28] dark:text-[#f8f9fa]">
                              {pharm.name}
                            </h3>
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 text-[10px] font-extrabold border border-emerald-300 dark:border-emerald-800">
                              {pharm.tag}
                            </span>
                          </div>
                          <p className="text-xs text-[#717976] dark:text-[#a0aba6] mt-1 max-w-xl">
                            {pharm.address}
                          </p>
                          <div className="flex items-center gap-4 mt-2 text-xs">
                            <span className="text-[#414846] dark:text-[#c0c8c5]">
                              <strong>Hours:</strong> {pharm.hours}
                            </span>
                            <span className="text-[#414846] dark:text-[#c0c8c5]">
                              <strong>License:</strong> {pharm.license}
                            </span>
                          </div>
                          
                          {/* Features Pills */}
                          <div className="flex flex-wrap gap-1.5 mt-2.5">
                            {pharm.features.map((feat, fIdx) => (
                              <span
                                key={fIdx}
                                className="px-2 py-0.5 rounded-md bg-white dark:bg-[#14181a] border border-[#e0f2eb] dark:border-[#30363a] text-[10.5px] font-semibold text-[#032f28] dark:text-[#e0f2eb]"
                              >
                                {feat}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Interactive Buttons */}
                      <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-[#e0f2eb] dark:border-[#30363a]">
                        <motion.a
                          whileHover={{ scale: 1.04 }}
                          whileTap={{ scale: 0.96 }}
                          href={`tel:${pharm.rawPhone}`}
                          className="px-4 py-2 rounded-xl bg-[#032f28] hover:bg-[#1a4b41] text-white text-xs font-extrabold shadow-sm flex items-center gap-1.5 cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-sm">call</span>
                          <span>Call Dispensary</span>
                        </motion.a>

                        <motion.button
                          whileHover={{ scale: 1.04 }}
                          whileTap={{ scale: 0.96 }}
                          type="button"
                          onClick={() => copyToClipboard(pharm.address, pharm.id, 'Pharmacy Address')}
                          className="px-3.5 py-1.5 rounded-xl bg-[#e0f2eb] hover:bg-[#b0ecdd] text-[#032f28] text-xs font-bold border border-[#2e685d]/30 flex items-center gap-1 cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-sm">
                            {copiedKey === pharm.id ? 'done' : 'content_copy'}
                          </span>
                          <span>{copiedKey === pharm.id ? 'Copied' : 'Copy Address'}</span>
                        </motion.button>

                        <motion.a
                          whileHover={{ scale: 1.04 }}
                          whileTap={{ scale: 0.96 }}
                          href={pharm.mapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] font-bold text-[#2e685d] dark:text-emerald-400 hover:underline flex items-center gap-0.5 cursor-pointer pt-0.5"
                        >
                          <span>Open in Google Maps</span>
                          <span className="material-symbols-outlined text-xs">open_in_new</span>
                        </motion.a>
                      </div>
                    </motion.div>
                  ))}
                </div>

              </motion.div>
            )}

          </div>
        </div>
      </div>

      {/* ── 3. EDIT PROFILE POPUP MODAL (Clean, Focused, Separated) ── */}
      <AnimatePresence>
        {isEditModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 15 }}
              transition={{ type: 'spring', stiffness: 450, damping: 30 }}
              className="bg-white dark:bg-[#1e2226] rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 sm:p-8 border border-[#e0f2eb] dark:border-[#3d4349] shadow-2xl flex flex-col gap-6"
            >
              
              <div className="flex items-center justify-between pb-3 border-b border-[#e0f2eb] dark:border-[#30363a]">
                <div>
                  <h3 className="text-xl font-black text-[#032f28] dark:text-[#f8f9fa]">
                    Edit Profile &amp; Operational Details
                  </h3>
                  <p className="text-xs text-[#717976] mt-0.5">
                    Update your contact info, location territory, and operational bio
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="w-9 h-9 rounded-full bg-[#f8fafc] dark:bg-[#2c3034] text-[#414846] dark:text-[#c0c8c5] flex items-center justify-center hover:bg-[#e0f2eb] cursor-pointer"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>

              <form onSubmit={handleSaveEditModal} className="flex flex-col gap-4">
                
                {/* Photo Selector */}
                <div>
                  <label className="block text-xs font-bold text-[#032f28] dark:text-[#e0f2eb] mb-2">
                    Profile Avatar Picture
                  </label>
                  <div className="flex items-center gap-3">
                    <img
                      src={editForm.avatarUrl}
                      alt="Selected Avatar"
                      className="w-14 h-14 rounded-full object-cover border-2 border-[#2e685d] shrink-0"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      {PRESET_AVATARS.map(av => (
                        <button
                          key={av.id}
                          type="button"
                          onClick={() => setEditForm(prev => ({ ...prev, avatarUrl: av.url }))}
                          className={`w-9 h-9 rounded-full overflow-hidden border-2 cursor-pointer transition-all ${
                            editForm.avatarUrl === av.url ? 'border-[#032f28] scale-110 shadow-md' : 'border-transparent opacity-70 hover:opacity-100'
                          }`}
                        >
                          <img src={av.url} alt={av.label} className="w-full h-full object-cover" />
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => handleOpenMedia('avatar')}
                        className="px-3 py-1.5 rounded-full bg-[#e0f2eb] text-[#032f28] text-xs font-bold hover:bg-[#b0ecdd] cursor-pointer"
                      >
                        Custom Photo
                      </button>
                    </div>
                  </div>
                </div>

                {/* Full Display Name */}
                <div>
                  <label className="block text-xs font-bold text-[#032f28] dark:text-[#e0f2eb] mb-1">
                    Full Display Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={editForm.name}
                    onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#c0c8c5] dark:border-[#3d4349] bg-white dark:bg-[#14181a] text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#2e685d]"
                    placeholder="Name"
                  />
                </div>

                {/* Contact Phone */}
                <div>
                  <label className="block text-xs font-bold text-[#032f28] dark:text-[#e0f2eb] mb-1">
                    Contact Phone Number *
                  </label>
                  <input
                    type="tel"
                    required
                    value={editForm.phone}
                    onChange={e => setEditForm(prev => ({ ...prev, phone: e.target.value }))}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#c0c8c5] dark:border-[#3d4349] bg-white dark:bg-[#14181a] text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#2e685d]"
                    placeholder="Phone"
                  />
                </div>

                {/* Operating City / Territory with Presets */}
                <div>
                  <label className="block text-xs font-bold text-[#032f28] dark:text-[#e0f2eb] mb-1">
                    Operating City / Dispatch Hub Area
                  </label>
                  <input
                    type="text"
                    value={editForm.operatingCity || editForm.location || ''}
                    onChange={e => setEditForm(prev => ({
                      ...prev,
                      operatingCity: e.target.value,
                      location: e.target.value
                    }))}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#c0c8c5] dark:border-[#3d4349] bg-white dark:bg-[#14181a] text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#2e685d]"
                    placeholder="Town"
                  />
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <span className="text-[11px] text-[#717976] font-semibold">Quick Presets:</span>
                    {KERALA_TOWN_PRESETS.map(town => (
                      <button
                        key={town}
                        type="button"
                        onClick={() => setEditForm(prev => ({
                          ...prev,
                          operatingCity: town,
                          location: town
                        }))}
                        className="px-2.5 py-0.5 rounded-full bg-[#e0f2eb] text-[#032f28] text-[10.5px] font-bold hover:bg-[#b0ecdd] cursor-pointer"
                      >
                        {town.split(',')[0]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Operating Radius & Vehicle (for Assistant) */}
                {role === 'ASSISTANT' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-[#032f28] dark:text-[#e0f2eb] mb-1">
                        Operating Radius ({editForm.operatingRadiusKm || 15} km)
                      </label>
                      <input
                        type="range"
                        min="3"
                        max="40"
                        value={editForm.operatingRadiusKm || 15}
                        onChange={e => setEditForm(prev => ({ ...prev, operatingRadiusKm: parseInt(e.target.value, 10) }))}
                        className="w-full accent-[#2e685d]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#032f28] dark:text-[#e0f2eb] mb-1">
                        Vehicle Type
                      </label>
                      <select
                        value={editForm.vehicleType || 'Electric Two-Wheeler (EV Scooter)'}
                        onChange={e => setEditForm(prev => ({ ...prev, vehicleType: e.target.value }))}
                        className="w-full px-3 py-2 rounded-xl border border-[#c0c8c5] dark:border-[#3d4349] bg-white dark:bg-[#14181a] text-xs font-semibold"
                      >
                        <option value="Electric Two-Wheeler (EV Scooter)">Electric Two-Wheeler (EV Scooter)</option>
                        <option value="Motorcycle / Scooter">Motorcycle / Scooter</option>
                        <option value="Bicycle">Bicycle (Eco Route)</option>
                        <option value="Four-Wheeler / Car">Four-Wheeler / Car</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Professional Bio */}
                <div>
                  <label className="block text-xs font-bold text-[#032f28] dark:text-[#e0f2eb] mb-1">
                    About Me / Operational Bio
                  </label>
                  <textarea
                    rows={3}
                    value={editForm.bio || ''}
                    onChange={e => setEditForm(prev => ({ ...prev, bio: e.target.value }))}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#c0c8c5] dark:border-[#3d4349] bg-white dark:bg-[#14181a] text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#2e685d]"
                    placeholder="Bio"
                  />
                </div>

                {/* Action Buttons */}
                <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#e0f2eb] dark:border-[#30363a]">
                  <button
                    type="button"
                    onClick={() => setIsEditModalOpen(false)}
                    className="px-5 py-2.5 rounded-full text-xs font-bold text-[#414846] dark:text-[#a0aba6] hover:bg-[#e0f2eb] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 rounded-full bg-[#032f28] hover:bg-[#1a4b41] text-white text-xs font-extrabold shadow-md cursor-pointer"
                  >
                    Save Changes
                  </button>
                </div>

              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── 4. CUSTOM PHOTO / BANNER UPLOAD MODAL ── */}
      <AnimatePresence>
        {isMediaModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ type: 'spring', stiffness: 450, damping: 30 }}
              className="bg-white dark:bg-[#1e2226] rounded-3xl max-w-lg w-full p-6 border border-[#e0f2eb] dark:border-[#3d4349] shadow-2xl flex flex-col gap-4"
            >
              <div className="flex items-center justify-between pb-2 border-b border-[#e0f2eb] dark:border-[#30363a]">
                <h3 className="text-base font-black text-[#032f28] dark:text-[#f8f9fa]">
                  {mediaType === 'avatar' ? 'Select Profile Picture' : 'Select Cover Banner'}
                </h3>
                <button
                  type="button"
                  onClick={() => setIsMediaModalOpen(false)}
                  className="w-8 h-8 rounded-full bg-[#f8fafc] text-[#414846] flex items-center justify-center cursor-pointer hover:bg-[#e0f2eb]"
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </div>

              <div>
                <span className="text-xs font-bold text-[#717976] block mb-2">Preset Options:</span>
                <div className="grid grid-cols-3 gap-3">
                  {(mediaType === 'avatar' ? PRESET_AVATARS : PRESET_BANNERS).map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectPresetMedia(item.url)}
                      className="group relative rounded-2xl overflow-hidden border-2 border-transparent hover:border-[#2e685d] aspect-video cursor-pointer"
                    >
                      <img src={item.url} alt={item.label} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                      <span className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] font-bold p-1 truncate block text-center">
                        {item.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-[#e0f2eb] dark:border-[#30363a] flex items-center justify-between">
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 rounded-full bg-[#e0f2eb] text-[#032f28] text-xs font-extrabold hover:bg-[#b0ecdd] cursor-pointer inline-flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-sm">upload</span>
                  <span>Upload From Device</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsMediaModalOpen(false)}
                  className="px-4 py-2 rounded-full text-xs font-bold text-[#717976] cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
