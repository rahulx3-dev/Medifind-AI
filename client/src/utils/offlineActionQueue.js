/**
 * MediFind AI — Safe Offline Action Queue & Sync Utility
 * 
 * ARCHITECTURAL CONTRACT:
 * - SAFE ACTIONS: Idempotent read-receipts, preference updates, and notifications mark-read.
 *   These are queued in localStorage when offline and synced automatically upon reconnection.
 * - UNSAFE TRANSACTIONAL ACTIONS: Medical reservations (POST /api/orders), prescription
 *   verification (POST /api/prescriptions/verify), emergency requests, and PIN handovers
 *   MUST NOT be queued offline. Medicine inventory is live, volatile, and safety-critical;
 *   blindly queuing orders offline leads to stale stock allocations and critical patient risk.
 *   These actions require live network connectivity and fail fast with clear UI guidance.
 */

const QUEUE_STORAGE_KEY = 'medifind_safe_offline_queue';
const PROCESSED_KEYS_KEY = 'medifind_processed_idempotency_keys';

// Whitelist of safe, idempotent actions permitted in offline queue
const SAFE_ACTION_TYPES = [
  'MARK_ALL_NOTIFICATIONS_READ',
  'CLEAR_ALL_NOTIFICATIONS',
  'MARK_NOTIFICATION_READ',
  'SYNC_PREFERENCE'
];

// Explicit blacklist of dangerous transactional actions that must NEVER be queued
const UNSAFE_ACTION_PATTERNS = [
  '/orders',
  '/emergency',
  '/verify',
  '/prescriptions/upload',
  '/handover',
  '/progress',
  '/checkout',
  '/payment',
  '/refund'
];

/**
 * Validate whether an action is safe to queue offline.
 */
function isActionSafeToQueue(type, endpoint) {
  if (!SAFE_ACTION_TYPES.includes(type)) return false;
  const isUnsafePattern = UNSAFE_ACTION_PATTERNS.some(pat => endpoint.toLowerCase().includes(pat));
  return !isUnsafePattern;
}

/**
 * Get current pending queue from localStorage.
 */
export function getOfflineQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Failed to parse offline queue:', e);
    return [];
  }
}

/**
 * Enqueue a safe non-transactional action.
 * Throws an Error if a transactional or unsafe action is attempted.
 */
export function enqueueSafeAction({ type, endpoint, method = 'PUT', payload = null }) {
  if (!isActionSafeToQueue(type, endpoint)) {
    throw new Error(
      `[SafeActionQueue] Unsafe action "${type}" targeting "${endpoint}" cannot be queued offline. Live connectivity is mandatory for transactional medical workflows.`
    );
  }

  const queue = getOfflineQueue();
  const idempotencyKey = `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const queuedItem = {
    id: idempotencyKey,
    type,
    endpoint,
    method,
    payload,
    enqueuedAt: new Date().toISOString()
  };

  // Idempotency: Prevent duplicate pending items of the same type/endpoint
  const filtered = queue.filter(item => !(item.type === type && item.endpoint === endpoint));
  filtered.push(queuedItem);

  localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(filtered));
  console.log(`[SafeActionQueue] Enqueued safe action: ${type} (${idempotencyKey})`);
  return queuedItem;
}

/**
 * Process and flush the offline queue upon network reconnection.
 */
export async function processOfflineQueue() {
  if (!navigator.onLine) {
    console.log('[SafeActionQueue] Offline: Sync postponed.');
    return { success: false, reason: 'OFFLINE', processedCount: 0 };
  }

  const queue = getOfflineQueue();
  if (queue.length === 0) {
    return { success: true, processedCount: 0 };
  }

  const token = localStorage.getItem('medifind_token');
  const remaining = [];
  let processedCount = 0;

  for (const action of queue) {
    try {
      const headers = {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': action.id
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(action.endpoint, {
        method: action.method,
        headers,
        body: action.payload ? JSON.stringify(action.payload) : undefined
      });

      if (res.ok) {
        processedCount++;
        console.log(`[SafeActionQueue] Successfully synced queued action: ${action.type}`);
      } else if (res.status === 401) {
        // Token expired; keep in queue for next authenticated session
        remaining.push(action);
      } else {
        console.warn(`[SafeActionQueue] Server rejected queued action ${action.type} (HTTP ${res.status}). Discarding.`);
      }
    } catch (err) {
      console.warn(`[SafeActionQueue] Network failed while syncing ${action.type}. Retrying later.`, err);
      remaining.push(action);
    }
  }

  localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(remaining));
  return { success: true, processedCount, remainingCount: remaining.length };
}

/**
 * Clear the offline queue.
 */
export function clearOfflineQueue() {
  localStorage.removeItem(QUEUE_STORAGE_KEY);
}
