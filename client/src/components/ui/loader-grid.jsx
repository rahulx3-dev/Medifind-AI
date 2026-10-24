import React from 'react';
import logoImg from '../../assets/medifind_logo.png';

/**
 * LoaderGrid Component
 * High-performance, lightweight geometric loader rotating at 165deg
 * with dual opposing orbital expansion beams (beforeEl and afterEl).
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

// Demo component as provided in reference specification
export function DemoOne() {
  return <LoaderGrid />;
}

/**
 * AppLoadingScreen
 * Full-screen preloader screen utilizing the exact Barba slider background color (#A5D6A7),
 * integrating the canonical MediFind AI logo with motion reflecting its core meaning:
 * - Upward diagonal trajectory surge along the 45° arrow vector (locating medicines rapidly)
 * - Concentric clinical beacon pulse around the medical cross (healing and dispensary network)
 * - The LoaderGrid weaving orbital beams in synchronized clinical emerald & deep spruce hues.
 */
export function AppLoadingScreen({ message = 'Locating Clinical Network...' }) {
  return (
    <div
      className="fixed inset-0 w-screen h-screen flex flex-col items-center justify-center select-none overflow-hidden z-[9999]"
      style={{
        backgroundColor: '#A5D6A7',
        background: 'radial-gradient(circle at 50% 48%, rgba(255, 255, 255, 0.45) 0%, #A5D6A7 68%, #8bc38f 100%)'
      }}
    >
      {/* Ambient soft glow layer */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] h-[420px] bg-white/20 rounded-full blur-3xl pointer-events-none" />

      {/* Main Center Stage */}
      <div className="relative z-10 flex flex-col items-center justify-center">
        {/* Logo and Loader Grid Assembly */}
        <div className="relative w-44 h-44 flex items-center justify-center">
          {/* Concentric Clinical Beacon Pulse Rings (Cross sanctuary meaning) */}
          <div className="absolute inset-0 m-auto w-32 h-32 rounded-full border-2 border-[#166534]/20 animate-beacon-ring pointer-events-none" />
          <div className="absolute inset-0 m-auto w-32 h-32 rounded-full border border-[#047857]/30 animate-beacon-ring-delayed pointer-events-none" />

          {/* Canonical App Logo with arrow-aligned upward surging motion */}
          <div className="relative z-20 flex items-center justify-center animate-logo-arrow-surge">
            <img
              src={logoImg}
              alt="MediFind AI Logo"
              className="w-24 h-24 object-contain filter drop-shadow-[0_8px_20px_rgba(3,47,40,0.22)]"
            />

            {/* Diagonal Gleam Sweep traversing the Arrow's upward trajectory */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-full animate-arrow-gleam">
              <div className="w-16 h-32 bg-gradient-to-r from-transparent via-white/40 to-transparent -rotate-45 translate-x-[-120%] animate-gleam-slide" />
            </div>
          </div>

          {/* LoaderGrid Orbital Geometry framing the emblem */}
          <div className="absolute inset-0 m-auto flex items-center justify-center pointer-events-none text-[34px]">
            <LoaderGrid />
          </div>
        </div>

        {/* Brand Typography & Real-Time Status in Dark Spruce */}
        <div className="mt-6 flex flex-col items-center text-center space-y-1.5">
          <div className="flex items-center justify-center gap-1.5 font-['Plus_Jakarta_Sans',sans-serif]">
            <span className="text-xl sm:text-2xl font-black text-[#032f28] tracking-tight">
              MediFind
            </span>
            <span className="text-xl sm:text-2xl font-black text-[#065f46] tracking-tight">
              AI
            </span>
          </div>

          {/* Status Message with Pulsing Active Signal */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white/40 backdrop-blur-md border border-white/60 shadow-xs">
            <span className="w-2 h-2 rounded-full bg-[#047857] animate-ping" />
            <span className="text-xs font-bold uppercase tracking-wider text-[#032f28]/90">
              {message}
            </span>
          </div>
        </div>
      </div>

      {/* Scoped CSS for LoaderGrid, Logo Trajectory Motion & Keyframes */}
      <style>{`
        /* LoaderGrid beforeEl and afterEl definitions */
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

        /* Meaning-Aligned Logo Motion: Dynamic Upward Surge along the 45deg Arrow Vector */
        @keyframes logoArrowSurge {
          0%, 100% {
            transform: translate(0, 0) scale(1);
          }
          50% {
            transform: translate(3px, -5px) scale(1.05);
          }
        }

        .animate-logo-arrow-surge {
          animation: logoArrowSurge 2.4s ease-in-out infinite;
        }

        /* Concentric Clinical Beacon Pulse Rings */
        @keyframes beaconRing {
          0% {
            transform: scale(0.8);
            opacity: 0.8;
          }
          50% {
            transform: scale(1.25);
            opacity: 0.3;
          }
          100% {
            transform: scale(1.6);
            opacity: 0;
          }
        }

        .animate-beacon-ring {
          animation: beaconRing 2.4s cubic-bezier(0.2, 0.8, 0.2, 1) infinite;
        }

        .animate-beacon-ring-delayed {
          animation: beaconRing 2.4s cubic-bezier(0.2, 0.8, 0.2, 1) infinite 1.2s;
        }

        /* Diagonal Gleam Sweep traversing the Arrow */
        @keyframes gleamSlide {
          0%, 25% {
            transform: translateX(-150%) rotate(45deg);
            opacity: 0;
          }
          50% {
            opacity: 0.8;
          }
          75%, 100% {
            transform: translateX(180%) rotate(45deg);
            opacity: 0;
          }
        }

        .animate-gleam-slide {
          animation: gleamSlide 2.4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
