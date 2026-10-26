import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { broadcastUpdate } from '../utils/realtimeUpdates';
import AuthenticatedPrescriptionImage from './AuthenticatedPrescriptionImage';
import {
  findMatchingBrands,
  findMatchingCandidates,
  identifyPrescriptionType,
  cleanText,
  calculateStringSimilarity
} from '../utils/genericMedicineMatcher';

/**
 * Resolves certified formulations in the dispensary catalog that specifically
 * match the prescribed generic active ingredient, annotated with real-time pharmacy stock & pricing.
 */
function getMatchingBrandFormulations(item, catalog, pharmacyInventory = [], order = null) {
  if (!item || !catalog || !Array.isArray(catalog) || catalog.length === 0) return { targetGeneric: null, brandOptions: [] };

  // 1. Resolve active generic name
  let targetGeneric = null;
  if (item.medicineId) {
    const m = catalog.find(cat => cat.id === item.medicineId);
    if (m?.genericName) targetGeneric = m.genericName.trim();
  }
  if (!targetGeneric && order?.items) {
    const oi = (order.items || []).find(o => o.prescriptionItemId === item.id || o.medicineId === item.medicineId);
    if (oi?.medicine?.genericName) targetGeneric = oi.medicine.genericName.trim();
  }
  if (!targetGeneric) {
    const rxType = identifyPrescriptionType(item, catalog);
    if (rxType?.targetGeneric) targetGeneric = rxType.targetGeneric.trim();
  }
  if (!targetGeneric) {
    const clean = cleanText(item.prescribedName || item.rawName || '');
    const words = clean.split(/\s+/).filter(w => w.length >= 4);
    for (const w of words) {
      for (const m of catalog) {
        const g = (m.genericName || '').toLowerCase().trim();
        if (g.includes(w) || w.includes(g) || calculateStringSimilarity(w, g) >= 0.75) {
          targetGeneric = m.genericName.trim();
          break;
        }
      }
      if (targetGeneric) break;
    }
  }

  // 2. Filter catalog exclusively to medicines matching targetGeneric
  let candidates = [];
  if (targetGeneric) {
    const targetClean = targetGeneric.toLowerCase().trim();
    candidates = catalog.filter(m => {
      const g = (m.genericName || '').toLowerCase().trim();
      return g === targetClean || g.includes(targetClean) || targetClean.includes(g) || calculateStringSimilarity(g, targetClean) >= 0.78;
    });
  }

  // Fallback if no direct generic match: use generic medicine matcher discovery
  if (candidates.length === 0) {
    const cRes = findMatchingCandidates(item, catalog, { pharmacyInventory, includeAllStrengths: true, includeAllForms: true });
    if (cRes.allCandidates.length > 0) {
      candidates = cRes.allCandidates;
    }
  }

  // 3. Annotate each option with real-time stock & pricing from the current pharmacy inventory
  const brandOptions = candidates.map(m => {
    const invItem = (pharmacyInventory || []).find(inv => inv.medicineId === m.id || inv.medicine?.id === m.id);
    const stock = invItem ? (invItem.stock != null ? invItem.stock : 0) : 0;
    const isInStock = stock > 0;
    const price = invItem?.price != null ? invItem.price : m.price;
    return {
      ...m,
      stock,
      isInStock,
      price: price != null ? price : null
    };
  }).sort((a, b) => {
    // In-stock items first
    if (a.isInStock && !b.isInStock) return -1;
    if (!a.isInStock && b.isInStock) return 1;
    return a.brandName.localeCompare(b.brandName);
  });

  return { targetGeneric, brandOptions };
}

