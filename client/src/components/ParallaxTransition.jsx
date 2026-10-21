import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import mapHeroImg from '../assets/map_hero_bg.jpg';

/**
 * ParallaxTransition — Hero-to-Portal Transit Bridge (Hero 2)
 *
 * Features:
 * - Smooth entrance animations: fade + slide-up from 50px below
 * - All elements start invisible (opacity:0) and animate in on scroll
 * - Staggered reveal: map → badge → heading → subtitle → buttons → stats → pin
 * - Parallax depth scrubbing for depth effect while scrolling through
 */
export default function ParallaxTransition({ onProceed, onBack }) {
  const parallaxRef = useRef(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    gsap.registerPlugin(ScrollTrigger);

    const container = parallaxRef.current;
    if (!container) return;

    const triggerElement = container.querySelector('[data-parallax-layers]');

    // --- Set initial hidden state on all animated elements ---
    const mapVisual   = container.querySelector('.hero2-map-visual');
    const textItems   = container.querySelectorAll('.hero2-animate-item');
    const pinBadge    = container.querySelector('.hero2-pin-badge');

    if (!prefersReducedMotion) {
      if (mapVisual) gsap.set(mapVisual, { opacity: 0, x: 60, scale: 0.93 });
      if (textItems.length) gsap.set(textItems, { opacity: 0, y: 50 });
      if (pinBadge)   gsap.set(pinBadge, { opacity: 0, scale: 0.7, y: -18 });
    }

    // --- Entrance timeline — fires when section top crosses 85% viewport ---
    const entranceTl = gsap.timeline({
      scrollTrigger: {
        trigger: container,
        start: 'top 85%',          // fires early so animation is fully done when user arrives
        toggleActions: 'play none none reset',
        once: false                 // re-plays if user scrolls back up
      },
      paused: !!prefersReducedMotion
    });

    if (!prefersReducedMotion) {
      // 1. Map image slides in from the right
      if (mapVisual) {
        entranceTl.to(mapVisual, {
          opacity: 1, x: 0, scale: 1,
          duration: 1.1, ease: 'power3.out'
        }, 0);
      }

      // 2. Text items stagger up from below
      if (textItems.length) {
        entranceTl.to(textItems, {
          opacity: 1, y: 0,
          duration: 0.85,
          stagger: 0.11,
          ease: 'power3.out'
        }, 0.25);           // starts 0.25s after map begins
      }

      // 3. Pin badge pops in with spring
      if (pinBadge) {
        entranceTl.to(pinBadge, {
          opacity: 1, scale: 1, y: 0,
          duration: 0.75, ease: 'back.out(1.7)'
        }, 0.55);
      }
    } else {
      // Reduced motion: just make everything visible immediately
      if (mapVisual) gsap.set(mapVisual, { opacity: 1, x: 0, scale: 1 });
      if (textItems.length) gsap.set(textItems, { opacity: 1, y: 0 });
      if (pinBadge) gsap.set(pinBadge, { opacity: 1, scale: 1, y: 0 });
    }

    // --- Parallax depth scrubbing ---
    let scrubTl = null;
    if (triggerElement && !prefersReducedMotion) {
      scrubTl = gsap.timeline({
        scrollTrigger: {
          trigger: triggerElement,
          start: 'top top',
          end: 'bottom top',
          scrub: 0.6
        }
      });

      const layers = [
        { layer: '1', yPercent: 28 },
        { layer: '2', yPercent: 14 },
        { layer: '3', yPercent: -10 },
        { layer: '4', yPercent: -22 }
      ];

      layers.forEach((layerObj, idx) => {
        const els = triggerElement.querySelectorAll(`[data-parallax-layer="${layerObj.layer}"]`);
        if (els.length > 0) {
          scrubTl.to(els, { yPercent: layerObj.yPercent, ease: 'none' }, idx === 0 ? undefined : '<');
        }
      });
    }

    return () => {
      entranceTl.kill();
      if (scrubTl) scrubTl.kill();
      ScrollTrigger.getAll().forEach((st) => {
        if (st.vars.trigger === container || st.vars.trigger === triggerElement) st.kill();
      });
      gsap.killTweensOf([container, mapVisual, ...Array.from(textItems), pinBadge].filter(Boolean));
    };
  }, []);

  return (
    <div
      ref={parallaxRef}
      className="parallax-container relative w-full overflow-hidden select-none"
      style={{
        background: '#0d1117',
        minHeight: '100vh',
        color: '#ffffff'
      }}
    >
      <section className="relative w-full min-h-[100vh] flex flex-col justify-center overflow-hidden">
        {/* Top Boundary Line */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent z-20" />

        {/* Parallax Layers Container */}
        <div data-parallax-layers className="relative w-full min-h-[100vh] flex items-center justify-center">
          
          {/* Layer 1: Ambient Background & Subtle Depth Matrix */}
          <div
            data-parallax-layer="1"
            className="absolute inset-0 pointer-events-none z-0"
            style={{
              background: 'radial-gradient(circle at 65% 45%, #15222e 0%, #0d121a 45%, #080b0f 100%)'
            }}
          >
            {/* Ambient Radial Spotlight matching map table glow */}
            <div
              className="absolute top-1/2 right-[15%] -translate-y-1/2 w-[700px] h-[550px] rounded-full pointer-events-none opacity-40 blur-[100px]"
              style={{
                background: 'radial-gradient(circle, rgba(16, 185, 129, 0.15) 0%, rgba(239, 68, 68, 0.08) 50%, transparent 80%)'
              }}
            />

            {/* Subtle tech coordinate grid */}
            <div
              className="absolute inset-0 opacity-[0.04]"
              style={{
                backgroundImage: 'linear-gradient(rgba(255,255,255,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.2) 1px, transparent 1px)',
                backgroundSize: '48px 48px'
              }}
            />
          </div>

          {/* Layer 2: 3D Folded Map & Red Pin Marker Visual */}
          <div
            data-parallax-layer="2"
            className="absolute inset-0 flex items-center justify-end z-1 pointer-events-none overflow-hidden"
          >
            <div className="relative w-full h-full max-w-[1400px] mx-auto flex items-center justify-end pr-0 lg:pr-6">
              <div className="hero2-map-visual relative w-full lg:w-[65%] h-[80vh] flex items-center justify-center will-change-transform">
                {/* 3D Map Image */}
                <img
                  src={mapHeroImg}
                  alt="MediFind AI 3D Interactive Map Routing"
                  className="w-full h-full object-cover lg:object-contain object-right drop-shadow-2xl"
                  style={{
                    filter: 'contrast(1.04) brightness(0.98)',
                    maskImage: 'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.4) 15%, black 40%)',
                    WebkitMaskImage: 'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.4) 15%, black 40%)'
                  }}
                />

                {/* Ambient pin beacon glow animation */}
                <div
                  className="absolute right-[28%] top-[34%] w-6 h-6 rounded-full bg-red-500/20 animate-ping pointer-events-none"
                  style={{ animationDuration: '3s' }}
                />
              </div>
            </div>
          </div>

          {/* Layer 3: Left Typography & Interactive Card (Replacing reference image text) */}
          <div
            data-parallax-layer="3"
            className="relative z-10 w-full max-w-7xl mx-auto px-6 sm:px-10 lg:px-16 py-20 pointer-events-auto"
          >
            <div className="max-w-xl flex flex-col items-start text-left">
              
              {/* Category Badge */}
              <div className="hero2-animate-item inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/5 border border-emerald-400/30 backdrop-blur-md text-emerald-300 text-xs font-mono font-semibold tracking-wider uppercase mb-6 shadow-sm">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Clinical Medicine Transit</span>
              </div>

              {/* Main Heading — Replaces "Map" with MediFind AI */}
              <h1 className="hero2-animate-item text-5xl sm:text-6xl lg:text-7xl font-extrabold text-white tracking-tight leading-[1.05] mb-5 font-['Plus_Jakarta_Sans',sans-serif]">
                MediFind <span className="text-emerald-400">AI</span>
              </h1>

              {/* Subtitle — Kerala relay & pharmacy networks */}
              <p className="hero2-animate-item text-base sm:text-lg text-slate-300 font-normal leading-relaxed max-w-md mb-8">
                Bridging emergency medicine relays and verified pharmacy networks across Kerala with real-time transit routing.
              </p>

              {/* Action Buttons */}
              <div className="hero2-animate-item flex flex-wrap items-center gap-3">
                {onBack && (
                  <button
                    type="button"
                    onClick={onBack}
                    className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/25 text-white font-medium text-sm backdrop-blur-md transition-all active:scale-95 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-base">arrow_back</span>
                    <span>Back to 3D Globe</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={onProceed}
                  className="group inline-flex items-center gap-2.5 px-6 py-3 rounded-xl bg-[#10b981] hover:bg-[#059669] text-white font-bold text-sm shadow-lg hover:shadow-emerald-500/20 transition-all duration-200 active:scale-95 cursor-pointer"
                >
                  <span>Sign In / Enter Portal</span>
                  <span className="material-symbols-outlined text-lg transition-transform group-hover:translate-x-1">
                    arrow_forward
                  </span>
                </button>

                <div className="flex items-center gap-2 text-xs font-mono text-emerald-400/80 bg-emerald-950/40 px-3 py-2 rounded-lg border border-emerald-500/20">
                  <span className="material-symbols-outlined text-sm text-emerald-400">my_location</span>
                  <span>GPS Transit Active</span>
                </div>
              </div>

              {/* Key Value Regional Metrics */}
              <div className="hero2-animate-item grid grid-cols-2 gap-4 mt-10 pt-6 border-t border-white/10 w-full max-w-md">
                <div className="flex flex-col">
                  <span className="text-2xl font-bold text-white font-mono">50+</span>
                  <span className="text-xs text-slate-400">Verified Medicines</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-2xl font-bold text-emerald-400 font-mono">24/7</span>
                  <span className="text-xs text-slate-400">Emergency Access</span>
                </div>
              </div>

            </div>
          </div>

          {/* Layer 4: Floating Pin Regional Map Badge */}
          <div
            data-parallax-layer="4"
            className="absolute inset-0 pointer-events-none z-15 hidden lg:block"
          >
            {/* Kerala Geo Pin marker indicator overlay */}
            <div
              className="hero2-pin-badge absolute right-[22%] top-[24%] bg-black/60 backdrop-blur-md border border-white/15 px-3 py-1.5 rounded-lg shadow-xl text-left will-change-transform"
              style={{ transform: 'rotate(-2deg)' }}
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                <span className="text-[11px] font-mono font-bold text-white">CHENGANNUR_HUB_01</span>
              </div>
              <p className="text-[9px] font-mono text-emerald-300/80 mt-0.5">LAT 9.3176° N • LON 76.6129° E</p>
            </div>
          </div>

        </div>

        {/* Bottom Smooth Fade into Background */}
        <div
          className="absolute bottom-0 left-0 right-0 h-28 pointer-events-none z-20"
          style={{
            background: 'linear-gradient(to bottom, transparent 0%, rgba(1, 26, 21, 0.7) 60%, #011a15 100%)'
          }}
        />

        {/* Return to Globe Navigation Anchor */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex flex-col items-center gap-1 text-slate-400 hover:text-emerald-300 transition-colors text-xs font-medium cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">
                keyboard_arrow_up
              </span>
              <span>Back to 3D Globe</span>
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
