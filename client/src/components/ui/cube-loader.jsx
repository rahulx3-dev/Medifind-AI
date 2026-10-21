import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

const LOADING_MESSAGES = [
  'Loading...',
  'Loading portal...',
  'Loading data...',
  'Loading network...'
];

export default function CubeLoader({ className = '' }) {
  const [index, setIndex] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
        setFade(true);
      }, 300);
    }, 2200);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className={cn('relative z-10 flex flex-col items-center justify-center p-4 select-none', className)}>
      {/* 3D Perspective Scene - Pure Cube without any background card */}
      <div className="cube-perspective-container relative w-36 h-36 flex items-center justify-center">
        
        {/* The 3D Rotating & Breathing Cube Assembly */}
        <div className="relative w-20 h-20 cube-preserve-3d animate-cube-spin">
          
          {/* Internal Glowing Luminous Core in Fresh Radiant Green */}
          <div className="absolute inset-0 m-auto w-6 h-6 bg-[#86efac] rounded-full blur-xs shadow-[0_0_35px_rgba(34,197,94,0.95),0_0_18px_rgba(74,222,128,0.9)] animate-cube-pulse-fast pointer-events-none" />

          {/* 6 Cube Faces (Front, Back, Right, Left, Top, Bottom) in Fresh Vibrant Green */}
          {/* Front Face */}
          <div className="absolute inset-0 m-auto w-20 h-20 cube-preserve-3d" style={{ transform: 'rotateY(0deg)' }}>
            <div className="w-full h-full rounded-2xl bg-gradient-to-br from-[#22c55e]/25 to-[#16a34a]/30 border-2 border-[#22c55e] shadow-[0_0_24px_rgba(34,197,94,0.5)] backdrop-blur-xs flex items-center justify-center animate-cube-breathe">
              <div className="w-6 h-6 rounded-lg border-1.5 border-[#4ade80] bg-[#22c55e]/25 shadow-[inset_0_0_8px_rgba(74,222,128,0.4)]" />
            </div>
          </div>

          {/* Back Face */}
          <div className="absolute inset-0 m-auto w-20 h-20 cube-preserve-3d" style={{ transform: 'rotateY(180deg)' }}>
            <div className="w-full h-full rounded-2xl bg-gradient-to-br from-[#22c55e]/25 to-[#16a34a]/30 border-2 border-[#22c55e] shadow-[0_0_24px_rgba(34,197,94,0.5)] backdrop-blur-xs flex items-center justify-center animate-cube-breathe">
              <div className="w-6 h-6 rounded-lg border-1.5 border-[#4ade80] bg-[#22c55e]/25 shadow-[inset_0_0_8px_rgba(74,222,128,0.4)]" />
            </div>
          </div>

          {/* Right Face */}
          <div className="absolute inset-0 m-auto w-20 h-20 cube-preserve-3d" style={{ transform: 'rotateY(90deg)' }}>
            <div className="w-full h-full rounded-2xl bg-gradient-to-br from-[#22c55e]/25 to-[#16a34a]/30 border-2 border-[#22c55e] shadow-[0_0_24px_rgba(34,197,94,0.5)] backdrop-blur-xs flex items-center justify-center animate-cube-breathe">
              <div className="w-6 h-6 rounded-lg border-1.5 border-[#4ade80] bg-[#22c55e]/25 shadow-[inset_0_0_8px_rgba(74,222,128,0.4)]" />
            </div>
          </div>

          {/* Left Face */}
          <div className="absolute inset-0 m-auto w-20 h-20 cube-preserve-3d" style={{ transform: 'rotateY(-90deg)' }}>
            <div className="w-full h-full rounded-2xl bg-gradient-to-br from-[#22c55e]/25 to-[#16a34a]/30 border-2 border-[#22c55e] shadow-[0_0_24px_rgba(34,197,94,0.5)] backdrop-blur-xs flex items-center justify-center animate-cube-breathe">
              <div className="w-6 h-6 rounded-lg border-1.5 border-[#4ade80] bg-[#22c55e]/25 shadow-[inset_0_0_8px_rgba(74,222,128,0.4)]" />
            </div>
          </div>

          {/* Top Face */}
          <div className="absolute inset-0 m-auto w-20 h-20 cube-preserve-3d" style={{ transform: 'rotateX(90deg)' }}>
            <div className="w-full h-full rounded-2xl bg-gradient-to-br from-[#22c55e]/25 to-[#16a34a]/30 border-2 border-[#22c55e] shadow-[0_0_24px_rgba(34,197,94,0.5)] backdrop-blur-xs flex items-center justify-center animate-cube-breathe">
              <div className="w-6 h-6 rounded-lg border-1.5 border-[#4ade80] bg-[#22c55e]/25 shadow-[inset_0_0_8px_rgba(74,222,128,0.4)]" />
            </div>
          </div>

          {/* Bottom Face */}
          <div className="absolute inset-0 m-auto w-20 h-20 cube-preserve-3d" style={{ transform: 'rotateX(-90deg)' }}>
            <div className="w-full h-full rounded-2xl bg-gradient-to-br from-[#22c55e]/25 to-[#16a34a]/30 border-2 border-[#22c55e] shadow-[0_0_24px_rgba(34,197,94,0.5)] backdrop-blur-xs flex items-center justify-center animate-cube-breathe">
              <div className="w-6 h-6 rounded-lg border-1.5 border-[#4ade80] bg-[#22c55e]/25 shadow-[inset_0_0_8px_rgba(74,222,128,0.4)]" />
            </div>
          </div>
        </div>

        {/* Dynamic Floor Shadow Breathing underneath the 3D Cube */}
        <div className="absolute -bottom-10 w-28 h-6 bg-[#16a34a]/25 blur-lg rounded-[100%] animate-cube-shadow-breathe pointer-events-none" />
      </div>

      {/* Dynamic Animated Loading Text with Blinking / Breathing Animation */}
      <div className="mt-8 flex items-center gap-2.5 px-4 py-1.5 select-none">
        <span className="w-2.5 h-2.5 rounded-full bg-[#16a34a] shadow-[0_0_12px_#22c55e] animate-ping shrink-0" />
        <span
          className={cn(
            'text-sm font-bold tracking-widest uppercase text-[#14532d] animate-pulse transition-all duration-300 transform',
            fade ? 'opacity-100 translate-y-0' : 'opacity-30 translate-y-0.5'
          )}
          style={{ letterSpacing: '0.14em' }}
        >
          {LOADING_MESSAGES[index]}
        </span>
      </div>

      {/* Scoped CSS for 3D Geometry and Keyframes */}
      <style>{`
        .cube-perspective-container {
          perspective: 1200px;
        }

        .cube-preserve-3d {
          transform-style: preserve-3d;
        }

        @keyframes cubeSpin {
          0% { transform: rotateX(0deg) rotateY(0deg); }
          100% { transform: rotateX(360deg) rotateY(360deg); }
        }

        @keyframes cubeBreathe {
          0%, 100% { transform: translateZ(48px); opacity: 0.92; }
          50% { transform: translateZ(74px); opacity: 0.55; }
        }

        @keyframes cubePulseFast {
          0%, 100% { transform: scale(0.85); opacity: 0.75; }
          50% { transform: scale(1.35); opacity: 1; }
        }

        @keyframes cubeShadowBreathe {
          0%, 100% { transform: scale(1); opacity: 0.45; }
          50% { transform: scale(1.4); opacity: 0.2; }
        }

        .animate-cube-spin {
          animation: cubeSpin 8s linear infinite;
        }

        .animate-cube-breathe {
          animation: cubeBreathe 3s ease-in-out infinite;
        }

        .animate-cube-pulse-fast {
          animation: cubePulseFast 2s ease-in-out infinite;
        }

        .animate-cube-shadow-breathe {
          animation: cubeShadowBreathe 3s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
