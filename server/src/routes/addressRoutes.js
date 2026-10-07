const express = require('express');
const router = express.Router();
const {
  getAddresses,
  getAddressById,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress
} = require('../controllers/addressController');
const { authenticateToken, requireRole } = require('../middlewares/auth');

// All address routes are authenticated and restricted to PATIENT (or ADMIN)
router.use(authenticateToken);
router.use(requireRole('PATIENT', 'ADMIN'));

router.get('/', getAddresses);
router.post('/', createAddress);
router.get('/:id', getAddressById);
router.put('/:id', updateAddress);
router.delete('/:id', deleteAddress);
router.put('/:id/default', setDefaultAddress);

module.exports = router;
