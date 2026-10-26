const express = require('express');
const router = express.Router();
const {
  createOrder,
  updateOrderStatus,
  verifyOrderPin,
  verifyCollection,
  getOrderById,
  getOrders,
  confirmReceipt,
  submitOrderFollowUp
} = require('../controllers/orderController');
const { createSplitOrder } = require('../controllers/splitOrderController');
const {
  createClarification,
  getClarifications,
  respondToClarification,
  resolveClarification
} = require('../controllers/clarificationController');
const { authenticateToken } = require('../middlewares/auth');

// Dedicated Gate 4.2.1 split-order creation endpoint (preserves single-order POST /)
router.post('/split', authenticateToken, createSplitOrder);
router.post('/', authenticateToken, createOrder);
router.get('/', authenticateToken, getOrders);
router.get('/:id', authenticateToken, getOrderById);
router.put('/:id/status', authenticateToken, updateOrderStatus);
router.patch('/:id/status', authenticateToken, updateOrderStatus);
router.post('/:id/verify-pin', authenticateToken, verifyOrderPin);
router.post('/:id/verify-collection', authenticateToken, verifyCollection);
router.post('/:id/confirm-receipt', authenticateToken, confirmReceipt);
router.post('/:id/follow-up', authenticateToken, submitOrderFollowUp);

// ─── Prescription Clarifications (Slice 4) ──────────────────────────────────
router.post('/:id/clarifications', authenticateToken, createClarification);
router.get('/:id/clarifications', authenticateToken, getClarifications);
router.put('/:id/clarifications/:clarificationId/respond', authenticateToken, respondToClarification);
router.put('/:id/clarifications/:clarificationId/resolve', authenticateToken, resolveClarification);

module.exports = router;

