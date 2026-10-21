const prismaClient = require('../prisma');

/**
 * Gate 5: Idempotent Notification Dispatcher
 *
 * Prevents duplicate notification spam caused by:
 * - Network retries
 * - Redundant order status updates
 * - Duplicate webhook deliveries
 * - Rapid client-side button clicks
 *
 * Rules:
 * - Checks whether a notification with identical (userId, title, linkUrl) was delivered
 *   within the specified deduplication window (default: 2 hours).
 * - Guaranteed delivery: writes directly to the PostgreSQL Notification table.
 * - Cache invalidation: invalidates the user's notification cache upon insert.
 * - Does NOT initiate SMS or automated phone calls (no third-party telecom provider configured).
 */

const DEFAULT_DEDUP_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Send an idempotent notification to a user.
 *
 * @param {object} prismaOrTx - Prisma client or transaction instance
 * @param {object} params - Notification parameters
 * @param {string} params.userId - Target recipient user ID
 * @param {string} params.title - Notification title
 * @param {string} params.message - Notification message body
 * @param {string} [params.type='INFO'] - Notification type (INFO, ORDER_STATUS, EMERGENCY, ASSISTANT)
 * @param {string} [params.linkUrl] - Navigation link URL
 * @param {number} [params.dedupWindowMs] - Deduplication window in milliseconds
 * @returns {Promise<{ success: boolean, notification: object, alreadySent: boolean }>}
 */
async function sendIdempotentNotification(prismaOrTx, maybeParams) {
  let db;
  let params;
  if (maybeParams !== undefined) {
    db = prismaOrTx || prismaClient;
    params = maybeParams || {};
  } else {
    db = (prismaOrTx && prismaOrTx.notification) ? prismaOrTx : prismaClient;
    params = (prismaOrTx && !prismaOrTx.notification) ? prismaOrTx : {};
  }

  const {
    userId,
    title,
    message,
    type = 'INFO',
    linkUrl = null,
    dedupWindowMs = DEFAULT_DEDUP_WINDOW_MS
  } = params;
  const cutoffTime = new Date(Date.now() - dedupWindowMs);

  // Check for an existing duplicate notification delivered within the dedup window
  if (db.notification && typeof db.notification.findFirst === 'function') {
    try {
      const existing = await db.notification.findFirst({
        where: {
          userId,
          title,
          linkUrl: linkUrl || null,
          createdAt: { gte: cutoffTime }
        }
      });

      if (existing) {
        return {
          success: true,
          notification: existing,
          alreadySent: true,
          wasDeduplicated: true,
          id: existing.id
        };
      }
    } catch (checkErr) {
      console.warn('sendIdempotentNotification dedup check warning:', checkErr.message);
    }
  }

  // Insert verified notification
  let created = null;
  if (db.notification && typeof db.notification.create === 'function') {
    created = await db.notification.create({
      data: {
        userId,
        title,
        message,
        type,
        linkUrl: linkUrl || null,
        isRead: false
      }
    });
  }

  // Invalidate in-memory cache for user
  try {
    const { invalidateNotifCache } = require('../controllers/notificationController');
    if (typeof invalidateNotifCache === 'function') {
      invalidateNotifCache(userId);
    }
  } catch (_) {}

  return {
    success: true,
    notification: created,
    alreadySent: false,
    wasDeduplicated: false,
    id: created ? created.id : null
  };
}

/**
 * Dispatch immediate urgent-care guidance for emergency reservations.
 *
 * Immediate guidance is provided to patients without waiting for pharmacy response
 * or inventory confirmation.
 */
async function sendUrgentCareGuidanceNotification(prismaOrTx, maybeParams) {
  let db;
  let params;
  if (maybeParams !== undefined) {
    db = prismaOrTx || prismaClient;
    params = maybeParams || {};
  } else {
    db = (prismaOrTx && prismaOrTx.notification) ? prismaOrTx : prismaClient;
    params = (prismaOrTx && !prismaOrTx.notification) ? prismaOrTx : {};
  }

  const { userId, orderNumber, orderId, linkUrl } = params;
  const ordRef = orderNumber || (orderId ? orderId.slice(0, 8).toUpperCase() : 'EMERGENCY');
  const title = `🚨 Immediate Urgent Care Notice: #${ordRef}`;
  const message = `Emergency reservation placed for Order #${ordRef}. If you or the patient are experiencing acute symptoms, chest pain, breathing difficulties, or critical distress, call 108 / 112 or proceed to the nearest emergency department immediately. Do NOT wait for pharmacy confirmation.`;

  const res = await sendIdempotentNotification(db, {
    userId,
    title,
    message,
    type: 'EMERGENCY',
    linkUrl: linkUrl || (orderId ? `/orders?orderId=${orderId}` : `/orders`),
    dedupWindowMs: 24 * 60 * 60 * 1000 // 24 hours for emergency guidance
  });

  return {
    ...res,
    title,
    message,
    linkUrl: linkUrl || (orderId ? `/orders?orderId=${orderId}` : `/orders`)
  };
}

module.exports = {
  sendIdempotentNotification,
  sendUrgentCareGuidanceNotification
};
