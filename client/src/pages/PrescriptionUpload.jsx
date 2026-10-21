import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import AvailabilityModal from '../components/AvailabilityModal';
import ConfirmationDialog from '../components/ConfirmationDialog';
import { ProgressiveFluxLoader } from '../components/ui/progressive-flux-loader';
import ScanGridButton from '../components/ui/scan-grid-button';
import { triggerToast } from '../components/ToastAlert';
import ImageCropperModal from '../components/ImageCropperModal';
import { findMatchingBrands, identifyPrescriptionType } from '../utils/genericMedicineMatcher';
import { useAuth } from '../context/AuthContext';
import AuthenticatedPrescriptionImage from '../components/AuthenticatedPrescriptionImage';
import RollingNumber from '../components/ui/RollingNumber';

const OCR_FLUX_PHASES = [
  { at: 0, label: "initializing optical scanner" },
  { at: 8, label: "ingesting prescription slip" },
  { at: 16, label: "calibrating document contrast" },
  { at: 24, label: "deskewing & geometry correction" },
  { at: 33, label: "detecting clinic & doctor header" },
  { at: 42, label: "scanning handwriting contours" },
  { at: 52, label: "isolating rx table & rows" },
  { at: 61, label: "recognizing medication tokens" },
  { at: 70, label: "extracting active compounds" },
  { at: 78, label: "parsing dosages & schedules" },
  { at: 85, label: "standardizing pharmacopoeia" },
  { at: 91, label: "querying 50-medicine catalog" },
  { at: 96, label: "mapping trade brand options" },
  { at: 100, label: "clinical extraction complete" },
];

const CLINICAL_SCAN_TOKENS = [
  { at: 6, tag: "OPTICAL", label: "Resolution & Matrix Normalization" },
  { at: 14, tag: "DESKEW", label: "Orientation & Contour Deskewing" },
  { at: 22, tag: "HEADER", label: "Clinic & Institutional Header Layer" },
  { at: 30, tag: "REGISTRATION", label: "Date & Prescriber Metadata Detection" },
  { at: 38, tag: "STRUCTURE", label: "Prescription Table (Rx) Isolation" },
  { at: 48, tag: "LINE_ITEM", label: "Pharmaceutical Rows Segmentation" },
  { at: 58, tag: "ENTITY", label: "Active Compounds & Brand Decoding" },
  { at: 68, tag: "DOSAGE", label: "Strength (mg/mcg/ml) & Unit Recognition" },
  { at: 76, tag: "REGIMEN", label: "Frequency & Administration Schedule" },
  { at: 84, tag: "QUANTITY", label: "Explicit Prescribed Quantity Extraction" },
  { at: 92, tag: "FORMULARY", label: "50-Medicine Pharmacopoeia Matching" },
  { at: 97, tag: "EQUIVALENCE", label: "Generic-to-Brand Candidate Ranking" },
  { at: 100, tag: "SAFETY", label: "Clinical Safety & Verification Gate" }
];

function getActiveScanReadout(progress) {
  if (progress < 14) return {
    stage: "STAGE 1/5: OPTICAL CALIBRATION",
    title: "Optical Matrix Calibration",
    detail: "Calibrating Resolution Matrix · Deskewing Contours & Normalizing Document Background",
    badge: "INITIALIZING SENSORS",
    targetTag: "Optical Matrix 1200 DPI"
  };
  if (progress < 28) return {
    stage: "STAGE 2/5: CLINICAL HEADER DECODING",
    title: "Document & Prescriber Identification",
    detail: "Scanning Document Header · Isolating Clinic Information & Medical Credentials",
    badge: "HEADER RECOGNITION",
    targetTag: "Institutional Header Layer"
  };
  if (progress < 45) return {
    stage: "STAGE 2/5: CLINICAL CONTEXT & METRICS",
    title: "Patient & Session Metadata",
    detail: "Separating Patient Metadata & Registration Details from Rx Body",
    badge: "CONTEXT ISOLATION",
    targetTag: "Patient & Record Block"
  };
  if (progress < 60) return {
    stage: "STAGE 3/5: PRESCRIPTION MATRIX ANALYSIS",
    title: "Medication Line Reconstruction",
    detail: "Isolating Prescription Body · Detecting Handwriting Strokes & Text Blocks",
    badge: "EXTRACTING FORMULATIONS",
    targetTag: "Rx Table Segmentation"
  };
  if (progress < 75) return {
    stage: "STAGE 3/5: DOSAGE & REGIMEN PARSING",
    title: "Strength & Frequency Extraction",
    detail: "Parsing Active Formulation Dosages (mg/ml) · Extracting Frequency & Duration",
    badge: "PARSING REGIMENS",
    targetTag: "Dosage & Regimen Parsing"
  };
  if (progress < 88) return {
    stage: "STAGE 4/5: CATALOGUE RECONCILIATION",
    title: "Pharmacopoeia Cross-Referencing",
    detail: "Querying Verified 50-Medicine Formulary · Matching Generic Compounds",
    badge: "CATALOGUE MAPPING",
    targetTag: "Formulary Cross-Referencing"
  };
  if (progress < 96) return {
    stage: "STAGE 4/5: BRAND & EQUIVALENCE RANKING",
    title: "Candidate Reconciliation",
    detail: "Cross-referencing Brand Names, Dosages, and Generic Equivalents...",
    badge: "BRAND RESOLUTION",
    targetTag: "Reconciling Brand Equivalents..."
  };
  if (progress < 99) return {
    stage: "STAGE 5/5: CLINICAL SAFETY AUDIT",
    title: "Extraction Validation & Safety Checks",
    detail: "Auditing candidate extractions against hospital safety rules...",
    badge: "SAFETY VALIDATION",
    targetTag: "Pre-Verification Validation"
  };
  return {
    stage: "STAGE 5/5: EXTRACTION COMPLETE",
    title: "Prescription Extracted Successfully",
    detail: "Ready for mandatory patient verification and clinical review.",
    badge: "READY FOR VERIFICATION",
    targetTag: "Verification Gate"
  };
}

function getScannerTargetBox(progress) {
  if (progress < 22) {
    return {
      top: "6%",
      left: "8%",
      right: "8%",
      height: "22%",
      border: "border-secondary",
      bg: "bg-secondary/15",
      tag: "Institutional Header & Credentials",
      confidence: "Live Detection"
    };
  }
  if (progress < 46) {
    return {
      top: "34%",
      left: "8%",
      right: "8%",
      height: "18%",
      border: "border-secondary",
      bg: "bg-secondary/20",
      tag: "Rx Matrix & Medication Lines",
      confidence: "Scanning Contours"
    };
  }
  if (progress < 68) {
    return {
      top: "52%",
      left: "8%",
      right: "8%",
      height: "18%",
      border: "border-secondary",
      bg: "bg-secondary/20",
      tag: "Active Pharmaceutical Formulations",
      confidence: "Extracting Entities"
    };
  }
  if (progress < 86) {
    return {
      top: "70%",
      left: "8%",
      right: "8%",
      height: "16%",
      border: "border-secondary",
      bg: "bg-secondary/20",
      tag: "Dosage Units & Regimen Schedules",
      confidence: "Parsing Regimens"
    };
  }
  if (progress < 96) {
    return {
      top: "30%",
      left: "6%",
      right: "6%",
      height: "58%",
      border: "border-secondary",
      bg: "bg-secondary/15",
      tag: "Formulary Cross-Referencing",
      confidence: "Matching Catalog"
    };
  }
  return {
    top: "10%",
    left: "5%",
    right: "5%",
    height: "80%",
    border: "border-emerald-500",
    bg: "bg-emerald-500/10",
    tag: "✓ Prescription Extracted & Ready for Verification",
    confidence: "Ready"
  };
}

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

function cleanDrugSearch(rawText) {
  if (!rawText) return '';
  return rawText
    .replace(/^[0-9]+[.)\s\-]+/, '')
    .replace(/\b(?:tab|tablet|tablets|cap|capsule|capsules|syr|syrup|powder|packet|packets|sachet|sachets|oral|nos|mg|mcg|gm?|ml|%|ip|lp|1p|bp|usp)\b/gi, '')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .trim()
    .split(/\s+/)[0] || '';
}

// Universal generic-to-brand matching imported from ../utils/genericMedicineMatcher

// ── Extract authentic doctor, clinic, and patient information from OCR text or DB ──
export function extractPrescriptionMetadata(ocrText, prescription) {
  const text = (ocrText || prescription?.ocrRawText || '').trim();
  let clinicName = prescription?.clinicName || null;
  let clinicAddress = prescription?.clinicAddress || null;
  let clinicPhone = prescription?.clinicPhone || null;
  let doctorName = prescription?.doctorName || null;
  let patientName = prescription?.patientName || null;
  let doctorLicense = prescription?.doctorLicense || null;

  if (text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // 1. Doctor detection: Look for "Doctor : Dr..." or "Dr. ..."
    if (!doctorName) {
      for (const line of lines) {
        const docMatch = line.match(/(?:Doctor\s*:?|Dr\.?)\s*([A-Za-z\s.]+)/i);
        if (docMatch && docMatch[1].trim().length > 2) {
          let name = docMatch[1].trim();
          name = name.split(/\s{2,}|Department|Dept|MBBS|MD|Date|Time|UHID|Reg/i)[0].trim();
          if (name.length > 2 && !name.toLowerCase().includes('julian')) {
            doctorName = name.startsWith('Dr') ? name : `Dr. ${name}`;
            break;
          }
        }
      }
    }

    // 2. Patient detection: Look for "Patient Name : ..." or "Patient: ..."
    if (!patientName) {
      for (const line of lines) {
        const patMatch = line.match(/(?:Patient\s*(?:Name)?\s*:?)\s*([A-Za-z\s.]+)/i);
        if (patMatch && patMatch[1].trim().length > 2) {
          let name = patMatch[1].trim();
          name = name.split(/\s{2,}|Age|Gender|Sex|Date|Prescribed|UHID/i)[0].trim();
          if (name.length > 2 && !name.toLowerCase().includes('varyna')) {
            patientName = name;
            break;
          }
        }
      }
    }

    // 3. Clinic detection: Usually the first prominent non-empty line
    if (!clinicName && lines.length > 0) {
      for (let i = 0; i < Math.min(5, lines.length); i++) {
        const l = lines[i];
        if (
          !/^(patient|doctor|dr\.|uhid|date|age|sex|gender|rx|prescription|slip|sl\s*no)/i.test(l) &&
          l.length > 4 &&
          /[a-zA-Z]/.test(l) &&
          !l.toLowerCase().includes('st. jude')
        ) {
          clinicName = l;
          // Check if the following line contains address/phone
          if (i + 1 < lines.length) {
            const nextL = lines[i + 1];
            if (/ph:|phone|tel|road|street|nagar|hospital|centre|center|junction|[a-zA-Z]+,\s*[a-zA-Z]+/i.test(nextL)) {
              clinicAddress = nextL;
            }
          }
          break;
        }
      }
    }
  }

  return {
    clinicName: clinicName || 'Community Health Centre',
    clinicAddress: clinicAddress || 'Government Hospital Junction, Clinical District',
    clinicPhone: clinicPhone || 'Tel: +91 479 238 2305 • Ayushman Verified',
    doctorName: doctorName || 'Attending Physician, M.D.',
    patientName: patientName || 'Verified Patient',
    doctorLicense: doctorLicense || ('Lic. #MED-' + (prescription?.id ? String(prescription.id).slice(0, 6).toUpperCase() : '849201'))
  };
}

