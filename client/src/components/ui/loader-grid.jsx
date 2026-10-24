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
 * Full-screen preloader screen on Patient Home background (#ecfdf7) featuring LoaderGrid shape and motion.
 */
export function AppLoadingScreen() {
  return (
    <div
      className="fixed inset-0 w-screen h-screen flex flex-col items-center justify-center select-none overflow-hidden z-[9999]"
      style={{
        backgroundColor: '#ecfdf7',
        background: 'radial-gradient(circle at 50% 50%, #ffffff 0%, #ecfdf7 65%, #d8f5ea 100%)'
      }}
    >
      {/* Soft ambient light diffusion */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[360px] h-[360px] bg-white/40 rounded-full blur-3xl pointer-events-none" />

      {/* Main Center Stage */}
      <div className="relative z-10 flex items-center justify-center p-8 text-[36px] sm:text-[42px]">
        <LoaderGrid />
      </div>

      {/* Scoped CSS for LoaderGrid shape & motion with light pastel bar colors */}
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
            box-shadow: 1em -0.5em rgba(244, 114, 182, 0.85), -1em 0.5em rgba(125, 211, 252, 0.85);
          }
          35% {
            width: 2.5em;
            box-shadow: 0 -0.5em rgba(244, 114, 182, 0.85), 0 0.5em rgba(125, 211, 252, 0.85);
          }
          70% {
            width: 0.5em;
            box-shadow: -1em -0.5em rgba(244, 114, 182, 0.85), 1em 0.5em rgba(125, 211, 252, 0.85);
          }
          100% {
            box-shadow: 1em -0.5em rgba(244, 114, 182, 0.85), -1em 0.5em rgba(125, 211, 252, 0.85);
          }
        }

        @keyframes after6 {
          0% {
            height: 0.5em;
            box-shadow: 0.5em 1em rgba(110, 231, 183, 0.85), -0.5em -1em rgba(253, 224, 71, 0.85);
          }
          35% {
            height: 2.5em;
            box-shadow: 0.5em 0 rgba(110, 231, 183, 0.85), -0.5em 0 rgba(253, 224, 71, 0.85);
          }
          70% {
            height: 0.5em;
            box-shadow: 0.5em -1em rgba(110, 231, 183, 0.85), -0.5em 1em rgba(253, 224, 71, 0.85);
          }
          100% {
            box-shadow: 0.5em 1em rgba(110, 231, 183, 0.85), -0.5em -1em rgba(253, 224, 71, 0.85);
          }
        }
      `}</style>
    </div>
  );
}
