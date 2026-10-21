"use client";

import React, { useRef, useEffect } from "react";
import * as THREE from "three";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

// --- Shader Code ---
const vertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uColor1;
uniform vec3 uColor2;
varying vec2 vUv;

vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
           -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
  + i.x + vec3(0.0, i1.x, 1.0 ));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m ;
  m = m*m ;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float bayerDither4x4(vec2 uv) {
    int x = int(mod(uv.x, 4.0));
    int y = int(mod(uv.y, 4.0));
    int idx = y * 4 + x;
    
    // Constant lookup compatible with both WebGL 1.0 and WebGL 2.0
    if (idx == 0) return 0.0;
    if (idx == 1) return 8.0 / 16.0;
    if (idx == 2) return 2.0 / 16.0;
    if (idx == 3) return 10.0 / 16.0;
    if (idx == 4) return 12.0 / 16.0;
    if (idx == 5) return 4.0 / 16.0;
    if (idx == 6) return 14.0 / 16.0;
    if (idx == 7) return 6.0 / 16.0;
    if (idx == 8) return 3.0 / 16.0;
    if (idx == 9) return 11.0 / 16.0;
    if (idx == 10) return 1.0 / 16.0;
    if (idx == 11) return 9.0 / 16.0;
    if (idx == 12) return 15.0 / 16.0;
    if (idx == 13) return 7.0 / 16.0;
    if (idx == 14) return 13.0 / 16.0;
    return 5.0 / 16.0;
}

