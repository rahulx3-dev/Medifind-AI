/**
 * FlowButton — MediFind CTA button with reference animation
 *
 * Animation (matches reference exactly):
 *   - Hover: dark circle expands from center (ink fill)
 *   - Left arrow enters from off-screen left
 *   - Right arrow exits to off-screen right
 *   - Text shifts rightward
 *   - Border fades out, radius softens
 *   - Active: scale(0.96)
 *   - prefers-reduced-motion: all transitions disabled
 *
 * Props:
 *   children    — button label
 *   onClick     — click handler
 *   type        — 'button' | 'submit' | 'reset' (default 'button')
 *   disabled    — boolean
 *   loading     — boolean (shows spinner, disables animation)
 *   variant     — 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
 *   size        — 'sm' | 'md' | 'lg'
 *   fullWidth   — boolean
 *   iconLeft    — Material Symbol icon name (replaces left-arrow enter animation)
 *   className   — extra class string
 *   style       — extra inline style
 *   aria-label  — accessible label
 */

import React from 'react';
import './FlowButton.css';

// Arrow icon — SVG matching lucide ArrowRight stroke style
function ArrowIcon({ size = 15 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

export default function FlowButton({
  children,
  onClick,
  type = 'button',
  disabled = false,
  loading = false,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  iconLeft,
  className = '',
  style,
  'aria-label': ariaLabel,
  ...rest
}) {
  const arrowSize = size === 'lg' ? 16 : size === 'sm' ? 13 : 15;

  const cls = [
    'flow-btn',
    `fb-${size}`,
    variant !== 'primary' ? `fb-${variant}` : '',
    fullWidth ? 'fb-full' : '',
    loading ? 'fb-loading' : '',
    iconLeft ? 'fb-has-icon-left' : '',
    className
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      className={cls}
      onClick={disabled || loading ? undefined : onClick}
      disabled={disabled || loading}
      aria-label={ariaLabel}
      aria-disabled={disabled || loading}
      aria-busy={loading}
      style={style}
      {...rest}
    >
      {/* ── Left arrow — enters from left on hover ── */}
      {!iconLeft && !loading && (
        <span className="fb-arrow-left" aria-hidden="true">
          <ArrowIcon size={arrowSize} />
        </span>
      )}

      {/* ── Button content (text + optional left icon) ── */}
      <span className="fb-text">
        {loading ? (
          <span className="fb-spinner" role="status" aria-label="Loading…" />
        ) : (
          <>
            {iconLeft && (
              <span
                className="material-symbols-outlined"
                aria-hidden="true"
                style={{ fontSize: arrowSize + 2 }}
              >
                {iconLeft}
              </span>
            )}
            {children}
          </>
        )}
      </span>

      {/* ── Expanding dark circle (background fill) ── */}
      <span className="fb-circle" aria-hidden="true" />

      {/* ── Right arrow — exits right on hover ── */}
      {!loading && (
        <span className="fb-arrow-right" aria-hidden="true">
          <ArrowIcon size={arrowSize} />
        </span>
      )}
    </button>
  );
}
