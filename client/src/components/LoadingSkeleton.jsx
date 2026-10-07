import React from 'react';

/**
 * SkeletonText — Reusable text line placeholder
 */
export function SkeletonText({ lines = 1, width = 'full', className = '' }) {
  const getWidthClass = (idx) => {
    if (width !== 'full') return width;
    if (lines === 1) return 'w-full';
    if (idx === lines - 1) return 'w-3/5';
    if (idx % 2 === 1) return 'w-4/5';
    return 'w-full';
  };

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={`h-3 rounded-full skeleton-shimmer ${getWidthClass(i)}`}
        />
      ))}
    </div>
  );
}

/**
 * SkeletonCircle / SkeletonAvatar — Avatar or round button placeholder
 */
export function SkeletonCircle({ size = 'md', className = '' }) {
  const sizeMap = {
    xs: 'w-6 h-6',
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-14 h-14',
    xl: 'w-20 h-20'
  };

  return (
    <div
      className={`rounded-full skeleton-shimmer shrink-0 ${sizeMap[size] || size} ${className}`}
    />
  );
}

export const SkeletonAvatar = SkeletonCircle;

/**
 * SkeletonCard — Structural card placeholder matching Stitch clinical card
 */
export function SkeletonCard({ className = '', hasImage = true }) {
  return (
    <div
      className={`bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/30 flex flex-col gap-4 shadow-sm ${className}`}
    >
      <div className="flex items-center gap-3">
        {hasImage && (
          <div className="w-12 h-12 rounded-2xl skeleton-shimmer shrink-0" />
        )}
        <div className="flex-1 flex flex-col gap-2">
          <div className="w-3/4 h-4 rounded-full skeleton-shimmer" />
          <div className="w-1/2 h-3 rounded-full skeleton-shimmer" />
        </div>
      </div>
      <div className="flex flex-col gap-2 pt-1">
        <div className="w-full h-3 rounded-full skeleton-shimmer" />
        <div className="w-4/5 h-3 rounded-full skeleton-shimmer" />
      </div>
      <div className="flex items-center justify-between pt-3 border-t border-surface-container/60">
        <div className="w-20 h-4 rounded-full skeleton-shimmer" />
        <div className="w-24 h-8 rounded-full skeleton-shimmer" />
      </div>
    </div>
  );
}

/**
 * SkeletonRow — Table / list item placeholder
 */
export function SkeletonRow({ className = '' }) {
  return (
    <div className={`flex items-center justify-between py-3.5 border-b border-surface-container/50 ${className}`}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full skeleton-shimmer shrink-0" />
        <div className="flex flex-col gap-1.5">
          <div className="w-36 h-3.5 rounded-full skeleton-shimmer" />
          <div className="w-24 h-2.5 rounded-full skeleton-shimmer" />
        </div>
      </div>
      <div className="w-20 h-7 rounded-full skeleton-shimmer" />
    </div>
  );
}

/**
 * SkeletonMap — Map container placeholder preserving geometry
 */
export function SkeletonMap({ height = '320px', className = '' }) {
  return (
    <div
      style={{ height }}
      className={`w-full rounded-2xl relative overflow-hidden skeleton-shimmer border border-outline-variant/30 flex items-center justify-center ${className}`}
    >
      <div className="flex flex-col items-center gap-2 p-4 bg-white/80 backdrop-blur-md rounded-2xl border border-border-card shadow-sm z-10">
        <span className="material-symbols-outlined text-3xl text-secondary animate-pulse">
          map
        </span>
        <span className="text-xs font-bold text-primary">
          Initializing Geospatial Network...
        </span>
      </div>
    </div>
  );
}

/**
 * SkeletonTable — Data table placeholder with header and rows
 */
export function SkeletonTable({ rows = 4, className = '' }) {
  return (
    <div className={`w-full bg-surface-container-lowest rounded-3xl p-5 border border-outline-variant/30 flex flex-col gap-3 ${className}`}>
      <div className="flex items-center justify-between pb-3 border-b border-surface-container">
        <div className="w-32 h-4 rounded-full skeleton-shimmer" />
        <div className="w-20 h-4 rounded-full skeleton-shimmer" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}

/**
 * SkeletonTimeline — Stepped fulfillment / dispatch timeline placeholder
 */
export function SkeletonTimeline({ steps = 4, className = '' }) {
  return (
    <div className={`flex flex-col gap-4 p-4 ${className}`}>
      {Array.from({ length: steps }).map((_, i) => (
        <div key={i} className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full skeleton-shimmer shrink-0 mt-0.5" />
          <div className="flex-1 flex flex-col gap-1.5">
            <div className="w-28 h-3.5 rounded-full skeleton-shimmer" />
            <div className="w-48 h-2.5 rounded-full skeleton-shimmer" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Default backwards-compatible LoadingSkeleton component
 */
export default function LoadingSkeleton({
  type = 'cards',
  count = 3,
  className = ''
}) {
  if (type === 'metrics') {
    return (
      <div className={`grid grid-cols-2 md:grid-cols-4 gap-3 ${className}`}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="p-4 rounded-2xl bg-surface-container-lowest border border-outline-variant/30 flex flex-col gap-2">
            <div className="w-16 h-2.5 rounded-full skeleton-shimmer" />
            <div className="w-24 h-6 rounded-full skeleton-shimmer" />
          </div>
        ))}
      </div>
    );
  }

  if (type === 'table') {
    return <SkeletonTable rows={count} className={className} />;
  }

  if (type === 'map') {
    return <SkeletonMap className={className} />;
  }

  if (type === 'timeline') {
    return <SkeletonTimeline steps={count} className={className} />;
  }

  // Default: Cards grid
  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

