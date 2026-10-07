import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { SkeletonRow } from './LoadingSkeleton';

/**
 * NotificationModal — Adapted from 21st.dev Item/Notification component (Item19 reference)
 * Structure:
 * - ItemMedia (icon)
 * - ItemContent (title, description)
 * - ItemFooter (timestamp)
 * - ItemSeparator
 * With Apple-like spring entrance transitions and MediFind clinical theme.
 */
export default function NotificationModal({
  isOpen,
  onClose,
  notifications = [],
  isLoading = false,
  onMarkAllRead,
  onClearAll,
  onNotificationClick
}) {
  const [filter, setFilter] = useState('all');

  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filteredNotifications = notifications.filter(n => {
    if (filter === 'all') return true;
    if (filter === 'emergency') return n.type === 'EMERGENCY' || n.title?.toLowerCase().includes('emergency');
    if (filter === 'fulfillment') return n.type === 'ORDER' || n.title?.toLowerCase().includes('order') || n.title?.toLowerCase().includes('reservation');
    if (filter === 'system') return !['EMERGENCY', 'ORDER'].includes(n.type);
    return true;
  });

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center p-4 bg-on-surface/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Notification Center"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-xl bg-surface-container-lowest rounded-3xl p-6 sm:p-7 shadow-[0_20px_40px_-8px_rgba(22,54,48,0.22)] border border-outline-variant/30 flex flex-col gap-4 max-h-[85vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-surface-container gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center shrink-0 shadow-xs">
              <span className="material-symbols-outlined text-xl">notifications</span>
            </div>
            <div className="flex flex-col">
              <h3 className="text-xl font-bold text-primary tracking-tight">Notification Center</h3>
              <span className="text-xs text-on-surface-variant">
                Live dispatch updates, order milestones &amp; safety triage alerts
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {notifications.length > 0 && onMarkAllRead && (
              <button
                onClick={onMarkAllRead}
                className="px-3 py-1.5 rounded-full bg-surface-container hover:bg-surface-container-high text-primary text-xs font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                title="Mark all as read"
              >
                <span className="material-symbols-outlined text-base">done_all</span>
                <span className="hidden sm:inline">Mark Read</span>
              </button>
            )}
            {notifications.length > 0 && onClearAll && (
              <button
                onClick={onClearAll}
                className="px-3 py-1.5 rounded-full bg-[#ffdad6] hover:bg-[#ffb4ab] text-[#ba1a1a] text-xs font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                title="Clear all notifications"
              >
                <span className="material-symbols-outlined text-base">delete_sweep</span>
                <span className="hidden sm:inline">Clear All</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full hover:bg-surface-container text-on-surface-variant flex items-center justify-center transition-colors cursor-pointer"
              aria-label="Close"
            >
              <span className="material-symbols-outlined text-xl">close</span>
            </button>
          </div>
        </div>

        {/* Filter Pill Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          <button
            onClick={() => setFilter('all')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
              filter === 'all'
                ? 'bg-primary text-white shadow-sm'
                : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            All ({notifications.length})
          </button>
          <button
            onClick={() => setFilter('fulfillment')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              filter === 'fulfillment'
                ? 'bg-primary text-white shadow-sm'
                : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
            <span>Fulfillment</span>
          </button>
          <button
            onClick={() => setFilter('emergency')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
              filter === 'emergency'
                ? 'bg-tertiary-container text-white shadow-sm'
                : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-error" />
            <span>Emergency</span>
          </button>
        </div>

        {/* Notification Feed List with Item Structure & Separators */}
        <div className="flex flex-col overflow-y-auto pr-1 max-h-[50vh] divide-y divide-surface-container/60">
          {isLoading ? (
            <div className="py-4 space-y-3">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center gap-2">
              <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant">
                <span className="material-symbols-outlined text-2xl">notifications_off</span>
              </div>
              <p className="text-sm font-bold text-primary">No notifications in this filter</p>
              <p className="text-xs text-on-surface-variant max-w-xs">
                Real-time notifications will arrive when your orders progress or clinical alerts occur.
              </p>
            </div>
          ) : (
            filteredNotifications.map((n, index) => {
              const isEmergency = n.type === 'EMERGENCY' || n.title?.toLowerCase().includes('emergency');
              const timeStr = n.createdAt
                ? new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : 'Just now';

              return (
                <motion.div
                  key={n.id || index}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, delay: index * 0.04 }}
                  onClick={() => {
                    if (onNotificationClick) onNotificationClick(n);
                    onClose();
                  }}
                  className={`py-3.5 px-3 rounded-2xl transition-all cursor-pointer flex items-start gap-3 text-left hover:bg-surface-container-low ${
                    !n.isRead ? 'bg-[#f4fbf8]' : 'opacity-85'
                  }`}
                >
                  {/* ItemMedia: Category Icon */}
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 shadow-xs ${
                      isEmergency
                        ? 'bg-[#ffdad6] text-[#ba1a1a]'
                        : n.type === 'ORDER'
                        ? 'bg-[#b0ecdd] text-[#032f28]'
                        : 'bg-surface-container text-on-surface-variant'
                    }`}
                  >
                    <span className="material-symbols-outlined text-lg">
                      {isEmergency ? 'e911_emergency' : n.type === 'ORDER' ? 'local_shipping' : 'notifications'}
                    </span>
                  </div>

                  {/* ItemContent: Title and Description */}
                  <div className="flex-1 flex flex-col gap-0.5 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-primary truncate">
                        {n.title || 'System Notification'}
                      </span>
                      {/* ItemFooter: Timestamp */}
                      <span className="text-[10px] text-on-surface-variant shrink-0 font-medium">
                        {timeStr}
                      </span>
                    </div>

                    <p className="text-xs text-on-surface-variant leading-relaxed line-clamp-2">
                      {n.message || n.description || 'Details available in your patient timeline.'}
                    </p>

                    {n.orderId && (
                      <span className="text-[10px] font-mono font-semibold text-secondary mt-1">
                        Order #{n.orderId.slice(0, 8).toUpperCase()}
                      </span>
                    )}
                  </div>

                  {!n.isRead && (
                    <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-2" />
                  )}
                </motion.div>
              );
            })
          )}
        </div>
      </motion.div>
    </div>
  );
}
