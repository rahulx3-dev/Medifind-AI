import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { broadcastUpdate } from '../utils/realtimeUpdates';
import AuthenticatedPrescriptionImage from './AuthenticatedPrescriptionImage';
import { findMatchingBrands } from '../utils/genericMedicineMatcher';

export default function ClinicalPrescriptionReviewModal({
  order,
  isOpen,
  onClose,
  onOpenClarification,
  onPrescriptionVerified
}) {
  const [prescription, setPrescription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [selectedImageId, setSelectedImageId] = useState(null);
  const [isComparingOriginal, setIsComparingOriginal] = useState(false);
  const [isZoomModalOpen, setIsZoomModalOpen] = useState(false);

  // Pharmacist editing state
  const [editingItemId, setEditingItemId] = useState(null);
  const [editFormData, setEditFormData] = useState({});
  const [catalog, setCatalog] = useState([]);

  // Reject state
  const [rejectingItemId, setRejectingItemId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [isActionSubmitting, setIsActionSubmitting] = useState(false);

  const rxId = order?.prescriptionId || order?.prescription?.id;

  useEffect(() => {
    if (isOpen && rxId) {
      fetchPrescriptionDetails();
      fetchCatalog();
      setEditingItemId(null);
      setRejectingItemId(null);
      setSuccessMsg('');
      setError('');
    }
  }, [isOpen, rxId]);

  async function fetchCatalog() {
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch('/api/medicines/search', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.medicines)) {
        setCatalog(data.medicines);
      }
    } catch (_) {}
  }

  async function fetchPrescriptionDetails() {
    setLoading(true);
    setError('');
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch(`/api/prescriptions/${rxId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && data.prescription) {
        setPrescription(data.prescription);
        setSelectedImageId(data.prescription.activeImageId || (data.prescription.images?.[0]?.id));
      } else {
        setError(data.error || 'Failed to load prescription review details.');
      }
    } catch (err) {
      console.error('fetchPrescriptionDetails error:', err);
      setError('Network error fetching prescription clinical review.');
    } finally {
      setLoading(false);
    }
  }

  // Handle single item verification
  async function handleVerifyItem(item, overrideData = null) {
    setIsActionSubmitting(true);
    setError('');
    setSuccessMsg('');
    const token = localStorage.getItem('medifind_token');

    const payload = {
      medicineId: overrideData?.medicineId || item.medicineId || item.matchedMedicineId,
      prescribedName: overrideData?.prescribedName || item.prescribedName || item.matchedMedicineName || item.rawName,
      dosage: overrideData?.dosage !== undefined ? overrideData.dosage : (item.dosage || ''),
      frequency: overrideData?.frequency || item.frequency || '',
      duration: overrideData?.duration || item.duration || '',
      quantity: Number(overrideData?.quantity || item.quantity || 1),
      instructions: overrideData?.instructions || item.instructions || '',
      clinicalNotes: overrideData?.clinicalNotes || 'Verified by attending pharmacist against physical prescription slip.'
    };

    try {
      const res = await fetch(`/api/prescriptions/${rxId}/items/${item.id}/pharmacist-verify`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg(`✓ Item "${payload.prescribedName}" clinically verified.`);
        setEditingItemId(null);
        await fetchPrescriptionDetails();
        if (onPrescriptionVerified) onPrescriptionVerified();
        broadcastUpdate('PRESCRIPTION_VERIFIED', { prescriptionId: rxId, orderId: order.id });
      } else {
        setError(data.error || 'Failed to verify prescription item.');
      }
    } catch (err) {
      setError('Network error verifying prescription item.');
    } finally {
      setIsActionSubmitting(false);
    }
  }

  // Handle candidate rejection
  async function handleRejectItem(itemId) {
    if (!rejectReason.trim() || rejectReason.trim().length < 3) {
      setError('Please provide a clinical rejection reason (minimum 3 characters).');
      return;
    }
    setIsActionSubmitting(true);
    setError('');
    setSuccessMsg('');
    const token = localStorage.getItem('medifind_token');

    try {
      const res = await fetch(`/api/prescriptions/${rxId}/items/${itemId}/reject`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ reason: rejectReason.trim() })
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg('Candidate rejected. Audit trail and raw OCR history preserved.');
        setRejectingItemId(null);
        setRejectReason('');
        await fetchPrescriptionDetails();
        if (onPrescriptionVerified) onPrescriptionVerified();
      } else {
        setError(data.error || 'Failed to reject prescription item.');
      }
    } catch (err) {
      setError('Network error rejecting item.');
    } finally {
      setIsActionSubmitting(false);
    }
  }

  // Batch verify all items
  async function handleVerifyAll() {
    const items = prescription?.items || [];
    if (items.length === 0) {
      setError('No items to verify for this prescription.');
      return;
    }
    setIsActionSubmitting(true);
    setError('');
    setSuccessMsg('');
    const token = localStorage.getItem('medifind_token');

    const formattedItems = items.map(it => ({
      id: it.id,
      medicineId: it.medicineId || it.matchedMedicineId,
      prescribedName: it.prescribedName || it.matchedMedicineName || it.rawName,
      dosage: it.dosage || '',
      frequency: it.frequency || '',
      duration: it.duration || '',
      quantity: Number(it.quantity || 1),
      instructions: it.instructions || '',
      sourceCandidateId: it.sourceCandidateId,
      sourceType: it.sourceType
    }));

    try {
      const res = await fetch(`/api/prescriptions/${rxId}/pharmacist-verify`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          items: formattedItems,
          clinicalNotes: 'All items reviewed and verified by licensed dispensary pharmacist.'
        })
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg('✓ All prescription items verified successfully by pharmacist.');
        await fetchPrescriptionDetails();
        if (onPrescriptionVerified) onPrescriptionVerified();
        broadcastUpdate('PRESCRIPTION_VERIFIED', { prescriptionId: rxId, orderId: order.id });
      } else {
        setError(data.error || 'Failed to complete batch verification.');
      }
    } catch (err) {
      setError('Network error completing batch verification.');
    } finally {
      setIsActionSubmitting(false);
    }
  }

  if (!isOpen) return null;

  const images = prescription?.images || [];
  const currentImage = images.find(img => img.id === selectedImageId) || images[0];
  const items = prescription?.items || [];
  const ocrRuns = prescription?.ocrRuns || [];
  const latestOcrRun = ocrRuns[0];

  const modalEl = (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(3,47,40,0.55)',
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
      padding: '1.25rem'
    }}>
      <div style={{
        background: '#ffffff',
        borderRadius: 24,
        width: '100%',
        maxWidth: 1200,
        maxHeight: '92vh',
        overflowY: 'auto',
        boxShadow: '0 12px 48px rgba(3,47,40,0.18)',
        border: '1px solid #e0f2eb',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Top Header */}
        <div style={{
          padding: '1.25rem 1.75rem',
          borderBottom: '1px solid #e0f2eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
          background: '#f8fdfb',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
              <span className="material-symbols-outlined" style={{ color: '#2e685d', fontSize: 24 }}>verified</span>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: '#032f28', margin: 0 }}>
                Clinical Prescription Verification
              </h2>
              <span style={{
                background: prescription?.status === 'VERIFIED' ? '#b0ecdd' : '#ffdad4',
                color: prescription?.status === 'VERIFIED' ? '#032f28' : '#7e1208',
                padding: '0.2rem 0.65rem',
                borderRadius: 99,
                fontSize: 11,
                fontWeight: 700
              }}>
                {prescription?.status || 'VERIFICATION_REQUIRED'}
              </span>
              {prescription?.screeningStatus && (
                <span style={{
                  background: '#e0f2eb',
                  color: '#2e685d',
                  padding: '0.2rem 0.65rem',
                  borderRadius: 99,
                  fontSize: 11,
                  fontWeight: 600
                }}>
                  Screening: {prescription.screeningStatus}
                </span>
              )}
            </div>
            <p style={{ fontSize: 12, color: '#717976', margin: 0 }}>
              Order #{order?.orderNumber || order?.id?.slice(0, 10).toUpperCase()} • Patient: <strong>{order?.user?.name || 'Verified Patient'}</strong> • Ref: RX-{rxId?.slice(0, 8).toUpperCase()}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              onClick={() => onOpenClarification && onOpenClarification(order)}
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
              title="Open clarification inquiry with patient if text or dosage is uncertain"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>contact_support</span>
              <span>Ask Clarification</span>
            </button>
            <button
              onClick={onClose}
              style={{
                background: '#e6f8f1',
                border: 'none',
                borderRadius: '50%',
                width: 34,
                height: 34,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#032f28',
                cursor: 'pointer'
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
            </button>
          </div>
        </div>

        {/* Feedback alerts */}
        {error && (
          <div style={{ margin: '1rem 1.75rem 0', padding: '0.75rem 1rem', background: '#ffdad6', color: '#ba1a1a', borderRadius: 14, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>error</span>
            <span>{error}</span>
          </div>
        )}
        {successMsg && (
          <div style={{ margin: '1rem 1.75rem 0', padding: '0.75rem 1rem', background: '#e0f2eb', color: '#032f28', borderRadius: 14, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#2e685d' }}>check_circle</span>
            <span>{successMsg}</span>
          </div>
        )}

        {/* Modal Body */}
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#717976' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 36, animation: 'spin 1s linear infinite' }}>progress_activity</span>
            <div style={{ fontSize: 13, marginTop: '0.5rem', fontWeight: 600 }}>Loading prescription lineage &amp; candidate records...</div>
          </div>
        ) : (
          <div style={{ padding: '1.5rem 1.75rem', display: 'grid', gridTemplateColumns: 'minmax(320px, 4.5fr) minmax(400px, 7.5fr)', gap: '1.5rem', alignItems: 'start' }}>
            {/* LEFT COLUMN: Image Versioning & Evidence Viewer */}
            <div style={{ background: '#f8faf9', borderRadius: 20, padding: '1.25rem', border: '1px solid #e0f2eb', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span className="material-symbols-outlined" style={{ color: '#2e685d', fontSize: 18 }}>layers</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#032f28' }}>
                    Image Lineage ({images.length || 1})
                  </span>
                </div>
                {images.length > 1 && (
                  <button
                    onClick={() => setIsComparingOriginal(!isComparingOriginal)}
                    style={{
                      background: isComparingOriginal ? '#032f28' : '#e6f8f1',
                      color: isComparingOriginal ? '#ffffff' : '#032f28',
                      border: '1px solid #c0c8c5',
                      padding: '0.25rem 0.75rem',
                      borderRadius: 99,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    {isComparingOriginal ? 'Exit Compare' : 'Compare v1'}
                  </button>
                )}
              </div>

              {/* Version Selector Pills */}
              <div style={{ display: 'flex', gap: '0.4rem', overflowX: 'auto', paddingBottom: '0.25rem' }}>
                {images.map(img => {
                  const isSelected = selectedImageId === img.id;
                  return (
                    <button
                      key={img.id}
                      onClick={() => setSelectedImageId(img.id)}
                      style={{
                        background: isSelected ? '#032f28' : '#ffffff',
                        color: isSelected ? '#ffffff' : '#414846',
                        border: isSelected ? '1px solid #032f28' : '1px solid #c0c8c5',
                        borderRadius: 12,
                        padding: '0.35rem 0.75rem',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      <span>v{img.versionNumber}</span>
                      <span style={{ fontSize: 9, opacity: 0.8, textTransform: 'uppercase' }}>
                        {img.isOriginal ? 'Original' : img.parentImageId ? `Enhanced — v${img.versionNumber}` : `Replacement — v${img.versionNumber}`}
                      </span>
                      {img.isActive && (
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2DD4BF' }} title="Active Version" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Image Preview Canvas */}
              {isComparingOriginal && images.length > 1 ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#717976', textTransform: 'uppercase' }}>Original (v1)</span>
                    <AuthenticatedPrescriptionImage
                      prescriptionId={rxId}
                      imageId={images[0]?.id}
                      alt="Original prescription"
                      style={{ width: '100%', height: 260, objectFit: 'contain', background: '#000', borderRadius: 12, marginTop: 4 }}
                    />
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#032f28', textTransform: 'uppercase' }}>
                      {currentImage?.isOriginal
                        ? 'Original (v1)'
                        : `Enhanced — v${currentImage?.versionNumber || 'Selected'}`}
                    </span>
                    <AuthenticatedPrescriptionImage
                      prescriptionId={rxId}
                      imageId={selectedImageId}
                      alt="Selected version"
                      style={{ width: '100%', height: 260, objectFit: 'contain', background: '#000', borderRadius: 12, marginTop: 4 }}
                    />
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    position: 'relative',
                    background: '#1a1a1a',
                    borderRadius: 14,
                    overflow: 'hidden',
                    height: 320,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <AuthenticatedPrescriptionImage
                    prescriptionId={rxId}
                    imageId={selectedImageId}
                    alt="Prescription document"
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                    showEnlargeHint={true}
                    onClick={() => setIsZoomModalOpen(true)}
                  />
                </div>
              )}

              {/* Provenance Footer */}
              <div style={{ background: '#e0f2eb', padding: '0.65rem 0.85rem', borderRadius: 12, fontSize: 11, color: '#414846' }}>
                <div style={{ fontWeight: 700, color: '#032f28', marginBottom: '0.2rem' }}>
                  Image Lineage Provenance
                </div>
                <div>File: {currentImage?.originalFileName || prescription?.originalFileName || 'prescription.jpg'}</div>
                <div>Type: {currentImage?.mimeType || 'image/jpeg'} • Uploaded: {new Date(currentImage?.createdAt || prescription?.createdAt).toLocaleString()}</div>
              </div>
            </div>

            {/* RIGHT COLUMN: OCR Extractions, Patient Corrections & Verification */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* OCR Run Telemetry Card */}
              {latestOcrRun && (
                <div style={{ background: '#e6f8f1', padding: '0.75rem 1rem', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', fontSize: 11, color: '#414846' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2e685d' }}>neurology</span>
                    <span>
                      OCR Engine: <strong>{latestOcrRun.engineName}</strong> ({latestOcrRun.candidates?.length || 0} candidate lines)
                    </span>
                  </div>
                  <div>
                    Execution: <strong>{latestOcrRun.executionTimeMs || 420}ms</strong> • Status: <strong>{latestOcrRun.status}</strong>
                  </div>
                </div>
              )}

              {/* Items List */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#032f28', margin: 0 }}>
                  Prescription Items ({items.length})
                </h3>
                {items.length > 0 && !items.every(i => i.isVerified) && (
                  <button
                    disabled={isActionSubmitting}
                    onClick={handleVerifyAll}
                    style={{
                      background: '#032f28',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: 99,
                      padding: '0.45rem 1.15rem',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: isActionSubmitting ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem'
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>verified</span>
                    <span>Verify All Items</span>
                  </button>
                )}
              </div>

              {items.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', background: '#f8faf9', borderRadius: 16, border: '1px dashed #c0c8c5' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 32, color: '#717976' }}>medication</span>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#414846', marginTop: 4 }}>
                    No confirmed prescription items found.
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {items.map((it, idx) => {
                    const isEditing = editingItemId === it.id;
                    const isRejecting = rejectingItemId === it.id;
                    const matchedCandidate = latestOcrRun?.candidates?.find(c => c.id === it.sourceCandidateId);

                    const isPendingBrand = it.patientNotes === 'PHARMACIST_SELECTION_REQUESTED' || it.pharmacistSelectionRequested || it.status === 'PENDING_SELECTION';

                    return (
                      <div
                        key={it.id}
                        style={{
                          background: isPendingBrand ? '#fffdf7' : (it.isVerified ? '#fafffd' : '#ffffff'),
                          borderRadius: 16,
                          border: isPendingBrand ? '1.5px solid #f59e0b' : (it.isVerified ? '1.5px solid #2e685d' : '1px solid #e0f2eb'),
                          boxShadow: isPendingBrand ? '0 2px 10px rgba(245,158,11,0.1)' : '0 2px 8px rgba(3,47,40,0.04)',
                          padding: '1.25rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.85rem'
                        }}
                      >
                        {/* Item Card Header */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 14, fontWeight: 800, color: '#032f28' }}>
                                #{idx + 1}. {it.prescribedName || it.medicine?.brandName || 'Medication'}
                              </span>

                              {/* Pharmacist Selection Request Badge */}
                              {isPendingBrand && (
                                <span style={{
                                  background: '#fef3c7',
                                  color: '#92400e',
                                  border: '1px solid #fcd34d',
                                  padding: '0.15rem 0.55rem',
                                  borderRadius: 99,
                                  fontSize: 10,
                                  fontWeight: 800,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.25rem'
                                }}>
                                  <span className="material-symbols-outlined" style={{ fontSize: 13 }}>support_agent</span>
                                  <span>Patient Requested Brand Selection</span>
                                </span>
                              )}

                              {/* Provenance Badge */}
                              <span style={{
                                background: it.sourceType === 'PATIENT_CORRECTED' ? '#fff3cd' : it.sourceType === 'MANUALLY_ADDED' ? '#e6f8f1' : '#e0f2eb',
                                color: it.sourceType === 'PATIENT_CORRECTED' ? '#856404' : '#2e685d',
                                padding: '0.15rem 0.55rem',
                                borderRadius: 99,
                                fontSize: 10,
                                fontWeight: 700
                              }}>
                                {it.sourceType === 'PATIENT_CORRECTED'
                                  ? 'Patient Corrected'
                                  : it.sourceType === 'MANUALLY_ADDED'
                                  ? 'Manually Added'
                                  : 'OCR Extracted'}
                              </span>

                              {/* Clinical Status Badge */}
                              <span style={{
                                background: it.isVerified ? '#b0ecdd' : '#ffdad4',
                                color: it.isVerified ? '#032f28' : '#7e1208',
                                padding: '0.15rem 0.55rem',
                                borderRadius: 99,
                                fontSize: 10,
                                fontWeight: 700,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.2rem'
                              }}>
                                <span className="material-symbols-outlined" style={{ fontSize: 12 }}>
                                  {it.isVerified ? 'verified' : 'hourglass_top'}
                                </span>
                                <span>{it.isVerified ? 'Clinically Verified' : 'Pending Verification'}</span>
                              </span>
                            </div>

                            <div style={{ fontSize: 12, color: '#414846', marginTop: '0.25rem' }}>
                              Dosage: <strong>{it.dosage || 'Not specified'}</strong> • Freq: <strong>{it.frequency || 'As prescribed'}</strong> • Qty: <strong>{it.quantity}</strong>
                            </div>
                          </div>
                        </div>

                        {/* Evidence Comparison Table */}
                        <div style={{ background: '#f8faf9', borderRadius: 12, padding: '0.65rem 0.85rem', border: '1px solid #e0f2eb', fontSize: 11 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                            <div>
                              <span style={{ color: '#717976', textTransform: 'uppercase', fontWeight: 700, fontSize: 10, display: 'block' }}>
                                Raw OCR Output
                              </span>
                              <div style={{ color: '#032f28', fontWeight: 600, fontFamily: 'monospace', marginTop: 2 }}>
                                "{matchedCandidate?.rawText || it.prescribedName || 'N/A'}"
                              </div>
                              <span style={{ color: '#717976', fontSize: 10 }}>
                                Confidence: {matchedCandidate ? Math.round((matchedCandidate.confidenceScore || 0.85) * 100) : 85}%
                              </span>
                            </div>

                            <div>
                              <span style={{ color: '#717976', textTransform: 'uppercase', fontWeight: 700, fontSize: 10, display: 'block' }}>
                                Active Prescribed Record
                              </span>
                              <div style={{ color: '#032f28', fontWeight: 600, marginTop: 2 }}>
                                {it.prescribedName} ({it.dosage || 'Dosage see slip'})
                              </div>
                              <span style={{ color: '#2e685d', fontSize: 10 }}>
                                Source: {it.sourceType}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Pharmacist Inline Edit Mode */}
                        {isEditing && (
                          <div style={{ background: isPendingBrand ? '#fffbeb' : '#e6f8f1', padding: '1rem', borderRadius: 14, border: isPendingBrand ? '1.5px solid #f59e0b' : '1px solid #c0c8c5', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                              <div style={{ fontSize: 13, fontWeight: 800, color: '#032f28' }}>
                                {isPendingBrand ? 'Resolve Patient Brand-Selection Request:' : 'Pharmacist Clinical Override & Correction:'}
                              </div>
                              {isPendingBrand && (
                                <span style={{
                                  fontSize: 10,
                                  fontWeight: 800,
                                  background: '#fef3c7',
                                  color: '#92400e',
                                  padding: '0.15rem 0.5rem',
                                  borderRadius: 99,
                                  border: '1px solid #fcd34d'
                                }}>
                                  Selection Pending
                                </span>
                              )}
                            </div>

                            {/* Candidate Formulations Selection */}
                            {(() => {
                              const candidateBrands = findMatchingBrands(it, catalog);
                              if (candidateBrands.length === 0) return null;

                              return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: '#2e685d' }}>
                                    Compatible Trade Brands for "{it.prescribedName}":
                                  </div>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '0.5rem' }}>
                                    {candidateBrands.map(b => {
                                      const isChosen = editFormData.medicineId === b.id;
                                      return (
                                        <div
                                          key={b.id}
                                          onClick={() => {
                                            setEditFormData(prev => ({
                                              ...prev,
                                              medicineId: b.id,
                                              prescribedName: b.brandName,
                                              dosage: b.strength || prev.dosage
                                            }));
                                          }}
                                          style={{
                                            background: isChosen ? '#b0ecdd' : '#ffffff',
                                            border: isChosen ? '1.5px solid #2e685d' : '1px solid #c0c8c5',
                                            borderRadius: 10,
                                            padding: '0.5rem 0.75rem',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '0.2rem'
                                          }}
                                        >
                                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <span style={{ fontSize: 12, fontWeight: 700, color: '#032f28' }}>{b.brandName}</span>
                                            <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#2e685d' }}>{b.strength}</span>
                                          </div>
                                          <div style={{ fontSize: 10, color: '#717976' }}>{b.dosageForm} • {b.manufacturer}</div>
                                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                                            <span style={{ fontSize: 11, fontWeight: 700, color: '#032f28' }}>₹{b.price != null ? b.price : '—'}</span>
                                            <span style={{ fontSize: 10, fontWeight: 700, color: isChosen ? '#032f28' : '#2e685d' }}>
                                              {isChosen ? '✓ Selected' : 'Choose'}
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })()}

                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.5rem' }}>
                              <div>
                                <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#414846' }}>Formulary Drug / Brand Choice</label>
                                <select
                                  value={editFormData.medicineId || ''}
                                  onChange={e => {
                                    const m = catalog.find(cat => cat.id === e.target.value);
                                    setEditFormData(prev => ({
                                      ...prev,
                                      medicineId: e.target.value,
                                      prescribedName: m ? m.brandName : prev.prescribedName,
                                      dosage: m?.strength || prev.dosage
                                    }));
                                  }}
                                  style={{ width: '100%', padding: '0.45rem', borderRadius: 8, border: '1px solid #c0c8c5', fontSize: 12 }}
                                >
                                  <option value="">-- Choose certified formulary --</option>
                                  {catalog.map(m => (
                                    <option key={m.id} value={m.id}>
                                      {m.brandName} ({m.strength}) — {m.genericName}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div>
                                <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#414846' }}>Strength / Dosage</label>
                                <input
                                  type="text"
                                  value={editFormData.dosage || ''}
                                  onChange={e => setEditFormData(prev => ({ ...prev, dosage: e.target.value }))}
                                  style={{ width: '100%', padding: '0.45rem', borderRadius: 8, border: '1px solid #c0c8c5', fontSize: 12 }}
                                />
                              </div>

                              <div>
                                <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#414846' }}>Quantity</label>
                                <input
                                  type="number"
                                  min="1"
                                  max="500"
                                  value={editFormData.quantity || 1}
                                  onChange={e => setEditFormData(prev => ({ ...prev, quantity: Number(e.target.value) }))}
                                  style={{ width: '100%', padding: '0.45rem', borderRadius: 8, border: '1px solid #c0c8c5', fontSize: 12 }}
                                />
                              </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                              <button
                                onClick={() => setEditingItemId(null)}
                                style={{ background: '#ffffff', color: '#414846', border: '1px solid #c0c8c5', padding: '0.35rem 0.85rem', borderRadius: 99, fontSize: 11, cursor: 'pointer' }}
                              >
                                Cancel
                              </button>
                              <button
                                disabled={isActionSubmitting}
                                onClick={() => handleVerifyItem(it, editFormData)}
                                style={{
                                  background: isPendingBrand ? '#d97706' : '#032f28',
                                  color: '#ffffff',
                                  border: 'none',
                                  padding: '0.35rem 1rem',
                                  borderRadius: 99,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                                }}
                              >
                                {isPendingBrand ? 'Confirm Brand Selection & Verify' : 'Save & Verify Item'}
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Rejection Prompt Box */}
                        {isRejecting && (
                          <div style={{ background: '#ffdad6', padding: '1rem', borderRadius: 14, border: '1px solid #ba1a1a', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#ba1a1a' }}>
                              Clinical Rejection Reason:
                            </div>
                            <input
                              type="text"
                              value={rejectReason}
                              onChange={e => setRejectReason(e.target.value)}
                              placeholder="Reason"
                              style={{ padding: '0.5rem', borderRadius: 8, border: '1px solid #ba1a1a', fontSize: 12, fontWeight: 700, color: '#032f28' }}
                            />
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                              <button
                                onClick={() => setRejectingItemId(null)}
                                style={{ background: '#ffffff', color: '#414846', border: '1px solid #c0c8c5', padding: '0.35rem 0.85rem', borderRadius: 99, fontSize: 11, cursor: 'pointer' }}
                              >
                                Cancel
                              </button>
                              <button
                                disabled={isActionSubmitting}
                                onClick={() => handleRejectItem(it.id)}
                                style={{ background: '#ba1a1a', color: '#ffffff', border: 'none', padding: '0.35rem 1rem', borderRadius: 99, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                              >
                                Confirm Rejection
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Item Action Buttons */}
                        {!isEditing && !isRejecting && (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', paddingTop: '0.25rem' }}>
                            <div style={{ fontSize: 11, color: '#717976' }}>
                              {it.isVerified && it.verifiedAt && (
                                <span>Verified by Pharmacist on {new Date(it.verifiedAt).toLocaleDateString()}</span>
                              )}
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              {isPendingBrand && !it.isVerified && (
                                <button
                                  onClick={() => {
                                    setEditingItemId(it.id);
                                    const compatible = findMatchingBrands(it, catalog);
                                    const defaultMed = compatible.length > 0 ? compatible[0] : null;
                                    setEditFormData({
                                      medicineId: defaultMed ? defaultMed.id : (it.medicineId || it.matchedMedicineId),
                                      prescribedName: defaultMed ? defaultMed.brandName : it.prescribedName,
                                      dosage: defaultMed?.strength || it.dosage,
                                      frequency: it.frequency,
                                      duration: it.duration,
                                      quantity: it.quantity,
                                      instructions: it.instructions
                                    });
                                  }}
                                  style={{
                                    background: '#d97706',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: 99,
                                    padding: '0.35rem 0.85rem',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.25rem',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.08)'
                                  }}
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>support_agent</span>
                                  <span>Select Brand</span>
                                </button>
                              )}

                              {!it.isVerified && !isPendingBrand && (
                                <button
                                  disabled={isActionSubmitting}
                                  onClick={() => handleVerifyItem(it)}
                                  style={{
                                    background: '#2e685d',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: 99,
                                    padding: '0.35rem 0.85rem',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.25rem'
                                  }}
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>check</span>
                                  <span>Verify Item</span>
                                </button>
                              )}

                              <button
                                onClick={() => {
                                  setEditingItemId(it.id);
                                  setEditFormData({
                                    medicineId: it.medicineId || it.matchedMedicineId,
                                    prescribedName: it.prescribedName,
                                    dosage: it.dosage,
                                    frequency: it.frequency,
                                    duration: it.duration,
                                    quantity: it.quantity,
                                    instructions: it.instructions
                                  });
                                }}
                                style={{
                                  background: '#e0f2eb',
                                  color: '#032f28',
                                  border: '1px solid #c0c8c5',
                                  borderRadius: 99,
                                  padding: '0.35rem 0.85rem',
                                  fontSize: 11,
                                  fontWeight: 600,
                                  cursor: 'pointer'
                                }}
                              >
                                Edit &amp; Verify
                              </button>

                              <button
                                onClick={() => {
                                  setRejectingItemId(it.id);
                                  setRejectReason('');
                                }}
                                style={{
                                  background: '#fff2f0',
                                  color: '#ba1a1a',
                                  border: '1px solid #ffdad6',
                                  borderRadius: 99,
                                  padding: '0.35rem 0.85rem',
                                  fontSize: 11,
                                  fontWeight: 600,
                                  cursor: 'pointer'
                                }}
                              >
                                Reject
                              </button>
                            </div>
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

        {/* Modal Footer */}
        <div style={{
          padding: '1.25rem 1.75rem',
          borderTop: '1px solid #e0f2eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#f8fdfb',
          borderBottomLeftRadius: 24,
          borderBottomRightRadius: 24
        }}>
          <div style={{ fontSize: 11, color: '#717976' }}>
            Gate 2B Clinical Verification Standard: Pharmacists must confirm all formulations against physical prescription slip evidence before release.
          </div>
          <button
            onClick={onClose}
            style={{
              background: '#032f28',
              color: '#ffffff',
              border: 'none',
              borderRadius: 99,
              padding: '0.55rem 1.5rem',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            Close Clinical Viewer
          </button>
        </div>
      </div>

      {/* Enlarged Zoom Lightbox */}
      {isZoomModalOpen && (
        <div
          onClick={() => setIsZoomModalOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            zIndex: 10001,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            cursor: 'zoom-out'
          }}
        >
          <AuthenticatedPrescriptionImage
            prescriptionId={rxId}
            imageId={selectedImageId}
            alt="Full-res prescription"
            style={{ maxWidth: '95vw', maxHeight: '95vh', objectFit: 'contain' }}
          />
        </div>
      )}
    </div>
  );

  return typeof document !== 'undefined' ? ReactDOM.createPortal(modalEl, document.body) : modalEl;
}