export default function ClinicalPrescriptionReviewModal({
  order,
  pharmacyInventory = [],
  isOpen,
  onClose,
  onOpenClarification,
  onPrescriptionVerified,
  onVerified,
  onAcceptOrder
}) {
  const handleVerifiedCallback = onPrescriptionVerified || onVerified;
  const [prescription, setPrescription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [selectedImageId, setSelectedImageId] = useState(null);
  const [isComparingOriginal, setIsComparingOriginal] = useState(false);
  const [isZoomModalOpen, setIsZoomModalOpen] = useState(false);
  const [isAcceptingOrder, setIsAcceptingOrder] = useState(false);

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
        if (handleVerifiedCallback) handleVerifiedCallback();
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
        if (handleVerifiedCallback) handleVerifiedCallback();
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
        if (handleVerifiedCallback) handleVerifiedCallback();
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
          <div style={{ margin: '1rem 1.75rem 0', padding: '0.75rem 1rem', background: '#ffdad6', color: '#ba1a1a', borderRadius: 14, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>error</span>
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                fetchPrescriptionDetails();
                fetchCatalog();
              }}
              style={{
                background: '#ffffff',
                color: '#ba1a1a',
                border: '1px solid #ba1a1a',
                borderRadius: 99,
                padding: '0.25rem 0.75rem',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem'
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>refresh</span>
              <span>Retry Load</span>
            </button>
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
                              const { targetGeneric, brandOptions } = getMatchingBrandFormulations(it, catalog, pharmacyInventory, order);
                              const selectedMed = (brandOptions.length > 0 ? brandOptions : catalog).find(b => b.id === editFormData.medicineId);

                              return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                                  {/* Target Generic Information Banner */}
                                  <div style={{
                                    background: '#f0fdf4',
                                    border: '1px solid #bbf7d0',
                                    borderRadius: 12,
                                    padding: '0.65rem 0.85rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    flexWrap: 'wrap',
                                    gap: '0.5rem'
                                  }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                      <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#16a34a' }}>biotech</span>
                                      <span style={{ fontSize: 12, fontWeight: 700, color: '#14532d' }}>
                                        Active Generic Ingredient: <span style={{ textDecoration: 'underline' }}>{targetGeneric || it.prescribedName}</span>
                                      </span>
                                    </div>
                                    <span style={{ fontSize: 11, fontWeight: 600, color: '#166534' }}>
                                      {brandOptions.length} matching formulation{brandOptions.length === 1 ? '' : 's'} in catalogue
                                    </span>
                                  </div>

                                  {/* Visual Candidate Formulation Cards */}
                                  {brandOptions.length > 0 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                      <div style={{ fontSize: 11, fontWeight: 700, color: '#2e685d' }}>
                                        Matching Bioequivalent Brands at this Pharmacy:
                                      </div>
                                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem' }}>
                                        {brandOptions.map(b => {
                                          const isChosen = editFormData.medicineId === b.id;
                                          const inStock = Boolean(b.isInStock);

                                          return (
                                            <div
                                              key={b.id}
                                              onClick={() => {
                                                if (!inStock) return;
                                                setEditFormData(prev => ({
                                                  ...prev,
                                                  medicineId: b.id,
                                                  prescribedName: b.brandName,
                                                  dosage: b.strength || prev.dosage
                                                }));
                                              }}
                                              style={{
                                                background: isChosen ? '#b0ecdd' : inStock ? '#ffffff' : '#f9fafb',
                                                border: isChosen ? '2px solid #2e685d' : inStock ? '1px solid #bbf7d0' : '1px dashed #d1d5db',
                                                borderRadius: 12,
                                                padding: '0.65rem 0.85rem',
                                                cursor: inStock ? 'pointer' : 'not-allowed',
                                                opacity: inStock ? 1 : 0.55,
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: '0.3rem',
                                                transition: 'all 0.15s ease',
                                                boxShadow: isChosen ? '0 2px 6px rgba(46,104,93,0.18)' : 'none'
                                              }}
                                              title={inStock ? `Select ${b.brandName}` : 'This formulation is currently out of stock at this pharmacy and cannot be selected'}
                                            >
                                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.25rem' }}>
                                                <span style={{ fontSize: 13, fontWeight: 800, color: inStock ? '#032f28' : '#6b7280' }}>
                                                  {b.brandName}
                                                </span>
                                                {inStock ? (
                                                  <span style={{ fontSize: 10, fontWeight: 700, background: '#dcfce7', color: '#166534', padding: '1px 7px', borderRadius: 99 }}>
                                                    In Stock ({b.stock})
                                                  </span>
                                                ) : (
                                                  <span style={{ fontSize: 10, fontWeight: 700, background: '#fee2e2', color: '#991b1b', padding: '1px 7px', borderRadius: 99 }}>
                                                    Out of Stock
                                                  </span>
                                                )}
                                              </div>

                                              <div style={{ fontSize: 11, color: inStock ? '#414846' : '#9ca3af' }}>
                                                {b.strength} • {b.dosageForm} • {b.genericName}
                                              </div>

                                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                                                <span style={{ fontSize: 12, fontWeight: 700, color: inStock ? '#032f28' : '#9ca3af' }}>
                                                  {b.price != null ? `₹${Number(b.price).toFixed(2)}` : 'MRP'}
                                                </span>
                                                <span style={{ fontSize: 11, fontWeight: 700, color: isChosen ? '#032f28' : inStock ? '#2e685d' : '#9ca3af' }}>
                                                  {isChosen ? '✓ Selected' : inStock ? 'Choose' : 'Unavailable'}
                                                </span>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ) : (
                                    <div style={{ padding: '0.75rem', background: '#fef3c7', borderRadius: 10, fontSize: 11, color: '#92400e' }}>
                                      No bioequivalent brand formulations in the active catalogue matched this generic ingredient directly. You may choose a certified formulary from the list below.
                                    </div>
                                  )}

                                  {/* Styled Dropdown & Dosage/Quantity Form */}
                                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.65rem' }}>
                                    <div>
                                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#032f28', marginBottom: 4 }}>
                                        Formulary Brand Selection ({brandOptions.length > 0 ? 'Generic Matches' : 'Catalogue'}):
                                      </label>
                                      <div style={{ position: 'relative' }}>
                                        <select
                                          value={editFormData.medicineId || ''}
                                          onChange={e => {
                                            const list = brandOptions.length > 0 ? brandOptions : catalog;
                                            const m = list.find(cat => cat.id === e.target.value);
                                            if (!m) return;
                                            if (m.isInStock === false) {
                                              setError(`Cannot select ${m.brandName}: Currently out of stock at this pharmacy dispensary.`);
                                              return;
                                            }
                                            setEditFormData(prev => ({
                                              ...prev,
                                              medicineId: e.target.value,
                                              prescribedName: m ? m.brandName : prev.prescribedName,
                                              dosage: m?.strength || prev.dosage
                                            }));
                                          }}
                                          style={{
                                            width: '100%',
                                            padding: '0.65rem 2.25rem 0.65rem 0.75rem',
                                            borderRadius: 10,
                                            border: '1.5px solid #2e685d',
                                            background: '#ffffff',
                                            fontSize: 12,
                                            fontWeight: 600,
                                            color: '#032f28',
                                            outline: 'none',
                                            boxShadow: '0 1px 3px rgba(3,47,40,0.08)',
                                            cursor: 'pointer'
                                          }}
                                        >
                                          <option value="">-- Choose certified formulation --</option>
                                          {(brandOptions.length > 0 ? brandOptions : catalog).map(m => {
                                            const inStock = m.isInStock !== false;
                                            return (
                                              <option
                                                key={m.id}
                                                value={m.id}
                                                disabled={!inStock}
                                                style={{
                                                  color: inStock ? '#032f28' : '#9ca3af',
                                                  background: inStock ? '#ffffff' : '#f9fafb',
                                                  fontWeight: inStock ? 600 : 400
                                                }}
                                              >
                                                {m.brandName} ({m.strength}) — {m.genericName} {inStock ? `• In Stock (${m.stock || 'Available'})` : '• [OUT OF STOCK - Not Available at this Pharmacy]'}
                                              </option>
                                            );
                                          })}
                                        </select>
                                        <span className="material-symbols-outlined" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#2e685d', fontSize: 18 }}>
                                          unfold_more
                                        </span>
                                      </div>
                                      {selectedMed && (
                                        <div style={{ fontSize: 10, marginTop: 4, color: selectedMed.isInStock !== false ? '#166534' : '#ba1a1a', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                                          <span className="material-symbols-outlined" style={{ fontSize: 12 }}>
                                            {selectedMed.isInStock !== false ? 'check_circle' : 'warning'}
                                          </span>
                                          <span>
                                            {selectedMed.brandName}: {selectedMed.isInStock !== false ? `In Stock (${selectedMed.stock || 'Verified'} units)` : 'Out of Stock at this dispensary'}
                                          </span>
                                        </div>
                                      )}
                                    </div>

                                    <div>
                                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#032f28', marginBottom: 4 }}>Strength / Dosage</label>
                                      <input
                                        type="text"
                                        value={editFormData.dosage || ''}
                                        onChange={e => setEditFormData(prev => ({ ...prev, dosage: e.target.value }))}
                                        placeholder="e.g. 200mg"
                                        style={{ width: '100%', padding: '0.65rem 0.75rem', borderRadius: 10, border: '1.5px solid #c0c8c5', fontSize: 12, fontWeight: 600, outline: 'none' }}
                                      />
                                    </div>

                                    <div>
                                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#032f28', marginBottom: 4 }}>Dispense Qty</label>
                                      <input
                                        type="number"
                                        min="1"
                                        max="500"
                                        value={editFormData.quantity || 1}
                                        onChange={e => setEditFormData(prev => ({ ...prev, quantity: Number(e.target.value) }))}
                                        style={{ width: '100%', padding: '0.65rem 0.75rem', borderRadius: 10, border: '1.5px solid #c0c8c5', fontSize: 12, fontWeight: 600, outline: 'none' }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}

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
                                <span style={{ color: '#2e685d', fontWeight: 600 }}>✓ Verified by Pharmacist on {new Date(it.verifiedAt).toLocaleDateString()}</span>
                              )}
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              {isPendingBrand && !it.isVerified ? (
                                <button
                                  onClick={() => {
                                    setEditingItemId(it.id);
                                    const { brandOptions } = getMatchingBrandFormulations(it, catalog, pharmacyInventory, order);
                                    const defaultMed = brandOptions.find(b => b.isInStock) || brandOptions[0];
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
                                    padding: '0.45rem 1rem',
                                    fontSize: 12,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.35rem',
                                    boxShadow: '0 2px 4px rgba(217, 119, 6, 0.25)',
                                    transition: 'all 0.15s ease'
                                  }}
                                  onMouseEnter={e => { e.currentTarget.style.background = '#b45309'; }}
                                  onMouseLeave={e => { e.currentTarget.style.background = '#d97706'; }}
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>support_agent</span>
                                  <span>Select Brand Formulation</span>
                                </button>
                              ) : (
                                <>
                                  {!it.isVerified && (
                                    <button
                                      disabled={isActionSubmitting}
                                      onClick={() => handleVerifyItem(it)}
                                      style={{
                                        background: '#2e685d',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: 99,
                                        padding: '0.45rem 1rem',
                                        fontSize: 12,
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.35rem',
                                        boxShadow: '0 2px 4px rgba(46, 104, 93, 0.2)'
                                      }}
                                    >
                                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check</span>
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
                                      background: '#f0fdf4',
                                      color: '#032f28',
                                      border: '1px solid #bbf7d0',
                                      borderRadius: 99,
                                      padding: '0.45rem 0.95rem',
                                      fontSize: 12,
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '0.3rem'
                                    }}
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: 15, color: '#2e685d' }}>edit</span>
                                    <span>Edit Details</span>
                                  </button>
                                </>
                              )}

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
          flexWrap: 'wrap',
          gap: '0.75rem',
          background: '#f8fdfb',
          borderBottomLeftRadius: 24,
          borderBottomRightRadius: 24
        }}>
          <div style={{ fontSize: 11, color: '#717976', maxWidth: 460 }}>
            Gate 2B Clinical Verification Standard: Pharmacists must confirm all formulations against physical prescription slip evidence before release.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            {order?.status === 'PENDING' && onAcceptOrder && (
              <button
                type="button"
                disabled={isAcceptingOrder}
                onClick={async () => {
                  try {
                    setIsAcceptingOrder(true);
                    await onAcceptOrder(order.id);
                    onClose();
                  } catch (e) {
                    setError('Failed to accept order.');
                  } finally {
                    setIsAcceptingOrder(false);
                  }
                }}
                style={{
                  background: '#032f28',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 99,
                  padding: '0.55rem 1.25rem',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: isAcceptingOrder ? 'not-allowed' : 'pointer',
                  opacity: isAcceptingOrder ? 0.7 : 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  boxShadow: '0 2px 4px rgba(3,47,40,0.15)'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check_circle</span>
                <span>{isAcceptingOrder ? 'Accepting...' : 'Accept & Stage Reservation'}</span>
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                background: '#e0f2eb',
                color: '#032f28',
                border: '1px solid #b0ecdd',
                borderRadius: 99,
                padding: '0.55rem 1.25rem',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Close
            </button>
          </div>
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
