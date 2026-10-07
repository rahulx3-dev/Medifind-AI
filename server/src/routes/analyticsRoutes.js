const express = require('express');
const router = express.Router();
const {
  getAdminMetrics,
  getOfflineCatalogBundle
} = require('../controllers/analyticsController');
const { authenticateToken, requireRole } = require('../middlewares/auth');

router.get('/metrics', authenticateToken, requireRole('ADMIN'), getAdminMetrics);
router.get('/offline-catalog', getOfflineCatalogBundle); // Public so client can cache offline

module.exports = router;
