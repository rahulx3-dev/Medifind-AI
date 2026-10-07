const express = require('express');
const router = express.Router();
const {
  createOrder,
  updateOrderStatus,
  verifyOrderPin,
  getOrderById,
  getOrders,
  confirmReceipt
} = require('../controllers/orderController');
const { authenticateToken } = require('../middlewares/auth');

router.post('/', authenticateToken, createOrder);
router.get('/', authenticateToken, getOrders);
router.get('/:id', authenticateToken, getOrderById);
router.put('/:id/status', authenticateToken, updateOrderStatus);
router.post('/:id/verify-pin', authenticateToken, verifyOrderPin);
router.post('/:id/confirm-receipt', authenticateToken, confirmReceipt);

module.exports = router;
