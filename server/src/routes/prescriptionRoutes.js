const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  uploadPrescription,
  verifyDetectedMedicines,
  getPrescriptionById,
  getPrescriptionImage,
  getUserPrescriptions,
  getAcademicSamples,
  screenPrescriptionIntegrity,
  getPrescriptionImages,
  replaceOrEnhancePrescriptionImage,
  setActivePrescriptionImage,
  retryPrescriptionOcr,
  submitPatientCandidateCorrection,
  reportCandidateUnreadable,
  submitPatientCorrections,
  pharmacistVerifyItem,
  pharmacistRejectItem,
  pharmacistVerifyPrescription,
  pharmacistRequestItemClarification,
  matchPrescriptionAvailability,
  submitPrescriptionFollowUp,
  requestPharmacistSelection
} = require('../controllers/prescriptionController');
const { authenticateToken } = require('../middlewares/auth');

// ─── Upload Directory ──────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, '../../uploads/prescriptions');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ─── Allowed MIME Types & Extensions ─────────────────────────────────────────
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'image/heic', 'image/heif', 'image/heif-sequence',
  'image/bmp', 'image/tiff', 'application/octet-stream'
]);
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.bmp', '.tiff']);

// ─── Multer Storage ───────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Server-controlled filename — never trust original filename for path
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ALLOWED_EXTENSIONS.has(ext) ? ext : '.jpg';
    cb(null, 'rx-' + uniqueSuffix + safeExt);
  }
});

// ─── Multer File Filter (MIME + Extension whitelist) ─────────────────────────
const fileFilter = function (req, file, cb) {
  const mimetype = file.mimetype ? file.mimetype.toLowerCase() : '';
  const ext = path.extname(file.originalname || '').toLowerCase();

  const isImageMime = mimetype.startsWith('image/') || mimetype === 'application/octet-stream';
  const hasImageExt = ALLOWED_EXTENSIONS.has(ext) || !ext;

  if (isImageMime || hasImageExt) {
    cb(null, true); // Accept
  } else {
    cb(new multer.MulterError(
      'LIMIT_UNEXPECTED_FILE',
      `Unsupported file type "${mimetype}" (${ext}). Please upload a valid prescription image.`
    ), false);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB maximum
  fileFilter
});

// ─── Multer Error Handler ─────────────────────────────────────────────────────
function multerErrorHandler(err, req, res, next) {
  if (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        error: 'Uploaded file exceeds the 10 MB size limit. Please compress or resize the image.'
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(415).json({
        success: false,
        error: err.message || 'Unsupported file type. Only JPEG, PNG, and WEBP images are accepted.'
      });
    }
    return res.status(400).json({ success: false, error: err.message || 'Upload error.' });
  }
  next();
}

// Flexible upload middleware supporting 'prescriptionImage' or 'image' field names
const uploadPrescriptionImage = (req, res, next) => {
  upload.fields([
    { name: 'prescriptionImage', maxCount: 1 },
    { name: 'image', maxCount: 1 }
  ])(req, res, (err) => {
    if (err) return multerErrorHandler(err, req, res, next);
    if (req.files) {
      if (req.files.prescriptionImage && req.files.prescriptionImage[0]) {
        req.file = req.files.prescriptionImage[0];
      } else if (req.files.image && req.files.image[0]) {
        req.file = req.files.image[0];
      }
    }
    next();
  });
};

// ─── Routes ───────────────────────────────────────────────────────────────────

// Public: academic sample prescriptions for demo/defense
router.get('/samples', getAcademicSamples);

// POST /upload — real image upload + OCR
router.post(
  '/upload',
  authenticateToken,
  uploadPrescriptionImage,
  uploadPrescription
);

// PUT /:id/verify — patient verification of detected medicines
router.put('/:id/verify', authenticateToken, verifyDetectedMedicines);

// POST /:id/request-pharmacist-selection — patient requests attending pharmacist to select brand
router.post('/:id/request-pharmacist-selection', authenticateToken, requestPharmacistSelection);

// GET /:id/image — serve prescription image through authenticated endpoint (NOT public static)
// Supports ?imageId=<id> to retrieve specific version
router.get('/:id/image', authenticateToken, getPrescriptionImage);

// GET /:id/images — list all image versions and lineage for this prescription
router.get('/:id/images', authenticateToken, getPrescriptionImages);

// POST /:id/images — upload an enhanced or replacement image version
router.post(
  '/:id/images',
  authenticateToken,
  uploadPrescriptionImage,
  replaceOrEnhancePrescriptionImage
);

// PUT /:id/active-image — switch active image version without deleting history
router.put('/:id/active-image', authenticateToken, setActivePrescriptionImage);

// POST /:id/ocr-retry — rerun OCR against selected image version
router.post('/:id/ocr-retry', authenticateToken, retryPrescriptionOcr);

// GET / — list patient's own prescriptions
router.get('/', authenticateToken, getUserPrescriptions);

// GET /:id — get single prescription details
router.get('/:id', authenticateToken, getPrescriptionById);

// POST /:id/screen-integrity — trigger/re-run document integrity screening
router.post('/:id/screen-integrity', authenticateToken, screenPrescriptionIntegrity);

// GET /:id/screen-integrity — retrieve document integrity screening details
router.get('/:id/screen-integrity', authenticateToken, screenPrescriptionIntegrity);

// ─── Gate 2B: Patient OCR Review & Candidate Correction ─────────────────────────
// Patient can correct readable text or report field unreadable (raw OCR candidate stays immutable)
router.post('/:id/candidates/:candidateId/correct', authenticateToken, submitPatientCandidateCorrection);
router.post('/:id/candidates/:candidateId/report-unreadable', authenticateToken, reportCandidateUnreadable);
router.post('/:id/candidates/:candidateId/unreadable', authenticateToken, reportCandidateUnreadable);
router.put('/:id/patient-corrections', authenticateToken, submitPatientCorrections);

// ─── Gate 2B: Pharmacist Clinical Review, Verification & Rejection ──────────────
// Licensed Pharmacist (or Admin) performs clinical verification/rejection on evidence
router.put('/:id/items/:itemId/pharmacist-verify', authenticateToken, pharmacistVerifyItem);
router.put('/:id/candidates/:candidateId/pharmacist-verify', authenticateToken, pharmacistVerifyItem);
router.put('/:id/items/:itemId/reject', authenticateToken, pharmacistRejectItem);
router.put('/:id/candidates/:candidateId/reject', authenticateToken, pharmacistRejectItem);
router.put('/:id/pharmacist-verify', authenticateToken, pharmacistVerifyPrescription);
router.post('/:id/items/:itemId/clarification', authenticateToken, pharmacistRequestItemClarification);
router.post('/:id/candidates/:candidateId/clarification', authenticateToken, pharmacistRequestItemClarification);

// ─── Gate 3: Universal Medicine Availability Matching ─────────────────────────
// Match pharmacist-verified prescription items against participating pharmacies' live inventory
router.get('/:id/match-availability', authenticateToken, matchPrescriptionAvailability);
router.post('/:id/match-availability', authenticateToken, matchPrescriptionAvailability);

// ─── Gate 5: Patient Prescription Follow-Up ───────────────────────────────────
router.post('/:id/follow-up', authenticateToken, submitPrescriptionFollowUp);

module.exports = router;

