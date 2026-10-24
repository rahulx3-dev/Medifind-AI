import React from 'react';
import logoImg from '../../assets/medifind_logo.png';

/**
 * LoaderGrid Component
 * Standalone export as specified in reference.
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
 * AppLoadingScreen
 * Pure brand loading experience: ONLY uses the canonical MediFind AI logo
 * in motion representing its core meaning:
 * - Upward trajectory surge along the 45° arrow vector (rapid medicine discovery & health elevation)
 * - Luminous clinical beacon gleam sweeping across the arrow
 * - Soft dynamic ground shadow responding to the emblem's float height
 * - Set cleanly on the exact Barba slider background color (#A5D6A7).
 */
export function AppLoadingScreen({ message = 'Locating Clinical Network...' }) {
  return (
    <div
      className="fixed inset-0 w-screen h-screen flex flex-col items-center justify-center select-none overflow-hidden z-[9999]"
      style={{
        backgroundColor: '#A5D6A7',
        background: 'radial-gradient(circle at 50% 48%, #c6f6d5 0%, #A5D6A7 60%, #8ec592 100%)'
      }}
    >
      {/* Ambient soft backlight diffusion */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[380px] h-[380px] bg-white/25 rounded-full blur-3xl pointer-events-none" />

      {/* Main Center Container */}
      <div className="relative z-10 flex flex-col items-center justify-center">
        {/* Floating Logo Composition (ONLY our app logo with zero extraneous shapes) */}
        <div className="relative flex flex-col items-center justify-center">
          {/* Canonical App Logo with meaning-driven upward surge motion */}
          <div className="relative z-20 flex items-center justify-center animate-logo-arrow-surge">
            <img
              src={logoImg}
              alt="MediFind AI Logo"
              className="w-28 h-28 sm:w-32 sm:h-32 object-contain"
              style={{
                filter: 'drop-shadow(0 10px 22px rgba(3, 47, 40, 0.28))'
              }}
            />

            {/* Diagonal Gleam Sweep traversing the Arrow's upward trajectory */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
              <div className="w-12 h-36 bg-gradient-to-r from-transparent via-white/55 to-transparent -rotate-45 translate-x-[-150%] animate-arrow-gleam-sweep" />
            </div>
          </div>

          {/* Dynamic Ground Shadow Breathing Underneath the Rising Logo */}
          <div className="mt-4 w-20 h-3 bg-[#032f28]/18 rounded-[100%] blur-sm animate-logo-ground-shadow pointer-events-none" />
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

      {/* Scoped CSS for Meaning-Aligned Logo Motion */}
      <style>{`
        /* 
         * LOGO MEANING MOTION:
         * The cross represents stable healthcare and clinical sanctuary.
         * The arrow surging diagonally up and right (45deg) represents
         * rapid medicine finding, directional care, and elevating patient health.
         */
        @keyframes logoArrowSurge {
          0%, 100% {
            transform: translate(0, 0) scale(1);
            filter: drop-shadow(0 8px 18px rgba(3, 47, 40, 0.22));
          }
          50% {
            transform: translate(5px, -9px) scale(1.07);
            filter: drop-shadow(0 16px 28px rgba(16, 185, 129, 0.45));
          }
        }

        .animate-logo-arrow-surge {
          animation: logoArrowSurge 2.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        /* Diagonal Light Gleam Sweep traversing the Arrow's Trajectory */
        @keyframes arrowGleamSweep {
          0%, 20% {
            transform: translateX(-160%) rotate(45deg);
            opacity: 0;
          }
          45% {
            opacity: 0.9;
          }
          70%, 100% {
            transform: translateX(200%) rotate(45deg);
            opacity: 0;
          }
        }

        .animate-arrow-gleam-sweep {
          animation: arrowGleamSweep 2.2s ease-in-out infinite;
        }

        /* Dynamic Floor Shadow Breathing Underneath the Rising Logo */
        @keyframes logoGroundShadow {
          0%, 100% {
            transform: scale(1);
            opacity: 0.35;
          }
          50% {
            transform: scale(0.72) translateX(-3px);
            opacity: 0.16;
          }
        }

        .animate-logo-ground-shadow {
          animation: logoGroundShadow 2.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        /* LoaderGrid definitions for reference */
        .loader-grid-container .beforeEl,
        .loader-grid-container .afterEl {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          display: block;
          width: 0.5em;
          height: 0.5em;
          border-radius: 0.25em;
          transform: translate(-50%, -50%);
        }

        .loader-grid-container .beforeEl {
          animation: loaderGridBefore 2s infinite ease-in-out;
        }

        .loader-grid-container .afterEl {
          animation: loaderGridAfter 2s infinite ease-in-out;
        }

        @keyframes loaderGridBefore {
          0% {
            width: 0.5em;
            box-shadow: 1em -0.5em rgba(3, 47, 40, 0.85), -1em 0.5em rgba(4, 120, 87, 0.9);
          }
          35% {
            width: 2.5em;
            box-shadow: 0 -0.5em rgba(3, 47, 40, 0.85), 0 0.5em rgba(4, 120, 87, 0.9);
          }
          70% {
            width: 0.5em;
            box-shadow: -1em -0.5em rgba(3, 47, 40, 0.85), 1em 0.5em rgba(4, 120, 87, 0.9);
          }
          100% {
            box-shadow: 1em -0.5em rgba(3, 47, 40, 0.85), -1em 0.5em rgba(4, 120, 87, 0.9);
          }
        }

        @keyframes loaderGridAfter {
          0% {
            height: 0.5em;
            box-shadow: 0.5em 1em rgba(16, 185, 129, 0.9), -0.5em -1em rgba(6, 78, 59, 0.85);
          }
          35% {
            height: 2.5em;
            box-shadow: 0.5em 0 rgba(16, 185, 129, 0.9), -0.5em 0 rgba(6, 78, 59, 0.85);
          }
          70% {
            height: 0.5em;
            box-shadow: 0.5em -1em rgba(16, 185, 129, 0.9), -0.5em 1em rgba(6, 78, 59, 0.85);
          }
          100% {
            box-shadow: 0.5em 1em rgba(16, 185, 129, 0.9), -0.5em -1em rgba(6, 78, 59, 0.85);
          }
        }
      `}</style>
    </div>
  );
}
