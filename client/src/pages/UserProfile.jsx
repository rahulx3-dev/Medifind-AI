import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import ConfirmationDialog from '../components/ConfirmationDialog';

// Default Avatars
const PRESET_AVATARS = [
  {
    id: 'doc-maya',
    label: 'Clinician / Specialist',
    url: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&q=80&w=400'
  },
  {
    id: 'dr-alex',
    label: 'Medical Director',
    url: 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?auto=format&fit=crop&q=80&w=400'
  },
  {
    id: 'patient-priya',
    label: 'Community Patient',
    url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400'
  },
  {
    id: 'assistant-rahul',
    label: 'Field Assistant',
    url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=400'
  },
  {
    id: 'sage-emblem',
    label: 'Clinical Shield',
    url: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&q=80&w=400'
  }
];

// Default Banners
const PRESET_BANNERS = [
  {
    id: 'alpine',
    label: 'Alpine Panorama',
    url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&q=80&w=1600'
  },
  {
    id: 'clinical-gradient',
    label: 'Clinical Sage Gradient',
    url: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?auto=format&fit=crop&q=80&w=1600'
  },
  {
    id: 'modern-facility',
    label: 'Healthcare Campus',
    url: 'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&q=80&w=1600'
  },
  {
    id: 'architecture',
    label: 'Clean Architecture',
    url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&q=80&w=1600'
  }
];

