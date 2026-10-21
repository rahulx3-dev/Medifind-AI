import React, { useState } from 'react';
import { motion } from 'motion/react';
import RollingNumber from './RollingNumber';

/**
 * AnimatedIcon
 * Renders an icon that has continuous ambient micro-motion when idle,
 * and executes a signature micro-animation when the card is hovered or tapped.
 */
export function AnimatedIcon({ name, isHovered, size = 24, color }) {
  // Determine signature hover animation based on icon type
  const getHoverAnimation = () => {
    switch (name) {
      case 'timelapse':
      case 'schedule':
      case 'sync':
        return {
          rotate: isHovered ? 360 : 0,
          scale: isHovered ? 1.15 : 1,
          transition: { duration: 0.65, ease: [0.34, 1.56, 0.64, 1] }
        };
      case 'hourglass_empty':
      case 'hourglass_top':
      case 'hourglass_bottom':
        return {
          rotate: isHovered ? 180 : 0,
          scale: isHovered ? 1.18 : 1,
          transition: { type: 'spring', stiffness: 260, damping: 16 }
        };
      case 'storefront':
      case 'domain':
      case 'inventory_2':
      case 'receipt_long':
        return {
          y: isHovered ? -4 : 0,
          scale: isHovered ? 1.16 : 1,
          transition: { type: 'spring', stiffness: 350, damping: 18 }
        };
      case 'task_alt':
      case 'verified':
      case 'assignment_turned_in':
      case 'check_circle':
        return {
          scale: isHovered ? [1, 1.25, 1.15] : 1,
          rotate: isHovered ? [0, -10, 8, 0] : 0,
          transition: { duration: 0.5, ease: 'easeOut' }
        };
      case 'warning':
      case 'assignment_late':
      case 'error':
        return {
          rotate: isHovered ? [-12, 12, -8, 8, 0] : 0,
          scale: isHovered ? 1.2 : 1,
          transition: { duration: 0.45, ease: 'easeInOut' }
        };
      case 'group':
      case 'near_me':
      case 'sensors':
      case 'medication':
        return {
          scale: isHovered ? [1, 1.2, 1.12] : 1,
          y: isHovered ? -2 : 0,
          transition: { duration: 0.4, ease: 'easeOut' }
        };
      default:
        return {
          scale: isHovered ? 1.15 : 1,
          y: isHovered ? -2 : 0,
          transition: { type: 'spring', stiffness: 300, damping: 20 }
        };
    }
  };

  // Ambient idle micro-motion for a living feel
  const getAmbientAnimation = () => {
    if (isHovered) return {};
    switch (name) {
      case 'timelapse':
      case 'schedule':
        return {
          rotate: [0, 8, 0, -8, 0],
          transition: { repeat: Infinity, duration: 4.5, ease: 'easeInOut' }
        };
      case 'hourglass_empty':
      case 'hourglass_top':
        return {
          rotate: [-4, 4, -4],
          transition: { repeat: Infinity, duration: 3.2, ease: 'easeInOut' }
        };
      case 'storefront':
      case 'domain':
        return {
          y: [0, -1.5, 0],
          transition: { repeat: Infinity, duration: 3, ease: 'easeInOut' }
        };
      case 'warning':
      case 'assignment_late':
        return {
          opacity: [0.85, 1, 0.85],
          scale: [0.98, 1.04, 0.98],
          transition: { repeat: Infinity, duration: 2.4, ease: 'easeInOut' }
        };
      default:
        return {
          scale: [1, 1.03, 1],
          transition: { repeat: Infinity, duration: 3.5, ease: 'easeInOut' }
        };
    }
  };

  return (
    <motion.span
      className="material-symbols-outlined"
      style={{
        fontSize: size,
        color: color || 'inherit',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        transformOrigin: 'center center'
      }}
      animate={{
        ...getAmbientAnimation(),
        ...getHoverAnimation()
      }}
    >
      {name}
    </motion.span>
  );
}

/**
 * AnimatedStatCard
 * Interactive, animated KPI/metric card with:
 * - Rolling odometer number animation on load, refresh, or number change
 * - Interactive and ambient animated icons
 * - Card elevation, soft glow, and interactive sheen on hover
 * - Smoothly expanding bottom accent line
 */
