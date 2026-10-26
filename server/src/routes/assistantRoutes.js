const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const {
  getAvailableTasks,
  getMyTasks,
  acceptTask,
  declineTask,
  progressTaskStatus,
  getAssistantProfile,
  updateAssistantProfile,
  discoverAssistants,
  selectAssistantRole,
  updateDeliveryProfile,
  submitProfessionalApplication,
  switchAssistantRole
} = require('../controllers/assistantController');
const {
  getMyApplication,
  saveOrSubmitApplication,
  uploadVerificationDocument,
  deleteVerificationDocument,
  downloadMyDocument
} = require('../controllers/verificationController');
const { authenticateToken, requireRole } = require('../middlewares/auth');
const { ALLOWED_EXTENSIONS, ALLOWED_MIME_TYPES, MAX_DOCUMENT_FILE_SIZE } = require('../utils/documentSecurity');

// Multer memory storage for verification documents (permits in-memory magic-byte inspection before writing to disk)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext) && ALLOWED_MIME_TYPES.has(mime)) {
      cb(null, true);
    } else {
      cb(new multer.MulterError(
        'LIMIT_UNEXPECTED_FILE',
        `Unsupported document format "${mime}" (${ext}). Only PDF, JPEG, and PNG files are accepted.`
      ), false);
    }
  }
});

function multerErrorHandler(err, req, res, next) {
  if (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        error: `File size exceeds the 10 MB limit. Please compress or optimize the document.`
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(415).json({
        success: false,
        error: err.message || 'Unsupported document format. Only PDF, JPEG, and PNG files are allowed.'
      });
    }
    return res.status(400).json({ success: false, error: err.message || 'File upload failed.' });
  }
  next();
}

// Public/Patient discovery of active and available assistants by service capability
router.get('/discover', authenticateToken, discoverAssistants);
router.get('/assistants', authenticateToken, discoverAssistants);

// Assistant Profile and Onboarding
router.get('/profile', authenticateToken, requireRole('ASSISTANT', 'ADMIN'), getAssistantProfile);
router.put('/profile', authenticateToken, requireRole('ASSISTANT', 'ADMIN'), updateAssistantProfile);
router.post('/role-selection', authenticateToken, requireRole('ASSISTANT', 'ADMIN'), selectAssistantRole);
router.put('/delivery-profile', authenticateToken, requireRole('ASSISTANT', 'ADMIN'), updateDeliveryProfile);
router.post('/professional-application', authenticateToken, requireRole('ASSISTANT', 'ADMIN'), submitProfessionalApplication);
router.post('/switch-role', authenticateToken, requireRole('ASSISTANT', 'ADMIN'), switchAssistantRole);

// Phase 2 Healthcare Professional Application & Document Security Endpoints
router.get('/application', authenticateToken, requireRole('ASSISTANT', 'ADMIN'), getMyApplication);
router.post('/application', authenticateToken, requireRole('ASSISTANT', 'ADMIN'), saveOrSubmitApplication);
router.post('/documents', authenticateToken, requireRole('ASSISTANT', 'ADMIN'), upload.single('document'), multerErrorHandler, uploadVerificationDocument);
router.delete('/documents/:id', authenticateToken, requireRole('ASSISTANT', 'ADMIN'), deleteVerificationDocument);
router.get('/documents/:id', authenticateToken, requireRole('ASSISTANT', 'ADMIN'), downloadMyDocument);

// Assistant Tasks
router.get('/available', authenticateToken, requireRole('ASSISTANT', 'ADMIN'), getAvailableTasks);
router.get('/my-tasks', authenticateToken, requireRole('ASSISTANT', 'ADMIN'), getMyTasks);
router.put('/tasks/:id/accept', authenticateToken, requireRole('ASSISTANT', 'ADMIN'), acceptTask);
router.put('/tasks/:id/decline', authenticateToken, requireRole('ASSISTANT', 'ADMIN'), declineTask);
router.put('/tasks/:id/cancel', authenticateToken, requireRole('ASSISTANT', 'ADMIN'), declineTask);
router.put('/tasks/:id/progress', authenticateToken, requireRole('ASSISTANT', 'ADMIN'), progressTaskStatus);

module.exports = router;
