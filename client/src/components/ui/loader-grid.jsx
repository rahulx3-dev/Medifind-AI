import React from 'react';

/**
 * LoaderGrid Component
 * Animated grid loader with rotating container (165deg) and expanding dual orbital box-shadow elements.
 */
export const LoaderGrid = ({ className = '', style = {} }) => {
  return (
    <div
      className={`relative w-[2.5em] h-[2.5em] rotate-[165deg] ${className}`.trim()}
      style={style}
    >
      <span className="beforeEl" />
      <span className="afterEl" />
    </div>
  );
};

export default LoaderGrid;

// Demo export matching specification
export function DemoOne() {
  return <LoaderGrid />;
}

/**
 * AppLoadingScreen
 * Full-screen preloader screen on Barba background (#A5D6A7) featuring LoaderGrid shape and motion.
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
        {/* Animated LoaderGrid Stage */}
        <div className="relative flex items-center justify-center p-8 text-[36px] sm:text-[40px]">
          <LoaderGrid />
        </div>

        {/* Brand Typography & Status in Dark Spruce */}
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

      {/* Scoped CSS for LoaderGrid shape & motion */}
      <style>{`
        .beforeEl,
        .afterEl {
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

        .beforeEl {
          animation: before8 2s infinite ease-in-out;
        }

        .afterEl {
          animation: after6 2s infinite ease-in-out;
        }

        @keyframes before8 {
          0% {
            width: 0.5em;
            box-shadow: 1em -0.5em rgba(225, 20, 98, 0.75), -1em 0.5em rgba(111, 202, 220, 0.75);
          }
          35% {
            width: 2.5em;
            box-shadow: 0 -0.5em rgba(225, 20, 98, 0.75), 0 0.5em rgba(111, 202, 220, 0.75);
          }
          70% {
            width: 0.5em;
            box-shadow: -1em -0.5em rgba(225, 20, 98, 0.75), 1em 0.5em rgba(111, 202, 220, 0.75);
          }
          100% {
            box-shadow: 1em -0.5em rgba(225, 20, 98, 0.75), -1em 0.5em rgba(111, 202, 220, 0.75);
          }
        }

        @keyframes after6 {
          0% {
            height: 0.5em;
            box-shadow: 0.5em 1em rgba(61, 184, 143, 0.75), -0.5em -1em rgba(233, 169, 32, 0.75);
          }
          35% {
            height: 2.5em;
            box-shadow: 0.5em 0 rgba(61, 184, 143, 0.75), -0.5em 0 rgba(233, 169, 32, 0.75);
          }
          70% {
            height: 0.5em;
            box-shadow: 0.5em -1em rgba(61, 184, 143, 0.75), -0.5em 1em rgba(233, 169, 32, 0.75);
          }
          100% {
            box-shadow: 0.5em 1em rgba(61, 184, 143, 0.75), -0.5em -1em rgba(233, 169, 32, 0.75);
          }
        }
      `}</style>
    </div>
  );
}
