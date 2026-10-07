const express = require('express');
const router = express.Router();
const {
  searchMedicines,
  getMedicineById,
  getCategories,
  getEmergencyMedicines
} = require('../controllers/medicineController');

router.get('/', searchMedicines);
router.get('/search', searchMedicines);
router.get('/categories', getCategories);
router.get('/emergency', getEmergencyMedicines);
router.get('/:id', getMedicineById);

module.exports = router;