void main() {
    vec2 uv = vUv;
    vec2 coord = gl_FragCoord.xy;
    
    // Enhanced noise with time
    float noise = snoise(uv * 1.5 + vec2(uTime * 0.05, uTime * 0.03)) * 0.25;
    
    // Diagonal gradient from bottom-left to top-right
    float diagonal = (uv.x + uv.y) * 0.5;
    
    // Combine for gradient - emphasize corners
    float gradient = diagonal * 1.2 + noise;
    
    // Interpolate colors based on gradient
    vec3 deepBlue = uColor1;
    vec3 paleBlue = uColor2;
    vec3 softBlue = mix(deepBlue, paleBlue, 0.33);
    vec3 lightBlue = mix(deepBlue, paleBlue, 0.66);
    
    // Map to colors with more distinct steps
    vec3 color;
    if (gradient < 0.3) {
        color = deepBlue;
    } else if (gradient < 0.55) {
        color = softBlue;
    } else if (gradient < 0.8) {
        color = lightBlue;
    } else {
        color = paleBlue;
    }
    
    // Enhanced dithering at boundaries
    float dither = bayerDither4x4(coord);
    float threshold = fract(gradient * 4.0);
    
    if (gradient < 0.3 && threshold > dither * 0.5) {
        color = softBlue;
    } else if (gradient >= 0.3 && gradient < 0.55 && threshold > dither * 0.5) {
        color = lightBlue;
    } else if (gradient >= 0.55 && gradient < 0.8 && threshold > dither * 0.5) {
        color = paleBlue;
    }
    
    // Softer fade to white - only at extreme bottom-left
    vec2 cornerDist = vec2(uv.x, uv.y);
    float fadeMask = smoothstep(0.0, 0.25, length(cornerDist));
    color = mix(vec3(1.0), color, fadeMask);
    
    // Add subtle vignette to emphasize corners
    float vignette = smoothstep(1.2, 0.3, length(uv - 0.5));
    color = mix(color, color * 0.95, (1.0 - vignette) * 0.3);
    
    gl_FragColor = vec4(color, 1.0);
}
`;

// MediFind AI Clinical Theme Defaults:
// color1: Deep Pine / Forest Emerald (#032f28)
// color2: Pale Clinical Mint (#e8f8f2)
export const THEME_COLOR_PRIMARY = "#032f28";
export const THEME_COLOR_SECONDARY = "#e8f8f2";
const HEX_COLOR_REGEX = /^#?[0-9a-fA-F]{6}$/;

function sanitizeHexColor(value, fallback) {
  if (!value || typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!HEX_COLOR_REGEX.test(trimmed)) return fallback;
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

/**
 * Pure Three.js Canvas implementation of the Hero Geometric gradient shader plane
 */
export function HeroGeometricBackground({
  color1 = THEME_COLOR_PRIMARY,
  color2 = THEME_COLOR_SECONDARY,
  speed = 1,
  className = ""
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: true,
        powerPreference: "high-performance"
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    } catch (e) {
      console.warn("HeroGeometric WebGL init warning:", e);
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2);

    const safeColor1 = sanitizeHexColor(color1, THEME_COLOR_PRIMARY);
    const safeColor2 = sanitizeHexColor(color2, THEME_COLOR_SECONDARY);

    const uniforms = {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1000, 1000) },
      uColor1: { value: new THREE.Color(safeColor1) },
      uColor2: { value: new THREE.Color(safeColor2) }
    };

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const clock = new THREE.Clock();
    let animationFrameId;
    let isRunning = true;

    const handleResize = () => {
      if (!canvas || !renderer) return;
      const parent = canvas.parentElement;
      const width = parent ? parent.clientWidth : window.innerWidth;
      const height = parent ? parent.clientHeight : window.innerHeight;
      renderer.setSize(width, height, false);
      uniforms.uResolution.value.set(width, height);
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    let isVisible = true;
    let isTabActive = !document.hidden;

    const observer = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(([entry]) => {
          isVisible = entry.isIntersecting;
        }, { threshold: 0.05 })
      : null;
    if (observer && canvas) observer.observe(canvas);

    const handleVisibility = () => {
      isTabActive = !document.hidden;
    };
    document.addEventListener("visibilitychange", handleVisibility);

    const animate = () => {
      if (!isRunning) return;
      animationFrameId = requestAnimationFrame(animate);
      if (!isVisible || !isTabActive) return;

      uniforms.uTime.value = clock.getElapsedTime() * speed;
      renderer.render(scene, camera);
    };

    animate();

    return () => {
      isRunning = false;
      cancelAnimationFrame(animationFrameId);
      if (observer) observer.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("resize", handleResize);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [color1, color2, speed]);

  return (
    <div className={cn("absolute inset-0 pointer-events-none overflow-hidden", className)}>
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}

const HERO_HEADLINE_CLASS =
  "pb-[0.08em] text-[12cqi] md:text-[8cqi] lg:text-[6cqi] leading-[0.96] tracking-tighter font-bold text-zinc-900";

/**
 * HeroGeometric component supporting title1, title2, description, and children
 */
export default function HeroGeometric({
  title1,
  title2,
  description,
  color1 = THEME_COLOR_PRIMARY,
  color2 = THEME_COLOR_SECONDARY,
  speed = 1,
  className,
  children,
  ...props
}) {
  return (
    <div
      className={cn(
        "relative w-full min-h-screen flex flex-col items-center overflow-hidden bg-white text-black",
        className
      )}
      style={{
        containerType: "size",
        ...props.style
      }}
      {...props}
    >
      {/* Background Shader */}
      <HeroGeometricBackground color1={color1} color2={color2} speed={speed} />

      {/* Optional Headline Content */}
      {(title1 || title2 || description) && (
        <div className="relative z-10 w-full flex-1 flex flex-col items-center justify-center pt-8 pb-8 md:pt-20 md:pb-20">
          <div className="w-full max-w-[1200px] px-6 flex flex-col items-center">
            {/* Headline */}
            <div className="flex flex-col items-center text-center gap-2 md:gap-4 mb-8 md:mb-12">
              {title1 && (
                <div className="overflow-hidden">
                  <motion.h1
                    initial={{ y: "100%", opacity: 0 }}
                    animate={{ y: "0%", opacity: 1 }}
                    transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
                    className={HERO_HEADLINE_CLASS}
                  >
                    {title1}
                  </motion.h1>
                </div>
              )}
              {title2 && (
                <div className="overflow-hidden">
                  <motion.h1
                    initial={{ y: "100%", opacity: 0 }}
                    animate={{ y: "0%", opacity: 1 }}
                    transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.35 }}
                    className={HERO_HEADLINE_CLASS}
                  >
                    {title2}
                  </motion.h1>
                </div>
              )}
            </div>

            {/* Subheadline */}
            {description && (
              <div className="max-w-[480px] text-center mb-8">
                <motion.p
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, delay: 0.6, ease: "easeOut" }}
                  className="text-lg md:text-[1.35rem] leading-relaxed text-neutral-600 font-normal"
                >
                  {description}
                </motion.p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Children elements (e.g. Auth cards, forms, etc.) */}
      {children && <div className="relative z-10 w-full">{children}</div>}
    </div>
  );
}
