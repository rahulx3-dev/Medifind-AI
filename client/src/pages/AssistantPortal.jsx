import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useAuth } from '../context/AuthContext';
import ConfirmationDialog from '../components/ConfirmationDialog';
import LoadingSkeleton, { SkeletonMap } from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import FlowButton from '../components/FlowButton';
import { broadcastUpdate, useRealtimeRefresh } from '../utils/realtimeUpdates';
import HealthcareAppointmentsWorkspace from '../components/HealthcareAppointmentsWorkspace';
import { playKeypadClickSound } from '../utils/audioFeedback';
import { usePortalGreeting } from '../utils/greetingUtils';
import AnimatedStatCard from '../components/ui/AnimatedStatCard';
import RollingNumber from '../components/ui/RollingNumber';
const FulfillmentMapBox = React.lazy(() => import('../components/FulfillmentMapBox'));

// ── Service Type Configuration (Dedicated Delivery Only for Delivery Assistants) ──
const SERVICE_TYPE_CONFIG = {
  MEDICINE_DELIVERY: {
    label: 'Medicine Delivery',
    icon: 'local_shipping',
    color: '#032f28',
    bg: '#e6f8f1',
    instruction: 'Collect reserved medicine and complete secure doorstep delivery with PIN verification.'
  },
  MEDICINE_COLLECTION: {
    label: 'Medicine Collection',
    icon: 'medication',
    color: '#2e685d',
    bg: '#e0f2eb',
    instruction: 'Collect the patient’s reserved medicine from the selected pharmacy.'
  }
};

const DELIVERY_CAPABILITIES_CONFIG = {
  MEDICINE_DELIVERY: {
    label: 'Medicine Delivery',
    icon: 'local_shipping',
    color: '#032f28',
    bg: '#e6f8f1',
    instruction: 'Collect the reserved prescription from participating pharmacies and complete secure doorstep delivery with 4-digit PIN verification.'
  }
};

// ── Kerala Town GPS Presets for Geocoded Assistant Coverage ──
export const KERALA_TOWN_PRESETS = [
  { name: 'Chengannur Town', lat: 9.3170, lon: 76.6145, district: 'Alappuzha' },
  { name: 'Kallissery', lat: 9.3250, lon: 76.6200, district: 'Alappuzha' },
  { name: 'Pandanad', lat: 9.3320, lon: 76.5980, district: 'Alappuzha' },
  { name: 'Budhanoor', lat: 9.3080, lon: 76.5620, district: 'Alappuzha' },
  { name: 'Ala', lat: 9.3020, lon: 76.6180, district: 'Alappuzha' },
  { name: 'Mannar', lat: 9.3120, lon: 76.5380, district: 'Alappuzha' },
  { name: 'Mavelikara', lat: 9.2650, lon: 76.5510, district: 'Alappuzha' },
  { name: 'Haripad', lat: 9.2350, lon: 76.4700, district: 'Alappuzha' },
  { name: 'Kayamkulam', lat: 9.1720, lon: 76.5000, district: 'Alappuzha' },
  { name: 'Thiruvalla', lat: 9.3830, lon: 76.5740, district: 'Pathanamthitta' },
  { name: 'Kozhencherry', lat: 9.3410, lon: 76.7110, district: 'Pathanamthitta' },
  { name: 'Aranmula', lat: 9.3070, lon: 76.6850, district: 'Pathanamthitta' },
  { name: 'Adoor', lat: 9.1530, lon: 76.7330, district: 'Pathanamthitta' }
];

export function findNearestKeralaTown(lat, lon) {
  let closest = KERALA_TOWN_PRESETS[0];
  let minDist = Infinity;
  for (const t of KERALA_TOWN_PRESETS) {
    const d = Math.hypot(t.lat - lat, t.lon - lon);
    if (d < minDist) {
      minDist = d;
      closest = t;
    }
  }
  return closest;
}