export default function AnimatedStatCard({
  icon,
  value,
  label,
  subtitle,
  iconBg = '#e0f2eb',
  iconColor = '#2e685d',
  iconSize = 24,
  iconBorderRadius = 14,
  iconShape = 'rounded', // 'rounded' (squircle) | 'circle'
  accentColor = '#2e685d',
  hasBottomBar = true,
  barWidth = '100%',
  layout = 'side-by-side', // 'side-by-side' (Patient Orders style) | 'split' (Bento style) | 'compact'
  onClick,
  delay = 0,
  refreshKey = 0,
  className = '',
  cardStyle = {},
  children
}) {
  const [isHovered, setIsHovered] = useState(false);

  const isClickable = Boolean(onClick);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.45,
        delay,
        ease: [0.2, 0.8, 0.2, 1]
      }}
      whileHover={{
        y: -5,
        boxShadow: '0 12px 28px rgba(3, 47, 40, 0.08), 0 2px 6px rgba(0, 0, 0, 0.02)',
        borderColor: '#b0ecdd',
        transition: { type: 'spring', stiffness: 350, damping: 22 }
      }}
      whileTap={isClickable ? { scale: 0.985 } : undefined}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      onClick={onClick}
      className={`animated-stat-card ${className || ''}`.trim()}
      style={{
        background: '#ffffff',
        borderRadius: 20,
        padding: '1.25rem',
        border: '1px solid #e0f2eb',
        boxShadow: '0 2px 8px rgba(3, 47, 40, 0.04)',
        position: 'relative',
        overflow: 'hidden',
        cursor: isClickable ? 'pointer' : 'default',
        transition: 'border-color 0.25s ease',
        ...cardStyle
      }}
    >
      {/* Interactive Sheen Glare across the card on hover */}
      <motion.div
        initial={false}
        animate={{
          x: isHovered ? ['-120%', '220%'] : '-120%'
        }}
        transition={{
          duration: 0.85,
          ease: 'easeInOut'
        }}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '50%',
          height: '100%',
          background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.55), transparent)',
          transform: 'skewX(-20deg)',
          pointerEvents: 'none',
          zIndex: 1
        }}
      />

      {/* CONTENT LAYOUTS */}
      {layout === 'side-by-side' ? (
        // Side-by-Side (as in Patient My Orders)
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', position: 'relative', zIndex: 2 }}>
          {/* Icon Badge */}
          <motion.div
            animate={{
              scale: isHovered ? 1.08 : 1,
              boxShadow: isHovered
                ? `0 6px 16px ${iconBg === '#ffffff' ? 'rgba(0,0,0,0.08)' : 'rgba(46, 104, 93, 0.2)'}`
                : '0 2px 4px rgba(0,0,0,0.02)'
            }}
            transition={{ type: 'spring', stiffness: 350, damping: 20 }}
            style={{
              width: 48,
              height: 48,
              borderRadius: iconShape === 'circle' ? '50%' : iconBorderRadius,
              background: iconBg,
              color: iconColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <AnimatedIcon name={icon} isHovered={isHovered} size={iconSize} color={iconColor} />
          </motion.div>

          {/* Number & Label */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#032f28', lineHeight: 1.15, display: 'flex', alignItems: 'center' }}>
              <RollingNumber value={value} delay={delay + 0.05} refreshKey={refreshKey} />
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#717976', marginTop: '0.25rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {label}
            </div>
            {subtitle && (
              <div style={{ fontSize: 11, color: '#a0a8a5', marginTop: '0.15rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {subtitle}
              </div>
            )}
          </div>
        </div>
      ) : layout === 'split' ? (
        // Split (as in Bento Pharmacist/Admin style: Label & Value on left, Icon on right)
        <div style={{ position: 'relative', zIndex: 2 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#717976',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  display: 'block',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {label}
              </span>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 800,
                  color: '#032f28',
                  marginTop: '0.25rem',
                  lineHeight: 1.15,
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                <RollingNumber value={value} delay={delay + 0.05} refreshKey={refreshKey} />
              </div>
            </div>

            {/* Icon Badge */}
            <motion.div
              animate={{
                scale: isHovered ? 1.1 : 1,
                boxShadow: isHovered
                  ? `0 6px 14px ${iconBg === '#ffffff' ? 'rgba(0,0,0,0.08)' : 'rgba(46, 104, 93, 0.2)'}`
                  : '0 2px 4px rgba(0,0,0,0.02)'
              }}
              transition={{ type: 'spring', stiffness: 350, damping: 20 }}
              style={{
                width: 42,
                height: 42,
                borderRadius: iconShape === 'circle' ? '50%' : iconBorderRadius,
                background: iconBg,
                color: iconColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <AnimatedIcon name={icon} isHovered={isHovered} size={iconSize} color={iconColor} />
            </motion.div>
          </div>

          {subtitle && (
            <div style={{ fontSize: 12, color: '#717976', marginTop: '0.75rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {subtitle}
            </div>
          )}
          {children}
        </div>
      ) : (
        // Compact / Default
        <div style={{ position: 'relative', zIndex: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#2e685d' }}>
              {label}
            </span>
            <motion.div
              animate={{
                scale: isHovered ? 1.12 : 1
              }}
              transition={{ type: 'spring', stiffness: 350, damping: 20 }}
              style={{
                width: 32,
                height: 32,
                borderRadius: iconShape === 'circle' ? '50%' : 10,
                background: iconBg,
                color: iconColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <AnimatedIcon name={icon} isHovered={isHovered} size={iconSize || 18} color={iconColor} />
            </motion.div>
          </div>

          <div style={{ fontSize: 26, fontWeight: 800, color: '#032f28', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            <RollingNumber value={value} delay={delay + 0.05} refreshKey={refreshKey} />
          </div>

          {subtitle && (
            <div style={{ fontSize: 11, fontWeight: 600, color: '#2e685d', marginTop: '0.4rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {subtitle}
            </div>
          )}
          {children}
        </div>
      )}

      {/* Animated Bottom Highlight Line */}
      {hasBottomBar && (
        <motion.div
          initial={false}
          animate={{
            width: isHovered ? '100%' : (barWidth || '100%'),
            opacity: isHovered ? 1 : 0.85
          }}
          transition={{
            type: 'spring',
            stiffness: 300,
            damping: 24
          }}
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            height: 4,
            background: accentColor,
            borderRadius: 99,
            zIndex: 3
          }}
        />
      )}
    </motion.div>
  );
}
