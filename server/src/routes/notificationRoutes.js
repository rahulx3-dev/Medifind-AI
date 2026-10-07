const express = require('express');
const router = express.Router();
const {
  getNotifications,
  markNotificationAsRead,
  markAllAsRead,
  clearAllNotifications
} = require('../controllers/notificationController');
const { authenticateToken } = require('../middlewares/auth');

router.get('/', authenticateToken, getNotifications);
router.put('/:id/read', authenticateToken, markNotificationAsRead);
router.put('/mark-all-read', authenticateToken, markAllAsRead);
router.delete('/clear-all', authenticateToken, clearAllNotifications);


module.exports = router;