// Candidate Clinical Service Catalogue for Healthcare Professionals (Phase 1 Foundation)
const FUTURE_CLINICAL_SERVICES = {
  NURSING_VISIT: {
    label: 'Nursing In-Home Visit',
    icon: 'home_health',
    description: 'Scheduled home assessment and patient support within approved nursing scope.',
    requirements: 'Registered Nurse (RN) / GNM Council Registration'
  },
  VITAL_SIGN_MEASUREMENT: {
    label: 'Vital Signs & Health Monitoring',
    icon: 'ecg_heart',
    description: 'In-person measurement of BP, pulse, temperature, oxygen saturation, and blood glucose.',
    requirements: 'Clinical Care Nurse / Paramedic / GNM'
  },
  POST_HOSPITAL_CARE: {
    label: 'Post-Hospitalization Recovery Support',
    icon: 'accessible_forward',
    description: 'Assisting recovering patients with mobility support, non-invasive rehabilitation, and recovery monitoring.',
    requirements: 'Registered Nurse / Physical Therapist'
  },
  WOUND_CARE_ASSISTANCE: {
    label: 'Eligible Clean Wound Dressing Support',
    icon: 'healing',
    description: 'Aseptic changing of clean, non-surgical superficial dressings under documented clinical protocol.',
    requirements: 'Registered Nurse (RN) with wound care certification'
  },
  HOME_NURSING_SUPPORT: {
    label: 'General Home Nursing Support',
    icon: 'medical_services',
    description: 'Elderly assistance, palliative comfort checks, and hygiene assistance.',
    requirements: 'Certified Nursing Assistant / GNM'
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
      step2: '2. En Route to Pharmacy',
      step3: '3. Out for Delivery',
      step4: '4. Handover PIN',
      btnCollecting: 'Arrived at Pharmacy • Collect Medicine',
      btnInTransit: 'Medicine Collected from Pharmacy • Out for Delivery',
      btnDelivered: 'Arrived at Doorstep • Request Patient PIN'
    };
  }
  if (serviceType === 'MEDICINE_COLLECTION') {
    return {
      step2: '2. En Route to Pharmacy',
      step3: '3. Ready for Handover',
      step4: '4. Handover PIN',
      btnCollecting: 'Arrived at Pharmacy • Collect Medicine',
      btnInTransit: 'Medicine Collected from Pharmacy • Ready for Handover',
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

function DeliveryLocationBadge({ addressString }) {
  if (!addressString) return null;
  const parts = addressString.split(',').map(s => s.trim()).filter(Boolean);
  let tel = null;
  let note = null;
  let landmark = null;
  const addressParts = [];

  for (const p of parts) {
    if (p.toLowerCase().startsWith('tel:')) {
      tel = p.replace(/^tel:\s*/i, '').trim();
    } else if (p.toLowerCase().startsWith('note:')) {
      note = p.replace(/^note:\s*/i, '').trim();
    } else if (p.toLowerCase().startsWith('near ')) {
      landmark = p.replace(/^near\s+/i, '').trim();
    } else {
      addressParts.push(p);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.35rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: 13, color: '#032f28' }}>
        <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d', flexShrink: 0, marginTop: 1 }}>home_pin</span>
        <div>
          <strong style={{ color: '#032f28' }}>Delivery Address: </strong>
          <span style={{ color: '#414846' }}>{addressParts.join(', ') || addressString}</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginLeft: '1.4rem' }}>
        {landmark && (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
            background: '#e0f2eb',
            color: '#032f28',
            padding: '2px 8px',
            borderRadius: 99,
            fontSize: 11,
            fontWeight: 700
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#2e685d' }}>pin_drop</span>
            <span>Landmark: Near {landmark}</span>
          </span>
        )}

        {tel && (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
            background: '#dcfce7',
            color: '#166534',
            padding: '2px 8px',
            borderRadius: 99,
            fontSize: 11,
            fontWeight: 700
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>call</span>
            <span>Arrival Contact: {tel}</span>
          </span>
        )}
      </div>

      {note && (
        <div style={{
          marginLeft: '1.4rem',
          background: '#fff9e6',
          border: '1px solid #ffe082',
          borderRadius: 10,
          padding: '0.45rem 0.85rem',
          fontSize: 12,
          color: '#7a4f00',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.45rem',
          lineHeight: 1.45
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#b36b00', flexShrink: 0, marginTop: 1 }}>sticky_note_2</span>
          <div>
            <strong style={{ color: '#573700' }}>Patient Handover Instructions: </strong>
            <span>{note}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function AssistantPinKeypad({ task, pin = '', onChangePin, onSubmit, onResendSms, onCallDispatch, loading = false }) {
  const pressKey = (num) => {
    if (pin.length < 4) {
      const next = pin + num;
      onChangePin(next);
      playKeypadClickSound(next.length === 4 ? 'complete' : 'press');
      if (next.length === 4) {
        setTimeout(() => onSubmit(), 150);
      }
    }
  };

  const clearKeypad = () => {
    onChangePin('');
    playKeypadClickSound('clear');
  };

  const deleteKey = () => {
    if (pin.length > 0) {
      onChangePin(pin.slice(0, -1));
      playKeypadClickSound('delete');
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

      {/* 4 PIN Display Boxes — masked for security with Smooth Pop Animation */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', margin: '0.5rem 0' }}>
        {[0, 1, 2, 3].map(idx => {
          const isFilled = !!pin[idx];
          return (
            <div
              key={idx}
              style={{
                width: 52,
                height: 60,
                borderRadius: 16,
                border: isFilled ? '2.5px solid #2e685d' : '1.5px solid #c0c8c5',
                background: isFilled ? '#b0ecdd' : '#f8fafc',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 26,
                fontWeight: 800,
                color: '#032f28',
                transform: isFilled ? 'scale(1.06)' : 'scale(1)',
                boxShadow: isFilled ? '0 4px 12px rgba(46,104,93,0.18)' : 'none',
                transition: 'all 0.16s cubic-bezier(0.34, 1.56, 0.64, 1)'
              }}
            >
              {isFilled ? '•' : ''}
            </div>
          );
        })}
      </div>

      {/* Numeric Keypad Grid with Smooth Clicky Animations & Sound */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '0.65rem',
        maxWidth: 290,
        margin: '0 auto',
        width: '100%'
      }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
          <button
            key={num}
            type="button"
            onClick={() => pressKey(String(num))}
            style={{
              height: 56,
              borderRadius: 16,
              border: '1.5px solid #d5e6e0',
              background: '#ffffff',
              color: '#032f28',
              fontSize: 22,
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(3,47,40,0.05)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              userSelect: 'none',
              transition: 'transform 0.12s cubic-bezier(0.2, 0.8, 0.2, 1), background-color 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease'
            }}
            onMouseDown={e => {
              e.currentTarget.style.transform = 'scale(0.91)';
              e.currentTarget.style.backgroundColor = '#b0ecdd';
              e.currentTarget.style.borderColor = '#2e685d';
              e.currentTarget.style.boxShadow = 'inset 0 2px 4px rgba(3,47,40,0.15)';
            }}
            onMouseUp={e => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.backgroundColor = '#ffffff';
              e.currentTarget.style.borderColor = '#d5e6e0';
              e.currentTarget.style.boxShadow = '0 2px 6px rgba(3,47,40,0.05)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.backgroundColor = '#ffffff';
              e.currentTarget.style.borderColor = '#d5e6e0';
              e.currentTarget.style.boxShadow = '0 2px 6px rgba(3,47,40,0.05)';
            }}
            onTouchStart={e => {
              e.currentTarget.style.transform = 'scale(0.91)';
              e.currentTarget.style.backgroundColor = '#b0ecdd';
              e.currentTarget.style.borderColor = '#2e685d';
            }}
            onTouchEnd={e => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.backgroundColor = '#ffffff';
              e.currentTarget.style.borderColor = '#d5e6e0';
            }}
          >
            {num}
          </button>
        ))}

        <button
          type="button"
          onClick={clearKeypad}
          title="Clear all digits"
          style={{
            height: 56,
            borderRadius: 16,
            border: '1.5px solid #ffdad6',
            background: '#fff8f6',
            color: '#ba1a1a',
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '0.04em',
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(186,26,26,0.04)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            userSelect: 'none',
            transition: 'transform 0.12s cubic-bezier(0.2, 0.8, 0.2, 1), background-color 0.15s ease, box-shadow 0.15s ease'
          }}
          onMouseDown={e => {
            e.currentTarget.style.transform = 'scale(0.91)';
            e.currentTarget.style.backgroundColor = '#ffdad6';
            e.currentTarget.style.boxShadow = 'inset 0 2px 4px rgba(186,26,26,0.15)';
          }}
          onMouseUp={e => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.backgroundColor = '#fff8f6';
            e.currentTarget.style.boxShadow = '0 2px 6px rgba(186,26,26,0.04)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.backgroundColor = '#fff8f6';
            e.currentTarget.style.boxShadow = '0 2px 6px rgba(186,26,26,0.04)';
          }}
        >
          CLEAR
        </button>

        <button
          type="button"
          onClick={() => pressKey('0')}
          style={{
            height: 56,
            borderRadius: 16,
            border: '1.5px solid #d5e6e0',
            background: '#ffffff',
            color: '#032f28',
            fontSize: 22,
            fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(3,47,40,0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            userSelect: 'none',
            transition: 'transform 0.12s cubic-bezier(0.2, 0.8, 0.2, 1), background-color 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease'
          }}
          onMouseDown={e => {
            e.currentTarget.style.transform = 'scale(0.91)';
            e.currentTarget.style.backgroundColor = '#b0ecdd';
            e.currentTarget.style.borderColor = '#2e685d';
            e.currentTarget.style.boxShadow = 'inset 0 2px 4px rgba(3,47,40,0.15)';
          }}
          onMouseUp={e => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.backgroundColor = '#ffffff';
            e.currentTarget.style.borderColor = '#d5e6e0';
            e.currentTarget.style.boxShadow = '0 2px 6px rgba(3,47,40,0.05)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.backgroundColor = '#ffffff';
            e.currentTarget.style.borderColor = '#d5e6e0';
            e.currentTarget.style.boxShadow = '0 2px 6px rgba(3,47,40,0.05)';
          }}
        >
          0
        </button>

        <button
          type="button"
          onClick={deleteKey}
          title="Delete last digit"
          style={{
            height: 56,
            borderRadius: 16,
            border: '1.5px solid #d5e6e0',
            background: '#f8fafc',
            color: '#414846',
            fontSize: 20,
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(3,47,40,0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            userSelect: 'none',
            transition: 'transform 0.12s cubic-bezier(0.2, 0.8, 0.2, 1), background-color 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease'
          }}
          onMouseDown={e => {
            e.currentTarget.style.transform = 'scale(0.91)';
            e.currentTarget.style.backgroundColor = '#e0f2eb';
            e.currentTarget.style.borderColor = '#2e685d';
            e.currentTarget.style.boxShadow = 'inset 0 2px 4px rgba(3,47,40,0.15)';
          }}
          onMouseUp={e => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.backgroundColor = '#f8fafc';
            e.currentTarget.style.borderColor = '#d5e6e0';
            e.currentTarget.style.boxShadow = '0 2px 6px rgba(3,47,40,0.05)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.backgroundColor = '#f8fafc';
            e.currentTarget.style.borderColor = '#d5e6e0';
            e.currentTarget.style.boxShadow = '0 2px 6px rgba(3,47,40,0.05)';
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 22 }}>backspace</span>
        </button>
      </div>

      {/* Manual Submit Button & Secondary Options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: 320, margin: '0 auto', width: '100%' }}>
        <FlowButton
          type="button"
          onClick={onSubmit}
          loading={loading}
          disabled={pin.length < 4 || loading}
          variant="primary"
          size="md"
          fullWidth
        >
          Verify PIN & Finalize Handover
        </FlowButton>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
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
  const { firstName: assistantFirstName, timeGreet: assistantTimeGreet, icon: assistantGreetIcon } = usePortalGreeting(user, 'ASSISTANT');
  const [internalTab, setInternalTab] = useState('available');
  const tab = currentTab !== undefined ? currentTab : internalTab;
  const setTab = onTabChange || setInternalTab;

  const [profile, setProfile] = useState(() => {
    try {
      const cached = localStorage.getItem('medifind_assistant_profile_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {}
    return null;
  });
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [loading, setLoading] = useState(() => {
    try {
      const cached = localStorage.getItem('medifind_assistant_profile_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.onboardingCompleted) return false;
      }
    } catch (e) {}
    return true;
  });
  const [actionLoading, setActionLoading] = useState(false);
  const [acceptingTaskId, setAcceptingTaskId] = useState(null);
  const [progressingTaskId, setProgressingTaskId] = useState(null);
  const [availableTasks, setAvailableTasks] = useState([]);
  const [myTasks, setMyTasks] = useState([]);
  const [handoverPinMap, setHandoverPinMap] = useState({});
  const [regionName, setRegionName] = useState('Chengannur, Kerala');
  const [editingCapabilities, setEditingCapabilities] = useState(false);
  const [selectedCapabilities, setSelectedCapabilities] = useState([]);

  // Onboarding View Flow States: 'ROLE_SELECTION' | 'DELIVERY_SETUP' | 'PROFESSIONAL_APPLICATION'
  const [onboardingStage, setOnboardingStage] = useState(() => {
    try {
      const cached = localStorage.getItem('medifind_assistant_profile_cache');
      if (cached) {
        const p = JSON.parse(cached);
        if (p.assistantType && !p.onboardingCompleted) {
          if (p.assistantType === 'DELIVERY_ASSISTANT') return 'DELIVERY_SETUP';
          if (p.assistantType === 'HEALTHCARE_PROFESSIONAL') return 'PROFESSIONAL_APPLICATION';
        }
      }
    } catch (e) {}
    return 'ROLE_SELECTION';
  });

  // Synchronize profile state with localStorage cache
  const updateProfile = (newProfile) => {
    setProfile(newProfile);
    try {
      if (newProfile) {
        localStorage.setItem('medifind_assistant_profile_cache', JSON.stringify(newProfile));
      } else {
        localStorage.removeItem('medifind_assistant_profile_cache');
      }
    } catch (e) {}
  };

  // Delivery Setup Form
  const [deliveryForm, setDeliveryForm] = useState({
    name: '',
    phone: '',
    operatingCity: 'Chengannur, Kerala',
    vehicleType: 'MOTORCYCLE',
    operatingRadiusKm: 10,
    bio: '',
    isAvailable: true
  });

  // Healthcare Professional Application Form
  const [proForm, setProForm] = useState({
    name: '',
    phone: '',
    professionTitle: 'Registered Nurse (RN)',
    registrationNumber: '',
    issuingAuthority: 'Kerala State Nursing & Midwives Council (KSNC)',
    qualifications: 'B.Sc. Nursing',
    yearsOfExperience: 3,
    operatingCity: 'Chengannur, Kerala',
    operatingRadiusKm: 15,
    serviceAreasApplied: ['NURSING_VISIT', 'VITAL_SIGN_MEASUREMENT'],
    bio: '',
    declarationAccepted: false
  });

  // Phase 2 Healthcare Professional Application & Documents State
  const [appData, setAppData] = useState({ documents: [], reviewLogs: [], canEdit: true });
  const [uploadDocType, setUploadDocType] = useState('COUNCIL_REGISTRATION');
  const [uploadDescription, setUploadDescription] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [isEditingApplication, setIsEditingApplication] = useState(false);

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

  const [detectingGpsDelivery, setDetectingGpsDelivery] = useState(false);
  const [detectingGpsPro, setDetectingGpsPro] = useState(false);
  const [gpsLockedNoticeDelivery, setGpsLockedNoticeDelivery] = useState('');
  const [gpsLockedNoticePro, setGpsLockedNoticePro] = useState('');

  const handleDetectDeliveryGps = () => {
    if (!navigator.geolocation) {
      showToast('Geolocation not supported by browser', 'error');
      return;
    }
    setDetectingGpsDelivery(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const nearest = findNearestKeralaTown(latitude, longitude);
        setDeliveryForm(prev => ({
          ...prev,
          operatingCity: nearest ? `${nearest.name}, ${nearest.district}, Kerala` : `GPS: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
          latitude: String(latitude.toFixed(4)),
          longitude: String(longitude.toFixed(4))
        }));
        setDetectingGpsDelivery(false);
        setGpsLockedNoticeDelivery(`Live GPS Locked: ${latitude.toFixed(4)}° N, ${longitude.toFixed(4)}° E (Hub: ${nearest ? nearest.name : 'Custom Coordinates'})`);
        showToast(`GPS Resolved: Linked to ${nearest ? nearest.name : 'Coordinates'} Hub`, 'success');
      },
      (err) => {
        setDetectingGpsDelivery(false);
        showToast('Could not fetch GPS. Defaulting to Chengannur Hub.', 'info');
        setDeliveryForm(prev => ({
          ...prev,
          operatingCity: 'Chengannur Town, Alappuzha, Kerala',
          latitude: '9.3170',
          longitude: '76.6145'
        }));
        setGpsLockedNoticeDelivery('Defaulted to Chengannur Town Hub');
      },
      { enableHighAccuracy: true, timeout: 6000 }
    );
  };

  const handleDetectProGps = () => {
    if (!navigator.geolocation) {
      showToast('Geolocation not supported by browser', 'error');
      return;
    }
    setDetectingGpsPro(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const nearest = findNearestKeralaTown(latitude, longitude);
        setProForm(prev => ({
          ...prev,
          operatingCity: nearest ? `${nearest.name}, ${nearest.district}, Kerala` : `GPS: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
          latitude: String(latitude.toFixed(4)),
          longitude: String(longitude.toFixed(4))
        }));
        setDetectingGpsPro(false);
        setGpsLockedNoticePro(`Live GPS Locked: ${latitude.toFixed(4)}° N, ${longitude.toFixed(4)}° E (Hub: ${nearest ? nearest.name : 'Custom Coordinates'})`);
        showToast(`GPS Resolved: Linked to ${nearest ? nearest.name : 'Coordinates'} Hub`, 'success');
      },
      (err) => {
        setDetectingGpsPro(false);
        showToast('Could not fetch GPS. Defaulting to Chengannur Hub.', 'info');
        setProForm(prev => ({
          ...prev,
          operatingCity: 'Chengannur Town, Alappuzha, Kerala',
          latitude: '9.3170',
          longitude: '76.6145'
        }));
        setGpsLockedNoticePro('Defaulted to Chengannur Town Hub');
      },
      { enableHighAccuracy: true, timeout: 6000 }
    );
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

  async function fetchApplicationData() {
    const token = localStorage.getItem('medifind_token');
    if (!token) return;
    try {
      const res = await fetch('/api/assistant/application', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.application) {
        setAppData({
          documents: data.application.documents || [],
          reviewLogs: data.application.reviewLogs || [],
          canEdit: data.application.canEdit !== false
        });
        if (data.application.profile) {
          const p = data.application.profile;
          setProForm(prev => ({
            ...prev,
            name: p.name || user?.name || '',
            phone: p.phone || user?.phone || '',
            professionTitle: p.professionTitle || 'Registered Nurse (RN)',
            registrationNumber: p.registrationNumber || '',
            issuingAuthority: p.issuingAuthority || 'Kerala State Nursing & Midwives Council (KSNC)',
            qualifications: p.qualifications || 'B.Sc. Nursing',
            yearsOfExperience: p.yearsOfExperience !== undefined ? p.yearsOfExperience : 3,
            operatingCity: p.operatingCity || 'Chengannur, Kerala',
            operatingRadiusKm: p.operatingRadiusKm || 15,
            serviceAreasApplied: p.serviceAreasApplied || ['NURSING_VISIT', 'VITAL_SIGN_MEASUREMENT'],
            bio: p.bio || '',
            declarationAccepted: p.declarationAccepted || false
          }));
        }
      }
    } catch (e) {
      console.error('Failed to load application data:', e);
    }
  }

  async function fetchProfile() {
    const token = localStorage.getItem('medifind_token');
    if (!token) {
      setProfileLoaded(true);
      return;
    }
    try {
      const res = await fetch('/api/assistant/profile', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.profile) {
        updateProfile(data.profile);
        setSelectedCapabilities(data.profile.capabilities || []);
        setDeliveryForm(prev => ({
          ...prev,
          name: data.profile.name || user?.name || '',
          phone: data.profile.phone || user?.phone || '',
          operatingCity: data.profile.operatingCity || 'Chengannur, Kerala',
          vehicleType: data.profile.vehicleType || 'MOTORCYCLE',
          operatingRadiusKm: data.profile.operatingRadiusKm || 10,
          bio: data.profile.bio || ''
        }));
        setProForm(prev => ({
          ...prev,
          name: data.profile.name || user?.name || '',
          phone: data.profile.phone || user?.phone || '',
          professionTitle: data.profile.professionTitle || 'Registered Nurse (RN)',
          registrationNumber: data.profile.registrationNumber || '',
          issuingAuthority: data.profile.issuingAuthority || 'Kerala State Nursing & Midwives Council (KSNC)',
          qualifications: data.profile.qualifications || 'B.Sc. Nursing',
          yearsOfExperience: data.profile.yearsOfExperience !== undefined ? data.profile.yearsOfExperience : 3,
          operatingCity: data.profile.operatingCity || 'Chengannur, Kerala',
          operatingRadiusKm: data.profile.operatingRadiusKm || 15,
          bio: data.profile.bio || '',
          declarationAccepted: data.profile.declarationAccepted || false
        }));

        if (data.profile.assistantType === 'HEALTHCARE_PROFESSIONAL') {
          fetchApplicationData();
        }

        if (data.profile.assistantType && !data.profile.onboardingCompleted) {
          if (data.profile.assistantType === 'DELIVERY_ASSISTANT') {
            setOnboardingStage('DELIVERY_SETUP');
          } else if (data.profile.assistantType === 'HEALTHCARE_PROFESSIONAL') {
            setOnboardingStage('PROFESSIONAL_APPLICATION');
          }
        }
      }
    } catch (e) {
      console.error('Failed to load assistant profile:', e);
    } finally {
      setProfileLoaded(true);
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
        updateProfile(data.profile);
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
    const token = localStorage.getItem('medifind_token');
    const capsToSave = ['MEDICINE_DELIVERY', 'MEDICINE_COLLECTION'];
    try {
      const res = await fetch('/api/assistant/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ capabilities: capsToSave })
      });
      const data = await res.json();
      if (data.success && data.profile) {
        updateProfile(data.profile);
        setEditingCapabilities(false);
        showToast('Service scope confirmed for Medicine Delivery.', 'success');
        fetchTasks();
      } else {
        showToast(data.error || 'Failed to update capabilities.', 'error');
      }
    } catch (e) {
      showToast('Error saving capabilities.', 'error');
    }
  };

  // Select initial assistant track: DELIVERY_ASSISTANT or HEALTHCARE_PROFESSIONAL
  const handleSelectRole = async (targetRole) => {
    setActionLoading(true);
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch('/api/assistant/role-selection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ role: targetRole })
      });
      const data = await res.json();
      setActionLoading(false);
      if (data.success && data.profile) {
        updateProfile(data.profile);
        if (targetRole === 'DELIVERY_ASSISTANT') {
          setOnboardingStage('DELIVERY_SETUP');
        } else {
          setOnboardingStage('PROFESSIONAL_APPLICATION');
        }
      } else {
        showToast(data.error || 'Role selection failed. Please retry.', 'error');
      }
    } catch (e) {
      setActionLoading(false);
      showToast('Network error during role selection.', 'error');
    }
  };

  // Submit Delivery Profile Onboarding
  const handleSubmitDeliverySetup = async (e) => {
    e.preventDefault();
    setActionLoading(true);
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch('/api/assistant/delivery-profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(deliveryForm)
      });
      const data = await res.json();
      setActionLoading(false);
      if (data.success && data.profile) {
        updateProfile(data.profile);
        showToast('Delivery profile created! Welcome to the Delivery Assistant Portal.', 'success');
        fetchTasks();
      } else {
        showToast(data.error || 'Failed to complete delivery onboarding.', 'error');
      }
    } catch (e) {
      setActionLoading(false);
      showToast('Network error during delivery setup.', 'error');
    }
  };

  // Submit or Resubmit Healthcare Professional Application (Phase 2)
  const handleSubmitProApplication = async (e) => {
    e.preventDefault();
    if (!proForm.registrationNumber?.trim()) {
      showToast('Please enter your professional council license / registration number.', 'warning');
      return;
    }
    if (!proForm.issuingAuthority?.trim()) {
      showToast('Please enter the issuing licensing authority or council body.', 'warning');
      return;
    }
    if (!proForm.operatingCity?.trim()) {
      showToast('Please specify your operating city/territory.', 'warning');
      return;
    }
    if (!proForm.serviceAreasApplied || proForm.serviceAreasApplied.length === 0) {
      showToast('Please select at least one clinical service category applied for.', 'warning');
      return;
    }
    if (!proForm.declarationAccepted) {
      showToast('You must accept the truthfulness declaration before submitting.', 'warning');
      return;
    }

    setActionLoading(true);
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch('/api/assistant/application', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          ...proForm,
          submitForReview: true
        })
      });
      const data = await res.json();
      setActionLoading(false);
      if (data.success && data.profile) {
        updateProfile(data.profile);
        setIsEditingApplication(false);
        showToast('Application submitted! Status: PENDING administrator review.', 'success');
        fetchProfile();
        fetchApplicationData();
        fetchTasks();
      } else {
        showToast(data.error || 'Failed to submit professional application.', 'error');
      }
    } catch (e) {
      setActionLoading(false);
      showToast('Network error during professional application submission.', 'error');
    }
  };

  // Secure Document Download
  const handleDownloadDoc = async (docId, fileName) => {
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch(`/api/assistant/documents/${docId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Failed to download document', 'error');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'document';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      showToast('Document downloaded securely.', 'success');
    } catch (err) {
      showToast('Download error: ' + err.message, 'error');
    }
  };

  // Upload Supporting Verification Document
  const handleUploadDoc = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      showToast('Please choose a file to upload.', 'warning');
      return;
    }
    const token = localStorage.getItem('medifind_token');
    const formData = new FormData();
    formData.append('document', selectedFile);
    formData.append('documentType', uploadDocType);
    if (uploadDescription) {
      formData.append('description', uploadDescription);
    }

    setUploadingDoc(true);
    try {
      const res = await fetch('/api/assistant/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      setUploadingDoc(false);
      if (data.success) {
        showToast('Document uploaded and cryptographically validated.', 'success');
        setSelectedFile(null);
        setUploadDescription('');
        fetchApplicationData();
      } else {
        showToast(data.error || 'Document upload failed.', 'error');
      }
    } catch (err) {
      setUploadingDoc(false);
      showToast('Network error uploading document: ' + err.message, 'error');
    }
  };

  // Delete Verification Document (Allowed for DRAFT or NEEDS_CORRECTION)
  const handleDeleteDoc = async (docId) => {
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch(`/api/assistant/documents/${docId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        showToast('Document removed.', 'success');
        fetchApplicationData();
      } else {
        showToast(data.error || 'Failed to delete document', 'error');
      }
    } catch (err) {
      showToast('Network error deleting document: ' + err.message, 'error');
    }
  };

  // Switch role between Delivery and Healthcare tracks
  const handleSwitchRole = (targetRole) => {
    setConfirmDialog({
      isOpen: true,
      title: `Switch to ${targetRole === 'DELIVERY_ASSISTANT' ? 'Delivery Assistant' : 'Healthcare Professional'} Track`,
      message: targetRole === 'DELIVERY_ASSISTANT'
        ? 'You will switch to the Medicine Delivery track to accept pharmacy medicine collection and delivery tasks. Delivery does not require professional nursing licenses.'
        : 'You will switch to the Healthcare Professional track. Note: clinical services remain unbookable until verified by administrators in Phase 2.',
      confirmLabel: 'Confirm Track Switch',
      variant: 'primary',
      onConfirm: async () => {
        setActionLoading(true);
        const token = localStorage.getItem('medifind_token');
        try {
          const res = await fetch('/api/assistant/switch-role', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ targetRole })
          });
          const data = await res.json();
          setActionLoading(false);
          if (data.success && data.profile) {
            updateProfile(data.profile);
            showToast(data.message || `Switched to ${targetRole}.`, 'success');
            fetchTasks();
          } else {
            showToast(data.error || 'Failed to switch track.', 'error');
          }
        } catch (e) {
          setActionLoading(false);
          showToast('Error switching assistant track.', 'error');
        }
      }
    });
  };

  useEffect(() => {
    let isMounted = true;
    async function init() {
      // Only set loading to true if we don't have an onboarded profile cached
      if (!profile || !profile.onboardingCompleted) {
        setLoading(true);
      }
      await Promise.all([fetchProfile(), fetchTasks(true)]);
      if (isMounted) {
        setLoading(false);
        setProfileLoaded(true);
      }
    }
    init();
    return () => { isMounted = false; };
  }, [user]);

  useRealtimeRefresh({
    onRefresh: () => {
      fetchTasks(true);
    },
    interval: 12000
  });

  async function fetchTasks(isBackground = false) {
    if (!isBackground && !availableTasks.length && !myTasks.length) setLoading(true);
    const token = localStorage.getItem('medifind_token');
    try {
      const [availRes, myRes] = await Promise.all([
        fetch('/api/assistant/available', {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch('/api/assistant/my-tasks', {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      const [availData, myData] = await Promise.all([availRes.json(), myRes.json()]);

      if (availData.success) {
        setAvailableTasks(availData.tasks || []);
      }

      if (myData.success) {
        setMyTasks(myData.tasks || []);
      }
    } catch (err) {
      if (!isBackground) {
        console.error('Error fetching assistant tasks:', err);
      }
    } finally {
      if (!isBackground) {
        setLoading(false);
      }
    }
  }

  const handleAcceptTask = async (taskId) => {
    const token = localStorage.getItem('medifind_token');
    setAcceptingTaskId(taskId);
    setActionLoading(true);
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
        showToast('Task accepted! En route to pharmacy to collect medication package.', 'success');
        await fetchTasks(true);
        setTab('active');
        broadcastUpdate('ASSISTANT_TASK_ACCEPTED', { taskId });
      } else {
        showToast(data.error || 'Failed to accept task.', 'error');
      }
    } catch (err) {
      console.error('Error accepting task:', err);
      showToast('Error communicating with server.', 'error');
    } finally {
      setAcceptingTaskId(null);
      setActionLoading(false);
    }
  };

  const handleProgressTask = async (taskId, nextStatus) => {
    const token = localStorage.getItem('medifind_token');
    const handoverPin = handoverPinMap[taskId];

    if (nextStatus === 'CONFIRMED' && (!handoverPin || handoverPin.length < 4)) {
      showToast('Recipient 4-digit handover PIN is required to complete service handover.', 'error');
      return;
    }

    setProgressingTaskId(taskId);
    setActionLoading(true);

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
        let msg = `Task progressed to ${nextStatus.replace(/_/g, ' ')}.`;
        if (nextStatus === 'COLLECTING') {
          msg = 'Arrived at pharmacy! Please inspect and collect the prescription package.';
        } else if (nextStatus === 'IN_TRANSIT') {
          msg = 'Medicine collected from pharmacy! Active custody started — out for delivery.';
        } else if (nextStatus === 'DELIVERED') {
          msg = 'Arrived at doorstep! Please ask recipient for their 4-digit Handover PIN.';
        } else if (nextStatus === 'CONFIRMED') {
          msg = 'Handover PIN verified! Delivery successfully confirmed and completed.';
        }
        showToast(msg, 'success');
        await fetchTasks(true);
        broadcastUpdate('ASSISTANT_TASK_PROGRESSED', { taskId, status: nextStatus });
      } else {
        showToast(data.error || 'Failed to progress task.', 'error');
      }
    } catch (err) {
      console.error('Error progressing task:', err);
      showToast('Error communicating with server.', 'error');
    } finally {
      setProgressingTaskId(null);
      setActionLoading(false);
    }
  };

  const activeTasks = myTasks.filter(task => task.status !== 'CONFIRMED');
  const completedTasks = myTasks.filter(task => task.status === 'CONFIRMED');
  const primaryActiveTask = activeTasks[0];

  const isRoleOnboarded = Boolean(profile && profile.onboardingCompleted === true && profile.assistantType);
  const isHealthcareRole = profile?.assistantType === 'HEALTHCARE_PROFESSIONAL';

  // Do not show role selection screen while still loading or before profile has been loaded
  const showSkeleton = loading && !isRoleOnboarded;

  return (
    <div className="portal-page" style={{ minHeight: '100vh', paddingBottom: '4rem' }}>
      {/* Toast Feedback */}
      {feedback.show && (
        <div style={{
          position: 'fixed',
          top: '1.5rem',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 99999,
          background: feedback.type === 'error' ? '#93000a' : feedback.type === 'warning' ? '#78350f' : '#032f28',
          color: '#ffffff',
          borderRadius: 99,
          padding: '0.85rem 1.75rem',
          boxShadow: '0 12px 36px rgba(0,0,0,0.28)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          fontSize: 14,
          fontWeight: 700,
          border: '1.5px solid rgba(255,255,255,0.25)',
          maxWidth: '90vw',
          pointerEvents: 'none'
        }}>
          <span className="material-symbols-outlined" style={{
            fontSize: 22,
            color: feedback.type === 'error' ? '#ffdad6' : feedback.type === 'warning' ? '#fde68a' : '#b0ecdd'
          }}>
            {feedback.type === 'error' ? 'error' : feedback.type === 'warning' ? 'warning' : 'check_circle'}
          </span>
          <span>{feedback.message}</span>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* LOADING SKELETON STATE */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {showSkeleton && (
        <div style={{ maxWidth: 1280, margin: '2rem auto', padding: '0 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ background: '#ffffff', borderRadius: 24, padding: '1.75rem', border: '1px solid #e0f2eb', boxShadow: '0 2px 8px rgba(3,47,40,0.04)' }} className="animate-pulse">
            <div style={{ width: '220px', height: '22px', borderRadius: '10px', background: '#e0f2eb', marginBottom: '14px' }} />
            <div style={{ width: '380px', height: '30px', borderRadius: '10px', background: '#e0f2eb', marginBottom: '10px' }} />
            <div style={{ width: '260px', height: '16px', borderRadius: '8px', background: '#e0f2eb' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ background: '#ffffff', borderRadius: 20, padding: '1.25rem', border: '1px solid #e0f2eb', minHeight: '110px' }} className="animate-pulse">
                <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: '#e0f2eb', marginBottom: '14px' }} />
                <div style={{ width: '70px', height: '26px', borderRadius: '8px', background: '#e0f2eb', marginBottom: '8px' }} />
                <div style={{ width: '120px', height: '14px', borderRadius: '6px', background: '#e0f2eb' }} />
              </div>
            ))}
          </div>
          <div style={{ background: '#ffffff', borderRadius: 24, padding: '1.75rem', border: '1px solid #e0f2eb' }} className="animate-pulse">
            <div style={{ width: '240px', height: '22px', borderRadius: '10px', background: '#e0f2eb', marginBottom: '18px' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ width: '100%', height: '80px', borderRadius: '16px', background: '#f5faf8' }} />
              <div style={{ width: '100%', height: '80px', borderRadius: '16px', background: '#f5faf8' }} />
            </div>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* FIRST-TIME ROLE SELECTION & ONBOARDING VIEW */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {!showSkeleton && (profile || profileLoaded) && !isRoleOnboarded && (
        <div style={{ maxWidth: 960, margin: '2rem auto', padding: '0 1.5rem' }}>
          {onboardingStage === 'ROLE_SELECTION' && (
            <div style={{
              background: '#ffffff',
              borderRadius: 28,
              padding: '2.5rem 2rem',
              border: '1px solid #d5e6e0',
              boxShadow: '0 12px 40px rgba(3,47,40,0.08)'
            }}>
              <div style={{ textAlign: 'center', maxWidth: 640, margin: '0 auto 2.5rem auto' }}>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  color: '#2e685d',
                  fontSize: 16,
                  fontWeight: 800,
                  marginBottom: '0.5rem',
                  letterSpacing: '-0.01em'
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#2e685d' }}>{assistantGreetIcon}</span>
                  <span>{assistantTimeGreet}, {assistantFirstName}!</span>
                </div>
                <h1 style={{ fontSize: 32, fontWeight: 800, color: '#032f28', margin: 0, letterSpacing: '-0.02em' }}>
                  How would you like to join MediFind AI?
                </h1>
                <p style={{ fontSize: 15, color: '#414846', marginTop: '0.75rem', lineHeight: 1.6 }}>
                  Choose your participation track. MediFind AI supports dedicated medicine delivery assistants and qualified healthcare professionals through distinct operational workflows.
                </p>
              </div>

              {/* Two Role Options */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
                {/* Option 1: Delivery Assistant */}
                <div style={{
                  background: '#f8fafc',
                  borderRadius: 22,
                  border: '2px solid #2e685d',
                  padding: '2rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  boxShadow: '0 4px 16px rgba(46,104,93,0.06)'
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                      <div style={{
                        width: 52,
                        height: 52,
                        borderRadius: 16,
                        background: '#e0f2eb',
                        color: '#032f28',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 28 }}>electric_moped</span>
                      </div>
                      <span style={{
                        background: '#b0ecdd',
                        color: '#00201b',
                        padding: '0.25rem 0.75rem',
                        borderRadius: 99,
                        fontSize: 11,
                        fontWeight: 700
                      }}>
                        Immediate Access
                      </span>
                    </div>

                    <h2 style={{ fontSize: 22, fontWeight: 700, color: '#032f28', margin: '0 0 0.5rem 0' }}>
                      Delivery Assistant
                    </h2>
                    <p style={{ fontSize: 14, color: '#414846', lineHeight: 1.5, marginBottom: '1.25rem' }}>
                      Help patients access their reserved medicines by collecting them from participating pharmacies and delivering them safely.
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '1.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: 13, color: '#032f28' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d', marginTop: 1 }}>check_circle</span>
                        <span>Collect reserved orders from verified dispensaries</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: 13, color: '#032f28' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d', marginTop: 1 }}>check_circle</span>
                        <span>Secure doorstep handover with 4-digit PIN verification</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: 13, color: '#032f28' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d', marginTop: 1 }}>verified_user</span>
                        <span><strong>No clinical certificates or nursing registration required</strong></span>
                      </div>
                    </div>
                  </div>

                  <FlowButton
                    variant="primary"
                    fullWidth
                    size="lg"
                    disabled={actionLoading}
                    onClick={() => handleSelectRole('DELIVERY_ASSISTANT')}
                  >
                    Continue as Delivery Assistant
                  </FlowButton>
                </div>

                {/* Option 2: Healthcare Professional */}
                <div style={{
                  background: '#f8fafc',
                  borderRadius: 22,
                  border: '1.5px solid #d5e6e0',
                  padding: '2rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.03)'
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                      <div style={{
                        width: 52,
                        height: 52,
                        borderRadius: 16,
                        background: '#d5e6e0',
                        color: '#1e453e',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 28 }}>medical_services</span>
                      </div>
                      <span style={{
                        background: '#fff8f6',
                        border: '1px solid #ffdad4',
                        color: '#5a0100',
                        padding: '0.25rem 0.75rem',
                        borderRadius: 99,
                        fontSize: 11,
                        fontWeight: 700
                      }}>
                        Verification Required
                      </span>
                    </div>

                    <h2 style={{ fontSize: 22, fontWeight: 700, color: '#032f28', margin: '0 0 0.5rem 0' }}>
                      Healthcare Professional
                    </h2>
                    <p style={{ fontSize: 14, color: '#414846', lineHeight: 1.5, marginBottom: '1.25rem' }}>
                      Apply to provide eligible nursing and healthcare support services based on your qualifications and approved scope of practice.
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '1.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: 13, color: '#032f28' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d', marginTop: 1 }}>check_circle</span>
                        <span>Apply for home visits, vitals checks, or recovery support</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: 13, color: '#032f28' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d', marginTop: 1 }}>lock</span>
                        <span>Clinical services gated pending administrator review</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: 13, color: '#032f28' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d', marginTop: 1 }}>shield</span>
                        <span>Requires professional registration or council license</span>
                      </div>
                    </div>
                  </div>

                  <FlowButton
                    variant="secondary"
                    fullWidth
                    size="lg"
                    disabled={actionLoading}
                    onClick={() => handleSelectRole('HEALTHCARE_PROFESSIONAL')}
                    style={{ background: '#1e453e', color: '#ffffff', '--fb-circle-bg': '#032f28', '--fb-color': '#ffffff' }}
                  >
                    Apply as a Healthcare Professional
                  </FlowButton>
                </div>
              </div>
            </div>
          )}

          {/* ── Sub-step: Hierarchical Delivery Setup Form ── */}
          {onboardingStage === 'DELIVERY_SETUP' && (
            <div style={{
              background: '#ffffff',
              borderRadius: 28,
              padding: '2.5rem 2rem',
              border: '1px solid #d5e6e0',
              boxShadow: '0 12px 40px rgba(3,47,40,0.08)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => setOnboardingStage('ROLE_SELECTION')}
                  style={{ background: 'none', border: 'none', color: '#2e685d', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: 13, fontWeight: 700 }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_back</span>
                  <span>Change Track</span>
                </button>
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#2e685d', display: 'inline-block', marginBottom: '0.25rem' }}>
                  Logistics Track Setup
                </span>
                <h2 style={{ fontSize: 26, fontWeight: 800, color: '#032f28', margin: 0, letterSpacing: '-0.02em' }}>
                  Delivery Assistant Operational Profile
                </h2>
                <p style={{ fontSize: 14, color: '#414846', marginTop: '0.35rem', marginBotom: 0 }}>
                  Configure your primary dispensary pickup hub, doorstep delivery territory, and transit vehicle to receive verified medicine dispatch tasks.
                </p>
              </div>

              <div style={{
                background: '#e0f2eb',
                border: '1px solid #b0ecdd',
                borderRadius: 16,
                padding: '0.85rem 1.25rem',
                marginBottom: '1.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem'
              }}>
                <span className="material-symbols-outlined" style={{ color: '#032f28', fontSize: 22 }}>verified</span>
                <span style={{ fontSize: 12, color: '#032f28', lineHeight: 1.5 }}>
                  <strong>Zero Clinical Requirements:</strong> Delivery Assistants transport sealed medicine batches directly from licensed dispensaries to patients. No nursing council registration or Aadhaar clinical submission is needed.
                </span>
              </div>

              <form onSubmit={handleSubmitDeliverySetup} style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
                {/* ── SECTION 1: IDENTITY & CONTACT ── */}
                <div style={{
                  background: '#f8fafc',
                  borderRadius: 20,
                  padding: '1.5rem',
                  border: '1px solid #e0f2eb'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 10, background: '#e0f2eb', color: '#2e685d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>badge</span>
                    </div>
                    <div>
                      <h3 style={{ fontSize: 14, fontWeight: 800, color: '#032f28', margin: 0 }}>
                        1. Assistant Identity &amp; Contact
                      </h3>
                      <span style={{ fontSize: 11, color: '#717976' }}>
                        Used for customer communication, dispensary verification, and handover SMS alerts
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28', marginBottom: 4 }}>
                        Full Display Name <span style={{ color: '#ba1a1a' }}>*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={deliveryForm.name}
                        onChange={e => setDeliveryForm({ ...deliveryForm, name: e.target.value })}
                        placeholder="Name"
                        style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: 12, border: '1px solid #c0c8c5', fontSize: 13, background: '#ffffff', fontWeight: 700, color: '#032f28' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28', marginBottom: 4 }}>
                        Contact Phone Number <span style={{ color: '#ba1a1a' }}>*</span>
                      </label>
                      <input
                        type="tel"
                        required
                        value={deliveryForm.phone}
                        onChange={e => setDeliveryForm({ ...deliveryForm, phone: e.target.value })}
                        placeholder="Phone"
                        style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: 12, border: '1px solid #c0c8c5', fontSize: 13, background: '#ffffff', fontWeight: 700, color: '#032f28' }}
                      />
                    </div>
                  </div>
                </div>

                {/* ── SECTION 2: DISPENSARY HUB VS. DELIVERY COVERAGE ZONE ── */}
                <div style={{
                  background: '#f8fafc',
                  borderRadius: 20,
                  padding: '1.5rem',
                  border: '1px solid #e0f2eb'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 10, background: '#e0f2eb', color: '#2e685d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>hub</span>
                    </div>
                    <div>
                      <h3 style={{ fontSize: 14, fontWeight: 800, color: '#032f28', margin: 0 }}>
                        2. Dispensary Base Hub &amp; Delivery Territory
                      </h3>
                      <span style={{ fontSize: 11, color: '#717976' }}>
                        Distinguish where you pick up medicine batches from where you deliver them
                      </span>
                    </div>
                  </div>

                  {/* Flow Diagram Schematic */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '0.75rem',
                    background: '#ffffff',
                    border: '1px dashed #b0ecdd',
                    borderRadius: 14,
                    padding: '0.85rem 1rem',
                    marginBottom: '1.25rem'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="material-symbols-outlined" style={{ color: '#2e685d', fontSize: 20 }}>storefront</span>
                      <div>
                        <span style={{ fontSize: 10, color: '#717976', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Pickup Point</span>
                        <strong style={{ fontSize: 12, color: '#032f28' }}>Dispensary Hub: {deliveryForm.operatingCity || 'Chengannur'}</strong>
                      </div>
                    </div>
                    <span className="material-symbols-outlined" style={{ color: '#2e685d', fontSize: 20 }}>trending_flat</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="material-symbols-outlined" style={{ color: '#2e685d', fontSize: 20 }}>route</span>
                      <div>
                        <span style={{ fontSize: 10, color: '#717976', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Dispatch Perimeter</span>
                        <strong style={{ fontSize: 12, color: '#032f28' }}>Within {deliveryForm.operatingRadiusKm || 10} km radius</strong>
                      </div>
                    </div>
                    <span className="material-symbols-outlined" style={{ color: '#2e685d', fontSize: 20 }}>trending_flat</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="material-symbols-outlined" style={{ color: '#2e685d', fontSize: 20 }}>home_pin</span>
                      <div>
                        <span style={{ fontSize: 10, color: '#717976', textTransform: 'uppercase', fontWeight: 700, display: 'block' }}>Delivery Handover</span>
                        <strong style={{ fontSize: 12, color: '#032f28' }}>Patient Doorstep (PIN Handover)</strong>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                        <label style={{ fontSize: 12, fontWeight: 700, color: '#032f28' }}>
                          Primary Base Hub / Town <span style={{ color: '#ba1a1a' }}>*</span>
                        </label>
                        <button
                          type="button"
                          disabled={detectingGpsDelivery}
                          onClick={handleDetectDeliveryGps}
                          style={{
                            border: 'none',
                            background: detectingGpsDelivery
                              ? 'linear-gradient(135deg, #1e453e 0%, #2e685d 100%)'
                              : 'linear-gradient(135deg, #032f28 0%, #1e453e 100%)',
                            color: '#ffffff',
                            borderRadius: 99,
                            padding: '5px 12px',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: detectingGpsDelivery ? 'wait' : 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            boxShadow: '0 2px 6px rgba(3, 47, 40, 0.2)',
                            transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                            opacity: detectingGpsDelivery ? 0.85 : 1
                          }}
                          title="Auto-detect current device GPS coordinates"
                        >
                          {detectingGpsDelivery ? (
                            <>
                              <span className="material-symbols-outlined animate-spin" style={{ fontSize: 13, color: '#34d399' }}>progress_activity</span>
                              <span>Detecting GPS...</span>
                            </>
                          ) : (
                            <>
                              <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#34d399' }}>my_location</span>
                              <span>Auto-Detect GPS</span>
                            </>
                          )}
                        </button>
                      </div>

                      {gpsLockedNoticeDelivery && (
                        <div style={{
                          marginBottom: 6,
                          padding: '4px 10px',
                          borderRadius: 8,
                          background: '#ecfdf5',
                          border: '1px solid #a7f3d0',
                          color: '#065f46',
                          fontSize: 11,
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6
                        }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#059669' }}>check_circle</span>
                          <span>{gpsLockedNoticeDelivery}</span>
                        </div>
                      )}

                      {/* Selectable Presets */}
                      <select
                        value={KERALA_TOWN_PRESETS.some(t => deliveryForm.operatingCity?.includes(t.name)) ? KERALA_TOWN_PRESETS.find(t => deliveryForm.operatingCity?.includes(t.name))?.name : ''}
                        onChange={e => {
                          const chosen = KERALA_TOWN_PRESETS.find(t => t.name === e.target.value);
                          if (chosen) {
                            setDeliveryForm(prev => ({
                              ...prev,
                              operatingCity: `${chosen.name}, ${chosen.district}, Kerala`,
                              latitude: String(chosen.lat),
                              longitude: String(chosen.lon)
                            }));
                          }
                        }}
                        style={{ width: '100%', padding: '0.65rem 0.8rem', borderRadius: 10, border: '1px solid #c0c8c5', fontSize: 13, background: '#ffffff', marginBottom: 6, fontWeight: 700, color: '#032f28' }}
                      >
                        <option value="">-- Choose Town on Map / Registry --</option>
                        {KERALA_TOWN_PRESETS.map(t => (
                          <option key={t.name} value={t.name}>
                            📍 {t.name} ({t.district} District)
                          </option>
                        ))}
                      </select>

                      <input
                        type="text"
                        required
                        value={deliveryForm.operatingCity}
                        onChange={e => setDeliveryForm({ ...deliveryForm, operatingCity: e.target.value })}
                        placeholder="Town"
                        style={{ width: '100%', padding: '0.65rem 0.8rem', borderRadius: 10, border: '1px solid #c0c8c5', fontSize: 13, background: '#ffffff', fontWeight: 700, color: '#032f28' }}
                      />
                      <span style={{ fontSize: 11, color: '#717976', marginTop: 4, display: 'block' }}>
                        The map anchor town where participating dispensaries pack orders for you.
                      </span>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28', marginBottom: 4 }}>
                        Localities / Towns You Deliver To
                      </label>
                      <input
                        type="text"
                        value={deliveryForm.coverageLocalities || ''}
                        onChange={e => setDeliveryForm({ ...deliveryForm, coverageLocalities: e.target.value })}
                        placeholder="Localities"
                        style={{ width: '100%', padding: '0.65rem 0.8rem', borderRadius: 10, border: '1px solid #c0c8c5', fontSize: 13, background: '#ffffff', fontWeight: 700, color: '#032f28' }}
                      />
                      <span style={{ fontSize: 11, color: '#717976', marginTop: 4, display: 'block' }}>
                        Specify the neighborhoods and villages where you can transport medicine deliveries.
                      </span>
                    </div>
                  </div>

                  {/* Radius Slider */}
                  <div style={{ background: '#ffffff', padding: '1rem', borderRadius: 14, border: '1px solid #e0f2eb' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>radar</span>
                        <label style={{ fontSize: 12, fontWeight: 700, color: '#032f28' }}>
                          Delivery Dispatch Radius: <strong style={{ color: '#2e685d' }}>{deliveryForm.operatingRadiusKm} km</strong> from Dispensary Hub
                        </label>
                      </div>
                      <span style={{ fontSize: 11, color: '#717976', fontWeight: 600 }}>1 km – 50 km perimeter</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="50"
                      value={deliveryForm.operatingRadiusKm}
                      onChange={e => setDeliveryForm({ ...deliveryForm, operatingRadiusKm: Number(e.target.value) })}
                      style={{ width: '100%', accentColor: '#032f28', cursor: 'pointer' }}
                    />
                  </div>
                </div>

                {/* ── SECTION 3: TRANSPORT FLEET & EQUIPMENT ── */}
                <div style={{
                  background: '#f8fafc',
                  borderRadius: 20,
                  padding: '1.5rem',
                  border: '1px solid #e0f2eb'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 10, background: '#e0f2eb', color: '#2e685d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>two_wheeler</span>
                    </div>
                    <div>
                      <h3 style={{ fontSize: 14, fontWeight: 800, color: '#032f28', margin: 0 }}>
                        3. Transport Fleet &amp; Logistics Equipment
                      </h3>
                      <span style={{ fontSize: 11, color: '#717976' }}>
                        Select your primary transportation method for medicine collection
                      </span>
                    </div>
                  </div>

                  {/* Selectable Vehicle Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
                    {[
                      { id: 'MOTORCYCLE', label: 'Motorcycle / Bike', icon: 'two_wheeler' },
                      { id: 'SCOOTER', label: 'Electric Scooter', icon: 'electric_moped' },
                      { id: 'CAR', label: 'Car / 4-Wheeler', icon: 'directions_car' },
                      { id: 'BICYCLE', label: 'Bicycle', icon: 'pedal_bike' },
                      { id: 'ON_FOOT', label: 'Walking Courier', icon: 'directions_walk' }
                    ].map(v => {
                      const isSelected = deliveryForm.vehicleType === v.id;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setDeliveryForm({ ...deliveryForm, vehicleType: v.id })}
                          style={{
                            background: isSelected ? '#e0f2eb' : '#ffffff',
                            border: isSelected ? '2px solid #2e685d' : '1px solid #d5e6e0',
                            borderRadius: 14,
                            padding: '0.85rem 0.65rem',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '0.4rem',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 24, color: isSelected ? '#032f28' : '#717976' }}>
                            {v.icon}
                          </span>
                          <span style={{ fontSize: 11, fontWeight: isSelected ? 800 : 600, color: isSelected ? '#032f28' : '#414846', textAlign: 'center' }}>
                            {v.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Cold-Chain Carrier Affirmation */}
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.85rem 1rem',
                    borderRadius: 14,
                    background: '#ffffff',
                    border: '1px solid #e0f2eb',
                    cursor: 'pointer'
                  }}>
                    <input
                      type="checkbox"
                      checked={deliveryForm.hasInsulatedBag !== false}
                      onChange={e => setDeliveryForm({ ...deliveryForm, hasInsulatedBag: e.target.checked })}
                      style={{ width: 18, height: 18, accentColor: '#032f28' }}
                    />
                    <div style={{ fontSize: 12, color: '#032f28' }}>
                      <strong>Equipped with insulated / thermal courier pouch:</strong> Prepared for temperature-sensitive items (e.g. insulin, biologics, liquid suspensions).
                    </div>
                  </label>
                </div>

                {/* ── SECTION 4: ROUTE EXPERIENCE & BIO ── */}
                <div style={{
                  background: '#f8fafc',
                  borderRadius: 20,
                  padding: '1.5rem',
                  border: '1px solid #e0f2eb'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 10, background: '#e0f2eb', color: '#2e685d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>notes</span>
                    </div>
                    <div>
                      <h3 style={{ fontSize: 14, fontWeight: 800, color: '#032f28', margin: 0 }}>
                        4. Delivery Experience &amp; Route Familiarity Notes
                      </h3>
                      <span style={{ fontSize: 11, color: '#717976' }}>
                        Optional notes for dispensaries and local dispatch coordinators
                      </span>
                    </div>
                  </div>
                  <textarea
                    rows={2}
                    value={deliveryForm.bio}
                    onChange={e => setDeliveryForm({ ...deliveryForm, bio: e.target.value })}
                    placeholder="Bio"
                    style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: 12, border: '1px solid #c0c8c5', fontSize: 13, background: '#ffffff', resize: 'vertical', fontWeight: 700, color: '#032f28' }}
                  />
                </div>

                {/* Submit with FlowButton (Reference ink-fill animation) */}
                <div>
                  <FlowButton
                    type="submit"
                    variant="primary"
                    size="lg"
                    fullWidth
                    loading={actionLoading}
                  >
                    Complete Delivery Setup &amp; Enter Portal
                  </FlowButton>
                </div>
              </form>
            </div>
          )}

          {/* ── Sub-step: Healthcare Professional Application ── */}
          {onboardingStage === 'PROFESSIONAL_APPLICATION' && (
            <div style={{
              background: '#ffffff',
              borderRadius: 28,
              padding: '2.5rem 2rem',
              border: '1px solid #d5e6e0',
              boxShadow: '0 12px 40px rgba(3,47,40,0.08)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => setOnboardingStage('ROLE_SELECTION')}
                  style={{ background: 'none', border: 'none', color: '#2e685d', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: 13, fontWeight: 700 }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_back</span>
                  <span>Change Track</span>
                </button>
              </div>

              <h2 style={{ fontSize: 26, fontWeight: 800, color: '#032f28', margin: 0 }}>
                Healthcare Professional Application
              </h2>
              <p style={{ fontSize: 14, color: '#414846', marginTop: '0.35rem', marginBottom: '1.5rem' }}>
                Submit your professional credentials and clinical services for administrator review.
              </p>

              <div style={{
                background: '#fff8f6',
                border: '1px solid #ffdad6',
                borderRadius: 16,
                padding: '0.85rem 1.25rem',
                marginBottom: '1.5rem',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem'
              }}>
                <span className="material-symbols-outlined" style={{ color: '#ba1a1a', fontSize: 22, marginTop: 1 }}>security</span>
                <div style={{ fontSize: 12, color: '#5a0100', lineHeight: 1.5 }}>
                  <strong>Default Status is PENDING Review:</strong> Submitting this application will establish your professional record in <code>PENDING</code> status. In Phase 2, administrator review will verify council registration and credentials. Clinical services remain unbookable until approved.
                </div>
              </div>

              <form onSubmit={handleSubmitProApplication} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28', marginBottom: 4 }}>
                      Professional Full Name
                    </label>
                    <input
                      type="text"
                      required
                      value={proForm.name}
                      onChange={e => setProForm({ ...proForm, name: e.target.value })}
                      style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: 12, border: '1px solid #c0c8c5', fontSize: 13 }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28', marginBottom: 4 }}>
                      Profession / Category
                    </label>
                    <select
                      value={proForm.professionTitle}
                      onChange={e => setProForm({ ...proForm, professionTitle: e.target.value })}
                      style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: 12, border: '1px solid #c0c8c5', fontSize: 13, background: '#ffffff' }}
                    >
                      <option value="Registered Nurse (RN)">Registered Nurse (RN)</option>
                      <option value="General Nurse & Midwife (GNM)">General Nurse & Midwife (GNM)</option>
                      <option value="Auxiliary Nurse Midwife (ANM)">Auxiliary Nurse Midwife (ANM)</option>
                      <option value="Clinical Care Assistant">Clinical Care Assistant</option>
                      <option value="Home Nursing Aide">Home Nursing Aide</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28', marginBottom: 4 }}>
                      Nursing / Council Registration Number <span style={{ color: '#ba1a1a' }}>*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Reg #"
                      value={proForm.registrationNumber}
                      onChange={e => setProForm({ ...proForm, registrationNumber: e.target.value })}
                      style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: 12, border: '1px solid #c0c8c5', fontSize: 13, fontWeight: 700, color: '#032f28' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28', marginBottom: 4 }}>
                      Issuing Licensing Authority / Council <span style={{ color: '#ba1a1a' }}>*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Authority"
                      value={proForm.issuingAuthority}
                      onChange={e => setProForm({ ...proForm, issuingAuthority: e.target.value })}
                      style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: 12, border: '1px solid #c0c8c5', fontSize: 13, fontWeight: 700, color: '#032f28' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28', marginBottom: 4 }}>
                      Qualifications Summary <span style={{ color: '#ba1a1a' }}>*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Qualifications"
                      value={proForm.qualifications}
                      onChange={e => setProForm({ ...proForm, qualifications: e.target.value })}
                      style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: 12, border: '1px solid #c0c8c5', fontSize: 13, fontWeight: 700, color: '#032f28' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28', marginBottom: 4 }}>
                      Years of Experience <span style={{ color: '#ba1a1a' }}>*</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="60"
                      required
                      value={proForm.yearsOfExperience}
                      onChange={e => setProForm({ ...proForm, yearsOfExperience: Number(e.target.value) })}
                      style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: 12, border: '1px solid #c0c8c5', fontSize: 13 }}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                      <label style={{ fontSize: 12, fontWeight: 700, color: '#032f28' }}>
                        Clinical Base / Town Territory <span style={{ color: '#ba1a1a' }}>*</span>
                      </label>
                      <button
                        type="button"
                        disabled={detectingGpsPro}
                        onClick={handleDetectProGps}
                        style={{
                          border: 'none',
                          background: detectingGpsPro
                            ? 'linear-gradient(135deg, #1e453e 0%, #2e685d 100%)'
                            : 'linear-gradient(135deg, #032f28 0%, #1e453e 100%)',
                          color: '#ffffff',
                          borderRadius: 99,
                          padding: '5px 12px',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: detectingGpsPro ? 'wait' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          boxShadow: '0 2px 6px rgba(3, 47, 40, 0.2)',
                          transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                          opacity: detectingGpsPro ? 0.85 : 1
                        }}
                        title="Auto-detect current device GPS coordinates"
                      >
                        {detectingGpsPro ? (
                          <>
                            <span className="material-symbols-outlined animate-spin" style={{ fontSize: 13, color: '#34d399' }}>progress_activity</span>
                            <span>Detecting GPS...</span>
                          </>
                        ) : (
                          <>
                            <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#34d399' }}>my_location</span>
                            <span>Auto-Detect GPS</span>
                          </>
                        )}
                      </button>
                    </div>

                    {gpsLockedNoticePro && (
                      <div style={{
                        marginBottom: 6,
                        padding: '4px 10px',
                        borderRadius: 8,
                        background: '#ecfdf5',
                        border: '1px solid #a7f3d0',
                        color: '#065f46',
                        fontSize: 11,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#059669' }}>check_circle</span>
                        <span>{gpsLockedNoticePro}</span>
                      </div>
                    )}

                    <select
                      value={KERALA_TOWN_PRESETS.some(t => proForm.operatingCity?.includes(t.name)) ? KERALA_TOWN_PRESETS.find(t => proForm.operatingCity?.includes(t.name))?.name : ''}
                      onChange={e => {
                        const chosen = KERALA_TOWN_PRESETS.find(t => t.name === e.target.value);
                        if (chosen) {
                          setProForm(prev => ({
                            ...prev,
                            operatingCity: `${chosen.name}, ${chosen.district}, Kerala`,
                            latitude: String(chosen.lat),
                            longitude: String(chosen.lon)
                          }));
                        }
                      }}
                      style={{ width: '100%', padding: '0.65rem 0.8rem', borderRadius: 10, border: '1px solid #c0c8c5', fontSize: 13, background: '#ffffff', marginBottom: 6, fontWeight: 700, color: '#032f28' }}
                    >
                      <option value="">-- Choose Town on Map / Registry --</option>
                      {KERALA_TOWN_PRESETS.map(t => (
                        <option key={t.name} value={t.name}>
                          📍 {t.name} ({t.district} District)
                        </option>
                      ))}
                    </select>

                    <input
                      type="text"
                      required
                      value={proForm.operatingCity}
                      onChange={e => setProForm({ ...proForm, operatingCity: e.target.value })}
                      placeholder="Town"
                      style={{ width: '100%', padding: '0.65rem 0.8rem', borderRadius: 10, border: '1px solid #c0c8c5', fontSize: 13, background: '#ffffff', fontWeight: 700, color: '#032f28' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28', marginBottom: 4 }}>
                      Service Radius ({proForm.operatingRadiusKm} km)
                    </label>
                    <input
                      type="range"
                      min="2"
                      max="50"
                      value={proForm.operatingRadiusKm}
                      onChange={e => setProForm({ ...proForm, operatingRadiusKm: Number(e.target.value) })}
                      style={{ width: '100%', accentColor: '#032f28', marginTop: 8 }}
                    />
                  </div>
                </div>

                {/* Candidate Service Categories */}
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28', marginBottom: 6 }}>
                    Clinical Service Categories Applied For (Select all that apply) <span style={{ color: '#ba1a1a' }}>*</span>
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {Object.keys(FUTURE_CLINICAL_SERVICES).map(serviceKey => {
                      const svc = FUTURE_CLINICAL_SERVICES[serviceKey];
                      const isSelected = proForm.serviceAreasApplied.includes(serviceKey);
                      return (
                        <label
                          key={serviceKey}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '0.75rem',
                            padding: '0.75rem 1rem',
                            borderRadius: 14,
                            border: isSelected ? '1.5px solid #2e685d' : '1px solid #e0f2eb',
                            background: isSelected ? '#f5faf8' : '#ffffff',
                            cursor: 'pointer'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              setProForm(prev => ({
                                ...prev,
                                serviceAreasApplied: isSelected
                                  ? prev.serviceAreasApplied.filter(k => k !== serviceKey)
                                  : [...prev.serviceAreasApplied, serviceKey]
                              }));
                            }}
                            style={{ marginTop: 3, accentColor: '#032f28' }}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#032f28' }}>{svc.label}</div>
                            <div style={{ fontSize: 11, color: '#414846', marginTop: 2 }}>{svc.description}</div>
                            <div style={{ fontSize: 10, color: '#2e685d', fontWeight: 600, marginTop: 2 }}>Scope requirement: {svc.requirements}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28', marginBottom: 4 }}>
                    Professional Practice Background & Experience
                  </label>
                  <textarea
                    rows={2}
                    value={proForm.bio}
                    onChange={e => setProForm({ ...proForm, bio: e.target.value })}
                    placeholder="Bio"
                    style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: 12, border: '1px solid #c0c8c5', fontSize: 13, fontWeight: 700, color: '#032f28' }}
                  />
                </div>

                {/* Applicant Declaration */}
                <div style={{
                  background: '#e0f2eb',
                  borderRadius: 14,
                  padding: '1rem 1.25rem',
                  border: '1px solid #b0ecdd',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.75rem'
                }}>
                  <input
                    type="checkbox"
                    id="declarationCheck"
                    required
                    checked={proForm.declarationAccepted}
                    onChange={e => setProForm({ ...proForm, declarationAccepted: e.target.checked })}
                    style={{ marginTop: 3, accentColor: '#032f28', width: 18, height: 18, cursor: 'pointer' }}
                  />
                  <label htmlFor="declarationCheck" style={{ fontSize: 12, color: '#032f28', lineHeight: 1.5, cursor: 'pointer' }}>
                    <strong>Applicant Truthfulness Declaration <span style={{ color: '#ba1a1a' }}>*</span>:</strong> I solemnly declare that all personal details, educational & professional qualifications, and professional council registrations provided herein are true, accurate, and current. I understand that any false statement or forged document will result in immediate disqualification, cancellation of services, and account suspension.
                  </label>
                </div>

                <div style={{ fontSize: 11, color: '#717976', fontStyle: 'italic' }}>
                  Note: Supporting certificates (Council Registration, Degree/Diploma) can be uploaded securely after submission in your verification workspace.
                </div>

                <FlowButton
                  type="submit"
                  variant="primary"
                  size="lg"
                  loading={actionLoading}
                  style={{ marginTop: '0.5rem' }}
                >
                  {actionLoading ? 'Submitting Application...' : 'Submit Professional Application'}
                </FlowButton>
              </form>
            </div>
          )}
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────── */}
      {/* ONBOARDED ASSISTANT PORTAL WORKSPACE */}
      {/* ──────────────────────────────────────────────────────────────────────── */}
      {!showSkeleton && isRoleOnboarded && (
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '2rem 1.5rem' }}>
          {/* Top Workspace Context & Status Banner */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1.5rem' }}>
              <div>
                {/* Dynamic Personalized Time-of-Day Greeting */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    color: '#2e685d',
                    fontSize: 16,
                    fontWeight: 800,
                    letterSpacing: '-0.01em'
                  }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#2e685d' }}>{assistantGreetIcon}</span>
                    <span>{assistantTimeGreet}, {assistantFirstName}!</span>
                  </span>

                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    background: '#e0f2eb',
                    color: '#032f28',
                    padding: '0.2rem 0.65rem',
                    borderRadius: 99,
                    fontSize: 11,
                    fontWeight: 700
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2e685d' }}></span>
                    {isHealthcareRole ? 'Healthcare Track' : 'Delivery Track'}
                  </span>

                  <span style={{
                    background: '#b0ecdd',
                    color: '#336c61',
                    padding: '0.2rem 0.65rem',
                    borderRadius: 99,
                    fontSize: 11,
                    fontWeight: 700
                  }}>
                    {isHealthcareRole
                      ? `Role: ${profile.professionTitle || 'Healthcare Professional'}`
                      : `Zone: ${profile.operatingCity || regionName} (${profile.operatingRadiusKm || 10} km)`}
                  </span>

                  <span style={{
                    background: profile.verificationStatus === 'APPROVED' ? '#dcfce7' : '#fef3c7',
                    color: profile.verificationStatus === 'APPROVED' ? '#166534' : '#92400e',
                    border: `1px solid ${profile.verificationStatus === 'APPROVED' ? '#86efac' : '#fde68a'}`,
                    padding: '0.2rem 0.65rem',
                    borderRadius: 99,
                    fontSize: 11,
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem'
                  }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
                      {profile.verificationStatus === 'APPROVED' ? 'verified' : 'pending_actions'}
                    </span>
                    <span>
                      {profile.verificationStatus === 'APPROVED' ? 'Verified & Approved' : 'Verification Pending Admin Clearance'}
                    </span>
                  </span>
                </div>

                {profile.verificationStatus !== 'APPROVED' && (
                  <div style={{
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    borderRadius: 14,
                    padding: '0.75rem 1rem',
                    marginBottom: '0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.65rem',
                    color: '#92400e',
                    fontSize: 12.5,
                    lineHeight: 1.45
                  }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#b45309', flexShrink: 0 }}>admin_panel_settings</span>
                    <div>
                      <strong>Account Under Administrator Review: </strong>
                      <span>Your profile is queued for MediFind operations command verification. Live pharmacy dispatch assignments and order confirmations require administrator review.</span>
                    </div>
                  </div>
                )}

                <h1 style={{ fontSize: 32, fontWeight: 700, color: '#032f28', margin: 0, letterSpacing: '-0.02em' }}>
                  {isHealthcareRole ? 'Healthcare Professional Portal' : 'Medicine Delivery Assistant Dashboard'}
                </h1>
                <p style={{ fontSize: 15, color: '#414846', margin: '0.35rem 0 0 0' }}>
                  {isHealthcareRole
                    ? 'Manage your professional application, view approved clinical scopes, and track verification status.'
                    : 'Coordinate secure medicine collection and PIN-verified doorstep delivery.'}
                </p>
              </div>

              {/* Actions Console */}
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
                    {isHealthcareRole ? 'medical_services' : (profile?.isAvailable ? 'support_agent' : 'person_off')}
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
                    {isHealthcareRole && (
                      <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '0.15rem 0.55rem',
                        borderRadius: 99,
                        background: '#e0f2eb',
                        color: '#032f28'
                      }}>
                        Reg #{profile.registrationNumber || 'Not submitted'}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#717976', marginTop: 3 }}>
                    {isHealthcareRole ? (
                      <span>Application State: <strong>{profile.verificationStatus || 'PENDING'} Review</strong> • Clinical Scope Protected</span>
                    ) : (
                      <span>Service Scope: <strong>Medicine Delivery</strong> • Vehicle: <strong>{profile?.vehicleType || 'MOTORCYCLE'}</strong></span>
                    )}
                    {profile?.bio ? ` • “${profile.bio}”` : ''}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                <FlowButton
                  type="button"
                  onClick={handleToggleAvailability}
                  variant={profile?.isAvailable ? 'outline' : 'secondary'}
                  size="sm"
                  style={{
                    color: profile?.isAvailable ? '#ba1a1a' : '#032f28',
                    borderColor: profile?.isAvailable ? '#ffdad6' : '#2e685d'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4 }}>
                    {profile?.isAvailable ? 'pause_circle' : 'play_circle'}
                  </span>
                  <span>{profile?.isAvailable ? 'Pause Duty' : 'Go On Duty'}</span>
                </FlowButton>

                {!isHealthcareRole && (
                  <FlowButton
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => setEditingCapabilities(true)}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4 }}>tune</span>
                    <span>Manage Capabilities</span>
                  </FlowButton>
                )}
              </div>
            </div>

            {/* ── HEALTHCARE PROFESSIONAL APPLICATION STATUS & DOCUMENT WORKSPACE ── */}
            {isHealthcareRole && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <h2 style={{ fontSize: 20, fontWeight: 800, color: '#032f28', margin: 0 }}>
                    Application Verification & Review Progress
                  </h2>
                </div>
                {/* 1. Dynamic Status Banners */}
                {profile.verificationStatus === 'NEEDS_CORRECTION' && (
                  <div style={{
                    background: '#fff8f0',
                    border: '2px solid #b36b00',
                    borderRadius: 22,
                    padding: '1.5rem 1.75rem',
                    boxShadow: '0 6px 20px rgba(179,107,0,0.1)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                        <div style={{ width: 44, height: 44, borderRadius: 14, background: '#ffeed4', color: '#b36b00', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 26 }}>edit_note</span>
                        </div>
                        <div>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: '#ffeed4', color: '#804c00', padding: '0.2rem 0.65rem', borderRadius: 99, fontSize: 11, fontWeight: 800, marginBottom: 4 }}>
                            STATUS: NEEDS CORRECTION
                          </div>
                          <h3 style={{ fontSize: 18, fontWeight: 800, color: '#4a2c00', margin: 0 }}>
                            Action Required: The Reviewing Administrator Requested Corrections
                          </h3>
                          <div style={{ fontSize: 13, color: '#663d00', marginTop: 6, lineHeight: 1.5, background: '#ffffff', padding: '0.75rem 1rem', borderRadius: 12, border: '1px solid #ffd8a8' }}>
                            <strong>Administrator Note:</strong> {profile.correctionReason || 'Please review your uploaded documents or application details.'}
                          </div>
                          <p style={{ fontSize: 12, color: '#804c00', margin: '0.5rem 0 0 0' }}>
                            Update your details below or upload missing documents, then click <strong>Submit Resubmission for Review</strong>.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsEditingApplication(!isEditingApplication)}
                        style={{
                          background: '#b36b00',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: 12,
                          padding: '0.65rem 1.25rem',
                          fontSize: 13,
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem'
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{isEditingApplication ? 'close' : 'edit'}</span>
                        <span>{isEditingApplication ? 'Close Editor' : 'Edit Application Details'}</span>
                      </button>
                    </div>
                  </div>
                )}

                {profile.verificationStatus === 'REJECTED' && (
                  <div style={{
                    background: '#fff8f6',
                    border: '2px solid #ba1a1a',
                    borderRadius: 22,
                    padding: '1.5rem 1.75rem',
                    boxShadow: '0 6px 20px rgba(186,26,26,0.1)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                      <div style={{ width: 44, height: 44, borderRadius: 14, background: '#ffdad6', color: '#ba1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 26 }}>cancel</span>
                      </div>
                      <div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: '#ffdad6', color: '#93000a', padding: '0.2rem 0.65rem', borderRadius: 99, fontSize: 11, fontWeight: 800, marginBottom: 4 }}>
                          STATUS: REJECTED
                        </div>
                        <h3 style={{ fontSize: 18, fontWeight: 800, color: '#93000a', margin: 0 }}>
                          Application Not Approved
                        </h3>
                        <div style={{ fontSize: 13, color: '#680005', marginTop: 6, lineHeight: 1.5, background: '#ffffff', padding: '0.75rem 1rem', borderRadius: 12, border: '1px solid #ffdad6' }}>
                          <strong>Reason for Rejection:</strong> {profile.rejectionReason || 'The application or submitted credentials did not meet verification criteria.'}
                        </div>
                        <p style={{ fontSize: 12, color: '#93000a', margin: '0.5rem 0 0 0' }}>
                          Healthcare service tasks remain restricted. For questions, contact support or consider switching to the Delivery Assistant track.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {profile.verificationStatus === 'SUSPENDED' && (
                  <div style={{
                    background: '#2b0b0a',
                    border: '2px solid #ff897d',
                    borderRadius: 22,
                    padding: '1.5rem 1.75rem',
                    color: '#ffffff'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                      <div style={{ width: 44, height: 44, borderRadius: 14, background: '#93000a', color: '#ffdad6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 26 }}>block</span>
                      </div>
                      <div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: '#93000a', color: '#ffdad6', padding: '0.2rem 0.65rem', borderRadius: 99, fontSize: 11, fontWeight: 800, marginBottom: 4 }}>
                          STATUS: ACCOUNT SUSPENDED
                        </div>
                        <h3 style={{ fontSize: 18, fontWeight: 800, color: '#ffdad6', margin: 0 }}>
                          Professional Account Suspended
                        </h3>
                        <div style={{ fontSize: 13, color: '#ffece9', marginTop: 6, lineHeight: 1.5, background: '#410002', padding: '0.75rem 1rem', borderRadius: 12 }}>
                          <strong>Suspension Reason:</strong> {profile.suspensionReason || 'Account suspended pending administrative or regulatory review.'}
                        </div>
                        <p style={{ fontSize: 12, color: '#ffb4ab', margin: '0.5rem 0 0 0' }}>
                          Suspended professionals are strictly blocked from accepting new tasks or providing bookable services.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {profile.verificationStatus === 'APPROVED' && (
                  <div style={{
                    background: '#f0fdf4',
                    border: '2px solid #16a34a',
                    borderRadius: 22,
                    padding: '1.5rem 1.75rem',
                    boxShadow: '0 6px 20px rgba(22,163,74,0.1)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                        <div style={{ width: 44, height: 44, borderRadius: 14, background: '#dcfce7', color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 26 }}>verified</span>
                        </div>
                        <div>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: '#dcfce7', color: '#166534', padding: '0.2rem 0.65rem', borderRadius: 99, fontSize: 11, fontWeight: 800, marginBottom: 4 }}>
                            STATUS: APPROVED & VERIFIED
                          </div>
                          <h3 style={{ fontSize: 18, fontWeight: 800, color: '#14532d', margin: 0 }}>
                            Verified Healthcare Professional
                          </h3>
                          <p style={{ fontSize: 13, color: '#166534', margin: '0.35rem 0 0.75rem 0' }}>
                            Your credentials and documents have been evaluated and approved by platform administrators.
                          </p>
                          <div>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#14532d', display: 'block', marginBottom: 4 }}>
                              Individually Approved Clinical Service Scopes:
                            </span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                              {(profile.approvedServices || []).length > 0 ? (
                                (profile.approvedServices || []).map(svc => (
                                  <span key={svc} style={{
                                    background: '#bbf7d0',
                                    color: '#14532d',
                                    padding: '0.25rem 0.7rem',
                                    borderRadius: 99,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4
                                  }}>
                                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>check</span>
                                    {FUTURE_CLINICAL_SERVICES[svc]?.label || svc}
                                  </span>
                                ))
                              ) : (
                                <span style={{ fontSize: 12, color: '#15803d', fontStyle: 'italic' }}>
                                  General Healthcare Professional verification confirmed.
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Phase 3 Live Healthcare Professional Workspace */}
                    <HealthcareAppointmentsWorkspace
                      profile={profile}
                      onToast={(msg, type) => showToast(msg, type)}
                    />
                  </div>
                )}

                {(profile.verificationStatus === 'PENDING' || profile.verificationStatus === 'UNDER_REVIEW') && (
                  <div style={{
                    background: profile.verificationStatus === 'UNDER_REVIEW' ? '#f0fdfa' : '#fffbeb',
                    border: `1.5px solid ${profile.verificationStatus === 'UNDER_REVIEW' ? '#0d9488' : '#f59e0b'}`,
                    borderRadius: 22,
                    padding: '1.25rem 1.75rem'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div style={{
                        width: 44,
                        height: 44,
                        borderRadius: 14,
                        background: profile.verificationStatus === 'UNDER_REVIEW' ? '#ccfbf1' : '#fef3c7',
                        color: profile.verificationStatus === 'UNDER_REVIEW' ? '#0f766e' : '#b45309',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 26 }}>
                          {profile.verificationStatus === 'UNDER_REVIEW' ? 'find_in_page' : 'hourglass_top'}
                        </span>
                      </div>
                      <div>
                        <div style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          background: profile.verificationStatus === 'UNDER_REVIEW' ? '#ccfbf1' : '#fef3c7',
                          color: profile.verificationStatus === 'UNDER_REVIEW' ? '#0f766e' : '#92400e',
                          padding: '0.2rem 0.65rem',
                          borderRadius: 99,
                          fontSize: 11,
                          fontWeight: 800,
                          marginBottom: 4
                        }}>
                          STATUS: {profile.verificationStatus}
                        </div>
                        <h3 style={{ fontSize: 16, fontWeight: 800, color: '#032f28', margin: 0 }}>
                          {profile.verificationStatus === 'UNDER_REVIEW'
                            ? 'Administrator Review In Progress'
                            : 'Application Queued for Verification'}
                        </h3>
                        <p style={{ fontSize: 12, color: '#414846', margin: '0.25rem 0 0 0' }}>
                          {profile.verificationStatus === 'UNDER_REVIEW'
                            ? 'An administrator is currently inspecting your council registration and uploaded credentials.'
                            : 'Your application is awaiting administrator evaluation. Upload supporting documents below if not already attached.'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. Inline Edit & Resubmit Form (if editing requested) */}
                {isEditingApplication && (
                  <div style={{
                    background: '#ffffff',
                    borderRadius: 22,
                    border: '1.5px solid #2e685d',
                    padding: '1.75rem',
                    boxShadow: '0 8px 30px rgba(46,104,93,0.08)'
                  }}>
                    <h3 style={{ fontSize: 18, fontWeight: 800, color: '#032f28', margin: '0 0 0.5rem 0' }}>
                      Edit & Resubmit Professional Application
                    </h3>
                    <p style={{ fontSize: 13, color: '#414846', marginTop: 0, marginBottom: '1.25rem' }}>
                      Update any incorrect details or add missing information as requested by the reviewing administrator.
                    </p>

                    <form onSubmit={handleSubmitProApplication} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                        <div>
                          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28', marginBottom: 4 }}>Full Name</label>
                          <input
                            type="text"
                            required
                            value={proForm.name}
                            onChange={e => setProForm({ ...proForm, name: e.target.value })}
                            style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: 10, border: '1px solid #c0c8c5', fontSize: 13 }}
                          />
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28', marginBottom: 4 }}>Profession Title</label>
                          <select
                            value={proForm.professionTitle}
                            onChange={e => setProForm({ ...proForm, professionTitle: e.target.value })}
                            style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: 10, border: '1px solid #c0c8c5', fontSize: 13, background: '#fff' }}
                          >
                            <option value="Registered Nurse (RN)">Registered Nurse (RN)</option>
                            <option value="General Nurse & Midwife (GNM)">General Nurse & Midwife (GNM)</option>
                            <option value="Auxiliary Nurse Midwife (ANM)">Auxiliary Nurse Midwife (ANM)</option>
                            <option value="Clinical Care Assistant">Clinical Care Assistant</option>
                            <option value="Home Nursing Aide">Home Nursing Aide</option>
                          </select>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                        <div>
                          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28', marginBottom: 4 }}>Registration Number *</label>
                          <input
                            type="text"
                            required
                            value={proForm.registrationNumber}
                            onChange={e => setProForm({ ...proForm, registrationNumber: e.target.value })}
                            style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: 10, border: '1px solid #c0c8c5', fontSize: 13 }}
                          />
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28', marginBottom: 4 }}>Issuing Authority / Body *</label>
                          <input
                            type="text"
                            required
                            value={proForm.issuingAuthority}
                            onChange={e => setProForm({ ...proForm, issuingAuthority: e.target.value })}
                            style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: 10, border: '1px solid #c0c8c5', fontSize: 13 }}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                        <div>
                          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28', marginBottom: 4 }}>Qualifications Summary *</label>
                          <input
                            type="text"
                            required
                            value={proForm.qualifications}
                            onChange={e => setProForm({ ...proForm, qualifications: e.target.value })}
                            style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: 10, border: '1px solid #c0c8c5', fontSize: 13 }}
                          />
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28', marginBottom: 4 }}>Years Experience</label>
                          <input
                            type="number"
                            min="0"
                            max="60"
                            value={proForm.yearsOfExperience}
                            onChange={e => setProForm({ ...proForm, yearsOfExperience: Number(e.target.value) })}
                            style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: 10, border: '1px solid #c0c8c5', fontSize: 13 }}
                          />
                        </div>
                      </div>

                      <div style={{
                        background: '#e0f2eb',
                        borderRadius: 12,
                        padding: '0.85rem 1rem',
                        border: '1px solid #b0ecdd',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.65rem'
                      }}>
                        <input
                          type="checkbox"
                          id="resubmitDeclaration"
                          required
                          checked={proForm.declarationAccepted}
                          onChange={e => setProForm({ ...proForm, declarationAccepted: e.target.checked })}
                          style={{ accentColor: '#032f28', width: 16, height: 16, cursor: 'pointer' }}
                        />
                        <label htmlFor="resubmitDeclaration" style={{ fontSize: 12, color: '#032f28', cursor: 'pointer' }}>
                          I confirm that the updated information is true, accurate, and supported by valid documentation.
                        </label>
                      </div>

                      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem', alignItems: 'center' }}>
                        <FlowButton
                          type="submit"
                          variant="primary"
                          size="md"
                          loading={actionLoading}
                        >
                          {actionLoading ? 'Submitting...' : 'Submit Resubmission for Review'}
                        </FlowButton>
                        <button
                          type="button"
                          onClick={() => setIsEditingApplication(false)}
                          style={{
                            background: '#f1f5f9',
                            color: '#475569',
                            border: 'none',
                            borderRadius: 12,
                            padding: '0.75rem 1.25rem',
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {/* 3. Supporting Documents Management */}
                <div style={{
                  background: '#ffffff',
                  borderRadius: 22,
                  border: '1.5px solid #d5e6e0',
                  padding: '1.75rem',
                  boxShadow: '0 4px 16px rgba(3,47,40,0.04)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
                    <div>
                      <h3 style={{ fontSize: 18, fontWeight: 800, color: '#032f28', margin: 0 }}>
                        Supporting Verification Documents
                      </h3>
                      <p style={{ fontSize: 13, color: '#414846', margin: '0.25rem 0 0 0' }}>
                        Uploaded credentials are encrypted on the server, isolated from public folders, and accessible only to you and authorized administrators.
                      </p>
                    </div>
                    <span style={{
                      background: '#e0f2eb',
                      color: '#032f28',
                      padding: '0.25rem 0.75rem',
                      borderRadius: 99,
                      fontSize: 12,
                      fontWeight: 700
                    }}>
                      {appData.documents.length} Document(s) Uploaded
                    </span>
                  </div>

                  {/* Documents List */}
                  {appData.documents.length === 0 ? (
                    <div style={{
                      textAlign: 'center',
                      padding: '2rem 1rem',
                      background: '#f8fafc',
                      borderRadius: 16,
                      border: '1px dashed #cbd5e1',
                      marginBottom: '1.5rem'
                    }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 36, color: '#94a3b8' }}>description</span>
                      <p style={{ fontSize: 13, color: '#64748b', margin: '0.5rem 0 0 0', fontWeight: 600 }}>
                        No verification documents uploaded yet.
                      </p>
                      <p style={{ fontSize: 12, color: '#94a3b8', margin: '0.25rem 0 0 0' }}>
                        Upload your nursing council registration certificate or degree certificate below.
                      </p>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                      {appData.documents.map(doc => (
                        <div key={doc.id} style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.85rem 1.25rem',
                          background: '#f8fafc',
                          borderRadius: 14,
                          border: '1px solid #e2e8f0',
                          flexWrap: 'wrap',
                          gap: '0.75rem'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#e0f2eb', color: '#032f28', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                                {doc.mimeType === 'application/pdf' ? 'picture_as_pdf' : 'image'}
                              </span>
                            </div>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 13, fontWeight: 700, color: '#032f28' }}>
                                  {doc.originalName}
                                </span>
                                <span style={{
                                  background: '#e0f2eb',
                                  color: '#032f28',
                                  fontSize: 10,
                                  fontWeight: 800,
                                  padding: '0.15rem 0.5rem',
                                  borderRadius: 99
                                }}>
                                  {doc.documentType.replace(/_/g, ' ')}
                                </span>
                                <span style={{
                                  background: doc.status === 'VERIFIED' ? '#dcfce7' : doc.status === 'REJECTED' ? '#fee2e2' : '#fef3c7',
                                  color: doc.status === 'VERIFIED' ? '#166534' : doc.status === 'REJECTED' ? '#991b1b' : '#92400e',
                                  fontSize: 10,
                                  fontWeight: 800,
                                  padding: '0.15rem 0.5rem',
                                  borderRadius: 99
                                }}>
                                  {doc.status}
                                </span>
                              </div>
                              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                                {(doc.fileSize / 1024).toFixed(1)} KB • Uploaded {new Date(doc.uploadedAt).toLocaleDateString()}
                                {doc.description ? ` • “${doc.description}”` : ''}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <button
                              type="button"
                              onClick={() => handleDownloadDoc(doc.id, doc.originalName)}
                              style={{
                                background: '#ffffff',
                                color: '#032f28',
                                border: '1px solid #cbd5e1',
                                borderRadius: 10,
                                padding: '0.4rem 0.85rem',
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.35rem'
                              }}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
                              <span>Download</span>
                            </button>

                            {appData.canEdit && (
                              <button
                                type="button"
                                onClick={() => handleDeleteDoc(doc.id)}
                                style={{
                                  background: '#fee2e2',
                                  color: '#991b1b',
                                  border: 'none',
                                  borderRadius: 10,
                                  padding: '0.4rem 0.75rem',
                                  fontSize: 12,
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.35rem'
                                }}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                                <span>Delete</span>
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Document Upload Form */}
                  {appData.canEdit && (
                    <form onSubmit={handleUploadDoc} style={{
                      background: '#f1f5f9',
                      borderRadius: 16,
                      padding: '1.25rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.85rem'
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#032f28', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>upload_file</span>
                        <span>Upload New Verification Document</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.4 }}>
                        Allowed formats: <strong>PDF, JPEG, PNG</strong> (max 5 MB). Validated via server magic bytes.
                        Do not upload Aadhaar cards; please provide official registration or alternative ID.
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                        <div>
                          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                            Document Type
                          </label>
                          <select
                            value={uploadDocType}
                            onChange={e => setUploadDocType(e.target.value)}
                            style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 12, background: '#ffffff' }}
                          >
                            <option value="COUNCIL_REGISTRATION">Council Registration Certificate (RN/GNM)</option>
                            <option value="DEGREE_CERTIFICATE">Degree / Diploma Certificate</option>
                            <option value="EXPERIENCE_CERTIFICATE">Hospital / Clinical Experience Letter</option>
                            <option value="GOVERNMENT_ID_NON_AADHAAR">Government ID (Passport / Voter / Driving)</option>
                            <option value="OTHER">Other Clinical Supporting Document</option>
                          </select>
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#334155', marginBottom: 4 }}>
                            Select File (.pdf, .jpg, .png)
                          </label>
                          <input
                            type="file"
                            accept=".pdf,image/jpeg,image/png"
                            onChange={e => setSelectedFile(e.target.files[0] || null)}
                            style={{ width: '100%', padding: '0.45rem', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 12, background: '#ffffff' }}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                          type="text"
                          placeholder="Notes"
                          value={uploadDescription}
                          onChange={e => setUploadDescription(e.target.value)}
                          style={{ flex: 1, minWidth: 200, padding: '0.6rem 0.85rem', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 12, fontWeight: 700, color: '#032f28' }}
                        />
                        <button
                          type="submit"
                          disabled={uploadingDoc || !selectedFile}
                          style={{
                            background: '#032f28',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: 10,
                            padding: '0.65rem 1.25rem',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: (uploadingDoc || !selectedFile) ? 'not-allowed' : 'pointer',
                            opacity: (uploadingDoc || !selectedFile) ? 0.6 : 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.4rem'
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>upload</span>
                          <span>{uploadingDoc ? 'Uploading & Validating...' : 'Upload Document'}</span>
                        </button>
                      </div>
                    </form>
                  )}
                </div>

                {/* 4. Review Audit Trail */}
                {appData.reviewLogs.length > 0 && (
                  <div style={{
                    background: '#ffffff',
                    borderRadius: 22,
                    border: '1.5px solid #d5e6e0',
                    padding: '1.5rem',
                    boxShadow: '0 4px 16px rgba(3,47,40,0.04)'
                  }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: '#032f28', margin: '0 0 0.85rem 0', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Application Verification Audit History
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {appData.reviewLogs.map(log => (
                        <div key={log.id} style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.75rem',
                          padding: '0.75rem 1rem',
                          background: '#f8fafc',
                          borderRadius: 12,
                          border: '1px solid #e2e8f0'
                        }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#032f28', marginTop: 1 }}>history</span>
                          <div style={{ flex: 1, fontSize: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                              <span style={{ fontWeight: 700, color: '#032f28' }}>{log.action.replace(/_/g, ' ')}</span>
                              <span style={{ color: '#64748b', fontSize: 11 }}>{new Date(log.createdAt).toLocaleString()}</span>
                            </div>
                            <div style={{ color: '#475569', marginTop: 2 }}>{log.notes}</div>
                            {log.reviewer && (
                              <div style={{ color: '#94a3b8', fontSize: 10, marginTop: 2 }}>By: {log.reviewer.name || log.reviewer.email}</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 5. Professional Application Summary */}
                <div style={{ background: '#f8fafc', borderRadius: 16, padding: '1.25rem', border: '1px solid #e0f2eb' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <h3 style={{ fontSize: 13, fontWeight: 700, color: '#032f28', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Application Summary & Qualifications
                    </h3>
                    {appData.canEdit && !isEditingApplication && (
                      <button
                        type="button"
                        onClick={() => setIsEditingApplication(true)}
                        style={{ background: 'none', border: 'none', color: '#2e685d', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>edit</span>
                        <span>Edit Details</span>
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', fontSize: 13 }}>
                    <div>
                      <span style={{ color: '#717976', fontSize: 11, display: 'block' }}>Profession:</span>
                      <strong style={{ color: '#032f28' }}>{profile.professionTitle || 'Registered Nurse'}</strong>
                    </div>
                    <div>
                      <span style={{ color: '#717976', fontSize: 11, display: 'block' }}>Registration / License:</span>
                      <strong style={{ color: '#032f28' }}>{profile.registrationNumber || 'Pending'}</strong>
                    </div>
                    <div>
                      <span style={{ color: '#717976', fontSize: 11, display: 'block' }}>Issuing Authority:</span>
                      <strong style={{ color: '#032f28' }}>{profile.issuingAuthority || 'Not provided'}</strong>
                    </div>
                    <div>
                      <span style={{ color: '#717976', fontSize: 11, display: 'block' }}>Experience:</span>
                      <strong style={{ color: '#032f28' }}>{profile.yearsOfExperience ?? 0} Year(s)</strong>
                    </div>
                    <div>
                      <span style={{ color: '#717976', fontSize: 11, display: 'block' }}>Qualifications:</span>
                      <strong style={{ color: '#032f28' }}>{profile.qualifications || 'B.Sc. Nursing'}</strong>
                    </div>
                    <div>
                      <span style={{ color: '#717976', fontSize: 11, display: 'block' }}>Operating Zone:</span>
                      <strong style={{ color: '#032f28' }}>{profile.operatingCity || 'Chengannur'} ({profile.operatingRadiusKm || 15} km)</strong>
                    </div>
                    <div>
                      <span style={{ color: '#717976', fontSize: 11, display: 'block' }}>Clinical Scope Applied:</span>
                      <strong style={{ color: '#2e685d' }}>
                        {(profile.serviceAreasApplied || []).map(s => FUTURE_CLINICAL_SERVICES[s]?.label || s).join(', ') || 'General Nursing'}
                      </strong>
                    </div>
                    <div>
                      <span style={{ color: '#717976', fontSize: 11, display: 'block' }}>Declaration Status:</span>
                      <strong style={{ color: profile.declarationAccepted ? '#166534' : '#ba1a1a' }}>
                        {profile.declarationAccepted ? '✓ Signed & Recorded' : 'Not signed'}
                      </strong>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Active Delivery Journey Alert (For Delivery Assistants) ── */}
            {!isHealthcareRole && primaryActiveTask && (() => {
              const taskStatus = primaryActiveTask.status;
              const isAssigned = taskStatus === 'ASSIGNED';
              const isAccepted = taskStatus === 'ACCEPTED';
              const isCollecting = taskStatus === 'COLLECTING';
              const isInTransit = taskStatus === 'IN_TRANSIT';
              const isDelivered = taskStatus === 'DELIVERED';

              let badgeText = 'Active Custody';
              let badgeBg = '#2e685d';
              let iconName = 'electric_moped';
              let statusDesc = '';
              let buttonLabel = 'Manage Handover';
              let buttonAction = () => setTab('active');

              if (isAssigned) {
                badgeText = 'New Dispatch Request • Awaiting Acceptance';
                badgeBg = '#d97706';
                iconName = 'assignment_late';
                statusDesc = `Incoming order request. Destination: ${primaryActiveTask.deliveryAddress || 'Patient Address'}. Accept task to begin pickup journey.`;
                buttonLabel = 'Accept Task';
                buttonAction = () => handleAcceptTask(primaryActiveTask.id);
              } else if (isAccepted) {
                badgeText = 'Task Accepted • En Route to Pharmacy';
                badgeBg = '#0d9488';
                iconName = 'storefront';
                statusDesc = `Head to the dispensary to collect and verify patient's medication package.`;
                buttonLabel = 'Arrived at Pharmacy • Collect Medicine';
                buttonAction = () => handleProgressTask(primaryActiveTask.id, 'COLLECTING');
              } else if (isCollecting) {
                badgeText = 'At Pharmacy • Verifying Package';
                badgeBg = '#0284c7';
                iconName = 'medication';
                statusDesc = `Package verification at pharmacy counter in progress. Confirm collection when received.`;
                buttonLabel = 'Medicine Collected • Out for Delivery';
                buttonAction = () => handleProgressTask(primaryActiveTask.id, 'IN_TRANSIT');
              } else if (isInTransit) {
                badgeText = 'Active Custody • Out for Delivery';
                badgeBg = '#16a34a';
                iconName = 'electric_moped';
                statusDesc = `In transit to ${primaryActiveTask.deliveryAddress || 'customer address'}. Cold chain active.`;
                buttonLabel = 'Arrived at Doorstep • Request PIN';
                buttonAction = () => handleProgressTask(primaryActiveTask.id, 'DELIVERED');
              } else if (isDelivered) {
                badgeText = 'At Customer Doorstep • PIN Verification';
                badgeBg = '#7c3aed';
                iconName = 'dialpad';
                statusDesc = `Arrived at customer location. Enter customer's 4-digit verification PIN to complete delivery.`;
                buttonLabel = 'Enter 4-Digit Handover PIN';
                buttonAction = () => setTab('active');
              }

              return (
                <div style={{
                  background: 'linear-gradient(135deg, #02251f 0%, #032f28 60%, #073f36 100%)',
                  borderRadius: 20,
                  padding: '1.25rem 1.5rem',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '1rem',
                  position: 'relative',
                  overflow: 'hidden',
                  boxShadow: '0 8px 24px rgba(3,47,40,0.2)',
                  border: '1px solid rgba(176,236,221,0.25)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(176,236,221,0.15)', color: '#c1ebe1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 24 }}>{iconName}</span>
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ background: badgeBg, color: '#ffffff', fontSize: 11, fontWeight: 700, padding: '0.2rem 0.65rem', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {badgeText}
                        </span>
                        <span style={{ fontSize: 15, fontWeight: 700, color: '#c1ebe1' }}>
                          Task #{primaryActiveTask.id.slice(0, 8).toUpperCase()}
                        </span>
                        <span style={{ fontSize: 12, color: '#8ab2a9' }}>
                          Order #{primaryActiveTask.orderId?.slice(0, 8).toUpperCase()}
                        </span>
                      </div>
                      <p style={{ margin: '0.35rem 0 0 0', fontSize: 13, color: '#d5e6e0' }}>
                        {statusDesc}
                      </p>
                    </div>
                  </div>

                  <FlowButton
                    onClick={buttonAction}
                    loading={actionLoading && (acceptingTaskId === primaryActiveTask.id || progressingTaskId === primaryActiveTask.id)}
                    disabled={actionLoading}
                    variant="secondary"
                    size="md"
                    style={{ background: '#b0ecdd', color: '#00201b', '--fb-circle-bg': '#032f28', '--fb-color': '#00201b', '--fb-border': 'rgba(3,47,40,0.25)', fontWeight: 700 }}
                  >
                    {buttonLabel}
                  </FlowButton>
                </div>
              );
            })()}

            {/* Metric Summary Grid (For Delivery Assistant) */}
            {!isHealthcareRole && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginTop: '0.5rem' }}>
                <AnimatedStatCard
                  layout="split"
                  icon="assignment_turned_in"
                  value={availableTasks.length}
                  label="Available Tasks"
                  subtitle="Awaiting assistant acceptance"
                  iconBg="#e0f2eb"
                  iconColor="#2e685d"
                  accentColor="#2e685d"
                  hasBottomBar={false}
                  delay={0}
                  refreshKey={availableTasks.length}
                />

                <AnimatedStatCard
                  layout="split"
                  icon="near_me"
                  value={activeTasks.length}
                  label="My Active Service Tasks"
                  subtitle="In progress / pending handover"
                  iconBg="#e0f2eb"
                  iconColor="#336c61"
                  accentColor="#336c61"
                  hasBottomBar={false}
                  delay={0.06}
                  refreshKey={activeTasks.length}
                />

                <AnimatedStatCard
                  layout="split"
                  icon="verified"
                  value={completedTasks.length}
                  label="Completed Service Tasks"
                  subtitle="Handover-verified completions"
                  iconBg="#e0f2eb"
                  iconColor="#2e685d"
                  accentColor="#2e685d"
                  hasBottomBar={false}
                  delay={0.12}
                  refreshKey={completedTasks.length}
                />

                <AnimatedStatCard
                  layout="split"
                  icon="sensors"
                  value={profile?.isAvailable ? 'Online' : 'Paused'}
                  label="Dispatch Status"
                  subtitle={profile?.isAvailable ? 'Ready for live delivery orders' : 'Duty paused • Standby'}
                  iconBg={profile?.isAvailable ? '#e0f2eb' : '#fff7ed'}
                  iconColor={profile?.isAvailable ? '#059669' : '#d97706'}
                  accentColor={profile?.isAvailable ? '#059669' : '#d97706'}
                  hasBottomBar={false}
                  delay={0.18}
                  valueStyle={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: profile?.isAvailable ? '#059669' : '#d97706',
                    letterSpacing: '-0.01em'
                  }}
                />
              </div>
            )}
          </div>

          {/* Navigation Tabs (Available, Active, Completed) */}
          {!isHealthcareRole && (
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
                <span>Available Requests (<RollingNumber value={availableTasks.length} />)</span>
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
                <span>My Active Service Tasks (<RollingNumber value={activeTasks.length} />)</span>
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
                <span>Completed Archive (<RollingNumber value={completedTasks.length} />)</span>
              </button>
            </div>
          )}

          {/* ── TAB 1: AVAILABLE TASKS ── */}
          {(!isHealthcareRole && tab === 'available') && (
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
                  <FlowButton
                    variant="primary"
                    size="sm"
                    onClick={handleToggleAvailability}
                  >
                    Go On Duty
                  </FlowButton>
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
                          boxShadow: '0 2px 10px rgba(3,47,40,0.04)',
                          padding: '1.5rem 1.5rem 1.5rem 1.75rem',
                          position: 'relative',
                          overflow: 'hidden',
                          transition: 'transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease'
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.transform = 'translateY(-3px)';
                          e.currentTarget.style.boxShadow = '0 8px 24px rgba(3,47,40,0.08)';
                          e.currentTarget.style.borderColor = '#2e685d';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow = '0 2px 10px rgba(3,47,40,0.04)';
                          e.currentTarget.style.borderColor = '#e0f2eb';
                        }}
                      >
                        {/* Accent left indicator bar matching patient orders card */}
                        <div style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          bottom: 0,
                          width: 6,
                          background: task.order?.isEmergency ? '#ba1a1a' : '#2e685d'
                        }} />

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
                                <DeliveryLocationBadge addressString={task.deliveryAddress} />
                              )}

                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>medication</span>
                                <span>Order Package: <RollingNumber value={task.order?.items?.length || 1} /> prescription item(s)</span>
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
                              onClick={() => handleAcceptTask(task.id)}
                              loading={actionLoading && acceptingTaskId === task.id}
                              variant="primary"
                              size="md"
                            >
                              Accept Task
                            </FlowButton>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── TAB 2: ACTIVE TASKS ── */}
          {(!isHealthcareRole && tab === 'active') && (
            <div>
              {loading ? (
                <LoadingSkeleton variant="order-card" count={1} />
              ) : activeTasks.length === 0 ? (
                <EmptyState
                  icon="near_me"
                  title="No Active Assignments"
                  description="You do not currently have any active medicine delivery tasks in transit."
                  actionLabel="Browse Available Tasks"
                  onAction={() => setTab('available')}
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  {activeTasks.map(task => {
                    const stepLabels = getAssistantStepLabels(task.serviceType);
                    const currentPin = handoverPinMap[task.id] || '';

                    return (
                      <div
                        key={task.id}
                        style={{
                          background: '#ffffff',
                          borderRadius: 24,
                          border: '1.5px solid #2e685d',
                          boxShadow: '0 4px 20px rgba(3,47,40,0.06)',
                          padding: '1.75rem 1.75rem 1.75rem 2rem',
                          position: 'relative',
                          overflow: 'hidden',
                          transition: 'transform 0.2s ease, box-shadow 0.2s ease'
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.transform = 'translateY(-2px)';
                          e.currentTarget.style.boxShadow = '0 8px 28px rgba(3,47,40,0.1)';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow = '0 4px 20px rgba(3,47,40,0.06)';
                        }}
                      >
                        {/* Accent left indicator bar matching patient orders card */}
                        <div style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          bottom: 0,
                          width: 6,
                          background: '#2e685d'
                        }} />

                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                              <span style={{ fontSize: 18, fontWeight: 800, color: '#032f28' }}>
                                Active Task #{task.id.slice(0, 8).toUpperCase()}
                              </span>
                              <span style={{
                                background: '#032f28',
                                color: '#ffffff',
                                borderRadius: 99,
                                padding: '0.2rem 0.75rem',
                                fontSize: 11,
                                fontWeight: 700
                              }}>
                                STATUS: {task.status.replace(/_/g, ' ')}
                              </span>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                              <ServiceTypeBadge serviceType={task.serviceType} />
                              <span style={{ fontSize: 12, color: '#717976' }}>• Order #{task.orderId?.slice(0, 8).toUpperCase()}</span>
                            </div>
                          </div>
                        </div>

                        {/* Delivery Handover Location & Instructions Note */}
                        {task.deliveryAddress && (
                          <div style={{ marginBottom: '1.25rem', background: '#f8fafc', padding: '0.85rem 1.15rem', borderRadius: 14, border: '1px solid #e0f2eb' }}>
                            <DeliveryLocationBadge addressString={task.deliveryAddress} />
                          </div>
                        )}

                        {/* Milestones Progress Grid */}
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                          gap: '0.75rem',
                          background: '#f8fafc',
                          borderRadius: 16,
                          padding: '1rem',
                          marginBottom: '1.25rem',
                          border: '1px solid #e0f2eb'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span className="material-symbols-outlined" style={{ color: '#2e685d', fontSize: 20 }}>check_circle</span>
                            <div>
                              <span style={{ fontSize: 10, color: '#717976', textTransform: 'uppercase', fontWeight: 700 }}>Step 1</span>
                              <div style={{ fontSize: 12, fontWeight: 700, color: '#032f28' }}>Accepted</div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span className="material-symbols-outlined" style={{
                              color: ['COLLECTING', 'IN_TRANSIT', 'DELIVERED'].includes(task.status) ? '#2e685d' : '#c0c8c5',
                              fontSize: 20
                            }}>
                              {['COLLECTING', 'IN_TRANSIT', 'DELIVERED'].includes(task.status) ? 'check_circle' : 'radio_button_unchecked'}
                            </span>
                            <div>
                              <span style={{ fontSize: 10, color: '#717976', textTransform: 'uppercase', fontWeight: 700 }}>Step 2</span>
                              <div style={{ fontSize: 12, fontWeight: 700, color: '#032f28' }}>{stepLabels.step2}</div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span className="material-symbols-outlined" style={{
                              color: ['IN_TRANSIT', 'DELIVERED'].includes(task.status) ? '#2e685d' : '#c0c8c5',
                              fontSize: 20
                            }}>
                              {['IN_TRANSIT', 'DELIVERED'].includes(task.status) ? 'check_circle' : 'radio_button_unchecked'}
                            </span>
                            <div>
                              <span style={{ fontSize: 10, color: '#717976', textTransform: 'uppercase', fontWeight: 700 }}>Step 3</span>
                              <div style={{ fontSize: 12, fontWeight: 700, color: '#032f28' }}>{stepLabels.step3}</div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span className="material-symbols-outlined" style={{
                              color: task.status === 'DELIVERED' ? '#2e685d' : '#c0c8c5',
                              fontSize: 20
                            }}>
                              {task.status === 'DELIVERED' ? 'dialpad' : 'radio_button_unchecked'}
                            </span>
                            <div>
                              <span style={{ fontSize: 10, color: '#717976', textTransform: 'uppercase', fontWeight: 700 }}>Step 4</span>
                              <div style={{ fontSize: 12, fontWeight: 700, color: '#032f28' }}>{stepLabels.step4}</div>
                            </div>
                          </div>
                        </div>

                        {/* Milestone Action Progression Buttons */}
                        {task.status === 'ASSIGNED' && (
                          <FlowButton
                            fullWidth
                            size="md"
                            variant="primary"
                            loading={actionLoading && acceptingTaskId === task.id}
                            disabled={actionLoading}
                            onClick={() => handleAcceptTask(task.id)}
                          >
                            Accept Task
                          </FlowButton>
                        )}

                        {task.status === 'ACCEPTED' && (
                          <FlowButton
                            fullWidth
                            size="md"
                            variant="primary"
                            loading={actionLoading && progressingTaskId === task.id}
                            disabled={actionLoading}
                            onClick={() => handleProgressTask(task.id, 'COLLECTING')}
                          >
                            {stepLabels.btnCollecting}
                          </FlowButton>
                        )}

                        {task.status === 'COLLECTING' && (
                          <FlowButton
                            fullWidth
                            size="md"
                            variant="primary"
                            loading={actionLoading && progressingTaskId === task.id}
                            disabled={actionLoading}
                            onClick={() => handleProgressTask(task.id, 'IN_TRANSIT')}
                          >
                            {stepLabels.btnInTransit}
                          </FlowButton>
                        )}

                        {task.status === 'IN_TRANSIT' && (
                          <FlowButton
                            fullWidth
                            size="md"
                            variant="primary"
                            loading={actionLoading && progressingTaskId === task.id}
                            disabled={actionLoading}
                            onClick={() => handleProgressTask(task.id, 'DELIVERED')}
                          >
                            {stepLabels.btnDelivered}
                          </FlowButton>
                        )}

                        {/* Handover Keypad when DELIVERED */}
                        {task.status === 'DELIVERED' && (
                          <AssistantPinKeypad
                            task={task}
                            pin={currentPin}
                            loading={actionLoading && progressingTaskId === task.id}
                            onChangePin={(val) => setHandoverPinMap({ ...handoverPinMap, [task.id]: val })}
                            onSubmit={() => handleProgressTask(task.id, 'CONFIRMED')}
                            onResendSms={() => showToast('Dispatch notification triggered: PIN resent to patient phone.', 'info')}
                            onCallDispatch={() => showToast('Connecting to MediFind Central Dispatch Hotline...', 'info')}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── TAB 3: COMPLETED ARCHIVE ── */}
          {(!isHealthcareRole && tab === 'completed') && (
            <div>
              {loading ? (
                <LoadingSkeleton variant="order-card" count={2} />
              ) : completedTasks.length === 0 ? (
                <EmptyState
                  icon="task_alt"
                  title="No Completed Tasks Yet"
                  description="Deliveries and service tasks completed with verified recipient PINs will be safely archived here."
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {completedTasks.map(task => (
                    <div
                      key={task.id}
                      style={{
                        background: '#ffffff',
                        borderRadius: 16,
                        border: '1px solid #e0f2eb',
                        padding: '1.25rem 1.5rem 1.25rem 1.75rem',
                        position: 'relative',
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '1rem',
                        transition: 'transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease'
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 6px 18px rgba(3,47,40,0.06)';
                        e.currentTarget.style.borderColor = '#2e685d';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'none';
                        e.currentTarget.style.borderColor = '#e0f2eb';
                      }}
                    >
                      {/* Left Accent Bar matching patient orders card */}
                      <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        bottom: 0,
                        width: 5,
                        background: '#10b981'
                      }} />

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
      )}

      {/* Capability Selection Modal */}
      {editingCapabilities && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(3,47,40,0.5)',
          backdropFilter: 'blur(4px)',
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
                Delivery Assistant Capabilities
              </h3>
              <button
                type="button"
                onClick={() => setEditingCapabilities(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#717976' }}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <p style={{ fontSize: 13, color: '#414846', marginTop: 0, marginBottom: '1.25rem', lineHeight: 1.5 }}>
              Delivery Assistants are strictly dedicated to medicine delivery fulfillment. Non-clinical side services have been removed to ensure focused, rapid doorstep delivery.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '1.5rem' }}>
              {Object.keys(DELIVERY_CAPABILITIES_CONFIG).map(typeKey => {
                const cfg = DELIVERY_CAPABILITIES_CONFIG[typeKey];
                return (
                  <div
                    key={typeKey}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.85rem',
                      padding: '0.85rem 1rem',
                      borderRadius: 14,
                      border: '1.5px solid #2e685d',
                      background: '#f5faf8'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={true}
                      readOnly
                      style={{ marginTop: 3, accentColor: '#2e685d' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#032f28' }}>{cfg.label}</span>
                        <span style={{
                          fontSize: 10,
                          fontWeight: 700,
                          background: '#b0ecdd',
                          color: '#00201b',
                          padding: '0.15rem 0.55rem',
                          borderRadius: 99
                        }}>
                          ACTIVE SERVICE SCOPE
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#414846', marginTop: 4, lineHeight: 1.4 }}>
                        {cfg.instruction}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setEditingCapabilities(false)}
                style={{
                  background: '#2e685d',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 99,
                  padding: '0.55rem 1.4rem',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
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
