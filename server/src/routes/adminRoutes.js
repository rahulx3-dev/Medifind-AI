const express = require('express');
const router = express.Router();
const {
  getAdminUsers,
  getAdminPharmacies,
  getAdminOrders,
  getAdminEmergencyRequests,
  getAdminActivity
} = require('../controllers/adminController');
const { authenticateToken, requireRole } = require('../middlewares/auth');

// All admin routes are strictly guarded: 401 unauthenticated, 403 non-admin
router.use(authenticateToken);
router.use(requireRole('ADMIN'));

router.get('/users', getAdminUsers);
router.get('/pharmacies', getAdminPharmacies);
router.get('/orders', getAdminOrders);
router.get('/emergency-requests', getAdminEmergencyRequests);
router.get('/activity', getAdminActivity);

module.exports = router;
