import React, { useState, useEffect, useCallback } from 'react';
import { broadcastUpdate, subscribeToUpdates } from '../utils/realtimeUpdates';

export default function PatientClarificationCard({
  orderId,
  pharmacyName = 'Dispensing Pharmacy',
  onClarificationSubmitted
}) {
  const [clarifications, setClarifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [responseText, setResponseText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState('');

  const fetchClarifications = useCallback(async () => {
    if (!orderId) return;
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch(`/api/orders/${orderId}/clarifications`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.clarifications)) {
        setClarifications(data.clarifications);
      }
    } catch (err) {
      console.error('Patient fetchClarifications error:', err);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    fetchClarifications();
  }, [fetchClarifications]);

  // Subscribe to realtime events for immediate response / resolution updates
  useEffect(() => {
    const unsubscribe = subscribeToUpdates((event) => {
      if (event?.type === 'CLARIFICATION_UPDATED' && event?.payload?.orderId === orderId) {
        fetchClarifications();
      }
    });
    return () => unsubscribe();
  }, [orderId, fetchClarifications]);

  if (loading || clarifications.length === 0) {
    return null;
  }

  // Find latest active clarification (PENDING or RESPONDED), or latest RESOLVED
  const pendingClarif = clarifications.find(c => c.status === 'PENDING');
  const respondedClarif = clarifications.find(c => c.status === 'RESPONDED');
  const resolvedClarifs = clarifications.filter(c => c.status === 'RESOLVED');

  const activeClarif = pendingClarif || respondedClarif;

  async function handleSubmitResponse(e) {
    e.preventDefault();
    if (!pendingClarif) return;

    const trimmed = responseText.trim();
    if (trimmed.length < 2) {
      setSubmitError('Response must be at least 2 characters long.');
      return;
    }
    if (trimmed.length > 2000) {
      setSubmitError('Response cannot exceed 2000 characters.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError('');
    setSubmitSuccess('');
    const token = localStorage.getItem('medifind_token');

    try {
      const res = await fetch(`/api/orders/${orderId}/clarifications/${pendingClarif.id}/respond`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ response: trimmed })
      });
      const data = await res.json();

      if (data.success && data.clarification) {
        setResponseText('');
        setSubmitSuccess('Response successfully submitted to the pharmacy.');
        setClarifications(prev =>
          prev.map(c => (c.id === pendingClarif.id ? { ...c, ...data.clarification, status: 'RESPONDED' } : c))
        );
        broadcastUpdate('CLARIFICATION_UPDATED', { orderId });
        if (onClarificationSubmitted) onClarificationSubmitted(orderId);
      } else {
        setSubmitError(data.error || 'Failed to submit response.');
      }
    } catch (err) {
      console.error('handleSubmitResponse error:', err);
      setSubmitError('Network error submitting response. Please retry.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div style={{ marginBottom: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* 1. Pending Clarification (Action Required by Patient) */}
      {pendingClarif && (
        <section
          style={{
            background: '#ffffff',
            borderRadius: 24,
            padding: '1.75rem',
            boxShadow: '0 8px 30px rgba(126, 18, 8, 0.12)',
            border: '2px solid #ffb4a8',
            position: 'relative',
            overflow: 'hidden'
          }}
        >
          {/* Top Amber Accent Bar */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 5, background: 'linear-gradient(90deg, #ba1a1a 0%, #ff897d 100%)' }}></div>

          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: '#ffdad4',
                  color: '#5a0100',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 22 }}>
                  contact_support
                </span>
              </div>
              <div>
                <span
                  style={{
                    display: 'inline-block',
                    background: '#ffdad4',
                    color: '#5a0100',
                    fontSize: 10,
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    padding: '0.2rem 0.6rem',
                    borderRadius: 99,
                    marginBottom: '0.25rem'
                  }}
                >
                  Action Required
                </span>
                <h3 style={{ fontSize: 18, fontWeight: 800, color: '#032f28', margin: 0 }}>
                  Question from Pharmacist
                </h3>
              </div>
            </div>

            <div style={{ fontSize: 11, color: '#717976', textAlign: 'right' }}>
              <span>From: <strong>{pharmacyName}</strong></span>
              <span style={{ display: 'block', color: '#9ca3af' }}>{new Date(pendingClarif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>

          <p style={{ fontSize: 13, color: '#414846', margin: '0 0 1rem 0', lineHeight: 1.5 }}>
            The licensed pharmacist reviewing your prescription has requested clarification prior to dispensing:
          </p>

          {/* Question Quote Container */}
          <div
            style={{
              background: '#fbf4f3',
              borderRadius: 16,
              padding: '1rem 1.25rem',
              border: '1.5px solid #ffdad4',
              marginBottom: '1.25rem'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#ba1a1a', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', marginBottom: '0.35rem' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>help</span>
              Pharmacist Inquiry:
            </div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#032f28', lineHeight: 1.55 }}>
              "{pendingClarif.question}"
            </p>
          </div>

          {/* Response Form */}
          <form onSubmit={handleSubmitResponse} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#032f28', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>reply</span>
                Your Response:
              </label>
              <span style={{ fontSize: 10, fontWeight: 600, color: responseText.trim().length > 2000 ? '#ba1a1a' : '#717976' }}>
                {responseText.trim().length} / 2000 chars (min 2)
              </span>
            </div>

            <textarea
              value={responseText}
              onChange={e => {
                setResponseText(e.target.value);
                setSubmitError('');
              }}
              rows={3}
              placeholder="Provide requested details (e.g., confirming dosage, previous usage, or doctor's instructions)..."
              disabled={isSubmitting}
              style={{
                width: '100%',
                padding: '0.85rem',
                borderRadius: 14,
                border: submitError ? '1.5px solid #ba1a1a' : '1px solid #c0c8c5',
                background: '#ffffff',
                fontSize: 13,
                color: '#032f28',
                resize: 'vertical',
                fontFamily: 'inherit',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />

            {submitError && (
              <div style={{ fontSize: 12, color: '#ba1a1a', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>error</span>
                <span>{submitError}</span>
              </div>
            )}

            {submitSuccess && (
              <div style={{ fontSize: 12, color: '#2e685d', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check_circle</span>
                <span>{submitSuccess}</span>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', paddingTop: '0.25rem' }}>
              <span style={{ fontSize: 11, color: '#717976', maxWidth: 400, lineHeight: 1.4 }}>
                Your reply helps ensure patient safety and correct prescription fulfillment.
              </span>

              <button
                type="submit"
                disabled={isSubmitting || responseText.trim().length < 2 || responseText.trim().length > 2000}
                style={{
                  background:
                    responseText.trim().length >= 2 && responseText.trim().length <= 2000 && !isSubmitting
                      ? '#032f28'
                      : '#c0c8c5',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 99,
                  padding: '0.65rem 1.5rem',
                  fontSize: 13,
                  fontWeight: 800,
                  cursor:
                    responseText.trim().length >= 2 && responseText.trim().length <= 2000 && !isSubmitting
                      ? 'pointer'
                      : 'not-allowed',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  boxShadow:
                    responseText.trim().length >= 2 && !isSubmitting
                      ? '0 4px 14px rgba(3,47,40,0.2)'
                      : 'none',
                  transition: 'all 0.2s'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 17 }}>
                  {isSubmitting ? 'sync' : 'send'}
                </span>
                <span>{isSubmitting ? 'Submitting...' : 'Submit Response to Pharmacist'}</span>
              </button>
            </div>
          </form>
        </section>
      )}

      {/* 2. Responded Clarification (Under Pharmacist Review) */}
      {!pendingClarif && respondedClarif && (
        <section
          style={{
            background: '#ffffff',
            borderRadius: 24,
            padding: '1.5rem 1.75rem',
            boxShadow: '0 4px 20px rgba(3,47,40,0.06)',
            border: '1px solid #b0ecdd'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.85rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="material-symbols-outlined" style={{ color: '#2e685d', fontSize: 20 }}>
                mark_email_read
              </span>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: '#032f28', margin: 0 }}>
                Prescription Clarification Sent
              </h3>
            </div>
            <span
              style={{
                background: '#b0ecdd',
                color: '#00201b',
                padding: '0.2rem 0.65rem',
                borderRadius: 99,
                fontSize: 11,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem'
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>hourglass_top</span>
              Under Pharmacist Review
            </span>
          </div>

          <div style={{ background: '#f5faf8', borderRadius: 16, padding: '1rem', border: '1px solid #e0f2eb', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            <div>
              <span style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 700, color: '#717976', display: 'block', marginBottom: '0.2rem' }}>
                Question from Pharmacist:
              </span>
              <p style={{ margin: 0, fontSize: 13, color: '#414846', fontStyle: 'italic' }}>
                "{respondedClarif.question}"
              </p>
            </div>

            <div style={{ borderTop: '1px solid #e0f2eb', paddingTop: '0.65rem' }}>
              <span style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 700, color: '#2e685d', display: 'block', marginBottom: '0.2rem' }}>
                Your Reply:
              </span>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#032f28' }}>
                {respondedClarif.response}
              </p>
            </div>
          </div>

          <p style={{ fontSize: 11, color: '#717976', margin: '0.75rem 0 0 0' }}>
            Your response was recorded. The pharmacist has been notified and will proceed with order staging.
          </p>
        </section>
      )}

      {/* 3. Resolved Clarifications History (Collapsed or Compact) */}
      {!activeClarif && resolvedClarifs.length > 0 && (
        <section
          style={{
            background: '#ffffff',
            borderRadius: 20,
            padding: '1.25rem 1.5rem',
            boxShadow: '0 2px 8px rgba(3,47,40,0.04)',
            border: '1px solid #e0f2eb'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span className="material-symbols-outlined" style={{ color: '#2e685d', fontSize: 18 }}>task_alt</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#032f28' }}>
                Prescription Clarification Completed ({resolvedClarifs.length})
              </span>
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, background: '#e0f2eb', color: '#2e685d', padding: '0.15rem 0.5rem', borderRadius: 99 }}>
              Resolved
            </span>
          </div>

          {resolvedClarifs.map((rc, idx) => (
            <div key={rc.id || idx} style={{ marginTop: '0.5rem', background: '#f8faf9', borderRadius: 12, padding: '0.75rem', border: '1px solid #e6f8f1', fontSize: 12 }}>
              <div style={{ color: '#414846' }}>
                <strong>Q:</strong> {rc.question}
              </div>
              {rc.response && (
                <div style={{ color: '#032f28', fontWeight: 600, marginTop: '0.25rem' }}>
                  <strong>A:</strong> {rc.response}
                </div>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
