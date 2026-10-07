import React, { useEffect, useRef } from 'react';
import { Renderer, Program, Mesh, Triangle, Vec3 } from 'ogl';

/* ─────────────────────────────────────────────────────────────────────────
   EXACT port of the original voice-powered-orb.tsx shader.
   Changes vs the .tsx:
     • Ported to plain JSX (no TypeScript generics)
     • premultipliedAlpha: true  +  gl_FragColor uses pre-mult so WebGL
       composites correctly against any background (no black fringe)
     • Microphone cleanup fully extracted into helper refs
   ───────────────────────────────────────────────────────────────────────── */

const vert = /* glsl */ `
  precision highp float;
  attribute vec2 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const frag = /* glsl */ `
  precision highp float;

  uniform float iTime;
  uniform vec3  iResolution;
  uniform float hue;
  uniform float hover;
  uniform float rot;
  uniform float hoverIntensity;
  varying vec2 vUv;

  vec3 rgb2yiq(vec3 c) {
    float y = dot(c, vec3(0.299,  0.587,  0.114));
    float i = dot(c, vec3(0.596, -0.274, -0.322));
    float q = dot(c, vec3(0.211, -0.523,  0.312));
    return vec3(y, i, q);
  }
  vec3 yiq2rgb(vec3 c) {
    float r = c.x + 0.956*c.y + 0.621*c.z;
    float g = c.x - 0.272*c.y - 0.647*c.z;
    float b = c.x - 1.106*c.y + 1.703*c.z;
    return vec3(r, g, b);
  }
  vec3 adjustHue(vec3 color, float hueDeg) {
    float hueRad = hueDeg * 3.14159265 / 180.0;
    vec3  yiq    = rgb2yiq(color);
    float cosA   = cos(hueRad);
    float sinA   = sin(hueRad);
    float i      = yiq.y*cosA - yiq.z*sinA;
    float q      = yiq.y*sinA + yiq.z*cosA;
    yiq.y = i; yiq.z = q;
    return yiq2rgb(yiq);
  }

  vec3 hash33(vec3 p3) {
    p3  = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
    p3 += dot(p3, p3.yxz + 19.19);
    return -1.0 + 2.0 * fract(vec3(
      p3.x + p3.y,
      p3.x + p3.z,
      p3.y + p3.z) * p3.zyx);
  }

  float snoise3(vec3 p) {
    const float K1 = 0.333333333;
    const float K2 = 0.166666667;
    vec3 i   = floor(p + (p.x+p.y+p.z)*K1);
    vec3 d0  = p - (i - (i.x+i.y+i.z)*K2);
    vec3 e   = step(vec3(0.0), d0 - d0.yzx);
    vec3 i1  = e * (1.0 - e.zxy);
    vec3 i2  = 1.0 - e.zxy*(1.0 - e);
    vec3 d1  = d0 - (i1 - K2);
    vec3 d2  = d0 - (i2 - K1);
    vec3 d3  = d0 - 0.5;
    vec4 h   = max(0.6 - vec4(dot(d0,d0),dot(d1,d1),dot(d2,d2),dot(d3,d3)), 0.0);
    vec4 n   = h*h*h*h * vec4(
      dot(d0, hash33(i)),
      dot(d1, hash33(i + i1)),
      dot(d2, hash33(i + i2)),
      dot(d3, hash33(i + 1.0)));
    return dot(vec4(31.316), n);
  }

  /* Returns RGB + derived alpha so blacks stay transparent */
  vec4 extractAlpha(vec3 colorIn) {
    float a = max(max(colorIn.r, colorIn.g), colorIn.b);
    return vec4(colorIn.rgb / (a + 1e-5), a);
  }

  const vec3  baseColor1  = vec3(0.611765, 0.262745, 0.996078);
  const vec3  baseColor2  = vec3(0.298039, 0.760784, 0.913725);
  const vec3  baseColor3  = vec3(0.062745, 0.078431, 0.600000);
  const float innerRadius = 0.6;
  const float noiseScale  = 0.65;

  float light1(float intensity, float attenuation, float dist) {
    return intensity / (1.0 + dist * attenuation);
  }
  float light2(float intensity, float attenuation, float dist) {
    return intensity / (1.0 + dist*dist * attenuation);
  }

  vec4 draw(vec2 uv) {
    vec3  color1 = adjustHue(baseColor1, hue);
    vec3  color2 = adjustHue(baseColor2, hue);
    vec3  color3 = adjustHue(baseColor3, hue);

    float ang    = atan(uv.y, uv.x);
    float len    = length(uv);
    float invLen = len > 0.0 ? 1.0/len : 0.0;

    float n0  = snoise3(vec3(uv * noiseScale, iTime * 0.5)) * 0.5 + 0.5;
    float r0  = mix(mix(innerRadius, 1.0, 0.4), mix(innerRadius, 1.0, 0.6), n0);
    float d0  = distance(uv, (r0 * invLen) * uv);
    float v0  = light1(1.0, 10.0, d0);
    v0       *= smoothstep(r0 * 1.05, r0, len);
    float cl  = cos(ang + iTime * 2.0) * 0.5 + 0.5;

    float a   = iTime * -1.0;
    vec2  pos = vec2(cos(a), sin(a)) * r0;
    float d   = distance(uv, pos);
    float v1  = light2(1.5, 5.0, d);
    v1       *= light1(1.0, 50.0, d0);

    float v2  = smoothstep(1.0, mix(innerRadius, 1.0, n0 * 0.5), len);
    float v3  = smoothstep(innerRadius, mix(innerRadius, 1.0, 0.5), len);

    vec3 col  = mix(color1, color2, cl);
    col       = mix(color3, col, v0);
    col       = (col + v1) * v2 * v3;
    col       = clamp(col, 0.0, 1.0);

    return extractAlpha(col);
  }

  vec4 mainImage(vec2 fragCoord) {
    vec2  center = iResolution.xy * 0.5;
    float size   = min(iResolution.x, iResolution.y);
    vec2  uv     = (fragCoord - center) / size * 2.0;

    float angle = rot;
    float s     = sin(angle);
    float c     = cos(angle);
    uv = vec2(c*uv.x - s*uv.y, s*uv.x + c*uv.y);

    /* voice warp — drives the "alive" movement when speaking */
    uv.x += hover * hoverIntensity * 0.1 * sin(uv.y * 10.0 + iTime);
    uv.y += hover * hoverIntensity * 0.1 * sin(uv.x * 10.0 + iTime);

    return draw(uv);
  }

  void main() {
    vec2 fragCoord = vUv * iResolution.xy;
    vec4 col       = mainImage(fragCoord);
    /* premultiplied-alpha output so WebGL blends correctly on any bg */
    gl_FragColor   = vec4(col.rgb * col.a, col.a);
  }
