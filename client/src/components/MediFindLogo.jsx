import React from 'react';
import logoImg from '../assets/medifind_logo.png';

/**
 * MediFindLogo — Canonical MediFind AI Brand Identity Component
 *
 * Uses the exact canonical brand asset provided by MediFind AI.
 * Displays the canonical emblem alongside the "MediFind AI" wordmark
 * and clinical network subtitle matching Stitch design specifications.
 */
export default function MediFindLogo({
  size = 'md',
  className = '',
  style = {},
  onClick,
  showText = true,
  showSubtitle = true,
  inverted = false
}) {
  const configMap = {
    xs: { imgHeight: 36, titleSize: 13, subSize: 9,  gap: 2 },
    sm: { imgHeight: 48, titleSize: 15, subSize: 10, gap: 2 },
    md: { imgHeight: 60, titleSize: 18, subSize: 11, gap: 2 },
    lg: { imgHeight: 76, titleSize: 22, subSize: 12, gap: 3 },
    xl: { imgHeight: 96, titleSize: 26, subSize: 13, gap: 4 },
    '2xl': { imgHeight: 116, titleSize: 32, subSize: 15, gap: 4 }
  };

  const cfg = configMap[size] || configMap.md;
  const imgHeight = typeof size === 'number' ? size : cfg.imgHeight;
  const titleSize = cfg.titleSize;
  const subSize = cfg.subSize;
  const gap = cfg.gap;
  /* PNG assets typically have ~15–20% internal whitespace padding around the mark.
     We pull the image leftward to eat into that padding, so the visible emblem
     sits flush against the wordmark. */
  const imgNegMargin = Math.round(imgHeight * 0.15);

  return (
    <div
      className={`inline-flex items-center select-none ${onClick ? 'cursor-pointer' : ''} ${className}`}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: `${gap}px`,
        textDecoration: 'none',
        background: 'none',
        ...style
      }}
    >
      <img
        src={logoImg}
        alt="MediFind AI Brand Logo"
        style={{
          height: `${imgHeight}px`,
          width: 'auto',
          maxWidth: '100%',
          objectFit: 'contain',
          display: 'block',
          /* Pull left & right to compensate for PNG internal padding */
          marginLeft: `-${imgNegMargin}px`,
          marginRight: `-${imgNegMargin}px`,
          /* multiply blends white pixels into the background, hiding the oval */
          mixBlendMode: inverted ? 'screen' : 'multiply',
          filter: inverted
            ? 'brightness(2) saturate(1.3) contrast(1.1)'
            : 'none',
          background: 'transparent'
        }}
      />
      {showText && (
        <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left', lineHeight: 1.15 }}>
          <span
            style={{
              fontSize: `${titleSize}px`,
              fontWeight: 800,
              color: inverted ? '#ffffff' : '#032f28',
              letterSpacing: '-0.02em',
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              display: 'flex',
              alignItems: 'center'
            }}
          >
            MediFind
            <span style={{ color: inverted ? '#34d399' : '#2e685d', marginLeft: '3px' }}>AI</span>
          </span>
          {showSubtitle && (
            <span
              style={{
                fontSize: `${subSize}px`,
                color: inverted ? '#a7f3d0' : '#414846',
                fontWeight: 600,
                letterSpacing: '0.02em',
                marginTop: '1px',
                fontFamily: "'Plus Jakarta Sans', sans-serif"
              }}
            >
              Clinical Rx Network
            </span>
          )}
        </div>
      )}
    </div>
  );
}
