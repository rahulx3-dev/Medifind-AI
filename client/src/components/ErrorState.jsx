import React from 'react';

/**
 * ErrorState — Stitch Clinical Sage Inline & Block Error State Component
 *
 * Implements Stitch's non-toast, persistent clinical alert patterns:
 * - Error icon and coral badge
 * - Clear clinical diagnostic message
 * - Actionable recovery triggers
 */
export default function ErrorState({
  title = 'Encountered an issue',
  message = 'An unexpected error occurred while communicating with the health network.',
  onRetry,
  retryText = 'Retry Request',
  className = ''
}) {
  return (
    <div className={`w-full bg-[#fff5f5] rounded-3xl p-6 sm:p-8 border border-error-container flex flex-col sm:flex-row items-start gap-4 shadow-sm ${className}`}>
      <div className="w-12 h-12 rounded-full bg-error-container text-error flex items-center justify-center shrink-0">
        <span className="material-symbols-outlined text-2xl">error</span>
      </div>

      <div className="flex-1 flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-wider text-error bg-[#ffdad6] px-2 py-0.5 rounded-full">
            System Alert
          </span>
          <h4 className="text-lg font-bold text-primary">{title}</h4>
        </div>
        <p className="text-sm text-on-surface-variant leading-relaxed">
          {message}
        </p>

        {onRetry && (
          <div className="pt-2">
            <button
              onClick={onRetry}
              className="px-5 py-2 rounded-full bg-primary hover:bg-primary-container text-white font-bold text-xs shadow-sm transition-all inline-flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-sm">refresh</span>
              <span>{retryText}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
