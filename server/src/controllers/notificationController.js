const prisma = require('../prisma');

// In-memory notifications cache (3.5s TTL)
const notifCache = new Map();
const NOTIF_CACHE_TTL_MS = 3500;

function invalidateNotifCache(userId) {
  if (userId) notifCache.delete(userId);
  else notifCache.clear();
}

// Get user notifications
async function getNotifications(req, res) {
  try {
    const userId = req.user.id;

    const cached = notifCache.get(userId);
    if (cached && (Date.now() - cached.timestamp < NOTIF_CACHE_TTL_MS)) {
      return res.json(cached.data);
    }

    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    const unreadCount = await prisma.notification.count({
      where: { userId, isRead: false }
    });

    const responsePayload = {
      success: true,
      unreadCount,
      notifications
    };
    notifCache.set(userId, { timestamp: Date.now(), data: responsePayload });

    return res.json(responsePayload);
  } catch (err) {
    console.error('getNotifications error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch notifications.' });
  }
}

// Mark single notification as read
async function markNotificationAsRead(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    await prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true }
    });

    invalidateNotifCache(userId);
    return res.json({ success: true, message: 'Notification marked as read.' });
  } catch (err) {
    console.error('markNotificationAsRead error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update notification.' });
  }
}

// Mark all as read
async function markAllAsRead(req, res) {
  try {
    const userId = req.user.id;

    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true }
    });

    invalidateNotifCache(userId);
    return res.json({ success: true, message: 'All notifications marked as read.' });
  } catch (err) {
    console.error('markAllAsRead error:', err);
    return res.status(500).json({ success: false, error: 'Failed to mark notifications read.' });
  }
}

// Clear (delete) all notifications for the user
async function clearAllNotifications(req, res) {
  try {
    const userId = req.user.id;

    await prisma.notification.deleteMany({
      where: { userId }
    });

    return res.json({ success: true, message: 'All notifications cleared.' });
  } catch (err) {
    console.error('clearAllNotifications error:', err);
    return res.status(500).json({ success: false, error: 'Failed to clear notifications.' });
  }
}

// Delete single notification
async function deleteNotification(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    await prisma.notification.deleteMany({
      where: { id, userId }
    });

    return res.json({ success: true, message: 'Notification removed.' });
  } catch (err) {
    console.error('deleteNotification error:', err);
    return res.status(500).json({ success: false, error: 'Failed to remove notification.' });
  }
}

module.exports = {
  getNotifications,
  markNotificationAsRead,
  markAllAsRead,
  clearAllNotifications,
  deleteNotification
};
