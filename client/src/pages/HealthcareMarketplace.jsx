import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import ConfirmationDialog from '../components/ConfirmationDialog';
import LoadingSkeleton from '../components/LoadingSkeleton';
import HumanClinicalAssistanceModal from '../components/HumanClinicalAssistanceModal';
import RollingNumber from '../components/ui/RollingNumber';

export default function HealthcareMarketplace({ onNavigate, initialSubTab = 'services', onSubTabChange }) {
  const { user } = useAuth();

  // State: navigation tab within marketplace ('services', 'professionals', 'my-appointments', 'clinical-assistance')
  const [activeTab, setActiveTab] = useState(initialSubTab || 'services');

  const handleTabChange = (newTab) => {
    setActiveTab(newTab);
    if (onSubTabChange) onSubTabChange(newTab);
  };

  useEffect(() => {
    if (initialSubTab && initialSubTab !== activeTab) {
      setActiveTab(initialSubTab);
      if (initialSubTab === 'my-appointments') {
        fetchMyAppointments();
      } else if (initialSubTab === 'clinical-assistance') {
        fetchClinicalRequests();
      } else if (initialSubTab === 'professionals') {
        if (professionals.length === 0) fetchProfessionals(selectedService?.id);
      }
    }
  }, [initialSubTab]);

  // Human Clinical Assistance Modal & Requests State (Gate 7)
  const [clinicalModalOpen, setClinicalModalOpen] = useState(false);
  const [clinicalRequests, setClinicalRequests] = useState([]);
  const [loadingClinicalRequests, setLoadingClinicalRequests] = useState(false);
  const [playingSpeechRequestId, setPlayingSpeechRequestId] = useState(null);
  const [reservingMedicineId, setReservingMedicineId] = useState(null);
  const [reservationSuccessModal, setReservationSuccessModal] = useState(null);

  // Catalogue & Discovery data
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState(null);
  const [professionals, setProfessionals] = useState([]);
  const [selectedProfessional, setSelectedProfessional] = useState(null);
  const [filterArea, setFilterArea] = useState('Chengannur');
  const [loadingServices, setLoadingServices] = useState(true);
  const [loadingPros, setLoadingPros] = useState(false);

  // Booking Flow State
  const [bookingStep, setBookingStep] = useState(1); // 1: Select Slot, 2: Address & Consent, 3: Review & Submit
  const [bookingDate, setBookingDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  });
  const [availabilitySlots, setAvailabilitySlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [serviceAddress, setServiceAddress] = useState('');
  const [patientNotes, setPatientNotes] = useState('');
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [selectedPrescriptionId, setSelectedPrescriptionId] = useState('');
  const [patientPrescriptions, setPatientPrescriptions] = useState([]);
  const [submittingBooking, setSubmittingBooking] = useState(false);
  const [bookingSuccessData, setBookingSuccessData] = useState(null);

  // Patient Appointments & Tracking
  const [myAppointments, setMyAppointments] = useState([]);
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  const [selectedTrackingAppointment, setSelectedTrackingAppointment] = useState(null);
  const [cancellingAppointmentId, setCancellingAppointmentId] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [submittingCancel, setSubmittingCancel] = useState(false);

  // Feedback toast
  const [feedback, setFeedback] = useState({ show: false, message: '', type: 'success' });
  const showToast = (message, type = 'success') => {
    setFeedback({ show: true, message, type });
    setTimeout(() => setFeedback({ show: false, message: '', type: 'success' }), 4500);
  };

  const getValidServiceIcon = (icon) => {
    if (!icon) return 'medical_services';
    if (icon.toLowerCase().includes('band')) return 'healing';
    return icon;
  };

  // 1. Load Services Catalogue on mount
  useEffect(() => {
    fetchServices();
    fetchPatientPrescriptions();
    fetchMyAppointments();
    fetchClinicalRequests();
  }, []);

  async function fetchClinicalRequests() {
    setLoadingClinicalRequests(true);
    try {
      const token = localStorage.getItem('medifind_token');
      if (!token) return;
      const res = await fetch('/api/clinical-assistance/my-requests', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setClinicalRequests(data.requests || []);
      }
    } catch (err) {
      console.error('fetchClinicalRequests error:', err);
    } finally {
      setLoadingClinicalRequests(false);
    }
  }

  const [submittingClinicalFollowUp, setSubmittingClinicalFollowUp] = useState(false);

  async function handleClinicalFollowUp(requestId, followUpState) {
    if (!requestId || !followUpState) return;
    setSubmittingClinicalFollowUp(true);
    try {
      const token = localStorage.getItem('medifind_token');
      if (!token) return;
      const res = await fetch(`/api/clinical-assistance/${requestId}/follow-up`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ followUpState })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Follow-up recorded: ${followUpState.replace(/_/g, ' ')}`, 'success');
        fetchClinicalRequests();
      } else {
        showToast(data.error || 'Failed to record follow-up.', 'error');
      }
    } catch (err) {
      console.error('handleClinicalFollowUp error:', err);
      showToast('Network error submitting follow-up.', 'error');
    } finally {
      setSubmittingClinicalFollowUp(false);
    }
  }

  // TTS Helper for Elder Accessibility
  const handleToggleSpeech = (requestId, text, lang = 'en') => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      showToast('Speech audio is not supported in this browser.', 'error');
      return;
    }

    if (playingSpeechRequestId === requestId) {
      window.speechSynthesis.cancel();
      setPlayingSpeechRequestId(null);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.88; // Slightly slower, clear pace for elderly listeners
    if (lang === 'ml') utterance.lang = 'ml-IN';
    else if (lang === 'hi') utterance.lang = 'hi-IN';
    else utterance.lang = 'en-IN';

    utterance.onend = () => {
      setPlayingSpeechRequestId(null);
    };
    utterance.onerror = () => {
      setPlayingSpeechRequestId(null);
    };

    setPlayingSpeechRequestId(requestId);
    window.speechSynthesis.speak(utterance);
  };

  // Direct Reservation of Pharmacist-Recommended Medicine
  const handleDirectReserveMedicine = async (req, med) => {
    if (!med || !med.medicineId || !med.pharmacyId) {
      showToast('Invalid medication or pharmacy details for reservation.', 'error');
      return;
    }

    setReservingMedicineId(med.medicineId);
    const token = localStorage.getItem('medifind_token');
    try {
      const payload = {
        pharmacyId: med.pharmacyId,
        orderType: 'RESERVATION',
        notes: `Clinical Assistance Recommendation for #${req.requestNumber} (${med.instructions || 'Dispensary Hold'})`,
        items: [
          {
            medicineId: med.medicineId,
            quantity: med.quantity || 1,
            price: med.price || 15
          }
        ]
      };

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (data.success && data.order) {
        showToast('Medication reserved successfully! Counter PIN generated.', 'success');
        setReservationSuccessModal({
          order: data.order,
          medicine: med,
          pharmacyName: med.pharmacyName || 'Dispensary'
        });
      } else {
        showToast(data.error || 'Failed to reserve medication hold.', 'error');
      }
    } catch (err) {
      console.error('Error reserving recommended medicine:', err);
      showToast('Network error while reserving medication.', 'error');
    } finally {
      setReservingMedicineId(null);
    }
  };

  async function fetchServices() {
    setLoadingServices(true);
    try {
      const res = await fetch('/api/appointments/services');
      const data = await res.json();
      if (data.success) {
        setServices(data.services || []);
      } else {
        showToast(data.error || 'Failed to load services catalogue.', 'error');
      }
    } catch (err) {
      console.error('fetchServices error:', err);
      showToast('Network error loading clinical services.', 'error');
    } finally {
      setLoadingServices(false);
    }
  }

  async function fetchProfessionals(serviceId = null) {
    setLoadingPros(true);
    try {
      const token = localStorage.getItem('medifind_token');
      const params = new URLSearchParams();
      if (serviceId) params.append('serviceType', serviceId);
      if (filterArea) params.append('operatingArea', filterArea);

      const res = await fetch(`/api/appointments/marketplace?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setProfessionals(data.professionals || []);
      } else {
        showToast(data.error || 'Failed to search professionals.', 'error');
      }
    } catch (err) {
      console.error('fetchProfessionals error:', err);
      showToast('Network error loading healthcare professionals.', 'error');
    } finally {
      setLoadingPros(false);
    }
  }

  async function fetchPatientPrescriptions() {
    try {
      const token = localStorage.getItem('medifind_token');
      if (!token) return;
      const res = await fetch('/api/prescriptions', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setPatientPrescriptions(data.prescriptions || []);
      }
    } catch (err) {
      console.error('fetchPatientPrescriptions error:', err);
    }
  }

  async function fetchMyAppointments() {
    setLoadingAppointments(true);
    try {
      const token = localStorage.getItem('medifind_token');
      if (!token) return;
      const res = await fetch('/api/appointments/patient', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setMyAppointments(data.appointments || []);
      }
    } catch (err) {
      console.error('fetchMyAppointments error:', err);
    } finally {
      setLoadingAppointments(false);
    }
  }

  // 2. Fetch Availability Slots for Selected Professional and Date
  async function fetchAvailability(proId, dateStr) {
    if (!proId || !dateStr) return;
    setLoadingSlots(true);
    setSelectedSlot(null);
    try {
      const token = localStorage.getItem('medifind_token');
      const res = await fetch(`/api/appointments/availability/${proId}?date=${dateStr}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setAvailabilitySlots(data.slots || []);
      } else {
        showToast(data.error || 'Failed to check practitioner availability.', 'error');
        setAvailabilitySlots([]);
      }
    } catch (err) {
      console.error('fetchAvailability error:', err);
      showToast('Error checking real availability.', 'error');
      setAvailabilitySlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }

  // When professional and date change, reload slots
  useEffect(() => {
    if (selectedProfessional && bookingDate) {
      fetchAvailability(selectedProfessional.id, bookingDate);
    }
  }, [selectedProfessional, bookingDate]);

  // Initiate Booking for a Service
  const handleSelectServiceForBooking = (svc) => {
    setSelectedService(svc);
    setActiveTab('professionals');
    fetchProfessionals(svc.id);
  };

  // Initiate Booking for a Professional
  const handleStartBookingWithPro = (pro) => {
    setSelectedProfessional(pro);
    setBookingStep(1);
    setSelectedSlot(null);
    setConsentAccepted(false);
    setBookingSuccessData(null);
  };

  // Submit Final Booking Request
  const handleSubmitBooking = async () => {
    if (!selectedSlot) {
      showToast('Please select an appointment time slot.', 'error');
      return;
    }
    if (!serviceAddress || serviceAddress.trim().length < 8) {
      showToast('Please provide a complete home service address (min 8 characters).', 'error');
      return;
    }
    if (!consentAccepted) {
      showToast('You must acknowledge clinical boundaries and consent before booking.', 'error');
      return;
    }
    if (selectedService?.requiresPrescription && !selectedPrescriptionId) {
      showToast('This service requires a valid medical prescription or discharge summary.', 'error');
      return;
    }

    setSubmittingBooking(true);
    try {
      const token = localStorage.getItem('medifind_token');
      const payload = {
        professionalId: selectedProfessional.id,
        serviceType: selectedService.id,
        scheduledDate: bookingDate,
        timeSlot: selectedSlot.timeSlot,
        serviceAddress: serviceAddress.trim(),
        consentAccepted: true,
        consentVersion: 'v1.0',
        prescriptionId: selectedPrescriptionId || null,
        patientNotes: patientNotes ? patientNotes.trim() : null
      };

      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (data.success) {
        setBookingSuccessData(data.appointment);
        showToast('Appointment requested successfully! Awaiting professional confirmation.', 'success');
        fetchMyAppointments();
      } else {
        showToast(data.error || 'Failed to submit appointment request.', 'error');
      }
    } catch (err) {
      console.error('handleSubmitBooking error:', err);
      showToast('Network error submitting booking request.', 'error');
    } finally {
      setSubmittingBooking(false);
    }
  };

  // Handle Cancellation by Patient
  const handleConfirmCancel = async () => {
    if (!cancelReason || !cancelReason.trim()) {
      showToast('Please enter a cancellation reason.', 'error');
      return;
    }
    setSubmittingCancel(true);
    try {
      const token = localStorage.getItem('medifind_token');
      const res = await fetch(`/api/appointments/${cancellingAppointmentId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'CANCEL', reason: cancelReason.trim() })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Appointment cancelled successfully.', 'success');
        setCancellingAppointmentId(null);
        setCancelReason('');
        fetchMyAppointments();
        if (selectedTrackingAppointment?.id === cancellingAppointmentId) {
          setSelectedTrackingAppointment(null);
        }
      } else {
        showToast(data.error || 'Failed to cancel appointment.', 'error');
      }
    } catch (err) {
      console.error('handleConfirmCancel error:', err);
      showToast('Network error cancelling appointment.', 'error');
    } finally {
      setSubmittingCancel(false);
    }
  };

  // Helper status color mapping
  const getStatusBadge = (status) => {
    switch (status) {
      case 'REQUESTED':
        return { bg: '#fffbeb', color: '#b45309', label: 'Requested (Awaiting Confirmation)', icon: 'schedule' };
      case 'ACCEPTED':
        return { bg: '#e0f2fe', color: '#0369a1', label: 'Accepted by Practitioner', icon: 'task_alt' };
      case 'IN_PROGRESS':
        return { bg: '#dcfce7', color: '#15803d', label: 'Clinical Visit In Progress', icon: 'stethoscope' };
      case 'COMPLETED':
        return { bg: '#f0fdf4', color: '#166534', label: 'Completed Successfully', icon: 'verified' };
      case 'CANCELLED':
        return { bg: '#fef2f2', color: '#b91c1c', label: 'Cancelled', icon: 'cancel' };
      case 'REJECTED':
        return { bg: '#fff1f2', color: '#be123c', label: 'Declined by Practitioner', icon: 'do_not_disturb' };
      default:
        return { bg: '#f3f4f6', color: '#4b5563', label: status, icon: 'info' };
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Toast Feedback */}
      {feedback.show && (
        <div style={{
          position: 'fixed',
          top: '5.5rem',
          right: '1.5rem',
          zIndex: 9999,
          background: feedback.type === 'error' ? '#ffdad6' : '#e0f2eb',
          color: feedback.type === 'error' ? '#ba1a1a' : '#032f28',
          border: `1px solid ${feedback.type === 'error' ? '#ba1a1a' : '#2e685d'}`,
          borderRadius: 14,
          padding: '0.75rem 1.25rem',
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.65rem',
          fontSize: 13,
          fontWeight: 600
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            {feedback.type === 'error' ? 'error' : 'check_circle'}
          </span>
          <span>{feedback.message}</span>
        </div>
      )}

      {/* ── Top Clinical Header & Medical Disclaimer ── */}
      <div className="bg-gradient-to-r from-[#032f28] to-[#1e453e] rounded-3xl p-6 sm:p-8 text-white mb-8 shadow-xl relative overflow-hidden">
        <div className="relative z-10 max-w-3xl">
          <div className="inline-flex items-center gap-2 bg-white/15 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider text-emerald-200 mb-3 backdrop-blur-md">
            <span className="material-symbols-outlined text-sm">health_and_safety</span>
            <span>Verified Healthcare Professional Network</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white mb-2">
            Healthcare Services & In-Home Nursing Marketplace
          </h1>
          <p className="text-emerald-100/90 text-sm sm:text-base leading-relaxed mb-4">
            Connect with administrator-verified registered nurses and clinical assistants for scheduled in-home nursing visits, vital sign evaluations, and recovery care.
          </p>

          {/* Emergency Safety Alert */}
          <div className="bg-amber-950/40 border border-amber-400/30 rounded-2xl p-3.5 flex items-start gap-3 backdrop-blur-md">
            <span className="material-symbols-outlined text-amber-300 text-xl shrink-0 mt-0.5">crisis_alert</span>
            <div className="text-xs text-amber-100 leading-normal">
              <strong>Emergency Care Notice:</strong> MediFind AI appointment marketplace is not a substitute for emergency medical response. In case of acute cardiac symptoms, severe breathlessness, trauma, or medical emergency, immediately dial <strong>112 / 108</strong> or go to the nearest hospital casualty ward.
            </div>
          </div>
        </div>
      </div>

      {/* ── Marketplace Navigation Tabs ── */}
      <div className="flex items-center justify-between border-b border-gray-200 pb-3 mb-6 sm:mb-8 flex-wrap gap-3">
        <div className="flex items-center gap-1.5 sm:gap-2 bg-gray-100 p-1 sm:p-1.5 rounded-xl sm:rounded-2xl overflow-x-auto max-w-full no-scrollbar flex-nowrap shrink-0">
          <button
            type="button"
            onClick={() => { handleTabChange('services'); setSelectedProfessional(null); }}
            className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTab === 'services'
                ? 'bg-[#032f28] text-white shadow-md'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <span className="material-symbols-outlined text-sm sm:text-base">medical_services</span>
            <span>1. Services</span>
          </button>

          <button
            type="button"
            onClick={() => {
              handleTabChange('professionals');
              if (professionals.length === 0) fetchProfessionals(selectedService?.id);
            }}
            className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              activeTab === 'professionals'
                ? 'bg-[#032f28] text-white shadow-md'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <span className="material-symbols-outlined text-sm sm:text-base">person_search</span>
            <span>2. Professionals</span>
          </button>

          <button
            type="button"
            onClick={() => { handleTabChange('my-appointments'); fetchMyAppointments(); }}
            className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 relative ${
              activeTab === 'my-appointments'
                ? 'bg-[#032f28] text-white shadow-md'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <span className="material-symbols-outlined text-sm sm:text-base">calendar_month</span>
            <span>My Appointments</span>
            {myAppointments.length > 0 && (
              <span className="bg-emerald-500 text-white text-[10px] font-black px-1.5 py-0.2 rounded-full inline-flex items-center">
                <RollingNumber value={myAppointments.length} />
              </span>
            )}
          </button>

          {/* Gate 7: Human Clinical Assistance Tab */}
          <button
            type="button"
            onClick={() => { handleTabChange('clinical-assistance'); fetchClinicalRequests(); }}
            className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg sm:rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 relative ${
              activeTab === 'clinical-assistance'
                ? 'bg-[#032f28] text-white shadow-md'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <span className="material-symbols-outlined text-sm sm:text-base">clinical_notes</span>
            <span>Clinical Tele-Help</span>
            {clinicalRequests.length > 0 && (
              <span className="bg-emerald-600 text-white text-[10px] font-black px-1.5 py-0.2 rounded-full inline-flex items-center">
                <RollingNumber value={clinicalRequests.length} />
              </span>
            )}
          </button>
        </div>

        {/* Operating Area Filter */}
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-gray-400 text-lg">location_on</span>
          <span className="text-xs font-semibold text-gray-500">Service Area:</span>
          <select
            value={filterArea}
            onChange={(e) => {
              setFilterArea(e.target.value);
              if (activeTab === 'professionals') fetchProfessionals(selectedService?.id);
            }}
            className="text-xs font-bold text-[#032f28] bg-white border border-gray-300 rounded-xl px-3 py-1.5 shadow-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="Chengannur">Chengannur Central (10 km)</option>
            <option value="Chengannur_East">Chengannur East & Surrounds</option>
            <option value="Kottayam">Kottayam District</option>
            <option value="Pathanamthitta">Pathanamthitta District</option>
          </select>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* TAB 1: CLINICAL SERVICES CATALOGUE */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'services' && (
        <div>
          <div className="mb-6">
            <h2 className="text-xl font-bold text-[#032f28] flex items-center gap-2">
              <span>Authorized In-Home Healthcare Services</span>
              <span className="text-xs font-semibold bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
                <RollingNumber value={services.length} /> Safe Scopes
              </span>
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              Select an authorized clinical category to browse verified practitioners approved for that exact scope.
            </p>
          </div>

          {loadingServices ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-64 bg-gray-100 rounded-3xl animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {services.map(svc => (
                <div
                  key={svc.id}
                  className="bg-white rounded-3xl border border-gray-200/80 p-6 flex flex-col justify-between shadow-xs hover:shadow-md transition-all group"
                >
                  <div>
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-[#032f28] flex items-center justify-center border border-emerald-100 shrink-0">
                        <span className="material-symbols-outlined text-2xl">{getValidServiceIcon(svc.icon)}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-lg font-black text-[#032f28]">₹{svc.baseFee}</span>
                        <span className="text-[11px] block text-gray-500 font-medium">Standard Base Fee</span>
                      </div>
                    </div>

                    <h3 className="text-lg font-extrabold text-[#032f28] mb-1.5 group-hover:text-emerald-700 transition-colors">
                      {svc.name}
                    </h3>
                    <p className="text-xs text-gray-600 line-clamp-3 mb-4 leading-relaxed">
                      {svc.approvedScope}
                    </p>

                    <div className="space-y-2 mb-4 bg-gray-50 p-3 rounded-2xl border border-gray-100 text-xs">
                      <div className="flex items-center justify-between text-gray-600">
                        <span className="flex items-center gap-1 text-[11px] font-semibold">
                          <span className="material-symbols-outlined text-sm text-gray-400">timelapse</span>
                          Estimated Duration
                        </span>
                        <span className="font-bold text-gray-800">{svc.durationMinutes} minutes</span>
                      </div>

                      <div className="flex items-center justify-between text-gray-600">
                        <span className="flex items-center gap-1 text-[11px] font-semibold">
                          <span className="material-symbols-outlined text-sm text-gray-400">badge</span>
                          Required Credential
                        </span>
                        <span className="font-bold text-emerald-800 text-[11px] truncate max-w-[140px]" title={svc.requiredCredential}>
                          RN / Licensed GNM
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-gray-600">
                        <span className="flex items-center gap-1 text-[11px] font-semibold">
                          <span className="material-symbols-outlined text-sm text-gray-400">description</span>
                          Clinician Order
                        </span>
                        <span className={`font-bold text-[11px] ${svc.requiresPrescription ? 'text-amber-700' : 'text-gray-700'}`}>
                          {svc.requiresPrescription ? 'Mandatory Order Required' : 'Not Required'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => handleSelectServiceForBooking(svc)}
                      className="w-full bg-[#032f28] hover:bg-[#2e685d] text-white py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <span>Find Approved Nurses</span>
                      <span className="material-symbols-outlined text-base">arrow_forward</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Prohibited Services Explicit Safety Note */}
          <div className="mt-12 bg-red-50/60 border border-red-200/80 rounded-3xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-2xl bg-red-100 text-red-700 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-xl">shield_with_heart</span>
              </div>
              <div>
                <h4 className="text-sm font-bold text-red-900 mb-1">
                  High-Risk Clinical Safety Policy & Prohibited Services
                </h4>
                <p className="text-xs text-red-800 leading-relaxed">
                  To safeguard patient safety and maintain compliance with national nursing guidelines, invasive clinical procedures are strictly prohibited on this platform. Injections, intravenous (IV) cannulation/infusions, surgical wound debridement, and medication prescribing are permanently disabled and cannot be booked or approved.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* TAB 2: APPROVED HEALTHCARE PROFESSIONALS DISCOVERY & BOOKING */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'professionals' && !selectedProfessional && (
        <div>
          {/* Active Filter Indicator */}
          {selectedService && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-6 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-emerald-800 text-2xl">medical_services</span>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Filtering By Service</div>
                  <div className="text-sm font-extrabold text-[#032f28]">{selectedService.name}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setSelectedService(null); fetchProfessionals(null); }}
                className="text-xs font-bold text-emerald-800 hover:text-emerald-950 underline cursor-pointer"
              >
                Clear Service Filter (Show All Approved)
              </button>
            </div>
          )}

          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-xl font-bold text-[#032f28] flex items-center gap-2">
              <span>Verified Healthcare Professionals</span>
              <span className="text-xs font-semibold bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
                <RollingNumber value={professionals.length} /> Verified
              </span>
            </h2>
          </div>

          {loadingPros ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[1, 2].map(i => (
                <div key={i} className="h-60 bg-gray-100 rounded-3xl animate-pulse" />
              ))}
            </div>
          ) : professionals.length === 0 ? (
            <div className="bg-white rounded-3xl border border-gray-200 p-12 text-center max-w-xl mx-auto shadow-xs">
              <div className="w-16 h-16 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center mx-auto mb-4">
                <span className="material-symbols-outlined text-3xl">person_off</span>
              </div>
              <h3 className="text-base font-extrabold text-gray-800 mb-1">
                No Verified Practitioners Currently Available
              </h3>
              <p className="text-xs text-gray-500 leading-relaxed mb-6">
                There are currently no administrator-approved healthcare professionals operating in {filterArea} for this service category. New applicants are verified through credential checks by administrators before appearing here.
              </p>
              <button
                type="button"
                onClick={() => { setSelectedService(null); setFilterArea('Chengannur'); fetchProfessionals(null); }}
                className="bg-[#032f28] text-white px-5 py-2.5 rounded-xl text-xs font-bold hover:bg-[#2e685d] transition-all"
              >
                Reset Search Filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {professionals.map(pro => (
                <div
                  key={pro.id}
                  className="bg-white rounded-3xl border border-gray-200 p-6 flex flex-col justify-between shadow-xs hover:shadow-md transition-all"
                >
                  <div>
                    <div className="flex items-start justify-between gap-4 mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-14 h-14 rounded-2xl bg-[#032f28] text-emerald-200 flex items-center justify-center text-xl font-bold font-mono">
                          {pro.name.charAt(0)}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <h3 className="text-base font-extrabold text-[#032f28]">{pro.name}</h3>
                            <span className="material-symbols-outlined text-emerald-600 text-base" title="Platform Verified">
                              verified
                            </span>
                          </div>
                          <p className="text-xs font-bold text-emerald-800">{pro.professionTitle}</p>
                          <p className="text-[11px] text-gray-500">{pro.operatingCity} • {pro.yearsOfExperience} yrs experience</p>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-base font-black text-[#032f28]">₹{pro.serviceFee}</span>
                        <span className="text-[10px] block text-gray-500">Visit Fee</span>
                      </div>
                    </div>

                    {/* Qualifications & Council Registration */}
                    <div className="bg-gray-50 p-3.5 rounded-2xl border border-gray-100 space-y-2 mb-4 text-xs">
                      <div>
                        <span className="text-[10px] font-bold text-gray-400 block uppercase tracking-wider">Qualifications</span>
                        <span className="font-semibold text-gray-800">{pro.qualifications}</span>
                      </div>

                      <div className="flex items-center justify-between pt-1 border-t border-gray-200/60">
                        <div>
                          <span className="text-[10px] font-bold text-gray-400 block uppercase tracking-wider">Council Authority</span>
                          <span className="font-semibold text-gray-800 text-[11px]">{pro.issuingAuthority}</span>
                        </div>
                        {pro.registrationNumber && (
                          <div className="text-right">
                            <span className="text-[10px] font-bold text-gray-400 block uppercase tracking-wider">Reg Number</span>
                            <span className="font-mono text-emerald-900 font-bold text-[11px]">{pro.registrationNumber}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Admin-Approved Clinical Scopes */}
                    <div className="mb-4">
                      <span className="text-[10px] font-bold text-gray-400 block uppercase tracking-wider mb-1.5">
                        Approved Clinical Scopes:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {pro.approvedServices.map(sc => (
                          <span
                            key={sc}
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              selectedService?.id === sc
                                ? 'bg-[#032f28] text-white'
                                : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            }`}
                          >
                            {sc.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-gray-100 flex items-center justify-between gap-3">
                    <div className="text-[11px] text-gray-500 flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm text-emerald-600">schedule</span>
                      <span>Working Hours: {pro.workingHoursStart} - {pro.workingHoursEnd}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleStartBookingWithPro(pro)}
                      className="bg-[#032f28] hover:bg-[#2e685d] text-white px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer shadow-xs"
                    >
                      <span>Book Appointment</span>
                      <span className="material-symbols-outlined text-sm">event</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* BOOKING WORKFLOW WIZARD (When Professional Selected) */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'professionals' && selectedProfessional && !bookingSuccessData && (
        <div className="max-w-2xl mx-auto bg-white rounded-3xl border border-gray-200 p-6 sm:p-8 shadow-sm">
          {/* Breadcrumb / Back button */}
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-100">
            <button
              type="button"
              onClick={() => setSelectedProfessional(null)}
              className="text-xs font-bold text-gray-500 hover:text-gray-900 flex items-center gap-1 cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">arrow_back</span>
              <span>Back to Practitioner List</span>
            </button>
            <div className="text-xs font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-full">
              Step {bookingStep} of 3
            </div>
          </div>

          {/* Practitioner & Service Snapshot */}
          <div className="bg-emerald-50/60 border border-emerald-100 rounded-2xl p-4 mb-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#032f28] text-emerald-200 flex items-center justify-center font-bold">
                {selectedProfessional.name.charAt(0)}
              </div>
              <div>
                <h4 className="text-sm font-extrabold text-[#032f28]">{selectedProfessional.name}</h4>
                <p className="text-xs text-emerald-800 font-semibold">{selectedProfessional.professionTitle}</p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-xs text-gray-500 block">Service Fee</span>
              <span className="text-base font-black text-[#032f28]">₹{selectedProfessional.serviceFee}</span>
            </div>
          </div>

          {/* STEP 1: SELECT SERVICE & DATE/SLOT */}
          {bookingStep === 1 && (
            <div className="space-y-6">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                  1. Confirm Requested Clinical Service
                </label>
                <select
                  value={selectedService?.id || ''}
                  onChange={(e) => {
                    const found = services.find(s => s.id === e.target.value);
                    setSelectedService(found);
                  }}
                  className="w-full text-sm font-bold text-[#032f28] bg-white border border-gray-300 rounded-xl p-3 shadow-xs focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="" disabled>Select an approved service scope</option>
                  {services
                    .filter(s => selectedProfessional.approvedServices.includes(s.id))
                    .map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.durationMinutes} mins - ₹{s.baseFee})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                  2. Select Appointment Date
                </label>
                <input
                  type="date"
                  min={new Date().toISOString().split('T')[0]}
                  max={(() => {
                    const maxD = new Date();
                    maxD.setDate(maxD.getDate() + 30);
                    return maxD.toISOString().split('T')[0];
                  })()}
                  value={bookingDate}
                  onChange={(e) => setBookingDate(e.target.value)}
                  className="w-full text-sm font-bold text-gray-800 bg-white border border-gray-300 rounded-xl p-3 shadow-xs focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                    3. Select Real Time Slot
                  </label>
                  <span className="text-[11px] text-gray-500">Derived from live practitioner schedule</span>
                </div>

                {loadingSlots ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                      <div key={i} className="h-10 bg-gray-100 rounded-xl animate-pulse" />
                    ))}
                  </div>
                ) : availabilitySlots.length === 0 ? (
                  <div className="p-4 bg-gray-50 rounded-2xl text-center text-xs text-gray-500 border border-gray-200">
                    No available slots found for this date. The practitioner may not operate on this day.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {availabilitySlots.map(slot => (
                      <button
                        key={slot.timeSlot}
                        type="button"
                        disabled={!slot.available}
                        onClick={() => setSelectedSlot(slot)}
                        className={`p-2.5 rounded-xl text-xs font-bold border transition-all text-center flex flex-col items-center justify-center ${
                          !slot.available
                            ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed line-through'
                            : selectedSlot?.timeSlot === slot.timeSlot
                            ? 'bg-[#032f28] text-white border-[#032f28] shadow-md'
                            : 'bg-white text-gray-800 border-gray-300 hover:border-emerald-500 hover:bg-emerald-50/50 cursor-pointer'
                        }`}
                      >
                        <span>{slot.timeSlot}</span>
                        {!slot.available && (
                          <span className="text-[9px] font-normal no-underline block">{slot.reason}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-4 flex justify-end">
                <button
                  type="button"
                  disabled={!selectedService || !selectedSlot}
                  onClick={() => setBookingStep(2)}
                  className={`px-6 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                    !selectedService || !selectedSlot
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-[#032f28] hover:bg-[#2e685d] text-white cursor-pointer shadow-md'
                  }`}
                >
                  <span>Continue to Address & Consent</span>
                  <span className="material-symbols-outlined text-base">arrow_forward</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: ADDRESS, PRESCRIPTION & CONSENT */}
          {bookingStep === 2 && (
            <div className="space-y-6">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  Service Destination Address *
                </label>
                <textarea
                  rows={2}
                  value={serviceAddress}
                  onChange={(e) => setServiceAddress(e.target.value)}
                  placeholder="Address"
                  className="w-full text-xs font-bold text-[#032f28] bg-white border border-gray-300 rounded-xl p-3 shadow-xs focus:ring-1 focus:ring-emerald-500"
                />
                <span className="text-[11px] text-gray-500 mt-1 block">
                  Address privacy: Shared only with the assigned practitioner upon booking creation.
                </span>
              </div>

              {/* Prescription requirement for high-risk recovery scopes */}
              {selectedService?.requiresPrescription && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="material-symbols-outlined text-amber-700 text-lg">description</span>
                    <h5 className="text-xs font-bold text-amber-900">
                      Physician Order / Prescription Required
                    </h5>
                  </div>
                  <p className="text-[11px] text-amber-800 leading-relaxed mb-3">
                    {selectedService.name} requires a documented clinician order or hospital discharge summary. Please link an uploaded document.
                  </p>
                  <select
                    value={selectedPrescriptionId}
                    onChange={(e) => setSelectedPrescriptionId(e.target.value)}
                    className="w-full text-xs font-bold text-gray-800 bg-white border border-amber-300 rounded-xl p-2.5 shadow-xs"
                  >
                    <option value="">Select your uploaded medical document</option>
                    {patientPrescriptions.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.originalFileName} (Uploaded {new Date(p.createdAt).toLocaleDateString()})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  Patient Notes / Special Requests (Optional)
                </label>
                <input
                  type="text"
                  value={patientNotes}
                  onChange={(e) => setPatientNotes(e.target.value)}
                  placeholder="Instructions"
                  className="w-full text-xs font-bold text-[#032f28] bg-white border border-gray-300 rounded-xl p-3 shadow-xs focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              {/* Clinical Consent Box */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-emerald-800 text-lg">policy</span>
                  <h5 className="text-xs font-bold text-emerald-950 uppercase tracking-wider">
                    Informed Patient Consent (v1.0)
                  </h5>
                </div>
                <div className="text-[11px] text-emerald-900 leading-relaxed space-y-1.5 bg-white p-3 rounded-xl border border-emerald-100">
                  <p>• <strong>Scope Boundary:</strong> The visiting practitioner may only perform non-invasive observations and supportive care within their verified nursing scope.</p>
                  <p>• <strong>Non-Emergency:</strong> I understand that this in-home visit is not an emergency response.</p>
                  <p>• <strong>Confirmation Policy:</strong> The appointment is requested and is not confirmed until the practitioner accepts it.</p>
                </div>
                <label className="flex items-start gap-2.5 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={consentAccepted}
                    onChange={(e) => setConsentAccepted(e.target.checked)}
                    className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4"
                  />
                  <span className="text-xs font-bold text-[#032f28]">
                    I have read, understood, and accept the clinical service boundaries and patient consent.
                  </span>
                </label>
              </div>

              <div className="pt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setBookingStep(1)}
                  className="text-xs font-bold text-gray-500 hover:text-gray-900 cursor-pointer"
                >
                  Back to Slot Selection
                </button>
                <button
                  type="button"
                  disabled={!serviceAddress || !consentAccepted || (selectedService?.requiresPrescription && !selectedPrescriptionId)}
                  onClick={() => setBookingStep(3)}
                  className={`px-6 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                    !serviceAddress || !consentAccepted || (selectedService?.requiresPrescription && !selectedPrescriptionId)
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : 'bg-[#032f28] hover:bg-[#2e685d] text-white cursor-pointer shadow-md'
                  }`}
                >
                  <span>Review Booking</span>
                  <span className="material-symbols-outlined text-base">arrow_forward</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: REVIEW & SUBMIT */}
          {bookingStep === 3 && (
            <div className="space-y-6">
              <div className="border border-gray-200 rounded-2xl p-5 space-y-3 bg-gray-50/50 text-xs">
                <h4 className="text-sm font-extrabold text-[#032f28] pb-2 border-b border-gray-200">
                  Appointment Request Summary
                </h4>

                <div className="flex justify-between">
                  <span className="text-gray-500">Service:</span>
                  <span className="font-bold text-gray-800">{selectedService.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Practitioner:</span>
                  <span className="font-bold text-gray-800">{selectedProfessional.name} ({selectedProfessional.professionTitle})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Date & Slot:</span>
                  <span className="font-bold text-emerald-800">{bookingDate} • {selectedSlot.timeSlot}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Location:</span>
                  <span className="font-medium text-gray-800 text-right max-w-xs truncate">{serviceAddress}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-gray-200 text-sm">
                  <span className="font-bold text-gray-700">Estimated Visit Fee:</span>
                  <span className="font-black text-[#032f28]">₹{selectedProfessional.serviceFee} INR</span>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-xs text-blue-900 leading-relaxed flex items-start gap-2.5">
                <span className="material-symbols-outlined text-blue-700 text-lg shrink-0">info</span>
                <span>
                  Upon clicking <strong>Submit Appointment Request</strong>, your request will be delivered to {selectedProfessional.name}. Once the practitioner accepts your slot, you will receive a notification and real-time status update.
                </span>
              </div>

              <div className="pt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setBookingStep(2)}
                  className="text-xs font-bold text-gray-500 hover:text-gray-900 cursor-pointer"
                >
                  Edit Details
                </button>
                <button
                  type="button"
                  disabled={submittingBooking}
                  onClick={handleSubmitBooking}
                  className="bg-[#032f28] hover:bg-[#2e685d] text-white px-8 py-3 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-lg active:scale-95"
                >
                  {submittingBooking ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Submitting...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-base">check_circle</span>
                      <span>Submit Appointment Request</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── BOOKING CONFIRMATION SCREEN (Shown immediately upon successful submission) ── */}
      {activeTab === 'professionals' && bookingSuccessData && (
        <div className="max-w-xl mx-auto bg-white rounded-3xl border border-emerald-200 p-8 text-center shadow-lg">
          <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center mx-auto mb-4">
            <span className="material-symbols-outlined text-3xl">done_all</span>
          </div>

          <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 text-xs font-bold px-3 py-1 rounded-full mb-2">
            Status: REQUESTED (Awaiting Practitioner Confirmation)
          </span>

          <h2 className="text-xl font-extrabold text-[#032f28] mb-1">
            Appointment Successfully Requested!
          </h2>
          <p className="text-xs text-gray-500 mb-6">
            Appointment Reference: <strong className="font-mono text-gray-800">{bookingSuccessData.appointmentNumber}</strong>
          </p>

          <div className="bg-gray-50 rounded-2xl p-4 text-xs text-left space-y-2 mb-6 border border-gray-100">
            <div className="flex justify-between">
              <span className="text-gray-500">Service:</span>
              <span className="font-bold text-gray-800">{bookingSuccessData.serviceName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Practitioner:</span>
              <span className="font-bold text-gray-800">{bookingSuccessData.professional?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Scheduled:</span>
              <span className="font-bold text-emerald-800">{bookingSuccessData.scheduledDate} • {bookingSuccessData.timeSlot}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Visit Fee:</span>
              <span className="font-black text-[#032f28]">₹{bookingSuccessData.feeAmount}</span>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                setBookingSuccessData(null);
                setSelectedProfessional(null);
                setActiveTab('my-appointments');
                fetchMyAppointments();
              }}
              className="bg-[#032f28] text-white px-6 py-2.5 rounded-xl text-xs font-bold hover:bg-[#2e685d] transition-all"
            >
              View In My Appointments
            </button>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* TAB 3: MY APPOINTMENTS & TRACKING */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'my-appointments' && (
        <div>
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-xl font-bold text-[#032f28] flex items-center gap-2">
              <span>My Healthcare Appointments</span>
              <span className="text-xs font-semibold bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
                <RollingNumber value={myAppointments.length} /> Total
              </span>
            </h2>
            <button
              type="button"
              onClick={fetchMyAppointments}
              className="text-xs font-bold text-gray-600 hover:text-gray-900 flex items-center gap-1 bg-white border border-gray-300 px-3 py-1.5 rounded-xl shadow-xs"
            >
              <span className="material-symbols-outlined text-sm">refresh</span>
              <span>Refresh</span>
            </button>
          </div>

          {loadingAppointments ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-32 bg-gray-100 rounded-3xl animate-pulse" />
              ))}
            </div>
          ) : myAppointments.length === 0 ? (
            <div className="bg-white rounded-3xl border border-gray-200 p-12 text-center max-w-md mx-auto shadow-xs">
              <div className="w-16 h-16 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center mx-auto mb-4">
                <span className="material-symbols-outlined text-3xl">calendar_month</span>
              </div>
              <h3 className="text-base font-extrabold text-gray-800 mb-1">
                No Appointments Booked Yet
              </h3>
              <p className="text-xs text-gray-500 leading-relaxed mb-6">
                You haven't requested any healthcare visits yet. Discover clinical scopes and verified nurses from our catalogue.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('services')}
                className="bg-[#032f28] text-white px-5 py-2.5 rounded-xl text-xs font-bold hover:bg-[#2e685d] transition-all"
              >
                Browse Services Catalogue
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {myAppointments.map(apt => {
                const badge = getStatusBadge(apt.status);
                return (
                  <div
                    key={apt.id}
                    className="bg-white rounded-3xl border border-gray-200 p-6 shadow-xs hover:shadow-md transition-all flex flex-col md:flex-row md:items-center justify-between gap-6"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          style={{ background: badge.bg, color: badge.color }}
                          className="inline-flex items-center gap-1 text-[11px] font-extrabold px-3 py-1 rounded-full"
                        >
                          <span className="material-symbols-outlined text-xs">{badge.icon}</span>
                          <span>{badge.label}</span>
                        </span>
                        <span className="font-mono text-xs font-bold text-gray-400">
                          #{apt.appointmentNumber}
                        </span>
                      </div>

                      <h3 className="text-lg font-extrabold text-[#032f28]">
                        {apt.serviceName}
                      </h3>

                      <div className="flex items-center gap-4 text-xs text-gray-600 flex-wrap">
                        <span className="flex items-center gap-1 font-semibold">
                          <span className="material-symbols-outlined text-sm text-gray-400">person</span>
                          {apt.professional.name} ({apt.professional.professionTitle})
                        </span>
                        <span className="flex items-center gap-1 font-semibold text-emerald-800">
                          <span className="material-symbols-outlined text-sm text-emerald-600">event</span>
                          {apt.scheduledDate} • {apt.timeSlot}
                        </span>
                        <span className="font-black text-[#032f28]">
                          ₹{apt.feeAmount}
                        </span>
                      </div>

                      <p className="text-xs text-gray-500 truncate max-w-xl">
                        📍 {apt.serviceAddress}
                      </p>

                      {apt.cancellationReason && (
                        <p className="text-xs text-red-700 bg-red-50 p-2 rounded-xl inline-block">
                          <strong>Cancellation Reason:</strong> {apt.cancellationReason}
                        </p>
                      )}
                      {apt.rejectionReason && (
                        <p className="text-xs text-red-700 bg-red-50 p-2 rounded-xl inline-block">
                          <strong>Decline Reason:</strong> {apt.rejectionReason}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {['REQUESTED', 'ACCEPTED'].includes(apt.status) && (
                        <button
                          type="button"
                          onClick={() => setCancellingAppointmentId(apt.id)}
                          className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer"
                        >
                          Cancel
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setSelectedTrackingAppointment(apt)}
                        className="bg-[#032f28] hover:bg-[#2e685d] text-white px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-sm">visibility</span>
                        <span>Track Status</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* TAB 4: HUMAN CLINICAL ASSISTANCE (GATE 7) */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'clinical-assistance' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-3xl p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-sm">
            <div className="max-w-2xl space-y-2">
              <div className="inline-flex items-center gap-2 bg-emerald-200/60 text-[#032f28] px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
                <span className="material-symbols-outlined text-sm">clinical_notes</span>
                <span>Human-Operated Clinical Review</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-extrabold text-[#032f28]">
                Professional Human Clinical Assistance
              </h2>
              <p className="text-xs sm:text-sm text-gray-700 leading-relaxed">
                Describe your symptoms or health questions in <strong>Malayalam (മലയാളം)</strong>, <strong>English</strong>, or <strong>Hindi (हिन्दी)</strong> using voice or keyboard typing. A registered clinical professional will review your concern and provide personalized advice.
              </p>
              <div className="pt-1 flex items-center gap-4 text-[11px] text-gray-600">
                <span className="flex items-center gap-1 font-medium">
                  <span className="material-symbols-outlined text-emerald-700 text-sm">check_circle</span>
                  No prescription required
                </span>
                <span className="flex items-center gap-1 font-medium">
                  <span className="material-symbols-outlined text-emerald-700 text-sm">check_circle</span>
                  Separate from medicine checkout
                </span>
                <span className="flex items-center gap-1 font-medium">
                  <span className="material-symbols-outlined text-emerald-700 text-sm">check_circle</span>
                  Human reviewed
                </span>
              </div>
            </div>

            <button
              type="button"
              id="new-clinical-assistance-btn"
              onClick={() => setClinicalModalOpen(true)}
              className="bg-[#032f28] hover:bg-[#1e453e] text-white px-6 py-3.5 rounded-2xl text-xs sm:text-sm font-bold flex items-center gap-2 shadow-lg transition-all shrink-0 cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">add_circle</span>
              <span>New Clinical Request</span>
            </button>
          </div>

          {/* List of Previous Clinical Requests */}
          <div>
            <h3 className="text-lg font-bold text-[#032f28] mb-4 flex items-center gap-2">
              <span>Your Clinical Assistance Requests</span>
              <span className="text-xs font-semibold bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full">
                {clinicalRequests.length}
              </span>
            </h3>

            {loadingClinicalRequests ? (
              <div className="space-y-4">
                {[1, 2].map(i => (
                  <div key={i} className="h-28 bg-gray-100 rounded-2xl animate-pulse" />
                ))}
              </div>
            ) : clinicalRequests.length === 0 ? (
              <div className="bg-white rounded-3xl border border-gray-200 p-12 text-center max-w-xl mx-auto shadow-xs">
                <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto mb-4">
                  <span className="material-symbols-outlined text-3xl">clinical_notes</span>
                </div>
                <h4 className="text-base font-bold text-gray-800 mb-1">
                  No Clinical Inquiries Submitted Yet
                </h4>
                <p className="text-xs text-gray-500 leading-relaxed mb-6">
                  Have a question about symptoms or general health? Click the button above to speak or type in your preferred language.
                </p>
                <button
                  type="button"
                  onClick={() => setClinicalModalOpen(true)}
                  className="bg-[#032f28] hover:bg-[#1e453e] text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all"
                >
                  Describe a Health Concern
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {clinicalRequests.map((req) => {
                  const isResponded = req.status === 'RESPONDED';
                  return (
                    <div
                      key={req.id}
                      className="bg-white rounded-2xl border border-gray-200 p-5 shadow-xs transition-all space-y-3"
                    >
                      <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-gray-100">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-gray-500">REF:</span>
                          <span className="text-xs font-black text-[#032f28] tracking-wider">{req.requestNumber}</span>
                          <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-md bg-gray-100 text-gray-600">
                            {req.language} ({req.inputMethod})
                          </span>
                        </div>

                        <span className={`text-[11px] font-extrabold px-3 py-1 rounded-full flex items-center gap-1.5 ${
                          isResponded
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isResponded ? 'bg-emerald-600' : 'bg-amber-600 animate-pulse'}`} />
                          {isResponded ? 'Human Clinical Response Received' : 'Awaiting Clinician Review'}
                        </span>
                      </div>

                      {/* Preserved Original Concern */}
                      <div>
                        <span className="text-[11px] font-bold text-gray-500 block mb-1">Your Preserved Request:</span>
                        <p className="text-xs text-gray-800 bg-gray-50 p-3 rounded-xl border border-gray-100 italic leading-relaxed">
                          "{req.originalText}"
                        </p>
                      </div>

                      {/* Emergency Notice if attached */}
                      {req.isEmergency && (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-red-800">
                          <span className="material-symbols-outlined text-red-600 text-lg shrink-0">e911_emergency</span>
                          <div className="leading-relaxed">
                            <strong className="block text-red-700 font-bold mb-0.5">Emergency Triage Alert:</strong>
                            {req.emergencyGuidance}
                          </div>
                        </div>
                      )}

                      {/* Qualified Clinician Response */}
                      {isResponded ? (
                        <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-5 space-y-4">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <span className="text-xs font-bold text-[#032f28] flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-base text-emerald-700">verified</span>
                              <span>Response from Healthcare Professional:</span>
                            </span>
                            <div className="flex items-center gap-2">
                              {/* Assistive TTS "Read Aloud" Button */}
                              <button
                                type="button"
                                onClick={() => handleToggleSpeech(req.id, req.clinicianResponse, req.language)}
                                className="px-3 py-1 rounded-full bg-white text-[#032f28] border border-emerald-300 text-[11px] font-bold flex items-center gap-1 hover:bg-emerald-100 transition-colors shadow-xs cursor-pointer"
                                title="Listen to text advice read aloud (Elder-friendly)"
                              >
                                <span className="material-symbols-outlined text-sm text-emerald-700">
                                  {playingSpeechRequestId === req.id ? 'stop_circle' : 'volume_up'}
                                </span>
                                <span>{playingSpeechRequestId === req.id ? 'Stop Reading' : 'Listen Aloud'}</span>
                              </button>

                              {req.respondedAt && (
                                <span className="text-[10px] text-gray-500 font-mono">
                                  {new Date(req.respondedAt).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Pharmacist Recorded Voice Audio Guidance Player */}
                          {(req.voiceAudioUrl || req.hasVoiceMessage) && (
                            <div className="bg-white border-2 border-emerald-300/80 rounded-2xl p-3.5 shadow-sm space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                                    <span className="material-symbols-outlined text-base">mic</span>
                                  </div>
                                  <div>
                                    <span className="text-xs font-black text-[#032f28] block">
                                      🎙️ Pharmacist Spoken Voice Message
                                    </span>
                                    <span className="text-[10px] text-gray-500">
                                      Audio guidance recorded by the pharmacist for elder & audio accessibility
                                    </span>
                                  </div>
                                </div>
                                <span className="text-[9px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                                  Audio Guidance
                                </span>
                              </div>
                              <audio
                                controls
                                src={req.voiceAudioUrl || `/api/clinical-assistance/${req.id}/voice`}
                                className="w-full h-9 rounded-lg"
                                preload="metadata"
                              />
                            </div>
                          )}

                          <p className="text-xs sm:text-sm text-gray-800 leading-relaxed font-medium bg-white/70 p-3.5 rounded-xl border border-emerald-100">
                            {req.clinicianResponse}
                          </p>

                          {/* Recommended Medication with 1-Click "Reserve It" Button */}
                          {req.recommendedMedicine && (
                            <div className="bg-gradient-to-r from-teal-50 to-emerald-50 border-2 border-teal-300 rounded-2xl p-4 shadow-sm space-y-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-10 h-10 rounded-2xl bg-[#032f28] text-white flex items-center justify-center shrink-0 shadow-xs">
                                    <span className="material-symbols-outlined text-xl">medication</span>
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs sm:text-sm font-extrabold text-[#032f28]">
                                        {req.recommendedMedicine.brandName}
                                      </span>
                                      {req.recommendedMedicine.strength && (
                                        <span className="px-2 py-0.5 rounded-md bg-teal-100 text-teal-800 text-[10px] font-bold">
                                          {req.recommendedMedicine.strength}
                                        </span>
                                      )}
                                    </div>
                                    <span className="text-[11px] text-gray-600">
                                      {req.recommendedMedicine.genericName && `${req.recommendedMedicine.genericName} • `}
                                      {req.recommendedMedicine.dosageForm || 'Tablet'}
                                    </span>
                                  </div>
                                </div>

                                <div className="text-right shrink-0">
                                  <span className="text-sm sm:text-base font-black text-[#032f28] block">
                                    ₹{req.recommendedMedicine.price}
                                  </span>
                                  <span className="text-[10px] text-gray-500 font-medium">Unit Price</span>
                                </div>
                              </div>

                              {req.recommendedMedicine.instructions && (
                                <div className="bg-white/80 rounded-xl p-2.5 border border-teal-200/60 text-xs text-gray-700 flex items-start gap-2">
                                  <span className="material-symbols-outlined text-sm text-teal-700 shrink-0 mt-0.5">schedule</span>
                                  <span>
                                    <strong>Intake Regimen:</strong> {req.recommendedMedicine.instructions}
                                  </span>
                                </div>
                              )}

                              <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-t border-teal-200/60">
                                <span className="text-[11px] text-teal-900 font-medium flex items-center gap-1">
                                  <span className="material-symbols-outlined text-sm text-emerald-700">storefront</span>
                                  <span>Stocked at: <strong>{req.recommendedMedicine.pharmacyName || 'Assigned Pharmacy'}</strong></span>
                                </span>

                                <button
                                  type="button"
                                  disabled={reservingMedicineId === req.recommendedMedicine.medicineId}
                                  onClick={() => handleDirectReserveMedicine(req, req.recommendedMedicine)}
                                  className="px-4 py-2 rounded-xl bg-[#032f28] hover:bg-[#1e453e] text-white text-xs font-bold flex items-center gap-1.5 shadow-md transition-all cursor-pointer disabled:opacity-50"
                                >
                                  <span className="material-symbols-outlined text-sm">shopping_bag</span>
                                  <span>
                                    {reservingMedicineId === req.recommendedMedicine.medicineId
                                      ? 'Reserving...'
                                      : `Reserve It at ${req.recommendedMedicine.pharmacyName || 'Pharmacy'}`}
                                  </span>
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Gate 9: Patient Clinical Follow-Up Options */}
                          <div className="pt-2 border-t border-emerald-200/60 mt-3">
                            {req.followUpState ? (
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-bold text-gray-500">Your Follow-up Status:</span>
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-[#032f28] text-white">
                                  <span className="material-symbols-outlined text-xs">check</span>
                                  {req.followUpState.replace(/_/g, ' ')}
                                </span>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <span className="text-[11px] font-bold text-gray-600 block">
                                  Did this advice answer your concern? Let us know:
                                </span>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <button
                                    type="button"
                                    disabled={submittingClinicalFollowUp}
                                    onClick={() => handleClinicalFollowUp(req.id, 'RESOLVED')}
                                    className="px-3 py-1.5 rounded-xl bg-[#032f28] hover:bg-[#1e453e] text-white text-[11px] font-bold flex items-center gap-1 shadow-xs cursor-pointer transition-all"
                                  >
                                    <span className="material-symbols-outlined text-xs">thumb_up</span>
                                    <span>Resolved / Satisfied</span>
                                  </button>
                                  <button
                                    type="button"
                                    disabled={submittingClinicalFollowUp}
                                    onClick={() => handleClinicalFollowUp(req.id, 'NEEDS_MORE_HELP')}
                                    className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold flex items-center gap-1 shadow-xs cursor-pointer transition-all"
                                  >
                                    <span className="material-symbols-outlined text-xs">help</span>
                                    <span>Need More Help</span>
                                  </button>
                                  <button
                                    type="button"
                                    disabled={submittingClinicalFollowUp}
                                    onClick={() => handleClinicalFollowUp(req.id, 'PURCHASED_ELSEWHERE')}
                                    className="px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-[11px] font-bold flex items-center gap-1 shadow-xs cursor-pointer transition-all border border-gray-200"
                                  >
                                    <span className="material-symbols-outlined text-xs">local_pharmacy</span>
                                    <span>Obtained Elsewhere</span>
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="text-[11px] text-gray-500 flex items-center gap-1.5 italic">
                          <span className="material-symbols-outlined text-sm text-gray-400">schedule</span>
                          <span>No professional response recorded yet. Our clinical team reviews requests in order of receipt.</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Human Clinical Assistance Modal */}
      <HumanClinicalAssistanceModal
        isOpen={clinicalModalOpen}
        onClose={() => setClinicalModalOpen(false)}
        onRequestSubmitted={(newReq) => {
          setClinicalRequests(prev => [newReq, ...prev]);
        }}
      />

      {/* ── APPOINTMENT TRACKING & LIFECYCLE MODAL ── */}
      {selectedTrackingAppointment && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between pb-4 border-b border-gray-100 mb-6">
              <div>
                <span className="text-[10px] font-mono text-gray-400 block uppercase">
                  {selectedTrackingAppointment.appointmentNumber}
                </span>
                <h3 className="text-lg font-extrabold text-[#032f28]">
                  {selectedTrackingAppointment.serviceName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTrackingAppointment(null)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* Lifecycle Progress Stepper */}
            <div className="mb-6 bg-gray-50 p-4 rounded-2xl border border-gray-100">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-3">
                Appointment Progression
              </span>
              <div className="grid grid-cols-4 gap-1 text-center">
                {[
                  { key: 'REQUESTED', label: 'Requested', icon: 'schedule' },
                  { key: 'ACCEPTED', label: 'Accepted', icon: 'check_circle' },
                  { key: 'IN_PROGRESS', label: 'In Visit', icon: 'stethoscope' },
                  { key: 'COMPLETED', label: 'Finished', icon: 'verified' }
                ].map((step, idx) => {
                  const statusOrder = ['REQUESTED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED'];
                  const currentIndex = statusOrder.indexOf(selectedTrackingAppointment.status);
                  const stepIndex = statusOrder.indexOf(step.key);
                  const isCurrent = selectedTrackingAppointment.status === step.key;
                  const isPassed = currentIndex >= stepIndex && currentIndex !== -1;

                  return (
                    <div key={step.key} className="flex flex-col items-center">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold mb-1 transition-all ${
                        isCurrent
                          ? 'bg-emerald-600 text-white ring-4 ring-emerald-100'
                          : isPassed
                          ? 'bg-emerald-700 text-white'
                          : 'bg-gray-200 text-gray-500'
                      }`}>
                        <span className="material-symbols-outlined text-sm">{step.icon}</span>
                      </div>
                      <span className={`text-[10px] font-bold ${isCurrent ? 'text-emerald-800' : 'text-gray-500'}`}>
                        {step.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Appointment Details */}
            <div className="space-y-3 text-xs mb-6">
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500">Assigned Professional:</span>
                <span className="font-bold text-gray-800">
                  {selectedTrackingAppointment.professional?.name} ({selectedTrackingAppointment.professional?.professionTitle})
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500">Scheduled Date & Time:</span>
                <span className="font-bold text-emerald-800">
                  {selectedTrackingAppointment.scheduledDate} • {selectedTrackingAppointment.timeSlot}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="text-gray-500">Service Fee:</span>
                <span className="font-black text-[#032f28]">₹{selectedTrackingAppointment.feeAmount} INR</span>
              </div>
              <div className="py-1">
                <span className="text-gray-500 block mb-1">Destination Address:</span>
                <span className="font-medium text-gray-800 bg-gray-50 p-2.5 rounded-xl block">
                  {selectedTrackingAppointment.serviceAddress}
                </span>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedTrackingAppointment(null)}
                className="bg-gray-100 hover:bg-gray-200 text-gray-800 px-5 py-2 rounded-xl text-xs font-bold"
              >
                Close Tracking
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PATIENT CANCELLATION DIALOG ── */}
      {cancellingAppointmentId && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-base font-extrabold text-red-900 mb-2">
              Cancel Healthcare Appointment
            </h3>
            <p className="text-xs text-gray-600 mb-4">
              Please provide a reason for cancelling this appointment. The practitioner will be notified immediately.
            </p>
            <textarea
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Reason"
              className="w-full text-xs font-bold text-[#032f28] bg-white border border-gray-300 rounded-xl p-3 mb-4 shadow-xs"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={submittingCancel}
                onClick={() => { setCancellingAppointmentId(null); setCancelReason(''); }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100"
              >
                Nevermind
              </button>
              <button
                type="button"
                disabled={submittingCancel || !cancelReason.trim()}
                onClick={handleConfirmCancel}
                className="bg-red-600 hover:bg-red-700 text-white px-5 py-2 rounded-xl text-xs font-bold transition-all"
              >
                {submittingCancel ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DIRECT MEDICINE RESERVATION SUCCESS MODAL ── */}
      {reservationSuccessModal && (
        <div className="fixed inset-0 z-[1000] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 sm:p-7 max-w-md w-full shadow-2xl border border-emerald-200 space-y-4 text-[#032f28]">
            <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center mx-auto shadow-inner">
              <span className="material-symbols-outlined text-3xl">check_circle</span>
            </div>

            <div className="text-center space-y-1">
              <h3 className="text-lg font-black text-[#032f28]">
                Medication Reserved Successfully!
              </h3>
              <p className="text-xs text-gray-600">
                Your reservation hold has been submitted directly to <strong>{reservationSuccessModal.pharmacyName}</strong>.
              </p>
            </div>

            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center space-y-2">
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">
                Counter Pickup PIN
              </span>
              <div className="text-3xl font-black text-[#032f28] tracking-widest font-mono">
                {reservationSuccessModal.order.counterPin || '----'}
              </div>
              <p className="text-[10px] text-gray-500">
                Show this 4-digit PIN at the pharmacy counter to collect your medicine without waiting in verification queues.
              </p>
            </div>

            <div className="p-3 bg-gray-50 rounded-xl text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Order Ref:</span>
                <span className="font-bold font-mono">{reservationSuccessModal.order.orderNumber || reservationSuccessModal.order.id?.slice(0, 8)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Medication:</span>
                <span className="font-bold">{reservationSuccessModal.medicine.brandName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Amount Due:</span>
                <span className="font-bold text-emerald-800">₹{reservationSuccessModal.medicine.price}</span>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setReservationSuccessModal(null)}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold transition-colors cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  setReservationSuccessModal(null);
                  if (onNavigate) onNavigate('orders');
                }}
                className="flex-1 py-2.5 rounded-xl bg-[#032f28] hover:bg-[#1e453e] text-white text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1 shadow-xs"
              >
                <span>Track in Orders</span>
                <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
