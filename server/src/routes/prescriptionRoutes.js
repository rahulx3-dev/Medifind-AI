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
  screenPrescriptionIntegrity
} = require('../controllers/prescriptionController');
const { authenticateToken } = require('../middlewares/auth');

// ─── Upload Directory ──────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, '../../uploads/prescriptions');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ─── Allowed MIME Types & Extensions ─────────────────────────────────────────
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

// ─── Multer Storage ───────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Server-controlled filename — never trust original filename for path
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ALLOWED_EXTENSIONS.has(ext) ? ext : '.png';
    cb(null, 'rx-' + uniqueSuffix + safeExt);
  }
});

// ─── Multer File Filter (MIME + Extension whitelist) ─────────────────────────
const fileFilter = function (req, file, cb) {
  const mimetype = file.mimetype ? file.mimetype.toLowerCase() : '';
  const ext = path.extname(file.originalname || '').toLowerCase();

  if (ALLOWED_MIME_TYPES.has(mimetype) && ALLOWED_EXTENSIONS.has(ext)) {
    cb(null, true); // Accept
  } else {
    cb(new multer.MulterError(
      'LIMIT_UNEXPECTED_FILE',
      `Unsupported file type "${mimetype}" (${ext}). Only JPEG, PNG, and WEBP images are allowed.`
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

// ─── Routes ───────────────────────────────────────────────────────────────────

// Public: academic sample prescriptions for demo/defense
router.get('/samples', getAcademicSamples);

// POST /upload — real image upload + OCR
router.post(
  '/upload',
  authenticateToken,
  upload.single('prescriptionImage'),
  multerErrorHandler,
  uploadPrescription
);

// PUT /:id/verify — patient verification of detected medicines
router.put('/:id/verify', authenticateToken, verifyDetectedMedicines);

// GET /:id/image — serve prescription image through authenticated endpoint (NOT public static)
router.get('/:id/image', authenticateToken, getPrescriptionImage);

// GET / — list patient's own prescriptions
router.get('/', authenticateToken, getUserPrescriptions);

// GET /:id — get single prescription details
router.get('/:id', authenticateToken, getPrescriptionById);

// POST /:id/screen-integrity — trigger/re-run document integrity screening
router.post('/:id/screen-integrity', authenticateToken, screenPrescriptionIntegrity);

// GET /:id/screen-integrity — retrieve document integrity screening details
router.get('/:id/screen-integrity', authenticateToken, screenPrescriptionIntegrity);

module.exports = router;
