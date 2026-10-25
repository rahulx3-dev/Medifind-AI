const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middlewares/auth');
const {
  getCheckoutSummary,
  selectFulfillment,
  selectPayment,
  createPayment,
  verifyPayment,
  getPaymentStatus,
  retryPayment,
  handleRazorpayWebhook,
  getAssistantAvailability
} = require('../controllers/checkoutController');

// POST /api/checkout/webhook — Razorpay asynchronous webhook (verified via x-razorpay-signature)
router.post('/webhook', handleRazorpayWebhook);

// Check delivery assistant availability in service area
router.get('/assistant-availability', authenticateToken, getAssistantAvailability);
router.get('/:orderId/assistant-availability', authenticateToken, getAssistantAvailability);

// All checkout routes require authentication
// Ownership validation is enforced inside each controller function

// GET /api/checkout/:orderId — checkout summary
router.get('/:orderId', authenticateToken, requireRole('PATIENT', 'PHARMACIST', 'ADMIN'), getCheckoutSummary);

// POST /api/checkout/:orderId/fulfillment — select fulfillment type + address
router.post('/:orderId/fulfillment', authenticateToken, requireRole('PATIENT', 'PHARMACIST', 'ADMIN'), selectFulfillment);

// POST /api/checkout/:orderId/select-payment — select payment method (Pay at Counter / Online)
router.post('/:orderId/select-payment', authenticateToken, requireRole('PATIENT', 'PHARMACIST', 'ADMIN'), selectPayment);

// POST /api/checkout/:orderId/create-payment — create Razorpay order
router.post('/:orderId/create-payment', authenticateToken, requireRole('PATIENT', 'PHARMACIST', 'ADMIN'), createPayment);

// POST /api/checkout/:orderId/verify-payment — verify Razorpay signature server-side
router.post('/:orderId/verify-payment', authenticateToken, requireRole('PATIENT', 'PHARMACIST', 'ADMIN'), verifyPayment);

// GET /api/checkout/:orderId/payment-status — safe payment status
router.get('/:orderId/payment-status', authenticateToken, requireRole('PATIENT', 'PHARMACIST', 'ADMIN'), getPaymentStatus);

// POST /api/checkout/:orderId/retry-payment — retry a failed payment
router.post('/:orderId/retry-payment', authenticateToken, requireRole('PATIENT', 'PHARMACIST', 'ADMIN'), retryPayment);

module.exports = router;
