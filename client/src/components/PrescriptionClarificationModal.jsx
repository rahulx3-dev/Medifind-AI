import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { broadcastUpdate } from '../utils/realtimeUpdates';

export default function PrescriptionClarificationModal({
  order,
  isOpen,
  onClose,
  onClarificationUpdated
}) {
  const [clarifications, setClarifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Question form state
  const [questionText, setQuestionText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Resolving state
  const [resolvingId, setResolvingId] = useState(null);

  useEffect(() => {
    if (isOpen && order?.id) {
      fetchClarifications();
      setQuestionText('');
      setFormError('');
      setSuccessMsg('');
    }
  }, [isOpen, order?.id]);

  async function fetchClarifications() {
    setLoading(true);
    setError('');
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch(`/api/orders/${order.id}/clarifications`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.clarifications)) {
        setClarifications(data.clarifications);
      } else {
        setError(data.error || 'Failed to load clarifications.');
      }
    } catch (err) {
      console.error('fetchClarifications error:', err);
      setError('Network error loading clarification history.');
    } finally {
      setLoading(false);
    }
  }

  const activeClarification = clarifications.find(
    c => c.status === 'PENDING' || c.status === 'RESPONDED'
  );

  async function handleCreateQuestion(e) {
    e.preventDefault();
    const trimmed = questionText.trim();
    if (trimmed.length < 5) {
      setFormError('Question must be at least 5 characters long.');
      return;
    }
    if (trimmed.length > 1000) {
      setFormError('Question cannot exceed 1000 characters.');
      return;
    }

    setIsSubmitting(true);
    setFormError('');
    setSuccessMsg('');
    const token = localStorage.getItem('medifind_token');

    try {
      const res = await fetch(`/api/orders/${order.id}/clarifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ question: trimmed })
      });
      const data = await res.json();

      if (data.success && data.clarification) {
        setQuestionText('');
        setSuccessMsg('Clarification question sent to patient.');
        setClarifications(prev => [...prev, data.clarification]);
        broadcastUpdate('CLARIFICATION_UPDATED', { orderId: order.id });
        if (onClarificationUpdated) onClarificationUpdated(order.id);
      } else {
        setFormError(data.error || 'Failed to submit clarification question.');
      }
    } catch (err) {
      console.error('handleCreateQuestion error:', err);
      setFormError('Network error submitting clarification question.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResolve(clarificationId) {
    if (resolvingId) return;
    setResolvingId(clarificationId);
    setError('');
    setSuccessMsg('');
    const token = localStorage.getItem('medifind_token');

    try {
      const res = await fetch(`/api/orders/${order.id}/clarifications/${clarificationId}/resolve`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      });
      const data = await res.json();

      if (data.success && data.clarification) {
        setSuccessMsg('Clarification marked as resolved.');
        setClarifications(prev =>
          prev.map(c => (c.id === clarificationId ? { ...c, ...data.clarification, status: 'RESOLVED' } : c))
        );
        broadcastUpdate('CLARIFICATION_UPDATED', { orderId: order.id });
        if (onClarificationUpdated) onClarificationUpdated(order.id);
      } else {
        setError(data.error || 'Failed to resolve clarification.');
      }
    } catch (err) {
      console.error('handleResolve error:', err);
      setError('Network error resolving clarification.');
    } finally {
      setResolvingId(null);
    }
  }

  if (!isOpen || !order) return null;

  const modalEl = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(3, 47, 40, 0.65)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.25rem'
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: 24,
          maxWidth: 640,
          width: '100%',
          overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(3, 47, 40, 0.35)',
          border: '2px solid #b0ecdd',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '88vh'
        }}
      >
        {/* Header */}
        <div
          style={{
            background: 'linear-gradient(135deg, #032f28 0%, #1e453e 100%)',
            padding: '1.25rem 1.5rem',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexShrink: 0
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: '#c1ebe1',
                color: '#032f28',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 24 }}>
                contact_support
              </span>
            </div>
            <div>
              <span
                style={{
                  display: 'inline-block',
                  background: 'rgba(193, 235, 225, 0.2)',
                  color: '#c1ebe1',
                  fontSize: 10,
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  padding: '0.15rem 0.5rem',
                  borderRadius: 99,
                  marginBottom: '0.2rem'
                }}
              >
                Clinical Communication
              </span>
              <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: '#ffffff' }}>
                Prescription Clarification
              </h3>
            </div>
          </div>

          <button
            onClick={onClose}
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
              cursor: 'pointer'
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
          </button>
        </div>

        {/* Order Context Strip */}
        <div
          style={{
            background: '#e6f8f1',
            padding: '0.75rem 1.5rem',
            borderBottom: '1px solid #d5e6e0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.5rem',
            fontSize: 12,
            color: '#414846',
            flexShrink: 0
          }}
        >
          <div>
            <strong>Order:</strong> #{order.orderNumber || order.id?.slice(0, 10).toUpperCase()}
          </div>
          <div>
            <strong>Patient:</strong> {order.user?.name || 'Verified Patient'}
          </div>
          <div>
            <span
              style={{
                background: '#b0ecdd',
                color: '#032f28',
                padding: '0.15rem 0.5rem',
                borderRadius: 99,
                fontWeight: 700,
                fontSize: 10
              }}
            >
              {order.status}
            </span>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            flex: 1
          }}
        >
          {/* Feedback Alerts */}
          {error && (
            <div
              style={{
                background: '#ffdad6',
                color: '#93000a',
                padding: '0.65rem 0.85rem',
                borderRadius: 12,
                fontSize: 12,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem'
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>error</span>
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div
              style={{
                background: '#e0f2eb',
                color: '#032f28',
                padding: '0.65rem 0.85rem',
                borderRadius: 12,
                fontSize: 12,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem'
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check_circle</span>
              <span>{successMsg}</span>
            </div>
          )}

          {/* Clarification History */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: '#2e685d',
                textTransform: 'uppercase',
                letterSpacing: '0.04em'
              }}
            >
              Clarification Inquiries ({clarifications.length})
            </span>

            {loading ? (
              <div style={{ padding: '1.5rem', textAlign: 'center', color: '#717976', fontSize: 13 }}>
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 24, animation: 'spin 1s linear infinite', display: 'block', margin: '0 auto 0.5rem auto' }}
                >
                  sync
                </span>
                Loading inquiries...
              </div>
            ) : clarifications.length === 0 ? (
              <div
                style={{
                  background: '#f8faf9',
                  border: '1px dashed #c0c8c5',
                  borderRadius: 14,
                  padding: '1.25rem',
                  textAlign: 'center',
                  color: '#717976',
                  fontSize: 13
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 28, color: '#2e685d', display: 'block', margin: '0 auto 0.25rem auto' }}>
                  forum
                </span>
                No clarification inquiries on this order yet.
                <p style={{ margin: '0.25rem 0 0 0', fontSize: 11, color: '#a0aaa7' }}>
                  If you need to verify medication instructions, allergies, or dosage with the patient, submit a question below.
                </p>
              </div>
            ) : (
              clarifications.map((item, idx) => {
                const isPending = item.status === 'PENDING';
                const isResponded = item.status === 'RESPONDED';
                const isResolved = item.status === 'RESOLVED';

                return (
                  <div
                    key={item.id || idx}
                    style={{
                      background: isResolved ? '#fafcfb' : '#f0fdf8',
                      borderRadius: 16,
                      border: isPending
                        ? '1.5px solid #ffb4a8'
                        : isResponded
                        ? '1.5px solid #2e685d'
                        : '1px solid #e0f2eb',
                      padding: '1rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.65rem',
                      position: 'relative'
                    }}
                  >
                    {/* Status Strip */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          textTransform: 'uppercase',
                          padding: '0.2rem 0.55rem',
                          borderRadius: 99,
                          background: isPending
                            ? '#ffdad4'
                            : isResponded
                            ? '#b0ecdd'
                            : '#e0f2eb',
                          color: isPending
                            ? '#5a0100'
                            : isResponded
                            ? '#032f28'
                            : '#2e685d'
                        }}
                      >
                        {isPending
                          ? 'Awaiting Patient Response'
                          : isResponded
                          ? 'Patient Responded'
                          : 'Inquiry Resolved'}
                      </span>
                      <span style={{ fontSize: 11, color: '#717976' }}>
                        {new Date(item.createdAt).toLocaleString()}
                      </span>
                    </div>

                    {/* Question Box */}
                    <div
                      style={{
                        background: '#ffffff',
                        borderRadius: 12,
                        padding: '0.75rem 0.85rem',
                        border: '1px solid #e2ece7'
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#2e685d', marginBottom: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>help</span>
                        Pharmacist Question:
                      </div>
                      <p style={{ margin: 0, fontSize: 13, color: '#032f28', lineHeight: 1.45 }}>
                        {item.question}
                      </p>
                    </div>

                    {/* Patient Response Box */}
                    {item.response ? (
                      <div
                        style={{
                          background: '#e6f8f1',
                          borderRadius: 12,
                          padding: '0.75rem 0.85rem',
                          border: '1px solid #c1ebe1'
                        }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#032f28', marginBottom: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#2e685d' }}>reply</span>
                          Patient Response:
                        </div>
                        <p style={{ margin: 0, fontSize: 13, color: '#032f28', lineHeight: 1.45, fontWeight: 600 }}>
                          {item.response}
                        </p>
                        <span style={{ display: 'block', fontSize: 10, color: '#717976', marginTop: '0.35rem' }}>
                          Received: {new Date(item.updatedAt || item.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                    ) : isPending ? (
                      <div style={{ fontSize: 12, color: '#717976', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#ba1a1a' }}>pending</span>
                        Notification sent to patient. Waiting for response...
                      </div>
                    ) : null}

                    {/* Resolution Action */}
                    {!isResolved && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '0.25rem' }}>
                        <button
                          onClick={() => handleResolve(item.id)}
                          disabled={resolvingId === item.id}
                          style={{
                            background: '#032f28',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: 99,
                            padding: '0.35rem 0.85rem',
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: resolvingId === item.id ? 'not-allowed' : 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                            opacity: resolvingId === item.id ? 0.7 : 1
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                            {resolvingId === item.id ? 'sync' : 'check_circle'}
                          </span>
                          <span>{resolvingId === item.id ? 'Resolving...' : 'Mark Inquiry Resolved'}</span>
                        </button>
                      </div>
                    )}

                    {isResolved && item.resolvedAt && (
                      <div style={{ fontSize: 10, color: '#2e685d', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>task_alt</span>
                        Resolved on {new Date(item.resolvedAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Active Question Block or New Question Form */}
          {activeClarification ? (
            <div
              style={{
                background: '#f4faf7',
                borderRadius: 16,
                padding: '0.85rem 1rem',
                border: '1px solid #e0f2eb',
                fontSize: 12,
                color: '#414846',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              <span className="material-symbols-outlined" style={{ color: '#2e685d', fontSize: 18 }}>
                info
              </span>
              <span>
                An active inquiry is currently in progress. Please review the patient's reply or resolve it before initiating another question.
              </span>
            </div>
          ) : (
            <form
              onSubmit={handleCreateQuestion}
              style={{
                background: '#f9fcfb',
                borderRadius: 18,
                padding: '1.25rem',
                border: '1px solid #c0c8c5',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.65rem'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#032f28', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>
                    edit_note
                  </span>
                  Ask Patient a Clarification Question
                </label>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: questionText.trim().length > 1000 ? '#ba1a1a' : '#717976'
                  }}
                >
                  {questionText.trim().length} / 1000 chars (min 5)
                </span>
              </div>

              <textarea
                value={questionText}
                onChange={e => {
                  setQuestionText(e.target.value);
                  setFormError('');
                }}
                rows={3}
                placeholder="Specify what needs clarification (e.g. confirming physician dosage instructions, allergy history, or previous medication tolerance)..."
                disabled={isSubmitting}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: 12,
                  border: formError ? '1.5px solid #ba1a1a' : '1px solid #c0c8c5',
                  background: '#ffffff',
                  fontSize: 13,
                  color: '#032f28',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />

              {formError && (
                <div style={{ fontSize: 11, color: '#ba1a1a', fontWeight: 600 }}>
                  {formError}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', paddingTop: '0.25rem' }}>
                <span style={{ fontSize: 10, color: '#717976', maxWidth: 360, lineHeight: 1.3 }}>
                  Questions notify the patient directly. Note: Delivery assistants do not have access to clarification content.
                </span>

                <button
                  type="submit"
                  disabled={isSubmitting || questionText.trim().length < 5 || questionText.trim().length > 1000}
                  style={{
                    background:
                      questionText.trim().length >= 5 && questionText.trim().length <= 1000 && !isSubmitting
                        ? '#032f28'
                        : '#c0c8c5',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 99,
                    padding: '0.55rem 1.25rem',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor:
                      questionText.trim().length >= 5 && questionText.trim().length <= 1000 && !isSubmitting
                        ? 'pointer'
                        : 'not-allowed',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    boxShadow:
                      questionText.trim().length >= 5 && !isSubmitting
                        ? '0 2px 8px rgba(3,47,40,0.2)'
                        : 'none'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                    {isSubmitting ? 'sync' : 'send'}
                  </span>
                  <span>{isSubmitting ? 'Submitting...' : 'Send to Patient'}</span>
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '0.85rem 1.5rem',
            borderTop: '1px solid #e0f2eb',
            background: '#fafdfb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 11,
            color: '#717976',
            flexShrink: 0
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#2e685d' }}>verified_user</span>
            Clinical Audit Logged
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              color: '#032f28',
              border: '1px solid #c0c8c5',
              borderRadius: 99,
              padding: '0.35rem 0.85rem',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? ReactDOM.createPortal(modalEl, document.body) : modalEl;
}
