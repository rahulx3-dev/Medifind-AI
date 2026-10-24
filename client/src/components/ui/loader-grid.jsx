import React from 'react';

/**
 * LoaderGrid Component
 * Exported for backwards-compatibility / modular references.
 */
export const LoaderGrid = ({ className = '', style = {} }) => {
  return (
    <div
      className={`relative w-[2.5em] h-[2.5em] rotate-[165deg] loader-grid-container ${className}`}
      style={style}
    >
      <span className="beforeEl" />
      <span className="afterEl" />
    </div>
  );
};

export default LoaderGrid;

export function DemoOne() {
  return <LoaderGrid />;
}

/**
 * AnimatedLogoEmblem
 * Pure SVG animated representation of the canonical MediFind AI logo:
 * 1. First: The Medical Cross (+) smoothly draws and blooms into place.
 * 2. Then: The Arrow surges smoothly from the bottom-left stem, sweeps along
 *    the curve through the cross center, and locks into the top-right.
 * 3. Both harmonize in a gentle upward elevation before smoothly looping.
 */
export function AnimatedLogoEmblem({ size = 120, className = '' }) {
  // SVG paths perfectly aligned to canonical medifind_logo.png
  // Cross outline (gap on right for arrow passage)
  const crossPath =
    'M 35 36 L 35 12 C 35 7 39 4 44 4 L 58 4 C 63 4 67 7 67 12 L 67 24 M 81 36 L 93 36 C 98 36 101 39 101 44 L 101 60 C 101 65 98 68 93 68 L 67 68 L 67 96 C 67 101 63 104 58 104 L 44 104 C 39 104 35 101 35 96 L 35 68 L 11 68 C 6 68 3 65 3 60 L 3 44 C 3 39 6 36 11 36 Z';

  // Curved arrow shaft starting from the bottom-left stem
  const arrowStemPath = 'M 35 88 C 35 68 45 52 60 41';

  // Dynamic sharp arrowhead pointing at 45° up and right
  const arrowHeadPath = 'M 75 23 L 44 32 L 58 42 L 69 55 Z';

  return (
    <div
      className={`relative flex items-center justify-center select-none ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 104 108"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full overflow-visible filter drop-shadow-[0_8px_20px_rgba(3,47,40,0.25)]"
      >
        <defs>
          {/* Canonical MediFind Brand Gradient: Teal (bottom-left) to Lime Green (top-right) */}
          <linearGradient id="medifindBrandGrad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#0d9488" />
            <stop offset="45%" stopColor="#10b981" />
            <stop offset="80%" stopColor="#4ade80" />
            <stop offset="100%" stopColor="#84cc16" />
          </linearGradient>

          {/* Luminous glow filter for sharp arrowhead arrival */}
          <filter id="arrowArrivalGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3.5" result="glow" />
            <feComposite in="SourceGraphic" in2="glow" operator="over" />
          </filter>
        </defs>

        {/* 1. THE MEDICAL CROSS (+): Comes in first with smooth stroke draw and bloom */}
        <g className="logo-cross-group">
          <path
            d={crossPath}
            stroke="url(#medifindBrandGrad)"
            strokeWidth="6.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="logo-cross-stroke"
          />
        </g>

        {/* 2. THE ARROW: Surges from left-bottom and swooshes smoothly up and right */}
        <g className="logo-arrow-group">
          {/* Curved Arrow Shaft drawing from bottom-left */}
          <path
            d={arrowStemPath}
            stroke="url(#medifindBrandGrad)"
            strokeWidth="6.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="logo-arrow-stem"
          />

          {/* Arrowhead gliding up from bottom-left into top-right position */}
          <path
            d={arrowHeadPath}
            fill="url(#medifindBrandGrad)"
            stroke="url(#medifindBrandGrad)"
            strokeWidth="2.5"
            strokeLinejoin="round"
            className="logo-arrow-head"
          />
        </g>

        {/* Subtle Arrival Flare when Arrow reaches apex */}
        <circle
          cx="75"
          cy="23"
          r="6"
          fill="#86efac"
          className="logo-arrival-ping"
        />
      </svg>
    </div>
  );
}

/**
 * AppLoadingScreen
 * Full-screen loading screen strictly utilizing ONLY the MediFind AI logo:
 * - Rendered on the exact Barba slider background color (#A5D6A7).
 * - Logo animation sequence:
 *   1. Plus sign (+) draws in first smoothly.
 *   2. Arrow sweeps in from bottom-left, curving up through the cross.
 *   3. Smooth, graceful continuous loop.
 */
export function AppLoadingScreen({ message = 'Locating Clinical Network...' }) {
  return (
    <div
      className="fixed inset-0 w-screen h-screen flex flex-col items-center justify-center select-none overflow-hidden z-[9999]"
      style={{
        backgroundColor: '#A5D6A7',
        background: 'radial-gradient(circle at 50% 48%, #c6f6d5 0%, #A5D6A7 62%, #8ec592 100%)'
      }}
    >
      {/* Soft ambient light diffusion */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[360px] h-[360px] bg-white/20 rounded-full blur-3xl pointer-events-none" />

      {/* Main Center Stage */}
      <div className="relative z-10 flex flex-col items-center justify-center">
        {/* Animated Logo Container with Gentle Floating Motion */}
        <div className="relative flex flex-col items-center justify-center animate-emblem-float">
          {/* ONLY the App Logo in pure SVG animation */}
          <AnimatedLogoEmblem size={128} />

          {/* Dynamic Floor Shadow Breathing under the Logo */}
          <div className="mt-4 w-20 h-2.5 bg-[#032f28]/18 rounded-[100%] blur-sm animate-floor-shadow pointer-events-none" />
        </div>

        {/* Brand Typography & Status Message in Dark Spruce */}
        <div className="mt-6 flex flex-col items-center text-center space-y-2">
          <div className="flex items-center justify-center gap-1.5 font-['Plus_Jakarta_Sans',sans-serif]">
            <span className="text-2xl sm:text-[26px] font-black text-[#032f28] tracking-tight">
              MediFind
            </span>
            <span className="text-2xl sm:text-[26px] font-black text-[#065f46] tracking-tight">
              AI
            </span>
          </div>

          {/* Status Message with Active Signal Pulse */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/45 backdrop-blur-md border border-white/60 shadow-xs">
            <span className="w-2 h-2 rounded-full bg-[#047857] animate-ping shrink-0" />
            <span className="text-xs font-bold uppercase tracking-wider text-[#032f28]/90">
              {message}
            </span>
          </div>
        </div>
      </div>

      {/* Scoped CSS for Meaning-Aligned Animation Sequence */}
      <style>{`
        /* 
         * LOGO CHOREOGRAPHY (3.2s Loop):
         * 0.0s - 0.7s: First, Plus sign draws and blooms into place.
         * 0.6s - 1.5s: Then, Arrow comes from bottom-left, curving up through cross.
         * 1.5s - 2.5s: Both parts glow & elevate together along 45deg trajectory.
         * 2.5s - 3.2s: Smooth dissolve & loop reset.
         */

        /* 1. PLUS SIGN (+) DRAW */
        .logo-cross-stroke {
          stroke-dasharray: 400;
          stroke-dashoffset: 400;
          animation: drawCrossStroke 3.2s cubic-bezier(0.16, 1, 0.3, 1) infinite;
        }

        @keyframes drawCrossStroke {
          0% {
            stroke-dashoffset: 400;
            opacity: 0;
            transform: scale(0.92);
            transform-origin: center;
          }
          6% {
            opacity: 1;
          }
          28% {
            stroke-dashoffset: 0;
            transform: scale(1);
            transform-origin: center;
          }
          78% {
            stroke-dashoffset: 0;
            opacity: 1;
            transform: scale(1);
            transform-origin: center;
          }
          92% {
            opacity: 0;
            stroke-dashoffset: 0;
            transform: scale(0.96);
            transform-origin: center;
          }
          100% {
            stroke-dashoffset: 400;
            opacity: 0;
            transform: scale(0.92);
            transform-origin: center;
          }
        }

        /* 2. ARROW STEM: Curves up from bottom-left */
        .logo-arrow-stem {
          stroke-dasharray: 120;
          stroke-dashoffset: 120;
          animation: drawArrowStem 3.2s cubic-bezier(0.16, 1, 0.3, 1) infinite;
        }

        @keyframes drawArrowStem {
          0%, 20% {
            stroke-dashoffset: 120;
            opacity: 0;
          }
          25% {
            opacity: 1;
          }
          48% {
            stroke-dashoffset: 0;
            opacity: 1;
          }
          78% {
            stroke-dashoffset: 0;
            opacity: 1;
          }
          92% {
            opacity: 0;
          }
          100% {
            stroke-dashoffset: 120;
            opacity: 0;
          }
        }

        /* 3. ARROWHEAD: Launches from bottom-left, follows trajectory and lands at top-right */
        .logo-arrow-head {
          animation: surgeArrowHead 3.2s cubic-bezier(0.16, 1, 0.3, 1) infinite;
        }

        @keyframes surgeArrowHead {
          0%, 22% {
            transform: translate(-38px, 38px) scale(0.4);
            opacity: 0;
            transform-origin: 75px 23px;
          }
          28% {
            opacity: 0.9;
          }
          48% {
            transform: translate(0, 0) scale(1);
            opacity: 1;
            transform-origin: 75px 23px;
          }
          62% {
            transform: translate(2px, -3px) scale(1.04);
            opacity: 1;
            transform-origin: 75px 23px;
          }
          78% {
            transform: translate(0, 0) scale(1);
            opacity: 1;
            transform-origin: 75px 23px;
          }
          92% {
            opacity: 0;
            transform: translate(4px, -6px) scale(1.02);
            transform-origin: 75px 23px;
          }
          100% {
            transform: translate(-38px, 38px) scale(0.4);
            opacity: 0;
            transform-origin: 75px 23px;
          }
        }

        /* 4. ARRIVAL PING: Radiant flash at top-right when arrow completes its ascent */
        .logo-arrival-ping {
          animation: arrivalPing 3.2s ease-out infinite;
          transform-origin: 75px 23px;
        }

        @keyframes arrivalPing {
          0%, 46% {
            transform: scale(0);
            opacity: 0;
          }
          50% {
            transform: scale(1.4);
            opacity: 0.9;
          }
          60% {
            transform: scale(2.2);
            opacity: 0;
          }
          100% {
            transform: scale(0);
            opacity: 0;
          }
        }

        /* 5. GENTLE FLOAT FOR ENTIRE EMBLEM */
        .animate-emblem-float {
          animation: emblemFloat 3.2s ease-in-out infinite;
        }

        @keyframes emblemFloat {
          0%, 100% {
            transform: translateY(0);
          }
          55% {
            transform: translateY(-5px);
          }
        }

        /* 6. RESPONSIVE FLOOR SHADOW */
        .animate-floor-shadow {
          animation: floorShadowPulse 3.2s ease-in-out infinite;
        }

        @keyframes floorShadowPulse {
          0%, 100% {
            transform: scale(1);
            opacity: 0.28;
          }
          55% {
            transform: scale(0.78);
            opacity: 0.14;
          }
        }
      `}</style>
    </div>
  );
}