`;

/* ─── audio helpers ──────────────────────────────────────────────────────── */
function stopMic(r) {
  try {
    r.stream?.getTracks().forEach(t => t.stop());
    r.source?.disconnect();
    r.analyser?.disconnect();
    if (r.ctx && r.ctx.state !== 'closed') r.ctx.close();
  } catch (_) {}
  r.stream = null; r.source = null; r.analyser = null; r.ctx = null; r.data = null;
}

async function startMic(r) {
  stopMic(r);
  try {
    r.stream  = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    r.ctx     = new (window.AudioContext || window.webkitAudioContext)();
    if (r.ctx.state === 'suspended') await r.ctx.resume();
    r.analyser = r.ctx.createAnalyser();
    r.analyser.fftSize               = 512;
    r.analyser.smoothingTimeConstant = 0.3;
    r.analyser.minDecibels           = -90;
    r.analyser.maxDecibels           = -10;
    r.source  = r.ctx.createMediaStreamSource(r.stream);
    r.source.connect(r.analyser);
    r.data    = new Uint8Array(r.analyser.frequencyBinCount);
    return true;
  } catch (e) { console.warn('mic init:', e); return false; }
}

function rmsLevel(r, sensitivity) {
  if (!r.analyser || !r.data) return 0;
  r.analyser.getByteFrequencyData(r.data);
  let sum = 0;
  for (let i = 0; i < r.data.length; i++) { const v = r.data[i]/255; sum += v*v; }
  return Math.min(Math.sqrt(sum / r.data.length) * sensitivity * 3.0, 1);
}

/* ─── Component ──────────────────────────────────────────────────────────── */
export default function VoicePoweredOrb({
  className       = '',
  hue             = 0,
  enableVoiceControl = true,
  voiceSensitivity   = 1.5,
  maxRotationSpeed   = 1.2,
  maxHoverIntensity  = 0.8,
  onVoiceDetected,
}) {
  const ctnDom = useRef(null);
  /* single mutable object for all audio state — avoids stale-closure issues */
  const mic = useRef({ stream: null, ctx: null, analyser: null, source: null, data: null });

  useEffect(() => {
    const container = ctnDom.current;
    if (!container) return;

    let renderer, gl, program, rafId;
    const micState = mic.current;

    try {
      renderer = new Renderer({
        alpha: true,
        premultipliedAlpha: true,   /* must match gl_FragColor output above */
        antialias: true,
        dpr: Math.min(window.devicePixelRatio || 1, 2),
      });
      gl = renderer.gl;
      gl.clearColor(0, 0, 0, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); /* pre-mult blend equation */

      while (container.firstChild) container.removeChild(container.firstChild);
      /* make canvas itself transparent */
      gl.canvas.style.background = 'transparent';
      container.appendChild(gl.canvas);

      const geometry = new Triangle(gl);
      program = new Program(gl, {
        vertex: vert,
        fragment: frag,
        uniforms: {
          iTime:          { value: 0 },
          iResolution:    { value: new Vec3(gl.canvas.width, gl.canvas.height, 1) },
          hue:            { value: hue },
          hover:          { value: 0 },
          rot:            { value: 0 },
          hoverIntensity: { value: 0 },
        },
      });
      const mesh = new Mesh(gl, { geometry, program });

      const resize = () => {
        if (!container || !renderer) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w   = container.clientWidth;
        const h   = container.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w * dpr, h * dpr);
        gl.canvas.style.width  = w + 'px';
        gl.canvas.style.height = h + 'px';
        program.uniforms.iResolution.value.set(
          gl.canvas.width, gl.canvas.height,
          gl.canvas.width / gl.canvas.height
        );
      };
      window.addEventListener('resize', resize);
      resize();

      let lastT  = 0;
      let curRot = 0;
      let micReady = false;
      const BASE_ROT = 0.3;

      if (enableVoiceControl) {
        startMic(micState).then(ok => { micReady = ok; });
      }

      const tick = (t) => {
        rafId = requestAnimationFrame(tick);
        const dt = Math.min((t - lastT) * 0.001, 0.05);
        lastT = t;

        program.uniforms.iTime.value = t * 0.001;
        program.uniforms.hue.value   = hue;

        if (enableVoiceControl && micReady) {
          const level = rmsLevel(micState, voiceSensitivity);
          onVoiceDetected?.(level > 0.1);

          const speed = BASE_ROT + level * maxRotationSpeed * 2.0;
          if (level > 0.04) curRot += dt * speed;

          /* these two uniforms drive the warp in the fragment shader */
          program.uniforms.hover.value         = Math.min(level * 2.0, 1.0);
          program.uniforms.hoverIntensity.value = Math.min(level * maxHoverIntensity * 0.8, maxHoverIntensity);
        } else {
          /* idle — slow constant spin */
          curRot += dt * BASE_ROT;
          program.uniforms.hover.value         = 0;
          program.uniforms.hoverIntensity.value = 0;
          onVoiceDetected?.(false);
        }

        program.uniforms.rot.value = curRot;
        gl.clear(gl.COLOR_BUFFER_BIT);
        renderer.render({ scene: mesh });
      };
      rafId = requestAnimationFrame(tick);

      return () => {
        cancelAnimationFrame(rafId);
        window.removeEventListener('resize', resize);
        try { if (container.contains(gl.canvas)) container.removeChild(gl.canvas); } catch (_) {}
        stopMic(micState);
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
      };
    } catch (e) {
      console.error('VoicePoweredOrb init error:', e);
    }
  }, [hue, enableVoiceControl, voiceSensitivity, maxRotationSpeed, maxHoverIntensity]);

  /* react to mic toggle without restarting WebGL */
  useEffect(() => {
    let alive = true;
    const micState = mic.current;
    if (enableVoiceControl) {
      startMic(micState).then(() => { if (!alive) stopMic(micState); });
    } else {
      stopMic(micState);
    }
    return () => { alive = false; };
  }, [enableVoiceControl]);

  return (
    <div
      ref={ctnDom}
      className={'w-full h-full relative ' + className}
      style={{ background: 'transparent' }}
    />
  );
}
