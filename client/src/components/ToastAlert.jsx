import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, CheckCircle, Info, Bell, Loader2, RefreshCw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/ai-error-handler-utils/alert';
import { Button } from '@/components/ui/ai-error-handler-utils/button';

/**
 * Global helper to trigger in-app toast alerts from anywhere
 */
export function triggerToast(options, variantOrDuration = 'success') {
  let title = '';
  let message = '';
  let variant = 'success';
  let duration = 4500;
  let onRetry = null;
  let action = null;

  if (typeof options === 'string') {
    title = options;
    message = options;
    if (typeof variantOrDuration === 'string') {
      variant = variantOrDuration;
    } else if (typeof variantOrDuration === 'number') {
      duration = variantOrDuration;
    }
  } else if (options && typeof options === 'object') {
    title = options.title || options.message || '';
    message = options.message || options.title || '';
    variant = options.variant || 'success';
    duration = options.duration !== undefined ? options.duration : 4500;
    onRetry = options.onRetry || null;
    action = options.action || null;
  }

  const event = new CustomEvent('medifind_show_toast', {
    detail: {
      id: `toast-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      title,
      message,
      variant,
      duration,
      onRetry,
      action
    }
  });
  window.dispatchEvent(event);
}

/**
 * ToastAlert — Responsive in-app notification & alert toast
 * - Web (desktop/tablet): Positioned in bottom-right corner
 * - Mobile: Positioned at the top like native device push notifications
 * - Dismissable by clicking 'X' or sliding/swiping horizontally
 * - Automatically auto-dismisses after a few seconds
 */
export default function ToastAlert() {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    const handleToastEvent = (e) => {
      if (!e.detail) return;
      const newToast = e.detail;
      setToasts(prev => [newToast, ...prev.slice(0, 2)]); // Keep up to 3 toasts active

      if (newToast.duration > 0) {
        setTimeout(() => {
          removeToast(newToast.id);
        }, newToast.duration);
      }
    };

    window.addEventListener('medifind_show_toast', handleToastEvent);
    return () => window.removeEventListener('medifind_show_toast', handleToastEvent);
  }, [removeToast]);

  return (
    <div
      className={cn(
        "pointer-events-none fixed z-[9999] flex flex-col gap-2.5",
        // Mobile layout: top-centered like OS push notifications
        "top-3 inset-x-3 sm:inset-x-auto",
        // Desktop layout: floating bottom-right corner
        "sm:top-auto sm:bottom-6 sm:right-6 sm:w-full sm:max-w-md"
      )}
    >
      <AnimatePresence mode="sync">
        {toasts.map((toast) => (
          <SingleToastItem
            key={toast.id}
            toast={toast}
            onDismiss={() => removeToast(toast.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

function SingleToastItem({ toast, onDismiss }) {
  const [isRetrying, setIsRetrying] = useState(false);
  const dragThreshold = 75;

  const handleRetry = async () => {
    if (!toast.onRetry) return;
    setIsRetrying(true);
    try {
      await toast.onRetry();
    } finally {
      setIsRetrying(false);
    }
  };

  const renderIcon = () => {
    switch (toast.variant) {
      case 'destructive':
      case 'error':
        return <AlertTriangle aria-hidden="true" className="size-4 shrink-0 text-[#ba1a1a]" />;
      case 'warning':
        return <AlertTriangle aria-hidden="true" className="size-4 shrink-0 text-[#d97706]" />;
      case 'info':
        return <Info aria-hidden="true" className="size-4 shrink-0 text-[#0284c7]" />;
      case 'success':
      default:
        return <CheckCircle aria-hidden="true" className="size-4 shrink-0 text-[#006a5c]" />;
    }
  };

  const getAlertVariant = () => {
    if (toast.variant === 'error') return 'destructive';
    if (['destructive', 'warning', 'info', 'success'].includes(toast.variant)) {
      return toast.variant;
    }
    return 'default';
  };

  return (
    <motion.div
      layout
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0.6, right: 0.6 }}
      onDragEnd={(e, info) => {
        if (Math.abs(info.offset.x) > dragThreshold || Math.abs(info.velocity.x) > 300) {
          onDismiss();
        }
      }}
      initial={{ opacity: 0, y: -16, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, x: 180, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', damping: 25, stiffness: 350 }}
      className="pointer-events-auto w-full select-none cursor-grab active:cursor-grabbing"
    >
      <Alert
        className={cn(
          "w-full shadow-[0_12px_32px_-4px_rgba(0,0,0,0.18)] backdrop-blur-md border",
          "hover:shadow-[0_16px_36px_-4px_rgba(0,0,0,0.22)] transition-shadow duration-200"
        )}
        live="assertive"
        variant={getAlertVariant()}
      >
        {renderIcon()}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {toast.title && (
                <AlertTitle className="wrap-break-word font-bold text-sm leading-tight text-primary">
                  {toast.title}
                </AlertTitle>
              )}
              {toast.message && (
                <AlertDescription className="wrap-break-word text-xs text-on-surface-variant font-medium">
                  {toast.message}
                </AlertDescription>
              )}
            </div>

            <Button
              aria-label="Dismiss notification"
              className="min-h-[28px] min-w-[28px] h-7 w-7 shrink-0 touch-manipulation hover:bg-black/5 rounded-lg -mr-1 -mt-1"
              onClick={onDismiss}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X aria-hidden="true" className="size-3.5" />
            </Button>
          </div>

          {toast.action && <div className="mt-1">{toast.action}</div>}

          {toast.onRetry && (
            <Button
              aria-busy={isRetrying}
              className="ml-auto min-h-[30px] h-7.5 w-fit touch-manipulation gap-1.5 px-3 text-xs"
              data-loading={isRetrying}
              disabled={isRetrying}
              onClick={handleRetry}
              type="button"
              variant="secondary"
            >
              {isRetrying ? (
                <>
                  <Loader2 aria-hidden="true" className="size-3 animate-spin" />
                  <span>Retrying…</span>
                </>
              ) : (
                <>
                  <RefreshCw aria-hidden="true" className="size-3" />
                  <span>Retry</span>
                </>
              )}
            </Button>
          )}
        </div>
      </Alert>
    </motion.div>
  );
}
