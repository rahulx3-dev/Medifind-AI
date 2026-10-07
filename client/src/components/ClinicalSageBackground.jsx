import React, { useEffect, useRef } from 'react';

/**
 * ClinicalSageBackground — Stitch Animated Healthcare Shader Background
 *
 * Direct reproduction of the WebGL Clinical Sage shader from Stitch Login & Registration:
 * - Smooth undulating luminous curves
 * - Multi-layer sinusoidal healthcare waves
 * - Mint / Emerald / Deep Sage palette
 * - Ambient floating molecular gradient orbs
 * - Mouse parallax interaction
 */
export default function ClinicalSageBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let animationFrameId;
    let resizeObserver;

    function syncSize() {
      const w = canvas.clientWidth || window.innerWidth || 1280;
      const h = canvas.clientHeight || window.innerHeight || 720;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(syncSize);
      resizeObserver.observe(canvas);
    }
    syncSize();

    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return;

    const vs = `attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

    const fs = `precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;

// MediFind AI - Clinical Sage animated healthcare waves shader
// Smooth undulating luminous curves, subtle molecular particle glow, soothing clinical aesthetic

void main() {
    vec2 st = gl_FragCoord.xy / u_resolution.xy;
    vec2 normMouse = u_mouse / max(u_resolution, vec2(1.0));
    
    // Adjust aspect ratio
    float aspect = u_resolution.x / u_resolution.y;
    vec2 p = st * 2.0 - 1.0;
    p.x *= aspect;

    // Subtle mouse parallax
    p += (normMouse - 0.5) * 0.15;

    float t = u_time * 0.45;

    // Clinical Sage Palette
    vec3 baseColor = vec3(0.925, 0.988, 0.965);
    vec3 mintAccent = vec3(0.32, 0.72, 0.60);
    vec3 deepSage = vec3(0.12, 0.31, 0.27);
    vec3 softEmerald = vec3(0.55, 0.88, 0.78);
    vec3 glowWhite = vec3(0.98, 1.0, 0.99);

    // Subtle background gradient
    vec3 col = mix(baseColor, vec3(0.85, 0.96, 0.92), st.y * 0.7 + st.x * 0.3);

    // Wave 1: Gentle clinical ribbon
    float wave1 = sin(p.x * 1.2 + t * 0.8) * 0.35 + cos(p.x * 0.7 - t * 0.5) * 0.25;
    float dist1 = abs(p.y - wave1);
    float glow1 = 0.045 / (dist1 + 0.08);
    col = mix(col, mintAccent, clamp(glow1 * 0.45, 0.0, 0.8));

    // Wave 2: Counter-flowing luminous biological flow
    float wave2 = sin(p.x * 1.8 - t * 0.6 + 1.5) * 0.28 + cos(p.x * 1.1 + t * 0.4) * 0.2;
    float dist2 = abs(p.y - wave2 + 0.15);
    float glow2 = 0.035 / (dist2 + 0.07);
    col = mix(col, softEmerald, clamp(glow2 * 0.5, 0.0, 0.7));

    // Wave 3: Subtle deep sage baseline wave
    float wave3 = sin(p.x * 0.8 + t * 0.3 - 0.8) * 0.45 + cos(p.x * 1.5 + t * 0.5) * 0.15;
    float dist3 = abs(p.y - wave3 - 0.25);
    float glow3 = 0.025 / (dist3 + 0.09);
    col = mix(col, deepSage, clamp(glow3 * 0.25, 0.0, 0.5));

    // Wave 4: Ultra crisp sharp highlight filament
    float wave4 = sin(p.x * 2.2 + t * 0.9 + 2.0) * 0.32;
    float dist4 = abs(p.y - wave4);
    float thinLine = smoothstep(0.015, 0.002, dist4);
    col = mix(col, glowWhite, thinLine * 0.75);

    // Ambient floating soft orbs / molecular gradient nodes
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        vec2 center = vec2(
            sin(t * 0.35 + fi * 2.1) * 1.0 * aspect * 0.6,
            cos(t * 0.4 + fi * 1.7) * 0.5
        );
        float orbDist = length(p - center);
        float orbGlow = 0.18 / (orbDist * orbDist * 3.5 + 1.0);
        col += mintAccent * orbGlow * 0.12;
    }

    // Gentle vignette
    float vignette = 1.0 - length(st - 0.5) * 0.4;
    col *= clamp(vignette, 0.8, 1.0);

    gl_FragColor = vec4(col, 1.0);
}`;

    function createShader(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    }

    const prog = gl.createProgram();
    gl.attachShader(prog, createShader(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, createShader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

    const pos = gl.getAttribLocation(prog, 'a_position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uRes = gl.getUniformLocation(prog, 'u_resolution');
    const uMouse = gl.getUniformLocation(prog, 'u_mouse');

    let mouse = { x: canvas.width / 2, y: canvas.height / 2 };

    const handleMouseMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width && rect.height) {
        const nx = (event.clientX - rect.left) / rect.width;
        const ny = 1.0 - (event.clientY - rect.top) / rect.height;
        mouse.x = nx * canvas.width;
        mouse.y = ny * canvas.height;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);

    function render(t) {
      if (typeof ResizeObserver === 'undefined') syncSize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (uTime) gl.uniform1f(uTime, t * 0.001);
      if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
      if (uMouse) gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      animationFrameId = requestAnimationFrame(render);
    }

    render(0);

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
        overflow: 'hidden'
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100%',
          height: '100%'
        }}
      />
    </div>
  );
}
