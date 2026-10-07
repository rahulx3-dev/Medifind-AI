import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import ConfirmationDialog from '../components/ConfirmationDialog';
import LoadingSkeleton, { SkeletonMap } from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import FlowButton from '../components/FlowButton';
const FulfillmentMapBox = React.lazy(() => import('../components/FulfillmentMapBox'));

// ── Service Type Configuration ──────────────────────────────────────────────
const SERVICE_TYPE_CONFIG = {
  MEDICINE_COLLECTION: {
    label: 'Medicine Collection',
    icon: 'medication',
    color: '#2e685d',
    bg: '#e0f2eb',
    instruction: 'Collect the patient’s reserved medicine from the selected pharmacy.'
  },
  PHARMACY_VISIT: {
    label: 'Pharmacy Visit',
    icon: 'store',
    color: '#336c61',
    bg: '#b0ecdd',
    instruction: 'Visit the selected pharmacy and complete the requested pharmacy-access task.'
  },
  PHARMACY_COMPANION: {
    label: 'Pharmacy Companion',
    icon: 'group',
    color: '#1e453e',
    bg: '#c1ebe1',
    instruction: 'Meet and accompany the patient for the pharmacy visit.'
  },
  MEDICINE_DELIVERY: {
    label: 'Medicine Delivery',
    icon: 'home_pin',
    color: '#032f28',
    bg: '#e6f8f1',
    instruction: 'Collect the reserved medicine and assist with delivery to the patient.'
  },
  DIGITAL_ASSISTANCE: {
    label: 'Digital Assistance',
    icon: 'devices',
    color: '#2e685d',
    bg: '#e0f2eb',
    instruction: 'Help the patient navigate the MediFind process. Do not provide medical advice.'
  },
  PHARMACY_COMMS: {
    label: 'Pharmacy Communication',
    icon: 'forum',
    color: '#336c61',
    bg: '#b0ecdd',
    instruction: 'Assist with non-clinical communication with the participating pharmacy.'
  },
  RESTOCK_ASSISTANCE: {
    label: 'Restock Assistance',
    icon: 'inventory',
    color: '#1e453e',
    bg: '#c1ebe1',
    instruction: 'Assist the patient with the availability/restock process.'
  },
  PRESCRIPTION_ASSISTANCE: {
    label: 'Prescription Assistance',
    icon: 'upload_file',
    color: '#032f28',
    bg: '#e6f8f1',
    instruction: 'Help the patient capture/upload the prescription. Do not interpret or modify it.'
  }
};

function ServiceTypeBadge({ serviceType, size = 'sm' }) {
  if (!serviceType) return null;
  const cfg = SERVICE_TYPE_CONFIG[serviceType];
  if (!cfg) return null;
  const isLg = size === 'lg';
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.3rem',
      background: cfg.bg,
      color: cfg.color,
      border: `1px solid ${cfg.color}33`,
      borderRadius: 99,
      padding: isLg ? '0.3rem 0.85rem' : '0.2rem 0.6rem',
      fontSize: isLg ? 12 : 11,
      fontWeight: 700
    }}>
      <span className="material-symbols-outlined" style={{ fontSize: isLg ? 15 : 13 }}>{cfg.icon}</span>
      {cfg.label}
    </span>
  );
}

function getAssistantStepLabels(serviceType) {
  if (serviceType === 'MEDICINE_DELIVERY') {
    return {
      step2: '2. Collecting',
      step3: '3. In Transit',
      step4: '4. Handover PIN',
      btnCollecting: 'Arrived at Pharmacy • Begin Collection',
      btnInTransit: 'Prescription Collected • In Transit to Patient',
      btnDelivered: 'Arrived at Doorstep • Request Patient PIN'
    };
  }
  if (serviceType === 'MEDICINE_COLLECTION') {
    return {
      step2: '2. Collecting',
      step3: '3. Ready for Handover',
      step4: '4. Handover PIN',
      btnCollecting: 'Arrived at Pharmacy • Collect Medicine',
      btnInTransit: 'Medicine Collected • Ready for Handover',
      btnDelivered: 'Ready at Handover Point • Request Patient PIN'
    };
  }
  return {
    step2: '2. Initiated',
    step3: '3. In Progress',
    step4: '4. Service PIN',
    btnCollecting: 'Arrived / Initiated • Start Assistance',
    btnInTransit: 'Assistance Active • Mark In Progress',
    btnDelivered: 'Assistance Concluded • Request Confirmation PIN'
  };
}

