const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middlewares/auth');
const {
  getCheckoutSummary,
  selectFulfillment,
  createPayment,
  verifyPayment,
  getPaymentStatus,
  retryPayment
} = require('../controllers/checkoutController');

// All checkout routes require authentication
// Ownership validation is enforced inside each controller function

// GET /api/checkout/:orderId — checkout summary
router.get('/:orderId', authenticateToken, requireRole('PATIENT'), getCheckoutSummary);

// POST /api/checkout/:orderId/fulfillment — select fulfillment type + address
router.post('/:orderId/fulfillment', authenticateToken, requireRole('PATIENT'), selectFulfillment);

// POST /api/checkout/:orderId/create-payment — create Razorpay order (PATIENT only)
router.post('/:orderId/create-payment', authenticateToken, requireRole('PATIENT'), createPayment);

// POST /api/checkout/:orderId/verify-payment — verify Razorpay signature server-side
router.post('/:orderId/verify-payment', authenticateToken, requireRole('PATIENT'), verifyPayment);

// GET /api/checkout/:orderId/payment-status — safe payment status
router.get('/:orderId/payment-status', authenticateToken, requireRole('PATIENT'), getPaymentStatus);

// POST /api/checkout/:orderId/retry-payment — retry a failed payment
router.post('/:orderId/retry-payment', authenticateToken, requireRole('PATIENT'), retryPayment);

module.exports = router;
