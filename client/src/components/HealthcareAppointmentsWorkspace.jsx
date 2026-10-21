import React, { useState, useEffect } from 'react';

export default function HealthcareAppointmentsWorkspace({ profile, onToast }) {
  const [activeTab, setActiveTab] = useState('requests'); // 'requests', 'scheduled', 'history', 'schedule'
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(false);

  // Status transition states
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [cancellingId, setCancellingId] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [processingId, setProcessingId] = useState(null);

  // Schedule configuration state
  const [workingDays, setWorkingDays] = useState(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']);
  const [workingHoursStart, setWorkingHoursStart] = useState('09:00');
  const [workingHoursEnd, setWorkingHoursEnd] = useState('17:00');
  const [slotDurationMinutes, setSlotDurationMinutes] = useState(60);
  const [serviceFee, setServiceFee] = useState(250);
  const [savingSchedule, setSavingSchedule] = useState(false);

  useEffect(() => {
    fetchAppointments();
    if (profile) {
      if (profile.workingDays) {
        try {
          const parsed = typeof profile.workingDays === 'string' ? JSON.parse(profile.workingDays) : profile.workingDays;
          if (Array.isArray(parsed)) setWorkingDays(parsed);
        } catch (e) {}
      }
      if (profile.workingHoursStart) setWorkingHoursStart(profile.workingHoursStart);
      if (profile.workingHoursEnd) setWorkingHoursEnd(profile.workingHoursEnd);
      if (profile.slotDurationMinutes) setSlotDurationMinutes(profile.slotDurationMinutes);
      if (profile.serviceFee != null) setServiceFee(profile.serviceFee);
    }
  }, [profile]);

  async function fetchAppointments() {
    setLoading(true);
    try {
      const token = localStorage.getItem('medifind_token');
      const res = await fetch('/api/appointments/professional', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setAppointments(data.appointments || []);
      } else {
        onToast(data.error || 'Failed to load appointments.', 'error');
      }
    } catch (err) {
      console.error('fetchAppointments error:', err);
      onToast('Network error loading clinical appointments.', 'error');
    } finally {
      setLoading(false);
    }
  }

  // Handle status transitions: ACCEPT, REJECT, START, COMPLETE, CANCEL
  async function handleStatusTransition(id, action, reason = null) {
    setProcessingId(id);
    try {
      const token = localStorage.getItem('medifind_token');
      const res = await fetch(`/api/appointments/${id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ action, reason })
      });
      const data = await res.json();
      if (data.success) {
        onToast(data.message || `Appointment updated to ${action}.`, 'success');
        setRejectingId(null);
        setRejectReason('');
        setCancellingId(null);
        setCancelReason('');
        fetchAppointments();
      } else {
        onToast(data.error || `Failed to update appointment.`, 'error');
      }
    } catch (err) {
      console.error('handleStatusTransition error:', err);
      onToast('Network error updating appointment status.', 'error');
    } finally {
      setProcessingId(null);
    }
  }

  // Save Schedule settings
  async function handleSaveSchedule(e) {
    e.preventDefault();
    setSavingSchedule(true);
    try {
      const token = localStorage.getItem('medifind_token');
      const res = await fetch('/api/appointments/professional/schedule', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          workingDays,
          workingHoursStart,
          workingHoursEnd,
          slotDurationMinutes: Number(slotDurationMinutes),
          serviceFee: Number(serviceFee)
        })
      });
      const data = await res.json();
      if (data.success) {
        onToast('Schedule & availability saved successfully!', 'success');
      } else {
        onToast(data.error || 'Failed to save schedule.', 'error');
      }
    } catch (err) {
      console.error('handleSaveSchedule error:', err);
      onToast('Network error saving schedule.', 'error');
    } finally {
      setSavingSchedule(false);
    }
  }

  const pendingRequests = appointments.filter(a => a.status === 'REQUESTED');
  const activeAppointments = appointments.filter(a => ['ACCEPTED', 'IN_PROGRESS'].includes(a.status));
  const historyAppointments = appointments.filter(a => ['COMPLETED', 'CANCELLED', 'REJECTED'].includes(a.status));

  const allDays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

  const toggleDay = (day) => {
    if (workingDays.includes(day)) {
      if (workingDays.length === 1) {
        onToast('You must select at least one operating day.', 'warning');
        return;
      }
      setWorkingDays(workingDays.filter(d => d !== day));
    } else {
      setWorkingDays([...workingDays, day]);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-emerald-200/80 p-6 sm:p-8 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-4 mb-6 pb-4 border-b border-gray-100">
        <div>
          <h2 className="text-xl font-extrabold text-[#032f28] flex items-center gap-2">
            <span>Healthcare Professional Clinical Workspace</span>
            <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-2.5 py-0.5 rounded-full">
              Phase 3 Live
            </span>
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Manage upcoming in-home nursing requests, progress scheduled patient visits, and configure availability.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchAppointments}
          className="text-xs font-bold text-gray-600 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 border border-gray-200 px-3 py-1.5 rounded-xl flex items-center gap-1.5 shadow-xs transition-all"
        >
          <span className="material-symbols-outlined text-sm">sync</span>
          <span>Refresh Bookings</span>
        </button>
      </div>

      {/* ── Sub Navigation Tabs ── */}
      <div className="flex items-center gap-2 mb-6 flex-wrap bg-gray-50 p-1.5 rounded-2xl border border-gray-100">
        <button
          type="button"
          onClick={() => setActiveTab('requests')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
            activeTab === 'requests'
              ? 'bg-[#032f28] text-white shadow-xs'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <span className="material-symbols-outlined text-base">notifications</span>
          <span>Pending Requests</span>
          {pendingRequests.length > 0 && (
            <span className="bg-amber-500 text-white text-[10px] font-black px-1.5 py-0.2 rounded-full">
              {pendingRequests.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('scheduled')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
            activeTab === 'scheduled'
              ? 'bg-[#032f28] text-white shadow-xs'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <span className="material-symbols-outlined text-base">calendar_month</span>
          <span>Scheduled &amp; In-Progress</span>
          {activeAppointments.length > 0 && (
            <span className="bg-emerald-600 text-white text-[10px] font-black px-1.5 py-0.2 rounded-full">
              {activeAppointments.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
            activeTab === 'history'
              ? 'bg-[#032f28] text-white shadow-xs'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <span className="material-symbols-outlined text-base">history</span>
          <span>Completed &amp; History ({historyAppointments.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('schedule')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
            activeTab === 'schedule'
              ? 'bg-[#032f28] text-white shadow-xs'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <span className="material-symbols-outlined text-base">tune</span>
          <span>Schedule &amp; Availability</span>
        </button>
      </div>

      {/* ── TAB 1: PENDING REQUESTS ── */}
      {activeTab === 'requests' && (
        <div className="space-y-4">
          {loading ? (
            <div className="h-32 bg-gray-100 rounded-2xl animate-pulse" />
          ) : pendingRequests.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-500 bg-gray-50 rounded-2xl border border-gray-100">
              <span className="material-symbols-outlined text-3xl text-gray-400 block mb-2">mark_chat_read</span>
              No pending appointment requests. New requests from patients will appear here for your confirmation.
            </div>
          ) : (
            pendingRequests.map(apt => (
              <div
                key={apt.id}
                className="bg-amber-50/40 border border-amber-200/80 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="bg-amber-100 text-amber-900 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase">
                      New Request
                    </span>
                    <span className="font-mono text-xs text-gray-400">#{apt.appointmentNumber}</span>
                  </div>
                  <h4 className="text-base font-extrabold text-[#032f28]">{apt.serviceName}</h4>
                  <div className="text-xs text-gray-700 flex items-center gap-3 flex-wrap">
                    <span><strong>Patient:</strong> {apt.patient?.name} ({apt.patient?.phone})</span>
                    <span><strong>Date:</strong> {apt.scheduledDate} • {apt.timeSlot}</span>
                    <span><strong>Fee:</strong> ₹{apt.feeAmount}</span>
                  </div>
                  <p className="text-xs text-gray-600">
                    📍 <strong>Destination:</strong> {apt.serviceAddress}
                  </p>
                  {apt.patientNotes && (
                    <p className="text-xs text-gray-600 italic">
                      📝 "{apt.patientNotes}"
                    </p>
                  )}
                  {apt.prescription && (
                    <p className="text-xs text-emerald-800 font-semibold flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">attachment</span>
                      Attached Clinician Order: {apt.prescription.originalFileName}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={processingId === apt.id}
                    onClick={() => setRejectingId(apt.id)}
                    className="bg-white hover:bg-red-50 text-red-700 border border-red-300 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    Decline
                  </button>

                  <button
                    type="button"
                    disabled={processingId === apt.id}
                    onClick={() => handleStatusTransition(apt.id, 'ACCEPT')}
                    className="bg-[#032f28] hover:bg-[#2e685d] text-white px-5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <span className="material-symbols-outlined text-sm">check</span>
                    <span>Accept Appointment</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── TAB 2: SCHEDULED & IN PROGRESS ── */}
      {activeTab === 'scheduled' && (
        <div className="space-y-4">
          {loading ? (
            <div className="h-32 bg-gray-100 rounded-2xl animate-pulse" />
          ) : activeAppointments.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-500 bg-gray-50 rounded-2xl border border-gray-100">
              <span className="material-symbols-outlined text-3xl text-gray-400 block mb-2">event_available</span>
              No accepted or in-progress visits. Accepted appointment requests will move here.
            </div>
          ) : (
            activeAppointments.map(apt => (
              <div
                key={apt.id}
                className={`border rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                  apt.status === 'IN_PROGRESS'
                    ? 'bg-emerald-50/60 border-emerald-300'
                    : 'bg-white border-gray-200'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase ${
                      apt.status === 'IN_PROGRESS'
                        ? 'bg-emerald-200 text-emerald-900'
                        : 'bg-blue-100 text-blue-900'
                    }`}>
                      {apt.status === 'IN_PROGRESS' ? '● Visit In Progress' : 'Accepted • Scheduled'}
                    </span>
                    <span className="font-mono text-xs text-gray-400">#{apt.appointmentNumber}</span>
                  </div>
                  <h4 className="text-base font-extrabold text-[#032f28]">{apt.serviceName}</h4>
                  <div className="text-xs text-gray-700 flex items-center gap-3 flex-wrap">
                    <span><strong>Patient:</strong> {apt.patient?.name} ({apt.patient?.phone})</span>
                    <span><strong>Scheduled:</strong> {apt.scheduledDate} • {apt.timeSlot}</span>
                    <span><strong>Fee:</strong> ₹{apt.feeAmount}</span>
                  </div>
                  <p className="text-xs text-gray-700 font-medium">
                    📍 <strong>Patient Location:</strong> {apt.serviceAddress}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {apt.status === 'ACCEPTED' && (
                    <>
                      <button
                        type="button"
                        disabled={processingId === apt.id}
                        onClick={() => setCancellingId(apt.id)}
                        className="bg-white hover:bg-gray-100 text-red-600 border border-gray-200 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={processingId === apt.id}
                        onClick={() => handleStatusTransition(apt.id, 'START')}
                        className="bg-[#032f28] hover:bg-[#2e685d] text-white px-5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                      >
                        <span className="material-symbols-outlined text-sm">play_arrow</span>
                        <span>Start Clinical Visit</span>
                      </button>
                    </>
                  )}

                  {apt.status === 'IN_PROGRESS' && (
                    <button
                      type="button"
                      disabled={processingId === apt.id}
                      onClick={() => handleStatusTransition(apt.id, 'COMPLETE')}
                      className="bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md"
                    >
                      <span className="material-symbols-outlined text-base">verified</span>
                      <span>Complete Clinical Visit</span>
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── TAB 3: COMPLETED & HISTORY ── */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          {historyAppointments.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-500 bg-gray-50 rounded-2xl border border-gray-100">
              No historical appointments recorded yet.
            </div>
          ) : (
            historyAppointments.map(apt => (
              <div
                key={apt.id}
                className="bg-gray-50/60 border border-gray-200 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                      apt.status === 'COMPLETED'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {apt.status}
                    </span>
                    <span className="font-mono text-gray-400">#{apt.appointmentNumber}</span>
                  </div>
                  <h5 className="text-sm font-extrabold text-[#032f28]">{apt.serviceName}</h5>
                  <p className="text-gray-500">
                    Patient: {apt.patient?.name} • Date: {apt.scheduledDate} • Fee: ₹{apt.feeAmount}
                  </p>
                  {apt.rejectionReason && (
                    <p className="text-red-700 mt-1">Declined Reason: {apt.rejectionReason}</p>
                  )}
                  {apt.cancellationReason && (
                    <p className="text-red-700 mt-1">Cancellation Reason: {apt.cancellationReason}</p>
                  )}
                </div>
                <div className="text-right text-[11px] text-gray-400">
                  Updated: {new Date(apt.updatedAt).toLocaleDateString()}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── TAB 4: SCHEDULE & AVAILABILITY CONFIGURATION ── */}
      {activeTab === 'schedule' && (
        <form onSubmit={handleSaveSchedule} className="space-y-6 max-w-xl">
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
              1. Operating Days of the Week
            </label>
            <div className="flex flex-wrap gap-2">
              {allDays.map(day => {
                const isSelected = workingDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                      isSelected
                        ? 'bg-[#032f28] text-white border-[#032f28]'
                        : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {day.slice(0, 3)}
                  </button>
                );
              })}
            </div>
            <span className="text-[11px] text-gray-500 block mt-1.5">
              Patients can only schedule appointments on your selected working days.
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                Daily Start Hour (HH:MM)
              </label>
              <input
                type="text"
                pattern="^\d{2}:\d{2}$"
                value={workingHoursStart}
                onChange={(e) => setWorkingHoursStart(e.target.value)}
                placeholder="09:00"
                className="w-full text-xs font-bold text-gray-800 bg-white border border-gray-300 rounded-xl p-2.5 shadow-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                Daily End Hour (HH:MM)
              </label>
              <input
                type="text"
                pattern="^\d{2}:\d{2}$"
                value={workingHoursEnd}
                onChange={(e) => setWorkingHoursEnd(e.target.value)}
                placeholder="17:00"
                className="w-full text-xs font-bold text-gray-800 bg-white border border-gray-300 rounded-xl p-2.5 shadow-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                Appointment Slot Duration
              </label>
              <select
                value={slotDurationMinutes}
                onChange={(e) => setSlotDurationMinutes(Number(e.target.value))}
                className="w-full text-xs font-bold text-gray-800 bg-white border border-gray-300 rounded-xl p-2.5 shadow-xs"
              >
                <option value={30}>30 Minutes</option>
                <option value={45}>45 Minutes</option>
                <option value={60}>60 Minutes (Standard)</option>
                <option value={90}>90 Minutes</option>
                <option value={120}>120 Minutes</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                Custom Base Visit Fee (INR)
              </label>
              <input
                type="number"
                min="0"
                max="10000"
                value={serviceFee}
                onChange={(e) => setServiceFee(e.target.value)}
                className="w-full text-xs font-bold text-gray-800 bg-white border border-gray-300 rounded-xl p-2.5 shadow-xs"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={savingSchedule}
              className="bg-[#032f28] hover:bg-[#2e685d] text-white px-6 py-2.5 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
            >
              {savingSchedule ? (
                <span>Saving Schedule...</span>
              ) : (
                <>
                  <span className="material-symbols-outlined text-base">save</span>
                  <span>Save Schedule &amp; Working Hours</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* ── REJECTION REASON MODAL ── */}
      {rejectingId && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl">
            <h4 className="text-base font-extrabold text-red-900 mb-2">Decline Appointment Request</h4>
            <p className="text-xs text-gray-600 mb-3">
              Please enter an explanation for the patient.
            </p>
            <textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason"
              className="w-full text-xs font-bold text-[#032f28] bg-white border border-gray-300 rounded-xl p-3 mb-4 shadow-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setRejectingId(null); setRejectReason(''); }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!rejectReason.trim()}
                onClick={() => handleStatusTransition(rejectingId, 'REJECT', rejectReason.trim())}
                className="bg-red-600 hover:bg-red-700 text-white px-5 py-2 rounded-xl text-xs font-bold transition-all"
              >
                Confirm Decline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CANCELLATION REASON MODAL ── */}
      {cancellingId && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl">
            <h4 className="text-base font-extrabold text-red-900 mb-2">Emergency Appointment Cancellation</h4>
            <p className="text-xs text-gray-600 mb-3">
              Please state why you are cancelling this accepted visit.
            </p>
            <textarea
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Reason"
              className="w-full text-xs font-bold text-[#032f28] bg-white border border-gray-300 rounded-xl p-3 mb-4 shadow-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setCancellingId(null); setCancelReason(''); }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!cancelReason.trim()}
                onClick={() => handleStatusTransition(cancellingId, 'CANCEL', cancelReason.trim())}
                className="bg-red-600 hover:bg-red-700 text-white px-5 py-2 rounded-xl text-xs font-bold transition-all"
              >
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
