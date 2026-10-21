import { useEffect, useRef } from 'react';

const EVENT_NAME = 'medifind:update';
const STORAGE_KEY = 'medifind_realtime_event';
const CHANNEL_NAME = 'medifind_broadcast_channel';

let sharedBroadcastChannel = null;
try {
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    sharedBroadcastChannel = new BroadcastChannel(CHANNEL_NAME);
  }
} catch (e) {
  // BroadcastChannel not supported or blocked
}

/**
 * Broadcast an update event across all components in the current tab
 * and across other open browser tabs/windows.
 *
 * @param {string} type - Event type (e.g. 'ORDER_CREATED', 'ORDER_UPDATED', 'PAYMENT_UPDATED', 'INVENTORY_UPDATED')
 * @param {Object} [payload] - Optional details (orderId, status, etc.)
 */
export function broadcastUpdate(type, payload = {}) {
  if (typeof window === 'undefined') return;

  const eventData = {
    type,
    payload,
    timestamp: Date.now()
  };

  try {
    // 1. Same-tab broadcast via CustomEvent
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: eventData }));

    // 2. Cross-tab broadcast via BroadcastChannel
    if (sharedBroadcastChannel) {
      sharedBroadcastChannel.postMessage(eventData);
    }

    // 3. Cross-tab broadcast via localStorage fallback
    localStorage.setItem(STORAGE_KEY, JSON.stringify(eventData));
  } catch (err) {
    console.warn('[RealtimeUpdates] Failed to broadcast update event:', err);
  }
}

/**
 * Subscribe to realtime updates from this tab or other tabs.
 *
 * @param {Function} callback - Function called with { type, payload, timestamp }
 * @returns {Function} Unsubscribe cleanup function
 */
export function subscribeToUpdates(callback) {
  if (typeof window === 'undefined') return () => {};

  const handleCustomEvent = (e) => {
    if (e?.detail) {
      callback(e.detail);
    }
  };

  const handleStorageEvent = (e) => {
    if (e.key === STORAGE_KEY && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue);
        callback(parsed);
      } catch (err) {
        // Ignore JSON parse errors
      }
    }
  };

  const handleChannelMessage = (e) => {
    if (e?.data) {
      callback(e.data);
    }
  };

  window.addEventListener(EVENT_NAME, handleCustomEvent);
  window.addEventListener('storage', handleStorageEvent);
  if (sharedBroadcastChannel) {
    sharedBroadcastChannel.addEventListener('message', handleChannelMessage);
  }

  return () => {
    window.removeEventListener(EVENT_NAME, handleCustomEvent);
    window.removeEventListener('storage', handleStorageEvent);
    if (sharedBroadcastChannel) {
      sharedBroadcastChannel.removeEventListener('message', handleChannelMessage);
    }
  };
}

/**
 * React hook that triggers automatic real-time refreshes:
 * 1. Immediately on any broadcast update event (order status, payment, inventory, notifications)
 * 2. Immediately on window focus or document visibility change (tab switch back)
 * 3. Periodically in the background every `interval` ms while tab is active/visible
 *
 * @param {Object} options
 * @param {Function} options.onRefresh - Callback to fetch data with `{ isBackground: true }`
 * @param {number} [options.interval=4000] - Polling interval in milliseconds (default 4s)
 * @param {boolean} [options.enablePolling=true] - Whether periodic polling is enabled
 * @param {Array} [options.dependencies=[]] - Additional dependencies to reset hook
 */
export function useRealtimeRefresh({
  onRefresh,
  interval = 10000,
  enablePolling = true,
  dependencies = []
}) {
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const lastRefreshTimeRef = useRef(0);
  const debounceTimerRef = useRef(null);

  useEffect(() => {
    if (!enablePolling || typeof window === 'undefined') return;

    // Trigger refresh with debouncing to prevent connection pool exhaustion
    const triggerRefresh = (source = 'event', immediate = false) => {
      if (document.hidden) return; // Do not poll when tab is backgrounded
      if (!navigator.onLine) return; // Skip if offline

      const now = Date.now();
      const elapsed = now - lastRefreshTimeRef.current;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      const execute = () => {
        lastRefreshTimeRef.current = Date.now();
        if (typeof refreshRef.current === 'function') {
          refreshRef.current({ isBackground: true, source });
        }
      };

      // For immediate broadcast events, debounce by at least 250ms to coalesce bursts
      // For background heartbeat, debounce by at least 600ms
      const delay = immediate ? Math.max(250, 400 - elapsed) : Math.max(600, interval > 0 ? 800 : 400);
      if (elapsed >= 1000 && immediate) {
        execute();
      } else {
        debounceTimerRef.current = setTimeout(execute, delay);
      }
    };

    // 1. Subscribe to instant event updates (both same-tab and cross-tab)
    // Filter out routine notification badge increments so they do not trigger full dashboard reloads
    const unsubscribe = subscribeToUpdates((event) => {
      if (event?.type === 'NEW_NOTIFICATION' || event?.type === 'NOTIFICATION_RECEIVED') {
        return;
      }
      triggerRefresh(`event:${event.type}`, true);
    });

    // 2. Refresh immediately when window gains focus or tab becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        triggerRefresh('visibility_visible', false);
      }
    };

    const handleFocus = () => {
      triggerRefresh('window_focus', false);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    // 3. Periodic background heartbeat while active (12s interval default)
    let timerId = null;
    if (interval > 0) {
      timerId = setInterval(() => {
        triggerRefresh('interval_heartbeat', false);
      }, interval);
    }

    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      if (timerId) clearInterval(timerId);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [interval, enablePolling, ...dependencies]);
}
