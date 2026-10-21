import React, { useEffect, useState, useId } from 'react';
import { motion } from 'motion/react';

/**
 * DigitReel renders a single character.
 * If the character is a digit (0-9), it renders an animated vertical reel
 * that rolls from 0 through a sequence to land on the target digit with spring physics.
 */
function DigitReel({ char, index, delay = 0, refreshTrigger = 0 }) {
  const isDigit = /^[0-9]$/.test(char);

  if (!isDigit) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 1px',
          opacity: 0.9,
          lineHeight: '1.15em'
        }}
      >
        {char}
      </span>
    );
  }

  const targetDigit = parseInt(char, 10);
  // We use 20 items: [0..9, 0..9] so every number rolls through at least one full cycle
  // Target index = 10 + targetDigit.
  // Each item occupies 1 / 20 = 5% of height.
  const targetPercent = (10 + targetDigit) * 5;

  return (
    <span
      style={{
        display: 'inline-flex',
        height: '1.15em',
        lineHeight: '1.15em',
        overflow: 'hidden',
        position: 'relative',
        alignItems: 'flex-start',
        width: '0.62em',
        textAlign: 'center'
      }}
    >
      <motion.span
        key={`${char}-${refreshTrigger}-${index}`}
        initial={{ y: '0%' }}
        animate={{ y: `-${targetPercent}%` }}
        transition={{
          duration: 1.4,
          ease: [0.16, 1, 0.3, 1],
          delay: delay + index * 0.075
        }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          userSelect: 'none'
        }}
      >
        {[
          0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
          0, 1, 2, 3, 4, 5, 6, 7, 8, 9
        ].map((digit, i) => (
          <span
            key={i}
            style={{
              height: '1.15em',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            {digit}
          </span>
        ))}
      </motion.span>
    </span>
  );
}

/**
 * RollingNumber
 * Takes any value (number, string like "14", "80%", "1,200", "₹66.25"),
 * splits into characters and displays interactive vertical rolling reels.
 * Optional `refreshKey` prop will force re-roll whenever updated (e.g. on refresh/sync).
 */
export default function RollingNumber({
  value,
  prefix = '',
  suffix = '',
  delay = 0,
  refreshKey = 0,
  className = '',
  style = {}
}) {
  const [currentValue, setCurrentValue] = useState(value);
  const [internalKey, setInternalKey] = useState(0);

  useEffect(() => {
    setCurrentValue(value);
    setInternalKey((prev) => prev + 1);
  }, [value, refreshKey]);

  const str = String(currentValue ?? 0);
  const chars = str.split('');

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        letterSpacing: '-0.02em',
        fontVariantNumeric: 'tabular-nums',
        ...style
      }}
    >
      {prefix && <span style={{ marginRight: '0.15em', opacity: 0.9 }}>{prefix}</span>}
      {chars.map((ch, idx) => (
        <DigitReel
          key={`${idx}-${ch}`}
          char={ch}
          index={idx}
          delay={delay}
          refreshTrigger={internalKey}
        />
      ))}
      {suffix && <span style={{ marginLeft: '0.15em', opacity: 0.9 }}>{suffix}</span>}
    </span>
  );
}