function AssistantPinKeypad({ task, pin = '', onChangePin, onSubmit, onResendSms, onCallDispatch }) {
  const pressKey = (num) => {
    if (pin.length < 4) {
      const next = pin + num;
      onChangePin(next);
      // Auto-submit when 4th digit entered (state update is async, use timeout)
      if (next.length === 4) {
        setTimeout(() => onSubmit(), 150);
      }
    }
  };

  const clearKeypad = () => {
    onChangePin('');
  };

  const deleteKey = () => {
    if (pin.length > 0) {
      onChangePin(pin.slice(0, -1));
    }
  };

  return (
    <div style={{
      background: '#ffffff',
      borderRadius: 24,
      padding: '1.75rem',
      boxShadow: '0 8px 32px rgba(3,47,40,0.08)',
      border: '2px solid #2e685d',
      display: 'flex',
      flexDirection: 'column',
      gap: '1.25rem',
      marginTop: '1rem'
    }}>
      {/* Operational Protocol Banner */}
      <div style={{
        background: '#e6f8f1',
        padding: '0.85rem 1.25rem',
        borderRadius: 16,
        border: '1px solid #d5e6e0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '0.75rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2e685d', display: 'inline-block' }}></span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#2e685d', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {task.serviceType === 'MEDICINE_DELIVERY'
              ? 'STATUS: ARRIVED AT DESTINATION • PENDING RECIPIENT PIN'
              : 'STATUS: SERVICE READY FOR CONFIRMATION • PENDING PATIENT PIN'}
          </span>
        </div>
        <span style={{ fontSize: 11, color: '#414846', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 15, color: '#2e685d' }}>encrypted</span>
          Custody Handshake Protocol v3.1
        </span>
      </div>

      {/* Chain of Custody Route Pill Bar */}
      <div style={{
        background: '#f8fafc',
        padding: '0.85rem 1.25rem',
        borderRadius: 16,
        border: '1px solid #e0f2eb',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '0.75rem',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#d5e6e0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2e685d', flexShrink: 0 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>local_pharmacy</span>
          </div>
          <div>
            <span style={{ display: 'block', fontSize: 10, color: '#717976', textTransform: 'uppercase', fontWeight: 700 }}>Origin</span>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28' }}>{task.pharmacy?.name || 'Local Dispensary'}</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#032f28', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', flexShrink: 0 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>pin_drop</span>
          </div>
          <div>
            <span style={{ display: 'block', fontSize: 10, color: '#717976', textTransform: 'uppercase', fontWeight: 700 }}>Handover Checkpoint</span>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28' }}>{task.deliveryAddress || 'Patient Address'}</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#b0ecdd', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#336c61', flexShrink: 0 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>inventory_2</span>
          </div>
          <div>
            <span style={{ display: 'block', fontSize: 10, color: '#717976', textTransform: 'uppercase', fontWeight: 700 }}>
              {task.serviceType === 'MEDICINE_DELIVERY' || task.serviceType === 'MEDICINE_COLLECTION' ? 'Sealed Pouch Ref' : 'Task Reference'}
            </span>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28' }}>#TL-{task.id.slice(0, 4).toUpperCase()}</span>
          </div>
        </div>
      </div>

      {/* Header Info */}
      <div style={{ textAlign: 'center', maxWidth: 440, margin: '0 auto' }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#e0f2eb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#032f28', margin: '0 auto 0.5rem auto' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 24 }}>dialpad</span>
        </div>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#032f28', margin: '0 0 0.25rem 0' }}>
          {task.serviceType === 'MEDICINE_DELIVERY' ? 'Delivery Handover Verification' : 'Service Handover Verification'}
        </h3>
        <p style={{ fontSize: 12, color: '#414846', margin: 0, lineHeight: 1.5 }}>
          {task.serviceType === 'MEDICINE_DELIVERY'
            ? 'Ask the recipient or authorized concierge for their 4-digit pickup PIN provided in their MediFind order confirmation.'
            : 'Ask the patient for their 4-digit verification PIN provided in their MediFind order confirmation.'}
        </p>
      </div>

      {/* 4 PIN Display Boxes — masked for security */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', margin: '0.5rem 0' }}>
        {[0, 1, 2, 3].map(idx => {
          const isFilled = !!pin[idx];
          return (
            <div
              key={idx}
              style={{
                width: 54,
                height: 68,
                borderRadius: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: isFilled ? 32 : 20,
                fontWeight: 800,
                background: isFilled ? '#b0ecdd' : '#e6f8f1',
                color: '#032f28',
                border: isFilled ? '2px solid #2e685d' : '1px solid #c0c8c5',
                boxShadow: isFilled ? '0 0 0 3px #2e685d22' : 'inset 0 2px 4px rgba(0,0,0,0.05)',
                transition: 'all 0.18s cubic-bezier(0.4,0,0.2,1)',
                transform: isFilled ? 'scale(1.04)' : 'scale(1)'
              }}
            >
              {/* Show filled dot (masked) or placeholder dot */}
              <span style={{ lineHeight: 1 }}>{isFilled ? '●' : '○'}</span>
            </div>
          );
        })}
      </div>

      {/* Cryptographic Assurance Note */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', textAlign: 'center' }}>
        <span className="material-symbols-outlined" style={{ fontSize: 15, color: '#2e685d' }}>lock</span>
        <span style={{ fontSize: 11, color: '#717976' }}>
          PIN is verified server-side. Never ask recipient for personal passwords.
        </span>
      </div>

      {/* Soft Tactile Keypad */}
      <div style={{ maxWidth: 280, margin: '0 auto', width: '100%', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.65rem' }}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(num => (
          <button
            key={num}
            type="button"
            onClick={() => pressKey(num)}
            style={{
              height: 52,
              borderRadius: 16,
              background: '#e6f8f1',
              border: '1px solid #c0c8c5',
              color: '#032f28',
              fontSize: 20,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
              transition: 'all 0.15s'
            }}
          >
            {num}
          </button>
        ))}
        <button
          type="button"
          onClick={clearKeypad}
          style={{
            height: 52,
            borderRadius: 16,
            background: '#d5e6e0',
            border: 'none',
            color: '#414846',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          CLR
        </button>
        <button
          type="button"
          onClick={() => pressKey('0')}
          style={{
            height: 52,
            borderRadius: 16,
            background: '#e6f8f1',
            border: '1px solid #c0c8c5',
            color: '#032f28',
            fontSize: 20,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 4px rgba(0,0,0,0.04)'
          }}
        >
          0
        </button>
        <button
          type="button"
          onClick={deleteKey}
          style={{
            height: 52,
            borderRadius: 16,
            background: '#d5e6e0',
            border: 'none',
            color: '#414846',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>backspace</span>
        </button>
      </div>

      {/* Primary Action CTA */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
        <FlowButton
          type="button"
          disabled={pin.length < 4}
          onClick={onSubmit}
          fullWidth
          style={{ maxWidth: 360 }}
        >
          {task.serviceType === 'MEDICINE_DELIVERY' ? 'Verify PIN & Confirm Delivery Handover' : 'Verify PIN & Complete Service Handover'}
        </FlowButton>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={onResendSms}
            style={{ background: 'none', border: 'none', color: '#2e685d', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>sms</span>
            <span>Resend PIN via SMS</span>
          </button>
          <span style={{ color: '#c0c8c5' }}>•</span>
          <button
            type="button"
            onClick={onCallDispatch}
            style={{ background: 'none', border: 'none', color: '#717976', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
          >
            Report Issue / Call Dispatch
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AssistantPortal({ currentTab, onTabChange }) {
  const { user } = useAuth();
  const [internalTab, setInternalTab] = useState('available'); // 'available' | 'active' | 'completed'
  const tab = currentTab !== undefined ? currentTab : internalTab;
  const setTab = onTabChange || setInternalTab;
  const [availableTasks, setAvailableTasks] = useState([]);
  const [myTasks, setMyTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [handoverPinMap, setHandoverPinMap] = useState({});
  const [regionName, setRegionName] = useState('Chengannur / Alappuzha, Kerala');
  const [profile, setProfile] = useState(null);
  const [editingCapabilities, setEditingCapabilities] = useState(false);
  const [selectedCapabilities, setSelectedCapabilities] = useState([]);

  // Inline feedback alert
  const [feedback, setFeedback] = useState({ show: false, message: '', type: 'success' });

  // Confirmation dialog
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    variant: 'primary',
    onConfirm: () => {}
  });

  const showToast = (message, type = 'success') => {
    setFeedback({ show: true, message, type });
    setTimeout(() => setFeedback({ show: false, message: '', type: 'success' }), 4000);
  };

  useEffect(() => {
    async function fetchConfig() {
      try {
        const res = await fetch('/api/pharmacies/config');
        const data = await res.json();
        if (data.success && data.config?.regionName) {
          setRegionName(data.config.regionName);
        }
      } catch (e) {}
    }
    fetchConfig();
  }, []);

  async function fetchProfile() {
    const token = localStorage.getItem('medifind_token');
    if (!token) return;
    try {
      const res = await fetch('/api/assistant/profile', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.profile) {
        setProfile(data.profile);
        setSelectedCapabilities(data.profile.capabilities || []);
      }
    } catch (e) {
      console.error('Failed to load assistant profile:', e);
    }
  }

  const handleToggleAvailability = async () => {
    if (!profile) return;
    const token = localStorage.getItem('medifind_token');
    const newStatus = !profile.isAvailable;
    try {
      const res = await fetch('/api/assistant/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ isAvailable: newStatus })
      });
      const data = await res.json();
      if (data.success && data.profile) {
        setProfile(data.profile);
        showToast(`Duty status updated: ${newStatus ? 'Active & Available' : 'Paused / Offline'}.`, 'success');
        fetchTasks();
      } else {
        showToast(data.error || 'Failed to update duty status.', 'error');
      }
    } catch (e) {
      showToast('Error updating duty status.', 'error');
    }
  };

  const handleSaveCapabilities = async () => {
    if (!profile) return;
    if (selectedCapabilities.length === 0) {
      showToast('You must select at least one supported service capability.', 'warning');
      return;
    }
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch('/api/assistant/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ capabilities: selectedCapabilities })
      });
      const data = await res.json();
      if (data.success && data.profile) {
        setProfile(data.profile);
        setEditingCapabilities(false);
        showToast('Service capabilities updated successfully.', 'success');
        fetchTasks();
      } else {
        showToast(data.error || 'Failed to update capabilities.', 'error');
      }
    } catch (e) {
      showToast('Error saving capabilities.', 'error');
    }
  };

  useEffect(() => {
    fetchProfile();
    fetchTasks();
  }, [user]);

  async function fetchTasks() {
    setLoading(true);
    const token = localStorage.getItem('medifind_token');
    try {
      const availRes = await fetch('/api/assistant/available', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const availData = await availRes.json();
      if (availData.success) {
        setAvailableTasks(availData.tasks || []);
      }

      const myRes = await fetch('/api/assistant/my-tasks', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const myData = await myRes.json();
      if (myData.success) {
        setMyTasks(myData.tasks || []);
      }
    } catch (err) {
      console.error('Error fetching assistant tasks:', err);
      showToast('Network error while refreshing tasks.', 'error');
    } finally {
      setLoading(false);
    }
  }

  // Accept task
  const handleAcceptTask = async (taskId) => {
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch(`/api/assistant/tasks/${taskId}/accept`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.success) {
        showToast('Task accepted! It is now in your Active Service Tasks queue.', 'success');
        fetchTasks();
        setTab('active');
      } else {
        showToast(data.error || 'Failed to accept task.', 'error');
      }
    } catch (err) {
      console.error('Error accepting task:', err);
      showToast('Error communicating with server.', 'error');
    }
  };

  // Progress task status
  const handleProgressTask = async (taskId, nextStatus) => {
    const token = localStorage.getItem('medifind_token');
    const handoverPin = handoverPinMap[taskId];

    if (nextStatus === 'CONFIRMED' && (!handoverPin || handoverPin.length < 4)) {
      showToast('Recipient 4-digit handover PIN is required to complete service handover.', 'error');
      return;
    }

    try {
      const res = await fetch(`/api/assistant/tasks/${taskId}/progress`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: nextStatus, handoverPin })
      });
      const data = await res.json();
      if (data.success) {
        showToast(
          nextStatus === 'CONFIRMED'
            ? 'Handover PIN verified! Service task successfully confirmed and recorded.'
            : `Task progressed to ${nextStatus.replace(/_/g, ' ')}.`,
          'success'
        );
        fetchTasks();
      } else {
        showToast(data.error || 'Failed to progress task.', 'error');
      }
    } catch (err) {
      console.error('Error progressing task:', err);
      showToast('Error communicating with server.', 'error');
    }
  };

  const activeTasks = myTasks.filter(task => task.status !== 'CONFIRMED');
  const completedTasks = myTasks.filter(task => task.status === 'CONFIRMED');
  const primaryActiveTask = activeTasks[0];

  return (
    <div style={{ background: '#ecfdf7', minHeight: '100vh', paddingBottom: '4rem' }}>
      {/* Toast Feedback */}
      {feedback.show && (
        <div style={{
          position: 'fixed',
          top: '5.5rem',
          right: '1.5rem',
          zIndex: 9999,
          background: feedback.type === 'error' ? '#ffdad6' : feedback.type === 'warning' ? '#ffdad4' : '#e0f2eb',
          color: feedback.type === 'error' ? '#ba1a1a' : feedback.type === 'warning' ? '#5a0100' : '#032f28',
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
            {feedback.type === 'error' ? 'error' : feedback.type === 'warning' ? 'warning' : 'check_circle'}
          </span>
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Main Container */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '2rem 1.5rem' }}>
        {/* Top Workspace Context & Status Banner */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1.5rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  background: '#d5e6e0',
                  color: '#032f28',
                  padding: '0.2rem 0.65rem',
                  borderRadius: 99,
                  fontSize: 11,
                  fontWeight: 700
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2e685d' }}></span>
                  Dispatch Service Connected
                </span>
                <span style={{
                  background: '#b0ecdd',
                  color: '#336c61',
                  padding: '0.2rem 0.65rem',
                  borderRadius: 99,
                  fontSize: 11,
                  fontWeight: 700
                }}>
                  Zone: {regionName} (5.0 km radius)
                </span>
                <span style={{
                  background: '#e0f2eb',
                  color: '#2e685d',
                  padding: '0.2rem 0.65rem',
                  borderRadius: 99,
                  fontSize: 11,
                  fontWeight: 700
                }}>
                  Participating Network • Chengannur
                </span>
              </div>
              <h1 style={{ fontSize: 32, fontWeight: 700, color: '#032f28', margin: 0, letterSpacing: '-0.02em' }}>
                Medicine Access Assistant Dashboard
              </h1>
              <p style={{ fontSize: 15, color: '#414846', margin: '0.35rem 0 0 0' }}>
                Coordinate secure medicine access services — collection, pharmacy visits, companion assistance, digital support, and handover-verified tasks.
              </p>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button
                onClick={fetchTasks}
                style={{
                  background: '#ffffff',
                  color: '#032f28',
                  border: '1px solid #c0c8c5',
                  borderRadius: 99,
                  padding: '0.55rem 1.15rem',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>sync</span>
                <span>Refresh Tasks</span>
              </button>
            </div>
          </div>

          {/* Assistant Duty & Capability Console Bar */}
          <div style={{
            background: '#ffffff',
            borderRadius: 18,
            padding: '1rem 1.25rem',
            border: '1px solid #d5e6e0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
            boxShadow: '0 1px 4px rgba(3,47,40,0.04)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: profile?.isAvailable ? '#e0f2eb' : '#ffdad6',
                color: profile?.isAvailable ? '#2e685d' : '#ba1a1a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: 22 }}>
                  {profile?.isAvailable ? 'support_agent' : 'person_off'}
                </span>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#032f28' }}>
                    {profile?.name || user?.name || 'Registered Assistant'}
                  </span>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '0.15rem 0.55rem',
                    borderRadius: 99,
                    background: profile?.isAvailable ? '#b0ecdd' : '#ffdad6',
                    color: profile?.isAvailable ? '#00201b' : '#ba1a1a'
                  }}>
                    {profile?.isAvailable ? 'ACTIVE DUTY • AVAILABLE' : 'DUTY PAUSED • OFFLINE'}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#717976', marginTop: 3 }}>
                  Supported Services: <strong>{(profile?.capabilities || []).length} / 8</strong> canonical types
                  {profile?.bio ? ` • “${profile.bio}”` : ''}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleToggleAvailability}
                style={{
                  background: profile?.isAvailable ? '#e0f2eb' : '#032f28',
                  color: profile?.isAvailable ? '#032f28' : '#ffffff',
                  border: '1px solid #c0c8c5',
                  borderRadius: 99,
                  padding: '0.45rem 1rem',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                  {profile?.isAvailable ? 'toggle_on' : 'toggle_off'}
                </span>
                <span>{profile?.isAvailable ? 'Set to Offline' : 'Set to Active Duty'}</span>
              </button>

              <button
                type="button"
                onClick={() => setEditingCapabilities(true)}
                style={{
                  background: '#ffffff',
                  color: '#032f28',
                  border: '1px solid #c0c8c5',
                  borderRadius: 99,
                  padding: '0.45rem 1rem',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>tune</span>
                <span>Manage Capabilities</span>
              </button>
            </div>
          </div>

          {/* Active Custody Persistent Banner if there is an active task */}
          {primaryActiveTask && (
            <div style={{
              background: '#032f28',
              color: '#ffffff',
              borderRadius: 20,
              padding: '1.25rem 1.5rem',
              boxShadow: '0 8px 24px rgba(3,47,40,0.18)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '1rem',
              position: 'relative',
              overflow: 'hidden'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#1e453e', color: '#c1ebe1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 24 }}>electric_moped</span>
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ background: '#2e685d', color: '#ffffff', fontSize: 11, fontWeight: 700, padding: '0.15rem 0.6rem', borderRadius: 99, textTransform: 'uppercase' }}>
                      Active Custody
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#c1ebe1' }}>
                      Task #{primaryActiveTask.id.slice(0, 8).toUpperCase()}
                    </span>
                    <span style={{ fontSize: 12, color: '#8ab2a9' }}>
                      Order #{primaryActiveTask.orderId?.slice(0, 8).toUpperCase()}
                    </span>
                  </div>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: 13, color: '#d5e6e0' }}>
                    Status: <strong style={{ color: '#ffffff' }}>{primaryActiveTask.status.replace(/_/g, ' ')}</strong> • Service destination: {primaryActiveTask.deliveryAddress || 'See task details'}. Handover requires customer 4-digit PIN.
                  </p>
                </div>
              </div>

              <FlowButton
                onClick={() => setTab('active')}
                variant="secondary"
                size="md"
                style={{ background: '#b0ecdd', color: '#00201b', '--fb-circle-bg': '#032f28', '--fb-color': '#00201b', '--fb-border': 'rgba(3,47,40,0.25)' }}
              >
                Manage Handover
              </FlowButton>
            </div>
          )}

          {/* Metric Summary Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginTop: '0.5rem' }}>
            <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.25rem', border: '1px solid #e0f2eb', boxShadow: '0 1px 4px rgba(3,47,40,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#717976' }}>
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Available Tasks</span>
                <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#2e685d' }}>assignment_turned_in</span>
              </div>
              <div style={{ fontSize: 32, fontWeight: 700, color: '#032f28', marginTop: '0.35rem' }}>
                {availableTasks.length}
              </div>
              <span style={{ fontSize: 12, color: '#717976' }}>Awaiting assistant acceptance</span>
            </div>

            <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.25rem', border: '1px solid #e0f2eb', boxShadow: '0 1px 4px rgba(3,47,40,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#717976' }}>
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>My Active Service Tasks</span>
                <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#336c61' }}>near_me</span>
              </div>
              <div style={{ fontSize: 32, fontWeight: 700, color: '#2e685d', marginTop: '0.35rem' }}>
                {activeTasks.length}
              </div>
              <span style={{ fontSize: 12, color: '#717976' }}>In progress / pending handover</span>
            </div>

            <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.25rem', border: '1px solid #e0f2eb', boxShadow: '0 1px 4px rgba(3,47,40,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#717976' }}>
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Completed Service Tasks</span>
                <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#2e685d' }}>verified</span>
              </div>
              <div style={{ fontSize: 32, fontWeight: 700, color: '#032f28', marginTop: '0.35rem' }}>
                {completedTasks.length}
              </div>
              <span style={{ fontSize: 12, color: '#717976' }}>Handover-verified completions</span>
            </div>

            <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.25rem', border: '1px solid #e0f2eb', boxShadow: '0 1px 4px rgba(3,47,40,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#717976' }}>
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Relay Status</span>
                <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#2e685d' }}>sensors</span>
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#032f28', marginTop: '0.35rem' }}>
                Active Guard
              </div>
              <span style={{ fontSize: 12, color: '#2e685d', fontWeight: 600 }}>Role-isolated task dispatch</span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          background: '#ffffff',
          padding: '0.4rem',
          borderRadius: 99,
          border: '1px solid #e0f2eb',
          width: 'fit-content',
          marginBottom: '1.5rem',
          boxShadow: '0 1px 4px rgba(3,47,40,0.04)'
        }}>
          <button
            onClick={() => setTab('available')}
            style={{
              background: tab === 'available' ? '#032f28' : 'transparent',
              color: tab === 'available' ? '#ffffff' : '#414846',
              border: 'none',
              borderRadius: 99,
              padding: '0.5rem 1.25rem',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem'
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>schedule</span>
            <span>Available Requests ({availableTasks.length})</span>
          </button>

          <button
            onClick={() => setTab('active')}
            style={{
              background: tab === 'active' ? '#032f28' : 'transparent',
              color: tab === 'active' ? '#ffffff' : '#414846',
              border: 'none',
              borderRadius: 99,
              padding: '0.5rem 1.25rem',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem'
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>electric_moped</span>
            <span>My Active Service Tasks ({activeTasks.length})</span>
          </button>

          <button
            onClick={() => setTab('completed')}
            style={{
              background: tab === 'completed' ? '#032f28' : 'transparent',
              color: tab === 'completed' ? '#ffffff' : '#414846',
              border: 'none',
              borderRadius: 99,
              padding: '0.5rem 1.25rem',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem'
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>task_alt</span>
            <span>Completed Archive ({completedTasks.length})</span>
          </button>
        </div>

        {/* TAB 1: AVAILABLE TASKS */}
        {tab === 'available' && (
          <div>
            {profile && (!profile.isAvailable || !profile.isActive) && (
              <div style={{
                background: '#fff8f6',
                border: '1px solid #ffdad6',
                borderRadius: 14,
                padding: '0.85rem 1.25rem',
                marginBottom: '1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '0.75rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <span className="material-symbols-outlined" style={{ color: '#ba1a1a', fontSize: 20 }}>pause_circle</span>
                  <span style={{ fontSize: 12, color: '#414846' }}>
                    <strong>Duty status paused:</strong> You are marked as unavailable. You will not see incoming requests until you switch to Active Duty.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleToggleAvailability}
                  style={{
                    background: '#032f28',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 99,
                    padding: '0.35rem 0.85rem',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Go On Duty
                </button>
              </div>
            )}

            {loading ? (
              <LoadingSkeleton variant="order-card" count={2} />
            ) : availableTasks.length === 0 ? (
              <EmptyState
                icon="assignment_turned_in"
                title="No Open Service Requests"
                description="There are currently no unassigned medicine access service requests in this zone. Check back shortly as new orders are placed."
                actionLabel="Refresh Network"
                onAction={fetchTasks}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {availableTasks.map(task => {
                  return (
                    <article
                      key={task.id}
                      style={{
                        background: '#ffffff',
                        borderRadius: 20,
                        border: '1px solid #e0f2eb',
                        boxShadow: '0 1px 4px rgba(3,47,40,0.04)',
                        padding: '1.5rem',
                        position: 'relative',
                        overflow: 'hidden'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                            <span style={{ fontSize: 16, fontWeight: 700, color: '#032f28' }}>
                              Task #{task.id.slice(0, 8).toUpperCase()}
                            </span>
                            <span style={{
                              background: '#b0ecdd',
                              color: '#336c61',
                              borderRadius: 99,
                              padding: '0.2rem 0.65rem',
                              fontSize: 11,
                              fontWeight: 700
                            }}>
                              OPEN FOR ACCEPTANCE
                            </span>
                            {task.order?.isEmergency && (
                              <span style={{ background: '#ffdad6', color: '#93000a', borderRadius: 99, padding: '0.2rem 0.65rem', fontSize: 11, fontWeight: 700 }}>
                                EMERGENCY PRIORITY
                              </span>
                            )}
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.75rem', fontSize: 13, color: '#414846' }}>
                            {/* Service Type Badge */}
                            {task.serviceType && (
                              <div style={{ marginBottom: '0.25rem' }}>
                                <ServiceTypeBadge serviceType={task.serviceType} size="lg" />
                              </div>
                            )}

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>store</span>
                              <strong style={{ color: '#032f28' }}>Pharmacy:</strong>
                              <span>{task.pharmacy?.name || 'Local Pharmacy Node'}</span>
                              <span style={{ fontSize: 12, color: '#717976' }}>({task.pharmacy?.address || 'Dispensary Counter'})</span>
                            </div>

                            {task.deliveryAddress && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>home_pin</span>
                                <strong style={{ color: '#032f28' }}>Service Location:</strong>
                                <span>{task.deliveryAddress}</span>
                              </div>
                            )}

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>medication</span>
                              <span>Order Package: {task.order?.items?.length || 1} prescription item(s)</span>
                            </div>

                            {/* Service-specific instruction */}
                            {task.serviceType && SERVICE_TYPE_CONFIG[task.serviceType] && (
                              <div style={{
                                marginTop: '0.5rem',
                                background: '#f5faf8',
                                border: '1px solid #d5e6e0',
                                borderRadius: 10,
                                padding: '0.55rem 0.85rem',
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '0.45rem'
                              }}>
                                <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#2e685d', flexShrink: 0, marginTop: 1 }}>task_alt</span>
                                <span style={{ fontSize: 12, color: '#032f28', lineHeight: 1.5 }}>
                                  <strong>Your task:</strong> {SERVICE_TYPE_CONFIG[task.serviceType].instruction}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Accept CTA */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                          <FlowButton
                            onClick={() => {
                              const serviceCfg = SERVICE_TYPE_CONFIG[task.serviceType] || {
                                label: 'Medicine Access Assistant',
                                instruction: 'Assist the patient with non-clinical medicine access.'
                              };
                              setConfirmDialog({
                                isOpen: true,
                                title: `Accept Service Task: ${serviceCfg.label}`,
                                message: serviceCfg.instruction,
                                impactPoints: [
                                  `Service: ${serviceCfg.label}`,
                                  `Pharmacy: ${task.pharmacy?.name || 'Local Community Pharmacy'}`,
                                  'Non-clinical assistance only: do not provide medical advice or modify prescriptions.'
                                ],
                                confirmLabel: 'Accept & Begin Service',
                                variant: 'primary',
                                onConfirm: () => handleAcceptTask(task.id)
                              });
                            }}
                            size="md"
                          >
                            Accept Service Task
                          </FlowButton>
                          <span style={{ fontSize: 11, color: '#717976' }}>Requires 4-digit recipient PIN upon handover</span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: MY ACTIVE DELIVERIES */}
        {tab === 'active' && (
          <div>
            {loading ? (
              <LoadingSkeleton variant="order-card" count={1} />
            ) : activeTasks.length === 0 ? (
              <EmptyState
                icon="support_agent"
                title="No Active Service Tasks"
                description="You do not currently have any service tasks in progress. Accept an open request to get started."
                actionLabel="Browse Available Tasks"
                onAction={() => setTab('available')}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {activeTasks.map(task => {
                  const isAssigned = task.status === 'ASSIGNED';
                  const isAccepted = task.status === 'ACCEPTED';
                  const isCollecting = task.status === 'COLLECTING';
                  const isInTransit = task.status === 'IN_TRANSIT';
                  const isDelivered = task.status === 'DELIVERED';
                  const isDelivery = task.serviceType === 'MEDICINE_DELIVERY';
                  const isCollection = task.serviceType === 'MEDICINE_COLLECTION';
                  const isPhysical = isDelivery || isCollection;
                  const stepLabels = getAssistantStepLabels(task.serviceType);

                  return (
                    <article
                      key={task.id}
                      style={{
                        background: '#ffffff',
                        borderRadius: 24,
                        border: '2px solid #2e685d',
                        boxShadow: '0 8px 24px rgba(3,47,40,0.08)',
                        padding: '1.75rem',
                        position: 'relative'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
                            <span style={{ fontSize: 18, fontWeight: 700, color: '#032f28' }}>
                              Task #{task.id.slice(0, 8).toUpperCase()}
                            </span>
                            <span style={{
                              background: isAssigned ? '#ffbe0b' : '#2e685d',
                              color: isAssigned ? '#432800' : '#ffffff',
                              borderRadius: 99,
                              padding: '0.2rem 0.75rem',
                              fontSize: 11,
                              fontWeight: 700
                            }}>
                              {isAssigned ? 'Assigned (Pending Acceptance)' : task.status.replace(/_/g, ' ')}
                            </span>
                            {task.serviceType && <ServiceTypeBadge serviceType={task.serviceType} />}
                          </div>
                          <p style={{ fontSize: 13, color: '#414846', margin: 0 }}>
                            Order Ref: #{task.orderId?.slice(0, 8).toUpperCase()} • Recipient: {task.order?.user?.name || 'Registered Patient'}
                          </p>
                          {/* Service-specific instruction for active tasks */}
                          {task.serviceType && SERVICE_TYPE_CONFIG[task.serviceType] && (
                            <div style={{
                              marginTop: '0.5rem',
                              background: '#f5faf8',
                              border: '1px solid #d5e6e0',
                              borderRadius: 10,
                              padding: '0.5rem 0.8rem',
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: '0.4rem'
                            }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#2e685d', flexShrink: 0, marginTop: 1 }}>task_alt</span>
                              <span style={{ fontSize: 12, color: '#032f28', lineHeight: 1.5 }}>
                                {SERVICE_TYPE_CONFIG[task.serviceType].instruction}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Quick Contact buttons */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {task.pharmacy?.phone && (
                            <a
                              href={`tel:${task.pharmacy.phone}`}
                              style={{
                                background: '#e6f8f1',
                                color: '#032f28',
                                border: '1px solid #c0c8c5',
                                borderRadius: 99,
                                padding: '0.35rem 0.75rem',
                                fontSize: 12,
                                fontWeight: 600,
                                textDecoration: 'none',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.25rem'
                              }}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 15 }}>call</span>
                              <span>Call Pharmacy</span>
                            </a>
                          )}
                          {task.order?.user?.phone && (
                            <a
                              href={`tel:${task.order.user.phone}`}
                              style={{
                                background: '#e6f8f1',
                                color: '#032f28',
                                border: '1px solid #c0c8c5',
                                borderRadius: 99,
                                padding: '0.35rem 0.75rem',
                                fontSize: 12,
                                fontWeight: 600,
                                textDecoration: 'none',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.25rem'
                              }}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 15 }}>call</span>
                              <span>Call Patient</span>
                            </a>
                          )}
                        </div>
                      </div>

                      {/* Stepper Timeline */}
                      <div style={{ background: '#e6f8f1', borderRadius: 16, padding: '1rem 1.25rem', marginBottom: '1.5rem', border: '1px solid #d5e6e0' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', textAlign: 'center' }}>
                          <div>
                            <div style={{ width: 28, height: 28, borderRadius: '50%', background: isAssigned ? '#ffbe0b' : '#032f28', color: isAssigned ? '#432800' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.25rem auto' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{isAssigned ? 'schedule' : 'check'}</span>
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#032f28' }}>{isAssigned ? '1. Assigned Request' : '1. Accepted'}</span>
                          </div>
                          <div>
                            <div style={{ width: 28, height: 28, borderRadius: '50%', background: isCollecting || isInTransit || isDelivered ? '#032f28' : '#c0c8c5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.25rem auto' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{isPhysical ? 'inventory' : 'play_circle'}</span>
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: isCollecting || isInTransit || isDelivered ? '#032f28' : '#717976' }}>{stepLabels.step2}</span>
                          </div>
                          <div>
                            <div style={{ width: 28, height: 28, borderRadius: '50%', background: isInTransit || isDelivered ? '#032f28' : '#c0c8c5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.25rem auto' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{isDelivery ? 'electric_moped' : isCollection ? 'handshake' : 'sync'}</span>
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: isInTransit || isDelivered ? '#032f28' : '#717976' }}>{stepLabels.step3}</span>
                          </div>
                          <div>
                            <div style={{ width: 28, height: 28, borderRadius: '50%', background: isDelivered ? '#032f28' : '#c0c8c5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.25rem auto' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>key</span>
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: isDelivered ? '#032f28' : '#717976' }}>{stepLabels.step4}</span>
                          </div>
                        </div>
                      </div>

                      {/* MapLibre Active Fulfillment Route Map */}
                      <div style={{ marginBottom: '1.25rem' }}>
                        <React.Suspense fallback={<SkeletonMap height="200px" />}>
                          <FulfillmentMapBox
                            pharmacy={task.pharmacy}
                            destination={
                              task.deliveryAddress
                                ? {
                                    address: task.deliveryAddress,
                                    latitude: task.destinationLatitude ?? null,
                                    longitude: task.destinationLongitude ?? null
                                  }
                                : null
                            }
                            orderStatus={task.status}
                            height="200px"
                          />
                        </React.Suspense>
                      </div>

                      {/* Location & Routing Details */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                        <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: 14, border: '1px solid #e0f2eb' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#717976', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            {isPhysical ? 'Step A: Dispensary Collection' : 'Step A: Participating Pharmacy'}
                          </span>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#032f28', marginTop: '0.25rem' }}>
                            {task.pharmacy?.name || 'Local Pharmacy'}
                          </div>
                          <div style={{ fontSize: 12, color: '#414846', marginTop: '0.2rem' }}>
                            {task.pharmacy?.address || 'Counter staged in Bin B4'}
                          </div>
                        </div>

                        <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: 14, border: '1px solid #e0f2eb' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#717976', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            {isDelivery ? 'Step B: Patient Destination' : isCollection ? 'Step B: Handover Point' : 'Step B: Patient Contact'}
                          </span>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#032f28', marginTop: '0.25rem' }}>
                            {task.order?.user?.name || 'Patient Recipient'}
                          </div>
                          <div style={{ fontSize: 12, color: '#414846', marginTop: '0.2rem' }}>
                            {task.deliveryAddress || (isCollection ? 'Pharmacy Handover Point' : 'Assistance via MediFind / In-Person')}
                          </div>
                        </div>
                      </div>

                      {/* Progress Buttons & Handover PIN Verification */}
                      <div style={{ background: '#ffffff', borderTop: '1px solid #e0f2eb', paddingTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
                        <div>
                          {isAssigned && (
                            <FlowButton
                              onClick={() => handleAcceptTask(task.id)}
                              iconLeft="check_circle"
                              size="md"
                            >
                              Accept Patient Booking Request
                            </FlowButton>
                          )}

                          {isAccepted && (
                            <FlowButton
                              onClick={() => handleProgressTask(task.id, 'COLLECTING')}
                              size="md"
                            >
                              {stepLabels.btnCollecting}
                            </FlowButton>
                          )}

                          {isCollecting && (
                            <FlowButton
                              onClick={() => handleProgressTask(task.id, 'IN_TRANSIT')}
                              size="md"
                            >
                              {stepLabels.btnInTransit}
                            </FlowButton>
                          )}

                          {isInTransit && (
                            <FlowButton
                              onClick={() => handleProgressTask(task.id, 'DELIVERED')}
                              size="md"
                              style={{ background: '#2e685d', color: '#ffffff', '--fb-circle-bg': '#ffffff', '--fb-color': '#ffffff', '--fb-color-hover': '#032f28', '--fb-border': 'transparent' }}
                            >
                              {stepLabels.btnDelivered}
                            </FlowButton>
                          )}
                        </div>

                        {/* Handover PIN verification widget / Keypad toggle */}
                        {(isDelivered || isInTransit) && (
                          <div style={{ width: '100%', marginTop: '1rem' }}>
                            <AssistantPinKeypad
                              task={task}
                              pin={handoverPinMap[task.id] || ''}
                              onChangePin={(newPin) => setHandoverPinMap(prev => ({ ...prev, [task.id]: newPin }))}
                              onSubmit={() => {
                                const handoverPin = handoverPinMap[task.id];
                                if (!handoverPin || handoverPin.length < 4) {
                                  showToast(
                                    isDelivery
                                      ? 'Recipient 4-digit handover PIN is required to complete delivery confirmation.'
                                      : 'Patient 4-digit verification PIN is required to complete service confirmation.',
                                    'error'
                                  );
                                  return;
                                }
                                setConfirmDialog({
                                  isOpen: true,
                                  title: isDelivery
                                    ? 'Confirm Delivery Handover?'
                                    : isCollection
                                    ? 'Confirm Medicine Handover?'
                                    : 'Confirm Service Completion?',
                                  message: isDelivery
                                    ? `Verify PIN "${handoverPin}" and attest that the cold-chain sealed package has been safely handed over to the recipient?`
                                    : isCollection
                                    ? `Verify PIN "${handoverPin}" and attest that the collected medicine has been safely handed over to the patient?`
                                    : `Verify PIN "${handoverPin}" and confirm that the ${SERVICE_TYPE_CONFIG[task.serviceType]?.label || 'assistance'} task has been fully completed?`,
                                  confirmLabel: isDelivery ? 'Confirm Handover & Complete' : 'Confirm Service & Complete',
                                  variant: 'primary',
                                  impactPoints: isDelivery ? [
                                    'Chain of custody transfer will be permanently logged in audit trail.',
                                    'Task and associated order will transition to Completed status.'
                                  ] : [
                                    'Service completion will be permanently logged in audit trail.',
                                    'Task and associated order will transition to Completed status.'
                                  ],
                                  onConfirm: () => handleProgressTask(task.id, 'CONFIRMED')
                                });
                              }}
                              onResendSms={() => showToast('SMS verification reminder dispatched to recipient phone.', 'success')}
                              onCallDispatch={() => showToast('Priority dispatch bridge dialed for Task #' + task.id.slice(0, 8), 'success')}
                            />
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: COMPLETED ARCHIVE */}
        {tab === 'completed' && (
          <div>
            {loading ? (
              <LoadingSkeleton variant="order-card" count={2} />
            ) : completedTasks.length === 0 ? (
              <EmptyState
                icon="task_alt"
                title="No Completed Service Tasks Yet"
                description="Completed tasks with verified PINs will appear here in your permanent dispatch archive."
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {completedTasks.map(task => (
                  <div
                    key={task.id}
                    style={{
                      background: '#ffffff',
                      borderRadius: 18,
                      border: '1px solid #e0f2eb',
                      padding: '1.25rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '1rem'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: '#032f28' }}>
                          Task #{task.id.slice(0, 8).toUpperCase()}
                        </span>
                        <span style={{ background: '#e0f2eb', color: '#2e685d', borderRadius: 99, padding: '0.15rem 0.55rem', fontSize: 11, fontWeight: 700 }}>
                          CONFIRMED HANDOVER
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#717976', marginTop: '0.25rem' }}>
                        {task.deliveryAddress ? `Destination: ${task.deliveryAddress}` : (task.serviceType ? SERVICE_TYPE_CONFIG[task.serviceType]?.label : 'Assistant Service')} • Order #{task.orderId?.slice(0, 8).toUpperCase()}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#2e685d', fontSize: 12, fontWeight: 700 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>verified</span>
                      <span>Handoff PIN Verified</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Capability Selection Modal */}
      {editingCapabilities && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 20,
            maxWidth: 580,
            width: '100%',
            padding: '1.75rem',
            boxShadow: '0 12px 36px rgba(0,0,0,0.2)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#032f28', margin: 0 }}>
                Manage Supported Service Capabilities
              </h3>
              <button
                type="button"
                onClick={() => setEditingCapabilities(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#717976' }}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <p style={{ fontSize: 12, color: '#414846', marginTop: 0, marginBottom: '1rem' }}>
              Select which non-clinical service types you are available and authorized to fulfill. Only tasks matching your selected capabilities will be shown in your dispatch feed.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: 340, overflowY: 'auto', marginBottom: '1.25rem' }}>
              {Object.keys(SERVICE_TYPE_CONFIG).map(typeKey => {
                const cfg = SERVICE_TYPE_CONFIG[typeKey];
                const isChecked = selectedCapabilities.includes(typeKey);
                return (
                  <label
                    key={typeKey}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.75rem',
                      padding: '0.65rem 0.85rem',
                      borderRadius: 12,
                      border: isChecked ? '1px solid #2e685d' : '1px solid #e0f2eb',
                      background: isChecked ? '#f5faf8' : '#ffffff',
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {
                        setSelectedCapabilities(prev =>
                          prev.includes(typeKey)
                            ? prev.filter(k => k !== typeKey)
                            : [...prev, typeKey]
                        );
                      }}
                      style={{ marginTop: 3 }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#032f28' }}>{cfg.label}</span>
                        <ServiceTypeBadge serviceType={typeKey} size="sm" />
                      </div>
                      <div style={{ fontSize: 11, color: '#717976', marginTop: 2 }}>{cfg.instruction}</div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setEditingCapabilities(false)}
                style={{
                  background: '#f8fafc',
                  color: '#414846',
                  border: '1px solid #c0c8c5',
                  borderRadius: 99,
                  padding: '0.5rem 1.25rem',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCapabilities}
                style={{
                  background: '#032f28',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 99,
                  padding: '0.5rem 1.25rem',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Save Capabilities
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        impactPoints={confirmDialog.impactPoints || []}
        confirmLabel={confirmDialog.confirmLabel}
        variant={confirmDialog.variant}
        onConfirm={() => {
          confirmDialog.onConfirm();
          setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        }}
        onCancel={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
