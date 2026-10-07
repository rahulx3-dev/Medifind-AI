const express = require('express');
const router = express.Router();
const {
  getNetworkConfig,
  getPharmacies,
  getPharmacyById,
  getPharmacyInventory,
  matchPharmacyAvailability,
  getEmergencyPharmacies,
  getMyManagedPharmacy,
  updateInventory,
  toggleStatus,
  createRestockRequest,
  getMyRestockRequests,
  cancelRestockRequest,
  getFallbackDirectory
} = require('../controllers/pharmacyController');
const { authenticateToken, requireRole } = require('../middlewares/auth');

router.get('/config', getNetworkConfig);                                                                          // Public: region config, hotlines
router.get('/search', getPharmacies);                                                                             // Public: search alias for pharmacy list
router.get('/', getPharmacies);                                                                                   // Public: pharmacy list with distance
router.get('/emergency', getEmergencyPharmacies);                                                                 // Public: emergency pharmacy locator
router.get('/fallback-directory', authenticateToken, getFallbackDirectory);                                      // Auth: offline fallback participating directory
router.get('/my-pharmacy', authenticateToken, requireRole('PHARMACIST'), getMyManagedPharmacy);                  // Pharmacist: managed pharmacy
router.post('/match-availability', matchPharmacyAvailability);                                                    // Public: ranked availability match

// Restock / Availability notification endpoints
router.post('/restock-requests', authenticateToken, createRestockRequest);                                       // Auth: request restock notification
router.get('/restock-requests/my', authenticateToken, getMyRestockRequests);                                      // Auth: get user's restock requests
router.delete('/restock-requests/:id', authenticateToken, cancelRestockRequest);                                  // Auth: cancel restock request

router.get('/:pharmacyId/inventory', getPharmacyInventory);                                                      // Public: pharmacy inventory detail
router.get('/:id', getPharmacyById);                                                                              // Public: pharmacy detail + inventory
router.put('/:pharmacyId/inventory', authenticateToken, requireRole('PHARMACIST', 'ADMIN'), updateInventory);    // Auth: update inventory
router.put('/:pharmacyId/status', authenticateToken, requireRole('PHARMACIST', 'ADMIN'), toggleStatus);          // Auth: toggle open/close

module.exports = router;