export default function UserProfile({ role: propRole, onNavigate }) {
  const { user, setUser } = useAuth();
  const role = propRole || user?.role || 'PATIENT';
  const storageKey = `medifind_user_profile_${user?.id || role}`;

  // Default initial profile based on role
  const getDefaultProfile = () => {
    if (role === 'PATIENT') {
      return {
        name: user?.name || 'Rohan Sharma',
        email: user?.email || 'patient@medifind.com',
        phone: user?.phone || '+91 98765 43210',
        address: '42 MG Road, Chengannur, Kerala 689121',
        emergencyContact: 'Anita Sharma (+91 98765 43211)',
        bloodGroup: 'O+',
        allergies: 'Penicillin (mild rash), Dust mites',
        healthId: 'ABHA-KL-8821-4921',
        consultingDoctor: 'Not specified',
        avatarUrl: PRESET_AVATARS[2].url,
        bannerUrl: PRESET_BANNERS[0].url,
        avatarScale: 1,
        avatarPosition: 'center',
        bannerPosition: 'center',
        bio: 'Prescription holder registered with MediFind AI for verified dispensary collection and emergency medicine access.'
      };
    }
    if (role === 'PHARMACIST') {
      return {
        name: user?.name || 'Pharmacist Manager',
        email: user?.email || 'pharmacist@maxcare.example.com',
        phone: user?.phone || '+91 98471 23456',
        address: '20/375, Govt. Hospital Junction, Chengannur, Kerala 689121',
        pharmacyName: 'Max Care Pharmacy',
        licenseNumber: 'KL-AL-2024-001',
        qualification: 'B.Pharm, Registered Pharmacist',
        experienceYears: '10+ Years',
        workingHours: '9:30 AM – 8:00 PM (Mon – Sat)',
        avatarUrl: PRESET_AVATARS[0].url,
        bannerUrl: PRESET_BANNERS[1].url,
        avatarScale: 1,
        avatarPosition: 'center',
        bannerPosition: 'center',
        bio: 'Supervising pharmacist coordinating patient intake, counter PIN authentication, and cold-chain inventory management.'
      };
    }
    if (role === 'ASSISTANT') {
      return {
        name: user?.name || 'Kavita Patel',
        email: user?.email || 'assistant@medifind.com',
        phone: user?.phone || '+91 98765 11223',
        handle: '@kavita_access',
        address: 'Hub Station 2, Station Road, Chengannur, Kerala 689121',
        vehicleType: 'Electric Two-Wheeler (EV Scooter)',
        vehicleNumber: 'KL-30-E-4421',
        serviceTerritory: 'Chengannur / Alappuzha Hubs',
        boxId: 'CCB-9021 (2°C – 8°C Monitored)',
        emergencyContact: 'Central Field Dispatch (+91 479 245 9999)',
        avatarUrl: PRESET_AVATARS[3].url,
        bannerUrl: PRESET_BANNERS[0].url,
        avatarScale: 1,
        avatarPosition: 'center',
        bannerPosition: 'center',
        bio: 'Certified Medicine Access Assistant providing prompt last-mile collection and secure recipient PIN handovers.'
      };
    }
    // ADMIN
    return {
      name: user?.name || 'MediFind System Admin',
      email: user?.email || 'admin@medifind.com',
      phone: user?.phone || '+91 479 245 0001',
      department: 'Operations & Infrastructure Security',
      region: 'Chengannur / Alappuzha Command Hub, Kerala',
      emergencyCode: 'SEC-ROOT-L3-KERALA',
      clearanceLevel: 'Superuser Level 3',
      avatarUrl: PRESET_AVATARS[1].url,
      bannerUrl: PRESET_BANNERS[0].url,
      avatarScale: 1,
      avatarPosition: 'center',
      bannerPosition: 'center',
      bio: 'Executive administrator overseeing clinical data safety, role RBAC enforcement, and participating dispensary network verification.'
    };
  };

  // State management
  const [profile, setProfile] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        return { ...getDefaultProfile(), ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn('Failed to load profile from storage:', e);
    }
    return getDefaultProfile();
  });

  const [activeSubTab, setActiveSubTab] = useState('overview');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isMediaModalOpen, setIsMediaModalOpen] = useState(false);
  const [mediaModalType, setMediaModalType] = useState('avatar'); // 'avatar' | 'banner'

  // Draft profile for editing modal
  const [editDraft, setEditDraft] = useState({ ...profile });

  // Draft media adjustments
  const [mediaDraft, setMediaDraft] = useState({
    url: profile.avatarUrl,
    scale: profile.avatarScale || 1,
    position: profile.avatarPosition || 'center'
  });

  const [feedback, setFeedback] = useState({ show: false, message: '', type: 'success' });
  const fileInputRef = useRef(null);

  // Sync to localStorage and auth state
  const saveProfile = (updated) => {
    setProfile(updated);
    try {
      localStorage.setItem(storageKey, JSON.stringify(updated));
      if (setUser && user) {
        setUser(prev => ({
          ...prev,
          name: updated.name,
          email: updated.email,
          phone: updated.phone
        }));
      }
      window.dispatchEvent(new Event('medifind_profile_updated'));
    } catch (e) {
      console.error('Failed to save profile:', e);
    }
    showToast('Profile updated successfully!', 'success');
  };

  const showToast = (message, type = 'success') => {
    setFeedback({ show: true, message, type });
    setTimeout(() => setFeedback({ show: false, message: '', type: 'success' }), 3500);
  };

  const handleOpenEdit = () => {
    setEditDraft({ ...profile });
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = (e) => {
    e.preventDefault();
    saveProfile(editDraft);
    setIsEditModalOpen(false);
  };

  const handleOpenMediaModal = (type) => {
    setMediaModalType(type);
    if (type === 'avatar') {
      setMediaDraft({
        url: profile.avatarUrl,
        scale: profile.avatarScale || 1,
        position: profile.avatarPosition || 'center'
      });
    } else {
      setMediaDraft({
        url: profile.bannerUrl,
        scale: profile.bannerScale || 1,
        position: profile.bannerPosition || 'center'
      });
    }
    setIsMediaModalOpen(true);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        showToast('Image size should be less than 5MB', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        setMediaDraft(prev => ({ ...prev, url: event.target.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveMedia = () => {
    if (mediaModalType === 'avatar') {
      saveProfile({
        ...profile,
        avatarUrl: mediaDraft.url,
        avatarScale: mediaDraft.scale,
        avatarPosition: mediaDraft.position
      });
    } else {
      saveProfile({
        ...profile,
        bannerUrl: mediaDraft.url,
        bannerScale: mediaDraft.scale,
        bannerPosition: mediaDraft.position
      });
    }
    setIsMediaModalOpen(false);
  };

  // Distinct Role Badges with Unique Glyphs
  const renderRoleBadge = () => {
    if (role === 'PHARMACIST') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-gradient-to-r from-[#b0ecdd] to-[#cbf4ea] text-[#00201b] border border-[#2e685d]/40 text-xs font-bold tracking-wide shadow-xs">
          <span className="material-symbols-outlined text-[17px] text-[#1e453e]">prescriptions</span>
          <span>LICENSED PHARMACIST</span>
          <span className="material-symbols-outlined text-[13px] text-[#2e685d]">verified</span>
        </span>
      );
    }
    if (role === 'ASSISTANT') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-gradient-to-r from-[#fef3c7] to-[#fde68a] text-[#78350f] border border-[#d97706]/40 text-xs font-bold tracking-wide shadow-xs">
          <span className="material-symbols-outlined text-[17px] text-[#b45309]">electric_moped</span>
          <span>MEDICINE ACCESS ASSISTANT</span>
          <span className="material-symbols-outlined text-[13px] text-[#b45309]">bolt</span>
        </span>
      );
    }
    if (role === 'ADMIN') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-gradient-to-r from-[#032f28] to-[#0f4d42] text-white border border-[#b0ecdd]/50 text-xs font-bold tracking-wide shadow-sm">
          <span className="material-symbols-outlined text-[17px] text-[#a6cfc5]">admin_panel_settings</span>
          <span>SYSTEM ADMINISTRATOR</span>
          <span className="material-symbols-outlined text-[13px] text-[#f59e0b]">stars</span>
        </span>
      );
    }
    // Patient
    return (
      <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-gradient-to-r from-[#e0f2eb] to-[#cbece2] text-[#032f28] border border-[#97d2c4] text-xs font-bold tracking-wide shadow-xs">
        <span className="material-symbols-outlined text-[17px] text-[#2e685d]">health_and_safety</span>
        <span>VERIFIED PATIENT</span>
        <span className="material-symbols-outlined text-[13px] text-[#2e685d]">verified</span>
      </span>
    );
  };

  return (
    <div className="w-full min-h-[calc(100vh-140px)] bg-surface text-on-surface py-6 px-4 sm:px-6 lg:px-8">
      {/* Toast Notification */}
      {feedback.show && (
        <div
          className={`fixed top-20 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-lg border text-xs font-semibold animate-in fade-in slide-in-from-top-4 duration-200 ${
            feedback.type === 'error'
              ? 'bg-[#ffdad6] text-[#ba1a1a] border-[#ba1a1a]/30'
              : 'bg-[#b0ecdd] text-[#00201b] border-[#2e685d]/30'
          }`}
        >
          <span className="material-symbols-outlined text-base">
            {feedback.type === 'error' ? 'error' : 'check_circle'}
          </span>
          <span>{feedback.message}</span>
        </div>
      )}

      <div className="max-w-6xl mx-auto flex flex-col gap-6">

        {/* ========================================================================= */}
        {/* ROLE 1: PATIENT PROFILE — INSPIRED BY REFERENCE IMAGE 3 (Clean Card)     */}
        {/* ========================================================================= */}
        {role === 'PATIENT' && (
          <div className="flex flex-col gap-6">
            {/* Top Minimalist Header */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#2e685d]"></span>
                <h1 className="text-xl sm:text-2xl font-bold text-primary tracking-tight">Patient Profile</h1>
              </div>

              {/* Sub-navigation Pills */}
              <div className="flex items-center gap-1.5 bg-surface-container-low p-1 rounded-full overflow-x-auto">
                <button
                  onClick={() => setActiveSubTab('overview')}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                    activeSubTab === 'overview'
                      ? 'bg-primary text-white shadow-xs'
                      : 'text-on-surface-variant hover:text-primary'
                  }`}
                >
                  Personal Information
                </button>
                <button
                  onClick={() => setActiveSubTab('documents')}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                    activeSubTab === 'documents'
                      ? 'bg-primary text-white shadow-xs'
                      : 'text-on-surface-variant hover:text-primary'
                  }`}
                >
                  Health Pass &amp; Records
                </button>
                <button
                  onClick={() => setActiveSubTab('support')}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all ${
                    activeSubTab === 'support'
                      ? 'bg-primary text-white shadow-xs'
                      : 'text-on-surface-variant hover:text-primary'
                  }`}
                >
                  Help &amp; Support
                </button>
              </div>
            </div>

            {/* Main Image 3-Style Profile Showcase Card */}
            {activeSubTab === 'overview' && (
              <div className="bg-surface-container-lowest rounded-3xl p-6 sm:p-10 border border-outline-variant/30 shadow-sm flex flex-col lg:flex-row items-start gap-8 lg:gap-12 relative overflow-hidden">
                {/* Left Side: Avatar Box & Document Actions */}
                <div className="flex flex-col items-center sm:items-start gap-4 shrink-0 w-full sm:w-auto">
                  <div className="relative group w-48 h-48 sm:w-56 sm:h-56 rounded-3xl bg-surface-container-low overflow-hidden border border-outline-variant/40 shadow-inner flex items-center justify-center">
                    <img
                      src={profile.avatarUrl}
                      alt={profile.name}
                      style={{
                        transform: `scale(${profile.avatarScale || 1})`,
                        objectPosition: profile.avatarPosition || 'center'
                      }}
                      className="w-full h-full object-cover transition-transform"
                    />

                    {/* Camera Change Button (Matching Ref Image 3) */}
                    <button
                      onClick={() => handleOpenMediaModal('avatar')}
                      className="absolute top-3 left-3 w-9 h-9 rounded-xl bg-white/90 backdrop-blur-sm text-primary flex items-center justify-center shadow-md hover:bg-white transition-all border border-outline-variant/20"
                      title="Update avatar"
                      aria-label="Update avatar"
                    >
                      <span className="material-symbols-outlined text-lg">photo_camera</span>
                    </button>
                  </div>

                  {/* Document & Logo Badges (from Ref Image 3) */}
                  <div className="grid grid-cols-2 gap-2.5 w-full">
                    <button
                      onClick={() => onNavigate ? onNavigate('prescription') : setActiveSubTab('documents')}
                      className="p-3 rounded-2xl border-2 border-dashed border-[#a6cfc5] bg-surface-container-low/40 hover:bg-[#e0f2eb] flex flex-col items-center justify-center text-center gap-1 transition-all cursor-pointer group"
                    >
                      <span className="material-symbols-outlined text-secondary text-xl group-hover:scale-110 transition-transform">
                        description
                      </span>
                      <span className="text-[10px] font-bold text-primary tracking-wider uppercase">
                        Prescriptions
                      </span>
                    </button>

                    <button
                      onClick={() => onNavigate ? onNavigate('orders') : setActiveSubTab('documents')}
                      className="p-3 rounded-2xl border-2 border-dashed border-[#a6cfc5] bg-surface-container-low/40 hover:bg-[#e0f2eb] flex flex-col items-center justify-center text-center gap-1 transition-all cursor-pointer group"
                    >
                      <span className="material-symbols-outlined text-secondary text-xl group-hover:scale-110 transition-transform">
                        receipt_long
                      </span>
                      <span className="text-[10px] font-bold text-primary tracking-wider uppercase">
                        My Orders
                      </span>
                    </button>
                  </div>
                </div>

                {/* Right Side: Key Patient Info Fields */}
                <div className="flex-1 flex flex-col justify-between w-full h-full">
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        {renderRoleBadge()}
                        <h2 className="text-2xl sm:text-3xl font-bold text-primary mt-2 tracking-tight">
                          {profile.name}
                        </h2>
                        <span className="text-xs text-on-surface-variant font-mono">
                          ID: {profile.healthId || 'ABHA-KL-8821-4921'}
                        </span>
                      </div>

                      <button
                        onClick={handleOpenEdit}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-primary/20 text-primary hover:bg-primary hover:text-white font-bold text-xs transition-all shadow-xs"
                      >
                        <span className="material-symbols-outlined text-base">edit</span>
                        <span>EDIT PROFILE</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                      <div className="p-3.5 rounded-2xl bg-surface-container-low/50 border border-outline-variant/20 flex flex-col">
                        <span className="text-[11px] font-semibold text-on-surface-variant">Registered Email</span>
                        <span className="text-sm font-bold text-primary mt-0.5">{profile.email}</span>
                      </div>

                      <div className="p-3.5 rounded-2xl bg-surface-container-low/50 border border-outline-variant/20 flex flex-col">
                        <span className="text-[11px] font-semibold text-on-surface-variant">Mobile Contact</span>
                        <span className="text-sm font-bold text-primary mt-0.5">{profile.phone}</span>
                      </div>

                      <div className="p-3.5 rounded-2xl bg-surface-container-low/50 border border-outline-variant/20 flex flex-col md:col-span-2">
                        <span className="text-[11px] font-semibold text-on-surface-variant">Delivery &amp; Residential Address</span>
                        <span className="text-sm font-medium text-primary mt-0.5">{profile.address}</span>
                      </div>

                      <div className="p-3.5 rounded-2xl bg-surface-container-low/50 border border-outline-variant/20 flex flex-col">
                        <span className="text-[11px] font-semibold text-on-surface-variant">Emergency Contact</span>
                        <span className="text-sm font-bold text-primary mt-0.5">{profile.emergencyContact}</span>
                      </div>

                      <div className="p-3.5 rounded-2xl bg-surface-container-low/50 border border-outline-variant/20 flex flex-col">
                        <span className="text-[11px] font-semibold text-on-surface-variant">Blood Group &amp; Allergies</span>
                        <span className="text-sm font-bold text-primary mt-0.5">
                          {profile.bloodGroup} • {profile.allergies || 'No known drug allergies'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Bio statement */}
                  <div className="mt-5 p-4 rounded-2xl bg-surface-container-lowest border border-outline-variant/30 text-xs text-on-surface-variant flex items-start gap-2.5">
                    <span className="material-symbols-outlined text-secondary text-lg shrink-0 mt-0.5">info</span>
                    <span>{profile.bio}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Documents Sub-Tab */}
            {activeSubTab === 'documents' && (
              <div className="bg-surface-container-lowest rounded-3xl p-6 sm:p-8 border border-outline-variant/30 shadow-sm flex flex-col gap-5">
                <h3 className="text-lg font-bold text-primary">Patient Health Pass &amp; Records</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-2xl bg-surface-container-low flex flex-col justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-secondary text-2xl">qr_code_2</span>
                      <span className="text-sm font-bold text-primary">Digital Health Pass</span>
                    </div>
                    <p className="text-xs text-on-surface-variant">
                      Cryptographically verified token for dispensary counter authentication.
                    </p>
                    <span className="text-[11px] font-mono text-secondary font-semibold">TOKEN: #MF-PAT-9081</span>
                  </div>

                  <div className="p-4 rounded-2xl bg-surface-container-low flex flex-col justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-secondary text-2xl">clinical_notes</span>
                      <span className="text-sm font-bold text-primary">Consulting Physician</span>
                    </div>
                    <p className="text-xs text-on-surface-variant">
                      {profile.consultingDoctor || 'Not specified'}
                    </p>
                    <span className="text-[11px] text-primary font-semibold">Physician Consultation Record</span>
                  </div>

                  <div className="p-4 rounded-2xl bg-surface-container-low flex flex-col justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-secondary text-2xl">verified_user</span>
                      <span className="text-sm font-bold text-primary">Privacy Level</span>
                    </div>
                    <p className="text-xs text-on-surface-variant">
                      Role-isolated access active. Assistants receive address without prescription image.
                    </p>
                    <span className="text-[11px] text-secondary font-bold">Standard Patient Insulation</span>
                  </div>
                </div>
              </div>
            )}

            {/* Help & Support Sub-Tab */}
            {activeSubTab === 'support' && (
              <div className="bg-surface-container-lowest rounded-3xl p-6 sm:p-8 border border-outline-variant/30 shadow-sm flex flex-col gap-6">
                <div>
                  <h3 className="text-lg font-bold text-primary">Patient Help &amp; Clinical Support</h3>
                  <p className="text-xs text-on-surface-variant mt-1">
                    Direct access to emergency hotlines, dispensary assistance, and platform guidance.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="p-4 rounded-2xl bg-[#ffdad6]/40 border border-[#ba1a1a]/20 flex flex-col gap-2">
                    <span className="text-xs font-bold text-[#ba1a1a]">National Emergency</span>
                    <span className="text-2xl font-black text-primary font-mono">112</span>
                    <span className="text-[11px] text-on-surface-variant">Police, Fire &amp; Rescue</span>
                  </div>

                  <div className="p-4 rounded-2xl bg-[#ffdad6]/40 border border-[#ba1a1a]/20 flex flex-col gap-2">
                    <span className="text-xs font-bold text-[#ba1a1a]">Ambulance Service</span>
                    <span className="text-2xl font-black text-primary font-mono">108</span>
                    <span className="text-[11px] text-on-surface-variant">24/7 Trauma Transport</span>
                  </div>

                  <div className="p-4 rounded-2xl bg-secondary-container/40 border border-secondary/20 flex flex-col gap-2">
                    <span className="text-xs font-bold text-secondary">Kerala Health Helpline</span>
                    <span className="text-2xl font-black text-primary font-mono">1056</span>
                    <span className="text-[11px] text-on-surface-variant">Disha Health Advisory</span>
                  </div>

                  <div className="p-4 rounded-2xl bg-surface-container-low flex flex-col gap-2">
                    <span className="text-xs font-bold text-primary">MediFind Support</span>
                    <span className="text-base font-bold text-primary font-mono mt-1">support@medifind.care</span>
                    <span className="text-[11px] text-on-surface-variant">General Platform Queries</span>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-surface-container-low text-xs text-on-surface-variant flex flex-col gap-2">
                  <span className="font-bold text-primary">Frequently Asked Questions:</span>
                  <p>• <strong>How is my prescription protected?</strong> Extracted prescription formulations require explicit verification before dispensary routing.</p>
                  <p>• <strong>Who sees my delivery PIN?</strong> Only you and your fulfilling dispensary or delivery assistant at the point of physical handover.</p>
                </div>
              </div>
            )}
          </div>
        )}


        {/* ========================================================================= */}
        {/* ROLE 2: ADMIN PROFILE — INSPIRED BY REFERENCE IMAGE 2 (Wide Scenic Banner) */}
        {/* ========================================================================= */}
        {role === 'ADMIN' && (
          <div className="flex flex-col gap-6">
            {/* Wide Banner Image with Edit Action */}
            <div className="relative w-full h-48 sm:h-64 rounded-3xl overflow-hidden shadow-sm border border-outline-variant/30 group">
              <img
                src={profile.bannerUrl}
                alt="Admin Banner"
                style={{
                  transform: `scale(${profile.bannerScale || 1})`,
                  objectPosition: profile.bannerPosition || 'center'
                }}
                className="w-full h-full object-cover transition-transform"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent"></div>

              <button
                onClick={() => handleOpenMediaModal('banner')}
                className="absolute top-4 right-4 px-3.5 py-1.5 rounded-full bg-white/90 backdrop-blur-sm text-primary hover:bg-white text-xs font-bold shadow-md transition-all flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-sm">panorama</span>
                <span>Change Banner</span>
              </button>
            </div>

            {/* Overlapping Profile Header Box (Matching Ref Image 2) */}
            <div className="bg-surface-container-lowest rounded-3xl p-6 sm:p-8 border border-outline-variant/30 shadow-sm relative -mt-16 sm:-mt-20 z-10 mx-2 sm:mx-6 flex flex-col md:flex-row items-center md:items-start gap-6">
              {/* Circular Overlapping Avatar with Camera */}
              <div className="relative shrink-0 -mt-12 sm:-mt-16">
                <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-full overflow-hidden border-4 border-white shadow-xl bg-surface-container-low">
                  <img
                    src={profile.avatarUrl}
                    alt={profile.name}
                    style={{
                      transform: `scale(${profile.avatarScale || 1})`,
                      objectPosition: profile.avatarPosition || 'center'
                    }}
                    className="w-full h-full object-cover"
                  />
                </div>
                <button
                  onClick={() => handleOpenMediaModal('avatar')}
                  className="absolute bottom-1 right-1 w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center shadow-md hover:bg-primary-container transition-all border-2 border-white"
                  title="Change avatar"
                  aria-label="Change avatar"
                >
                  <span className="material-symbols-outlined text-base">photo_camera</span>
                </button>
              </div>

              {/* Executive Metadata */}
              <div className="flex-1 flex flex-col items-center md:items-start text-center md:text-left">
                <div className="flex flex-wrap items-center gap-2 justify-center md:justify-start">
                  {renderRoleBadge()}
                  <span className="text-xs font-mono font-bold text-secondary bg-surface-container px-2.5 py-0.5 rounded-full">
                    {profile.clearanceLevel || 'Superuser Level 3'}
                  </span>
                </div>

                <h2 className="text-2xl sm:text-3xl font-bold text-primary mt-1 tracking-tight">
                  {profile.name}
                </h2>
                <p className="text-xs sm:text-sm text-on-surface-variant font-medium">
                  {profile.department || 'Operations & Infrastructure Security'}
                </p>

                <div className="flex flex-wrap items-center gap-3 sm:gap-4 mt-2 text-xs text-on-surface-variant justify-center md:justify-start">
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm text-secondary">location_on</span>
                    {profile.region || 'Chengannur / Alappuzha Hub, Kerala'}
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1 font-mono">
                    <span className="material-symbols-outlined text-sm text-secondary">mail</span>
                    {profile.email}
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1 font-mono">
                    <span className="material-symbols-outlined text-sm text-secondary">call</span>
                    {profile.phone}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2.5 shrink-0">
                <button
                  onClick={handleOpenEdit}
                  className="px-4 py-2 rounded-full bg-primary hover:bg-primary-container text-white text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-base">tune</span>
                  <span>Edit Profile</span>
                </button>
              </div>
            </div>

            {/* Lower Showcase Cards (Matching Ref Image 2: Intro/Matrix/Stats) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-6 rounded-3xl bg-surface-container-lowest border border-outline-variant/30 shadow-sm flex flex-col justify-between gap-4">
                <div className="flex items-center gap-2 text-primary font-bold">
                  <span className="material-symbols-outlined text-secondary">shield</span>
                  <span>Security &amp; RBAC Matrix</span>
                </div>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  Server-authoritative role isolation enforced. Admin controls verified network approvals and emergency task oversight.
                </p>
                <div className="pt-2 border-t border-surface-container flex items-center justify-between text-xs font-mono font-bold text-secondary">
                  <span>ROOT CLEARANCE</span>
                  <span>ACTIVE</span>
                </div>
              </div>

              <div className="p-6 rounded-3xl bg-surface-container-lowest border border-outline-variant/30 shadow-sm flex flex-col justify-between gap-4">
                <div className="flex items-center gap-2 text-primary font-bold">
                  <span className="material-symbols-outlined text-secondary">dns</span>
                  <span>Regional Dispensary Nodes</span>
                </div>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  3 seed test dispensaries active across Chengannur, Haripad, and Alappuzha with real-time stock sync.
                </p>
                <div className="pt-2 border-t border-surface-container flex items-center justify-between text-xs font-mono font-bold text-secondary">
                  <span>DISPENSARIES</span>
                  <span>3 CONNECTED</span>
                </div>
              </div>

              <div className="p-6 rounded-3xl bg-surface-container-lowest border border-outline-variant/30 shadow-sm flex flex-col justify-between gap-4">
                <div className="flex items-center gap-2 text-primary font-bold">
                  <span className="material-symbols-outlined text-secondary">support_agent</span>
                  <span>Admin Escalation</span>
                </div>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  Direct hotwire to State Drug Regulatory and technical operations desks for emergency dispatch override.
                </p>
                <div className="pt-2 border-t border-surface-container flex items-center justify-between text-xs font-mono font-bold text-primary">
                  <span>CODE:</span>
                  <span className="text-secondary">{profile.emergencyCode || 'SEC-ROOT-L3'}</span>
                </div>
              </div>
            </div>
          </div>
        )}


        {/* ========================================================================= */}
        {/* ROLE 3: PHARMACIST PROFILE — INSPIRED BY REFERENCE IMAGE 1 (Candidate/Tab)*/}
        {/* ========================================================================= */}
        {role === 'PHARMACIST' && (
          <div className="flex flex-col gap-6">
            {/* Header */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#2e685d]"></span>
                <h1 className="text-xl sm:text-2xl font-bold text-primary tracking-tight">Pharmacist Specialist Dossier</h1>
              </div>

              <button
                onClick={handleOpenEdit}
                className="px-4 py-2 rounded-full border border-primary/20 text-primary hover:bg-primary hover:text-white text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-base">edit</span>
                <span>Edit Credentials</span>
              </button>
            </div>

            {/* Split 2-Column Workspace (Matching Ref Image 1) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column (4 cols): Candidate / Specialist Profile Card */}
              <div className="lg:col-span-4 bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/30 shadow-sm flex flex-col gap-5">
                {/* Avatar with Camera */}
                <div className="relative w-full aspect-[4/3] rounded-2xl bg-surface-container-low overflow-hidden border border-outline-variant/30">
                  <img
                    src={profile.avatarUrl}
                    alt={profile.name}
                    style={{
                      transform: `scale(${profile.avatarScale || 1})`,
                      objectPosition: profile.avatarPosition || 'center'
                    }}
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => handleOpenMediaModal('avatar')}
                    className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-white/90 backdrop-blur-sm text-primary flex items-center justify-center shadow-md hover:bg-white transition-all"
                    title="Change picture"
                  >
                    <span className="material-symbols-outlined text-base">photo_camera</span>
                  </button>
                </div>

                {/* Specialist Identity */}
                <div>
                  <div className="mb-1">{renderRoleBadge()}</div>
                  <h2 className="text-xl font-bold text-primary mt-1">{profile.name}</h2>
                  <p className="text-xs text-on-surface-variant font-medium mt-0.5">
                    {profile.qualification || 'PharmD, Clinical Pharmacy'}
                  </p>
                  <span className="inline-block mt-2 px-2.5 py-0.5 rounded-full bg-surface-container text-xs font-semibold text-primary">
                    {profile.experienceYears || '12 Years'} Clinical Practice
                  </span>
                </div>

                {/* Match / Performance Gauge (Ref Image 1: 96% Match Rate) */}
                <div className="p-4 rounded-2xl bg-surface-container-low flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-primary">Fulfillment Accuracy</span>
                    <span className="text-lg font-black text-secondary font-mono">99.4%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-surface-container overflow-hidden">
                    <div className="w-[99%] h-full bg-[#2e685d] rounded-full"></div>
                  </div>
                  <span className="text-[10px] text-on-surface-variant">450+ verified counter PIN dispensations</span>
                </div>

                {/* Contact Drawer */}
                <div className="flex flex-col gap-2 pt-2 border-t border-surface-container text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-on-surface-variant">License #</span>
                    <span className="font-mono font-bold text-primary">{profile.licenseNumber || 'KL-PH-4920'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-on-surface-variant">Direct Line</span>
                    <span className="font-mono font-bold text-primary">{profile.phone}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-on-surface-variant">Hours</span>
                    <span className="font-semibold text-primary">{profile.workingHours || '9 AM - 9 PM'}</span>
                  </div>
                </div>
              </div>

              {/* Right Column (8 cols): Tabbed Professional Sections */}
              <div className="lg:col-span-8 flex flex-col gap-6">
                {/* Tabs Top Bar (Ref Image 1: Resume / Attachment / Interview) */}
                <div className="bg-surface-container-lowest p-2 rounded-full border border-outline-variant/30 shadow-xs flex items-center gap-2 overflow-x-auto">
                  <button
                    onClick={() => setActiveSubTab('overview')}
                    className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${
                      activeSubTab === 'overview'
                        ? 'bg-primary text-white shadow-xs'
                        : 'text-on-surface-variant hover:text-primary'
                    }`}
                  >
                    Dispensary Information
                  </button>
                  <button
                    onClick={() => setActiveSubTab('credentials')}
                    className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${
                      activeSubTab === 'credentials'
                        ? 'bg-primary text-white shadow-xs'
                        : 'text-on-surface-variant hover:text-primary'
                    }`}
                  >
                    Board Credentials
                  </button>
                  <button
                    onClick={() => setActiveSubTab('support')}
                    className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${
                      activeSubTab === 'support'
                        ? 'bg-primary text-white shadow-xs'
                        : 'text-on-surface-variant hover:text-primary'
                    }`}
                  >
                    Dispensary Support
                  </button>
                </div>

                {/* Tab Content */}
                <div className="bg-surface-container-lowest rounded-3xl p-6 sm:p-8 border border-outline-variant/30 shadow-sm flex flex-col gap-6">
                  {activeSubTab === 'overview' && (
                    <div className="flex flex-col gap-4">
                      <h3 className="text-lg font-bold text-primary">Affiliated Dispensary Facility</h3>
                      <div className="p-4 rounded-2xl bg-surface-container-low flex flex-col gap-2">
                        <span className="text-xs font-bold text-primary">{profile.pharmacyName}</span>
                        <p className="text-xs text-on-surface-variant">{profile.address}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="px-2.5 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[11px] font-bold">
                            TEST FIXTURE NODE
                          </span>
                          <span className="text-xs text-secondary font-semibold">Inventory Sync Active</span>
                        </div>
                      </div>

                      <h4 className="text-sm font-bold text-primary mt-2">Specialist Biography &amp; Practice Focus</h4>
                      <p className="text-xs text-on-surface-variant leading-relaxed">
                        {profile.bio}
                      </p>
                    </div>
                  )}

                  {activeSubTab === 'credentials' && (
                    <div className="flex flex-col gap-4">
                      <h3 className="text-lg font-bold text-primary">State Pharmacy Council Credentials</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="p-4 rounded-2xl bg-surface-container-low flex flex-col gap-1">
                          <span className="text-[11px] text-on-surface-variant">Registration Authority</span>
                          <span className="text-sm font-bold text-primary">Kerala State Pharmacy Council</span>
                        </div>
                        <div className="p-4 rounded-2xl bg-surface-container-low flex flex-col gap-1">
                          <span className="text-[11px] text-on-surface-variant">Certificate Registration #</span>
                          <span className="text-sm font-bold text-primary font-mono">{profile.licenseNumber}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeSubTab === 'support' && (
                    <div className="flex flex-col gap-4">
                      <h3 className="text-lg font-bold text-primary">Dispensary Escalation &amp; Assistance</h3>
                      <p className="text-xs text-on-surface-variant">
                        For system outages, inventory discrepancies, or prescription integrity escalations:
                      </p>
                      <div className="p-4 rounded-2xl bg-surface-container-low text-xs flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <span>Drug Controller Office:</span>
                          <span className="font-mono font-bold text-primary">0471-230-8000</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>MediFind Technical Operations:</span>
                          <span className="font-mono font-bold text-secondary">tech-support@medifind.care</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}


        {/* ========================================================================= */}
        {/* ROLE 4: ASSISTANT PROFILE — INSPIRED BY REFERENCE IMAGE 4 (Twitter/Stream) */}
        {/* ========================================================================= */}
        {role === 'ASSISTANT' && (
          <div className="flex flex-col gap-6">
            {/* Wide Banner Image (Ref Image 4) */}
            <div className="relative w-full h-48 sm:h-64 rounded-3xl overflow-hidden shadow-sm border border-outline-variant/30 group">
              <img
                src={profile.bannerUrl}
                alt="Assistant Banner"
                style={{
                  transform: `scale(${profile.bannerScale || 1})`,
                  objectPosition: profile.bannerPosition || 'center'
                }}
                className="w-full h-full object-cover transition-transform"
              />
              <button
                onClick={() => handleOpenMediaModal('banner')}
                className="absolute top-4 right-4 px-3.5 py-1.5 rounded-full bg-white/90 backdrop-blur-sm text-primary hover:bg-white text-xs font-bold shadow-md transition-all flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-sm">edit</span>
                <span>Change Banner</span>
              </button>
            </div>

            {/* Layout with Left Floating Profile Card (Ref Image 4) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 -mt-16 sm:-mt-20 z-10 px-2 sm:px-4">
              {/* Left Floating Card (Ref Image 4) */}
              <div className="lg:col-span-4 bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/30 shadow-md flex flex-col gap-4">
                {/* Circular Overlapping Avatar */}
                <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden border-4 border-white shadow-lg bg-surface-container-low mx-auto lg:mx-0">
                  <img
                    src={profile.avatarUrl}
                    alt={profile.name}
                    style={{
                      transform: `scale(${profile.avatarScale || 1})`,
                      objectPosition: profile.avatarPosition || 'center'
                    }}
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => handleOpenMediaModal('avatar')}
                    className="absolute inset-0 bg-black/40 text-white opacity-0 hover:opacity-100 flex items-center justify-center transition-opacity"
                    title="Change picture"
                  >
                    <span className="material-symbols-outlined text-xl">photo_camera</span>
                  </button>
                </div>

                <div className="text-center lg:text-left">
                  <div className="flex items-center gap-1.5 justify-center lg:justify-start">
                    <h2 className="text-xl font-bold text-primary">{profile.name}</h2>
                    <span className="material-symbols-outlined text-secondary text-base">verified</span>
                  </div>
                  <span className="text-xs text-on-surface-variant font-mono">{profile.handle || '@kavita_access'}</span>
                  <div className="mt-2">{renderRoleBadge()}</div>
                </div>

                <p className="text-xs text-on-surface-variant leading-relaxed text-center lg:text-left">
                  {profile.bio}
                </p>

                <div className="flex flex-col gap-2 pt-3 border-t border-surface-container text-xs text-on-surface-variant">
                  <span className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm text-secondary">moped</span>
                    {profile.vehicleType}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm text-secondary">pin_drop</span>
                    {profile.serviceTerritory}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm text-secondary">star</span>
                    <strong>4.9 ★</strong> (120+ verified handovers)
                  </span>
                </div>

                <button
                  onClick={handleOpenEdit}
                  className="w-full py-2.5 rounded-full bg-primary hover:bg-primary-container text-white font-bold text-xs transition-all shadow-xs flex items-center justify-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-base">edit</span>
                  <span>Edit Profile</span>
                </button>
              </div>

              {/* Right Activity Stream / Tabs (Ref Image 4) */}
              <div className="lg:col-span-8 flex flex-col gap-4">
                {/* Sub Tab Bar */}
                <div className="bg-surface-container-lowest p-1.5 rounded-full border border-outline-variant/30 shadow-xs flex items-center gap-2">
                  <button
                    onClick={() => setActiveSubTab('overview')}
                    className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${
                      activeSubTab === 'overview'
                        ? 'bg-primary text-white shadow-xs'
                        : 'text-on-surface-variant hover:text-primary'
                    }`}
                  >
                    Field Activity &amp; Tasks
                  </button>
                  <button
                    onClick={() => setActiveSubTab('vehicle')}
                    className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${
                      activeSubTab === 'vehicle'
                        ? 'bg-primary text-white shadow-xs'
                        : 'text-on-surface-variant hover:text-primary'
                    }`}
                  >
                    Vehicle &amp; Equipment
                  </button>
                  <button
                    onClick={() => setActiveSubTab('support')}
                    className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${
                      activeSubTab === 'support'
                        ? 'bg-primary text-white shadow-xs'
                        : 'text-on-surface-variant hover:text-primary'
                    }`}
                  >
                    Dispatch Hotline
                  </button>
                </div>

                {/* Activity Feed */}
                <div className="flex flex-col gap-3">
                  <div className="p-6 rounded-3xl bg-surface-container-lowest border border-outline-variant/30 text-center flex flex-col items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-2xl text-primary">history</span>
                    <span className="text-xs font-bold text-primary">No Completed Dispatches</span>
                    <p className="text-xs text-on-surface-variant max-w-sm">
                      Completed medicine collections and verified handovers will be logged here.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ========================================================================= */}
      {/* EDIT PROFILE MODAL                                                        */}
      {/* ========================================================================= */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border border-outline-variant/40 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-surface-container">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-2xl">account_circle</span>
                <h3 className="text-lg font-bold text-primary">Edit Profile Details</h3>
              </div>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="w-8 h-8 rounded-full hover:bg-surface-container flex items-center justify-center text-on-surface-variant"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="flex flex-col gap-4 text-xs">
              <div className="flex flex-col gap-1">
                <label className="font-semibold text-primary">Full Name</label>
                <input
                  type="text"
                  required
                  value={editDraft.name}
                  onChange={e => setEditDraft(prev => ({ ...prev, name: e.target.value }))}
                  className="h-10 px-3.5 rounded-xl border border-outline-variant/60 focus:border-secondary outline-none text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-semibold text-primary">Email Address</label>
                  <input
                    type="email"
                    required
                    value={editDraft.email}
                    onChange={e => setEditDraft(prev => ({ ...prev, email: e.target.value }))}
                    className="h-10 px-3.5 rounded-xl border border-outline-variant/60 focus:border-secondary outline-none text-sm"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="font-semibold text-primary">Phone Contact</label>
                  <input
                    type="text"
                    required
                    value={editDraft.phone}
                    onChange={e => setEditDraft(prev => ({ ...prev, phone: e.target.value }))}
                    className="h-10 px-3.5 rounded-xl border border-outline-variant/60 focus:border-secondary outline-none text-sm"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-semibold text-primary">Primary Address / Office</label>
                <input
                  type="text"
                  value={editDraft.address || ''}
                  onChange={e => setEditDraft(prev => ({ ...prev, address: e.target.value }))}
                  className="h-10 px-3.5 rounded-xl border border-outline-variant/60 focus:border-secondary outline-none text-sm"
                />
              </div>

              {/* Role-Specific Fields */}
              {role === 'PATIENT' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-primary">Blood Group</label>
                    <input
                      type="text"
                      value={editDraft.bloodGroup || ''}
                      onChange={e => setEditDraft(prev => ({ ...prev, bloodGroup: e.target.value }))}
                      className="h-10 px-3.5 rounded-xl border border-outline-variant/60 focus:border-secondary outline-none text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-primary">Emergency Contact</label>
                    <input
                      type="text"
                      value={editDraft.emergencyContact || ''}
                      onChange={e => setEditDraft(prev => ({ ...prev, emergencyContact: e.target.value }))}
                      className="h-10 px-3.5 rounded-xl border border-outline-variant/60 focus:border-secondary outline-none text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <label className="font-semibold text-primary">Known Allergies</label>
                    <input
                      type="text"
                      value={editDraft.allergies || ''}
                      onChange={e => setEditDraft(prev => ({ ...prev, allergies: e.target.value }))}
                      placeholder="e.g. Penicillin (mild rash)"
                      className="h-10 px-3.5 rounded-xl border border-outline-variant/60 focus:border-secondary outline-none text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-primary">ABHA Health ID</label>
                    <input
                      type="text"
                      value={editDraft.healthId || ''}
                      onChange={e => setEditDraft(prev => ({ ...prev, healthId: e.target.value }))}
                      placeholder="ABHA-XX-XXXX-XXXX"
                      className="h-10 px-3.5 rounded-xl border border-outline-variant/60 focus:border-secondary outline-none text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-primary">Consulting Doctor</label>
                    <input
                      type="text"
                      value={editDraft.consultingDoctor || ''}
                      onChange={e => setEditDraft(prev => ({ ...prev, consultingDoctor: e.target.value }))}
                      className="h-10 px-3.5 rounded-xl border border-outline-variant/60 focus:border-secondary outline-none text-sm"
                    />
                  </div>
                </div>
              )}

              {role === 'PHARMACIST' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <label className="font-semibold text-primary">Pharmacy / Dispensary Name</label>
                    <input
                      type="text"
                      value={editDraft.pharmacyName || ''}
                      onChange={e => setEditDraft(prev => ({ ...prev, pharmacyName: e.target.value }))}
                      className="h-10 px-3.5 rounded-xl border border-outline-variant/60 focus:border-secondary outline-none text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-primary">License Number</label>
                    <input
                      type="text"
                      value={editDraft.licenseNumber || ''}
                      onChange={e => setEditDraft(prev => ({ ...prev, licenseNumber: e.target.value }))}
                      className="h-10 px-3.5 rounded-xl border border-outline-variant/60 focus:border-secondary outline-none text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-primary">Qualification</label>
                    <input
                      type="text"
                      value={editDraft.qualification || ''}
                      onChange={e => setEditDraft(prev => ({ ...prev, qualification: e.target.value }))}
                      placeholder="e.g. PharmD, Clinical Pharmacy"
                      className="h-10 px-3.5 rounded-xl border border-outline-variant/60 focus:border-secondary outline-none text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-primary">Years of Experience</label>
                    <input
                      type="text"
                      value={editDraft.experienceYears || ''}
                      onChange={e => setEditDraft(prev => ({ ...prev, experienceYears: e.target.value }))}
                      placeholder="e.g. 12 Years"
                      className="h-10 px-3.5 rounded-xl border border-outline-variant/60 focus:border-secondary outline-none text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-primary">Working Hours</label>
                    <input
                      type="text"
                      value={editDraft.workingHours || ''}
                      onChange={e => setEditDraft(prev => ({ ...prev, workingHours: e.target.value }))}
                      placeholder="e.g. 9:00 AM – 9:00 PM"
                      className="h-10 px-3.5 rounded-xl border border-outline-variant/60 focus:border-secondary outline-none text-sm"
                    />
                  </div>
                </div>
              )}

              {role === 'ASSISTANT' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-primary">Handle / Username</label>
                    <input
                      type="text"
                      value={editDraft.handle || ''}
                      onChange={e => setEditDraft(prev => ({ ...prev, handle: e.target.value }))}
                      placeholder="@kavita_access"
                      className="h-10 px-3.5 rounded-xl border border-outline-variant/60 focus:border-secondary outline-none text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-primary">Vehicle Model &amp; Type</label>
                    <input
                      type="text"
                      value={editDraft.vehicleType || ''}
                      onChange={e => setEditDraft(prev => ({ ...prev, vehicleType: e.target.value }))}
                      className="h-10 px-3.5 rounded-xl border border-outline-variant/60 focus:border-secondary outline-none text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-primary">Vehicle Registration No.</label>
                    <input
                      type="text"
                      value={editDraft.vehicleNumber || ''}
                      onChange={e => setEditDraft(prev => ({ ...prev, vehicleNumber: e.target.value }))}
                      placeholder="e.g. KL-30-E-4421"
                      className="h-10 px-3.5 rounded-xl border border-outline-variant/60 focus:border-secondary outline-none text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-primary">Service Territory</label>
                    <input
                      type="text"
                      value={editDraft.serviceTerritory || ''}
                      onChange={e => setEditDraft(prev => ({ ...prev, serviceTerritory: e.target.value }))}
                      className="h-10 px-3.5 rounded-xl border border-outline-variant/60 focus:border-secondary outline-none text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <label className="font-semibold text-primary">Cold-Chain Box ID</label>
                    <input
                      type="text"
                      value={editDraft.boxId || ''}
                      onChange={e => setEditDraft(prev => ({ ...prev, boxId: e.target.value }))}
                      placeholder="e.g. CCB-9021 (2°C – 8°C Monitored)"
                      className="h-10 px-3.5 rounded-xl border border-outline-variant/60 focus:border-secondary outline-none text-sm"
                    />
                  </div>
                </div>
              )}

              {role === 'ADMIN' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <label className="font-semibold text-primary">Department</label>
                    <input
                      type="text"
                      value={editDraft.department || ''}
                      onChange={e => setEditDraft(prev => ({ ...prev, department: e.target.value }))}
                      placeholder="e.g. Operations & Infrastructure Security"
                      className="h-10 px-3.5 rounded-xl border border-outline-variant/60 focus:border-secondary outline-none text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-primary">Operational Region</label>
                    <input
                      type="text"
                      value={editDraft.region || ''}
                      onChange={e => setEditDraft(prev => ({ ...prev, region: e.target.value }))}
                      className="h-10 px-3.5 rounded-xl border border-outline-variant/60 focus:border-secondary outline-none text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="font-semibold text-primary">Clearance Level</label>
                    <input
                      type="text"
                      value={editDraft.clearanceLevel || ''}
                      onChange={e => setEditDraft(prev => ({ ...prev, clearanceLevel: e.target.value }))}
                      placeholder="e.g. Superuser Level 3"
                      className="h-10 px-3.5 rounded-xl border border-outline-variant/60 focus:border-secondary outline-none text-sm"
                    />
                  </div>
                  <div className="flex flex-col gap-1 sm:col-span-2">
                    <label className="font-semibold text-primary">Emergency Security Code</label>
                    <input
                      type="text"
                      value={editDraft.emergencyCode || ''}
                      onChange={e => setEditDraft(prev => ({ ...prev, emergencyCode: e.target.value }))}
                      placeholder="e.g. SEC-ROOT-L3-KERALA"
                      className="h-10 px-3.5 rounded-xl border border-outline-variant/60 focus:border-secondary outline-none text-sm"
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="font-semibold text-primary">Biography &amp; Notes</label>
                <textarea
                  rows="3"
                  value={editDraft.bio || ''}
                  onChange={e => setEditDraft(prev => ({ ...prev, bio: e.target.value }))}
                  className="p-3 rounded-xl border border-outline-variant/60 focus:border-secondary outline-none text-sm"
                />
              </div>


              <div className="flex items-center justify-end gap-3 pt-3 border-t border-surface-container">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 rounded-full border border-outline-variant text-on-surface-variant font-bold hover:bg-surface-container"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 rounded-full bg-primary hover:bg-primary-container text-white font-bold shadow-xs"
                >
                  Save Profile Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MEDIA (AVATAR / BANNER) UPLOAD & ADJUSTMENT MODAL                          */}
      {/* ========================================================================= */}
      {isMediaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border border-outline-variant/40 flex flex-col gap-5">
            <div className="flex items-center justify-between pb-3 border-b border-surface-container">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-2xl">
                  {mediaModalType === 'avatar' ? 'face' : 'panorama'}
                </span>
                <h3 className="text-lg font-bold text-primary">
                  {mediaModalType === 'avatar' ? 'Adjust Profile Picture' : 'Adjust Banner Image'}
                </h3>
              </div>
              <button
                onClick={() => setIsMediaModalOpen(false)}
                className="w-8 h-8 rounded-full hover:bg-surface-container flex items-center justify-center text-on-surface-variant"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* Live Preview Container */}
            <div className="flex flex-col items-center justify-center gap-3">
              {mediaModalType === 'avatar' ? (
                <div className="w-36 h-36 rounded-full overflow-hidden border-4 border-[#2e685d] shadow-lg bg-surface-container-low flex items-center justify-center">
                  <img
                    src={mediaDraft.url}
                    alt="Preview"
                    style={{
                      transform: `scale(${mediaDraft.scale || 1})`,
                      objectPosition: mediaDraft.position || 'center'
                    }}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="w-full h-32 rounded-2xl overflow-hidden border-2 border-[#2e685d] shadow-md bg-surface-container-low flex items-center justify-center">
                  <img
                    src={mediaDraft.url}
                    alt="Banner Preview"
                    style={{
                      transform: `scale(${mediaDraft.scale || 1})`,
                      objectPosition: mediaDraft.position || 'center'
                    }}
                    className="w-full h-full object-cover transition-transform"
                  />
                </div>
              )}
            </div>

            {/* Scale / Zoom Slider for both Avatar and Banner */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs font-semibold text-primary">
                <span>Zoom / Scale Adjustment</span>
                <span className="font-mono text-secondary font-bold">{Math.round((mediaDraft.scale || 1) * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.8"
                max="2.5"
                step="0.05"
                value={mediaDraft.scale || 1}
                onChange={e => setMediaDraft(prev => ({ ...prev, scale: parseFloat(e.target.value) }))}
                className="w-full accent-[#2e685d] cursor-pointer"
              />
            </div>

            {/* Framing & Position Selector */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-primary">Framing &amp; Vertical Position</span>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'top', label: 'Top' },
                  { id: 'center', label: 'Center' },
                  { id: 'bottom', label: 'Bottom' }
                ].map((pos) => (
                  <button
                    key={pos.id}
                    type="button"
                    onClick={() => setMediaDraft(prev => ({ ...prev, position: pos.id }))}
                    className={`py-1.5 rounded-xl text-xs font-bold transition-all border ${
                      mediaDraft.position === pos.id
                        ? 'bg-[#1e453e] text-white border-[#1e453e] shadow-xs'
                        : 'bg-surface-container-low text-on-surface-variant border-outline-variant/40 hover:bg-surface-container'
                    }`}
                  >
                    {pos.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Preset Library (4-5 presets as requested) */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold text-primary">Choose from default presets:</span>
              <div className="grid grid-cols-5 gap-2">
                {(mediaModalType === 'avatar' ? PRESET_AVATARS : PRESET_BANNERS).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setMediaDraft(prev => ({ ...prev, url: item.url }))}
                    className={`aspect-square rounded-xl overflow-hidden border-2 transition-all p-0.5 ${
                      mediaDraft.url === item.url ? 'border-primary scale-105 shadow-md' : 'border-outline-variant/40 hover:border-secondary'
                    }`}
                    title={item.label}
                  >
                    <img src={item.url} alt={item.label} className="w-full h-full object-cover rounded-lg" />
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Upload Button */}
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-2.5 rounded-xl border border-dashed border-[#2e685d] text-[#032f28] hover:bg-[#e0f2eb] text-xs font-bold transition-all flex items-center justify-center gap-1.5"
              >
                <span className="material-symbols-outlined text-base">upload_file</span>
                <span>Upload Custom Image from Computer</span>
              </button>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-surface-container">
              <button
                type="button"
                onClick={() => setIsMediaModalOpen(false)}
                className="px-4 py-2 rounded-full border border-outline-variant text-on-surface-variant font-bold hover:bg-surface-container text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveMedia}
                className="px-5 py-2 rounded-full bg-primary hover:bg-primary-container text-white font-bold text-xs shadow-xs"
              >
                Apply &amp; Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