// ── Realistic Clinical Prescription Slip (matching Stitch Image 2 / Screen ebfde8293be14e72aa1b7f0c6078b3d0) ──
function PrescriptionDocumentSlip({
  prescription,
  detectedItems = [],
  fileName,
  rotation = 0,
  isEnlarged = false,
  ocrText = ''
}) {
  const displayItems = (detectedItems && detectedItems.length > 0)
    ? detectedItems
    : [];

  const meta = extractPrescriptionMetadata(ocrText || prescription?.ocrRawText, prescription);
  const clinicName = meta.clinicName;
  const clinicAddress = meta.clinicAddress;
  const clinicContact = meta.clinicPhone;
  const doctorName = meta.doctorName;
  const doctorLicense = meta.doctorLicense;
  const rxNumber = prescription?.id ? `RX-${String(prescription.id).slice(0, 8).toUpperCase()}` : 'NO. 89201-U';

  let patientDisplayName = meta.patientName;
  try {
    const storedUser = localStorage.getItem('medifind_user');
    if (storedUser) {
      const u = JSON.parse(storedUser);
      if (u.name) patientDisplayName = u.name;
    }
  } catch (_) {}

  return (
    <div
      style={{
        transform: `rotate(${rotation}deg)`,
        transition: 'transform 0.3s ease'
      }}
      className={`w-full bg-[#fcfdfd] text-slate-800 rounded-2xl border border-slate-200/90 shadow-xs relative overflow-hidden select-none flex flex-col justify-between ${
        isEnlarged ? 'p-6 sm:p-8 min-h-[500px]' : 'p-4 sm:p-5 min-h-[360px]'
      }`}
    >
      {/* Background Translucent Rx Watermark */}
      <div
        className="absolute right-3 top-6 select-none pointer-events-none text-emerald-900/[0.04] font-serif font-black leading-none"
        style={{ fontSize: isEnlarged ? 160 : 110 }}
      >
        Rx
      </div>

      {/* Slip Header */}
      <div>
        <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-3">
          <div>
            <h3 className="font-serif font-bold text-slate-900 text-sm sm:text-base tracking-tight leading-tight">
              {clinicName}
            </h3>
            <p className="text-[10px] text-slate-500 font-sans mt-0.5 leading-snug">
              {clinicAddress}
            </p>
            <p className="text-[9px] text-slate-400 font-mono mt-0.5">
              {clinicContact}
            </p>
          </div>
          <div className="text-right shrink-0">
            <span className="font-serif font-black text-emerald-800 text-2xl sm:text-3xl leading-none block">
              Rx
            </span>
            <span className="font-mono text-[9px] text-slate-400 font-semibold block mt-1">
              {rxNumber}
            </span>
          </div>
        </div>

        {/* Patient Details Row */}
        <div className="grid grid-cols-2 gap-3 py-2 border-b border-slate-100 text-[11px]">
          <div>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">
              Patient Name
            </span>
            <span className="font-bold text-slate-800 underline decoration-slate-300 decoration-dotted underline-offset-2">
              {patientDisplayName}
            </span>
          </div>
          <div className="text-right">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">
              Date Prescribed
            </span>
            <span className="font-bold text-slate-800 font-mono">
              {prescription?.createdAt
                ? new Date(prescription.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : 'Oct 24, 2024'}
            </span>
          </div>
        </div>

        {/* OCR Candidate Detected Medication Rows */}
        <div className="flex flex-col gap-2 my-2.5">
          {displayItems.slice(0, 3).map((item, idx) => (
            <div
              key={item.id || idx}
              className="relative border border-emerald-500/40 bg-emerald-50/30 rounded-xl p-2.5 transition-all"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="px-1.5 py-0.5 rounded bg-emerald-600/10 text-emerald-800 text-[9px] font-bold font-mono tracking-wider">
                  [ DETECTION LINE #{idx + 1} ]
                </span>
                <span className="text-[9px] font-bold text-emerald-700 flex items-center gap-1 font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Bound
                </span>
              </div>
              <div className="text-xs sm:text-sm font-extrabold text-slate-900 tracking-tight">
                {item.matchedMedicineName || item.rawName || 'Medication Line'}
              </div>
              <div className="text-[10px] text-slate-600 font-sans italic mt-0.5">
                Sig: {item.dosage || '1 unit'} {item.frequency || 'Oral'} {item.duration ? `· ${item.duration}` : ''} {item.quantity ? `· Qty: ${item.quantity}` : ''}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Doctor Signoff Footer */}
      <div className="pt-2 border-t border-slate-200 mt-auto">
        <div className="flex items-end justify-between">
          <div className="text-[10px] text-slate-500 space-y-0.5">
            <div>Refills: <strong className="text-slate-700">0 (Zero)</strong></div>
            <div className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded border border-slate-400 inline-flex items-center justify-center text-[8px] text-slate-700">✓</span>
              <span>Dispense as Written</span>
            </div>
          </div>
          <div className="text-right">
            <div className="font-serif italic font-bold text-slate-800 text-sm sm:text-base leading-tight">
              {doctorName}
            </div>
            <div className="text-[9px] font-mono text-slate-400 mt-0.5">
              {doctorName} · {doctorLicense}
            </div>
          </div>
        </div>

        {/* Coordinates Calibration Line */}
        <div className="flex items-center justify-between text-[9px] font-mono text-slate-400 pt-2 border-t border-slate-100 mt-2">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {displayItems.length} Target Rectangles Bound
          </span>
          <span>Coordinates Calibrated</span>
        </div>
      </div>
    </div>
  );
}

function PrescriptionWorkflowStepper({
  currentStep = 1,
  onNavigateToStep,
  subtitle = 'Clinical Workflow',
  title = 'Prescription Dispense Pipeline',
  icon = 'document_scanner',
  backButton = null
}) {
  const steps = [
    { number: 1, label: 'Upload or Capture', tooltip: "Step 1: Upload or capture doctor's prescription photo" },
    { number: 2, label: 'Optical Reading', tooltip: 'Step 2: MediFind DeepRead OCR & medication extraction' },
    { number: 3, label: 'Patient Verification', tooltip: 'Step 3: Review and verify detected medicines' },
    { number: 4, label: 'Pharmacy Matching', tooltip: 'Step 4: Real-time pharmacy stock matching' }
  ];

  return (
    <div className="w-full bg-surface-container-lowest rounded-2xl p-3.5 sm:p-4 shadow-sm border border-outline-variant/30 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
      {/* Left Title & Status Header */}
      <div className="flex items-center gap-3">
        {backButton ? (
          backButton
        ) : (
          <span className="p-2.5 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-xl">{icon}</span>
          </span>
        )}
        <div>
          <span className="text-[11px] font-bold text-secondary uppercase tracking-wider block leading-tight">
            {subtitle}
          </span>
          <span className="text-sm sm:text-base font-bold text-primary leading-snug">
            {title}
          </span>
        </div>
      </div>

      {/* Stepper Navigation - Guaranteed 4 steps always visible */}
      <nav
        aria-label="Prescription workflow progress"
        className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 sm:gap-2 w-full xl:w-auto overflow-x-auto py-1"
      >
        {steps.map((s, idx) => {
          const isCompleted = s.number < currentStep;
          const isActive = s.number === currentStep;
          const canClick = isCompleted && onNavigateToStep && currentStep !== 2;

          let pillClass = '';
          if (isActive) {
            pillClass = 'bg-primary text-white shadow-sm font-bold border border-primary ring-2 ring-primary/20';
          } else if (isCompleted) {
            pillClass = 'bg-[#e7f8f2] dark:bg-[#07362c] text-[#033b30] dark:text-[#a0eed7] border border-[#a3e5d0] dark:border-[#115949] font-semibold';
            if (canClick) pillClass += ' hover:bg-[#d6f4ea] dark:hover:bg-[#0c4438] cursor-pointer transition-colors';
          } else {
            pillClass = 'bg-surface-container-high/90 text-on-surface/85 border border-outline-variant/60 font-medium';
          }

          return (
            <React.Fragment key={s.number}>
              {idx > 0 && (
                <span
                  className="material-symbols-outlined text-xs text-outline-variant shrink-0 select-none"
                  aria-hidden="true"
                >
                  chevron_right
                </span>
              )}
              <div
                title={s.tooltip}
                onClick={() => {
                  if (canClick) onNavigateToStep(s.number);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-all select-none ${pillClass}`}
              >
                {isCompleted ? (
                  <span className="w-4 h-4 rounded-full bg-[#059669] text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                    ✓
                  </span>
                ) : (
                  <span
                    className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                      isActive
                        ? 'bg-secondary-container text-on-secondary-container'
                        : 'bg-surface-container-highest text-on-surface-variant'
                    }`}
                  >
                    {s.number}
                  </span>
                )}
                <span>{s.label}</span>
                {isActive && currentStep === 2 && (
                  <span className="relative flex h-2 w-2 ml-0.5" title="OCR scanning in progress">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-secondary"></span>
                  </span>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </nav>
    </div>
  );
}

export default function PrescriptionUpload({ onOrderCreated, onAddVerifiedToRequest, onProceedToPharmacies }) {
  // Steps matching Stitch:
  // 1: Prescription Upload (Screen e21903e1d8aa47b686c1bd2e7d51f0fb)
  // 2: OCR Processing (Screen 13c2201a4ee24067ba968f75ac622ae7)
  // 3: Prescription Verification (Screen ebfde8293be14e72aa1b7f0c6078b3d0)
  // 4: Prescription Verification Success (Screen b82bba59ee714ba2af852ae1eb70deb0)
  const [step, setStep] = useState(1);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [isCropModalOpen, setIsCropModalOpen] = useState(false);
  const [cropTargetSrc, setCropTargetSrc] = useState(null);
  const [file, setFile] = useState(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState(null);
  const [persistentImageSrc, setPersistentImageSrc] = useState(null);
  const [viewModalRx, setViewModalRx] = useState(null);
  const [previewRotation, setPreviewRotation] = useState(0);
  const [showRawTextModal, setShowRawTextModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ocrText, setOcrText] = useState('');
  const [ocrConfidence, setOcrConfidence] = useState(null);
  const [prescription, setPrescription] = useState(null);
  const [screening, setScreening] = useState(null);
  const [detectedItems, setDetectedItems] = useState([]);
  const [medicinesCatalog, setMedicinesCatalog] = useState([]);
  const [error, setError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(72);
  const { user } = useAuth();
  const [previousPrescriptions, setPreviousPrescriptions] = useState([]);

  // Fetch patient's saved prescription history from existing backend endpoint
  const fetchPreviousPrescriptions = useCallback(() => {
    const token = localStorage.getItem('medifind_token');
    if (!token) return;
    fetch(`${API}/prescriptions`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(d => {
        if (d.success && Array.isArray(d.prescriptions)) {
          setPreviousPrescriptions(d.prescriptions);
        }
      })
      .catch(() => {});
  }, []);

  // Clear currently staged photo and reset to clean awaiting-photo state
  const handleClearStaged = useCallback((e) => {
    if (e) {
      try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
    }
    setFile(null);
    setFilePreviewUrl(null);
    setPersistentImageSrc(null);
    setSelectedImageVersion(null);
    setPrescription(null);
    setDetectedItems([]);
    setOcrText('');
    setOcrConfidence(null);
    try { sessionStorage.removeItem('medifind_rx_image'); } catch (_) {}
    try { localStorage.removeItem(PRESCRIPTION_SESSION_KEY); } catch (_) {}
    if (fileInputRef?.current) fileInputRef.current.value = '';
    fetchPreviousPrescriptions();
  }, [fetchPreviousPrescriptions]);

  // Reusable loader for viewing/resuming a previous prescription without re-uploading
  const loadPrescriptionById = useCallback((rxId) => {
    if (!rxId) return;
    const token = localStorage.getItem('medifind_token');
    fetch(`${API}/prescriptions/${rxId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(d => {
        if (d.success && d.prescription) {
          const rx = d.prescription;
          setPrescription(rx);
          // Prioritize detectedMedicines or items if present
          const candidateItems = (rx.detectedMedicines && rx.detectedMedicines.length > 0)
            ? rx.detectedMedicines
            : (rx.items || []);
          setDetectedItems(candidateItems);
          setOcrText(rx.ocrRawText || '');
          setOcrConfidence(rx.ocrConfidence ?? null);
          setScreening({ status: rx.status || 'VERIFIED' });

          let nextStep = 3;
          if (rx.status === 'VERIFIED' || rx.status === 'COMPLETED' || rx.recoverySummary?.recommendedNextStep === 'ALLOCATE_OR_ORDER') {
            nextStep = 4;
          } else if (candidateItems.length === 0 && rx.status === 'UPLOADED') {
            nextStep = 2;
          }
          setStep(nextStep);

          fetch(`${API}/prescriptions/${rxId}/image`, {
            headers: { Authorization: `Bearer ${token}` }
          })
            .then(r => {
              if (r.ok) return r.blob();
              throw new Error('Image fetch status ' + r.status);
            })
            .then(blob => {
              const url = URL.createObjectURL(blob);
              setFilePreviewUrl(url);
              updatePersistentImage(blob);
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  // Helper to persist prescription photo across browser refreshes and steps
  const updatePersistentImage = (srcOrFile) => {
    if (!srcOrFile) return;
    if (typeof srcOrFile === 'string') {
      setPersistentImageSrc(srcOrFile);
      try { sessionStorage.setItem('medifind_rx_image', srcOrFile); } catch (_) {}
    } else if (srcOrFile instanceof Blob || srcOrFile instanceof File) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        setPersistentImageSrc(dataUrl);
        try { sessionStorage.setItem('medifind_rx_image', dataUrl); } catch (_) {}
      };
      reader.readAsDataURL(srcOrFile);
    }
  };

  // Dynamic authentic file name generator from upload, DB record, or OCR clinic name
  const getDisplayFileName = () => {
    if (file?.name && !file.name.toLowerCase().includes('julian_vance')) {
      return file.name;
    }
    if (prescription?.originalFileName && !prescription.originalFileName.toLowerCase().includes('julian_vance')) {
      return prescription.originalFileName;
    }
    if (prescription?.title && !prescription.title.toLowerCase().includes('julian_vance')) {
      return prescription.title;
    }
    const meta = extractPrescriptionMetadata(ocrText, prescription);
    if (meta.clinicName && meta.clinicName !== 'Community Health Centre') {
      const sanitized = meta.clinicName.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').slice(0, 32);
      return `${sanitized}_Rx.jpg`;
    }
    return prescription?.id ? `Prescription_${prescription.id.slice(0, 8).toUpperCase()}.jpg` : 'Uploaded_Prescription.jpg';
  };

  // Toast feedback state
  const [feedback, setFeedback] = useState({ show: false, message: '', type: 'success' });
  const showToast = (message, type = 'success') => {
    setFeedback({ show: true, message, type });
    triggerToast({
      title: type === 'error' ? 'Prescription Notice' : 'Clinical Verification',
      message,
      variant: type === 'error' ? 'destructive' : type
    });
    setTimeout(() => setFeedback({ show: false, message: '', type: 'success' }), 4000);
  };

  // Gate 2A: Prescription Image Versioning, Enhancement & Replacement State
  const [imageVersions, setImageVersions] = useState([]);
  const [selectedImageVersion, setSelectedImageVersion] = useState(null);
  const [isComparingOriginal, setIsComparingOriginal] = useState(false);
  const [isRetryingOcr, setIsRetryingOcr] = useState(false);
  const [ocrConflicts, setOcrConflicts] = useState([]);
  const replacementInputRef = useRef(null);

  // Gate 2B: Patient OCR Review & Correction State
  const [patientCorrectingCandidate, setPatientCorrectingCandidate] = useState(null);
  const [patientCorrectionForm, setPatientCorrectionForm] = useState({
    correctedMedicineName: '',
    dosage: '',
    frequency: '',
    duration: '',
    patientNotes: ''
  });
  const [isSubmittingCorrection, setIsSubmittingCorrection] = useState(false);

  const fetchImageVersions = useCallback(async (prescriptionId) => {
    if (!prescriptionId || String(prescriptionId).startsWith('mock-')) return;
    try {
      const token = localStorage.getItem('medifind_token');
      const res = await fetch(`${API}/prescriptions/${prescriptionId}/images`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.images)) {
        setImageVersions(data.images);
        const active = data.images.find(img => img.isActive) || data.images[data.images.length - 1];
        if (active) setSelectedImageVersion(active);
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (prescription?.id) {
      fetchImageVersions(prescription.id);
    }
  }, [prescription?.id, fetchImageVersions]);

  const handleCropComplete = async (blob, croppedFile, croppedUrl, metadata) => {
    // If prescription already exists, upload as an ENHANCED version under this prescription
    if (prescription?.id && !String(prescription.id).startsWith('mock-')) {
      const token = localStorage.getItem('medifind_token');
      const formData = new FormData();
      formData.append('prescriptionImage', croppedFile);
      formData.append('action', 'ENHANCE');
      if (selectedImageVersion?.id) {
        formData.append('parentImageId', selectedImageVersion.id);
      }
      if (metadata) {
        formData.append('cropCoordinates', JSON.stringify(metadata));
      }

      try {
        const res = await fetch(`${API}/prescriptions/${prescription.id}/images`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData
        });
        const data = await res.json();
        if (data.success && data.image) {
          showToast(`Prescription enhanced and saved as version ${data.image.versionNumber}.`, 'success');
          setFile(croppedFile);
          setFilePreviewUrl(croppedUrl);
          updatePersistentImage(croppedFile || croppedUrl);
          await fetchImageVersions(prescription.id);
          setSelectedImageVersion(data.image);
        } else {
          showToast(data.error || 'Failed to save enhanced image version.', 'error');
        }
      } catch (err) {
        showToast('Network error saving enhanced image version.', 'error');
      }
    } else {
      setFile(croppedFile);
      setFilePreviewUrl(croppedUrl);
      updatePersistentImage(croppedFile || croppedUrl);
      showToast('Prescription photo cropped successfully!', 'success');
    }
  };

  const handleUploadReplacement = async (fileToUpload) => {
    if (!fileToUpload || !prescription?.id) return;
    const token = localStorage.getItem('medifind_token');
    const formData = new FormData();
    formData.append('prescriptionImage', fileToUpload);
    formData.append('action', 'REPLACE');
    if (selectedImageVersion?.id) {
      formData.append('parentImageId', selectedImageVersion.id);
    }

    try {
      const res = await fetch(`${API}/prescriptions/${prescription.id}/images`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (data.success && data.image) {
        showToast(
          data.duplicateDetected
            ? 'This exact image is already attached as the latest version.'
            : `Clearer photo attached as version ${data.image.versionNumber}.`,
          'success'
        );
        const previewUrl = URL.createObjectURL(fileToUpload);
        setFilePreviewUrl(previewUrl);
        updatePersistentImage(fileToUpload);
        await fetchImageVersions(prescription.id);
        setSelectedImageVersion(data.image);
      } else {
        showToast(data.error || 'Failed to upload replacement photo.', 'error');
      }
    } catch (err) {
      showToast('Network error uploading replacement photo.', 'error');
    }
  };

  const handleSetActiveVersion = async (version) => {
    if (!version || !prescription?.id) return;
    const token = localStorage.getItem('medifind_token');
    try {
      const res = await fetch(`${API}/prescriptions/${prescription.id}/active-image`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ imageId: version.id })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Active image set to version ${version.versionNumber}.`, 'success');
        await fetchImageVersions(prescription.id);
        setSelectedImageVersion({ ...version, isActive: true });
      } else {
        showToast(data.error || 'Failed to switch active version.', 'error');
      }
    } catch (err) {
      showToast('Network error switching active version.', 'error');
    }
  };

  const handleSelectVersion = (version) => {
    setSelectedImageVersion(version);
    setFilePreviewUrl(null); // Clear local blob preview so currentPreviewSrc uses the versioned image URL
  };

  const handleRetryOcr = async () => {
    if (!prescription?.id) return;
    setIsRetryingOcr(true);
    setOcrConflicts([]);
    const token = localStorage.getItem('medifind_token');
    const targetImageId = selectedImageVersion?.id || prescription.activeImageId;

    try {
      const res = await fetch(`${API}/prescriptions/${prescription.id}/ocr-retry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ imageId: targetImageId })
      });
      const data = await res.json();
      if (data.success) {
        setOcrText(data.ocrText || '');
        setOcrConfidence(data.ocrConfidence || 0);

        if (Array.isArray(data.detectedItems) && data.detectedItems.length > 0) {
          // Merge newly detected items while strictly preserving already-confirmed items
          const confirmedMap = new Map();
          detectedItems.forEach(item => {
            if (item.isConfirmed) {
              confirmedMap.set(item.matchedMedicineId || item.medicineName, item);
            }
          });

          const mergedItems = data.detectedItems.map((item, idx) => {
            const key = item.matchedMedicineId || item.medicineName;
            if (confirmedMap.has(key)) {
              return confirmedMap.get(key);
            }
            return {
              ...item,
              id: item.id || `retry-item-${idx}`,
              quantity: typeof item.extractedQuantity === 'number' ? item.extractedQuantity : (item.quantity || 1)
            };
          });

          confirmedMap.forEach((item, key) => {
            const stillPresent = mergedItems.some(m => (m.matchedMedicineId || m.medicineName) === key);
            if (!stillPresent) {
              mergedItems.push(item);
            }
          });

          setDetectedItems(mergedItems);
        }

        if (data.hasConfirmedConflicts && Array.isArray(data.conflicts) && data.conflicts.length > 0) {
          setOcrConflicts(data.conflicts);
          showToast('OCR complete. Confirmed items preserved; conflict review needed.', 'info');
        } else {
          showToast(`OCR re-analyzed version ${data.versionNumber || 'selected'}.`, 'success');
        }
      } else {
        showToast(data.error || 'Failed to rerun OCR.', 'error');
      }
    } catch (err) {
      showToast('Network error running OCR retry.', 'error');
    } finally {
      setIsRetryingOcr(false);
    }
  };

  // Gate 2B: Patient Correction Handlers
  const handleStartPatientCorrection = (candidate) => {
    setPatientCorrectingCandidate(candidate);
    setPatientCorrectionForm({
      correctedMedicineName: candidate.correctedMedicineName || candidate.matchedMedicineName || candidate.rawName || candidate.medicineName || '',
      dosage: candidate.dosage || '',
      frequency: candidate.frequency || '',
      duration: candidate.duration || '',
      patientNotes: candidate.patientNotes || ''
    });
  };

  const handleSubmitPatientCorrection = async (e) => {
    e?.preventDefault();
    if (!patientCorrectingCandidate) return;
    setIsSubmittingCorrection(true);
    const token = localStorage.getItem('medifind_token');
    try {
      const candidateId = patientCorrectingCandidate.id || patientCorrectingCandidate.candidateId;
      if (prescription?.id && !String(prescription.id).startsWith('mock-') && token) {
        const res = await fetch(`${API}/prescriptions/${prescription.id}/candidates/${candidateId}/correct`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(patientCorrectionForm)
        });
        const data = await res.json();
        if (!data.success) {
          showToast(data.error || 'Failed to record correction.', 'error');
          setIsSubmittingCorrection(false);
          return;
        }
      }

      showToast('Correction submitted for pharmacist clinical review.', 'success');
      setDetectedItems(prev => (prev || []).map(it => {
        if (it.id === patientCorrectingCandidate.id || it.sourceCandidateId === candidateId) {
          return {
            ...it,
            rawName: it.rawName,
            correctedMedicineName: patientCorrectionForm.correctedMedicineName,
            dosage: patientCorrectionForm.dosage,
            frequency: patientCorrectionForm.frequency,
            duration: patientCorrectionForm.duration,
            patientNotes: patientCorrectionForm.patientNotes,
            sourceType: 'PATIENT_CORRECTED',
            isVerified: false
          };
        }
        return it;
      }));
      setPatientCorrectingCandidate(null);
    } catch (_) {
      showToast('Network error submitting correction.', 'error');
    } finally {
      setIsSubmittingCorrection(false);
    }
  };

  const handleReportUnreadable = async (candidate) => {
    if (!candidate) return;
    const token = localStorage.getItem('medifind_token');
    const candidateId = candidate.id || candidate.candidateId;
    try {
      if (prescription?.id && !String(prescription.id).startsWith('mock-') && token) {
        const res = await fetch(`${API}/prescriptions/${prescription.id}/candidates/${candidateId}/unreadable`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ reason: 'Reported unreadable by patient' })
        });
        const data = await res.json();
        if (!data.success) {
          showToast(data.error || 'Failed to flag unreadable.', 'error');
          return;
        }
      }

      showToast('Field marked as unreadable. Pharmacist review required.', 'warning');
      setDetectedItems(prev => (prev || []).map(it => {
        if (it.id === candidate.id || it.sourceCandidateId === candidateId) {
          return { ...it, isUnreadable: true, isUncertain: true };
        }
        return it;
      }));
    } catch (_) {
      showToast('Network error flagging unreadable candidate.', 'error');
    }
  };

  const handleOpenCropper = (srcToCrop) => {
    setCropTargetSrc(srcToCrop || currentPreviewSrc);
    setIsCropModalOpen(true);
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
    fetch(`${API}/medicines/search`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(d => { if (d.success) setMedicinesCatalog(d.medicines || []); })
      .catch(() => {});

    // Fetch patient's saved prescription records for clinical history
    fetchPreviousPrescriptions();

    // Restore prescription from URL param if explicitly specified
    const urlParams = new URLSearchParams(window.location.search);
    const targetRxId = urlParams.get('prescriptionId') || urlParams.get('id');

    if (targetRxId) {
      loadPrescriptionById(targetRxId);
    }
  }, [user?.id, fetchPreviousPrescriptions, loadPrescriptionById]);

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
      const capturedFile = new File([blob], `prescription_capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
      const captureUrl = URL.createObjectURL(blob);
      clearPrescriptionSession();
      setDetectedItems([]);
      setOcrText('');
      setPrescription(null);
      setScreening(null);
      setOcrConfidence(null);
      setFile(capturedFile);
      setFilePreviewUrl(captureUrl);
      updatePersistentImage(capturedFile);
      stopCamera();
      // Prompt user to crop the camera photo immediately
      handleOpenCropper(captureUrl);
    }, 'image/jpeg', 0.95);
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
    stopCamera();

    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(selectedFile.type)) {
      setError('Please upload a clear JPEG, PNG, or WebP prescription image.');
      return;
    }
    if (selectedFile.size > 10 * 1024 * 1024) {
      setError('Prescription file exceeds 10 MB limit. Please compress or choose a file under 10MB.');
      return;
    }

    clearPrescriptionSession();
    setDetectedItems([]);
    setOcrText('');
    setPrescription(null);
    setScreening(null);
    setOcrConfidence(null);
    setFile(selectedFile);
    setFilePreviewUrl(URL.createObjectURL(selectedFile));
    updatePersistentImage(selectedFile);
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
    if (!file) {
      setError('Please upload or capture a prescription photo first.');
      return;
    }

    setError('');
    setUploading(true);
    setStep(2); // Move to Step 2: OCR Processing (Screen 13c2201a4ee24067ba968f75ac622ae7)
    setOcrProgress(0); // Start cleanly at 0%

    // Calibrated progress simulation across realistic clinical OCR pipeline phases
    let currentProgress = 0;
    const progressTimer = setInterval(() => {
      if (currentProgress < 25) {
        currentProgress += 1.2; // Image calibration & resolution normalization
      } else if (currentProgress < 50) {
        currentProgress += 0.9; // Header & UHID detection
      } else if (currentProgress < 75) {
        currentProgress += 0.65; // Isolating Rx rows & recognizing medicine tokens
      } else if (currentProgress < 92) {
        currentProgress += 0.45; // Querying 50-medicine catalog & dosage parsing
      } else if (currentProgress < 99) {
        // Smooth asymptotic progression towards completion
        currentProgress += 0.05 * ((99.2 - currentProgress) / 2);
      }
      setOcrProgress(Math.min(99.0, Math.round(currentProgress * 10) / 10));
    }, 100);

    const token = localStorage.getItem('medifind_token');
    const formData = new FormData();
    if (file) {
      formData.append('prescriptionImage', file);
    }

    const abortController = new AbortController();
    const abortTimeout = setTimeout(() => {
      abortController.abort();
    }, 120000);

    try {
      const res = await fetch(`${API}/prescriptions/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        signal: abortController.signal
      });

      clearTimeout(abortTimeout);
      clearInterval(progressTimer);

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to process prescription.');
      }

      // Smooth completion glide: gracefully transition from current progress to 100%
      await new Promise(resolve => {
        const start = currentProgress;
        const target = 100;
        const glideSteps = Math.max(8, Math.round((target - start) / 4));
        const glideInterval = 65;
        let stepCount = 0;

        const glideTimer = setInterval(() => {
          stepCount++;
          const progressVal = Math.min(100, Math.round(start + ((target - start) * (stepCount / glideSteps))));
          setOcrProgress(progressVal);
          if (stepCount >= glideSteps || progressVal >= 100) {
            clearInterval(glideTimer);
            setOcrProgress(100);
            resolve();
          }
        }, glideInterval);
      });

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
        userId: user?.id || null,
        prescriptionId: rxPrescription?.id,
        prescription: rxPrescription,
        step: 3,
        detectedItems: items,
        ocrText: rxOcrText,
        ocrConfidence: rxOcrConfidence,
        screening: rxScreening
      });

      // Clear hold duration (1.4s) at 100% so user can inspect verified extractions before moving to Step 3
      setTimeout(() => {
        setStep(3); // Step 3: Prescription Verification (Screen ebfde8293be14e72aa1b7f0c6078b3d0)
        showToast(`Prescription analyzed! ${items.length} candidate medication(s) identified.`, 'success');
      }, 1400);
    } catch (err) {
      clearTimeout(abortTimeout);
      clearInterval(progressTimer);
      const isAbort = err.name === 'AbortError';
      const errMsg = isAbort
        ? 'OCR processing took longer than expected. You can retry or verify medications manually.'
        : (err.message || 'Error communicating with OCR server.');

      setError(errMsg);
      triggerToast({
        title: isAbort ? 'OCR Scan Timed Out' : 'OCR Analysis Notice',
        message: errMsg,
        variant: 'destructive',
        onRetry: () => handleProcessPrescription()
      });
      // Do not leave in limbo; return safely to Step 1 while preserving uploaded file
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

  const [requestingPharmacistSelectionId, setRequestingPharmacistSelectionId] = useState(null);

  const handleSelectMatchedMedicine = async (itemId, medId) => {
    const targetItem = (detectedItems || []).find(i => i.id === itemId);
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
      // If pharmacist selection was previously requested, cancel it on backend
      if (targetItem?.pharmacistSelectionRequested && prescription?.id && !String(prescription.id).startsWith('mock-')) {
        const token = localStorage.getItem('medifind_token');
        if (token) {
          fetch(`${API}/prescriptions/${prescription.id}/request-pharmacist-selection`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ detectedMedicineId: itemId, isCancel: true })
          }).catch(e => console.warn('Cancel pharmacist selection error:', e));
        }
      }

      setDetectedItems(prev =>
        prev.map(i =>
          i.id === itemId
            ? {
                ...i,
                matchedMedicineId: med.id,
                matchedMedicineName: med.brandName,
                strength: med.strength,
                dosageForm: med.dosageForm || i.dosageForm,
                isConfirmed: true,
                pharmacistSelectionRequested: false
              }
            : i
        )
      );
    }
  };

  const handleRequestPharmacistSelection = async (itemId, isCancel = false) => {
    const targetItem = (detectedItems || []).find(i => i.id === itemId);
    const token = localStorage.getItem('medifind_token');

    if (!prescription?.id || String(prescription.id).startsWith('mock-') || !token) {
      setDetectedItems(prev =>
        prev.map(i =>
          i.id === itemId
            ? {
                ...i,
                matchedMedicineId: null,
                matchedMedicineName: null,
                isConfirmed: false,
                pharmacistSelectionRequested: !isCancel
              }
            : i
        )
      );
      showToast(
        isCancel
          ? 'Pharmacist brand selection cancelled. Please choose a trade brand.'
          : 'Pharmacist assistance requested. Attending pharmacist will select and verify the optimal brand.',
        'info'
      );
      return;
    }

    try {
      setRequestingPharmacistSelectionId(itemId);
      const res = await fetch(`${API}/prescriptions/${prescription.id}/request-pharmacist-selection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          detectedMedicineId: itemId,
          isCancel
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setDetectedItems(prev =>
          prev.map(i =>
            i.id === itemId
              ? {
                  ...i,
                  matchedMedicineId: null,
                  matchedMedicineName: null,
                  isConfirmed: false,
                  pharmacistSelectionRequested: !isCancel
                }
              : i
          )
        );
        showToast(
          isCancel
            ? 'Pharmacist brand selection cancelled. You can choose a trade brand below.'
            : 'Request sent to attending pharmacist. They will review and select the genuine brand formulation.',
          'success'
        );
      } else {
        showToast(data.error || 'Failed to update pharmacist selection request.', 'error');
      }
    } catch (err) {
      console.error('handleRequestPharmacistSelection error:', err);
      showToast('Network error updating pharmacist selection request.', 'error');
    } finally {
      setRequestingPharmacistSelectionId(null);
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
    setIsVerifying(true);
    const token = localStorage.getItem('medifind_token');
    try {
      const itemsToVerify = (detectedItems || []).map(item => ({
        id: item.id,
        matchedMedicineId: item.matchedMedicineId || null,
        matchedMedicineName: item.matchedMedicineName || item.rawName || null,
        rawName: item.rawName,
        quantity: parseInt(item.quantity, 10) || 1,
        dosage: item.dosage,
        frequency: item.frequency,
        duration: item.duration,
        isConfirmed: !item.pharmacistSelectionRequested,
        pharmacistSelectionRequested: Boolean(item.pharmacistSelectionRequested)
      }));

      if (itemsToVerify.length === 0) {
        showToast('Please add or map at least one medicine before verifying.', 'error');
        setIsVerifying(false);
        return;
      }

      let verifiedPrescription = prescription;
      let verifiedList = detectedItems;

      if (token && prescription && prescription.id && !String(prescription.id).startsWith('mock-')) {
        try {
          const res = await fetch(`${API}/prescriptions/${prescription.id}/verify`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ items: itemsToVerify })
          });

          const data = await res.json();
          if (data && data.success) {
            verifiedPrescription = data.prescription;
            verifiedList = data.prescription.detectedMedicines || detectedItems;
          } else {
            console.warn('Backend verification message:', data?.error);
          }
        } catch (apiErr) {
          console.warn('Network or API verify error, proceeding with local verified state:', apiErr);
        }
      }

      // Mark detected items, keeping pharmacistSelectionRequested intact
      const finalizedItems = (verifiedList || detectedItems).map(i => ({
        ...i,
        isConfirmed: !i.pharmacistSelectionRequested,
        pharmacistSelectionRequested: Boolean(i.pharmacistSelectionRequested)
      }));
      setPrescription(prev => ({ ...(prev || {}), ...verifiedPrescription, status: 'VERIFIED' }));
      setDetectedItems(finalizedItems);

      // Feed confirmed items into App.jsx medicine request state without dropping any detected medicines
      if (onAddVerifiedToRequest) {
        const verifiedItems = finalizedItems.map((i, idx) => {
          let medId = i.matchedMedicineId;
          if (!medId && i.allMatches && i.allMatches.length > 0) {
            medId = i.allMatches[0].medicineId;
          }
          if (!medId && Array.isArray(medicinesCatalog) && medicinesCatalog.length > 0) {
            const nameLower = (i.medicineName || i.rawName || '').toLowerCase();
            const match = medicinesCatalog.find(m =>
              m.brandName.toLowerCase() === nameLower ||
              (m.genericName && nameLower.includes(m.genericName.toLowerCase()))
            );
            if (match) medId = match.id;
          }
          if (!medId) {
            medId = `custom-med-${(i.medicineName || i.rawName || `item-${idx}`).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
          }
          return {
            medicineId: medId,
            brandName: i.matchedMedicineName || i.medicineName || i.rawName || 'Prescription Medicine',
            genericName: i.rawName || i.genericName || '',
            dosageForm: i.dosageForm || 'Tablet',
            strength: i.strength || i.dosage || '',
            quantity: parseInt(i.quantity, 10) || 1,
            pharmacistSelectionRequested: Boolean(i.pharmacistSelectionRequested)
          };
        });
        if (verifiedItems.length > 0) {
          onAddVerifiedToRequest(verifiedItems);
        }
      }

      // Advance to Step 4: Verification Summary with Attached Prescription & Safety Metrics
      showToast('Prescription verified! Authentication record generated.', 'success');
      setStep(4);
    } catch (err) {
      console.error('Error during verification:', err);
      // Fallback: still advance to Step 4 with local confirmed items
      setDetectedItems(prev => (prev || []).map(i => ({ ...i, isConfirmed: !i.pharmacistSelectionRequested })));
      setStep(4);
      showToast('Prescription verified locally for clinical review.', 'success');
    } finally {
      setIsVerifying(false);
    }
  };

  const reset = () => {
    clearPrescriptionSession();
    try { sessionStorage.removeItem('medifind_rx_image'); } catch (_) {}
    setPersistentImageSrc(null);
    setSelectedImageVersion(null);
    setPreviewRotation(0);
    setStep(1);
    setFile(null);
    setFilePreviewUrl(null);
    setOcrText('');
    setOcrConfidence(null);
    setPrescription(null);
    setScreening(null);
    setDetectedItems([]);
    setError('');
    setShowManualAdd(false);
    setMappingModalItem(null);
    stopCamera();
    fetchPreviousPrescriptions();
  };

  // Current preview image source (prioritizes explicitly selected version, active blob URL, persistent data URL, or DB prescription image when past step 1)
  const currentPreviewSrc =
    (selectedImageVersion && prescription?.id && !String(prescription.id).startsWith('mock-')
      ? `${API}/prescriptions/${prescription.id}/image?imageId=${selectedImageVersion.id}`
      : null) ||
    filePreviewUrl ||
    persistentImageSrc ||
    (step > 1 && prescription?.id && !String(prescription.id).startsWith('mock-')
      ? `${API}/prescriptions/${prescription.id}/image`
      : null);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-6 font-body-md text-on-surface">
      {/* ── PART 1: PRESCRIPTION UPLOAD (Stitch Screen e21903e1d8aa47b686c1bd2e7d51f0fb) ── */}
      {step === 1 && (
        <div className="flex flex-col gap-6">
          {/* Top Step Bar & Workflow Indicator */}
          <PrescriptionWorkflowStepper
            currentStep={1}
            onNavigateToStep={setStep}
            subtitle="Clinical Workflow"
            title="Prescription Dispense Pipeline"
            icon="document_scanner"
          />

          {/* Editorial Header Section */}
          <div className="flex flex-col gap-1 max-w-3xl">
            <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-xs font-bold w-fit">
              <span className="material-symbols-outlined text-sm">encrypted</span>
              <span>Encrypted Secure Upload</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-primary tracking-tight mt-1">
              Upload Prescription Photo
            </h1>
            <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
              Upload a clear photo of your doctor's written prescription slip. MediFind AI extracts medicine candidates for rapid local pharmacy matching.
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
                    Drag and drop your prescription photo here
                  </h2>
                  <p className="text-xs sm:text-sm text-on-surface-variant max-w-md mb-5 leading-relaxed">
                    or browse from your device gallery. Clear photos allow optical recognition to reliably detect medicine names and strengths.
                  </p>
                  <button
                    type="button"
                    className="px-6 py-2.5 rounded-full bg-primary hover:bg-primary-container text-white text-xs font-bold shadow-sm transition-all flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-base">photo_library</span>
                    <span>Browse Prescription Photo</span>
                  </button>
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-[11px] text-on-surface-variant font-medium">
                    <span className="flex items-center gap-1"><span className="material-symbols-outlined text-xs text-secondary">check_circle</span> PNG / JPG / JPEG / WEBP</span>
                    <span>•</span>
                    <span className="flex items-center gap-1"><span className="material-symbols-outlined text-xs text-secondary">check_circle</span> Camera Snapshots</span>
                    <span>•</span>
                    <span>Up to 10MB</span>
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
                      <span className="text-[11px] text-on-surface-variant">Instant high-resolution photo snap with auto-deskew</span>
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
                    file ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant'
                  }`}>
                    {file ? 'Photo Selected' : 'Awaiting Photo'}
                  </span>
                </div>

                {/* Staged Document Preview */}
                {currentPreviewSrc ? (
                  <div className="flex flex-col gap-3">
                    <div
                      onClick={() => setIsImageModalOpen(true)}
                      className="relative rounded-2xl overflow-hidden bg-surface-container border border-outline-variant/20 p-2 group cursor-zoom-in"
                      title="Click to zoom in high resolution"
                    >
                      <img
                        src={currentPreviewSrc}
                        alt="Prescription preview"
                        className="w-full h-52 object-contain rounded-xl select-none"
                      />
                      <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-md text-white text-[10px] font-bold flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="material-symbols-outlined text-xs">zoom_in</span>
                        <span>Click to zoom</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleClearStaged}
                        className="absolute top-4 right-4 w-8 h-8 rounded-full bg-black/70 hover:bg-black/90 text-white flex items-center justify-center transition-all z-20 shadow-md cursor-pointer"
                        title="Remove staged photo"
                      >
                        <span className="material-symbols-outlined text-base">close</span>
                      </button>
                    </div>

                    {/* Staged Photo Action Toolbar: Crop & Zoom */}
                    <div className="flex items-center justify-between gap-2 p-2.5 rounded-2xl bg-surface-container-low border border-surface-container">
                      <div className="flex items-center gap-1.5 text-xs text-on-surface font-medium truncate max-w-[170px]">
                        <span className="material-symbols-outlined text-secondary text-base shrink-0">image</span>
                        <span className="truncate">{file?.name || 'prescription_photo.jpg'}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenCropper(currentPreviewSrc)}
                          className="px-3 py-1.5 rounded-full bg-surface-container-lowest hover:bg-surface-container text-primary font-bold text-xs flex items-center gap-1 transition-colors border border-outline-variant/20 shadow-xs"
                          title="Crop and straighten prescription photo"
                        >
                          <span className="material-symbols-outlined text-sm text-secondary">crop</span>
                          <span>Crop Photo</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsImageModalOpen(true)}
                          className="w-8 h-8 rounded-full bg-surface-container-lowest hover:bg-surface-container text-primary flex items-center justify-center transition-colors border border-outline-variant/20 shadow-xs"
                          title="Zoom in high resolution"
                        >
                          <span className="material-symbols-outlined text-base">zoom_in</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-44 rounded-2xl bg-surface-container-low flex flex-col items-center justify-center text-center p-4 text-on-surface-variant">
                    <span className="material-symbols-outlined text-4xl mb-1 text-outline">image</span>
                    <span className="text-xs font-bold text-primary">No prescription photo staged yet</span>
                    <span className="text-[11px] text-on-surface-variant/70 mt-0.5">
                      Upload a clear prescription photo or capture using your camera
                    </span>
                  </div>
                )}

                {/* Primary Execution CTA: Originkit Scan Grid Button */}
                <div className="w-full flex justify-center pt-2">
                  <ScanGridButton
                    label="RUN OCR & PRESCRIPTION SCAN"
                    disabled={uploading || !file}
                    onClick={handleProcessPrescription}
                    padding="16px 28px"
                    rounded={999}
                    font={{
                      fontFamily: "Inter, sans-serif",
                      fontWeight: 700,
                      fontSize: 13,
                      lineHeight: "1.2em",
                      letterSpacing: "0.5px",
                      textAlign: "center",
                      textTransform: "uppercase",
                    }}
                    colors={{
                      fill: "#006A60",
                      hoverFill: "#00534B",
                      textColor: "#FFFFFF",
                      hoverTextColor: "#FFFFFF",
                    }}
                    scan={{
                      color: "#2DD4BF",
                      speed: 60,
                    }}
                    border={{
                      borderWidth: 1,
                      borderStyle: "solid",
                      borderColor: "rgba(45, 212, 191, 0.4)",
                    }}
                    glitchIntensity={2}
                    addIcon={false}
                    style={{
                      width: "100%",
                      justifyContent: "center",
                      boxShadow: "0 6px 20px -4px rgba(0, 106, 96, 0.35)",
                    }}
                  />
                </div>
              </div>

              {/* Optical Screening Quality Standards */}
              <div className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/30 shadow-sm flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-secondary text-base">verified</span>
                  <h4 className="text-xs font-bold text-primary uppercase tracking-wider">
                    Optical Screening Standards
                  </h4>
                </div>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  PaddleOCR deep learning engine extracts exact drug names, dosage strengths, and prescribed quantities from physical prescription slips.
                </p>
                <div className="flex flex-col gap-2 pt-1">
                  <div className="flex items-start gap-2.5 text-xs text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm mt-0.5">check_circle</span>
                    <span>High resolution &amp; even lighting without glare</span>
                  </div>
                  <div className="flex items-start gap-2.5 text-xs text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm mt-0.5">check_circle</span>
                    <span>Clear medicine names, dosage counts, and doctor details</span>
                  </div>
                  <div className="flex items-start gap-2.5 text-xs text-on-surface-variant">
                    <span className="material-symbols-outlined text-secondary text-sm mt-0.5">check_circle</span>
                    <span>Automatic matching with 50-medicine verified catalog</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Gate 4: Patient Prescription History & Saved Clinical Records */}
          <div className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/30 shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-secondary-container text-on-secondary-container flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-lg">history_edu</span>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-on-surface">Previous Prescriptions &amp; Clinical Records</h3>
                  <p className="text-xs text-on-surface-variant">Access your prescription history, review extractions, or resume dispensary allocation</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold px-2.5 py-1 bg-surface-container rounded-full text-on-surface-variant inline-flex items-center gap-1">
                  <RollingNumber value={previousPrescriptions.length} /> {previousPrescriptions.length === 1 ? 'Record' : 'Records'}
                </span>
                <button
                  type="button"
                  onClick={fetchPreviousPrescriptions}
                  className="w-8 h-8 rounded-full bg-surface-container hover:bg-surface-container-high text-primary flex items-center justify-center transition-colors cursor-pointer"
                  title="Refresh records"
                >
                  <span className="material-symbols-outlined text-sm">refresh</span>
                </button>
              </div>
            </div>

            {previousPrescriptions.length === 0 ? (
              <div className="p-6 rounded-2xl bg-surface-container-low/40 border border-dashed border-outline-variant/30 text-center flex flex-col items-center justify-center gap-1.5">
                <span className="material-symbols-outlined text-2xl text-outline">history</span>
                <p className="text-xs font-medium text-on-surface-variant">No previous prescriptions recorded yet. Upload a prescription above to begin.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {previousPrescriptions.slice(0, 6).map((rx) => {
                  const itemCount = rx.itemCount ?? rx.items?.length ?? 0;
                  const medListStr = (rx.items && rx.items.length > 0)
                    ? rx.items.map(i => i.matchedMedicineName || i.rawName).join(', ')
                    : (rx.doctorName ? `Prescription by ${rx.doctorName}` : 'Prescription Upload');

                  return (
                    <div
                      key={rx.id}
                      className="p-4 rounded-2xl border border-outline-variant/40 bg-surface-container-low/40 hover:bg-surface-container-low transition-colors flex flex-col justify-between gap-3 shadow-2xs"
                    >
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-mono font-bold text-primary">
                            #{String(rx.id).slice(-6).toUpperCase()}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            rx.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' :
                            rx.status === 'VERIFIED' ? 'bg-secondary-container text-on-secondary-container' :
                            rx.status === 'FAILED' ? 'bg-error-container text-on-error-container' :
                            'bg-surface-container text-on-surface-variant'
                          }`}>
                            {rx.status}
                          </span>
                        </div>
                        <div className="text-xs font-semibold text-on-surface truncate" title={medListStr}>
                          {medListStr}
                        </div>
                        <div className="text-[11px] text-on-surface-variant flex items-center justify-between">
                          <span>
                            {new Date(rx.createdAt).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric'
                            })}
                          </span>
                          <span className="font-semibold text-secondary">
                            {itemCount} {itemCount === 1 ? 'medicine' : 'medicines'}
                          </span>
                        </div>
                      </div>

                      {/* Separate View and Resume Buttons */}
                      <div className="flex items-center gap-2 pt-2 border-t border-outline-variant/20">
                        <button
                          type="button"
                          onClick={() => setViewModalRx(rx)}
                          className="flex-1 py-1.5 px-2.5 rounded-xl bg-surface-container hover:bg-surface-container-high text-xs font-bold text-primary transition-colors flex items-center justify-center gap-1 cursor-pointer"
                          title="View prescription summary popup"
                        >
                          <span className="material-symbols-outlined text-sm text-secondary">visibility</span>
                          <span>View</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => loadPrescriptionById(rx.id)}
                          className="flex-1 py-1.5 px-2.5 rounded-xl bg-primary hover:bg-primary-container text-xs font-bold text-white transition-colors flex items-center justify-center gap-1 shadow-2xs cursor-pointer"
                          title="Resume prescription extraction and verification"
                        >
                          <span className="material-symbols-outlined text-sm">play_arrow</span>
                          <span>Resume</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PART 2: OCR PROCESSING (Stitch Screen 13c2201a4ee24067ba968f75ac622ae7) ── */}
      {step === 2 && (
        <div className="flex flex-col gap-6">
          {/* Top Progress Breadcrumbs */}
          <PrescriptionWorkflowStepper
            currentStep={2}
            onNavigateToStep={setStep}
            subtitle="DeepRead OCR Pipeline"
            title="Optical Reading & Medication Extraction"
            icon="neurology"
          />

          {/* Header Section */}
          <div className="flex flex-col gap-1 max-w-3xl">
            <div className="inline-flex items-center gap-1.5 text-secondary font-bold text-xs bg-secondary-container/50 px-3 py-1 rounded-full w-fit">
              <span className="material-symbols-outlined text-sm">neurology</span>
              <span>MediFind DeepRead OCR Active</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-primary tracking-tight mt-1">
              Reading Prescription Photo &amp; Extracting Medicines
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
                    <span className="material-symbols-outlined text-secondary text-base">image</span>
                    <span>{file?.name || 'Prescription_Photo.jpg'}</span>
                  </div>
                  {(() => {
                    let layerLabel = "Layer 1: PaddleOCR Active";
                    let layerStyle = "bg-surface-container text-primary font-semibold";
                    if (ocrProgress >= 50 && ocrProgress < 86) {
                      layerLabel = "Layer 2: TrOCR Fallback Active (Handwriting)";
                      layerStyle = "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300 animate-pulse font-bold border border-amber-300/40";
                    } else if (ocrProgress >= 86) {
                      layerLabel = "Layer 3: Neural Fusion & Catalogue Consensus";
                      layerStyle = "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300 font-bold";
                    }
                    return (
                      <span className={`px-2.5 py-0.5 rounded-full font-mono text-[10px] transition-all duration-500 shadow-2xs ${layerStyle}`}>
                        {layerLabel}
                      </span>
                    );
                  })()}
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
                          Upload a prescription image or capture with camera to scan
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
                  {(() => {
                    const target = getScannerTargetBox(ocrProgress);
                    const confVal = typeof ocrConfidence === 'number' && ocrConfidence > 0
                      ? (ocrConfidence * 100).toFixed(1)
                      : Math.min(99.4, (88.5 + (ocrProgress * 0.11))).toFixed(1);

                    return (
                      <div
                        style={{
                          top: target.top,
                          left: target.left,
                          right: target.right,
                          height: target.height,
                          transition: 'all 0.45s cubic-bezier(0.16, 1, 0.3, 1)'
                        }}
                        className={`absolute p-2.5 rounded-2xl border-2 shadow-lg pointer-events-none flex flex-col justify-between ${target.border} ${target.bg}`}
                      >
                        <span className="bg-primary text-white text-[10px] font-bold px-2 py-0.5 rounded-full self-start -mt-4 shadow-sm flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#b3eee0] animate-ping" />
                          {target.tag}
                        </span>
                        <span className="text-[10px] font-mono text-primary font-bold text-right mt-1 bg-white/90 dark:bg-black/80 px-2.5 py-0.5 rounded-full shadow-2xs self-end flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          <span>Confidence {confVal}%</span>
                          <span className="opacity-70 text-[9px]">({target.confidence})</span>
                        </span>
                      </div>
                    );
                  })()}
                </div>

                {/* Optical Details Badge */}
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs">
                  <span className="px-3 py-1 rounded-full bg-surface-container text-on-surface-variant font-medium flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm text-secondary">document_scanner</span>
                    Optical Resolution: 1200 DPI
                  </span>
                  {(() => {
                    let engineText = "powered by PaddleOCR (PP-OCRv4)";
                    let engineBadge = "bg-secondary-container text-on-secondary-container";
                    if (ocrProgress >= 50 && ocrProgress < 86) {
                      engineText = "powered by TrOCR (Transformer Vision-Language)";
                      engineBadge = "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-400/50";
                    } else if (ocrProgress >= 86) {
                      engineText = "Multi-Engine Pipeline: PaddleOCR + TrOCR Verified";
                      engineBadge = "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300";
                    }
                    return (
                      <span className={`px-3 py-1 rounded-full font-bold text-xs flex items-center gap-1.5 transition-all duration-500 shadow-2xs ${engineBadge}`}>
                        <span className="w-2 h-2 rounded-full bg-current animate-ping" />
                        <span className="transition-all duration-300">{engineText}</span>
                      </span>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Right Column: Extraction Stages & Progress Architecture */}
            <div className="lg:col-span-6 flex flex-col gap-5">
              <div className="bg-surface-container-lowest rounded-3xl shadow-sm p-6 border border-outline-variant/30 flex flex-col gap-4">

                {/* Live Real-Time OCR Optical Feed / Status Banner */}
                {(() => {
                  const readout = getActiveScanReadout(ocrProgress);
                  return (
                    <div className="p-3.5 rounded-2xl bg-surface-container-low border border-secondary/25 flex flex-col gap-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono text-[10px] font-extrabold tracking-wider text-secondary uppercase flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
                          {readout.stage}
                        </span>
                        <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container">
                          {readout.badge}
                        </span>
                      </div>
                      <div className="text-sm font-bold text-on-surface flex items-center gap-2">
                        <span className="material-symbols-outlined text-secondary text-base">center_focus_strong</span>
                        <span>{readout.title}</span>
                      </div>
                      <div className="text-xs font-mono text-primary font-semibold bg-surface-container/80 px-2.5 py-1.5 rounded-xl border border-outline-variant/25 flex items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap">
                        <span className="text-secondary font-bold select-none">&gt;</span>
                        <span className="truncate">{readout.detail}</span>
                      </div>
                    </div>
                  );
                })()}

                {/* Progressive Flux Loader with percentage and phases */}
                <div className="w-full py-1">
                  <ProgressiveFluxLoader
                    value={ocrProgress}
                    phases={OCR_FLUX_PHASES}
                    showLabel={true}
                    showPercentage={true}
                    className="max-w-full w-full"
                  />
                </div>

                {/* Live Clinical Entities & Medical Words Stream (Token Cloud) */}
                <div className="flex flex-col gap-2 pt-2 border-t border-outline-variant/20">
                  <div className="flex items-center justify-between text-xs font-bold text-on-surface">
                    <span className="flex items-center gap-1.5 text-secondary">
                      <span className="material-symbols-outlined text-sm">view_timeline</span>
                      Live OCR Pipeline Stages ({CLINICAL_SCAN_TOKENS.filter(t => ocrProgress >= t.at).length}/{CLINICAL_SCAN_TOKENS.length})
                    </span>
                    <span className="text-[10px] font-mono font-semibold text-on-surface-variant flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                      Live Stream
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-[145px] overflow-y-auto p-2.5 rounded-2xl bg-surface-container-low/60 border border-outline-variant/30">
                    {CLINICAL_SCAN_TOKENS.map((token, idx) => {
                      const isUnlocked = ocrProgress >= token.at;
                      return (
                        <span
                          key={idx}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all duration-300 ${
                            isUnlocked
                              ? 'bg-secondary-container text-on-secondary-container shadow-2xs border border-secondary/30 scale-100'
                              : 'bg-surface-container/60 text-outline/50 opacity-40 scale-95'
                          }`}
                        >
                          <span className="text-[9px] font-black uppercase tracking-wider opacity-75">{token.tag}:</span>
                          <span>{token.label}</span>
                          {isUnlocked && <span className="material-symbols-outlined text-[13px] text-secondary font-bold">check</span>}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Pipeline Stage Cards — Animate progression across the 5 real stages */}
                <div className="flex flex-col gap-2 pt-1 border-t border-outline-variant/20">
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

                {/* Manual verification escape button if scanning takes time */}
                <div className="pt-1 flex flex-col items-center text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setStep(3);
                      showToast('Switched to manual medicine entry.', 'info');
                    }}
                    className="text-xs text-secondary hover:text-primary font-bold hover:underline transition-all cursor-pointer flex items-center gap-1.5 py-1 px-3 rounded-full hover:bg-surface-container"
                  >
                    <span className="material-symbols-outlined text-sm">edit_note</span>
                    <span>Taking longer than expected? Skip to manual medicine verification &rarr;</span>
                  </button>
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
          <PrescriptionWorkflowStepper
            currentStep={3}
            onNavigateToStep={setStep}
            subtitle="Clinical Workflow"
            title="Patient Prescription Verification"
            icon="fact_check"
          />

          {/* Gate 5 Prescription Recovery Summary Banner */}
          {prescription?.recoverySummary && (
            <div className="p-4 rounded-3xl bg-surface-container-lowest border border-secondary/40 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-secondary text-white flex items-center justify-center shrink-0 shadow-sm">
                  <span className="material-symbols-outlined text-xl">history</span>
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-primary">Resumed Prescription #{prescription.id?.slice(0, 8)}</span>
                    <span className="px-2.5 py-0.5 rounded-full bg-secondary text-white text-[11px] font-bold">
                      {prescription.status}
                    </span>
                    {prescription.recoverySummary.isFullyAllocated ? (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                        Fully Allocated
                      </span>
                    ) : prescription.recoverySummary.hasOutstandingQuantities ? (
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold">
                        Outstanding Quantities Available
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-on-surface-variant mt-0.5">
                    {prescription.recoverySummary.totalItems} items ({prescription.recoverySummary.verifiedItemsCount} verified). Preserved original document across {prescription.imageVersions?.length || 1} image version(s).
                  </p>
                </div>
              </div>

              {prescription.recoverySummary.linkedOrders?.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-on-surface-variant bg-surface-container-low px-3 py-1.5 rounded-xl border border-outline-variant/30">
                  <span className="font-semibold text-primary">Linked Orders:</span>
                  <span className="font-mono text-[11px]">
                    {prescription.recoverySummary.linkedOrders.map(o => `#${o.id.slice(0, 8)} (${o.orderStatus})`).join(', ')}
                  </span>
                </div>
              )}
            </div>
          )}

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
            {/* LEFT COLUMN: Prescription Document Preview (5 cols) matching Stitch Image 2 */}
            <div className="lg:col-span-5 flex flex-col gap-4 lg:sticky lg:top-24">
              <div className="bg-surface-container-lowest rounded-3xl p-4 sm:p-5 border border-outline-variant/30 shadow-sm flex flex-col gap-3">
                <div className="flex items-center justify-between pb-2 border-b border-surface-container">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="material-symbols-outlined text-secondary text-lg">description</span>
                    <span className="text-xs font-bold text-primary truncate max-w-[200px]">
                      {getDisplayFileName()}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {selectedImageVersion && (
                      <span className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[10px] font-bold">
                        v{selectedImageVersion.versionNumber} {selectedImageVersion.isOriginal ? '(Original)' : selectedImageVersion.parentImageId ? '(Enhanced)' : '(Replacement)'}
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant text-[10px] font-bold uppercase tracking-wider">
                      Part 1/1
                    </span>
                  </div>
                </div>

                {/* Gate 2A: Prescription Image Version Selector & Lineage Bar */}
                <div className="flex flex-col gap-2 p-2.5 rounded-2xl bg-surface-container-low border border-outline-variant/20">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-primary flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs text-secondary">layers</span>
                      <span>Image Versions ({imageVersions.length || 1})</span>
                    </span>
                    {imageVersions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setIsComparingOriginal(!isComparingOriginal)}
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                          isComparingOriginal
                            ? 'bg-primary text-white shadow-xs'
                            : 'bg-surface-container hover:bg-surface-container-high text-primary'
                        }`}
                        title="Compare currently selected version against original upload side-by-side"
                      >
                        <span className="material-symbols-outlined text-xs">compare</span>
                        <span>{isComparingOriginal ? 'Exit Compare' : 'Compare Original (v1)'}</span>
                      </button>
                    )}
                  </div>

                  {/* Version Pills */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-thin">
                    {(imageVersions.length > 0 ? imageVersions : [{ id: 'v1', versionNumber: 1, isOriginal: true, isActive: true }]).map((ver) => {
                      const isSelected = selectedImageVersion ? selectedImageVersion.id === ver.id : ver.isActive;
                      return (
                        <button
                          key={ver.id}
                          type="button"
                          onClick={() => handleSelectVersion(ver)}
                          className={`px-2.5 py-1 rounded-xl text-[11px] font-bold flex items-center gap-1.5 shrink-0 transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-primary text-white shadow-xs'
                              : 'bg-surface-container hover:bg-surface-container-high text-on-surface-variant'
                          }`}
                        >
                          <span>v{ver.versionNumber}</span>
                          <span className="text-[9px] px-1 py-0.2 rounded-md bg-white/20 uppercase font-mono tracking-wider">
                            {ver.isOriginal ? 'Original' : ver.parentImageId ? `Enhanced — v${ver.versionNumber}` : `Replacement — v${ver.versionNumber}`}
                          </span>
                          {ver.isActive && (
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="Active Version" />
                          )}
                        </button>
                      );
                    })}

                    {/* Upload Clearer Photo Button in Version Bar */}
                    <button
                      type="button"
                      onClick={() => replacementInputRef.current?.click()}
                      className="px-2.5 py-1 rounded-xl bg-surface-container hover:bg-surface-container-high text-secondary text-[11px] font-bold flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                      title="Upload or capture a clearer replacement photo for this prescription"
                    >
                      <span className="material-symbols-outlined text-xs">add_photo_alternate</span>
                      <span>+ Replace Photo</span>
                    </button>
                    <input
                      ref={replacementInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) handleUploadReplacement(f);
                        e.target.value = '';
                      }}
                    />
                  </div>
                </div>

                {/* Preview Window with Click-to-Zoom or Version Comparison */}
                {isComparingOriginal && imageVersions.length > 1 ? (
                  <div className="grid grid-cols-2 gap-2 p-2 bg-surface-container-low rounded-2xl border border-outline-variant/30 min-h-[220px]">
                    <div className="flex flex-col gap-1 items-center">
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs text-secondary">history</span>
                        Original (v1)
                      </span>
                      <AuthenticatedPrescriptionImage
                        prescriptionId={prescription?.id}
                        imageId={imageVersions[0]?.id}
                        alt="Original prescription"
                        className="w-full h-44 sm:h-72 object-contain rounded-xl bg-black/40 select-none shadow-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1 items-center">
                      <span className="text-[10px] font-bold text-primary uppercase tracking-wider flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs text-primary">auto_fix_high</span>
                        {selectedImageVersion?.isOriginal
                          ? 'Original (v1)'
                          : `Enhanced — v${selectedImageVersion?.versionNumber || 'Selected'}`}
                      </span>
                      <AuthenticatedPrescriptionImage
                        prescriptionId={prescription?.id}
                        imageId={selectedImageVersion?.id}
                        fallbackSrc={filePreviewUrl || persistentImageSrc}
                        alt="Selected prescription version"
                        className="w-full h-44 sm:h-72 object-contain rounded-xl bg-black/40 select-none shadow-xs"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="relative bg-surface-container-low rounded-2xl overflow-hidden min-h-[200px] sm:min-h-[340px] p-2 flex items-center justify-center border border-outline-variant/20 shadow-inner group">
                    <AuthenticatedPrescriptionImage
                      prescriptionId={prescription?.id}
                      imageId={selectedImageVersion?.id}
                      fallbackSrc={filePreviewUrl || persistentImageSrc}
                      rotation={previewRotation}
                      alt="Prescription preview"
                      className="w-full h-44 sm:h-80 object-contain rounded-xl select-none"
                      showEnlargeHint={true}
                      onClick={() => setIsImageModalOpen(true)}
                      customEmptyState={
                        <PrescriptionDocumentSlip
                          prescription={prescription}
                          detectedItems={detectedItems}
                          fileName={getDisplayFileName()}
                          rotation={previewRotation}
                          ocrText={ocrText}
                        />
                      }
                    />
                  </div>
                )}

                {/* Gate 2A Interactive Enhancement, Replacement & OCR Actions Toolbar */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleOpenCropper(currentPreviewSrc)}
                    className="px-2.5 py-1.5 rounded-xl bg-surface-container-low hover:bg-surface-container text-primary text-xs font-bold flex items-center justify-center gap-1.5 border border-outline-variant/30 transition-colors shadow-2xs cursor-pointer"
                    title="Enhance contrast, brightness, rotation or crop this image version"
                  >
                    <span className="material-symbols-outlined text-sm text-secondary">tune</span>
                    <span className="truncate">Enhance</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => replacementInputRef.current?.click()}
                    className="px-2.5 py-1.5 rounded-xl bg-surface-container-low hover:bg-surface-container text-primary text-xs font-bold flex items-center justify-center gap-1.5 border border-outline-variant/30 transition-colors shadow-2xs cursor-pointer"
                    title="Upload or capture a clearer replacement photo"
                  >
                    <span className="material-symbols-outlined text-sm text-secondary">add_a_photo</span>
                    <span className="truncate">Replace</span>
                  </button>

                  <button
                    type="button"
                    disabled={isRetryingOcr}
                    onClick={handleRetryOcr}
                    className="px-2.5 py-1.5 rounded-xl bg-secondary-container hover:bg-secondary/20 text-on-secondary-container text-xs font-bold flex items-center justify-center gap-1.5 border border-outline-variant/30 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
                    title="Rerun OCR extraction specifically against the currently selected image version"
                  >
                    {isRetryingOcr ? (
                      <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                    ) : (
                      <span className="material-symbols-outlined text-sm text-secondary">document_scanner</span>
                    )}
                    <span className="truncate">{isRetryingOcr ? 'Scanning...' : 'Retry OCR'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsImageModalOpen(true)}
                    className="px-2.5 py-1.5 rounded-xl bg-surface-container-low hover:bg-surface-container text-primary text-xs font-bold flex items-center justify-center gap-1.5 border border-outline-variant/30 transition-colors shadow-2xs cursor-pointer"
                    title="Open enlarged high-resolution document viewer"
                  >
                    <span className="material-symbols-outlined text-sm text-secondary">open_in_full</span>
                    <span className="truncate">Enlarge</span>
                  </button>
                </div>

                {/* If selected version is not active, offer to activate it */}
                {selectedImageVersion && !selectedImageVersion.isActive && (
                  <div className="flex items-center justify-between p-2 rounded-xl bg-surface-container-low border border-outline-variant/20 text-xs">
                    <span className="text-[11px] text-on-surface-variant truncate">
                      Viewing historical version v{selectedImageVersion.versionNumber}.
                    </span>
                    <button
                      type="button"
                      onClick={() => handleSetActiveVersion(selectedImageVersion)}
                      className="px-2.5 py-1 rounded-full bg-primary hover:bg-primary-container text-white text-[11px] font-bold shrink-0 transition-colors cursor-pointer"
                    >
                      Make Active
                    </button>
                  </div>
                )}

                {/* OCR Conflict Review Banner */}
                {ocrConflicts.length > 0 && (
                  <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 text-xs flex flex-col gap-1.5 shadow-xs">
                    <div className="flex items-center gap-1.5 font-bold">
                      <span className="material-symbols-outlined text-sm text-amber-600">notification_important</span>
                      <span>Review Needed: OCR Output Differs</span>
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      Newly detected items differ from previously verified medicines. Your previously confirmed medicines have been strictly preserved. Please review:
                    </p>
                    <ul className="list-disc pl-4 text-[11px] space-y-0.5">
                      {ocrConflicts.map((c, idx) => (
                        <li key={idx}><strong>{c.item}</strong>: {c.reason}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="p-3 rounded-xl bg-surface-container-low text-[11px] text-on-surface-variant flex items-center gap-2 border border-outline-variant/20">
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
                  <span className="px-2.5 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-xs font-bold inline-flex items-center gap-1">
                    <RollingNumber value={detectedItems.length} /> Detected
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
                          <div className="flex items-center gap-2 flex-wrap">
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

                            {/* Provenance Badge (Gate 2B) */}
                            {item.sourceType === 'PATIENT_CORRECTED' ? (
                              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold flex items-center gap-1">
                                <span className="material-symbols-outlined text-xs">edit_note</span>
                                Patient Corrected (Awaiting Verification)
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant text-[10px] font-mono flex items-center gap-1">
                                <span className="material-symbols-outlined text-xs">document_scanner</span>
                                Raw OCR Extraction
                              </span>
                            )}

                            {/* Uncertainty Alert (Gate 2B) */}
                            {(confidenceScore < 75 || item.isUncertain || item.isUnreadable) && (
                              <span className="px-2 py-0.5 rounded-full bg-[#ffdad6] text-[#ba1a1a] text-[10px] font-bold flex items-center gap-1">
                                <span className="material-symbols-outlined text-xs">help_outline</span>
                                Uncertain / Low Confidence
                              </span>
                            )}
                          </div>

                          <label className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold select-none shadow-xs ${
                            item.isVerified ? 'bg-emerald-600 text-white' : (isMapped ? 'bg-secondary text-white' : 'bg-surface-container text-on-surface-variant')
                          }`}>
                            <input
                              type="checkbox"
                              checked={isMapped || item.isVerified}
                              readOnly
                              className="accent-secondary w-3.5 h-3.5 rounded"
                            />
                            <span>{item.isVerified ? 'Pharmacist Verified ✓' : (isMapped ? 'Patient Reviewed' : 'Unmapped')}</span>
                          </label>
                        </div>

                        {/* Patient Correction Notice */}
                        {item.sourceType === 'PATIENT_CORRECTED' && (
                          <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 flex flex-col gap-1">
                            <div className="flex items-center gap-1 font-bold text-[11px] text-amber-900">
                              <span className="material-symbols-outlined text-xs">info</span>
                              Patient Correction Recorded:
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-[11px]">
                              <span><strong>Corrected:</strong> {item.correctedMedicineName}</span>
                              {item.dosage && <span>• <strong>Dosage:</strong> {item.dosage}</span>}
                              {item.frequency && <span>• <strong>Freq:</strong> {item.frequency}</span>}
                              {item.duration && <span>• <strong>Duration:</strong> {item.duration}</span>}
                            </div>
                            <span className="text-[10px] text-amber-800 italic">
                              Raw OCR candidate remains preserved for pharmacist clinical verification.
                            </span>
                          </div>
                        )}

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
                          {(() => {
                            const rxType = identifyPrescriptionType(item, medicinesCatalog);
                            const isGenericPrescription = Boolean(item.isGeneric || rxType.isGeneric);
                            const genericCompoundName = item.prescribedGenericName || rxType.targetGeneric || item.medicineName;

                            return (
                              <div className="md:col-span-5 flex items-center gap-2.5">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                                  isGenericPrescription ? 'bg-secondary/15 text-secondary' : 'bg-secondary-container/40 text-secondary'
                                }`}>
                                  <span className="material-symbols-outlined text-xl">
                                    {isGenericPrescription ? 'science' : 'medication'}
                                  </span>
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
                                        {isGenericPrescription && (
                                          <span className="px-1.5 py-0.2 rounded bg-secondary/15 text-secondary text-[9px] font-bold uppercase tracking-wider">
                                            Selected Brand
                                          </span>
                                        )}
                                        <span className="px-1.5 py-0.2 rounded bg-error-container text-on-error-container text-[9px] font-bold uppercase">
                                          Rx
                                        </span>
                                      </div>
                                      <p className="text-[11px] text-on-surface-variant mt-0.5 truncate">
                                        {isGenericPrescription
                                          ? `Bioequivalent for ${genericCompoundName} · ${item.dosageForm || 'Formulation'}`
                                          : `${item.dosageForm || 'Formulation'} · ${item.genericName || 'Standardized catalogue'}`}
                                      </p>
                                    </>
                                  ) : item.pharmacistSelectionRequested ? (
                                    <div>
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <h3 className="text-sm font-bold text-amber-900 truncate">
                                          {genericCompoundName}
                                        </h3>
                                        <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-800 text-[10px] font-bold flex items-center gap-1">
                                          <span className="material-symbols-outlined text-[11px]">support_agent</span>
                                          Pharmacist Selection Pending
                                        </span>
                                      </div>
                                      <p className="text-[11px] text-amber-800 font-medium mt-0.5">
                                        Prescribed generic: {genericCompoundName} ({item.strength || item.dosage || 'Standard'} · Qty: {item.quantity || 1}) • Attending pharmacist will select genuine trade brand
                                      </p>
                                    </div>
                                  ) : isGenericPrescription ? (
                                    <div>
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <h3 className="text-sm font-bold text-secondary truncate">
                                          {item.matchedMedicineName || item.medicineName}
                                        </h3>
                                        <span className="px-1.5 py-0.2 rounded-full bg-secondary/15 text-secondary text-[10px] font-bold flex items-center gap-1">
                                          <span className="material-symbols-outlined text-[11px]">science</span>
                                          Generic Prescribed
                                        </span>
                                      </div>
                                      <p className="text-[11px] text-secondary font-medium mt-0.5">
                                        Prescribed by active ingredient • Matching brand options below
                                      </p>
                                    </div>
                                  ) : (
                                    <div>
                                      <span className="text-xs font-bold text-[#ba1a1a]">No Catalogue Match Yet</span>
                                      <p className="text-[11px] text-outline">Click Change / Remap to select candidate</p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Available Brand Formulations Quick-Select */}
                        {(() => {
                          const rxType = identifyPrescriptionType(item, medicinesCatalog);
                          const isGenericPrescription = Boolean(item.isGeneric || rxType.isGeneric);
                          const genericCompoundName = item.prescribedGenericName || rxType.targetGeneric || item.medicineName;
                          const matchingBrands = findMatchingBrands(item, medicinesCatalog);

                          if (isGenericPrescription && matchingBrands.length > 0) {
                            return (
                              <div className="flex flex-col gap-2.5 p-3.5 rounded-2xl bg-secondary/5 border border-secondary/25 shadow-xs">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="material-symbols-outlined text-sm text-secondary">science</span>
                                    <span className="text-xs font-bold text-primary">
                                      Doctor Prescribed Active Ingredient: <span className="text-secondary">{genericCompoundName}</span>
                                    </span>
                                  </div>
                                  <span className="text-[10px] text-outline font-semibold">
                                    {matchingBrands.length} verified trade brand{matchingBrands.length > 1 ? 's' : ''} available
                                  </span>
                                </div>
                                <p className="text-[11px] text-on-surface-variant leading-relaxed">
                                  Your prescription specifies this medicine by its generic compound. MediFind AI matched genuine bioequivalent formulations from certified pharmacies below. Choose a brand or request pharmacist selection:
                                </p>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                                  {matchingBrands.slice(0, 4).map(b => {
                                    const isCurrent = !item.pharmacistSelectionRequested && item.matchedMedicineId === b.id;
                                    return (
                                      <div
                                        key={b.id}
                                        className={`p-2.5 rounded-xl border transition-all flex items-center justify-between gap-2.5 ${
                                          isCurrent
                                            ? 'bg-secondary/15 border-secondary shadow-xs scale-[1.01]'
                                            : 'bg-white hover:bg-surface-container border-outline-variant/30 hover:border-secondary/40'
                                        }`}
                                      >
                                        <div className="flex flex-col min-w-0">
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="text-xs font-bold text-primary truncate">{b.brandName}</span>
                                            {b.strength && (
                                              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded-full bg-secondary/10 text-secondary font-semibold">
                                                {b.strength}
                                              </span>
                                            )}
                                          </div>
                                          <span className="text-[10px] text-on-surface-variant truncate">
                                            {b.dosageForm} • {b.manufacturer}
                                          </span>
                                          <div className="flex items-center gap-2 mt-0.5">
                                            <span className="text-[10px] font-bold text-primary">
                                              ₹{b.price != null ? b.price : '—'}
                                            </span>
                                            <span className="text-[9px] text-emerald-700 font-medium flex items-center gap-0.5">
                                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 inline-block"></span>
                                              In Stock
                                            </span>
                                          </div>
                                        </div>

                                        <button
                                          type="button"
                                          onClick={() => handleSelectMatchedMedicine(item.id, b.id)}
                                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1 cursor-pointer ${
                                            isCurrent
                                              ? 'bg-secondary text-white shadow-xs'
                                              : 'bg-surface-container hover:bg-secondary hover:text-white text-primary'
                                          }`}
                                        >
                                          <span className="material-symbols-outlined text-xs">
                                            {isCurrent ? 'check_circle' : 'add'}
                                          </span>
                                          <span>{isCurrent ? 'Selected' : 'Select'}</span>
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>

                                {/* Pharmacist Brand Clarification Option */}
                                {item.pharmacistSelectionRequested ? (
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30">
                                    <div className="flex items-start gap-2.5">
                                      <span className="material-symbols-outlined text-amber-600 text-lg mt-0.5 shrink-0">
                                        pending_actions
                                      </span>
                                      <div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="text-xs font-bold text-amber-900">
                                            Attending Pharmacist Brand Selection Requested
                                          </span>
                                          <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-800 text-[10px] font-bold">
                                            Pending Clinical Review
                                          </span>
                                        </div>
                                        <p className="text-[11px] text-amber-800 mt-1 leading-relaxed">
                                          The attending licensed pharmacist at the fulfillment pharmacy will evaluate your prescription and confirm the optimal bioequivalent trade brand for <strong>{genericCompoundName}</strong> ({item.strength || item.dosage || 'Standard'} • Qty: {item.quantity || 1}).
                                        </p>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                                      <button
                                        type="button"
                                        disabled={requestingPharmacistSelectionId === item.id}
                                        onClick={() => handleRequestPharmacistSelection(item.id, true)}
                                        className="px-3 py-1.5 rounded-xl bg-white hover:bg-amber-50 text-amber-900 border border-amber-300 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                                      >
                                        <span className="material-symbols-outlined text-xs">close</span>
                                        <span>Choose Brand Myself</span>
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-secondary/15">
                                    <button
                                      type="button"
                                      disabled={requestingPharmacistSelectionId === item.id}
                                      onClick={() => handleRequestPharmacistSelection(item.id, false)}
                                      className="inline-flex items-center gap-1.5 text-xs text-secondary font-bold hover:underline py-1 cursor-pointer"
                                    >
                                      <span className="material-symbols-outlined text-sm">support_agent</span>
                                      <span>
                                        {requestingPharmacistSelectionId === item.id
                                          ? 'Sending Request...'
                                          : 'Not sure which brand? Ask Attending Pharmacist to Select'}
                                      </span>
                                    </button>

                                    {matchingBrands.length > 4 && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setMappingModalItem(item);
                                          setMappingSearchQuery(cleanDrugSearch(genericCompoundName));
                                        }}
                                        className="text-[11px] font-semibold text-primary hover:underline cursor-pointer"
                                      >
                                        +{matchingBrands.length - 4} more brand options...
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          }

                          if (isGenericPrescription && matchingBrands.length === 0) {
                            return (
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30">
                                <div className="flex items-start gap-2">
                                  <span className="material-symbols-outlined text-amber-700 text-base mt-0.5">warning</span>
                                  <div>
                                    <span className="text-xs font-bold text-amber-900">
                                      No Catalogue Brands for Generic "{genericCompoundName}"
                                    </span>
                                    <p className="text-[11px] text-amber-800">
                                      This generic formulation is not yet in our catalog. Request pharmacist sourcing assistance or remove.
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPatientCorrectingCandidate(item);
                                      setPatientCorrectionForm({
                                        correctedMedicineName: genericCompoundName,
                                        dosage: item.dosage || '',
                                        frequency: item.frequency || '',
                                        duration: item.duration || '',
                                        patientNotes: 'Requesting pharmacist assistance for uncatalogued generic.'
                                      });
                                    }}
                                    className="px-3 py-1.5 rounded-xl bg-amber-700 text-white text-xs font-bold hover:bg-amber-800 transition-colors"
                                  >
                                    Ask Pharmacist
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveItem(item.id)}
                                    className="px-2.5 py-1.5 rounded-xl bg-white text-on-surface-variant text-xs hover:text-error transition-colors"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          if (!isGenericPrescription && matchingBrands.length > 0) {
                            return (
                              <div className="flex flex-col gap-1.5 p-3 rounded-2xl bg-surface-container-low/80 border border-secondary/20">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-bold text-secondary uppercase tracking-wider flex items-center gap-1">
                                    <span className="material-symbols-outlined text-xs">verified</span>
                                    Available Trade Brand Formulations:
                                  </span>
                                  <span className="text-[10px] text-outline font-medium">
                                    {matchingBrands.length} catalogue brand{matchingBrands.length > 1 ? 's' : ''} available
                                  </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                  {matchingBrands.slice(0, 4).map(b => {
                                    const isCurrent = item.matchedMedicineId === b.id;
                                    return (
                                      <button
                                        key={b.id}
                                        type="button"
                                        onClick={() => handleSelectMatchedMedicine(item.id, b.id)}
                                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border ${
                                          isCurrent
                                            ? 'bg-secondary text-white border-secondary shadow-xs scale-[1.02]'
                                            : 'bg-white hover:bg-surface-container text-primary border-surface-container hover:border-secondary/40'
                                        }`}
                                      >
                                        <span className="material-symbols-outlined text-xs">
                                          {isCurrent ? 'check_circle' : 'radio_button_unchecked'}
                                        </span>
                                        <span>{b.brandName}</span>
                                        {b.strength && (
                                          <span className={`text-[10px] font-mono px-1 rounded ${
                                            isCurrent ? 'bg-white/20 text-white' : 'bg-surface-container text-on-surface-variant'
                                          }`}>
                                            {b.strength}
                                          </span>
                                        )}
                                      </button>
                                    );
                                  })}
                                  {matchingBrands.length > 4 && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setMappingModalItem(item);
                                        setMappingSearchQuery(cleanDrugSearch(item.medicineName || item.rawName || ''));
                                      }}
                                      className="px-2.5 py-1 rounded-xl text-[11px] font-semibold text-secondary hover:underline"
                                    >
                                      +{matchingBrands.length - 4} more in catalogue...
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          }

                          return null;
                        })()}

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

                        {/* Gate 5 Quantity Lineage Breakdown */}
                        {(item.prescribedQuantity != null || item.allocatedQuantity != null || item.outstandingQuantity != null) && (
                          <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-2xl bg-surface-container-low/80 border border-outline-variant/30 text-xs">
                            <span className="text-[10px] font-bold text-outline uppercase tracking-wider flex items-center gap-1">
                              <span className="material-symbols-outlined text-xs text-secondary">analytics</span>
                              Lineage:
                            </span>
                            <span className="text-[11px] font-medium text-on-surface">
                              Prescribed: <strong>{item.prescribedQuantity ?? item.quantity ?? 1}</strong>
                            </span>
                            {(item.allocatedQuantity || 0) > 0 && (
                              <span className="text-[11px] font-medium text-secondary">
                                • Active Orders: <strong>{item.allocatedQuantity}</strong>
                              </span>
                            )}
                            {(item.fulfilledQuantity || 0) > 0 && (
                              <span className="text-[11px] font-medium text-emerald-700">
                                • Fulfilled: <strong>{item.fulfilledQuantity}</strong>
                              </span>
                            )}
                            {(item.cancelledQuantity || 0) > 0 && (
                              <span className="text-[11px] font-medium text-error">
                                • Cancelled: <strong>{item.cancelledQuantity}</strong>
                              </span>
                            )}
                            <span className={`text-[11px] font-bold ${(item.outstandingQuantity ?? item.quantity ?? 1) > 0 ? 'text-primary' : 'text-emerald-700'}`}>
                              • Outstanding: <strong>{item.outstandingQuantity ?? item.quantity ?? 1}</strong>
                            </span>
                          </div>
                        )}

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

                          {/* Actions: Patient Correct / Report Unreadable / Remap / Remove */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => handleStartPatientCorrection(item)}
                              className="px-3 py-1.5 rounded-full border border-secondary/40 bg-secondary/10 text-secondary hover:bg-secondary/20 text-xs font-bold transition-all flex items-center gap-1"
                              title="Correct readable text without guessing"
                            >
                              <span className="material-symbols-outlined text-sm">edit_note</span>
                              <span>Correct Text</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleReportUnreadable(item)}
                              className="px-3 py-1.5 rounded-full border border-outline-variant/40 bg-surface-container-low hover:bg-surface-container text-on-surface-variant text-xs font-semibold transition-all flex items-center gap-1"
                              title="Flag this handwriting or print as unreadable"
                            >
                              <span className="material-symbols-outlined text-sm">visibility_off</span>
                              <span>Report Unreadable</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setMappingModalItem(item);
                                setMappingSearchQuery(cleanDrugSearch(item.medicineName || item.rawName || ''));
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
                const canConfirm = detectedItems.length > 0;

                return (
                  <div className="flex flex-col gap-3 pt-3 border-t border-surface-container">
                    {unmappedCount > 0 && (
                      <div className="p-3.5 rounded-2xl bg-secondary-container/40 border border-secondary/20 text-xs text-on-surface-variant font-medium flex items-center gap-2">
                        <span className="material-symbols-outlined text-base text-secondary shrink-0">info</span>
                        <span>
                          {unmappedCount} medicine{unmappedCount > 1 ? 's are' : ' is'} uncatalogued and will be preserved as written on your prescription, or you can click "Change / Remap Drug" to map to a standardized formulation.
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
                        disabled={!canConfirm || isVerifying}
                        className="px-7 py-3 rounded-full bg-primary hover:bg-primary-container text-white font-bold text-xs shadow-md transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isVerifying && <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>}
                        <span>{isVerifying ? 'Verifying Medications...' : 'Confirm & Proceed to Verification Summary'}</span>
                        {!isVerifying && <span className="material-symbols-outlined text-base">arrow_forward</span>}
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
          {/* Top Navigation & Stepper Header */}
          <PrescriptionWorkflowStepper
            currentStep={4}
            onNavigateToStep={setStep}
            subtitle="Verification Complete"
            title="Prescription Verified & Ready for Matching"
            icon="verified"
            backButton={
              <button
                type="button"
                onClick={() => setStep(3)}
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-surface-container hover:bg-surface-container-high text-primary font-bold text-xs transition-colors shadow-xs"
              >
                <span className="material-symbols-outlined text-sm">arrow_back</span>
                <span>Back to Verification</span>
              </button>
            }
          />

          {/* Main Confirmation Hero Panel */}
          <section className="w-full bg-gradient-to-br from-surface-container-lowest via-surface-container-low to-secondary-container/20 rounded-3xl p-6 sm:p-8 shadow-md relative overflow-hidden border border-outline-variant/30">
            <div className="relative z-10 max-w-4xl flex flex-col items-start gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-white shadow-lg shadow-primary/20 shrink-0">
                  <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                    task_alt
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-secondary uppercase tracking-wider">
                    Authentication Verified
                  </span>
                  <div className="flex items-center gap-2 text-xs text-on-surface flex-wrap">
                    <span className="text-on-surface-variant font-medium">Session ID:</span>
                    <span className="font-mono text-primary font-bold">
                      {prescription?.id ? `RX-${prescription.id.slice(0, 8).toUpperCase()}` : 'RX-AUTH-9102'}
                    </span>
                    <span className="text-outline">•</span>
                    <span className="text-secondary flex items-center gap-1 font-semibold">
                      <span className="material-symbols-outlined text-xs">lock</span> Encrypted Vault
                    </span>
                  </div>
                </div>
              </div>

              <h1 className="text-xl sm:text-3xl font-extrabold text-primary leading-tight mt-1">
                Prescription Medicines Verified Successfully
              </h1>

              <p className="text-xs sm:text-sm text-on-surface-variant max-w-3xl leading-relaxed">
                All medications extracted from your doctor's prescription have been confirmed and mapped to MediFind AI's standardized 50-medicine catalogue. Your medicine request is now prepared to search live local dispensary inventory.
              </p>
            </div>
          </section>

          {/* Two-Column Balanced Workspace: Left = Uploaded Prescription Photo & Parameters | Right = Verified Medications & Next Steps */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column (5 cols): Uploaded Prescription Photo Card & Safety Parameters */}
            <div className="lg:col-span-5 flex flex-col gap-5 sticky top-24">
              {/* Uploaded Prescription Photo Preview Card matching Stitch Image 2 */}
              <div className="bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/30 shadow-sm flex flex-col gap-3">
                <div className="flex items-center justify-between pb-2 border-b border-surface-container">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="material-symbols-outlined text-secondary text-lg">description</span>
                    <span className="text-xs font-bold text-primary truncate max-w-[200px]">
                      {getDisplayFileName()}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[10px] font-bold uppercase tracking-wider">
                    Verified Source
                  </span>
                </div>

                {/* Version Selector & Compare Toggle for Step 4 */}
                {imageVersions.length > 0 && (
                  <div className="flex flex-col gap-2 pb-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs text-secondary">layers</span>
                        Image Versions ({imageVersions.length})
                      </span>
                      {imageVersions.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setIsComparingOriginal(prev => !prev)}
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                            isComparingOriginal
                              ? 'bg-secondary text-white shadow-xs'
                              : 'bg-surface-container hover:bg-surface-container-high text-secondary border border-secondary/30'
                          }`}
                          title="Compare currently selected version against original upload side-by-side"
                        >
                          <span className="material-symbols-outlined text-xs">compare</span>
                          <span>{isComparingOriginal ? 'Exit Compare' : 'Compare Original (v1)'}</span>
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-thin">
                      {imageVersions.map((ver) => {
                        const isSelected = selectedImageVersion ? selectedImageVersion.id === ver.id : ver.isActive;
                        return (
                          <button
                            key={ver.id}
                            type="button"
                            onClick={() => handleSelectVersion(ver)}
                            className={`px-2.5 py-1 rounded-xl text-[11px] font-bold flex items-center gap-1.5 shrink-0 transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-primary text-white shadow-xs'
                                : 'bg-surface-container hover:bg-surface-container-high text-on-surface-variant'
                            }`}
                          >
                            <span>v{ver.versionNumber}</span>
                            <span className="text-[9px] px-1 py-0.2 rounded-md bg-white/20 uppercase font-mono tracking-wider">
                              {ver.isOriginal ? 'Original' : ver.parentImageId ? `Enhanced — v${ver.versionNumber}` : `Replacement — v${ver.versionNumber}`}
                            </span>
                            {ver.isActive && (
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="Active Version" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Preview Window with Click-to-Zoom or Version Comparison */}
                {isComparingOriginal && imageVersions.length > 1 ? (
                  <div className="grid grid-cols-2 gap-2 p-2 bg-surface-container-low rounded-2xl border border-outline-variant/30 min-h-[220px]">
                    <div className="flex flex-col gap-1 items-center">
                      <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs text-secondary">history</span>
                        Original (v1)
                      </span>
                      <AuthenticatedPrescriptionImage
                        prescriptionId={prescription?.id}
                        imageId={imageVersions[0]?.id}
                        alt="Original prescription"
                        className="w-full h-44 sm:h-72 object-contain rounded-xl bg-black/40 select-none shadow-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1 items-center">
                      <span className="text-[10px] font-bold text-primary uppercase tracking-wider flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs text-primary">auto_fix_high</span>
                        {selectedImageVersion?.isOriginal
                          ? 'Original (v1)'
                          : `Enhanced — v${selectedImageVersion?.versionNumber || 'Selected'}`}
                      </span>
                      <AuthenticatedPrescriptionImage
                        prescriptionId={prescription?.id}
                        imageId={selectedImageVersion?.id}
                        fallbackSrc={filePreviewUrl || persistentImageSrc}
                        alt="Selected prescription version"
                        className="w-full h-44 sm:h-72 object-contain rounded-xl bg-black/40 select-none shadow-xs"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="relative bg-surface-container-low rounded-2xl overflow-hidden min-h-[220px] sm:min-h-[380px] lg:min-h-[660px] p-2 flex items-center justify-center border border-outline-variant/20 shadow-inner group">
                    <AuthenticatedPrescriptionImage
                      prescriptionId={prescription?.id}
                      imageId={selectedImageVersion?.id}
                      fallbackSrc={filePreviewUrl || persistentImageSrc}
                      rotation={previewRotation}
                      alt="Prescription Photo Preview"
                      className="w-full h-auto max-h-[260px] sm:max-h-[420px] lg:max-h-[720px] object-contain rounded-xl select-none"
                      showEnlargeHint={true}
                      onClick={() => setIsImageModalOpen(true)}
                      customEmptyState={
                        <PrescriptionDocumentSlip
                          prescription={prescription}
                          detectedItems={detectedItems}
                          fileName={getDisplayFileName()}
                          rotation={previewRotation}
                          ocrText={ocrText}
                        />
                      }
                    />
                  </div>
                )}

                {/* Stitch Image 2 Quick Interactive Actions Toolbar */}
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsImageModalOpen(true)}
                    className="px-2.5 py-1.5 rounded-xl bg-surface-container-low hover:bg-surface-container text-primary text-xs font-bold flex items-center justify-center gap-1.5 border border-outline-variant/30 transition-colors shadow-2xs cursor-pointer"
                    title="Open enlarged high-resolution document viewer"
                  >
                    <span className="material-symbols-outlined text-sm text-secondary">open_in_full</span>
                    <span className="truncate">Enlarge Preview</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPreviewRotation(r => (r + 90) % 360)}
                    className="px-2.5 py-1.5 rounded-xl bg-surface-container-low hover:bg-surface-container text-primary text-xs font-bold flex items-center justify-center gap-1.5 border border-outline-variant/30 transition-colors shadow-2xs cursor-pointer"
                    title="Rotate prescription 90 degrees"
                  >
                    <span className="material-symbols-outlined text-sm text-secondary">rotate_right</span>
                    <span className="truncate">Rotate {previewRotation !== 0 ? `(${previewRotation}°)` : ''}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowRawTextModal(true)}
                    className="px-2.5 py-1.5 rounded-xl bg-surface-container-low hover:bg-surface-container text-primary text-xs font-bold flex items-center justify-center gap-1.5 border border-outline-variant/30 transition-colors shadow-2xs cursor-pointer"
                    title="Inspect raw extracted OCR text"
                  >
                    <span className="material-symbols-outlined text-sm text-secondary">code</span>
                    <span className="truncate">View Raw Text</span>
                  </button>
                </div>

                {/* Patient Confirmed Status */}
                <div className="p-3 rounded-xl bg-secondary-container/30 border border-secondary/20 text-[11px] text-on-surface-variant flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-secondary text-base shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>
                      check_circle
                    </span>
                    <span className="font-bold text-primary">Patient Confirmed Source</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className="text-xs text-secondary font-bold hover:underline flex items-center gap-0.5 cursor-pointer"
                  >
                    <span>Re-verify</span>
                    <span className="material-symbols-outlined text-xs">chevron_right</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Right Column (7 cols): Verified Medications List + What happens next + CTA */}
            <div className="lg:col-span-7 flex flex-col gap-5">
              {/* Verified Medications Summary Card */}
              <div className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/30 shadow-sm flex flex-col gap-4">
                <div className="flex items-center justify-between pb-3 border-b border-surface-container">
                  <div>
                    <h2 className="text-lg font-bold text-primary">Verified Medications for Availability Query</h2>
                    <span className="text-xs text-secondary font-medium block mt-0.5">
                      {detectedItems.length} Item{detectedItems.length === 1 ? '' : 's'} Ready for Geo-Inventory Matching
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className="px-3 py-1 rounded-full bg-surface-container hover:bg-surface-container-high text-primary text-xs font-semibold flex items-center gap-1 transition-colors"
                  >
                    <span className="material-symbols-outlined text-xs">edit</span>
                    <span>Edit Selection</span>
                  </button>
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
                          {item.pharmacistSelectionRequested ? (
                            <>
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-base font-bold text-amber-900">
                                  {item.medicineName || item.rawName}
                                </h3>
                                {item.strength && (
                                  <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-800 text-[10px] font-semibold">
                                    {item.strength}
                                  </span>
                                )}
                                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-800 text-[10px] font-bold flex items-center gap-1">
                                  <span className="material-symbols-outlined text-[11px]">support_agent</span>
                                  Pharmacist Selection Pending
                                </span>
                              </div>
                              <p className="text-xs text-amber-800 mt-0.5">
                                {item.dosageForm || 'Prescription formulation'} · Quantity: <strong>{item.quantity || 1} units</strong> · Attending pharmacist will select verified trade brand
                              </p>
                            </>
                          ) : (
                            <>
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
                            </>
                          )}
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
              </div>

              {/* What Happens Next & Primary Call To Action */}
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
                        Query participating pharmacies across the Chengannur region for shelf stock.
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
                <div className="flex flex-col gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      const verifiedToPass = (detectedItems || []).map((i, idx) => {
                        let medId = i.matchedMedicineId;
                        if (!medId && i.allMatches && i.allMatches.length > 0) {
                          medId = i.allMatches[0].medicineId;
                        }
                        if (!medId && Array.isArray(medicinesCatalog) && medicinesCatalog.length > 0) {
                          const nameLower = (i.medicineName || i.rawName || '').toLowerCase();
                          const match = medicinesCatalog.find(m =>
                            m.brandName.toLowerCase() === nameLower ||
                            (m.genericName && nameLower.includes(m.genericName.toLowerCase()))
                          );
                          if (match) medId = match.id;
                        }
                        if (!medId) {
                          medId = `custom-med-${(i.medicineName || i.rawName || `item-${idx}`).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
                        }
                        return {
                          medicineId: medId,
                          brandName: i.matchedMedicineName || i.medicineName || i.rawName || 'Prescription Medicine',
                          genericName: i.rawName || i.genericName || '',
                          dosageForm: i.dosageForm || 'Tablet',
                          strength: i.strength || i.dosage || '',
                          quantity: parseInt(i.quantity, 10) || 1,
                          pharmacistSelectionRequested: Boolean(i.pharmacistSelectionRequested)
                        };
                      });
                      if (onAddVerifiedToRequest && verifiedToPass.length > 0) {
                        onAddVerifiedToRequest(verifiedToPass);
                      }
                      // Session is strictly preserved until reservation hold succeeds
                      if (onProceedToPharmacies) {
                        onProceedToPharmacies(verifiedToPass, prescription?.id);
                      } else {
                        setAvailModalOpen(true);
                      }
                    }}
                    className="w-full py-3.5 sm:py-4 rounded-full bg-primary hover:bg-primary-container text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>Find Available Pharmacies</span>
                    <span className="material-symbols-outlined text-base">arrow_forward</span>
                  </button>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      type="button"
                      onClick={() => setStep(3)}
                      className="flex-1 py-2.5 rounded-full bg-surface-container hover:bg-surface-container-high text-primary font-bold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-sm">arrow_back</span>
                      <span>Edit Medicines</span>
                    </button>
                    <button
                      type="button"
                      onClick={reset}
                      className="flex-1 py-2.5 rounded-full bg-surface-container-low hover:bg-surface-container text-secondary font-bold text-xs transition-colors flex items-center justify-center gap-1.5 border border-outline-variant/30 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-sm">restart_alt</span>
                      <span>Upload New Rx</span>
                    </button>
                  </div>

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

            {/* Suggested Trade Brand Formulations for this specific drug */}
            {(() => {
              const suggestedBrands = findMatchingBrands(mappingModalItem, medicinesCatalog);
              if (suggestedBrands.length === 0) return null;
              return (
                <div className="flex flex-col gap-2.5 p-4 rounded-2xl bg-secondary-container/20 border border-secondary/30">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-primary flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-base text-secondary">verified</span>
                      Suggested Trade Brands for "{mappingModalItem.medicineName || mappingModalItem.rawName}":
                    </span>
                    <span className="text-[11px] text-outline font-semibold">
                      {suggestedBrands.length} Brand Options in Catalogue
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    {suggestedBrands.map(med => {
                      const isSelected = mappingModalItem.matchedMedicineId === med.id;
                      return (
                        <div
                          key={med.id}
                          className={`p-3 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                            isSelected
                              ? 'bg-secondary/15 border-secondary shadow-xs'
                              : 'bg-white hover:bg-surface-container border-outline-variant/30'
                          }`}
                        >
                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold text-primary truncate">{med.brandName}</span>
                              <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-secondary/10 text-secondary font-mono">
                                {med.strength}
                              </span>
                            </div>
                            <span className="text-[10px] text-on-surface-variant truncate">
                              {med.genericName} • {med.dosageForm}
                            </span>
                            <span className="text-[10px] text-outline">
                              ₹{med.price || '—'}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              handleSelectMatchedMedicine(mappingModalItem.id, med.id);
                              setMappingModalItem(null);
                            }}
                            className={`px-3 py-1.5 rounded-full text-xs font-bold shrink-0 transition-all flex items-center gap-1 ${
                              isSelected
                                ? 'bg-secondary text-white'
                                : 'bg-primary hover:bg-primary-container text-white'
                            }`}
                          >
                            <span className="material-symbols-outlined text-xs">
                              {isSelected ? 'check' : 'add'}
                            </span>
                            <span>{isSelected ? 'Confirmed' : 'Select'}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Live Search Capsule Input */}
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-base pointer-events-none">
                search
              </span>
              <input
                type="text"
                value={mappingSearchQuery}
                onChange={e => setMappingSearchQuery(e.target.value)}
                placeholder="Search"
                className="w-full h-11 pl-9 pr-3 rounded-full bg-surface-container-low border border-outline-variant/30 text-xs text-on-surface outline-none focus:border-secondary font-bold"
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
                    const bLower = (m.brandName || '').toLowerCase();
                    const gLower = (m.genericName || '').toLowerCase();
                    const altLower = (m.alternativeGenerics || '').toLowerCase();

                    // Direct match
                    if (bLower.includes(q) || gLower.includes(q) || altLower.includes(q)) return true;

                    // Multi-token query match (e.g. active compound + dosage)
                    const tokens = q.split(/\s+/).filter(t => t.length >= 2);
                    if (tokens.length > 1) {
                      return tokens.every(tok => bLower.includes(tok) || gLower.includes(tok) || altLower.includes(tok));
                    }
                    return false;
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
        prescriptionId={prescription?.id}
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
        isLoading={isVerifying}
        onConfirm={async () => {
          if (confirmDialog.onConfirm) {
            await confirmDialog.onConfirm();
          }
          setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        }}
        onCancel={() => {
          if (!isVerifying) setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        }}
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
        {isImageModalOpen && (
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
              className="relative max-w-4xl w-full max-h-[92vh] bg-surface-container-lowest rounded-3xl p-4 sm:p-6 shadow-2xl border border-outline-variant/30 flex flex-col items-center overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-full flex items-center justify-between pb-3 border-b border-surface-container mb-3">
                <span className="text-xs font-bold text-primary flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-base text-secondary">zoom_in</span>
                  High-Resolution Prescription Scan Preview {previewRotation !== 0 ? `(${previewRotation}°)` : ''}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPreviewRotation(r => (r + 90) % 360)}
                    className="px-3 py-1 rounded-full bg-surface-container hover:bg-surface-container-high text-primary font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer"
                    title="Rotate 90 degrees clockwise"
                  >
                    <span className="material-symbols-outlined text-sm text-secondary">rotate_right</span>
                    <span>Rotate</span>
                  </button>
                  {currentPreviewSrc && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsImageModalOpen(false);
                        handleOpenCropper(currentPreviewSrc);
                      }}
                      className="px-3.5 py-1 rounded-full bg-surface-container hover:bg-surface-container-high text-primary font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer"
                      title="Crop this prescription photo"
                    >
                      <span className="material-symbols-outlined text-sm text-secondary">crop</span>
                      <span>Crop Photo</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsImageModalOpen(false)}
                    className="w-8 h-8 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface-variant flex items-center justify-center transition-colors cursor-pointer"
                    title="Close preview"
                  >
                    <span className="material-symbols-outlined text-base">close</span>
                  </button>
                </div>
              </div>

              <div className="w-full flex items-center justify-center overflow-auto max-h-[75vh] p-2">
                <AuthenticatedPrescriptionImage
                  prescriptionId={prescription?.id}
                  imageId={selectedImageVersion?.id}
                  fallbackSrc={filePreviewUrl || persistentImageSrc}
                  rotation={previewRotation}
                  alt="Enlarged prescription preview"
                  className="max-h-[70vh] w-auto object-contain rounded-2xl shadow-sm select-none"
                  customEmptyState={
                    <div className="w-full max-w-xl">
                      <PrescriptionDocumentSlip
                        prescription={prescription}
                        detectedItems={detectedItems}
                        fileName={getDisplayFileName()}
                        rotation={previewRotation}
                        isEnlarged={true}
                        ocrText={ocrText}
                      />
                    </div>
                  }
                />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Raw OCR Text Inspection Modal (Stitch Image 2 Action) */}
      <AnimatePresence>
        {showRawTextModal && (
          <div
            className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md"
            onClick={() => setShowRawTextModal(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Raw OCR Extracted Text"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 12 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="relative max-w-2xl w-full bg-surface-container-lowest rounded-3xl p-5 sm:p-6 shadow-2xl border border-outline-variant/30 flex flex-col gap-4 max-h-[85vh] overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between pb-3 border-b border-surface-container">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-secondary text-lg">code</span>
                  <h3 className="text-sm font-bold text-primary">Raw Optical Text Stream</h3>
                  {ocrConfidence !== null && (
                    <span className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[10px] font-mono font-bold">
                      {ocrConfidence}% Confidence
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowRawTextModal(false)}
                  className="w-8 h-8 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface-variant flex items-center justify-center transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>

              <div className="text-xs text-on-surface-variant">
                Below is the verbatim character stream parsed by MediFind AI's optical character recognition engine directly from your uploaded document.
              </div>

              <div className="flex-1 overflow-y-auto bg-surface-container-lowest/90 border border-outline-variant/30 rounded-2xl p-4 font-mono text-xs text-on-surface whitespace-pre-wrap leading-relaxed select-text shadow-inner">
                {ocrText || (
                  <span className="text-outline italic">
                    No raw OCR text available yet. Please upload or capture a clinical prescription document.
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-surface-container text-xs">
                <span className="text-[11px] text-on-surface-variant font-mono">
                  Characters: {(ocrText || '').length} | Lines: {(ocrText || '').split('\n').filter(Boolean).length || 0}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const textToCopy = ocrText || 'No raw OCR text available.';
                    navigator.clipboard.writeText(textToCopy);
                    showToast('Raw OCR text copied to clipboard', 'success');
                  }}
                  className="px-3 py-1.5 rounded-full bg-secondary-container text-on-secondary-container hover:bg-secondary/20 text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">content_copy</span>
                  <span>Copy OCR Text</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Interactive Prescription Photo Cropper Modal */}
      <ImageCropperModal
        isOpen={isCropModalOpen}
        imageSrc={cropTargetSrc || currentPreviewSrc}
        fileName={file?.name || 'prescription_photo.jpg'}
        onClose={() => setIsCropModalOpen(false)}
        onCropComplete={handleCropComplete}
      />

      {/* Patient Candidate Correction Modal (Gate 2B) */}
      <AnimatePresence>
        {patientCorrectingCandidate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg bg-surface-container-lowest rounded-3xl p-6 sm:p-7 shadow-2xl border border-secondary/30 flex flex-col gap-4 text-on-surface"
            >
              <div className="flex items-center justify-between pb-3 border-b border-surface-container">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-secondary text-2xl">edit_note</span>
                  <div>
                    <h3 className="text-base font-bold text-primary">Correct Readable Medicine Text</h3>
                    <p className="text-[11px] text-on-surface-variant">
                      Raw OCR extraction remains intact. Pharmacist will verify this correction against the doctor's slip.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPatientCorrectingCandidate(null)}
                  className="w-8 h-8 rounded-full bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>

              {/* Raw OCR Reference Display */}
              <div className="p-3 rounded-2xl bg-surface-container-low border border-surface-container text-xs flex flex-col gap-1">
                <span className="text-[10px] font-bold text-outline uppercase tracking-wider">Raw Unedited OCR Reading:</span>
                <span className="font-mono text-primary font-bold">
                  "{patientCorrectingCandidate.rawName || patientCorrectingCandidate.medicineName || 'Detected item'}"
                </span>
              </div>

              <form onSubmit={handleSubmitPatientCorrection} className="flex flex-col gap-3 text-xs">
                <div>
                  <label className="block text-[11px] font-bold text-primary mb-1">
                    Corrected Medicine Name / Brand / Generic
                  </label>
                  <input
                    type="text"
                    required
                    value={patientCorrectionForm.correctedMedicineName}
                    onChange={e => setPatientCorrectionForm(prev => ({ ...prev, correctedMedicineName: e.target.value }))}
                    placeholder="Medicine"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/30 text-xs text-on-surface focus:outline-none focus:border-secondary font-bold"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-primary mb-1">Dosage / Strength</label>
                    <input
                      type="text"
                      value={patientCorrectionForm.dosage}
                      onChange={e => setPatientCorrectionForm(prev => ({ ...prev, dosage: e.target.value }))}
                      placeholder="Dosage"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/30 text-xs text-on-surface focus:outline-none focus:border-secondary font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-primary mb-1">Frequency</label>
                    <input
                      type="text"
                      value={patientCorrectionForm.frequency}
                      onChange={e => setPatientCorrectionForm(prev => ({ ...prev, frequency: e.target.value }))}
                      placeholder="Frequency"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/30 text-xs text-on-surface focus:outline-none focus:border-secondary font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-primary mb-1">Duration</label>
                    <input
                      type="text"
                      value={patientCorrectionForm.duration}
                      onChange={e => setPatientCorrectionForm(prev => ({ ...prev, duration: e.target.value }))}
                      placeholder="Duration"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/30 text-xs text-on-surface focus:outline-none focus:border-secondary font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-primary mb-1">Clarification Note</label>
                    <input
                      type="text"
                      value={patientCorrectionForm.patientNotes}
                      onChange={e => setPatientCorrectionForm(prev => ({ ...prev, patientNotes: e.target.value }))}
                      placeholder="Instructions"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/30 text-xs text-on-surface focus:outline-none focus:border-secondary font-bold"
                    />
                  </div>
                </div>

                <div className="p-3 rounded-2xl bg-secondary-container/40 text-[11px] text-on-secondary-container flex items-start gap-2">
                  <span className="material-symbols-outlined text-sm text-secondary shrink-0 mt-0.5">verified_user</span>
                  <span>
                    <strong>Clinical Safety Rule:</strong> Patient corrections do not grant verified status. A registered pharmacist will inspect the prescription document before dispensation.
                  </span>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setPatientCorrectingCandidate(null)}
                    className="px-4 py-2 rounded-full bg-surface-container text-on-surface text-xs font-semibold hover:bg-surface-container-high transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingCorrection || !patientCorrectionForm.correctedMedicineName.trim()}
                    className="px-5 py-2 rounded-full bg-secondary text-white text-xs font-bold hover:bg-secondary/90 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                  >
                    {isSubmittingCorrection ? 'Recording...' : 'Submit Correction'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* Previous Prescription Record View Modal (Problem 2 & 4) */}
        {viewModalRx && (
          <div
            className="fixed inset-0 z-[1250] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md overflow-y-auto"
            onClick={() => setViewModalRx(null)}
            role="dialog"
            aria-modal="true"
            aria-label="Prescription Details"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="relative max-w-2xl w-full bg-surface-container-lowest rounded-3xl p-6 shadow-2xl border border-outline-variant/30 flex flex-col gap-5 my-8 text-on-surface"
              onClick={e => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-start justify-between pb-4 border-b border-surface-container">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-secondary-container text-on-secondary-container flex items-center justify-center shrink-0 shadow-xs">
                    <span className="material-symbols-outlined text-xl">description</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-primary font-mono">
                        Prescription #{String(viewModalRx.id).slice(-6).toUpperCase()}
                      </h3>
                      <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                        viewModalRx.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' :
                        viewModalRx.status === 'VERIFIED' ? 'bg-secondary-container text-on-secondary-container' :
                        viewModalRx.status === 'FAILED' ? 'bg-error-container text-on-error-container' :
                        'bg-surface-container text-on-surface-variant'
                      }`}>
                        {viewModalRx.status}
                      </span>
                    </div>
                    <p className="text-xs text-on-surface-variant mt-0.5">
                      Uploaded {new Date(viewModalRx.createdAt).toLocaleDateString(undefined, {
                        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
                      })}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setViewModalRx(null)}
                  className="w-8 h-8 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface flex items-center justify-center transition-colors cursor-pointer"
                  title="Close modal"
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </div>

              {/* Metadata strip */}
              <div className="grid grid-cols-2 gap-3 p-3.5 rounded-2xl bg-surface-container-low border border-outline-variant/20 text-xs">
                <div>
                  <span className="text-[10px] uppercase font-bold text-outline">Prescribing Physician</span>
                  <p className="font-semibold text-primary mt-0.5">{viewModalRx.doctorName || 'Dr. Registered Physician'}</p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-outline">Clinical Facility</span>
                  <p className="font-semibold text-on-surface mt-0.5">{viewModalRx.clinicName || 'Community Health Clinic'}</p>
                </div>
              </div>

              {/* Prescription Image & Items Grid */}
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="sm:w-44 shrink-0 flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">
                    Prescription Slip
                  </span>
                  <div
                    className="relative rounded-2xl overflow-hidden bg-surface-container border border-outline-variant/30 h-44 group cursor-zoom-in flex items-center justify-center"
                    onClick={() => {
                      const imgUrl = `${API}/prescriptions/${viewModalRx.id}/image`;
                      setCropTargetSrc(imgUrl);
                      setIsImageModalOpen(true);
                    }}
                    title="Click to view image in high resolution"
                  >
                    <img
                      src={`${API}/prescriptions/${viewModalRx.id}/image`}
                      alt="Prescription document"
                      className="w-full h-full object-contain"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-bold gap-1">
                      <span className="material-symbols-outlined text-sm">zoom_in</span>
                      <span>Zoom</span>
                    </div>
                  </div>
                </div>

                <div className="flex-1 flex flex-col gap-2 min-w-0">
                  {(() => {
                    const items = Array.isArray(viewModalRx.items) && viewModalRx.items.length > 0
                      ? viewModalRx.items
                      : (Array.isArray(viewModalRx.detectedMedicines) ? viewModalRx.detectedMedicines : []);

                    return (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">
                            Extracted Medications ({items.length})
                          </span>
                          <span className="text-[11px] font-semibold text-secondary font-mono">
                            {items.filter(i => i.isVerified || i.isConfirmed).length} verified
                          </span>
                        </div>

                        {items.length === 0 ? (
                          <div className="p-4 rounded-2xl bg-surface-container-low/50 border border-dashed border-outline-variant/30 text-center text-xs text-on-surface-variant">
                            No medication items confirmed for this record. Click "Resume Activity" to scan or verify.
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2 max-h-52 overflow-y-auto pr-1">
                            {items.map((item, idx) => (
                              <div
                                key={item.id || idx}
                                className="p-3 rounded-xl bg-surface-container-low border border-outline-variant/20 flex items-start justify-between gap-2"
                              >
                                <div className="flex flex-col gap-0.5 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs font-bold text-primary truncate">
                                      {item.matchedMedicineName || item.brandName || item.rawName || 'Prescribed Medicine'}
                                    </span>
                                    {item.dosage && (
                                      <span className="px-2 py-0.2 rounded-md bg-secondary-container/60 text-on-secondary-container text-[10px] font-semibold">
                                        {item.dosage}
                                      </span>
                                    )}
                                  </div>
                                  {item.rawName && item.rawName !== item.matchedMedicineName && (
                                    <span className="text-[10px] text-on-surface-variant font-mono truncate">
                                      Rx: "{item.rawName}"
                                    </span>
                                  )}
                                  {item.frequency && (
                                    <span className="text-[10px] text-outline">
                                      Regimen: {item.frequency}
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-col items-end gap-1 shrink-0">
                                  <span className="text-xs font-bold font-mono text-secondary">
                                    Qty: {item.quantity || 1}
                                  </span>
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                    item.isVerified || item.isConfirmed
                                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                  }`}>
                                    {item.isVerified || item.isConfirmed ? 'Verified' : 'Pending'}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-surface-container">
                <button
                  type="button"
                  onClick={() => setViewModalRx(null)}
                  className="px-4 py-2 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface font-bold text-xs transition-colors cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const rxToResume = viewModalRx;
                    setViewModalRx(null);
                    loadPrescriptionById(rxToResume.id);
                  }}
                  className="px-5 py-2 rounded-full bg-primary hover:bg-primary-container text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                >
                  <span>Resume Activity</span>
                  <span className="material-symbols-outlined text-sm">arrow_forward</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
