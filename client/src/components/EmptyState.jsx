import React from 'react';

/**
 * EmptyState — Stitch Clinical Sage Empathetic Null & Empty State Component
 *
 * Implements the Stitch pattern for zero-data and zero-results:
 * - Illustrated centerpiece well
 * - Clinical title & empathetic description
 * - Action buttons with pill geometry
 * - Optional suggestions / next steps
 */
export default function EmptyState({
  icon = 'inventory_2',
  title = 'No items found',
  description = 'There are no active records matching your criteria.',
  actionText,
  actionLabel,
  onAction,
  secondaryActionText,
  secondaryActionLabel,
  onSecondaryAction,
  suggestions = [],
  className = ''
}) {
  const primaryText = actionText || actionLabel;
  const secondaryText = secondaryActionText || secondaryActionLabel;
  return (
    <div className={`w-full bg-surface-container-lowest rounded-3xl p-6 sm:p-10 border border-outline-variant/30 flex flex-col items-center text-center gap-5 shadow-sm ${className}`}>
      {/* Illustrated Centerpiece Icon Well */}
      <div className="w-16 h-16 rounded-full bg-surface-container-high flex items-center justify-center text-secondary shadow-inner">
        <span className="material-symbols-outlined text-3xl">{icon}</span>
      </div>

      <div className="flex flex-col gap-1.5 max-w-md">
        <h3 className="text-xl font-bold text-primary tracking-tight">
          {title}
        </h3>
        <p className="text-sm text-on-surface-variant leading-relaxed">
          {description}
        </p>
      </div>

      {/* Optional Suggestions */}
      {suggestions && suggestions.length > 0 && (
        <div className="w-full max-w-lg bg-surface-container-low rounded-2xl p-4 flex flex-col gap-2.5 text-left border border-outline-variant/20">
          <span className="text-xs font-bold text-secondary uppercase tracking-wider">
            Suggested Next Steps:
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {suggestions.map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={item.onClick}
                className="flex items-center gap-2 p-2.5 rounded-xl bg-surface-container-lowest hover:bg-surface-container text-left transition-colors border border-outline-variant/30"
              >
                {item.icon && (
                  <span className="material-symbols-outlined text-secondary text-base shrink-0">
                    {item.icon}
                  </span>
                )}
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-primary">{item.title}</span>
                  {item.subtitle && <span className="text-[11px] text-on-surface-variant">{item.subtitle}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {(primaryText || secondaryText) && (
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          {primaryText && (
            <button
              onClick={onAction}
              className="px-6 py-2.5 rounded-full bg-primary hover:bg-primary-container text-white font-bold text-sm shadow-sm transition-all flex items-center gap-2 cursor-pointer"
            >
              <span>{primaryText}</span>
              <span className="material-symbols-outlined text-base">arrow_forward</span>
            </button>
          )}
          {secondaryText && (
            <button
              onClick={onSecondaryAction}
              className="px-5 py-2.5 rounded-full bg-surface-container hover:bg-surface-container-high text-primary font-semibold text-sm transition-colors cursor-pointer"
            >
              {secondaryText}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
