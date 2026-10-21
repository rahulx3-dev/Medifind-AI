import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, CheckCircle, Package, Bell, X, Copy, Check, Trash2 } from 'lucide-react';
import { SkeletonRow } from './LoadingSkeleton';
import { Alert, AlertTitle, AlertDescription } from './ui/ai-error-handler-utils/alert';
import { Button } from './ui/ai-error-handler-utils/button';

/**
 * Extract 4-digit PIN/OTP from notification payload or text
 */
function extractPin(text) {
  if (!text) return null;
  const match = text.match(/(?:verification\s+pin|pickup\s+pin|handover\s+pin|security\s+pin|\bpin\b|\botp\b|\bcode\b)[^\w\d]{0,5}["']?([0-9]{4})["']?/i);
  return match ? match[1] : null;
}

/**
 * Clean message to remove raw PIN substring when rendered in hierarchical OTP card
 */
function getDisplayMessage(rawMsg) {
  if (!rawMsg) return 'Details available in your patient timeline.';
  const cleaned = rawMsg
    .replace(/(?:verification|pickup|handover|security)?\s*pin[:\s]*["']?[0-9]{4}["']?\.?/gi, '')
    .trim();
  return cleaned.length > 0 ? cleaned : rawMsg;
}

/**
 * NotificationModal — Clinical Notification Center
 * Adopts AIErrorHandler Alert card visual hierarchy:
 * - Status Icon (Emergency / Fulfillment / System)
 * - AlertTitle & AlertDescription
 * - Inline SMS-style OTP card with one-click copy
 * - Slide-to-dismiss + 'X' close button
 */
export default function NotificationModal({
  isOpen,
  onClose,
  notifications = [],
  isLoading = false,
  onMarkAllRead,
  onClearAll,
  onRemoveNotification,
  onNotificationClick
}) {
  const [filter, setFilter] = useState('all');
  const [copiedPinId, setCopiedPinId] = useState(null);
  const [dismissedIds, setDismissedIds] = useState(new Set());

  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCopyPin = (e, pin, notifId) => {
    e.stopPropagation();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(pin);
    }
    setCopiedPinId(notifId);
    setTimeout(() => setCopiedPinId(null), 2000);
  };

  const handleRemove = (notifId) => {
    setDismissedIds(prev => new Set([...prev, notifId]));
    if (onRemoveNotification) {
      onRemoveNotification(notifId);
    }
  };

  const filteredNotifications = notifications.filter(n => {
    if (dismissedIds.has(n.id)) return false;
    if (filter === 'all') return true;
    if (filter === 'emergency') return n.type === 'EMERGENCY' || n.title?.toLowerCase().includes('emergency');
    if (filter === 'fulfillment') {
      return (
        n.type === 'ORDER' ||
        n.type === 'ORDER_STATUS' ||
        n.type === 'ASSISTANT' ||
        n.title?.toLowerCase().includes('order') ||
        n.title?.toLowerCase().includes('reservation') ||
        n.title?.toLowerCase().includes('medicine') ||
        n.title?.toLowerCase().includes('pickup')
      );
    }
    if (filter === 'system') return !['EMERGENCY', 'ORDER', 'ORDER_STATUS', 'ASSISTANT'].includes(n.type);
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

        {/* Filter Pill Chips & Slide-to-Remove instruction */}
        <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 no-scrollbar">
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setFilter('all')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
                filter === 'all'
                  ? 'bg-primary text-white shadow-sm'
                  : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              All ({filteredNotifications.length})
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
                  ? 'bg-[#ba1a1a] text-white shadow-sm'
                  : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-error" />
              <span>Emergency</span>
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-1 text-[11px] text-[#2e685d] font-semibold bg-[#ebf8f4] px-2.5 py-1 rounded-full border border-[#2e685d]/20 shrink-0">
            <span className="material-symbols-outlined text-xs">swipe_left</span>
            <span>Slide or click &times; to remove</span>
          </div>
        </div>

        {/* Notification Feed List — Uses AIErrorHandler Alert Card Design */}
        <div className="flex flex-col overflow-y-auto pr-1 max-h-[52vh] gap-3">
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
            <AnimatePresence>
              {filteredNotifications.map((n, index) => {
                const isEmergency = n.type === 'EMERGENCY' || n.title?.toLowerCase().includes('emergency');
                const isFulfillment = n.type === 'ORDER' || n.type === 'ORDER_STATUS' || n.type === 'ASSISTANT';
                const timeStr = n.createdAt
                  ? new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : 'Just now';

                const fullText = `${n.title || ''} ${n.message || ''} ${n.description || ''}`;
                const extractedPin = (n.pin && /^[0-9]{4}$/.test(String(n.pin).trim()))
                  ? String(n.pin).trim()
                  : (n.verificationPin && /^[0-9]{4}$/.test(String(n.verificationPin).trim()))
                  ? String(n.verificationPin).trim()
                  : extractPin(fullText);

                const digits = extractedPin ? extractedPin.split('') : null;
                const notifId = n.id || `notif-${index}`;
                const rawMessage = n.message || n.description || '';
                const displayMessage = extractedPin ? getDisplayMessage(rawMessage) : (rawMessage || 'Details available in your patient timeline.');

                return (
                  <NotificationCardItem
                    key={notifId}
                    notifId={notifId}
                    notification={n}
                    isEmergency={isEmergency}
                    isFulfillment={isFulfillment}
                    timeStr={timeStr}
                    digits={digits}
                    extractedPin={extractedPin}
                    displayMessage={displayMessage}
                    copiedPinId={copiedPinId}
                    onCopyPin={handleCopyPin}
                    onRemove={() => handleRemove(notifId)}
                    onClick={() => {
                      if (onNotificationClick) onNotificationClick(n);
                      onClose();
                    }}
                  />
                );
              })}
            </AnimatePresence>
          )}
        </div>
      </motion.div>
    </div>
  );
}

/**
 * NotificationCardItem
 * Renders each notification using the AIErrorHandler alert card structure:
 * - Semantic icon on the left
 * - AlertTitle & AlertDescription with clear visual hierarchy
 * - Inline OTP verification PIN block
 * - X close button + horizontal slide drag to remove
 * - Guaranteed solid height (no 2px collapsed bars)
 */
function NotificationCardItem({
  notifId,
  notification: n,
  isEmergency,
  isFulfillment,
  timeStr,
  digits,
  extractedPin,
  displayMessage,
  copiedPinId,
  onCopyPin,
  onRemove,
  onClick
}) {
  const [isRemoving, setIsRemoving] = useState(false);
  const dragThreshold = 80;

  const handleDismiss = (e) => {
    if (e) e.stopPropagation();
    setIsRemoving(true);
    setTimeout(() => {
      onRemove();
    }, 160);
  };

  const alertVariant = isEmergency ? 'destructive' : isFulfillment ? 'success' : 'default';

  const renderIcon = () => {
    if (isEmergency) {
      return <AlertTriangle aria-hidden="true" className="size-4.5 text-[#ba1a1a] shrink-0" />;
    }
    if (isFulfillment) {
      return <Package aria-hidden="true" className="size-4.5 text-[#006a5c] shrink-0" />;
    }
    return <Bell aria-hidden="true" className="size-4.5 text-[#2e685d] shrink-0" />;
  };

  return (
    <motion.div
      layout
      drag="x"
      dragConstraints={{ left: -120, right: 0 }}
      dragElastic={{ left: 0.35, right: 0.05 }}
      onDragEnd={(e, info) => {
        if (info.offset.x < -dragThreshold || info.velocity.x < -250) {
          handleDismiss();
        }
      }}
      initial={{ opacity: 0, y: 6 }}
      animate={isRemoving ? { x: -280, opacity: 0 } : { x: 0, opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -280, transition: { duration: 0.18 } }}
      className="w-full relative select-none cursor-grab active:cursor-grabbing min-h-[72px]"
      onClick={onClick}
    >
      <Alert
        variant={alertVariant}
        className={`w-full p-3.5 sm:p-4 rounded-2xl border transition-all duration-150 ${
          !n.isRead
            ? 'ring-1 ring-[#006a5c]/20 shadow-xs'
            : 'opacity-90'
        } ${isEmergency ? 'border-[#ffdad6] bg-[#fff8f7]' : isFulfillment ? 'border-[#a6cfc5]/60 bg-[#f0faf6]' : 'border-outline-variant/40 bg-surface-container-lowest'}`}
      >
        {renderIcon()}

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {/* Header: Title, Timestamp, and X close */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col min-w-0 flex-1">
              <AlertTitle className="font-bold text-sm text-primary leading-tight truncate">
                {n.title || (isEmergency ? 'Emergency Clinical Triage' : 'MediFind Update')}
              </AlertTitle>
              <span className="text-[10px] text-on-surface-variant font-medium mt-0.5">
                {timeStr}
              </span>
            </div>

            {/* X Close / Dismiss Button */}
            <Button
              aria-label="Dismiss notification"
              className="min-h-[30px] min-w-[30px] h-7.5 w-7.5 shrink-0 touch-manipulation hover:bg-black/5 dark:hover:bg-white/10 rounded-lg -mr-1 -mt-1 cursor-pointer"
              onClick={handleDismiss}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X aria-hidden="true" className="size-3.5 text-on-surface-variant hover:text-[#ba1a1a]" />
            </Button>
          </div>

          {/* Description */}
          <AlertDescription className="text-xs text-on-surface-variant/90 leading-relaxed font-normal">
            {displayMessage}
          </AlertDescription>

          {/* Inline SMS-Style OTP Verification Card if PIN is present */}
          {digits && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="mt-2 p-2.5 rounded-xl bg-white/90 border border-[#006a5c]/25 shadow-xs flex flex-col gap-1.5 cursor-default"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold text-primary uppercase tracking-wider flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs text-[#006a5c]">pin</span>
                  <span>Pickup Verification PIN</span>
                </span>

                <button
                  type="button"
                  onClick={(e) => onCopyPin(e, extractedPin, notifId)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-container hover:bg-surface-container-high text-primary text-[10px] font-bold transition-all cursor-pointer"
                >
                  {copiedPinId === notifId ? (
                    <>
                      <Check className="size-3 text-[#006a5c]" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="size-3 text-primary" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex items-center gap-1.5 py-0.5">
                {digits.map((digit, dIdx) => (
                  <div
                    key={dIdx}
                    className="w-8 h-9 sm:w-9 sm:h-10 flex items-center justify-center rounded-lg bg-surface-container-lowest text-primary font-mono font-bold text-lg shadow-xs border border-outline-variant/30 select-all"
                  >
                    {digit}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Alert>
    </motion.div>
  );
}
