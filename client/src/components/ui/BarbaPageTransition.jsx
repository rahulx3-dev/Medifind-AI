import React, { useEffect, useRef, useState } from 'react';
import barba from '@barba/core';
import { motion } from 'motion/react';

/**
 * Hook to initialize @barba/core lifecycle safely within the React SPA.
 * Prevents default navigation link hijacking while registering Barba transition hooks.
 */
export function useBarbaInit() {
  useEffect(() => {
    try {
      barba.init({
        prevent: () => true, // Don't intercept SPA state-based router
        transitions: [
          {
            name: 'barba-sideways-wipe',
            leave() {},
            enter() {}
          }
        ]
      });
    } catch (_) {
      // Gracefully handle if Barba is already active in hot-reload
    }

    return () => {
      try {
        barba.destroy();
      } catch (_) {}
    };
  }, []);
}

/**
 * Barba.js authentic Sideways (Horizontal) Wipe Transition.
 * Fast, ultra-smooth sideways sheet using #A5D6A7 (no text, pure clean silk glide).
 */
export function BarbaCurtainOverlay({ activeKey, disabled = false }) {
  const mountTimeRef = useRef(Date.now());
  const previousKeyRef = useRef(activeKey);
  const [animatingKey, setAnimatingKey] = useState(null);

  // Check if session flag indicates recent auth login
  useEffect(() => {
    // If mounted recently or auth just completed, do not trigger curtain slider
    const justLoggedIn = typeof window !== 'undefined' && sessionStorage.getItem('medifind_auth_entrance');
    if (justLoggedIn || Date.now() - mountTimeRef.current < 1200) {
      previousKeyRef.current = activeKey;
      if (justLoggedIn) {
        setTimeout(() => {
          try { sessionStorage.removeItem('medifind_auth_entrance'); } catch (_) {}
        }, 1500);
      }
      return;
    }
    if (previousKeyRef.current === activeKey) {
      return;
    }
    previousKeyRef.current = activeKey;
    if (disabled) return;

    setAnimatingKey(activeKey);
    const timer = setTimeout(() => {
      setAnimatingKey(null);
    }, 420);
    return () => clearTimeout(timer);
  }, [activeKey, disabled]);

  if (!animatingKey) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[9990] overflow-hidden">
      {/* Primary Slide Sheet in #A5D6A7 - Fast, Buttery-Smooth Sideways Glide */}
      <motion.div
        key={`barba-layer-${animatingKey}`}
        initial={{ x: '-100%' }}
        animate={{
          x: ['-100%', '0%', '0%', '100%']
        }}
        transition={{
          duration: 0.38,
          times: [0, 0.44, 0.56, 1],
          ease: [0.76, 0, 0.24, 1]
        }}
        style={{
          backgroundColor: '#A5D6A7',
          willChange: 'transform'
        }}
        className="absolute inset-0 shadow-[24px_0_48px_rgba(46,125,50,0.25)]"
      />
    </div>
  );
}

/**
 * Page container:
 * - On entrance from Login/Auth: uses the exact Hero-to-Auth transition
 *   (fade + scale 0.985 -> 1.0, duration 0.45, ease [0.16, 1, 0.3, 1]) without slider.
 * - On subsequent tab switches: performs fast, responsive sideways transition.
 */
export function BarbaContainer({ children, pageKey, className = '' }) {
  const isInitialMount = useRef(true);

  useEffect(() => {
    isInitialMount.current = false;
  }, []);

  const justLoggedIn = typeof window !== 'undefined' && Boolean(sessionStorage.getItem('medifind_auth_entrance'));
  const isInitial = isInitialMount.current || justLoggedIn;

  return (
    <motion.div
      key={pageKey}
      data-barba="container"
      data-barba-namespace={pageKey}
      initial={isInitial ? { opacity: 0, scale: 0.985 } : { opacity: 0, x: 28 }}
      animate={isInitial ? { opacity: 1, scale: 1 } : { opacity: 1, x: 0 }}
      exit={isInitial ? { opacity: 0, scale: 0.985 } : { opacity: 0, x: -28 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className={className}
      style={{ willChange: 'transform, opacity' }}
    >
      {children}
    </motion.div>
  );
}

