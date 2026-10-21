'use strict';

const express = require('express');
const router = express.Router();
const {
  submitClinicalRequest,
  getPatientClinicalRequests,
  getPharmacyClinicalQueue,
  getClinicalRequestById,
  getClinicalVoiceAudio,
  respondToClinicalRequest,
  submitClinicalFollowUp,
  checkAndEscalateTimeout
} = require('../controllers/clinicalAssistanceController');
const { authenticateToken } = require('../middlewares/auth');

// 1. Submit Human Clinical Assistance Request (Authenticated Patient)
router.post('/', authenticateToken, submitClinicalRequest);

// 2. Patient Request History (Authenticated Patient)
router.get('/my-requests', authenticateToken, getPatientClinicalRequests);

// 3. Pharmacy Clinical Review Queue (Authenticated Pharmacist / Admin)
router.get('/pharmacy-queue', authenticateToken, getPharmacyClinicalQueue);

// 4. Single Clinical Request Detail (Authenticated Patient/Clinician, strict isolation)
router.get('/:id', authenticateToken, getClinicalRequestById);

// 5. Voice audio playback stream (supports elderly assistive playback)
router.get('/:id/voice', getClinicalVoiceAudio);

// 6. Clinician / Pharmacist Response (Authenticated Healthcare Professional / Admin)
router.patch('/:id/respond', authenticateToken, respondToClinicalRequest);

// 6. Gate 9: Patient Clinical Follow-Up (Authenticated Patient)
router.post('/:id/follow-up', authenticateToken, submitClinicalFollowUp);

// 7. Timeout Evaluation & Pharmacy Escalation (Authenticated Clinician / Admin / System)
router.post('/:id/escalate', authenticateToken, checkAndEscalateTimeout);

module.exports = router;
