const express = require('express');
const router = express.Router();
const {
  getAdminUsers,
  getAdminPharmacies,
  createAdminPharmacy,
  updateAdminPharmacy,
  deleteAdminPharmacy,
  getAdminOrders,
  getAdminEmergencyRequests,
  getAdminActivity,
  alertRestock,
  allocateStock,
  verifyAssistant
} = require('../controllers/adminController');
const {
  getAdminVerificationQueue,
  getAdminApplicationById,
  startApplicationReview,
  requestApplicationCorrections,
  approveApplication,
  rejectApplication,
  suspendProfessional,
  restoreProfessional,
  downloadAdminDocument
} = require('../controllers/verificationController');
const { authenticateToken, requireRole } = require('../middlewares/auth');

// All admin routes are strictly guarded: 401 unauthenticated, 403 non-admin
router.use(authenticateToken);
router.use(requireRole('ADMIN'));

// Core Admin Dashboards
router.get('/users', getAdminUsers);
router.put('/assistants/:userId/verify', verifyAssistant);
router.get('/pharmacies', getAdminPharmacies);
router.post('/pharmacies', createAdminPharmacy);
router.put('/pharmacies/:id', updateAdminPharmacy);
router.delete('/pharmacies/:id', deleteAdminPharmacy);
router.get('/orders', getAdminOrders);
router.get('/emergency-requests', getAdminEmergencyRequests);
router.get('/activity', getAdminActivity);

// Critical Buffer & Inventory Dispatch
router.post('/alert-restock', alertRestock);
router.post('/allocate-stock', allocateStock);

// Phase 2 Healthcare Professional Verification Endpoints
router.get('/verifications', getAdminVerificationQueue);
router.get('/verifications/:id', getAdminApplicationById);
router.post('/verifications/:id/start-review', startApplicationReview);
router.post('/verifications/:id/request-corrections', requestApplicationCorrections);
router.post('/verifications/:id/approve', approveApplication);
router.post('/verifications/:id/reject', rejectApplication);
router.post('/verifications/:id/suspend', suspendProfessional);
router.post('/verifications/:id/restore', restoreProfessional);
router.get('/verifications/documents/:docId', downloadAdminDocument);

module.exports = router;
