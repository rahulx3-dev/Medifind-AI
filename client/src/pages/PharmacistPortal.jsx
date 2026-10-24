import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useAuth } from '../context/AuthContext';
import ConfirmationDialog from '../components/ConfirmationDialog';
import LoadingSkeleton from '../components/LoadingSkeleton';
import EmptyState from '../components/EmptyState';
import { broadcastUpdate, useRealtimeRefresh, subscribeToUpdates } from '../utils/realtimeUpdates';
import PrescriptionClarificationModal from '../components/PrescriptionClarificationModal';
import ClinicalPrescriptionReviewModal from '../components/ClinicalPrescriptionReviewModal';
import AuthenticatedPrescriptionImage from '../components/AuthenticatedPrescriptionImage';
import { playKeypadClickSound } from '../utils/audioFeedback';
import { usePortalGreeting } from '../utils/greetingUtils';
import FlowButton from '../components/FlowButton';
import AnimatedStatCard from '../components/ui/AnimatedStatCard';
import RollingNumber from '../components/ui/RollingNumber';

function CounterPinVerificationView({
  order,
  pharmacy,
  counterPinDigits,
  setCounterPinDigits,
  onBack,
  onVerifyPin,
  onOpenDocModal,
  onOpenClarification,
  onOpenClinicalReview
}) {
  const pinInputsRef = [React.useRef(null), React.useRef(null), React.useRef(null), React.useRef(null)];

  const handleDigitChange = (index, value) => {
    const val = value.replace(/[^0-9]/g, '').slice(-1);
    const newDigits = [...counterPinDigits];
    newDigits[index] = val;
    setCounterPinDigits(newDigits);

    if (val) {
      if (newDigits.every(d => d)) {
        playKeypadClickSound('complete');
      } else {
        playKeypadClickSound('press');
      }
      if (index < 3) {
        pinInputsRef[index + 1].current?.focus();
      }
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace') {
      playKeypadClickSound('delete');
      if (!counterPinDigits[index] && index > 0) {
        pinInputsRef[index - 1].current?.focus();
      }
    }
  };

  const handlePadPress = (num) => {
    const emptyIndex = counterPinDigits.findIndex(d => !d);
    const targetIdx = emptyIndex !== -1 ? emptyIndex : 3;
    const newDigits = [...counterPinDigits];
    newDigits[targetIdx] = String(num);
    setCounterPinDigits(newDigits);
    playKeypadClickSound(newDigits.every(d => d) ? 'complete' : 'press');
    if (targetIdx < 3) {
      pinInputsRef[targetIdx + 1].current?.focus();
    }
  };

  const handlePadDelete = () => {
    let lastFilledIndex = -1;
    for (let i = counterPinDigits.length - 1; i >= 0; i--) {
      if (counterPinDigits[i]) {
        lastFilledIndex = i;
        break;
      }
    }
    if (lastFilledIndex !== -1) {
      const newDigits = [...counterPinDigits];
      newDigits[lastFilledIndex] = '';
      setCounterPinDigits(newDigits);
      playKeypadClickSound('delete');
      pinInputsRef[lastFilledIndex].current?.focus();
    }
  };

  const handlePadClear = () => {
    setCounterPinDigits(['', '', '', '']);
    playKeypadClickSound('clear');
    pinInputsRef[0].current?.focus();
  };

  const combinedPin = counterPinDigits.join('');

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Top Context & Back Action */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            onClick={onBack}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              background: '#e6f8f1',
              color: '#032f28',
              border: '1px solid #c0c8c5',
              padding: '0.45rem 1rem',
              borderRadius: 99,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_back</span>
            <span>Back to Reservation Queue</span>
          </button>
          <span style={{ color: '#c0c8c5' }}>•</span>
          <span style={{ fontSize: 12, color: '#414846', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 15, color: '#2e685d' }}>storefront</span>
            {pharmacy?.name || 'Assigned Pharmacy'} (Dispensary #{pharmacy?.id?.substring(0, 6) || '---'})
          </span>
        </div>

        {/* Quick Session Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#ffffff', padding: '0.35rem 0.85rem', borderRadius: 99, boxShadow: '0 1px 3px rgba(0,0,0,0.05)', fontSize: 11 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#2e685d' }}></div>
          <span style={{ color: '#032f28', fontWeight: 600 }}>Verification Counter • Fast Dispense</span>
          <span style={{ color: '#c0c8c5' }}>|</span>
          <span style={{ background: '#1e453e', color: '#c1ebe1', padding: '0.1rem 0.45rem', borderRadius: 99, fontSize: 10, fontWeight: 700 }}>STOCK REGISTRY</span>
        </div>
      </div>

      {/* Order Header Card */}
      <section style={{
        background: '#ffffff',
        borderRadius: 24,
        padding: '1.75rem',
        boxShadow: '0 4px 20px rgba(3,47,40,0.06)',
        border: '1px solid #e0f2eb',
        position: 'relative',
        overflow: 'hidden'
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1.25rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
              <span style={{ fontSize: 24, fontWeight: 800, color: '#032f28', letterSpacing: '-0.02em' }}>
                Order #{order.orderNumber || order.id?.slice(0, 10).toUpperCase()}
              </span>
              <span style={{
                background: '#b0ecdd',
                color: '#336c61',
                padding: '0.2rem 0.65rem',
                borderRadius: 99,
                fontSize: 11,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem'
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>check_circle</span>
                {order.status.replace(/_/g, ' ')}
              </span>
              <span style={{
                background: '#d5e6e0',
                color: '#032f28',
                padding: '0.2rem 0.65rem',
                borderRadius: 99,
                fontSize: 11,
                fontWeight: 700
              }}>
                {order.paymentStatus || 'PAID'}
              </span>
            </div>
            <p style={{ fontSize: 12, color: '#717976', margin: 0, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 15, color: '#2e685d' }}>schedule</span>
              Reserved: {new Date(order.createdAt).toLocaleString()}
            </p>
          </div>

          {/* Fulfillment Pill Well */}
          <div style={{ background: '#e6f8f1', padding: '0.75rem 1.25rem', borderRadius: 16, display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#d5e6e0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#032f28' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>person</span>
              </div>
              <div>
                <span style={{ display: 'block', fontSize: 10, color: '#717976', textTransform: 'uppercase', fontWeight: 700 }}>Patient Record</span>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28' }}>{order.user?.name || 'Verified Patient'}</span>
              </div>
            </div>

            <div style={{ width: 1, height: 24, background: '#c0c8c5' }}></div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#b0ecdd', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#336c61' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>front_hand</span>
              </div>
              <div>
                <span style={{ display: 'block', fontSize: 10, color: '#717976', textTransform: 'uppercase', fontWeight: 700 }}>Pickup Protocol</span>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#032f28' }}>Counter Dispensation</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Main Working Grid: 7 cols left, 5 cols right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: 7 cols */}
        <div className="col-span-1 lg:col-span-7 flex flex-col gap-6">
          {/* Allocated Prescription Items */}
          <section style={{ background: '#ffffff', borderRadius: 24, padding: '1.5rem', border: '1px solid #e0f2eb', boxShadow: '0 2px 8px rgba(3,47,40,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', borderBottom: '1px solid #e6f8f1', paddingBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="material-symbols-outlined" style={{ color: '#2e685d', fontSize: 20 }}>medication</span>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#032f28', margin: 0 }}>Allocated Prescription Items</h3>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, background: '#e0f2eb', color: '#2e685d', padding: '0.2rem 0.6rem', borderRadius: 99 }}>
                {order.items?.length || 0} / {order.items?.length || 0} RESERVED
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {(order.items || []).map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    background: '#e6f8f1',
                    borderRadius: 16,
                    padding: '1rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '1rem'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2e685d' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 24 }}>medication</span>
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#032f28' }}>
                        {item.medicine?.brandName || item.medicine?.name || item.name || 'Prescription Medicine'}
                      </div>
                      <div style={{ fontSize: 11, color: '#414846' }}>
                        Requested: <strong>{item.quantity} Units</strong> • {item.medicine?.dosageForm || 'Oral'}
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#032f28' }}>
                      {(() => {
                        const unit = item.unitPrice != null && Number(item.unitPrice) > 0
                          ? Number(item.unitPrice)
                          : (item.medicine?.price != null && Number(item.medicine.price) > 0 ? Number(item.medicine.price) : (item.price != null ? Number(item.price) : null));
                        const lineTotal = item.subtotal != null && Number(item.subtotal) > 0
                          ? Number(item.subtotal)
                          : (unit != null ? unit * (Number(item.quantity) || 1) : null);
                        return lineTotal != null ? `₹${lineTotal.toFixed(2)}` : 'MRP at counter';
                      })()}
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#336c61', background: '#b0ecdd', padding: '0.1rem 0.45rem', borderRadius: 99 }}>
                      Verified
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Total Balance Row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '1rem', background: '#e0f2eb', padding: '0.85rem 1.25rem', borderRadius: 16 }}>
              <div>
                <span style={{ display: 'block', fontSize: 10, textTransform: 'uppercase', fontWeight: 700, color: '#414846' }}>Order Total (Taxes &amp; Dispense Fees Included)</span>
                <span style={{ fontSize: 11, color: '#2e685d', fontWeight: 600 }}>Prepaid Escrow via MediFind Pay</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: '#032f28' }}>₹{(order.totalAmount || 0).toFixed(2)} INR</span>
                <span style={{ marginLeft: '0.35rem', background: '#1e453e', color: '#c1ebe1', fontSize: 10, fontWeight: 700, padding: '0.1rem 0.45rem', borderRadius: 99 }}>
                  PAID
                </span>
              </div>
            </div>
          </section>

          {/* Prescription Context Card */}
          <section style={{ background: '#ffffff', borderRadius: 24, padding: '1.5rem', border: '1px solid #e0f2eb', boxShadow: '0 2px 8px rgba(3,47,40,0.04)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="material-symbols-outlined" style={{ color: '#2e685d', fontSize: 20 }}>verified_user</span>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#032f28', margin: 0 }}>Prescription Authorization</h3>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, background: '#b0ecdd', color: '#336c61', padding: '0.2rem 0.65rem', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 13 }}>task_alt</span>
                Document Screening: Completed
              </span>
            </div>

            <div style={{ background: '#e6f8f1', padding: '0.85rem 1rem', borderRadius: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
              <div>
                <span style={{ display: 'block', fontSize: 10, color: '#717976', textTransform: 'uppercase', fontWeight: 700 }}>Referenced e-Prescription</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#032f28', fontFamily: 'monospace' }}>RX-MF-{order.id.slice(0, 6).toUpperCase()}</span>
              </div>
              <div>
                <span style={{ display: 'block', fontSize: 10, color: '#717976', textTransform: 'uppercase', fontWeight: 700 }}>Clinical Protocol</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#032f28' }}>Verified Kerala Dispensary</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
              <button
                onClick={onOpenDocModal}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  background: '#e0f2eb',
                  color: '#032f28',
                  border: 'none',
                  padding: '0.6rem 1.25rem',
                  borderRadius: 99,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  width: 'fit-content'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>attachment</span>
                <span>View Prescription Document</span>
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>open_in_new</span>
              </button>

              <button
                onClick={() => onOpenClinicalReview && onOpenClinicalReview(order)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  background: '#032f28',
                  color: '#ffffff',
                  border: 'none',
                  padding: '0.6rem 1.25rem',
                  borderRadius: 99,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  width: 'fit-content'
                }}
                title="Review raw OCR candidates, patient corrections, and issue pharmacist clinical verification"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>clinical_notes</span>
                <span>Clinical OCR Verification</span>
              </button>

              <button
                onClick={() => onOpenClarification && onOpenClarification(order)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  background: '#e6f8f1',
                  color: '#032f28',
                  border: '1px solid #c0c8c5',
                  padding: '0.6rem 1.25rem',
                  borderRadius: 99,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  width: 'fit-content'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>contact_support</span>
                <span>Prescription Clarification</span>
              </button>
            </div>

            <div style={{ background: '#e0f2eb', padding: '0.75rem 1rem', borderRadius: 14, display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: 11, color: '#414846' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d', marginTop: 1 }}>info</span>
              <span>
                <strong>Mandatory Safety Notice:</strong> Automated screening cannot confirm authenticity. Manual verification by a licensed healthcare professional or pharmacist may be required prior to releasing prescription items.
              </span>
            </div>
          </section>
        </div>

        {/* Right Column: Counter PIN Verification (5 cols) */}
        <div className="col-span-1 lg:col-span-5 lg:sticky lg:top-24">
          <section style={{
            background: '#ffffff',
            borderRadius: 24,
            padding: '1.75rem',
            border: '2px solid #2e685d',
            boxShadow: '0 8px 32px rgba(3,47,40,0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem'
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#2e685d', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 15 }}>pin</span>
                  Secure Hand-off
                </span>
                <span style={{ background: combinedPin.length === 4 ? '#b0ecdd' : '#e0f2eb', color: '#032f28', fontSize: 11, fontWeight: 700, padding: '0.15rem 0.55rem', borderRadius: 99 }}>
                  {combinedPin.length === 4 ? 'Ready to Verify' : 'Awaiting 4 Digits'}
                </span>
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: '#032f28', margin: '0 0 0.35rem 0' }}>
                Counter Pickup Verification
              </h2>
              <p style={{ fontSize: 12, color: '#414846', margin: 0, lineHeight: 1.5 }}>
                Enter the patient's 4-digit pickup PIN provided in their MediFind AI order confirmation.
              </p>
            </div>

            {/* 4 Digit Boxes with Smooth Tactile Scale Feedback */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', margin: '0.5rem 0' }}>
              {[0, 1, 2, 3].map(idx => (
                <input
                  key={idx}
                  ref={pinInputsRef[idx]}
                  type="text"
                  maxLength={1}
                  value={counterPinDigits[idx] || ''}
                  onChange={e => handleDigitChange(idx, e.target.value)}
                  onKeyDown={e => handleKeyDown(idx, e)}
                  style={{
                    width: 58,
                    height: 70,
                    borderRadius: 16,
                    textAlign: 'center',
                    fontSize: 28,
                    fontWeight: 800,
                    background: counterPinDigits[idx] ? '#b0ecdd' : '#f8fafc',
                    color: '#032f28',
                    border: counterPinDigits[idx] ? '2.5px solid #2e685d' : '1.5px solid #c0c8c5',
                    outline: 'none',
                    boxShadow: counterPinDigits[idx]
                      ? '0 4px 14px rgba(46,104,93,0.22), inset 0 2px 4px rgba(0,0,0,0.03)'
                      : 'inset 0 2px 4px rgba(0,0,0,0.03)',
                    transform: counterPinDigits[idx] ? 'scale(1.05)' : 'scale(1)',
                    transition: 'all 0.16s cubic-bezier(0.34, 1.56, 0.64, 1)'
                  }}
                />
              ))}
            </div>

            {/* Numeric Keypad Grid with Smooth Clicky Animations & Sound */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '0.65rem',
              maxWidth: 290,
              margin: '0.5rem auto 1rem auto',
              width: '100%'
            }}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handlePadPress(num)}
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

              {/* Clear Action Button */}
              <button
                type="button"
                onClick={handlePadClear}
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

              {/* 0 Button */}
              <button
                type="button"
                onClick={() => handlePadPress(0)}
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

              {/* Delete / Backspace Action Button */}
              <button
                type="button"
                onClick={handlePadDelete}
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

            {/* Dispensary Main Action Button with Tactile Feedback */}
            <button
              onClick={() => {
                playKeypadClickSound('press');
                onVerifyPin(order.id, combinedPin);
              }}
              disabled={combinedPin.length < 4}
              style={{
                width: '100%',
                padding: '0.85rem 1.5rem',
                borderRadius: 99,
                background: combinedPin.length >= 4 ? '#032f28' : '#c0c8c5',
                color: '#ffffff',
                border: 'none',
                fontSize: 13,
                fontWeight: 700,
                cursor: combinedPin.length >= 4 ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                boxShadow: combinedPin.length >= 4 ? '0 4px 14px rgba(3,47,40,0.2)' : 'none',
                transition: 'all 0.15s cubic-bezier(0.2, 0.8, 0.2, 1)'
              }}
              onMouseDown={e => {
                if (combinedPin.length >= 4) e.currentTarget.style.transform = 'scale(0.97)';
              }}
              onMouseUp={e => {
                e.currentTarget.style.transform = 'scale(1)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>inventory_2</span>
              <span>Verify PIN &amp; Complete Dispensation</span>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_forward</span>
            </button>

            {/* Attestation Microcopy */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: '#717976', borderTop: '1px solid #e6f8f1', paddingTop: '0.75rem' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#2e685d' }}>encrypted</span>
                Hardware Keystore Verified
              </span>
              <span>Terminal #TR-819-A</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function PharmacistPortal({ currentTab, onTabChange }) {
  const { user } = useAuth();
  const { firstName: pharmacistFirstName, timeGreet: pharmacistTimeGreet, icon: pharmacistGreetIcon } = usePortalGreeting(user, 'PHARMACIST');
  const [internalTab, setInternalTab] = useState('overview'); // 'overview' | 'inventory'
  const activeTab = currentTab !== undefined ? currentTab : internalTab;
  const setActiveTab = onTabChange || setInternalTab;
  const [orders, setOrders] = useState([]);
  const [pharmacy, setPharmacy] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pinInputMap, setPinInputMap] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [orderFilterTab, setOrderFilterTab] = useState('ALL');
  const [inventoryFilterTab, setInventoryFilterTab] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [updatingItemId, setUpdatingItemId] = useState(null);
  const [updatingStatusId, setUpdatingStatusId] = useState(null);
  const [stockEditMap, setStockEditMap] = useState({});

  // Counter PIN Terminal (Stitch Screen cd3c9feb12e84af2962935316bf94d82)
  const [counterPinOrder, setCounterPinOrder] = useState(null);
  const [counterPinDigits, setCounterPinDigits] = useState(['', '', '', '']);
  const [showRxDocModal, setShowRxDocModal] = useState(false);
  const [clarificationOrder, setClarificationOrder] = useState(null);
  const [clinicalReviewOrder, setClinicalReviewOrder] = useState(null);

  // Gate 8: Clinical Assistance Requests Assigned to this Pharmacy
  const [clinicalQueue, setClinicalQueue] = useState([]);
  const [loadingClinicalQueue, setLoadingClinicalQueue] = useState(false);
  const [selectedClinicalRequest, setSelectedClinicalRequest] = useState(null);
  const [clinicianResponseText, setClinicianResponseText] = useState('');
  const [internalNotesText, setInternalNotesText] = useState('');
  const [submittingResponse, setSubmittingResponse] = useState(false);

  // Elder-Friendly Voice Guidance & Recording
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceRecordingSeconds, setVoiceRecordingSeconds] = useState(0);
  const [voiceAudioBase64, setVoiceAudioBase64] = useState(null);
  const [voiceAudioPreviewUrl, setVoiceAudioPreviewUrl] = useState(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const voiceTimerRef = useRef(null);
  const speechRecRef = useRef(null);

  // Medication Recommendation for Direct Patient Reservation
  const [recommendMedEnabled, setRecommendMedEnabled] = useState(false);
  const [selectedMedForRec, setSelectedMedForRec] = useState(null);
  const [recMedInstructions, setRecMedInstructions] = useState('');
  const [recMedQty, setRecMedQty] = useState(1);
  const [recMedSearch, setRecMedSearch] = useState('');

  // Inline feedback alert
  const [feedback, setFeedback] = useState({ show: false, message: '', type: 'success' });

  // Stage Lifecycle Action Popup Modal (Confirmation, Ready for Pickup, 4-digit PIN verified)
  const [actionFeedbackModal, setActionFeedbackModal] = useState(null);

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    variant: 'danger',
    onConfirm: () => {}
  });

  // Add medicine to inventory modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [availableMedicines, setAvailableMedicines] = useState([]);
  const [selectedMedicineId, setSelectedMedicineId] = useState('');
  const [newStock, setNewStock] = useState('10');
  const [newPrice, setNewPrice] = useState('50.00');
  const [addError, setAddError] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  const showToast = (message, type = 'success') => {
    setFeedback({ show: true, message, type });
    setTimeout(() => setFeedback({ show: false, message: '', type: 'success' }), 4000);
  };

  const inFlightStatusOrdersRef = useRef(new Set());

  useEffect(() => {
    fetchPharmacyAndOrders();
  }, [user]);

  // Subscribe to real-time events for instant optimistic update on patient checkout/payment
  useEffect(() => {
    const unsubscribe = subscribeToUpdates((event) => {
      if (event?.type === 'PAYMENT_COMPLETED' && event?.payload?.orderId) {
        const { orderId, method, status } = event.payload;
        setOrders(prev => prev.map(o => {
          if (o.id === orderId) {
            return {
              ...o,
              fulfillmentType: o.fulfillmentType || 'PICKUP',
              payment: {
                ...(o.payment || {}),
                method: method || 'COUNTER',
                status: status || (method === 'ONLINE' ? 'PAID' : 'PENDING')
              }
            };
          }
          return o;
        }));
      } else if (event?.type === 'FULFILLMENT_SELECTED' && event?.payload?.orderId) {
        setOrders(prev => prev.map(o => {
          if (o.id === event.payload.orderId) {
            return { ...o, fulfillmentType: event.payload.fulfillmentType };
          }
          return o;
        }));
      }
    });
    return () => unsubscribe();
  }, []);

  // Real-time automatic background refresh (heartbeat + event triggers)
  useRealtimeRefresh({
    onRefresh: () => {
      fetchPharmacyAndOrders(true);
    },
    interval: 10000
  });

  async function fetchPharmacyAndOrders(isBackground = false) {
    if (!isBackground && !pharmacy) setLoading(true);
    else setIsRefreshing(true);
    const token = localStorage.getItem('medifind_token');

    try {
      // Parallel fetch for fast portal loading
      const [pharRes, ordRes] = await Promise.all([
        fetch('/api/pharmacies/my-pharmacy', {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch('/api/orders', {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      const [pharData, ordData] = await Promise.all([pharRes.json(), ordRes.json()]);

      if (pharData.success && pharData.pharmacy) {
        setPharmacy(pharData.pharmacy);
        setInventory(pharData.pharmacy.inventory || []);
        // Initialize stock edits without overwriting in-flight inputs
        setStockEditMap(prev => {
          const edits = { ...prev };
          (pharData.pharmacy.inventory || []).forEach(item => {
            if (!edits[item.id]) {
              edits[item.id] = {
                stock: item.stock != null ? item.stock : 0,
                price: item.price != null ? item.price : 0
              };
            }
          });
          return edits;
        });
      } else if (!isBackground && !pharmacy) {
        setPharmacy(null);
        setInventory([]);
      }

      if (ordData.success && Array.isArray(ordData.orders)) {
        setOrders(prev => {
          return ordData.orders.map(newOrd => {
            if (inFlightStatusOrdersRef.current.has(newOrd.id)) {
              const existing = prev.find(p => p.id === newOrd.id);
              return existing ? { ...newOrd, status: existing.status } : newOrd;
            }
            return newOrd;
          });
        });
      }

      // Fetch clinical assistance requests assigned to this pharmacy
      fetchClinicalQueue();
    } catch (err) {
      if (!isBackground) {
        console.error('Error fetching pharmacist data:', err);
        showToast('Network error while refreshing records.', 'error');
      }
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }

  async function fetchClinicalQueue() {
    setLoadingClinicalQueue(true);
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch('/api/clinical-assistance/pharmacy-queue', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setClinicalQueue(data.queue || []);
      }
    } catch (err) {
      console.error('Error fetching clinical queue:', err);
    } finally {
      setLoadingClinicalQueue(false);
    }
  }

  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mime });
        const previewUrl = URL.createObjectURL(audioBlob);
        setVoiceAudioPreviewUrl(previewUrl);

        const reader = new FileReader();
        reader.onloadend = () => {
          setVoiceAudioBase64(reader.result);
        };
        reader.readAsDataURL(audioBlob);

        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start(250);
      setIsRecordingVoice(true);
      setVoiceRecordingSeconds(0);
      if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = setInterval(() => {
        setVoiceRecordingSeconds(prev => prev + 1);
      }, 1000);

      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          const recognition = new SpeechRecognition();
          recognition.continuous = true;
          recognition.interimResults = true;
          const reqLang = selectedClinicalRequest?.request?.language;
          recognition.lang = reqLang === 'ml' ? 'ml-IN' : (reqLang === 'hi' ? 'hi-IN' : 'en-IN');
          recognition.onresult = (event) => {
            let transcript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              if (event.results[i].isFinal) {
                transcript += event.results[i][0].transcript + ' ';
              }
            }
            if (transcript.trim()) {
              setClinicianResponseText(prev => (prev ? prev.trim() + ' ' : '') + transcript.trim());
            }
          };
          recognition.start();
          speechRecRef.current = recognition;
        } catch (e) {
          console.warn('Speech recognition start note:', e.message);
        }
      }
    } catch (err) {
      console.error('Error starting audio recording:', err);
      showToast('Could not access microphone: ' + err.message, 'error');
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (speechRecRef.current) {
      try { speechRecRef.current.stop(); } catch (_) {}
    }
    if (voiceTimerRef.current) {
      clearInterval(voiceTimerRef.current);
    }
    setIsRecordingVoice(false);
  };

  const clearVoiceRecording = () => {
    if (voiceAudioPreviewUrl && voiceAudioPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(voiceAudioPreviewUrl);
    }
    setVoiceAudioPreviewUrl(null);
    setVoiceAudioBase64(null);
    setVoiceRecordingSeconds(0);
    audioChunksRef.current = [];
  };

  const handleOpenClinicalDetail = async (item) => {
    setSelectedClinicalRequest(item);
    setClinicianResponseText(item.request?.clinicianResponse || '');
    setInternalNotesText('');
    clearVoiceRecording();
    setRecommendMedEnabled(false);
    setSelectedMedForRec(null);
    setRecMedInstructions('');
    setRecMedQty(1);
    setRecMedSearch('');

    if (item.request?.voiceAudioUrl) {
      setVoiceAudioPreviewUrl(item.request.voiceAudioUrl);
    }
    if (item.request?.recommendedMedicine) {
      setRecommendMedEnabled(true);
      setSelectedMedForRec(item.request.recommendedMedicine);
      setRecMedInstructions(item.request.recommendedMedicine.instructions || '');
      setRecMedQty(item.request.recommendedMedicine.quantity || 1);
    }

    // Trigger getClinicalRequestById to mark assignment as OPENED
    const token = localStorage.getItem('medifind_token');
    try {
      await fetch(`/api/clinical-assistance/${item.request.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (e) {}
  };

  const handleSubmitClinicalResponse = async (e) => {
    e.preventDefault();
    if (!clinicianResponseText.trim()) {
      showToast('Please provide a clinical response message.', 'error');
      return;
    }

    if (isRecordingVoice) {
      stopVoiceRecording();
    }

    setSubmittingResponse(true);
    const token = localStorage.getItem('medifind_token');
    try {
      const payload = {
        clinicianResponse: clinicianResponseText.trim(),
        internalNotes: internalNotesText.trim() || undefined,
        voiceAudio: voiceAudioBase64 || undefined,
        recommendedMedicine: (recommendMedEnabled && selectedMedForRec) ? {
          medicineId: selectedMedForRec.medicineId || selectedMedForRec.id,
          brandName: selectedMedForRec.brandName || selectedMedForRec.name,
          genericName: selectedMedForRec.genericName || '',
          strength: selectedMedForRec.strength || '',
          dosageForm: selectedMedForRec.dosageForm || 'Tablet',
          price: selectedMedForRec.price || 15,
          quantity: parseInt(recMedQty, 10) || 1,
          instructions: recMedInstructions.trim() || 'Take as advised by dispensing pharmacist',
          pharmacyId: pharmacy?.id,
          pharmacyName: pharmacy?.name || 'Local Dispensary'
        } : null
      };

      const res = await fetch(`/api/clinical-assistance/${selectedClinicalRequest.request.id}/respond`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (data.success) {
        showToast('Clinical response submitted with voice and medicine recommendations.', 'success');
        setSelectedClinicalRequest(null);
        setClinicianResponseText('');
        setInternalNotesText('');
        clearVoiceRecording();
        setRecommendMedEnabled(false);
        setSelectedMedForRec(null);
        fetchClinicalQueue();
      } else {
        showToast(data.error || 'Failed to submit clinical response.', 'error');
      }
    } catch (err) {
      console.error('Error submitting response:', err);
      showToast('Network error submitting clinical response.', 'error');
    } finally {
      setSubmittingResponse(false);
    }
  };

  // Load catalog medicines not currently in inventory
  const handleOpenAddModal = async () => {
    setShowAddModal(true);
    setAddError('');
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch('/api/medicines/search', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.medicines) {
        const currentMedIds = new Set(inventory.map(inv => inv.medicineId));
        const unadded = data.medicines.filter(m => !currentMedIds.has(m.id));
        setAvailableMedicines(unadded);
        if (unadded.length > 0) {
          setSelectedMedicineId(unadded[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load medicines catalog:', err);
      setAddError('Failed to load medicine catalogue.');
    }
  };

  const handleAddMedicineSubmit = async (e) => {
    e.preventDefault();
    if (!pharmacy || !selectedMedicineId) return;

    const stockVal = parseInt(newStock, 10);
    const priceVal = parseFloat(newPrice);

    if (isNaN(stockVal) || stockVal < 0) {
      setAddError('Stock must be a non-negative integer.');
      return;
    }
    if (isNaN(priceVal) || priceVal < 0) {
      setAddError('Price must be a valid non-negative number.');
      return;
    }

    setAddLoading(true);
    setAddError('');
    const token = localStorage.getItem('medifind_token');

    try {
      const res = await fetch(`/api/pharmacies/${pharmacy.id}/inventory`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          medicineId: selectedMedicineId,
          stock: stockVal,
          price: priceVal
        })
      });
      const data = await res.json();
      if (data.success) {
        setShowAddModal(false);
        showToast('Medicine added to inventory successfully.', 'success');
        fetchPharmacyAndOrders();
        broadcastUpdate('INVENTORY_UPDATED');
      } else {
        setAddError(data.error || 'Failed to add medicine.');
      }
    } catch (err) {
      setAddError('Network error adding medicine.');
    } finally {
      setAddLoading(false);
    }
  };

  const handleUpdateStatus = async (orderId, newStatus) => {
    if (updatingStatusId === orderId) return;
    const token = localStorage.getItem('medifind_token');
    const targetOrder = orders.find(o => o.id === orderId);
    const previousStatus = targetOrder?.status;

    setUpdatingStatusId(orderId);
    inFlightStatusOrdersRef.current.add(orderId);

    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });
      const data = await res.json();
      if (data.success) {
        setUpdatingStatusId(null);
        showToast(
          newStatus === 'CONFIRMED'
            ? 'Reservation confirmed & stock earmarked at counter.'
            : (newStatus === 'READY_FOR_PICKUP'
                ? 'Medicines staged in pickup bay! Ready for customer 4-digit PIN verification.'
                : `Order status updated to ${newStatus}.`),
          'success'
        );
        if (data.order) {
          setOrders(prev => prev.map(o => o.id === orderId ? { ...o, ...data.order, status: newStatus } : o));
        } else {
          setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
        }
        // Broadcast after confirmed server persistence
        broadcastUpdate('ORDER_STATUS_UPDATED', { orderId, newStatus });

        // Refresh pharmacy inventory so order and stock state remain accurate
        setTimeout(() => {
          fetchPharmacyAndOrders(true);
        }, 1200);

        if (newStatus === 'READY_FOR_PICKUP') {
          showToast('Medicines staged in pickup bay! Ready for customer 4-digit PIN verification.', 'success');
        } else if (newStatus === 'REJECTED' || newStatus === 'CANCELLED') {
          setActionFeedbackModal({
            type: 'CANCELLED',
            title: 'Reservation Cancelled / Rejected',
            badgeText: 'Stock Hold Released',
            badgeBg: '#ffdad6',
            badgeColor: '#ba1a1a',
            icon: 'cancel',
            orderId,
            patientName: targetOrder?.user?.fullName || targetOrder?.userName || 'Patient',
            message: 'This prescription reservation has been cancelled. Any earmarked items have been released back into active stock.',
            workflowStage: 'Cancelled',
            nextSteps: [
              'The patient has been notified of the reservation cancellation.',
              'No items remain locked for this order.'
            ],
            items: targetOrder?.items || [],
            totalAmount: targetOrder?.totalAmount
          });
        }
      } else {
        if (previousStatus) {
          setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: previousStatus } : o));
        }
        showToast(data.error || 'Failed to update order status.', 'error');
        // Re-sync orders with server so UI does not remain desynchronized
        fetchPharmacyAndOrders(true);
      }
    } catch (err) {
      console.error('Error updating order status:', err);
      if (previousStatus) {
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: previousStatus } : o));
      }
      showToast('Error communicating with server.', 'error');
      fetchPharmacyAndOrders(true);
    } finally {
      inFlightStatusOrdersRef.current.delete(orderId);
      setUpdatingStatusId(null);
    }
  };

  const handleVerifyPin = async (orderId, explicitPin = null) => {
    const pin = explicitPin || pinInputMap[orderId];
    if (!pin || pin.toString().trim().length < 4) {
      showToast('Please enter the customer 4-digit verification PIN', 'warning');
      return;
    }
    const token = localStorage.getItem('medifind_token');
    const targetOrder = orders.find(o => o.id === orderId) || counterPinOrder;

    try {
      const res = await fetch(`/api/orders/${orderId}/verify-pin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ pin: pin.toString().trim() })
      });
      const data = await res.json();
      if (data.success) {
        showToast('PIN verified! Medicines handed over and order completed.', 'success');
        setPinInputMap(prev => ({ ...prev, [orderId]: '' }));
        setCounterPinDigits(['', '', '', '']);

        const resolvedOrder = data.order || targetOrder || {};
        const items = (resolvedOrder.items && resolvedOrder.items.length > 0)
          ? resolvedOrder.items
          : (targetOrder?.items || []);
        const totalAmount = resolvedOrder.totalAmount ?? targetOrder?.totalAmount ?? 0;
        const patientName = resolvedOrder.user?.fullName || resolvedOrder.user?.name || targetOrder?.user?.fullName || targetOrder?.user?.name || targetOrder?.userName || 'Patient';

        // 4-digit PIN verified & Handover Successful popup modal
        setActionFeedbackModal({
          type: 'PIN_VERIFIED',
          title: '4-Digit PIN Verified — Handover Successful!',
          badgeText: 'Dispensation Complete',
          badgeBg: '#b0ecdd',
          badgeColor: '#032f28',
          icon: 'verified_user',
          orderId,
          patientName,
          patientPhone: resolvedOrder.user?.phone || targetOrder?.user?.phone,
          message: 'The 4-digit customer security PIN was verified. Physical medicine handover is officially authenticated!',
          workflowStage: 'Order Completed & Fulfilled',
          nextSteps: [
            'Dispensation and medicine handover are permanently logged in the dispensary ledger.',
            'Inventory stock levels have been automatically updated.',
            'Payment escrow funds have been cleared for pharmacy settlement.'
          ],
          items,
          totalAmount
        });

        fetchPharmacyAndOrders();
        broadcastUpdate('ORDER_COMPLETED', { orderId });
      } else {
        showToast(data.error || 'Incorrect customer PIN.', 'error');
      }
    } catch (err) {
      console.error('Error verifying PIN:', err);
      showToast('Error validating PIN.', 'error');
    }
  };

  const handleSaveStock = async (itemId, medicineId) => {
    if (!pharmacy) return;
    const token = localStorage.getItem('medifind_token');
    const edit = stockEditMap[itemId] || {};
    setUpdatingItemId(itemId);

    try {
      const res = await fetch(`/api/pharmacies/${pharmacy.id}/inventory`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          medicineId,
          stock: parseInt(edit.stock, 10),
          price: parseFloat(edit.price)
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Stock and price updated successfully.', 'success');
        const numStock = parseInt(edit.stock, 10);
        const numPrice = parseFloat(edit.price);
        setInventory(prev => prev.map(inv => {
          if (inv.id === itemId) {
            return {
              ...inv,
              stock: isNaN(numStock) ? inv.stock : numStock,
              price: isNaN(numPrice) ? inv.price : numPrice,
              status: numStock > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK'
            };
          }
          return inv;
        }));
        fetchPharmacyAndOrders(true);
        broadcastUpdate('INVENTORY_UPDATED');
      } else {
        showToast(data.error || 'Failed to update stock.', 'error');
      }
    } catch (err) {
      console.error('Error updating stock:', err);
      showToast('Network error updating stock.', 'error');
    } finally {
      setUpdatingItemId(null);
    }
  };

  const handleTogglePharmacyStatus = async (field, value) => {
    if (!pharmacy) return;
    const token = localStorage.getItem('medifind_token');

    try {
      const res = await fetch(`/api/pharmacies/${pharmacy.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ [field]: value })
      });
      const data = await res.json();
      if (data.success) {
        setPharmacy(data.pharmacy);
        showToast(`Dispensary ${field === 'isOpen' ? 'operating state' : '24/7 status'} updated.`, 'success');
        broadcastUpdate('PHARMACY_STATUS_UPDATED');
      }
    } catch (err) {
      console.error('Error toggling status:', err);
    }
  };

  // Metrics
  const pendingCount = orders.filter(o => o.status === 'PENDING').length;
  const confirmedCount = orders.filter(o => o.status === 'CONFIRMED').length;
  const readyCount = orders.filter(o => o.status === 'READY_FOR_PICKUP').length;
  const completedCount = orders.filter(o => o.status === 'COMPLETED').length;
  const cancelledCount = orders.filter(o => o.status === 'CANCELLED').length;
  const rejectedCount = orders.filter(o => o.status === 'REJECTED').length;
  const lowStockCount = inventory.filter(i => (i.stock || 0) <= 5).length;
  const activeCatalogueCount = inventory.length;

  // Filtered orders
  const filteredOrders = orders.filter(o => {
    if (orderFilterTab !== 'ALL' && o.status !== orderFilterTab) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const matchesRef = (o.id || '').toLowerCase().includes(q);
    const matchesUser = (o.user?.name || '').toLowerCase().includes(q);
    const matchesMeds = (o.items || []).some(item =>
      (item.medicine?.name || item.medicine?.brandName || '').toLowerCase().includes(q)
    );
    return matchesRef || matchesUser || matchesMeds;
  });

  // Filtered inventory
  const filteredInventory = inventory.filter(inv => {
    const stock = inv.stock != null ? inv.stock : 0;
    if (inventoryFilterTab === 'AVAILABLE' && stock <= 0) return false;
    if (inventoryFilterTab === 'LOW_STOCK' && (stock <= 0 || stock > 10)) return false;
    if (inventoryFilterTab === 'OUT_OF_STOCK' && stock > 0) return false;

    if (categoryFilter !== 'ALL') {
      const medCat = inv.category || inv.medicine?.category || '';
      if (!medCat.toLowerCase().includes(categoryFilter.toLowerCase())) return false;
    }

    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const name = (inv.brandName || inv.medicine?.brandName || inv.medicine?.name || '').toLowerCase();
    const gen = (inv.genericName || inv.medicine?.genericName || '').toLowerCase();
    return name.includes(q) || gen.includes(q);
  });

  if (!loading && !pharmacy) {
    return (
      <div style={{ background: '#ecfdf7', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div style={{
          background: '#ffffff',
          borderRadius: 24,
          padding: '3rem 2rem',
          maxWidth: 520,
          textAlign: 'center',
          boxShadow: '0 8px 32px rgba(3,47,40,0.08)',
          border: '1px solid #e0f2eb'
        }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#ffdad6', color: '#ba1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 32 }}>domain_disabled</span>
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#032f28', margin: '0 0 0.5rem 0' }}>
            No Pharmacy Linked to This Account
          </h2>
          <p style={{ fontSize: 14, color: '#414846', lineHeight: 1.6, margin: '0 0 1.5rem 0' }}>
            Your pharmacist account ({user?.email || 'authenticated user'}) does not currently have an assigned pharmacy node in the registry. Please contact an administrator.
          </p>
        </div>
      </div>
    );
  }

  const renderLifecycleActionModal = () => {
    if (!actionFeedbackModal) return null;
    const modalContent = (
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(3, 47, 40, 0.65)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.25rem'
      }}>
        <div style={{
          background: '#ffffff',
          borderRadius: 28,
          maxWidth: 580,
          width: '100%',
          overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(3, 47, 40, 0.35)',
          border: '2px solid #b0ecdd',
          display: 'flex',
          flexDirection: 'column',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          {/* Modal Header */}
          <div style={{
            background: 'linear-gradient(135deg, #032f28 0%, #1e453e 100%)',
            padding: '1.5rem 1.75rem',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '1rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
              <div style={{
                width: 50,
                height: 50,
                borderRadius: '50%',
                background: actionFeedbackModal.badgeBg,
                color: actionFeedbackModal.badgeColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
                flexShrink: 0
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: 28 }}>
                  {actionFeedbackModal.icon}
                </span>
              </div>
              <div>
                <span style={{
                  display: 'inline-block',
                  background: actionFeedbackModal.badgeBg,
                  color: actionFeedbackModal.badgeColor,
                  fontSize: 10,
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  padding: '0.2rem 0.65rem',
                  borderRadius: 99,
                  marginBottom: '0.35rem'
                }}>
                  {actionFeedbackModal.badgeText}
                </span>
                <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: '#ffffff', lineHeight: 1.25 }}>
                  {actionFeedbackModal.title}
                </h3>
              </div>
            </div>
            <button
              onClick={() => {
                setActionFeedbackModal(null);
                setCounterPinOrder(null);
              }}
              style={{
                background: 'rgba(255, 255, 255, 0.15)',
                border: 'none',
                color: '#ffffff',
                width: 32,
                height: 32,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                flexShrink: 0
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
            </button>
          </div>

          {/* Modal Content */}
          <div style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', maxHeight: '70vh', overflowY: 'auto' }}>
            <p style={{ fontSize: 14, color: '#1e453e', lineHeight: 1.55, margin: 0, fontWeight: 500 }}>
              {actionFeedbackModal.message}
            </p>

            {/* Order Reference Details Card */}
            <div style={{
              background: '#e6f8f1',
              borderRadius: 18,
              padding: '1rem 1.25rem',
              border: '1px solid #c0c8c5',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <span style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 700, color: '#717976', display: 'block' }}>Order Reference</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#032f28', fontFamily: 'monospace' }}>
                    #RX-MF-{actionFeedbackModal.orderId.slice(0, 8).toUpperCase()}
                  </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 700, color: '#717976', display: 'block' }}>Patient</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#032f28' }}>
                    {actionFeedbackModal.patientName}
                  </span>
                </div>
              </div>

              {actionFeedbackModal.items && actionFeedbackModal.items.length > 0 && (
                <div style={{ borderTop: '1px solid #d0e4dc', paddingTop: '0.5rem' }}>
                  <span style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 700, color: '#2e685d', display: 'block', marginBottom: '0.35rem' }}>
                    Prescription Medicines ({actionFeedbackModal.items.length}):
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                    {actionFeedbackModal.items.map((it, idx) => (
                      <span key={idx} style={{
                        background: '#ffffff',
                        padding: '0.25rem 0.65rem',
                        borderRadius: 99,
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#032f28',
                        border: '1px solid #d5e6e0'
                      }}>
                        {it.medicine?.brandName || it.brandName || it.name || 'Medicine'} × {it.quantity || 1}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* What Happens Next Guidance */}
            {actionFeedbackModal.nextSteps && actionFeedbackModal.nextSteps.length > 0 && (
              <div style={{
                background: '#f4faf7',
                borderRadius: 18,
                padding: '1rem 1.25rem',
                border: '1px solid #e0f2eb',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#2e685d', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>alt_route</span>
                  <span>Workflow Stage &amp; Next Action:</span>
                </div>
                <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: 12, color: '#414846' }}>
                  {actionFeedbackModal.nextSteps.map((step, idx) => (
                    <li key={idx} style={{ lineHeight: 1.45 }}>{step}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Modal Actions */}
          <div style={{
            padding: '1rem 1.75rem 1.5rem 1.75rem',
            borderTop: '1px solid #e0f2eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '0.75rem',
            background: '#fafdfb'
          }}>
            <button
              onClick={() => {
                setActionFeedbackModal(null);
                setCounterPinOrder(null);
              }}
              style={{
                background: '#032f28',
                color: '#ffffff',
                border: 'none',
                borderRadius: 99,
                padding: '0.7rem 1.75rem',
                fontSize: 13,
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                boxShadow: '0 4px 14px rgba(3, 47, 40, 0.25)'
              }}
            >
              <span>Acknowledge &amp; Return to Queue</span>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_forward</span>
            </button>
          </div>
        </div>
      </div>
    );
    return typeof document !== 'undefined' ? ReactDOM.createPortal(modalContent, document.body) : modalContent;
  };

  if (counterPinOrder) {
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

        <CounterPinVerificationView
          order={counterPinOrder}
          pharmacy={pharmacy}
          counterPinDigits={counterPinDigits}
          setCounterPinDigits={setCounterPinDigits}
          onBack={() => {
            setCounterPinOrder(null);
            setCounterPinDigits(['', '', '', '']);
          }}
          onVerifyPin={handleVerifyPin}
          onOpenDocModal={() => setShowRxDocModal(true)}
          onOpenClarification={() => setClarificationOrder(counterPinOrder)}
          onOpenClinicalReview={() => setClinicalReviewOrder(counterPinOrder)}
        />

        {/* Prescription Doc Modal */}
        {showRxDocModal && typeof document !== 'undefined' && ReactDOM.createPortal(
          <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(3,47,40,0.55)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
            padding: '1.5rem'
          }}>
            <div style={{
              background: '#ffffff',
              borderRadius: 24,
              padding: '2rem',
              maxWidth: 580,
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 20px 40px rgba(3,47,40,0.15)',
              border: '1px solid #e0f2eb'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="material-symbols-outlined" style={{ color: '#2e685d', fontSize: 24 }}>document_scanner</span>
                  <h3 style={{ fontSize: 18, fontWeight: 700, color: '#032f28', margin: 0 }}>Prescription Document Authorization</h3>
                </div>
                <button
                  onClick={() => setShowRxDocModal(false)}
                  style={{ background: '#e6f8f1', border: 'none', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#032f28', cursor: 'pointer' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
                </button>
              </div>

              <div style={{ background: '#e6f8f1', padding: '1rem', borderRadius: 16, marginBottom: '1rem' }}>
                <div style={{ fontSize: 12, color: '#414846', marginBottom: '0.35rem' }}>
                  <strong>Prescription Reference:</strong> RX-MF-{counterPinOrder.id.slice(0, 8).toUpperCase()}
                </div>
                <div style={{ fontSize: 12, color: '#414846', marginBottom: '0.35rem' }}>
                  <strong>Patient Name:</strong> {counterPinOrder.user?.name || 'Verified Patient'}
                </div>
                <div style={{ fontSize: 12, color: '#414846' }}>
                  <strong>Date Issued / Staged:</strong> {new Date(counterPinOrder.createdAt).toLocaleDateString()}
                </div>
              </div>

              {(() => {
                const docRxId = counterPinOrder.prescriptionId || counterPinOrder.prescription?.id;
                if (docRxId) {
                  return (
                    <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid #c0c8c5', marginBottom: '1rem', background: '#000', display: 'flex', flexDirection: 'column' }}>
                      <AuthenticatedPrescriptionImage
                        prescriptionId={docRxId}
                        alt="Prescription Scan"
                        style={{ width: '100%', maxHeight: 360, objectFit: 'contain' }}
                      />
                      <div style={{ padding: '0.65rem 1rem', background: '#f8faf9', borderTop: '1px solid #e0f2eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <span style={{ fontSize: 11, color: '#414846', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#2e685d' }}>lock</span>
                          Encrypted Health Document Stream
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setShowRxDocModal(false);
                            setClinicalReviewOrder(counterPinOrder);
                          }}
                          style={{
                            background: '#032f28',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: 99,
                            padding: '0.35rem 0.85rem',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.25rem'
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 13 }}>layers</span>
                          <span>Compare Versions &amp; OCR Candidates</span>
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div style={{ background: '#f8faf9', border: '1px dashed #c0c8c5', borderRadius: 16, padding: '1.5rem', textAlign: 'center', marginBottom: '1rem' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 36, color: '#2e685d', marginBottom: '0.5rem' }}>verified</span>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#032f28' }}>Digital Verified Prescription Record</div>
                    <div style={{ fontSize: 11, color: '#717976', marginTop: '0.25rem' }}>
                      Screened via MediFind AI Optical Classifier &amp; Verified by System Pharmacist.
                    </div>
                  </div>
                );
              })()}

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                <button
                  onClick={() => setShowRxDocModal(false)}
                  style={{
                    background: '#032f28',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 99,
                    padding: '0.6rem 1.5rem',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Close Document Viewer
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Lifecycle Action Feedback Popup Dialog */}
        {renderLifecycleActionModal()}

        {/* Prescription Clarification Modal */}
        <PrescriptionClarificationModal
          order={clarificationOrder}
          isOpen={Boolean(clarificationOrder)}
          onClose={() => setClarificationOrder(null)}
          onClarificationUpdated={() => fetchPharmacyAndOrders(true)}
        />

        {/* Clinical Prescription Review & Verification Modal (Gate 2B) */}
        <ClinicalPrescriptionReviewModal
          order={clinicalReviewOrder || (counterPinOrder ? counterPinOrder : null)}
          isOpen={Boolean(clinicalReviewOrder)}
          onClose={() => setClinicalReviewOrder(null)}
          onVerified={() => fetchPharmacyAndOrders(true)}
          onOpenClarification={(ord) => {
            setClinicalReviewOrder(null);
            setClarificationOrder(ord);
          }}
        />
      </div>
    );
  }

  return (
    <div className="portal-page" style={{ minHeight: '100vh', paddingBottom: '4rem' }}>
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

      {/* Loading Skeleton State */}
      {loading && !pharmacy && (
        <div style={{ maxWidth: 1280, margin: '2rem auto', padding: '0 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ background: '#ffffff', borderRadius: 24, padding: '1.75rem', border: '1px solid #e0f2eb', boxShadow: '0 2px 8px rgba(3,47,40,0.04)' }} className="animate-pulse">
            <div style={{ width: '240px', height: '22px', borderRadius: '10px', background: '#e0f2eb', marginBottom: '14px' }} />
            <div style={{ width: '420px', height: '32px', borderRadius: '10px', background: '#e0f2eb', marginBottom: '10px' }} />
            <div style={{ width: '280px', height: '16px', borderRadius: '8px', background: '#e0f2eb' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ background: '#ffffff', borderRadius: 20, padding: '1.25rem', border: '1px solid #e0f2eb', minHeight: '120px' }} className="animate-pulse">
                <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#e0f2eb', marginBottom: '14px' }} />
                <div style={{ width: '60px', height: '28px', borderRadius: '8px', background: '#e0f2eb', marginBottom: '8px' }} />
                <div style={{ width: '130px', height: '14px', borderRadius: '6px', background: '#e0f2eb' }} />
              </div>
            ))}
          </div>
          <div style={{ background: '#ffffff', borderRadius: 24, padding: '1.75rem', border: '1px solid #e0f2eb' }} className="animate-pulse">
            <div style={{ width: '200px', height: '22px', borderRadius: '10px', background: '#e0f2eb', marginBottom: '16px' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ width: '100%', height: '88px', borderRadius: '16px', background: '#f5faf8' }} />
              <div style={{ width: '100%', height: '88px', borderRadius: '16px', background: '#f5faf8' }} />
              <div style={{ width: '100%', height: '88px', borderRadius: '16px', background: '#f5faf8' }} />
            </div>
          </div>
        </div>
      )}

      {/* Dynamic Status Bar */}
      {(!loading || pharmacy) && (
        <>
        <div style={{ background: '#e0f2eb', borderBottom: '1px solid #d5e6e0', padding: '0.65rem 1.5rem' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', fontSize: 12, color: '#414846' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#032f28', fontWeight: 700 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2e685d' }}></span>
              Inventory Sync Active
            </span>
            <span>—</span>
            <span>Dispenser Node #{pharmacy?.id?.substring(0, 6) || '819'}</span>
            <span style={{ color: '#717976' }}>•</span>
            <span style={{ color: '#2e685d', fontWeight: 600 }}>Stock Registry Verified</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{
              background: pharmacy?.isTestRecord ? '#d5e6e0' : '#b0ecdd',
              color: pharmacy?.isTestRecord ? '#414846' : '#032f28',
              padding: '0.2rem 0.65rem',
              borderRadius: 99,
              fontSize: 11,
              fontWeight: 700
            }}>
              {pharmacy?.isTestRecord ? 'TEST DATA — NOT A PARTICIPATING PHARMACY' : 'Participating Pharmacy'}
            </span>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '2rem 1.5rem' }}>
        {/* Top Header & Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1.5rem' }}>
            <div>
              {/* Dynamic Time-of-Day Personalized Greeting Badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.45rem' }}>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  background: '#0d231f',
                  color: '#6ee7b7',
                  border: '1px solid #134e44',
                  padding: '0.25rem 0.85rem',
                  borderRadius: 99,
                  fontSize: 12,
                  fontWeight: 700
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#34d399' }}>
                    {pharmacistGreetIcon}
                  </span>
                  <span>{pharmacistTimeGreet}, {pharmacistFirstName}! Welcome back to {pharmacy?.name || 'Dispensary'}</span>
                </span>
                <span style={{
                  background: '#b0ecdd',
                  color: '#00201b',
                  borderRadius: 99,
                  padding: '0.2rem 0.65rem',
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase'
                }}>
                  {pharmacy?.name || 'Max Care Pharmacy'}
                </span>
                {pharmacy?.licenseNumber && (
                  <span style={{ fontSize: 12, color: '#717976' }}>
                    License #{pharmacy.licenseNumber}
                  </span>
                )}
                <span style={{ fontSize: 11, color: '#2e685d', fontWeight: 700, background: '#e0f2eb', padding: '0.1rem 0.5rem', borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 12 }}>verified</span>
                  Participating Pharmacy
                </span>
              </div>
              <h1 style={{ fontSize: 32, fontWeight: 700, color: '#032f28', margin: 0, letterSpacing: '-0.02em' }}>
                {activeTab === 'overview' ? 'Prescription Reservation Queue' : 'Dispensary Inventory Management'}
              </h1>
              <p style={{ fontSize: 15, color: '#414846', margin: '0.35rem 0 0 0' }}>
                {activeTab === 'overview'
                  ? 'Real-time patient intake review, counter PIN verification, and fulfillment management.'
                  : 'Manage stock quantities, clinical pricing, and inventory synchronization with MediFind AI.'}
              </p>
            </div>

            {/* Top Switcher & Action Cluster */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              {/* Tab Switcher Pills */}
              <div style={{ background: '#ffffff', padding: '0.3rem', borderRadius: 99, display: 'flex', gap: '0.3rem', border: '1px solid #e0f2eb', boxShadow: '0 1px 4px rgba(3,47,40,0.04)' }}>
                <button
                  onClick={() => setActiveTab('overview')}
                  style={{
                    background: activeTab === 'overview' ? '#032f28' : 'transparent',
                    color: activeTab === 'overview' ? '#ffffff' : '#414846',
                    border: 'none',
                    borderRadius: 99,
                    padding: '0.45rem 1rem',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>assignment</span>
                  <span>Reservations ({orders.length})</span>
                </button>
                <button
                  onClick={() => setActiveTab('inventory')}
                  style={{
                    background: activeTab === 'inventory' ? '#032f28' : 'transparent',
                    color: activeTab === 'inventory' ? '#ffffff' : '#414846',
                    border: 'none',
                    borderRadius: 99,
                    padding: '0.45rem 1rem',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>inventory_2</span>
                  <span>Inventory ({activeCatalogueCount})</span>
                </button>
                <button
                  onClick={() => setActiveTab('clinical-inquiries')}
                  style={{
                    background: activeTab === 'clinical-inquiries' ? '#032f28' : 'transparent',
                    color: activeTab === 'clinical-inquiries' ? '#ffffff' : '#414846',
                    border: 'none',
                    borderRadius: 99,
                    padding: '0.45rem 1rem',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>clinical_notes</span>
                  <span>Clinical Inquiries ({clinicalQueue.length})</span>
                </button>
              </div>

              {activeTab === 'inventory' ? (
                <button
                  onClick={handleOpenAddModal}
                  style={{
                    background: '#032f28',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 99,
                    padding: '0.65rem 1.25rem',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    boxShadow: '0 2px 6px rgba(3,47,40,0.2)'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add_circle</span>
                  <span>+ Add Medicine</span>
                </button>
              ) : (
                <button
                  onClick={fetchPharmacyAndOrders}
                  disabled={loading}
                  style={{
                    background: '#ffffff',
                    color: '#032f28',
                    border: '1px solid #c0c8c5',
                    borderRadius: 99,
                    padding: '0.65rem 1.15rem',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: (loading || isRefreshing) ? 'not-allowed' : 'pointer',
                    opacity: (loading || isRefreshing) ? 0.7 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18, animation: (loading || isRefreshing) ? 'spin 1s linear infinite' : 'none' }}>sync</span>
                  <span>{(loading || isRefreshing) ? 'Refreshing...' : 'Refresh Queue'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Metric Bento Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginTop: '0.5rem' }}>
            {/* Card 1: Pending */}
            <AnimatedStatCard
              layout="split"
              icon="assignment_late"
              value={pendingCount}
              label="Pending Review"
              subtitle={pendingCount > 0 ? 'Requires clinical review' : 'No pending orders'}
              iconBg="#ffdad4"
              iconColor="#5a0100"
              iconShape="circle"
              iconSize={20}
              accentColor="#7e1208"
              barWidth="60%"
              delay={0}
              refreshKey={isRefreshing || loading}
            />

            {/* Card 2: Confirmed Orders */}
            <AnimatedStatCard
              layout="split"
              icon="inventory_2"
              value={confirmedCount}
              label="Active Dispense"
              subtitle="Preparing for customer handoff"
              iconBg="#e0f2eb"
              iconColor="#2e685d"
              iconShape="circle"
              iconSize={20}
              accentColor="#2e685d"
              barWidth="80%"
              delay={0.06}
              refreshKey={isRefreshing || loading}
            />

            {/* Card 3: Ready for Pickup */}
            <AnimatedStatCard
              layout="split"
              icon="verified"
              value={readyCount}
              label="Ready for Pickup"
              subtitle="Awaiting counter verification PIN"
              iconBg="#b0ecdd"
              iconColor="#336c61"
              iconShape="circle"
              iconSize={20}
              accentColor="#b0ecdd"
              barWidth="100%"
              delay={0.12}
              refreshKey={isRefreshing || loading}
            />

            {/* Card 4: Low Stock Alerts */}
            <AnimatedStatCard
              layout="split"
              icon="warning"
              value={lowStockCount}
              label="Low-Stock Items"
              subtitle="Units below buffer threshold (≤5)"
              iconBg="#ffdad6"
              iconColor="#ba1a1a"
              iconShape="circle"
              iconSize={20}
              accentColor="#ba1a1a"
              barWidth="40%"
              delay={0.18}
              refreshKey={isRefreshing || loading}
            />
          </div>
        </div>

        {/* VIEW 1: RESERVATIONS QUEUE */}
        {activeTab === 'overview' && (
          <div>
            {/* Search & Status Filters */}
            <div style={{
              background: '#ffffff',
              borderRadius: 20,
              padding: '0.85rem 1.25rem',
              boxShadow: '0 1px 4px rgba(3,47,40,0.04)',
              border: '1px solid #e0f2eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '1rem',
              marginBottom: '1.5rem'
            }}>
              {/* Search Bar */}
              <div style={{ position: 'relative', flex: 1, minWidth: 260 }}>
                <span className="material-symbols-outlined" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#717976', fontSize: 18 }}>
                  search
                </span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search"
                  style={{
                    width: '100%',
                    padding: '0.65rem 1rem 0.65rem 2.65rem',
                    borderRadius: 99,
                    background: '#e6f8f1',
                    border: 'none',
                    fontSize: 13,
                    color: '#032f28',
                    outline: 'none'
                  }}
                />
              </div>

              {/* Status Filter Tabs */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', overflowX: 'auto' }}>
                {[
                  { id: 'ALL', label: 'All', count: orders.length },
                  { id: 'PENDING', label: 'Pending', count: pendingCount },
                  { id: 'CONFIRMED', label: 'Confirmed', count: confirmedCount },
                  { id: 'READY_FOR_PICKUP', label: 'Ready for Pickup', count: readyCount },
                  { id: 'COMPLETED', label: 'Completed', count: completedCount },
                  { id: 'CANCELLED', label: 'Cancelled', count: cancelledCount },
                  { id: 'REJECTED', label: 'Rejected', count: rejectedCount }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setOrderFilterTab(tab.id)}
                    style={{
                      background: orderFilterTab === tab.id ? '#032f28' : '#e6f8f1',
                      color: orderFilterTab === tab.id ? '#ffffff' : '#414846',
                      border: 'none',
                      borderRadius: 99,
                      padding: '0.35rem 0.85rem',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem'
                    }}
                  >
                    <span>{tab.label}</span>
                    {tab.count !== undefined && (
                      <span
                        style={{
                          background: orderFilterTab === tab.id ? 'rgba(255,255,255,0.2)' : 'rgba(3,47,40,0.08)',
                          color: orderFilterTab === tab.id ? '#ffffff' : '#2e685d',
                          borderRadius: 99,
                          padding: '1px 6px',
                          fontSize: 11,
                          fontWeight: 700
                        }}
                      >
                        <RollingNumber value={tab.count} />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Orders List */}
            {(loading && orders.length === 0) ? (
              <LoadingSkeleton variant="order-card" count={3} />
            ) : filteredOrders.length === 0 ? (
              <EmptyState
                icon="assignment_turned_in"
                title="No Reservations Found"
                description={searchQuery ? 'No orders match your search criteria.' : 'There are currently no prescription reservations in this filter.'}
                actionLabel={searchQuery ? 'Clear Search' : null}
                onAction={() => setSearchQuery('')}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {filteredOrders.map(order => {
                  const isPending = order.status === 'PENDING';
                  const isConfirmed = order.status === 'CONFIRMED';
                  const isReady = order.status === 'READY_FOR_PICKUP';
                  const isCompleted = order.status === 'COMPLETED';
                  const isCancelled = order.status === 'CANCELLED';
                  const isRejected = order.status === 'REJECTED';

                  const stripeColor = isCancelled
                    ? '#9ca3af'
                    : isPending
                    ? '#7e1208'
                    : isConfirmed
                    ? '#2e685d'
                    : isReady
                    ? '#336c61'
                    : isCompleted
                    ? '#032f28'
                    : '#ba1a1a';

                  return (
                    <div
                      key={order.id}
                      style={{
                        background: isCancelled ? '#fafafa' : '#ffffff',
                        borderRadius: 20,
                        border: isCancelled ? '1px dashed #d1d5db' : '1px solid #e0f2eb',
                        boxShadow: isCancelled ? 'none' : '0 1px 4px rgba(3,47,40,0.04)',
                        padding: '1.5rem',
                        position: 'relative',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '1rem',
                        opacity: isCancelled ? 0.62 : 1,
                        filter: isCancelled ? 'grayscale(30%)' : 'none',
                        transition: 'opacity 0.2s ease, filter 0.2s ease'
                      }}
                    >
                      {/* Left Status Bar */}
                      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, background: stripeColor }}></div>

                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', paddingLeft: '0.5rem' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                            <span style={{
                              fontSize: 16,
                              fontWeight: 700,
                              color: isCancelled ? '#6b7280' : '#032f28',
                              textDecoration: isCancelled ? 'line-through' : 'none'
                            }}>
                              #{order.id.slice(0, 10).toUpperCase()}
                            </span>
                            <span style={{
                              background: isCancelled ? '#fee2e2' : isPending ? '#ffdad4' : isReady ? '#b0ecdd' : '#e0f2eb',
                              color: isCancelled ? '#991b1b' : isPending ? '#5a0100' : isReady ? '#336c61' : '#2e685d',
                              borderRadius: 99,
                              padding: '0.2rem 0.65rem',
                              fontSize: 11,
                              fontWeight: 700
                            }}>
                              {isCancelled ? 'CANCELLED' : order.status.replace(/_/g, ' ')}
                            </span>
                            {(() => {
                              const method = order.payment?.method || order.paymentMethod;
                              const payStatus = order.payment?.status || order.paymentStatus;
                              const isPaid = payStatus === 'PAID';
                              const isCounter = method === 'COUNTER' || method === 'PAY_AT_COUNTER';

                              if (isPaid) {
                                return (
                                  <span style={{ background: '#b0ecdd', color: '#032f28', borderRadius: 99, padding: '0.2rem 0.65rem', fontSize: 11, fontWeight: 700 }}>
                                    ONLINE • PAID
                                  </span>
                                );
                              }
                              if (isCounter) {
                                return (
                                  <span style={{ background: '#e0f2eb', color: '#2e685d', borderRadius: 99, padding: '0.2rem 0.65rem', fontSize: 11, fontWeight: 700 }}>
                                    PAY AT COUNTER • PENDING
                                  </span>
                                );
                              }
                              if (method === 'ONLINE') {
                                return (
                                  <span style={{ background: '#fff3cd', color: '#856404', borderRadius: 99, padding: '0.2rem 0.65rem', fontSize: 11, fontWeight: 700 }}>
                                    ONLINE • PAYMENT PENDING
                                  </span>
                                );
                              }
                              return (
                                <span style={{ background: '#ffdad4', color: '#93000a', borderRadius: 99, padding: '0.2rem 0.65rem', fontSize: 11, fontWeight: 700 }}>
                                  AWAITING CHECKOUT
                                </span>
                              );
                            })()}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 13, color: '#414846', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 600, color: '#0f1e1b' }}>
                              Patient: {order.user?.name || 'Verified Patient'}
                            </span>
                            <span>•</span>
                            <span>{new Date(order.createdAt).toLocaleString()}</span>
                            <span>•</span>
                            <span style={{ color: '#2e685d', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                              Total: <RollingNumber prefix="₹" value={(order.totalAmount || 0).toFixed(2)} />
                            </span>
                          </div>
                        </div>

                        {/* Fulfillment Info */}
                        <div style={{
                          background: isCancelled ? '#f3f4f6' : '#e6f8f1',
                          padding: '0.5rem 0.85rem',
                          borderRadius: 14,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          fontSize: 12,
                          color: isCancelled ? '#6b7280' : '#032f28',
                          fontWeight: 600
                        }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d' }}>
                            {order.fulfillmentType === 'ASSISTANT_DELIVERY' || order.fulfillmentType === 'DELIVERY' ? 'support_agent' : 'store'}
                          </span>
                          <span>
                            {order.fulfillmentType === 'ASSISTANT_DELIVERY'
                              ? 'Medicine Access Assistant'
                              : order.fulfillmentType === 'DELIVERY'
                              ? 'Pharmacy Delivery'
                              : order.fulfillmentType === 'PICKUP'
                              ? 'Pharmacy Counter Pickup'
                              : 'Counter Pickup / Delivery'}
                          </span>
                        </div>
                      </div>

                      {/* Pharmacist Medicine-Selection Request Action Banner */}
                      {(() => {
                        const pendingItems = (order.items || []).filter(it =>
                          it.status === 'PENDING_SELECTION' ||
                          it.unfulfilledReason === 'PHARMACIST_SELECTION_REQUESTED' ||
                          it.prescriptionItem?.patientNotes === 'PHARMACIST_SELECTION_REQUESTED' ||
                          (order.notes && order.notes.includes(`[PENDING_SELECTION:${it.prescriptionItemId || it.medicineId}:`))
                        );

                        if (pendingItems.length === 0) return null;

                        return (
                          <div style={{
                            background: '#fffbeb',
                            border: '1.5px solid #fde68a',
                            borderRadius: 14,
                            padding: '0.85rem 1rem',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.6rem',
                            boxShadow: '0 1px 3px rgba(180, 83, 9, 0.08)'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#b45309' }}>
                                  support_agent
                                </span>
                                <span style={{ fontSize: 13, fontWeight: 800, color: '#92400e' }}>
                                  Patient Requested Attending Pharmacist Brand Selection
                                </span>
                              </div>
                              <span style={{
                                fontSize: 11,
                                fontWeight: 700,
                                background: '#fef3c7',
                                color: '#92400e',
                                padding: '0.2rem 0.65rem',
                                borderRadius: 99,
                                border: '1px solid #fcd34d'
                              }}>
                                {pendingItems.length} medicine{pendingItems.length > 1 ? 's' : ''} awaiting selection
                              </span>
                            </div>

                            <p style={{ fontSize: 12, color: '#78350f', margin: 0, lineHeight: 1.45 }}>
                              The patient was unsure which trade brand to select for their prescribed medication. As the attending dispensary pharmacist, please review the prescription and confirm a genuine compatible formulation.
                            </p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.25rem' }}>
                              {pendingItems.map((pi, pidx) => {
                                const genericName = pi.prescriptionItem?.prescribedName || pi.medicine?.genericName || pi.medicine?.name || 'Prescribed Medicine';
                                const strength = pi.prescriptionItem?.dosage || pi.medicine?.strength || '';
                                const qty = pi.quantity || 1;
                                return (
                                  <div
                                    key={pidx}
                                    style={{
                                      fontSize: 12,
                                      background: '#ffffff',
                                      padding: '0.5rem 0.85rem',
                                      borderRadius: 10,
                                      border: '1px solid #fef3c7',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      flexWrap: 'wrap',
                                      gap: '0.5rem'
                                    }}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                      <span style={{ fontWeight: 800, color: '#451a03' }}>{genericName}</span>
                                      {strength && (
                                        <span style={{
                                          fontSize: 11,
                                          fontFamily: 'monospace',
                                          background: '#fef3c7',
                                          color: '#92400e',
                                          padding: '0.1rem 0.4rem',
                                          borderRadius: 4,
                                          fontWeight: 600
                                        }}>
                                          {strength}
                                        </span>
                                      )}
                                      <span style={{ color: '#78350f', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}>
                                        • Qty: <RollingNumber value={qty} />
                                      </span>
                                    </div>
                                    <span style={{
                                      fontSize: 11,
                                      fontWeight: 700,
                                      color: '#d97706',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '0.25rem'
                                    }}>
                                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>hourglass_top</span>
                                      Brand Unassigned
                                    </span>
                                  </div>
                                );
                              })}
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '0.25rem' }}>
                              <button
                                type="button"
                                onClick={() => setClinicalReviewOrder(order)}
                                style={{
                                  background: '#d97706',
                                  color: '#ffffff',
                                  border: 'none',
                                  borderRadius: 8,
                                  padding: '0.45rem 1rem',
                                  fontSize: 12,
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.35rem',
                                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                                }}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit_note</span>
                                <span>Open Clinical Verification &amp; Select Brand</span>
                              </button>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Items Ordered */}
                      <div style={{ background: isCancelled ? '#f3f4f6' : '#e6f8f1', padding: '0.85rem 1rem', borderRadius: 14, paddingLeft: '1.25rem' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: isCancelled ? '#6b7280' : '#2e685d', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                          Prescription Items (<RollingNumber value={order.items?.length || 0} />):
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                          {(order.items || []).map((it, idx) => {
                            const isPendingBrand = it.status === 'PENDING_SELECTION' ||
                              it.unfulfilledReason === 'PHARMACIST_SELECTION_REQUESTED' ||
                              it.prescriptionItem?.patientNotes === 'PHARMACIST_SELECTION_REQUESTED' ||
                              (order.notes && order.notes.includes(`[PENDING_SELECTION:${it.prescriptionItemId || it.medicineId}:`));

                            return (
                              <div
                                key={idx}
                                style={{
                                  background: isPendingBrand ? '#fef3c7' : '#ffffff',
                                  border: isPendingBrand ? '1.5px solid #f59e0b' : '1px solid #c0c8c5',
                                  borderRadius: 99,
                                  padding: '0.35rem 0.75rem',
                                  fontSize: 12,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.5rem'
                                }}
                              >
                                <span style={{ fontWeight: 600, color: isPendingBrand ? '#92400e' : '#032f28' }}>
                                  {it.prescriptionItem?.prescribedName || it.medicine?.brandName || it.brandName || it.medicine?.name || it.name || 'Prescription Medicine'}
                                </span>
                                <span style={{ color: isPendingBrand ? '#b45309' : '#717976', display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}>
                                  × <RollingNumber value={it.quantity} />
                                </span>
                                {isPendingBrand ? (
                                  <span style={{
                                    fontSize: 10,
                                    fontWeight: 800,
                                    color: '#b45309',
                                    background: '#fde68a',
                                    padding: '0.1rem 0.45rem',
                                    borderRadius: 99
                                  }}>
                                    Brand Selection Required
                                  </span>
                                ) : (
                                  <span style={{ color: '#2e685d', fontWeight: 600 }}>
                                    {(() => {
                                      const unit = it.unitPrice != null && Number(it.unitPrice) > 0
                                        ? Number(it.unitPrice)
                                        : (it.medicine?.price != null && Number(it.medicine.price) > 0 ? Number(it.medicine.price) : (it.price != null ? Number(it.price) : null));
                                      const lineTotal = it.subtotal != null && Number(it.subtotal) > 0
                                        ? Number(it.subtotal)
                                        : (unit != null ? unit * (Number(it.quantity) || 1) : null);
                                      return lineTotal != null ? <RollingNumber prefix="₹" value={lineTotal.toFixed(2)} /> : 'MRP';
                                    })()}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Action Controls */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingTop: '0.5rem',
                        borderTop: '1px solid #e0f2eb',
                        flexWrap: 'wrap',
                        gap: '0.75rem',
                        paddingLeft: '0.5rem'
                      }}>
                        <div style={{ fontSize: 12, color: '#717976' }}>
                          Ref ID: <span style={{ fontFamily: 'monospace' }}>{order.id}</span>
                        </div>

                        {/* Interactive Buttons by state */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          {/* Clinical OCR & Verification Button (Gate 2B) */}
                          {(order.prescriptionId || order.prescription) && (
                            <button
                              type="button"
                              onClick={() => setClinicalReviewOrder(order)}
                              style={{
                                background: '#e0f2eb',
                                color: '#032f28',
                                border: '1px solid #b0ecdd',
                                borderRadius: 99,
                                padding: '0.45rem 0.95rem',
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.35rem'
                              }}
                              title="Clinical OCR Review & Pharmacist Verification"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>clinical_notes</span>
                              <span>Review &amp; Verify Rx</span>
                            </button>
                          )}

                          {isPending && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <FlowButton
                                size="sm"
                                variant="primary"
                                loading={updatingStatusId === order.id}
                                disabled={updatingStatusId === order.id}
                                onClick={() => {
                                  setConfirmDialog({
                                    isOpen: true,
                                    title: 'Accept & Stage Reservation?',
                                    message: `Confirm acceptance of prescription reservation #${order.id.slice(0, 8)}? Inventory stock will be earmarked for staging.`,
                                    confirmLabel: 'Accept & Stage',
                                    variant: 'primary',
                                    impactPoints: [
                                      'Prescription items will be earmarked in dispensary stock.',
                                      'Patient will receive notification to proceed with pickup schedule.'
                                    ],
                                    onConfirm: () => handleUpdateStatus(order.id, 'CONFIRMED')
                                  });
                                }}
                              >
                                Accept &amp; Stage
                              </FlowButton>

                              <button
                                disabled={updatingStatusId === order.id}
                                onClick={() => {
                                  setConfirmDialog({
                                    isOpen: true,
                                    title: 'Decline Reservation?',
                                    message: 'Are you sure you want to decline this reservation? The patient will be notified immediately.',
                                    confirmLabel: 'Decline Order',
                                    variant: 'danger',
                                    onConfirm: () => handleUpdateStatus(order.id, 'REJECTED')
                                  });
                                }}
                                style={{
                                  background: 'transparent',
                                  color: '#ba1a1a',
                                  border: '1.5px solid rgba(186, 26, 26, 0.35)',
                                  borderRadius: 99,
                                  padding: '0.5rem 1rem',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: updatingStatusId === order.id ? 'not-allowed' : 'pointer',
                                  opacity: updatingStatusId === order.id ? 0.6 : 1,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.35rem',
                                  transition: 'all 0.15s ease'
                                }}
                                onMouseEnter={e => {
                                  if (updatingStatusId !== order.id) {
                                    e.currentTarget.style.background = 'rgba(186, 26, 26, 0.08)';
                                    e.currentTarget.style.borderColor = '#ba1a1a';
                                  }
                                }}
                                onMouseLeave={e => {
                                  e.currentTarget.style.background = 'transparent';
                                  e.currentTarget.style.borderColor = 'rgba(186, 26, 26, 0.35)';
                                }}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 15 }}>close</span>
                                <span>Decline</span>
                              </button>
                            </div>
                          )}

                          {isConfirmed && (() => {
                            const isCounter = order.payment?.method === 'COUNTER' || order.payment?.method === 'PAY_AT_COUNTER';
                            const isOnlinePaid = order.payment?.method === 'ONLINE' && order.payment?.status === 'PAID';
                            const isOnlinePending = order.payment?.method === 'ONLINE' && order.payment?.status !== 'PAID';
                            const hasFulfillment = Boolean(order.fulfillmentType) || isCounter;
                            const canMarkReady = hasFulfillment && (isCounter || isOnlinePaid);

                            if (!canMarkReady) {
                              const pendingMessage = (!hasFulfillment && !isCounter) || !order.payment?.method
                                ? 'Awaiting checkout/payment method'
                                : (isOnlinePending ? 'Awaiting online payment (Razorpay)' : 'Awaiting checkout/payment method');

                              return (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                  <button
                                    disabled
                                    title="Patient must complete checkout and select payment method before order can be marked ready for pickup"
                                    style={{
                                      background: '#f1f5f3',
                                      color: '#717976',
                                      border: '1px solid #c0c8c5',
                                      borderRadius: 99,
                                      padding: '0.45rem 1.15rem',
                                      fontSize: 12,
                                      fontWeight: 600,
                                      cursor: 'not-allowed',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '0.35rem',
                                      opacity: 0.8
                                    }}
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>hourglass_top</span>
                                    <span>{pendingMessage}</span>
                                  </button>
                                </div>
                              );
                            }

                            const isUpdatingThisOrder = updatingStatusId === order.id;

                            return (
                              <FlowButton
                                variant="primary"
                                size="sm"
                                disabled={isUpdatingThisOrder}
                                loading={isUpdatingThisOrder}
                                onClick={() => {
                                  setConfirmDialog({
                                    isOpen: true,
                                    title: 'Mark Order Ready for Pickup?',
                                    message: `Confirm that all medicines for reservation #${order.id.slice(0, 8)} are sealed and placed in the pickup bay?`,
                                    confirmLabel: 'Mark Ready',
                                    variant: 'primary',
                                    impactPoints: [
                                      'Patient 4-digit verification PIN will be activated.',
                                      'Status updates to Ready for Pickup across patient and admin portals.',
                                      isCounter ? 'Payment will be collected at counter upon patient arrival.' : 'Online payment has been verified.'
                                    ],
                                    onConfirm: () => handleUpdateStatus(order.id, 'READY_FOR_PICKUP')
                                  });
                                }}
                              >
                                {isUpdatingThisOrder ? 'Marking Ready...' : 'Mark Ready for Pickup'}
                              </FlowButton>
                            );
                          })()}

                          {isReady && (
                            <FlowButton
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                playKeypadClickSound('press');
                                setCounterPinOrder(order);
                                setCounterPinDigits(['', '', '', '']);
                              }}
                            >
                              Counter PIN Terminal
                            </FlowButton>
                          )}

                          {isConfirmed && (
                            <FlowButton
                              variant="danger"
                              size="sm"
                              onClick={() => {
                                setConfirmDialog({
                                  isOpen: true,
                                  title: 'Cancel Reservation?',
                                  message: `Cancel confirmed reservation #${order.id.slice(0, 8)}? Earmarked inventory will be restored back to active stock.`,
                                  confirmLabel: 'Cancel Reservation',
                                  variant: 'danger',
                                  onConfirm: () => handleUpdateStatus(order.id, 'CANCELLED')
                                });
                              }}
                            >
                              Cancel Reservation
                            </FlowButton>
                          )}

                          {isCancelled && (
                            <span style={{ color: '#6b7280', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem', background: '#f3f4f6', padding: '0.35rem 0.85rem', borderRadius: 99, border: '1px solid #e5e7eb' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#9ca3af' }}>cancel</span>
                              Reservation Cancelled • Stock Restored
                            </span>
                          )}

                          {isRejected && (
                            <span style={{ color: '#ba1a1a', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem', background: '#fef2f2', padding: '0.35rem 0.85rem', borderRadius: 99, border: '1px solid #fee2e2' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>block</span>
                              Reservation Rejected
                            </span>
                          )}

                          {!isCancelled && !isRejected && (
                            <button
                              onClick={() => setClarificationOrder(order)}
                              style={{
                                background: '#e0f2eb',
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
                              <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>contact_support</span>
                              <span>Clarification</span>
                            </button>
                          )}

                          {isCompleted && (
                            <span style={{ color: '#2e685d', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check_circle</span>
                              Dispensation Completed
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* VIEW 2: DISPENSARY INVENTORY MANAGEMENT */}
        {activeTab === 'inventory' && (
          <div>
            {/* Filter Toolbar */}
            <div style={{
              background: '#ffffff',
              borderRadius: 20,
              padding: '0.85rem 1.25rem',
              boxShadow: '0 1px 4px rgba(3,47,40,0.04)',
              border: '1px solid #e0f2eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '1rem',
              marginBottom: '1.5rem'
            }}>
              {/* Search Bar */}
              <div style={{ position: 'relative', flex: 1, minWidth: 260 }}>
                <span className="material-symbols-outlined" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#717976', fontSize: 18 }}>
                  search
                </span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search"
                  style={{
                    width: '100%',
                    padding: '0.65rem 1rem 0.65rem 2.65rem',
                    borderRadius: 99,
                    background: '#e6f8f1',
                    border: 'none',
                    fontSize: 13,
                    color: '#032f28',
                    outline: 'none'
                  }}
                />
              </div>

              {/* Status Filter Pills */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', overflowX: 'auto' }}>
                {[
                  { id: 'ALL', label: `All (${inventory.length})` },
                  { id: 'AVAILABLE', label: 'Available' },
                  { id: 'LOW_STOCK', label: `Low Stock (${lowStockCount})` },
                  { id: 'OUT_OF_STOCK', label: 'Out of Stock' }
                ].map(p => (
                  <button
                    key={p.id}
                    onClick={() => setInventoryFilterTab(p.id)}
                    style={{
                      background: inventoryFilterTab === p.id ? '#032f28' : '#e6f8f1',
                      color: inventoryFilterTab === p.id ? '#ffffff' : '#414846',
                      border: 'none',
                      borderRadius: 99,
                      padding: '0.35rem 0.85rem',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Inventory Table Container */}
            <div style={{
              background: '#ffffff',
              borderRadius: 20,
              boxShadow: '0 1px 4px rgba(3,47,40,0.04)',
              border: '1px solid #e0f2eb',
              overflow: 'hidden'
            }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#e0f2eb', color: '#414846', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      <th style={{ padding: '0.85rem 1.25rem' }}>Medicine Details</th>
                      <th style={{ padding: '0.85rem 1rem' }}>Category</th>
                      <th style={{ padding: '0.85rem 1rem' }}>Current Stock</th>
                      <th style={{ padding: '0.85rem 1rem' }}>Unit Price (₹)</th>
                      <th style={{ padding: '0.85rem 1rem' }}>Stock Status</th>
                      <th style={{ padding: '0.85rem 1.25rem', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(loading && inventory.length === 0) ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: '3rem 1rem', color: '#2e685d' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                            <span className="material-symbols-outlined" style={{ animation: 'spin 1s linear infinite' }}>sync</span>
                            <span>Loading dispensary inventory...</span>
                          </div>
                        </td>
                      </tr>
                    ) : filteredInventory.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: '3rem 1rem', color: '#717976' }}>
                          No medicines found in this filter. Click "+ Add Medicine" to stock new items.
                        </td>
                      </tr>
                    ) : (
                      filteredInventory.map(item => {
                        const med = item.medicine || {};
                        const edit = stockEditMap[item.id] || { stock: item.stock || 0, price: item.price || 0 };
                        const stockVal = item.stock != null ? item.stock : 0;
                        const isSaving = updatingItemId === item.id;

                        const isLow = stockVal > 0 && stockVal <= 5;
                        const isOut = stockVal <= 0;

                        return (
                          <tr key={item.id} style={{ borderBottom: '1px solid #e0f2eb' }}>
                            {/* Medicine Details */}
                            <td style={{ padding: '1rem 1.25rem' }}>
                              <div style={{ fontWeight: 700, color: '#032f28', fontSize: 14 }}>
                                {item.brandName || med.brandName || item.name || med.name || 'Prescription Medicine'}
                                {(item.strength || med.strength) ? ` (${item.strength || med.strength})` : ''}
                              </div>
                              <div style={{ fontSize: 12, color: '#717976', marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                                <span>{item.genericName || med.genericName || 'Generic formulation'}</span>
                                {(item.dosageForm || med.dosageForm) && <span>• {item.dosageForm || med.dosageForm}</span>}
                              </div>
                            </td>

                            {/* Category */}
                            <td style={{ padding: '1rem' }}>
                              <span style={{
                                background: '#e6f8f1',
                                color: '#2e685d',
                                padding: '0.2rem 0.55rem',
                                borderRadius: 99,
                                fontSize: 11,
                                fontWeight: 600
                              }}>
                                {item.category || med.category || 'General'}
                              </span>
                            </td>

                            {/* Current Stock (Editable with quick +/- stepper) */}
                            <td style={{ padding: '1rem' }}>
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const current = parseInt(edit.stock != null ? edit.stock : item.stock, 10) || 0;
                                    const updated = Math.max(0, current - 1);
                                    setStockEditMap(prev => ({
                                      ...prev,
                                      [item.id]: { ...prev[item.id], stock: updated }
                                    }));
                                  }}
                                  style={{
                                    width: 26,
                                    height: 26,
                                    borderRadius: 6,
                                    border: '1px solid #c0c8c5',
                                    background: '#f8fafc',
                                    color: '#032f28',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 14
                                  }}
                                  title="Decrease quantity by 1"
                                >
                                  -
                                </button>
                                <input
                                  type="number"
                                  min={0}
                                  value={edit.stock}
                                  onChange={e => {
                                    const val = e.target.value;
                                    setStockEditMap(prev => ({
                                      ...prev,
                                      [item.id]: { ...prev[item.id], stock: val }
                                    }));
                                  }}
                                  style={{
                                    width: 65,
                                    padding: '0.35rem 0.5rem',
                                    borderRadius: 8,
                                    border: '1px solid #c0c8c5',
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: '#032f28',
                                    textAlign: 'center'
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const current = parseInt(edit.stock != null ? edit.stock : item.stock, 10) || 0;
                                    const updated = current + 1;
                                    setStockEditMap(prev => ({
                                      ...prev,
                                      [item.id]: { ...prev[item.id], stock: updated }
                                    }));
                                  }}
                                  style={{
                                    width: 26,
                                    height: 26,
                                    borderRadius: 6,
                                    border: '1px solid #c0c8c5',
                                    background: '#e0f2eb',
                                    color: '#032f28',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 14
                                  }}
                                  title="Increase quantity by 1"
                                >
                                  +
                                </button>
                              </div>
                            </td>

                            {/* Unit Price (Editable) */}
                            <td style={{ padding: '1rem' }}>
                              <input
                                type="number"
                                step="0.5"
                                min={0}
                                value={edit.price}
                                onChange={e => {
                                  const val = e.target.value;
                                  setStockEditMap(prev => ({
                                    ...prev,
                                    [item.id]: { ...prev[item.id], price: val }
                                  }));
                                }}
                                style={{
                                  width: 90,
                                  padding: '0.35rem 0.5rem',
                                  borderRadius: 8,
                                  border: '1px solid #c0c8c5',
                                  fontSize: 13,
                                  fontWeight: 600,
                                  color: '#032f28'
                                }}
                              />
                            </td>

                            {/* Stock Status Badge */}
                            <td style={{ padding: '1rem' }}>
                              <span style={{
                                background: isOut ? '#ffdad6' : isLow ? '#ffdad4' : '#e0f2eb',
                                color: isOut ? '#ba1a1a' : isLow ? '#7e1208' : '#2e685d',
                                padding: '0.2rem 0.65rem',
                                borderRadius: 99,
                                fontSize: 11,
                                fontWeight: 700
                              }}>
                                {isOut ? 'Out of Stock' : isLow ? 'Low Stock' : 'Available'}
                              </span>
                            </td>

                            {/* Action Button */}
                            <td style={{ padding: '1rem 1.25rem', textAlign: 'right' }}>
                              <button
                                onClick={() => handleSaveStock(item.id, item.medicineId)}
                                disabled={isSaving}
                                style={{
                                  background: '#032f28',
                                  color: '#ffffff',
                                  border: 'none',
                                  borderRadius: 99,
                                  padding: '0.4rem 0.85rem',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: 'pointer'
                                }}
                              >
                                {isSaving ? 'Saving...' : 'Update'}
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 3: CLINICAL INQUIRIES QUEUE (GATE 8) */}
        {activeTab === 'clinical-inquiries' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Header info */}
            <div style={{ background: '#ffffff', borderRadius: 20, padding: '1.25rem 1.5rem', border: '1px solid #e0f2eb', boxShadow: '0 1px 4px rgba(3,47,40,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: '#032f28', margin: 0 }}>
                  Assigned Clinical Assistance Inquiries
                </h2>
                <p style={{ fontSize: 12, color: '#414846', margin: '0.25rem 0 0 0' }}>
                  Review patient symptoms submitted in Malayalam, Hindi, or English. Provide professional clinical advice.
                </p>
              </div>

              <button
                onClick={fetchClinicalQueue}
                disabled={loadingClinicalQueue}
                style={{
                  background: '#e0f2eb',
                  color: '#032f28',
                  border: '1px solid #c0c8c5',
                  borderRadius: 99,
                  padding: '0.45rem 1rem',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: loadingClinicalQueue ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16, animation: loadingClinicalQueue ? 'spin 1s linear infinite' : 'none' }}>sync</span>
                <span>Refresh Inquiries</span>
              </button>
            </div>

            {loadingClinicalQueue ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {[1, 2].map(i => (
                  <div key={i} style={{ height: 100, background: '#ffffff', borderRadius: 18, border: '1px solid #e0f2eb', animation: 'pulse 1.5s infinite' }} />
                ))}
              </div>
            ) : clinicalQueue.length === 0 ? (
              <div style={{ background: '#ffffff', borderRadius: 24, padding: '3.5rem 2rem', textAlign: 'center', border: '1px solid #e0f2eb' }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#e0f2eb', color: '#2e685d', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem auto' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 32 }}>clinical_notes</span>
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#032f28', margin: '0 0 0.35rem 0' }}>
                  No Active Clinical Inquiries Assigned
                </h3>
                <p style={{ fontSize: 12, color: '#717976', margin: 0 }}>
                  When patients submit health concerns in your territory, they will be dispatched here for human clinical review.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {clinicalQueue.map(item => {
                  const req = item.request;
                  const isResponded = item.assignmentStatus === 'RESPONDED' || req.status === 'RESPONDED';
                  return (
                    <div
                      key={item.assignmentId}
                      style={{
                        background: '#ffffff',
                        borderRadius: 20,
                        padding: '1.25rem 1.5rem',
                        border: '1px solid #e0f2eb',
                        boxShadow: '0 1px 4px rgba(3,47,40,0.04)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.85rem'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', borderBottom: '1px solid #f0fdf7', paddingBottom: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: '#717976' }}>REF:</span>
                          <span style={{ fontSize: 12, fontWeight: 800, color: '#032f28', letterSpacing: '0.04em' }}>{req.requestNumber}</span>
                          <span style={{ background: '#e0f2eb', color: '#2e685d', padding: '0.15rem 0.5rem', borderRadius: 99, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>
                            {req.language} ({req.inputMethod})
                          </span>
                          <span style={{ background: '#f0fdf7', color: '#414846', padding: '0.15rem 0.5rem', borderRadius: 99, fontSize: 10, fontWeight: 600 }}>
                            Round #{item.round}
                          </span>
                        </div>

                        <span style={{
                          background: isResponded ? '#e0f2eb' : '#ffdad4',
                          color: isResponded ? '#2e685d' : '#5a0100',
                          padding: '0.2rem 0.65rem',
                          borderRadius: 99,
                          fontSize: 11,
                          fontWeight: 700
                        }}>
                          {isResponded ? '✓ Responded' : 'Awaiting Review'}
                        </span>
                      </div>

                      {/* Original Concern */}
                      <div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#717976', display: 'block', marginBottom: '0.25rem' }}>
                          Patient's Original Concern ({req.language.toUpperCase()}):
                        </span>
                        <div style={{ background: '#f8faf9', padding: '0.85rem', borderRadius: 12, border: '1px solid #e0f2eb', fontSize: 13, color: '#032f28', lineHeight: 1.5, fontStyle: 'italic' }}>
                          "{req.originalText}"
                        </div>
                      </div>

                      {/* Emergency Notice */}
                      {req.isEmergency && (
                        <div style={{ background: '#ffdad6', color: '#ba1a1a', padding: '0.65rem 1rem', borderRadius: 12, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>e911_emergency</span>
                          <span>Emergency triage triggered for this concern.</span>
                        </div>
                      )}

                      {/* Clinician Response if present */}
                      {req.clinicianResponse && (
                        <div style={{ background: '#e0f2eb', padding: '0.75rem 1rem', borderRadius: 12, fontSize: 12, color: '#032f28' }}>
                          <strong>Recorded Response:</strong> {req.clinicianResponse}
                        </div>
                      )}

                      {/* Actions */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '0.35rem' }}>
                        <button
                          onClick={() => handleOpenClinicalDetail(item)}
                          style={{
                            background: '#032f28',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: 99,
                            padding: '0.5rem 1.25rem',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.35rem'
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit_note</span>
                          <span>{isResponded ? 'View / Update Response' : 'Respond to Patient'}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Clinical Inquiry Response Modal (Gate 8) */}
      {selectedClinicalRequest && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(3,47,40,0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: '#ffffff', borderRadius: 24, width: '100%', maxWidth: 560, padding: '2rem', boxShadow: '0 24px 64px rgba(3,47,40,0.25)', border: '1px solid #e0f2eb', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="material-symbols-outlined" style={{ color: '#2e685d', fontSize: 24 }}>clinical_notes</span>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: '#032f28', margin: 0 }}>
                  Clinical Response: {selectedClinicalRequest.request.requestNumber}
                </h3>
              </div>
              <button
                onClick={() => setSelectedClinicalRequest(null)}
                style={{ background: '#e6f8f1', border: 'none', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#414846' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            </div>

            <div style={{ background: '#f8faf9', padding: '1rem', borderRadius: 16, border: '1px solid #e0f2eb', marginBottom: '1.25rem' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#717976', display: 'block', marginBottom: '0.35rem' }}>
                Patient's Original Concern ({selectedClinicalRequest.request.language.toUpperCase()}):
              </span>
              <p style={{ fontSize: 13, color: '#032f28', margin: 0, fontStyle: 'italic', lineHeight: 1.5 }}>
                "{selectedClinicalRequest.request.originalText}"
              </p>
            </div>

            <form onSubmit={handleSubmitClinicalResponse} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Voice Input & Recording for Elderly Patients */}
              <div style={{ background: '#f0fdf7', padding: '1rem', borderRadius: 16, border: '1px solid #c1ebe1', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span className="material-symbols-outlined" style={{ color: '#2e685d', fontSize: 20 }}>mic</span>
                    <div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#032f28', display: 'block' }}>
                        Voice Response (Elder-Friendly Assistive Audio)
                      </span>
                      <span style={{ fontSize: 11, color: '#414846' }}>
                        Record your voice so elder patients who struggle reading text can listen aloud.
                      </span>
                    </div>
                  </div>

                  {!isRecordingVoice ? (
                    <button
                      type="button"
                      onClick={startVoiceRecording}
                      style={{
                        background: '#032f28',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: 99,
                        padding: '0.45rem 1rem',
                        fontSize: 12,
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        cursor: 'pointer'
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>mic</span>
                      <span>{voiceAudioPreviewUrl ? 'Re-record Voice' : 'Record Voice'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={stopVoiceRecording}
                      style={{
                        background: '#ba1a1a',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: 99,
                        padding: '0.45rem 1rem',
                        fontSize: 12,
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        cursor: 'pointer',
                        animation: 'pulse 1s infinite'
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>stop</span>
                      <span>Stop Recording ({Math.floor(voiceRecordingSeconds / 60)}:{(voiceRecordingSeconds % 60).toString().padStart(2, '0')})</span>
                    </button>
                  )}
                </div>

                {isRecordingVoice && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '0.6rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#991b1b', fontSize: 12, fontWeight: 600 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#dc2626', animation: 'ping 1s cubic-bezier(0, 0, 0.2, 1) infinite' }} />
                    <span>Listening & transcribing into response text in real-time...</span>
                  </div>
                )}

                {voiceAudioPreviewUrl && !isRecordingVoice && (
                  <div style={{ background: '#ffffff', padding: '0.75rem', borderRadius: 12, border: '1px solid #b0ecdd', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: 200 }}>
                      <audio controls src={voiceAudioPreviewUrl} style={{ width: '100%', height: 36 }} />
                    </div>
                    <button
                      type="button"
                      onClick={clearVoiceRecording}
                      style={{ background: '#fee2e2', color: '#b91c1c', border: 'none', borderRadius: 99, padding: '0.35rem 0.85rem', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>delete</span>
                      <span>Clear Audio</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Recommend Medication for Direct Reservation */}
              <div style={{ background: '#f8faf9', padding: '1rem', borderRadius: 16, border: '1px solid #e0f2eb', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#032f28' }}>
                    <input
                      type="checkbox"
                      checked={recommendMedEnabled}
                      onChange={e => setRecommendMedEnabled(e.target.checked)}
                      style={{ accentColor: '#2e685d', width: 16, height: 16, cursor: 'pointer' }}
                    />
                    <span>Attach & Recommend Medication for Direct Patient Reservation</span>
                  </label>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#2e685d', background: '#e0f2eb', padding: '0.15rem 0.5rem', borderRadius: 99 }}>
                    1-CLICK RESERVATION
                  </span>
                </div>

                {recommendMedEnabled && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingTop: '0.25rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#414846', marginBottom: '0.35rem' }}>
                        Select from Dispensary Inventory:
                      </label>
                      <select
                        value={selectedMedForRec?.medicineId || selectedMedForRec?.id || ''}
                        onChange={e => {
                          const medId = e.target.value;
                          const invItem = inventory.find(i => (i.medicineId === medId || i.id === medId));
                          if (invItem) {
                            setSelectedMedForRec({
                              medicineId: invItem.medicineId || invItem.id,
                              brandName: invItem.brandName || invItem.medicine?.brandName || invItem.name,
                              genericName: invItem.genericName || invItem.medicine?.genericName || '',
                              strength: invItem.strength || invItem.medicine?.strength || '',
                              dosageForm: invItem.dosageForm || invItem.medicine?.dosageForm || 'Tablet',
                              price: invItem.price || 15
                            });
                          } else {
                            setSelectedMedForRec(null);
                          }
                        }}
                        style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: 12, border: '1px solid #c0c8c5', fontSize: 12, color: '#032f28', background: '#ffffff' }}
                      >
                        <option value="">-- Choose medicine to recommend --</option>
                        {inventory.map(inv => {
                          const mName = inv.brandName || inv.medicine?.brandName || inv.name || 'Medicine';
                          const mStr = inv.strength || inv.medicine?.strength ? ` (${inv.strength || inv.medicine?.strength})` : '';
                          const stock = inv.stock != null ? inv.stock : 0;
                          return (
                            <option key={inv.id} value={inv.medicineId || inv.id}>
                              {mName}{mStr} • ₹{inv.price || 15} (Stock: {stock})
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    {selectedMedForRec && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: '0.75rem' }}>
                        <div>
                          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#414846', marginBottom: '0.35rem' }}>
                            Dosage & Intake Regimen:
                          </label>
                          <input
                            type="text"
                            value={recMedInstructions}
                            onChange={e => setRecMedInstructions(e.target.value)}
                            placeholder="Instructions"
                            style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: 10, border: '1px solid #c0c8c5', fontSize: 12, color: '#032f28', boxSizing: 'border-box' }}
                          />
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#414846', marginBottom: '0.35rem' }}>
                            Quantity:
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={recMedQty}
                            onChange={e => setRecMedQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                            style={{ width: '100%', padding: '0.55rem 0.75rem', borderRadius: 10, border: '1px solid #c0c8c5', fontSize: 12, color: '#032f28', boxSizing: 'border-box' }}
                          />
                        </div>
                      </div>
                    )}

                    {selectedMedForRec && (
                      <div style={{ background: '#e0f2eb', padding: '0.65rem 0.85rem', borderRadius: 10, fontSize: 11, color: '#032f28', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>check_circle</span>
                        <span>Patient will see: <strong>{selectedMedForRec.brandName}</strong> (₹{selectedMedForRec.price}) with an instant <strong>"Reserve It"</strong> button.</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#414846', marginBottom: '0.4rem' }}>
                  Professional Clinical Advice (Visible to Patient)
                </label>
                <textarea
                  rows={4}
                  value={clinicianResponseText}
                  onChange={e => setClinicianResponseText(e.target.value)}
                  placeholder="Guidance"
                  style={{ width: '100%', padding: '0.75rem', borderRadius: 14, border: '1px solid #c0c8c5', fontSize: 13, color: '#032f28', lineHeight: 1.5, boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#414846', marginBottom: '0.4rem' }}>
                  Internal Clinical Notes (Confidential — Not visible to patient)
                </label>
                <textarea
                  rows={2}
                  value={internalNotesText}
                  onChange={e => setInternalNotesText(e.target.value)}
                  placeholder="Notes"
                  style={{ width: '100%', padding: '0.75rem', borderRadius: 14, border: '1px solid #c0c8c5', fontSize: 12, color: '#414846', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ background: '#f0fdf7', padding: '0.85rem', borderRadius: 12, fontSize: 11, color: '#2e685d', lineHeight: 1.45 }}>
                <strong>Clinical Safeguard:</strong> Submissions are recorded under your professional ID. Do not diagnose conditions or prescribe Schedule H medicines without an in-person physical clinical examination.
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => setSelectedClinicalRequest(null)}
                  style={{ background: '#e6f8f1', color: '#414846', border: 'none', borderRadius: 99, padding: '0.6rem 1.25rem', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingResponse || !clinicianResponseText.trim()}
                  style={{
                    background: '#032f28',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 99,
                    padding: '0.6rem 1.5rem',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: (submittingResponse || !clinicianResponseText.trim()) ? 'not-allowed' : 'pointer',
                    opacity: (submittingResponse || !clinicianResponseText.trim()) ? 0.6 : 1
                  }}
                >
                  {submittingResponse ? 'Submitting...' : 'Submit Clinical Response'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Add Medicine Modal */}
      {showAddModal && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(3,47,40,0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ background: '#ffffff', borderRadius: 24, width: '100%', maxWidth: 480, padding: '2rem', boxShadow: '0 24px 64px rgba(3,47,40,0.25)', border: '1px solid #e0f2eb' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#032f28', margin: 0 }}>
                Add Medicine to Inventory
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                style={{ background: '#e6f8f1', border: 'none', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#414846' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            </div>

            {addError && (
              <div style={{ background: '#ffdad6', color: '#ba1a1a', padding: '0.65rem 1rem', borderRadius: 12, fontSize: 12, fontWeight: 600, marginBottom: '1rem' }}>
                {addError}
              </div>
            )}

            <form onSubmit={handleAddMedicineSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#414846', marginBottom: '0.35rem' }}>
                  Select Medicine from Catalogue
                </label>
                <select
                  value={selectedMedicineId}
                  onChange={e => setSelectedMedicineId(e.target.value)}
                  style={{ width: '100%', padding: '0.65rem', borderRadius: 12, border: '1px solid #c0c8c5', background: '#e6f8f1', fontSize: 13, color: '#032f28' }}
                >
                  {availableMedicines.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.brandName} ({m.genericName || m.category})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#414846', marginBottom: '0.35rem' }}>
                    Initial Stock
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={newStock}
                    onChange={e => setNewStock(e.target.value)}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: 12, border: '1px solid #c0c8c5', fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#414846', marginBottom: '0.35rem' }}>
                    Unit Price (₹)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min={0}
                    value={newPrice}
                    onChange={e => setNewPrice(e.target.value)}
                    style={{ width: '100%', padding: '0.65rem', borderRadius: 12, border: '1px solid #c0c8c5', fontSize: 13 }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  style={{ background: '#e6f8f1', color: '#414846', border: 'none', borderRadius: 99, padding: '0.55rem 1.25rem', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addLoading}
                  style={{ background: '#032f28', color: '#ffffff', border: 'none', borderRadius: 99, padding: '0.55rem 1.5rem', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  {addLoading ? 'Adding...' : 'Add to Inventory'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
      </>
      )}

      {/* Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        impactPoints={confirmDialog.impactPoints || []}
        confirmLabel={confirmDialog.confirmLabel}
        variant={confirmDialog.variant}
        loading={updatingStatusId !== null}
        disabled={updatingStatusId !== null}
        onConfirm={() => {
          confirmDialog.onConfirm();
          setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        }}
        onCancel={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
      />

      {/* Lifecycle Action Feedback Popup Dialog */}
      {renderLifecycleActionModal()}

      {/* Prescription Clarification Modal */}
      <PrescriptionClarificationModal
        order={clarificationOrder}
        isOpen={Boolean(clarificationOrder)}
        onClose={() => setClarificationOrder(null)}
        onClarificationUpdated={() => fetchPharmacyAndOrders(true)}
      />

      {/* Clinical Prescription Review & Verification Modal (Gate 2B) */}
      <ClinicalPrescriptionReviewModal
        order={clinicalReviewOrder}
        isOpen={Boolean(clinicalReviewOrder)}
        onClose={() => setClinicalReviewOrder(null)}
        onVerified={() => fetchPharmacyAndOrders(true)}
        onOpenClarification={(ord) => {
          setClinicalReviewOrder(null);
          setClarificationOrder(ord);
        }}
      />
    </div>
  );
}
