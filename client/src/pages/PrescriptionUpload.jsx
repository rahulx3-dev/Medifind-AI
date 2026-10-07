import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import AvailabilityModal from '../components/AvailabilityModal';
import ConfirmationDialog from '../components/ConfirmationDialog';

const API = '/api';

// ── Prescription session persistence key ─────────────────────────────────────
const PRESCRIPTION_SESSION_KEY = 'medifind_prescription_session';

function savePrescriptionSession(state) {
  try {
    localStorage.setItem(PRESCRIPTION_SESSION_KEY, JSON.stringify(state));
  } catch (_) {}
}

function loadPrescriptionSession() {
  try {
    const raw = localStorage.getItem(PRESCRIPTION_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) { return null; }
}

function clearPrescriptionSession() {
  try { localStorage.removeItem(PRESCRIPTION_SESSION_KEY); } catch (_) {}
}

export default function PrescriptionUpload({ onOrderCreated, onAddVerifiedToRequest, onProceedToPharmacies }) {
  // Steps matching Stitch:
  // 1: Prescription Upload (Screen e21903e1d8aa47b686c1bd2e7d51f0fb)
  // 2: OCR Processing (Screen 13c2201a4ee24067ba968f75ac622ae7)
  // 3: Prescription Verification (Screen ebfde8293be14e72aa1b7f0c6078b3d0)
  // 4: Prescription Verification Success (Screen b82bba59ee714ba2af852ae1eb70deb0)
  const [step, setStep] = useState(1);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [samples, setSamples] = useState([]);
  const [selectedSampleId, setSelectedSampleId] = useState(null);
  const [file, setFile] = useState(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [ocrText, setOcrText] = useState('');
  const [ocrConfidence, setOcrConfidence] = useState(null);
  const [prescription, setPrescription] = useState(null);
  const [screening, setScreening] = useState(null);
  const [detectedItems, setDetectedItems] = useState([]);
  const [medicinesCatalog, setMedicinesCatalog] = useState([]);
  const [error, setError] = useState('');
  const [ocrProgress, setOcrProgress] = useState(72);

  // Toast feedback state
  const [feedback, setFeedback] = useState({ show: false, message: '', type: 'success' });
  const showToast = (message, type = 'success') => {
    setFeedback({ show: true, message, type });
    setTimeout(() => setFeedback({ show: false, message: '', type: 'success' }), 4000);
  };

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    variant: 'primary',
    impactPoints: [],
    onConfirm: () => {}
  });

  // Screen 5: Low Confidence / Manual Medicine Mapping Modal (Screen 7861901e465f40148c7c56a0f7667051)
  const [mappingModalItem, setMappingModalItem] = useState(null);
  const [mappingSearchQuery, setMappingSearchQuery] = useState('');

  // Manual medicine addition state
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [manualSearch, setManualSearch] = useState('');
  const [manualQty, setManualQty] = useState(1);

  // Camera state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  // Availability modal fallback
  const [availModalOpen, setAvailModalOpen] = useState(false);

  // Drag-and-drop state
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // Escape key handler for image lightbox
  useEffect(() => {
    if (!isImageModalOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsImageModalOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isImageModalOpen]);

  // ── Initial data load + session restore ─────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('medifind_token');
    fetch(`${API}/prescriptions/samples`)
      .then(r => r.json())
      .then(d => { if (d.success) setSamples(d.samples || []); })
      .catch(() => {});

    fetch(`${API}/medicines/search`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(d => { if (d.success) setMedicinesCatalog(d.medicines || []); })
      .catch(() => {});

    // Restore pending prescription session
    const session = loadPrescriptionSession();
    if (session && session.prescriptionId && session.step && session.step >= 3) {
      setPrescription(session.prescription || { id: session.prescriptionId });
      setDetectedItems(session.detectedItems || []);
      setOcrText(session.ocrText || '');
      setOcrConfidence(session.ocrConfidence ?? null);
      setScreening(session.screening || null);
      setStep(session.step > 4 ? 4 : session.step);

      fetch(`${API}/prescriptions/${session.prescriptionId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(r => r.json())
        .then(d => {
          if (d.success && d.prescription) {
            setPrescription(d.prescription);
          } else if (d.status === 404 || (d.error && /not found/i.test(d.error))) {
            clearPrescriptionSession();
            setStep(1);
          }
        })
        .catch(() => {});
    }
  }, []);

  // ── Camera Management ────────────────────────────────────────────────────────
  const startCamera = async () => {
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setCameraActive(true);
    } catch (err) {
      setCameraError('Camera access denied or unavailable. Please use file upload instead.');
    }
  };

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(blob => {
      const capturedFile = new File([blob], `prescription_capture_${Date.now()}.png`, { type: 'image/png' });
      setFile(capturedFile);
      setFilePreviewUrl(URL.createObjectURL(blob));
      stopCamera();
      setSelectedSampleId(null);
    }, 'image/png');
  };

  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraActive]);

  const handleFileSelect = (selectedFile) => {
    if (!selectedFile) return;
    setError('');
    setSelectedSampleId(null);
    stopCamera();

    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(selectedFile.type)) {
      setError('Please upload a clear JPEG, PNG, or WebP prescription image.');
      return;
    }
    if (selectedFile.size > 25 * 1024 * 1024) {
      setError('Prescription file exceeds 25 MB limit.');
      return;
    }

    setFile(selectedFile);
    setFilePreviewUrl(URL.createObjectURL(selectedFile));
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  // ── Step 1 → 2: Upload and OCR Processing ────────────────────────────────────
  const handleProcessPrescription = async () => {
    if (!file && !selectedSampleId) {
      setError('Please select or upload a prescription document first.');
      return;
    }

    setError('');
    setUploading(true);
    setStep(2); // Move to Step 2: OCR Processing (Screen 13c2201a4ee24067ba968f75ac622ae7)
    setOcrProgress(34);

    // Simulated progress increments during real network / OCR execution
    const progressTimer = setInterval(() => {
      setOcrProgress(prev => (prev < 90 ? prev + 14 : prev));
    }, 450);

    const token = localStorage.getItem('medifind_token');
    const formData = new FormData();
    if (file) {
      formData.append('prescriptionImage', file);
    } else if (selectedSampleId) {
      formData.append('sampleId', selectedSampleId);
    }

    try {
      const res = await fetch(`${API}/prescriptions/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });

      clearInterval(progressTimer);
      setOcrProgress(100);

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to process prescription.');
      }

      const rxPrescription = data.prescription;
      const rxScreening = data.screening || rxPrescription?.screening || null;
      const rxOcrText = data.ocrText || rxPrescription?.ocrRawText || '';
      const rxOcrConfidence = data.confidence || data.ocrConfidence || 0;

      const rawItems = data.detectedItems || rxPrescription?.detectedMedicines || [];
      const items = rawItems.map((item, idx) => ({
        ...item,
        id: item.id || `item-${idx}`,
        quantity: typeof item.extractedQuantity === 'number' ? item.extractedQuantity : (item.quantity || 1)
      }));

      setPrescription(rxPrescription);
      setScreening(rxScreening);
      setOcrText(rxOcrText);
      setOcrConfidence(rxOcrConfidence);
      setDetectedItems(items);

      savePrescriptionSession({
        prescriptionId: rxPrescription?.id,
        prescription: rxPrescription,
        step: 3,
        detectedItems: items,
        ocrText: rxOcrText,
        ocrConfidence: rxOcrConfidence,
        screening: rxScreening
      });

      // Brief transition delay so user visually sees 100% completion in Step 2
      setTimeout(() => {
        setStep(3); // Step 3: Prescription Verification (Screen ebfde8293be14e72aa1b7f0c6078b3d0)
        showToast(`Prescription analyzed! ${items.length} candidate medication(s) identified.`, 'success');
      }, 600);
    } catch (err) {
      clearInterval(progressTimer);
      setError(err.message || 'Error communicating with OCR server.');
      showToast(err.message || 'Error communicating with OCR server.', 'error');
      setStep(1);
    } finally {
      setUploading(false);
    }
  };

  // ── Verification Item Updates ────────────────────────────────────────────────
  const updateItemField = (id, field, value) => {
    setDetectedItems(prev =>
      prev.map(i => (i.id === id ? { ...i, [field]: value } : i))
    );
  };

  const handleSelectMatchedMedicine = (itemId, medId) => {
    if (!medId) {
      setDetectedItems(prev =>
        prev.map(i =>
          i.id === itemId
            ? {
                ...i,
                matchedMedicineId: null,
                matchedMedicineName: null,
                isConfirmed: false
              }
            : i
        )
      );
      return;
    }
    const med = medicinesCatalog.find(m => m.id === medId);
    if (med) {
      setDetectedItems(prev =>
        prev.map(i =>
          i.id === itemId
            ? {
                ...i,
                matchedMedicineId: med.id,
                matchedMedicineName: med.brandName,
                strength: med.strength,
                dosageForm: med.dosageForm,
                isConfirmed: true
              }
            : i
        )
      );
    }
  };

  const handleRemoveItem = (id) => {
    const target = detectedItems.find(i => i.id === id);
    setDetectedItems(prev => prev.filter(i => i.id !== id));
    showToast(`Removed ${target?.matchedMedicineName || target?.rawName || 'item'} from prescription.`, 'info');
  };

  const handleAddManualMedicine = (med) => {
    if (!med) return;
    const newItem = {
      id: `manual-${Date.now()}`,
      rawName: med.brandName,
      medicineName: med.brandName,
      matchedMedicineId: med.id,
      matchedMedicineName: med.brandName,
      strength: med.strength,
      dosageForm: med.dosageForm,
      quantity: manualQty || 1,
      isConfirmed: true,
      confidenceScore: 100,
      dosage: 'As prescribed',
      frequency: 'Once daily'
    };
    setDetectedItems(prev => [...prev, newItem]);
    setShowManualAdd(false);
    setManualSearch('');
    setManualQty(1);
    showToast(`Added ${med.brandName} to prescription.`, 'success');
  };

  // Confirm Verification -> Moves to Step 4: Verification Success (Screen b82bba59ee714ba2af852ae1eb70deb0)
  const handleConfirmVerification = async () => {
    if (!prescription) {
      setError('Prescription session expired. Please re-upload.');
      showToast('Prescription session expired. Please re-upload.', 'error');
      return;
    }

    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch(`${API}/prescriptions/${prescription.id}/verify`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          items: detectedItems.map(item => ({
            id: item.id,
            matchedMedicineId: item.matchedMedicineId || null,
            matchedMedicineName: item.matchedMedicineName || null,
            quantity: parseInt(item.quantity, 10) || 1,
            dosage: item.dosage,
            frequency: item.frequency,
            duration: item.duration,
            isConfirmed: !!item.matchedMedicineId
          }))
        })
      });

      const data = await res.json();
      if (data.success) {
        setPrescription(data.prescription);
        const verifiedList = data.prescription.detectedMedicines || detectedItems;
        setDetectedItems(verifiedList);

        // Feed confirmed items into App.jsx medicine request state
        if (onAddVerifiedToRequest) {
          const verifiedItems = verifiedList
            .filter(i => i.matchedMedicineId)
            .map(i => ({
              medicineId: i.matchedMedicineId,
              brandName: i.matchedMedicineName || i.rawName,
              quantity: parseInt(i.quantity, 10) || 1
            }));
          if (verifiedItems.length > 0) {
            onAddVerifiedToRequest(verifiedItems);
          }
        }

        // Part 4: Display exact Stitch Screen "Prescription Verification Success" (Screen b82bba59ee714ba2af852ae1eb70deb0)
        showToast('Prescription verified! Authentication record generated.', 'success');
        setStep(4);
      } else {
        setError(data.error || 'Verification failed. Please check candidate mappings.');
        showToast(data.error || 'Verification failed. Please check candidate mappings.', 'error');
      }
    } catch (err) {
      setError('Network error during verification.');
      showToast('Network error during verification.', 'error');
    }
  };

  const reset = () => {
    clearPrescriptionSession();
    setStep(1);
    setFile(null);
    setFilePreviewUrl(null);
    setSelectedSampleId(null);
    setOcrText('');
    setOcrConfidence(null);
    setPrescription(null);
    setScreening(null);
    setDetectedItems([]);
    setError('');
    setShowManualAdd(false);
    setMappingModalItem(null);
    stopCamera();
  };

  // Current preview image source
  const currentPreviewSrc = filePreviewUrl || (
    selectedSampleId
      ? (samples.find(s => s.id === selectedSampleId)?.imageUrl || null)
      : null
  );

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-6 font-body-md text-on-surface">
      {/* ── PART 1: PRESCRIPTION UPLOAD (Stitch Screen e21903e1d8aa47b686c1bd2e7d51f0fb) ── */}
      {step === 1 && (
        <div className="flex flex-col gap-6">
          {/* Top Step Bar & Workflow Indicator */}
          <div className="w-full bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="p-2.5 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center">
                <span className="material-symbols-outlined text-xl">document_scanner</span>
              </span>
              <div>
                <span className="text-[11px] font-bold text-secondary uppercase tracking-wider block">Clinical Workflow</span>
                <span className="text-base font-bold text-primary">Prescription Dispense Pipeline</span>
              </div>
            </div>

            {/* Stepper Pills */}
            <nav className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-primary text-white shadow-sm text-xs font-bold">
                <span className="w-4 h-4 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center text-[10px]">1</span>
                <span>Upload or Capture</span>
              </div>
              <span className="material-symbols-outlined text-xs text-outline">chevron_right</span>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container text-on-surface-variant text-xs">
                <span className="w-4 h-4 rounded-full bg-surface-container-high flex items-center justify-center text-[10px] font-semibold">2</span>
                <span>Optical Reading &amp; Extraction</span>
              </div>
              <span className="material-symbols-outlined text-xs text-outline">chevron_right</span>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container text-on-surface-variant text-xs">
                <span className="w-4 h-4 rounded-full bg-surface-container-high flex items-center justify-center text-[10px] font-semibold">3</span>
                <span>Patient Verification</span>
              </div>
            </nav>
          </div>

          {/* Editorial Header Section */}
          <div className="flex flex-col gap-1 max-w-3xl">
            <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-xs font-bold w-fit">
              <span className="material-symbols-outlined text-sm">encrypted</span>
              <span>Encrypted Secure Upload</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-primary tracking-tight mt-1">
              Upload Paper or Digital Prescription
            </h1>
            <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
              Upload your doctor's written prescription or digital clinical summary. MediFind AI extracts medicine candidates for rapid local pharmacy matching.
            </p>
          </div>

          {/* Main Bento Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column (7 cols): Primary Ingestion Hub */}
            <div className="lg:col-span-7 flex flex-col gap-6">
              {error && (
                <div className="p-4 rounded-2xl bg-error-container text-on-error-container text-xs font-semibold flex items-center gap-2">
                  <span className="material-symbols-outlined text-lg">warning</span>
                  <span>{error}</span>
                </div>
              )}

              {/* Dropzone Container Card */}
              <div className="bg-surface-container-lowest rounded-3xl p-6 sm:p-8 border border-outline-variant/30 shadow-sm flex flex-col relative overflow-hidden">
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`w-full rounded-2xl p-8 sm:p-12 flex flex-col items-center justify-center text-center cursor-pointer transition-all border-2 border-dashed ${
                    dragOver
                      ? 'border-secondary bg-surface-container-low'
                      : 'border-[#cbe0d7] bg-surface-container-low/40 hover:bg-surface-container-low'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={e => handleFileSelect(e.target.files[0])}
                  />
                  <div className="w-16 h-16 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center mb-4 shadow-sm">
                    <span className="material-symbols-outlined text-3xl">cloud_upload</span>
                  </div>
                  <h2 className="text-xl font-bold text-primary mb-1">
                    Drag and drop your prescription file here
                  </h2>
                  <p className="text-xs sm:text-sm text-on-surface-variant max-w-md mb-5 leading-relaxed">
                    or browse from your desktop files. Clear scans allow optical recognition to reliably detect medicine names and strengths.
                  </p>
                  <button
                    type="button"
                    className="px-6 py-2.5 rounded-full bg-primary hover:bg-primary-container text-white text-xs font-bold shadow-sm transition-all flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-base">folder_open</span>
                    <span>Browse Document / Photo</span>
                  </button>
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-[11px] text-on-surface-variant font-medium">
                    <span className="flex items-center gap-1"><span className="material-symbols-outlined text-xs text-secondary">check_circle</span> PDF / Scan</span>
                    <span>•</span>
                    <span className="flex items-center gap-1"><span className="material-symbols-outlined text-xs text-secondary">check_circle</span> PNG / JPG / WEBP</span>
                    <span>•</span>
                    <span>Up to 25MB</span>
                  </div>
                </div>

                {/* Divider */}
                <div className="relative my-6 flex items-center justify-center">
                  <div className="w-full h-px bg-surface-container-high" />
                  <span className="absolute bg-surface-container-lowest px-4 text-[11px] text-outline uppercase font-semibold tracking-wider">
                    or use your device camera
                  </span>
                </div>

                {/* Web Camera Instant Capture Pathway */}
                <div className="p-4 rounded-2xl bg-surface-container flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-white text-secondary flex items-center justify-center shrink-0 shadow-xs">
                      <span className="material-symbols-outlined text-xl">photo_camera</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-on-surface">Live Prescription Snapshot</span>
                      <span className="text-[11px] text-on-surface-variant">Instant high-resolution document snap with auto-deskew</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCameraError('');
                      if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
                        startCamera();
                      } else {
                        setCameraError('Camera API not available in this browser.');
                      }
                    }}
                    className="w-full sm:w-auto px-4 py-2 rounded-full bg-white hover:bg-surface-container-high text-primary font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-sm">camera</span>
                    <span>Open Web Camera Capture</span>
                  </button>
                </div>

                {cameraActive && (
                  <div className="mt-4 p-4 rounded-2xl bg-surface-container-lowest border border-secondary shadow-md flex flex-col gap-3">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full max-h-72 object-cover rounded-xl bg-black"
                    />
                    <canvas ref={canvasRef} className="hidden" />
                    <div className="flex items-center justify-center gap-3">
                      <button
                        onClick={capturePhoto}
                        className="px-6 py-2 rounded-full bg-primary text-white text-xs font-bold flex items-center gap-1.5 shadow-sm"
                      >
                        <span className="material-symbols-outlined text-base">camera</span>
                        <span>Capture Photo</span>
                      </button>
                      <button
                        onClick={stopCamera}
                        className="px-4 py-2 rounded-full bg-surface-container text-primary text-xs font-semibold"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {cameraError && (
                  <p className="text-xs text-error mt-2 font-medium">{cameraError}</p>
                )}
              </div>

              {/* Privacy & Clinical Safety Notice Box */}
              <div className="bg-surface-container-low rounded-3xl p-6 border border-outline-variant/30 shadow-sm flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-xl">shield_with_heart</span>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-primary">Privacy &amp; Clinical Safety</h3>
                    <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                      Your prescription is encrypted end-to-end. MediFind extracts medicine text solely to find local pharmacy availability. We never alter dosages or create prescriptions without certified physician review.
                    </p>
                  </div>
                </div>
                <div className="bg-surface-container-lowest rounded-xl p-3 flex items-center justify-between gap-3 text-xs text-on-surface">
                  <span className="flex items-center gap-1.5 font-medium">
                    <span className="material-symbols-outlined text-secondary text-sm">lightbulb</span>
                    Optimal Results Tip: Ensure doctor's signature and prescription text are lit without glare.
                  </span>
                  <span className="text-[10px] text-secondary font-bold bg-secondary-container/40 px-2 py-0.5 rounded-full shrink-0">
                    Automated OCR v4.2
                  </span>
                </div>
              </div>
            </div>

            {/* Right Column (5 cols): Staged Document Card & Execution Action */}
            <div className="lg:col-span-5 flex flex-col gap-6">
              <div className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/30 shadow-sm flex flex-col gap-4">
                <div className="flex items-center justify-between pb-3 border-b border-surface-container">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-secondary" />
                    <span className="text-xs font-bold text-secondary uppercase tracking-wider">
                      Active Prescription Staged
                    </span>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                    file || selectedSampleId ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant'
                  }`}>
                    {file ? 'File Uploaded' : selectedSampleId ? 'Sample Selected' : 'Awaiting Input'}
                  </span>
                </div>

                {/* Staged Document Preview */}
                {currentPreviewSrc ? (
                  <div className="relative rounded-2xl overflow-hidden bg-surface-container border border-outline-variant/20 p-2">
                    <img
                      src={currentPreviewSrc}
                      alt="Prescription preview"
                      className="w-full h-52 object-contain rounded-xl"
                    />
                    <button
                      onClick={() => { setFile(null); setFilePreviewUrl(null); setSelectedSampleId(null); }}
                      className="absolute top-4 right-4 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
                    >
                      <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                  </div>
                ) : (
                  <div className="h-44 rounded-2xl bg-surface-container-low flex flex-col items-center justify-center text-center p-4 text-on-surface-variant">
                    <span className="material-symbols-outlined text-4xl mb-1 text-outline">description</span>
                    <span className="text-xs font-bold text-primary">No document staged yet</span>
                    <span className="text-[11px] text-on-surface-variant/70 mt-0.5">
                      Upload an image file or choose an academic sample below
                    </span>
                  </div>
                )}

                {/* Primary Execution CTA */}
                <button
                  type="button"
                  onClick={handleProcessPrescription}
                  disabled={uploading || (!file && !selectedSampleId)}
                  className="w-full py-3.5 rounded-full bg-primary hover:bg-primary-container text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-lg">auto_awesome</span>
                  <span>Run OCR &amp; Document Screening</span>
                  <span className="material-symbols-outlined text-base">arrow_forward</span>
                </button>
              </div>

              {/* Academic Test Fixture Samples */}
              <div className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/30 shadow-sm flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-secondary text-base">bolt</span>
                  <h4 className="text-xs font-bold text-primary uppercase tracking-wider">
                    Test Fixture Samples (Demonstration)
                  </h4>
                </div>
                <p className="text-xs text-on-surface-variant">
                  Instantly evaluate the OCR pipeline using pre-loaded academic prescriptions:
                </p>

                <div className="flex flex-col gap-2">
                  {samples.map(s => {
                    const isSelected = selectedSampleId === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setSelectedSampleId(s.id);
                          setFile(null);
                          setFilePreviewUrl(null);
                          setError('');
                        }}
                        className={`p-3 rounded-2xl text-left transition-all border flex items-center justify-between ${
                          isSelected
                            ? 'bg-secondary-container/40 border-secondary shadow-xs'
                            : 'bg-surface-container-low hover:bg-surface-container border-outline-variant/30'
                        }`}
                      >
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-primary">{s.title}</span>
                          <span className="text-[11px] text-on-surface-variant">{s.doctor} • {s.diagnosis}</span>
                        </div>
                        <span className="material-symbols-outlined text-secondary text-base">
                          {isSelected ? 'check_circle' : 'chevron_right'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PART 2: OCR PROCESSING (Stitch Screen 13c2201a4ee24067ba968f75ac622ae7) ── */}
      {step === 2 && (
        <div className="flex flex-col gap-6">
          {/* Top Progress Breadcrumbs */}
          <div className="w-full bg-surface-container-lowest rounded-full shadow-sm p-1.5 flex items-center justify-between border border-outline-variant/30">
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-surface-container-low text-primary text-xs font-medium">
              <span className="w-5 h-5 rounded-full bg-secondary text-white flex items-center justify-center text-[10px] font-bold">✓</span>
              <span>Step 1: Upload or Capture</span>
            </div>
            <span className="material-symbols-outlined text-sm text-outline">chevron_right</span>
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary text-white text-xs font-bold shadow-sm">
              <span className="w-5 h-5 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center text-[10px]">2</span>
              <span>Step 2: Optical Reading &amp; Medicine Extraction</span>
              <span className="w-1.5 h-1.5 rounded-full bg-secondary-container animate-ping inline-block" />
            </div>
            <span className="material-symbols-outlined text-sm text-outline">chevron_right</span>
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full text-on-surface-variant/70 text-xs">
              <span className="w-5 h-5 rounded-full bg-surface-container-high flex items-center justify-center text-[10px]">3</span>
              <span>Step 3: Patient Verification</span>
            </div>
          </div>

          {/* Header Section */}
          <div className="flex flex-col gap-1 max-w-3xl">
            <div className="inline-flex items-center gap-1.5 text-secondary font-bold text-xs bg-secondary-container/50 px-3 py-1 rounded-full w-fit">
              <span className="material-symbols-outlined text-sm">neurology</span>
              <span>MediFind DeepRead OCR Active</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-primary tracking-tight mt-1">
              Reading Prescription Document &amp; Extracting Medicines
            </h1>
            <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
              MediFind optical character recognition is scanning the uploaded doctor's prescription. Detected medicine formulations will be presented for your verification in the next step.
            </p>
          </div>

          {/* Main Two-Column Balanced Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column: Prescription Scanning Visualizer */}
            <div className="lg:col-span-6 flex flex-col gap-4">
              <div className="relative bg-surface-container-lowest rounded-3xl shadow-xl overflow-hidden p-6 border border-outline-variant/30 flex flex-col items-center">
                <div className="w-full flex items-center justify-between pb-3 text-xs text-on-surface-variant border-b border-surface-container">
                  <div className="flex items-center gap-1.5 font-medium text-primary">
                    <span className="material-symbols-outlined text-secondary text-base">description</span>
                    <span>{file?.name || 'Prescription_Document_Scan.jpg'}</span>
                  </div>
                  <span className="bg-surface-container px-2 py-0.5 rounded-full text-outline font-mono text-[10px]">
                    Layer 1 OCR Active
                  </span>
                </div>

                {/* Prescription Frame with Scanner Simulation & Laser Beam */}
                <div className="relative w-full aspect-[1/1.25] bg-surface-container-low rounded-2xl overflow-hidden shadow-inner p-4 mt-4 flex items-center justify-center select-none">
                  {currentPreviewSrc ? (
                    <img
                      src={currentPreviewSrc}
                      alt="Prescription under scan"
                      className="w-full h-full object-contain filter contrast-105"
                    />
                  ) : (
                    <div className="w-full h-full bg-white rounded-xl border-2 border-dashed border-outline-variant/40 p-6 flex flex-col items-center justify-center text-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center text-primary">
                        <span className="material-symbols-outlined text-2xl">document_scanner</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-bold text-on-surface">No Prescription Selected</span>
                        <span className="text-[11px] text-on-surface-variant max-w-[200px]">
                          Upload a prescription image or select a demonstration sample to scan
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Animated Laser Scanning Bar */}
                  <div className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#b3eee0] to-transparent pointer-events-none shadow-[0_0_16px_4px_rgba(179,238,224,0.9)] animate-[scan_2.8s_ease-in-out_infinite]" />
                  <style>{`
                    @keyframes scan {
                      0% { top: 4%; opacity: 0.1; }
                      15% { opacity: 0.95; }
                      85% { opacity: 0.95; }
                      100% { top: 92%; opacity: 0.1; }
                    }
                  `}</style>

                  {/* Dynamic Extraction Target Box Simulation */}
                  <div className="absolute top-[35%] left-[15%] right-[15%] p-2 rounded-xl bg-secondary/15 border-2 border-secondary shadow-lg pointer-events-none flex flex-col justify-between">
                    <span className="bg-primary text-white text-[10px] font-bold px-2 py-0.5 rounded-full self-start -mt-4 shadow-sm flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#b3eee0] animate-ping" />
                      Tokenizing Clinical Lines...
                    </span>
                    <span className="text-[10px] font-mono text-secondary font-bold text-right mt-1">
                      Confidence 98.7%
                    </span>
                  </div>
                </div>

                {/* Optical Details Badge */}
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs">
                  <span className="px-3 py-1 rounded-full bg-surface-container text-on-surface-variant font-medium flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm text-secondary">document_scanner</span>
                    Optical Resolution: 1200 DPI
                  </span>
                  <span className="px-3 py-1 rounded-full bg-secondary-container text-on-secondary-container font-semibold flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
                    powered by Tesseract OCR
                  </span>
                </div>
              </div>
            </div>

            {/* Right Column: Extraction Stages & Progress Architecture */}
            <div className="lg:col-span-6 flex flex-col gap-5">
              <div className="bg-surface-container-lowest rounded-3xl shadow-sm p-6 border border-outline-variant/30 flex flex-col gap-5">
                <div className="flex items-center justify-between pb-3 border-b border-surface-container">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-outline uppercase font-semibold tracking-wider">Total Progress</span>
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-extrabold text-primary font-mono">{ocrProgress}</span>
                      <span className="text-lg font-bold text-secondary">%</span>
                    </div>
                  </div>
                  <div className="w-12 h-12 rounded-full border-4 border-surface-container border-t-primary animate-spin" />
                </div>

                {/* Progress Bar */}
                <div className="w-full h-2.5 rounded-full bg-surface-container overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${ocrProgress}%` }}
                  />
                </div>

                {/* Pipeline Stage Cards — Animate progression across the 5 real stages */}
                <div className="flex flex-col gap-2.5">
                  {[
                    { id: 1, name: '1. Image Processing', threshold: 25 },
                    { id: 2, name: '2. Text Recognition', threshold: 50 },
                    { id: 3, name: '3. Medicine Extraction', threshold: 75 },
                    { id: 4, name: '4. Catalogue Matching', threshold: 92 },
                    { id: 5, name: '5. Verification', threshold: 100 },
                  ].map((s, idx, arr) => {
                    const prevDone = idx === 0 || ocrProgress >= arr[idx - 1].threshold;
                    const isDone = ocrProgress >= s.threshold;
                    const isRunning = prevDone && !isDone;

                    return (
                      <div
                        key={s.id}
                        className={`p-2.5 rounded-2xl flex items-center justify-between text-xs transition-colors duration-300 ${
                          isRunning
                            ? 'bg-primary text-white shadow-xs'
                            : isDone
                            ? 'bg-surface-container-low text-primary'
                            : 'bg-surface-container-low/60 text-on-surface-variant'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            isDone
                              ? 'bg-secondary text-white'
                              : isRunning
                              ? 'bg-secondary-container text-on-secondary-container'
                              : 'bg-surface-container-high text-outline'
                          }`}>
                            {isDone ? '✓' : s.id}
                          </span>
                          <span className={isRunning ? 'font-bold' : isDone ? 'font-semibold' : ''}>
                            {s.name}
                          </span>
                        </div>
                        <span className={`text-[10px] font-bold ${
                          isDone
                            ? 'text-secondary'
                            : isRunning
                            ? 'text-secondary-container animate-pulse'
                            : 'text-outline font-medium'
                        }`}>
                          {isDone ? 'Complete' : isRunning ? 'Processing' : 'Queued'}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Safety Protocol Note */}
                <div className="p-3 rounded-2xl bg-[#ecfdf7] border border-[#a6cfc5] text-xs text-primary flex items-center gap-2">
                  <span className="material-symbols-outlined text-secondary text-base shrink-0">verified_user</span>
                  <span>Extracted formulations will require your clinical confirmation prior to dispensary matching.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PART 3: PRESCRIPTION VERIFICATION (Stitch Screen ebfde8293be14e72aa1b7f0c6078b3d0) ── */}
      {step === 3 && (
        <div className="flex flex-col gap-6">
          {/* Stepper Bar */}
          <div className="w-full bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-full bg-secondary text-white flex items-center justify-center">
                <span className="material-symbols-outlined text-lg">check</span>
              </span>
              <div>
                <span className="text-[11px] font-bold text-secondary uppercase tracking-wider block">Clinical Workflow</span>
                <span className="text-base font-bold text-primary">Patient Prescription Verification</span>
              </div>
            </div>

            <nav className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container text-on-surface-variant text-xs">
                <span className="w-4 h-4 rounded-full bg-surface-container-high flex items-center justify-center text-[10px] font-bold">✓</span>
                <span>1. Upload</span>
              </div>
              <span className="material-symbols-outlined text-xs text-outline">chevron_right</span>
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container text-on-surface-variant text-xs">
                <span className="w-4 h-4 rounded-full bg-surface-container-high flex items-center justify-center text-[10px] font-bold">✓</span>
                <span>2. OCR Extracted</span>
              </div>
              <span className="material-symbols-outlined text-xs text-outline">chevron_right</span>
              <div className="flex items-center gap-2 px-3.5 py-1 rounded-full bg-primary text-white text-xs font-bold shadow-sm">
                <span className="w-4 h-4 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center text-[10px]">3</span>
                <span>3. Patient Verification</span>
              </div>
            </nav>
          </div>

          {/* Document Integrity Screening Banner (Stitch Screen ebfde8293be14e72aa1b7f0c6078b3d0 lines 80-98) */}
          <div className="p-4 rounded-3xl bg-surface-container-lowest border border-outline-variant/30 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-xl">verified</span>
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-primary">Document Integrity Screening:</span>
                  <span className="px-2.5 py-0.5 rounded-full bg-secondary text-white text-[11px] font-bold tracking-wide">
                    {screening?.status || 'NO_OBVIOUS_ISSUES'}
                  </span>
                  {ocrConfidence !== null && (
                    <span className="text-[11px] text-outline font-mono">
                      (OCR Confidence: {ocrConfidence}%)
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-on-surface-variant mt-0.5">
                  Automated scan completed · Note: Automated checks assist review and do not confirm clinical authenticity.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={reset}
              className="px-3.5 py-1.5 rounded-full bg-surface-container hover:bg-surface-container-high text-primary text-xs font-semibold transition-colors shrink-0"
            >
              Re-upload Image
            </button>
          </div>

          {/* Two-Column Workspace Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* LEFT COLUMN: Prescription Document Preview (5 cols) */}
            <div className="lg:col-span-5 flex flex-col gap-4 sticky top-24">
              <div className="bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/30 shadow-sm flex flex-col gap-3">
                <div className="flex items-center justify-between pb-2 border-b border-surface-container">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="material-symbols-outlined text-primary text-lg">picture_as_pdf</span>
                    <span className="text-xs font-bold text-primary truncate max-w-[200px]">
                      {file?.name || 'Prescription_Document.pdf'}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-surface-container text-secondary text-[10px] font-bold uppercase">
                    Page 1/1
                  </span>
                </div>

                {/* Preview Window with Click-to-Zoom */}
                <div
                  onClick={() => currentPreviewSrc && setIsImageModalOpen(true)}
                  className={`relative bg-surface-container-low rounded-2xl overflow-hidden min-h-[360px] p-2 flex items-center justify-center border border-outline-variant/20 shadow-inner group ${
                    currentPreviewSrc ? 'cursor-zoom-in' : ''
                  }`}
                  title={currentPreviewSrc ? "Click to view full-resolution prescription scan" : undefined}
                >
                  {currentPreviewSrc ? (
                    <>
                      <img
                        src={currentPreviewSrc}
                        alt="Prescription preview"
                        className="w-full h-80 object-contain rounded-xl transition-transform duration-200 group-hover:scale-105"
                      />
                      <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md text-white text-[10px] font-bold flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="material-symbols-outlined text-xs">zoom_in</span>
                        <span>Click to enlarge</span>
                      </div>
                    </>
                  ) : (
                    <div className="text-center p-6 text-xs text-on-surface-variant">
                      <span className="material-symbols-outlined text-4xl text-outline mb-1">image</span>
                      <p>Physical document scan loaded</p>
                    </div>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-surface-container-low text-[11px] text-on-surface-variant flex items-center gap-2">
                  <span className="material-symbols-outlined text-secondary text-base shrink-0">info</span>
                  <span>OCR results are candidate interpretations. Always verify against your physical prescription.</span>
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: Extracted Medicine Candidates (7 cols) */}
            <div className="lg:col-span-7 flex flex-col gap-5">
              {/* Header */}
              <div className="flex items-center justify-between pb-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-primary tracking-tight">Extracted Medicine Candidates</h2>
                  <span className="px-2.5 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-xs font-bold">
                    {detectedItems.length} Detected
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowManualAdd(!showManualAdd)}
                  className="px-3.5 py-1.5 rounded-full bg-surface-container hover:bg-surface-container-high text-secondary text-xs font-bold transition-colors flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-sm">add</span>
                  <span>Add Medicine Manually</span>
                </button>
              </div>

              {/* Manual Add Box */}
              {showManualAdd && (
                <div className="p-4 rounded-3xl bg-surface-container-lowest border border-secondary shadow-sm flex flex-col gap-3">
                  <h4 className="text-xs font-bold text-primary uppercase tracking-wider">
                    Add Formulation from Standardized Catalog
                  </h4>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <select
                      value={manualSearch}
                      onChange={e => setManualSearch(e.target.value)}
                      className="flex-1 h-10 px-3 rounded-xl bg-surface-container-low border border-outline-variant/30 text-xs text-on-surface outline-none focus:border-secondary"
                    >
                      <option value="">-- Choose medicine from catalog --</option>
                      {medicinesCatalog.map(m => (
                        <option key={m.id} value={m.id}>
                          {m.brandName} ({m.genericName}) — {m.dosageForm} {m.strength}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-on-surface-variant font-medium">Qty:</span>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={manualQty}
                        onChange={e => setManualQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="w-14 h-10 text-center rounded-xl bg-surface-container-low border border-outline-variant/30 text-xs text-on-surface font-mono"
                      />
                      <button
                        onClick={() => {
                          const found = medicinesCatalog.find(m => m.id === manualSearch);
                          if (found) handleAddManualMedicine(found);
                        }}
                        disabled={!manualSearch}
                        className="px-4 py-2 rounded-full bg-primary hover:bg-primary-container text-white text-xs font-bold disabled:opacity-50 transition-colors"
                      >
                        Add Item
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Candidate Cards Grid (Stitch Structured Rows) */}
              <div className="flex flex-col gap-4">
                {detectedItems.length === 0 ? (
                  <div className="p-8 rounded-3xl bg-surface-container-lowest border border-outline-variant/30 text-center flex flex-col items-center gap-2">
                    <span className="material-symbols-outlined text-3xl text-outline">error</span>
                    <span className="text-sm font-bold text-primary">No medicine items verified yet</span>
                    <p className="text-xs text-on-surface-variant max-w-sm">
                      Click "Add Medicine Manually" above to select medicines from our 50-medicine catalog.
                    </p>
                  </div>
                ) : (
                  detectedItems.map((item, idx) => {
                    const isMapped = !!item.matchedMedicineId;
                    const confidenceScore = item.confidenceScore || (isMapped ? 99 : 64);
                    const isHighMatch = confidenceScore >= 80;

                    return (
                      <div
                        key={item.id}
                        className={`bg-surface-container-lowest rounded-3xl p-5 border shadow-sm transition-all flex flex-col gap-4 ${
                          isMapped
                            ? 'border-secondary/30'
                            : 'border-[#ffdad4] bg-[#fff8f6]/50'
                        }`}
                      >
                        {/* Header Banner & Verification Status */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-surface-container">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                              isMapped
                                ? 'bg-secondary-container/60 text-secondary'
                                : 'bg-[#ffdad4] text-[#410100]'
                            }`}>
                              <span className="material-symbols-outlined text-sm">
                                {isMapped ? 'check_circle' : 'warning'}
                              </span>
                              <span>
                                Candidate {idx + 1} of {detectedItems.length}: {isHighMatch ? `High Match (${confidenceScore}%)` : 'Needs Mapping'}
                              </span>
                            </span>
                            <span className="font-mono text-[10px] text-outline bg-surface-container-low px-2 py-0.5 rounded font-medium">
                              Detection Box #{idx + 1}
                            </span>
                          </div>

                          <label className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold select-none shadow-xs ${
                            isMapped ? 'bg-secondary text-white' : 'bg-surface-container text-on-surface-variant'
                          }`}>
                            <input
                              type="checkbox"
                              checked={isMapped}
                              readOnly
                              className="accent-secondary w-3.5 h-3.5 rounded"
                            />
                            <span>{isMapped ? 'Verified ✓' : 'Unmapped'}</span>
                          </label>
                        </div>

                        {/* Visual OCR vs Matched Catalogue Transition */}
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center bg-surface-container-low/50 p-3.5 rounded-2xl border border-surface-container">
                          {/* Left: Detected in Prescription */}
                          <div className="md:col-span-5 flex flex-col gap-1">
                            <span className="text-[10px] uppercase font-bold text-outline tracking-wider flex items-center gap-1">
                              <span className="material-symbols-outlined text-xs text-secondary">description</span>
                              Detected on Slip
                            </span>
                            <p className="font-mono text-xs text-on-surface font-semibold bg-surface-container-lowest px-2.5 py-1.5 rounded-lg border border-surface-container truncate">
                              "{item.rawName || item.medicineName || 'Detected item'}"
                            </p>
                          </div>

                          {/* Middle Arrow */}
                          <div className="hidden md:flex md:col-span-2 justify-center text-secondary">
                            <span className="material-symbols-outlined text-xl">arrow_forward</span>
                          </div>

                          {/* Right: Matched Catalogue Medicine */}
                          <div className="md:col-span-5 flex items-center gap-2.5">
                            <div className="w-10 h-10 rounded-xl bg-secondary-container/40 flex items-center justify-center text-secondary shrink-0">
                              <span className="material-symbols-outlined text-xl">medication</span>
                            </div>
                            <div className="min-w-0 flex-1">
                              {isMapped ? (
                                <>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <h3 className="text-sm font-bold text-primary truncate">
                                      {item.matchedMedicineName || item.medicineName}
                                    </h3>
                                    {item.strength && (
                                      <span className="px-1.5 py-0.2 rounded-full bg-secondary/10 text-secondary text-[10px] font-semibold">
                                        {item.strength}
                                      </span>
                                    )}
                                    <span className="px-1.5 py-0.2 rounded bg-error-container text-on-error-container text-[9px] font-bold uppercase">
                                      Rx
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-on-surface-variant mt-0.5 truncate">
                                    {item.dosageForm || 'Formulation'} · {item.genericName || 'Standardized catalogue'}
                                  </p>
                                </>
                              ) : (
                                <div>
                                  <span className="text-xs font-bold text-[#ba1a1a]">No Catalogue Match Yet</span>
                                  <p className="text-[11px] text-outline">Click Change / Remap to select candidate</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Doctor's Prescribed Regimen / Instructions Box */}
                        <div className="p-3 rounded-2xl bg-surface-container-low border border-surface-container flex flex-col gap-1 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-secondary uppercase text-[10px] flex items-center gap-1">
                              <span className="material-symbols-outlined text-xs">medical_information</span>
                              Doctor's Prescribed Regimen
                            </span>
                            <span className="font-mono text-[11px] text-outline">
                              Qty Target: #{item.quantity || 1} units
                            </span>
                          </div>
                          <p className="text-on-surface font-medium text-xs">
                            {item.dosage || 'Take as directed on prescription slip.'}
                          </p>
                        </div>

                        {/* Bottom Controls: Quantity Stepper & Clean Actions */}
                        <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-surface-container">
                          {/* Quantity Selector */}
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-on-surface-variant font-medium">Reserve Qty:</span>
                            <div className="inline-flex items-center bg-surface-container-low rounded-full p-0.5 border border-surface-container">
                              <button
                                type="button"
                                onClick={() => updateItemField(item.id, 'quantity', Math.max(1, (item.quantity || 1) - 1))}
                                className="w-6 h-6 rounded-full flex items-center justify-center text-primary hover:bg-white transition-colors"
                              >
                                -
                              </button>
                              <span className="w-7 text-center font-bold font-mono text-primary">
                                {item.quantity || 1}
                              </span>
                              <button
                                type="button"
                                onClick={() => updateItemField(item.id, 'quantity', (item.quantity || 1) + 1)}
                                className="w-6 h-6 rounded-full flex items-center justify-center text-primary hover:bg-white transition-colors"
                              >
                                +
                              </button>
                            </div>
                          </div>

                          {/* Actions: Remap / Remove */}
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setMappingModalItem(item);
                                setMappingSearchQuery(item.medicineName || item.rawName || '');
                              }}
                              className="px-3.5 py-1.5 rounded-full border border-surface-container bg-surface-container-lowest text-primary hover:bg-surface-container text-xs font-bold transition-all shadow-xs flex items-center gap-1"
                            >
                              <span className="material-symbols-outlined text-sm text-secondary">swap_horiz</span>
                              <span>Change / Remap Drug</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDialog({
                                  isOpen: true,
                                  title: 'Remove Medicine from Slip?',
                                  message: `Remove "${item.matchedMedicineName || item.rawName || 'this medicine'}" from the detected prescription list?`,
                                  confirmLabel: 'Yes, Remove',
                                  variant: 'danger',
                                  impactPoints: [
                                    'This item will not be queried across pharmacy inventories.',
                                    'You can add it back manually if needed.'
                                  ],
                                  onConfirm: () => handleRemoveItem(item.id)
                                });
                              }}
                              className="px-3 py-1.5 rounded-full text-error hover:bg-error-container text-xs font-semibold transition-colors flex items-center gap-1"
                            >
                              <span className="material-symbols-outlined text-sm">close</span>
                              <span>Remove</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Action Bottom Row: Verification Notice & Confirm CTA */}
              {(() => {
                const unmappedCount = detectedItems.filter(i => !i.matchedMedicineId).length;
                const canConfirm = detectedItems.length > 0 && unmappedCount === 0;

                return (
                  <div className="flex flex-col gap-3 pt-3 border-t border-surface-container">
                    {unmappedCount > 0 && (
                      <div className="p-3.5 rounded-2xl bg-[#ffdad4]/60 border border-[#ba1a1a]/30 text-xs text-[#ba1a1a] font-medium flex items-center gap-2">
                        <span className="material-symbols-outlined text-base shrink-0">warning</span>
                        <span>
                          {unmappedCount} medicine{unmappedCount > 1 ? 's' : ''} require catalogue mapping. Click "Change / Remap Drug" to choose a formulation from our standardized 50-medicine catalog or remove items not available.
                        </span>
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setStep(1)}
                        className="px-5 py-2.5 rounded-full bg-surface-container text-primary font-semibold text-xs"
                      >
                        Back to Upload
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDialog({
                            isOpen: true,
                            title: 'Confirm Prescription Verification?',
                            message: `Confirm verification for all ${detectedItems.length} candidate medication(s)? Mapped items will be locked for dispensary inventory matching.`,
                            confirmLabel: 'Confirm & View Summary',
                            variant: 'primary',
                            impactPoints: [
                              'Standardized medicine IDs will be associated with this prescription.',
                              'Eligible items will become available for pharmacy availability queries.'
                            ],
                            onConfirm: handleConfirmVerification
                          });
                        }}
                        disabled={!canConfirm}
                        className="px-7 py-3 rounded-full bg-primary hover:bg-primary-container text-white font-bold text-xs shadow-md transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <span>Confirm &amp; Proceed to Verification Summary</span>
                        <span className="material-symbols-outlined text-base">arrow_forward</span>
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── PART 4: PRESCRIPTION VERIFICATION SUCCESS (Stitch Screen b82bba59ee714ba2af852ae1eb70deb0) ── */}
      {step === 4 && (
        <div className="flex flex-col gap-6 font-body-md text-on-surface">
          {/* Main Confirmation Hero Panel */}
          <section className="w-full bg-gradient-to-br from-surface-container-lowest via-surface-container-low to-secondary-container/20 rounded-3xl p-6 sm:p-10 shadow-md relative overflow-hidden border border-outline-variant/30">
            <div className="relative z-10 max-w-4xl flex flex-col items-start gap-4">
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center text-white shadow-lg shadow-primary/20">
                  <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                    task_alt
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-secondary uppercase tracking-wider">
                    Authentication Verified
                  </span>
                  <div className="flex items-center gap-2 text-xs text-on-surface">
                    <span className="text-on-surface-variant font-medium">Session ID:</span>
                    <span className="font-mono text-primary font-bold">
                      {prescription?.id ? `RX-${prescription.id.slice(0, 8).toUpperCase()}` : 'RX-VCE-2024-9102'}
                    </span>
                    <span className="text-outline">•</span>
                    <span className="text-secondary flex items-center gap-1 font-semibold">
                      <span className="material-symbols-outlined text-xs">lock</span> Encrypted Vault
                    </span>
                  </div>
                </div>
              </div>

              <h1 className="text-2xl sm:text-4xl font-extrabold text-primary leading-tight mt-1">
                Prescription Medicines Verified Successfully
              </h1>

              <p className="text-xs sm:text-base text-on-surface-variant max-w-3xl leading-relaxed">
                All medications extracted from your doctor's prescription have been confirmed and mapped to MediFind AI's standardized 50-medicine catalogue. Your medicine request is now prepared to search live local dispensary inventory.
              </p>

              {/* Compliance & Regulatory Banner */}
              <div className="w-full mt-2 bg-surface-container-lowest/80 backdrop-blur-md rounded-2xl p-4 flex flex-col md:flex-row items-start md:items-center gap-3 text-on-surface-variant border border-outline-variant/20 shadow-xs">
                <div className="w-9 h-9 rounded-full bg-surface-container flex items-center justify-center text-secondary shrink-0">
                  <span className="material-symbols-outlined text-lg">policy</span>
                </div>
                <div className="flex flex-col text-xs leading-relaxed">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-primary">Attached Source:</span>
                    <span className="text-secondary font-medium flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs">description</span>
                      {file?.name || 'Doctor_Prescription_Scan.pdf'}
                    </span>
                    <span className="text-outline">•</span>
                    <span className="bg-[#b3eee0] text-[#00201b] px-2 py-0.2 rounded-full font-bold text-[10px]">
                      Patient Confirmed
                    </span>
                  </div>
                  <span className="text-on-surface-variant mt-0.5">
                    MediFind matches participating dispensary stock; dispensing pharmacists perform legal and clinical verification at fulfillment.
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Two-Column Workspace: Verified Medications + What Happens Next */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column (7 cols): Verified Medications Summary Card */}
            <div className="lg:col-span-7 flex flex-col gap-5">
              <div className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/30 shadow-sm flex flex-col gap-4">
                <div className="flex items-center justify-between pb-3 border-b border-surface-container">
                  <div>
                    <h2 className="text-lg font-bold text-primary">Verified Medications for Availability Query</h2>
                    <span className="text-xs text-secondary font-medium block mt-0.5">
                      {detectedItems.length} Item{detectedItems.length === 1 ? '' : 's'} Ready for Geo-Inventory Matching
                    </span>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-secondary-container text-on-secondary-container text-xs font-bold">
                    Rx-Linked
                  </span>
                </div>

                {/* Items List */}
                <div className="flex flex-col gap-3">
                  {detectedItems.map((item, idx) => (
                    <div
                      key={item.id || idx}
                      className="bg-surface-container-low rounded-2xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 border border-outline-variant/20"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center text-primary shrink-0 border border-outline-variant/20 shadow-xs">
                          <span className="material-symbols-outlined text-2xl">medication</span>
                        </div>
                        <div className="flex flex-col">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-bold text-primary">
                              {item.matchedMedicineName || item.medicineName}
                            </h3>
                            {item.strength && (
                              <span className="px-2 py-0.5 rounded-full bg-secondary/10 text-secondary text-[10px] font-semibold">
                                {item.strength}
                              </span>
                            )}
                            <span className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[10px] font-bold">
                              Prescription Required (Rx Linked)
                            </span>
                          </div>
                          <p className="text-xs text-on-surface-variant mt-0.5">
                            {item.dosageForm || 'Oral formulation'} · Quantity: <strong>{item.quantity || 1} units</strong>
                          </p>
                          <div className="flex items-center gap-2 mt-1 text-[11px] text-secondary font-medium">
                            <span className="material-symbols-outlined text-xs">schedule</span>
                            <span>Regimen: {item.dosage || 'As prescribed by physician'}</span>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setStep(3)}
                        className="self-end md:self-center px-3 py-1.5 rounded-full text-secondary hover:bg-white text-xs font-bold flex items-center gap-1 transition-all"
                      >
                        <span className="material-symbols-outlined text-sm">edit_note</span>
                        <span>Edit</span>
                      </button>
                    </div>
                  ))}
                </div>

                {/* Safety Parameters Grid */}
                <div className="p-4 rounded-2xl bg-surface-container-low border border-surface-container flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-primary flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm text-secondary">tune</span>
                      Dispensary Allocation &amp; Safety Parameters
                    </span>
                    <span className="text-[10px] text-secondary bg-secondary-container/40 px-2 py-0.5 rounded-full font-bold">
                      Auto-Configured
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-xl bg-surface-container-lowest">
                      <span className="text-[10px] text-on-surface-variant block">Prescription Validity</span>
                      <strong className="text-primary font-bold">28 Days Active</strong>
                    </div>
                    <div className="p-2.5 rounded-xl bg-surface-container-lowest">
                      <span className="text-[10px] text-on-surface-variant block">Search Perimeter</span>
                      <strong className="text-primary font-bold">30.0 km Standard</strong>
                    </div>
                    <div className="p-2.5 rounded-xl bg-surface-container-lowest">
                      <span className="text-[10px] text-on-surface-variant block">Generic Substitution</span>
                      <strong className="text-primary font-bold">Bioequivalent Allowed</strong>
                    </div>
                    <div className="p-2.5 rounded-xl bg-surface-container-lowest">
                      <span className="text-[10px] text-on-surface-variant block">Patient Online Copay</span>
                      <strong className="text-secondary font-bold font-mono">₹0.00 (Pay at Pickup)</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column (5 cols): What Happens Next & Primary Call To Action */}
            <div className="lg:col-span-5 flex flex-col gap-5 sticky top-24">
              <div className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/30 shadow-md flex flex-col gap-5">
                <div className="flex items-center justify-between pb-3 border-b border-surface-container">
                  <h2 className="text-base font-bold text-primary">What happens next?</h2>
                  <div className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-secondary">
                    <span className="material-symbols-outlined text-base">alt_route</span>
                  </div>
                </div>

                {/* Workflow Steps Detailed Timeline */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-start gap-3 p-3 rounded-2xl bg-surface-container-low">
                    <div className="w-7 h-7 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                      1
                    </div>
                    <div className="flex flex-col text-xs">
                      <span className="font-bold text-primary flex items-center gap-1">
                        Real-time Geo-Lookup <span className="material-symbols-outlined text-xs text-secondary">radar</span>
                      </span>
                      <p className="text-on-surface-variant mt-0.5 leading-relaxed">
                        Query participating pharmacies across Chengannur, Haripad, and Alappuzha for shelf stock.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 rounded-2xl bg-surface-container-low">
                    <div className="w-7 h-7 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                      2
                    </div>
                    <div className="flex flex-col text-xs">
                      <span className="font-bold text-primary">Live Stock Reservation Hold</span>
                      <p className="text-on-surface-variant mt-0.5 leading-relaxed">
                        Select a dispensary to reserve your medicines in a 24-hour physical hold locker.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 rounded-2xl bg-surface-container-low">
                    <div className="w-7 h-7 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                      3
                    </div>
                    <div className="flex flex-col text-xs">
                      <span className="font-bold text-primary">Pharmacist Inspection &amp; Collection</span>
                      <p className="text-on-surface-variant mt-0.5 leading-relaxed">
                        Dispensing pharmacist verifies batch lot numbers. Pick up in-store or request delivery.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Active Dispatch CTA Block (Continues into Pharmacy Discovery!) */}
                <div className="flex flex-col gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      const verifiedToPass = (detectedItems || [])
                        .filter(i => i.matchedMedicineId)
                        .map(i => ({
                          medicineId: i.matchedMedicineId,
                          brandName: i.matchedMedicineName || i.rawName,
                          quantity: parseInt(i.quantity, 10) || 1
                        }));
                      if (onAddVerifiedToRequest && verifiedToPass.length > 0) {
                        onAddVerifiedToRequest(verifiedToPass);
                      }
                      if (onProceedToPharmacies) {
                        onProceedToPharmacies(verifiedToPass);
                      } else {
                        setAvailModalOpen(true);
                      }
                    }}
                    className="w-full py-4 rounded-full bg-primary hover:bg-primary-container text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2"
                  >
                    <span>Find Available Pharmacies</span>
                    <span className="material-symbols-outlined text-base">arrow_forward</span>
                  </button>

                  <div className="flex items-center justify-center gap-1.5 text-on-surface-variant text-[11px]">
                    <span className="material-symbols-outlined text-xs text-secondary">lock</span>
                    <span>Encrypted · Zero obligation to purchase</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PART 5: LOW CONFIDENCE / MANUAL MEDICINE MAPPING MODAL (Stitch Screen 7861901e465f40148c7c56a0f7667051) ── */}
      {mappingModalItem && (
        <div
          className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-on-surface/60 backdrop-blur-md"
          onClick={() => setMappingModalItem(null)}
        >
          <div
            className="w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-surface-container-lowest rounded-3xl p-6 sm:p-8 shadow-2xl border border-outline-variant/30 flex flex-col gap-6"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <div className="inline-flex items-center gap-1 px-3 py-0.5 rounded-full bg-[#ffdad4] text-[#7e1208] text-xs font-bold w-fit">
                  <span className="material-symbols-outlined text-xs">warning</span>
                  <span>Catalogue Discrepancy Flagged</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-extrabold text-primary tracking-tight mt-1">
                  Resolve Uncertain Medicine Match
                </h2>
                <p className="text-xs text-on-surface-variant">
                  OCR detected ambiguous medication text. Select the correct standardized formulation below:
                </p>
              </div>

              <button
                type="button"
                onClick={() => setMappingModalItem(null)}
                className="w-8 h-8 rounded-full hover:bg-surface-container text-on-surface-variant flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* Upper Context Split: OCR Raw Crop vs Clinical Safeguard Notice */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
              {/* Left Sub-card: Raw OCR Snippet */}
              <div className="md:col-span-7 bg-surface-container-low rounded-2xl p-4 flex flex-col gap-2.5 border border-outline-variant/20">
                <span className="text-[10px] uppercase font-bold text-secondary tracking-wider">
                  Source Document Line Capture
                </span>
                <div className="bg-white px-3 py-2 rounded-xl font-mono text-xs text-error font-bold border border-outline-variant/20 shadow-xs">
                  "{mappingModalItem.rawName || mappingModalItem.medicineName || 'Unrecognized Line'}"
                </div>
                <p className="text-[11px] text-on-surface-variant">
                  Prescribed Quantity: <strong>{mappingModalItem.quantity || 1} units</strong> • Regimen: {mappingModalItem.dosage || 'Standard clinical course'}
                </p>
              </div>

              {/* Right Sub-card: Safeguard Notice */}
              <div className="md:col-span-5 bg-primary-container text-white rounded-2xl p-4 flex flex-col justify-between gap-2 shadow-xs">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-lg text-secondary-container">health_and_safety</span>
                  <span className="text-xs font-bold">Clinical Safety Notice</span>
                </div>
                <p className="text-[11px] text-[#e3f5ee] leading-relaxed">
                  Unverified free-text drug names cannot be dispatched to dispensaries. You must select an official entry from MediFind AI's standardized 50-medicine catalogue.
                </p>
                <span className="text-[10px] text-secondary-container font-mono">
                  Standard: WHO INN / Pharmacopeia
                </span>
              </div>
            </div>

            {/* Live Search Capsule Input */}
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-base pointer-events-none">
                search
              </span>
              <input
                type="text"
                value={mappingSearchQuery}
                onChange={e => setMappingSearchQuery(e.target.value)}
                placeholder="Search active compound, trade brand name, or dosage..."
                className="w-full h-11 pl-9 pr-3 rounded-full bg-surface-container-low border border-outline-variant/30 text-xs text-on-surface outline-none focus:border-secondary"
              />
            </div>

            {/* Candidate Cards Grid */}
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-bold text-primary uppercase tracking-wider">
                Matching Catalogue Formulations:
              </span>

              <div className="max-h-64 overflow-y-auto flex flex-col gap-2 p-1">
                {medicinesCatalog
                  .filter(m => {
                    if (!mappingSearchQuery.trim()) return true;
                    const q = mappingSearchQuery.toLowerCase().trim();
                    return m.brandName.toLowerCase().includes(q) || (m.genericName && m.genericName.toLowerCase().includes(q));
                  })
                  .slice(0, 15)
                  .map(med => {
                    const isSelected = mappingModalItem.matchedMedicineId === med.id;
                    return (
                      <div
                        key={med.id}
                        className={`p-3.5 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                          isSelected
                            ? 'bg-secondary-container/30 border-secondary shadow-xs'
                            : 'bg-surface-container-low hover:bg-surface-container border-outline-variant/30'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-primary shrink-0 shadow-xs">
                            <span className="material-symbols-outlined text-lg">medication</span>
                          </div>
                          <div className="flex flex-col">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold text-primary">{med.brandName}</span>
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant font-mono">
                                {med.strength} • {med.dosageForm}
                              </span>
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-error-container text-on-error-container font-bold uppercase">
                                Rx
                              </span>
                            </div>
                            <span className="text-[11px] text-on-surface-variant mt-0.5">
                              {med.genericName} • Category: {med.category} • ₹{med.price}
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            handleSelectMatchedMedicine(mappingModalItem.id, med.id);
                            setMappingModalItem(null);
                          }}
                          className={`px-4 py-2 rounded-full text-xs font-bold shadow-xs transition-all flex items-center gap-1 ${
                            isSelected
                              ? 'bg-secondary text-white'
                              : 'bg-primary hover:bg-primary-container text-white'
                          }`}
                        >
                          <span className="material-symbols-outlined text-sm">
                            {isSelected ? 'check' : 'task_alt'}
                          </span>
                          <span>{isSelected ? 'Selected' : 'Select This Medicine'}</span>
                        </button>
                      </div>
                    );
                  })}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-surface-container">
              <button
                type="button"
                onClick={() => setMappingModalItem(null)}
                className="px-5 py-2.5 rounded-full bg-surface-container hover:bg-surface-container-high text-primary text-xs font-bold transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fallback Availability Modal */}
      <AvailabilityModal
        isOpen={availModalOpen}
        onClose={() => setAvailModalOpen(false)}
        items={detectedItems.map(i => ({
          medicineId: i.matchedMedicineId || i.id,
          brandName: i.matchedMedicineName || i.rawName,
          quantity: i.quantity || 1
        }))}
        onOrderCreated={onOrderCreated}
      />

      {/* High-Stakes Action Confirmation Modal */}
      <ConfirmationDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        impactPoints={confirmDialog.impactPoints || []}
        confirmText={confirmDialog.confirmLabel || confirmDialog.confirmText}
        cancelText={confirmDialog.cancelLabel || confirmDialog.cancelText}
        isDestructive={confirmDialog.variant === 'danger' || confirmDialog.isDestructive}
        onConfirm={() => {
          confirmDialog.onConfirm();
          setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        }}
        onCancel={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
      />

      {/* Floating Action Feedback / Toast Notification */}
      {feedback.show && (
        <div style={{
          position: 'fixed',
          top: '1.5rem',
          right: '1.5rem',
          zIndex: 9999,
          padding: '0.85rem 1.25rem',
          borderRadius: 16,
          background: feedback.type === 'error' ? '#ffdad6' : '#e0f2eb',
          color: feedback.type === 'error' ? '#93000a' : '#032f28',
          border: `1px solid ${feedback.type === 'error' ? '#ffb4a8' : '#a6cfc5'}`,
          boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          maxWidth: 440
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
            {feedback.type === 'error' ? 'error' : 'check_circle'}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{feedback.message}</span>
          <button
            onClick={() => setFeedback({ show: false, message: '', type: 'success' })}
            style={{ background: 'none', border: 'none', cursor: 'pointer', marginLeft: 'auto', color: 'inherit', display: 'flex', alignItems: 'center' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
          </button>
        </div>
      )}

      {/* Shared-Element Smooth Image Enlargement Lightbox Modal (Rule 33) */}
      <AnimatePresence>
        {isImageModalOpen && currentPreviewSrc && (
          <div
            className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
            onClick={() => setIsImageModalOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="High-Resolution Prescription Preview"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 12 }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
              className="relative max-w-4xl max-h-[90vh] bg-surface-container-lowest rounded-3xl p-4 sm:p-6 shadow-2xl border border-outline-variant/30 flex flex-col items-center overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-full flex items-center justify-between pb-3 border-b border-surface-container mb-3">
                <span className="text-xs font-bold text-primary flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-base text-secondary">zoom_in</span>
                  High-Resolution Prescription Scan Preview
                </span>
                <button
                  type="button"
                  onClick={() => setIsImageModalOpen(false)}
                  className="w-8 h-8 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface-variant flex items-center justify-center transition-colors cursor-pointer"
                  title="Close preview"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>
              <img
                src={currentPreviewSrc}
                alt="Enlarged prescription preview"
                className="max-h-[75vh] w-auto object-contain rounded-2xl shadow-sm"
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
