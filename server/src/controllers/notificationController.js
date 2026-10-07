const prisma = require('../prisma');

// Get user notifications
async function getNotifications(req, res) {
  try {
    const userId = req.user.id;

    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    const unreadCount = await prisma.notification.count({
      where: { userId, isRead: false }
    });

    return res.json({
      success: true,
      unreadCount,
      notifications
    });
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

module.exports = {
  getNotifications,
  markNotificationAsRead,
  markAllAsRead,
  clearAllNotifications
};
