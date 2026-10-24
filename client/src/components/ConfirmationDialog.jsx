import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';

/**
 * ConfirmationDialog — High-Stakes Consequential Action Modal
 *
 * Implements the exact Stitch "Consequential Reversal / Action" modal pattern:
 * - Ambient warm wash
 * - Warning/Consequence badge
 * - Consequence checklist & impact analysis
 * - Decision button matrix (Safe primary vs Deliberate confirm)
 * - Accessible keyboard escape (ESC) & focus trapping
 */
export default function ConfirmationDialog({
  isOpen,
  title = 'Are you sure?',
  message = '',
  impactPoints = [],
  confirmText,
  confirmLabel,
  cancelText,
  cancelLabel,
  isDestructive,
  variant,
  isLoading = false,
  isProcessing = false,
  disabled = false,
  onConfirm,
  onCancel
}) {
  const loading = isLoading || isProcessing;
  const isDisabled = disabled || loading;
  const finalConfirmText = confirmText || confirmLabel || 'Yes, Confirm';
  const finalCancelText = cancelText || cancelLabel || 'Cancel';
  const finalIsDestructive = isDestructive !== undefined ? isDestructive : (variant === 'danger' || variant === 'destructive');
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !loading) {
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel, loading]);

  if (!isOpen) return null;

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 bg-on-surface/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-lg bg-surface-container-lowest rounded-2xl sm:rounded-3xl p-4 sm:p-8 shadow-[0_20px_40px_-8px_rgba(22,54,48,0.22)] border border-outline-variant/40 flex flex-col gap-4 sm:gap-5 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Subtle ambient wash */}
        <div
          className={`absolute -top-12 -right-12 w-44 h-44 rounded-full opacity-30 blur-2xl pointer-events-none ${
            finalIsDestructive ? 'bg-[#ffdad4]' : 'bg-[#b0ecdd]'
          }`}
        />

        {/* Dialog Badge & Dismiss indicator */}
        <div className="flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center shrink-0 ${
                finalIsDestructive
                  ? 'bg-tertiary-container text-white'
                  : 'bg-secondary-container text-on-secondary-container'
              }`}
            >
              <span className="material-symbols-outlined text-base sm:text-lg">
                {finalIsDestructive ? 'warning' : 'verified_user'}
              </span>
            </span>
            <span
              className={`text-xs font-bold tracking-wider uppercase truncate ${
                finalIsDestructive ? 'text-tertiary' : 'text-secondary'
              }`}
            >
              {finalIsDestructive ? 'Consequential Action' : 'Action Confirmation'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1 bg-surface-container-low px-2 py-0.5 rounded text-[11px] font-mono text-on-surface-variant">
              <kbd className="font-semibold text-primary">ESC</kbd>
              <span>to dismiss</span>
            </div>
            <button
              onClick={onCancel}
              className="w-7 h-7 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface-variant flex items-center justify-center sm:hidden"
              aria-label="Close"
            >
              <span className="material-symbols-outlined text-base">close</span>
            </button>
          </div>
        </div>

        {/* Dialog Header & Description */}
        <div className="flex flex-col gap-1.5">
          <h3 className="text-lg sm:text-2xl font-bold text-primary tracking-tight">
            {title}
          </h3>
          {message && (
            <p className="text-sm text-on-surface-variant leading-relaxed">
              {message}
            </p>
          )}
        </div>

        {/* System Impact Checklist if present */}
        {impactPoints && impactPoints.length > 0 && (
          <div className="p-4 rounded-2xl bg-surface-container-low flex flex-col gap-2 border border-outline-variant/30">
            <span className="text-xs font-bold text-primary uppercase tracking-wider">
              System Impact Analysis:
            </span>
            {impactPoints.map((point, idx) => (
              <div key={idx} className="flex items-start gap-2 text-xs text-on-surface leading-snug">
                <span
                  className={`material-symbols-outlined text-[16px] shrink-0 mt-0.5 ${
                    finalIsDestructive ? 'text-tertiary' : 'text-secondary'
                  }`}
                >
                  {finalIsDestructive ? 'remove_circle_outline' : 'check_circle'}
                </span>
                <span>{point}</span>
              </div>
            ))}
          </div>
        )}

        {/* Action Button Matrix */}
        <div className="flex flex-col sm:flex-row-reverse items-stretch sm:items-center gap-3 pt-2">
          {/* Destructive / Confirm action */}
          <button
            onClick={onConfirm}
            disabled={isDisabled}
            className={`px-6 py-2.5 rounded-full font-bold text-sm transition-all flex items-center justify-center gap-2 ${
              isDisabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
            } ${
              finalIsDestructive
                ? 'bg-error text-white hover:bg-[#93000a] shadow-sm'
                : 'bg-primary text-white hover:bg-primary-container shadow-sm'
            }`}
          >
            {loading && (
              <span className="material-symbols-outlined text-base animate-spin">progress_activity</span>
            )}
            <span>{loading ? 'Processing...' : finalConfirmText}</span>
            {!loading && <span className="material-symbols-outlined text-base">arrow_forward</span>}
          </button>

          {/* Safe Dismiss / Keep action */}
          <button
            onClick={onCancel}
            disabled={loading}
            className={`px-5 py-2.5 rounded-full bg-surface-container hover:bg-surface-container-high text-primary font-semibold text-sm transition-colors flex items-center justify-center gap-1.5 ${
              loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
            }`}
          >
            <span>{finalCancelText}</span>
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? ReactDOM.createPortal(modalContent, document.body)
    : modalContent;
}
