import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import surfaceData from '../assets/surface.json';

// --- Mathematical helpers ---
const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
const damp = (value, target, lambda, dt) => value + (target - value) * (1 - Math.exp(-lambda * dt));
const smoothstep = (value, min, max) => {
  const t = clamp((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
};

const GAIT_DISTANCE = 0.44;
const MODEL_SCALE = 0.76 / 1.7;
const up = new THREE.Vector3(0, 1, 0);

// --- Surface elevation query ---
function surfaceRadius(surface, x, y, z) {
  const u = (Math.atan2(x, z) / (2 * Math.PI) % 1 + 1) % 1 * surface.width;
  const v = Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI * (surface.height - 1);
  const x0 = Math.floor(u), x1 = (x0 + 1) % surface.width;
  const y0 = Math.floor(v), y1 = Math.min(y0 + 1, surface.height - 1);
  const tx = u - x0, ty = v - y0;
  const a = surface.radii[y0 * surface.width + x0] * (1 - tx) + surface.radii[y0 * surface.width + x1] * tx;
  const b = surface.radii[y1 * surface.width + x0] * (1 - tx) + surface.radii[y1 * surface.width + x1] * tx;
  return a * (1 - ty) + b * ty;
}

// --- Motion Physics ---
function createMotion() {
  return {
    planetAngle: 0,
    planetVelocity: 0,
    dragTarget: 0,
    characterTarget: 0,
    characterAngle: 0,
    characterVelocity: 0,
    phase: 0,
    activity: 0,
    direction: 1,
    time: 0,
    dragging: false,
    lastInteraction: 0,
    pitchAngle: 0,
    pitchVelocity: 0,
    pitchTarget: 0,
    cameraHeading: 0,
    heading: 0
  };
}

function stepPlanet(m, dt, auto, reduced, autoRoll = -0.032) {
  m.time += dt;
  if (!auto) {
    m.dragging = false;
    m.planetVelocity = m.pitchVelocity = 0;
    m.dragTarget = m.planetAngle;
    m.pitchTarget = m.pitchAngle;
    return;
  }
  if (m.dragging) {
    const acceleration = 90 * (m.dragTarget - m.planetAngle) - 18 * m.planetVelocity;
    m.planetVelocity += acceleration * dt;
  } else {
    const desired = auto && !reduced && m.time - m.lastInteraction > 3.5 ? autoRoll : 0;
    m.planetVelocity = damp(m.planetVelocity, desired, reduced ? 12 : 5, dt);
  }
  m.planetVelocity = clamp(m.planetVelocity, -1.15, 1.15);
  m.planetAngle += m.planetVelocity * dt;
}

function createGlobeMotion() {
  return {
    delta: new THREE.Quaternion(),
    orientation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, 0.5, 0)),
    angular: new THREE.Vector3(),
    route: 0
  };
}

function stepGlobeMotion(globe, m, dt, auto, reduced) {
  const roaming = auto && !reduced && !m.dragging && m.time - m.lastInteraction > 3.5;
  if (roaming) globe.route += 0.24 * dt;
  stepPlanet(m, dt, auto, reduced, -0.24 * Math.cos(globe.route));
  if (!auto) {
    globe.angular.set(0, 0, 0);
    return;
  }
  if (m.dragging) {
    m.pitchVelocity += (70 * (m.pitchTarget - m.pitchAngle) - 17 * m.pitchVelocity) * dt;
  } else {
    m.pitchVelocity = THREE.MathUtils.damp(m.pitchVelocity, roaming ? 0.24 * Math.sin(globe.route) : 0, 6, dt);
  }
  m.pitchVelocity = clamp(m.pitchVelocity, -0.55, 0.55);
  m.pitchAngle += m.pitchVelocity * dt;
  globe.angular.set(m.pitchVelocity, m.planetVelocity * 0.45, -m.planetVelocity);
  const speed = globe.angular.length();
  if (speed > 1e-8) {
    globe.delta.setFromAxisAngle(globe.angular.clone().multiplyScalar(1 / speed), speed * dt);
    globe.orientation.premultiply(globe.delta).normalize();
  }
}

function createSurfaceMotion() {
  return {
    current: new THREE.Vector3(0, 1, 0),
    target: new THREE.Vector3(0, 1, 0),
    velocity: new THREE.Vector3(),
    error: new THREE.Vector3(),
    worldNormal: new THREE.Vector3(),
    worldVelocity: new THREE.Vector3(),
    inverse: new THREE.Quaternion(),
    initialized: false
  };
}

function stepSurface(s, m, rotation, screenUp, dt, reduced, paused = false) {
  s.inverse.copy(rotation).invert();
  s.target.copy(screenUp).applyQuaternion(s.inverse).normalize();
  if (!s.initialized) {
    s.current.copy(s.target);
    s.initialized = true;
  }
  if (paused) {
    s.velocity.set(0, 0, 0);
    s.worldVelocity.set(0, 0, 0);
    s.worldNormal.copy(s.current).applyQuaternion(rotation);
    m.characterVelocity = 0;
    m.activity = THREE.MathUtils.damp(m.activity, 0, 10, dt);
    return;
  }
  const cosine = clamp(s.current.dot(s.target), -1, 1);
  const angle = Math.acos(cosine);
  s.error.copy(s.target).addScaledVector(s.current, -cosine);
  if (s.error.lengthSq() > 1e-12) s.error.normalize().multiplyScalar(angle);
  const stiffness = reduced ? 110 : 48;
  const damping = reduced ? 21 : 11;
  s.velocity.addScaledVector(s.error, stiffness * dt).multiplyScalar(Math.exp(-damping * dt));
  s.velocity.addScaledVector(s.current, -s.velocity.dot(s.current));
  s.current.addScaledVector(s.velocity, dt).normalize();
  s.velocity.addScaledVector(s.current, -s.velocity.dot(s.current));
  s.worldNormal.copy(s.current).applyQuaternion(rotation);
  s.worldVelocity.copy(s.velocity).applyQuaternion(rotation);
  const speed = s.velocity.length();
  m.characterTarget = Math.atan2(s.target.x, s.target.y);
  m.characterAngle = Math.atan2(s.current.x, s.current.y);
  if (Math.abs(s.worldVelocity.x) > 0.012) m.direction = Math.sign(s.worldVelocity.x);
  m.characterVelocity = speed * m.direction;
  m.activity = THREE.MathUtils.damp(m.activity, smoothstep(speed, 4e-3, 0.022), 9, dt);
  m.phase += speed * 2.25 / GAIT_DISTANCE * Math.PI * 2 * dt;
}

// --- Courier Rig & Animation helpers ---
function optimizeRigidBag(scene) {
  scene.updateWorldMatrix(true, true);
  const candidates = [];
  scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh && node.name.startsWith("Delivery_Bag")) candidates.push(node);
  });
  for (const mesh of candidates) {
    if (Object.keys(mesh.geometry.morphAttributes).length) continue;
    const weights = mesh.geometry.getAttribute("skinWeight");
    const indices = mesh.geometry.getAttribute("skinIndex");
    if (!weights || !indices) continue;
    let joint = -1, rigid = true;
    for (let vertex = 0; vertex < weights.count && rigid; vertex++) {
      let total = 0;
      for (let channel = 0; channel < 4; channel++) {
        const weight = weights.getComponent(vertex, channel);
        if (weight < 1e-6) continue;
        const index = indices.getComponent(vertex, channel);
        if (joint < 0) joint = index;
        if (index !== joint) { rigid = false; break; }
        total += weight;
      }
      if (Math.abs(total - 1) > 1e-4) rigid = false;
    }
    if (!rigid || joint < 0) continue;
    const bone = mesh.skeleton.bones[joint];
    const bind = new THREE.Matrix4().multiplyMatrices(mesh.skeleton.boneInverses[joint], mesh.bindMatrix);
    const geometry = mesh.geometry.clone().applyMatrix4(bind);
    geometry.deleteAttribute("skinIndex");
    geometry.deleteAttribute("skinWeight");
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const bag = new THREE.Mesh(geometry, mesh.material);
    bag.name = mesh.name;
    bag.castShadow = mesh.castShadow;
    bag.receiveShadow = mesh.receiveShadow;
    bag.renderOrder = mesh.renderOrder;
    bag.matrixAutoUpdate = false;
    mesh.removeFromParent();
    bone.add(bag);
  }
}

class BagSuspension {
  constructor(scene) {
    this.scene = scene;
    const bone = scene.getObjectByName("CourierBag");
    if (!(bone instanceof THREE.Bone)) return;
    this.bone = bone;
    scene.updateWorldMatrix(true, true);
    scene.getWorldQuaternion(this.sceneOrientation);
    bone.getWorldQuaternion(this.restOrientation);
    this.restOrientation.premultiply(this.sceneOrientation.clone().invert());
    this.inverseRest.copy(this.restOrientation).invert();
  }
  bone = null;
  restOrientation = new THREE.Quaternion();
  animatedOrientation = new THREE.Quaternion();
  animatedPosition = new THREE.Vector3();
  localAnchor = new THREE.Vector3();
  gravityTilt = new THREE.Quaternion();
  pelvisYaw = new THREE.Quaternion();
  inverseRest = new THREE.Quaternion();
  xAxis = new THREE.Vector3(1, 0, 0);
  hangingOrientation = new THREE.Quaternion();
  sceneOrientation = new THREE.Quaternion();
  parentOrientation = new THREE.Quaternion();
  swing = new THREE.Quaternion();
  angles = new THREE.Euler();
  inverseScene = new THREE.Matrix4();
  anchor = new THREE.Vector3();
  previousAnchor = new THREE.Vector3();
  velocity = new THREE.Vector3();
  previousVelocity = new THREE.Vector3();
  acceleration = new THREE.Vector3();
  initialized = false;
  applied = false;
  pitch = 0;
  roll = 8e-3;
  pitchVelocity = 0;
  rollVelocity = 0;
  restore() {
    if (!this.applied || !this.bone) return;
    this.bone.position.copy(this.animatedPosition);
    this.bone.quaternion.copy(this.animatedOrientation);
    this.applied = false;
  }
  update(dt, activity, _phase, turnRate, reduced, bodyLean = 0) {
    if (dt <= 0 || !this.bone || !this.bone.parent) return;
    this.animatedPosition.copy(this.bone.position);
    this.animatedOrientation.copy(this.bone.quaternion);
    this.inverseScene.copy(this.scene.matrixWorld).invert();
    this.bone.getWorldPosition(this.anchor).applyMatrix4(this.inverseScene);
    if (!this.initialized) {
      this.previousAnchor.copy(this.anchor);
      this.initialized = true;
    }
    this.velocity.copy(this.anchor).sub(this.previousAnchor).divideScalar(dt);
    this.acceleration.copy(this.velocity).sub(this.previousVelocity).divideScalar(dt);
    this.previousVelocity.lerp(this.velocity, 1 - Math.exp(-14 * dt));
    this.previousAnchor.copy(this.anchor);
    const gravity = Math.max(4, 9.81 + this.acceleration.y);
    const targetPitch = reduced ? 0 : clamp(Math.atan2(this.acceleration.z, gravity), -0.1, 0.1);
    const targetRoll = reduced ? 0 : clamp(Math.atan2(-this.acceleration.x, gravity) + Math.abs(turnRate) * 1e-3, -0.012, 0.045);
    const steps = Math.ceil(dt / (1 / 120)), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.pitchVelocity += ((targetPitch - this.pitch) * 72 - this.pitchVelocity * 11) * h;
      this.rollVelocity += ((targetRoll - this.roll) * 64 - this.rollVelocity * 10) * h;
      this.pitch = clamp(this.pitch + this.pitchVelocity * h, -0.12, 0.12);
      this.roll = clamp(this.roll + this.rollVelocity * h, -0.012, 0.05);
    }
    this.scene.getWorldQuaternion(this.sceneOrientation);
    this.bone.getWorldQuaternion(this.pelvisYaw).premultiply(this.parentOrientation.copy(this.sceneOrientation).invert()).multiply(this.inverseRest);
    this.pelvisYaw.set(0, this.pelvisYaw.y, 0, this.pelvisYaw.w).normalize();
    this.bone.parent.getWorldQuaternion(this.parentOrientation).invert();
    this.swing.setFromEuler(this.angles.set(this.pitch, 0, this.roll));
    this.gravityTilt.setFromAxisAngle(this.xAxis, -bodyLean);
    this.hangingOrientation.copy(this.parentOrientation).multiply(this.sceneOrientation).multiply(this.gravityTilt).multiply(this.pelvisYaw).multiply(this.swing).multiply(this.restOrientation);
    this.bone.quaternion.copy(this.animatedOrientation).slerp(this.hangingOrientation, 1 - activity * 0.3);
    this.localAnchor.copy(this.anchor).addScaledVector(this.xAxis, -9e-3 * (1 - activity * 0.5));
    this.localAnchor.y -= 0.027;
    this.localAnchor.applyMatrix4(this.scene.matrixWorld);
    this.bone.parent.worldToLocal(this.localAnchor);
    this.bone.position.copy(this.localAnchor);
    this.bone.updateWorldMatrix(false, true);
    this.applied = true;
  }
}

class CourierGreeting {
  constructor(scene) {
    this.scene = scene;
    scene.updateWorldMatrix(true, true);
    const inverseScene = scene.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.joints = ["RightArm", "RightForeArm", "RightHand"].map((name) => {
      const bone = scene.getObjectByName(name);
      if (!(bone instanceof THREE.Bone)) return null;
      const rest = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(inverseScene);
      const direction = up.clone().applyQuaternion(rest).normalize();
      const palm = new THREE.Vector3(1, 0, 0).addScaledVector(direction, -direction.x).normalize();
      return { bone, rest, direction, palm, animated: bone.quaternion.clone() };
    }).filter(Boolean);
    if (this.joints.length >= 2) {
      this.restBendNormal.crossVectors(this.joints[0].direction, this.joints[1].direction).normalize();
    }
  }
  joints = [];
  sceneRotation = new THREE.Quaternion();
  inverseParent = new THREE.Quaternion();
  aim = new THREE.Quaternion();
  twist = new THREE.Quaternion();
  target = new THREE.Quaternion();
  direction = new THREE.Vector3();
  palm = new THREE.Vector3();
  wantedPalm = new THREE.Vector3();
  cross = new THREE.Vector3();
  restBendNormal = new THREE.Vector3();
  bendNormal = new THREE.Vector3();
  upperDirection = new THREE.Vector3(-0.55, -0.65, 0.52).normalize();
  forearmDirection = new THREE.Vector3();
  phase = 0;
  applied = false;
  weight = 0;
  restore() {
    if (!this.applied) return;
    for (const joint of this.joints) joint.bone.quaternion.copy(joint.animated);
    this.applied = false;
  }
  step(dt, ready, reduced) {
    this.weight = damp(this.weight, ready ? 1 : 0, ready ? 4 : 9, dt);
    if (this.weight < 1e-4) { this.weight = 0; this.phase = 0; }
    if (ready && this.weight > 0.85 && !reduced) this.phase += dt * Math.PI * 2 * 0.9;
  }
  apply(reduced) {
    if (this.weight === 0 || this.joints.length < 3) return;
    this.scene.getWorldQuaternion(this.sceneRotation);
    const wave = Math.sin(this.phase) * (reduced ? 0 : 0.12) * smoothstep(this.weight, 0.85, 0.99);
    this.forearmDirection.set(-0.08 + wave * 0.35, 0.94, 0.33).normalize();
    this.bendNormal.crossVectors(this.upperDirection, this.forearmDirection).normalize();
    this.joints.forEach((joint, index) => {
      joint.animated.copy(joint.bone.quaternion);
      if (index === 0) this.direction.copy(this.upperDirection);
      else if (index === 1) this.direction.copy(this.forearmDirection);
      else this.direction.set(-0.06 + wave, 0.97, 0.22);
      this.direction.normalize();
      this.aim.setFromUnitVectors(joint.direction, this.direction);
      this.target.copy(this.aim).multiply(joint.rest);
      this.palm.copy(this.restBendNormal).addScaledVector(joint.direction, -this.restBendNormal.dot(joint.direction)).normalize().applyQuaternion(this.aim);
      this.wantedPalm.copy(this.bendNormal).addScaledVector(this.direction, -this.bendNormal.dot(this.direction)).normalize();
      const angle = Math.atan2(this.direction.dot(this.cross.crossVectors(this.palm, this.wantedPalm)), this.palm.dot(this.wantedPalm));
      this.twist.setFromAxisAngle(this.direction, angle);
      this.target.premultiply(this.twist);
      joint.bone.parent.getWorldQuaternion(this.inverseParent).invert();
      this.target.premultiply(this.sceneRotation).premultiply(this.inverseParent);
      joint.bone.quaternion.slerp(this.target, this.weight);
      joint.bone.updateWorldMatrix(false, true);
    });
    this.applied = true;
  }
}

function makeIdle(scene) {
  const tracks = [];
  const breath = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 9e-3);
  scene.traverse((node) => {
    if (node instanceof THREE.Mesh && node.morphTargetInfluences?.length) {
      const zeros = new Array(node.morphTargetInfluences.length).fill(0);
      tracks.push(new THREE.NumberKeyframeTrack(`${node.name}.morphTargetInfluences`, [0, 3], [...zeros, ...zeros]));
    }
    if (!(node instanceof THREE.Bone)) return;
    const q = node.quaternion.clone(), middle = q.clone();
    if (node.name === "Spine02" || node.name === "neck") middle.multiply(breath);
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, [0, 1.5, 3], [...q.toArray(), ...middle.toArray(), ...q.toArray()]));
    const p = node.position.clone(), inhale = p.clone();
    if (node.name === "Hips") inhale.y += 4e-3;
    tracks.push(new THREE.VectorKeyframeTrack(`${node.name}.position`, [0, 1.5, 3], [...p.toArray(), ...inhale.toArray(), ...p.toArray()]));
    tracks.push(new THREE.VectorKeyframeTrack(`${node.name}.scale`, [0, 3], [...node.scale.toArray(), ...node.scale.toArray()]));
  });
  return new THREE.AnimationClip("Courier_Idle", 3, tracks);
}

function makeSeamlessRun(source) {
  const reference = source.tracks.reduce((best, track) => track.times.length > best.times.length ? track : best);
  const start = reference.times[0];
  const last = reference.times[reference.times.length - 1];
  const intervals = Array.from(reference.times).slice(1).map((time, i) => time - reference.times[i]).sort((a, b) => a - b);
  const step = intervals.length ? intervals[Math.floor(intervals.length / 2)] : 1 / 24;
  const period = Math.max(step, last - start + step);
  const frames = Math.max(40, Math.ceil(period * 120));
  const quaternion = new THREE.Quaternion();
  const tracks = source.tracks.map((track) => {
    const count = track.times.length, size = track.getValueSize();
    const knots = Array.from(track.times, (time) => time - start);
    const samples = Array.from(track.values);
    const isRotation = track.name.endsWith(".quaternion");
    const isMorph = track.name.endsWith(".morphTargetInfluences");
    if (isRotation) {
      for (let i = 1; i < count; i++) {
        let dot = 0;
        for (let c = 0; c < 4; c++) dot += samples[(i - 1) * 4 + c] * samples[i * 4 + c];
        if (dot < 0) for (let c = 0; c < 4; c++) samples[i * 4 + c] *= -1;
      }
    }
    const times = [], values = [];
    for (let frame = 0; frame <= frames; frame++) {
      const time = frame === frames ? 0 : frame / frames * period;
      times.push(frame / frames * period);
      let index = 0;
      while (index < count - 1 && knots[index + 1] <= time) index++;
      const previous = (index - 1 + count) % count, next = (index + 1) % count, after = (index + 2) % count;
      const t1 = knots[index], t2 = next === 0 ? period + knots[0] : knots[next];
      const t0 = previous > index ? knots[previous] - period : knots[previous];
      const t3 = after <= next ? knots[after] + period : knots[after];
      const afterTime = t3 <= t2 ? t3 + period : t3;
      const length = Math.max(t2 - t1, 1e-6), u = Math.max(0, Math.min(1, (time - t1) / length));
      for (let c = 0; c < size; c++) {
        const p0 = samples[previous * size + c], p1 = samples[index * size + c], p2 = samples[next * size + c], p3 = samples[after * size + c];
        const a = count < 3 ? 0 : (p2 - p0) / Math.max(t2 - t0, 1e-6) * length;
        const b = count < 3 ? 0 : (p3 - p1) / Math.max(afterTime - t1, 1e-6) * length;
        values.push(count === 1 ? p1 : isMorph ? p1 + (p2 - p1) * u : (2 * u ** 3 - 3 * u ** 2 + 1) * p1 + (u ** 3 - 2 * u ** 2 + u) * a + (-2 * u ** 3 + 3 * u ** 2) * p2 + (u ** 3 - u ** 2) * b);
      }
      if (isRotation) {
        quaternion.fromArray(values, values.length - 4).normalize();
        quaternion.toArray(values, values.length - 4);
      }
    }
    const result = track.clone();
    result.times = new Float32Array(times);
    result.values = new Float32Array(values);
    return result;
  });
  return new THREE.AnimationClip("Courier_Run_Seamless", period, tracks);
}

/**
 * MediFind3DHero — 3D Whimsical-World Globe with Courier Runner
 */
export default function MediFind3DHero({
  onProceed,
  onNavigateEmergency,
  onDirectLogin
}) {
  const mountRef = useRef(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [worldLoaded, setWorldLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isRotating, setIsRotating] = useState(true);
  const isRotatingRef = useRef(isRotating);
  useEffect(() => {
    isRotatingRef.current = isRotating;
  }, [isRotating]);

  const [isDragging, setIsDragging] = useState(false);
  const [activeHub, setActiveHub] = useState('Regional Node Alpha');
  const animFrameRef = useRef(null);

  // Illustrative Regional Network Nodes (Product Visualization)
  const hubs = [
    { name: 'Regional Node Alpha', lat: 9.3176, lng: 76.6178, label: 'Central Corridor' },
    { name: 'Medicine Access Point 1', lat: 9.3400, lng: 76.7000, label: 'Eastern Sector' },
    { name: 'Pharmacy Network Node', lat: 9.3835, lng: 76.5741, label: 'Northern Corridor' },
    { name: 'Regional Node Beta', lat: 9.4981, lng: 76.3388, label: 'Coastal Corridor' }
  ];

  const motionRef = useRef(createMotion());
  const globeMotionRef = useRef(createGlobeMotion());
  const surfaceMotionRef = useRef(createSurfaceMotion());
  const dragPointerRef = useRef({ id: null, x: 0, y: 0 });

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      setIsRotating(false);
    }

    let isVisible = true;
    let isTabActive = !document.hidden;

    let width = container.clientWidth || 600;
    let height = container.clientHeight || 520;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 0.15, 6.4);

    const isMobile = window.innerWidth < 768;
    const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.25 : 1.75);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isMobile,
        alpha: true,
        powerPreference: 'high-performance'
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(dpr);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;

      container.innerHTML = '';
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.display = 'block';
      container.appendChild(renderer.domElement);
    } catch (err) {
      console.warn('WebGL initialization failed, falling back to 2D network preview:', err);
      setHasError(true);
      return;
    }

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfffaed, 2.8);
    sunLight.position.set(5, 7, 5);
    scene.add(sunLight);

    const blueRimLight = new THREE.DirectionalLight(0x7ee8fa, 1.6);
    blueRimLight.position.set(-6, -2, -3);
    scene.add(blueRimLight);

    const emeraldKeyLight = new THREE.DirectionalLight(0x34d399, 1.0);
    emeraldKeyLight.position.set(0, -6, 2);
    scene.add(emeraldKeyLight);

    // Master Planet Group
    const planetGroup = new THREE.Group();
    planetGroup.position.set(0, -0.3, 0);
    scene.add(planetGroup);

    // Globe Pivot
    const globePivot = new THREE.Group();
    planetGroup.add(globePivot);

    // Hub Markers Group
    const hubMarkersGroup = new THREE.Group();
    globePivot.add(hubMarkersGroup);

    const latLngToVector3 = (lat, lng, radius) => {
      const phi = (90 - lat) * (Math.PI / 180);
      const theta = (lng + 180) * (Math.PI / 180);
      return new THREE.Vector3(
        -(radius * Math.sin(phi) * Math.cos(theta)),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta)
      );
    };

    hubs.forEach((hub) => {
      const pos = latLngToVector3(hub.lat, hub.lng, 2.22);
      const markerGroup = new THREE.Group();
      markerGroup.position.copy(pos);
      markerGroup.lookAt(0, 0, 0);

      const pinGeo = new THREE.CylinderGeometry(0.02, 0.05, 0.22, 8);
      const pinMat = new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.3, metalness: 0.4 });
      const pinMesh = new THREE.Mesh(pinGeo, pinMat);
      pinMesh.rotation.x = Math.PI / 2;
      markerGroup.add(pinMesh);

      const beaconGeo = new THREE.SphereGeometry(0.07, 12, 12);
      const beaconMat = new THREE.MeshBasicMaterial({ color: 0x6ee7b7 });
      const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
      beaconMesh.position.z = 0.16;
      markerGroup.add(beaconMesh);

      hubMarkersGroup.add(markerGroup);
    });

    // ── Courier Runner Hierarchy ──
    const runner = new THREE.Group();
    const facing = new THREE.Group();
    const lean = new THREE.Group();
    const courierScale = new THREE.Group();
    courierScale.scale.setScalar(MODEL_SCALE);

    lean.add(courierScale);
    facing.add(lean);
    facing.rotation.y = Math.PI / 2;
    runner.add(facing);
    planetGroup.add(runner);

    // Setup Loaders
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    dracoLoader.setWorkerLimit(2);

    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    let courierAsset = null;
    let worldAsset = null;

    // Load Planet Model
    gltfLoader.load(
      '/models/whimsical-world.glb',
      (gltf) => {
        worldAsset = gltf.scene;
        worldAsset.traverse((node) => {
          node.updateMatrix();
          if (node instanceof THREE.Mesh) {
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            for (const mat of materials) {
              if (mat instanceof THREE.MeshStandardMaterial) {
                mat.side = THREE.FrontSide;
                mat.metalness = 0;
                mat.roughness = 0.86;
                mat.normalScale.setScalar(0.65);
                if (mat.map) mat.map.anisotropy = 4;
              }
            }
          }
        });
        worldAsset.scale.setScalar(2.25);
        globePivot.add(worldAsset);
        // Show the globe immediately once world is ready (courier loads separately)
        setWorldLoaded(true);
        checkBothLoaded();
      },
      undefined,
      (err) => {
        console.warn('Local whimsical-world load failed, trying CDN:', err);
        gltfLoader.load(
          'https://cdn.jsdelivr.net/gh/fadeichev2121/planet@b3f70fbf4b577845b1d9d5947c9410fb4d925dae/models/whimsical-world.glb',
          (gltf) => {
            worldAsset = gltf.scene;
            worldAsset.scale.setScalar(2.25);
            globePivot.add(worldAsset);
            setWorldLoaded(true);
            checkBothLoaded();
          },
          undefined,
          (cdnErr) => {
            console.error('All whimsical-world loads failed:', cdnErr);
            setHasError(true);
          }
        );
      }
    );

    // Load Courier Runner Model
    gltfLoader.load(
      '/models/courier.glb',
      (gltf) => {
        setupCourier(gltf);
      },
      undefined,
      (err) => {
        console.warn('Local courier load failed, trying CDN:', err);
        gltfLoader.load(
          'https://cdn.jsdelivr.net/gh/fadeichev2121/planet@b3f70fbf4b577845b1d9d5947c9410fb4d925dae/models/courier.glb',
          (gltf) => {
            setupCourier(gltf);
          },
          undefined,
          (cdnErr) => {
            console.error('Courier load failed:', cdnErr);
            setHasError(true);
          }
        );
      }
    );

    function setupCourier(gltf) {
      const cScene = gltf.scene;
      optimizeRigidBag(cScene);

      cScene.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.morphTargetInfluences?.fill(0);
        if (node instanceof THREE.SkinnedMesh) node.frustumCulled = false;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) {
          if (material instanceof THREE.MeshStandardMaterial) {
            material.metalness = 0;
            material.roughness = 0.88;
            material.roughnessMap = null;
            material.normalScale.setScalar(0.25);
            if (material.map) material.map.anisotropy = 4;
          }
        }
      });

      const clips = gltf.animations.filter((a) => a.duration > 0.3);
      if (!clips.length) {
        console.error('No courier run animation found');
        return;
      }

      const clip = new THREE.AnimationClip("Courier_Run_Source", -1, clips.flatMap((a) => a.tracks));
      const mixer = new THREE.AnimationMixer(cScene);
      const bag = new BagSuspension(cScene);
      const greeting = new CourierGreeting(cScene);
      const idle = mixer.clipAction(makeIdle(cScene)).play();
      const seamless = makeSeamlessRun(clip);
      const run = mixer.clipAction(seamless).setLoop(THREE.LoopRepeat, Infinity).play();

      run.setEffectiveTimeScale(0);
      run.setEffectiveWeight(0);
      mixer.update(0);

      courierScale.add(cScene);

      courierAsset = {
        scene: cScene,
        mixer,
        idle,
        run,
        duration: seamless.duration,
        bag,
        greeting,
        turnVelocity: 0,
        greetingTurn: false
      };

      checkBothLoaded();
    }

    function checkBothLoaded() {
      if (worldAsset && courierAsset) {
        setIsLoaded(true);
      }
    }

    // Animation frame variables
    let lastTime = performance.now();
    let radiusDamp = 2.2;
    const frame = {
      screenUp: new THREE.Vector3(),
      localVelocity: new THREE.Vector3(),
      cameraFront: new THREE.Vector3(),
      inverseRunner: new THREE.Quaternion()
    };

    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      if (!isVisible || !isTabActive) return;

      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      const auto = isRotatingRef.current;
      const m = motionRef.current;
      const g = globeMotionRef.current;
      const s = surfaceMotionRef.current;

      frame.screenUp.copy(up).applyQuaternion(camera.quaternion);

      const count = Math.ceil(dt / (1 / 120));
      for (let i = 0; i < count; i++) {
        const subDt = dt / count;
        stepGlobeMotion(g, m, subDt, auto, prefersReducedMotion);
        stepSurface(s, m, g.orientation, frame.screenUp, subDt, prefersReducedMotion, !auto);
      }

      globePivot.quaternion.copy(g.orientation);

      // Update Courier Runner Position, Elevation, and Animation
      if (courierAsset && surfaceData) {
        const r = surfaceRadius(surfaceData, s.current.x, s.current.y, s.current.z) * 2.25;
        radiusDamp = damp(radiusDamp, r + 8e-3, 25, dt);

        runner.position.copy(s.worldNormal).multiplyScalar(radiusDamp);
        runner.quaternion.setFromUnitVectors(up, s.worldNormal);

        frame.inverseRunner.copy(runner.quaternion).invert();
        frame.cameraFront.set(0, 0, 1).applyQuaternion(camera.quaternion).applyQuaternion(frame.inverseRunner);
        m.cameraHeading = Math.atan2(frame.cameraFront.x, frame.cameraFront.z);

        if (s.velocity.lengthSq() > 1e-4) {
          frame.localVelocity.copy(s.worldVelocity).applyQuaternion(frame.inverseRunner);
          m.heading = Math.atan2(-frame.localVelocity.z, frame.localVelocity.x);
        }

        // Runner facing logic
        if (auto) courierAsset.greetingTurn = false;
        else if (m.activity < 0.06) courierAsset.greetingTurn = true;

        const desired = !auto
          ? (courierAsset.greetingTurn ? (m.cameraHeading ?? 0) : facing.rotation.y)
          : ((m.heading ?? 0) + Math.PI / 2);

        const turn = Math.atan2(Math.sin(desired - facing.rotation.y), Math.cos(desired - facing.rotation.y));

        if (!auto) {
          const acceleration = clamp(18 * turn - 8.5 * courierAsset.turnVelocity, -5.5, 5.5);
          courierAsset.turnVelocity = clamp(courierAsset.turnVelocity + acceleration * dt, -2.2, 2.2);
          if (Math.abs(turn) < 3e-3 && Math.abs(courierAsset.turnVelocity) < 0.025) courierAsset.turnVelocity = 0;
          facing.rotation.y += courierAsset.turnVelocity * dt;
        } else {
          const rotation = turn * (1 - Math.exp(-12 * dt));
          facing.rotation.y += rotation;
          courierAsset.turnVelocity = rotation / dt;
        }

        const turning = (!auto && courierAsset.greetingTurn && !prefersReducedMotion)
          ? smoothstep(Math.abs(courierAsset.turnVelocity), 0.08, 1.2)
          : 0;

        courierAsset.greeting.step(
          dt,
          !auto && courierAsset.greetingTurn && Math.abs(turn) < 0.055 && Math.abs(courierAsset.turnVelocity) < 0.13,
          prefersReducedMotion
        );

        lean.rotation.x = damp(
          lean.rotation.x,
          Math.min(Math.abs(m.characterVelocity) * 0.065, 0.09) * (prefersReducedMotion ? 0.35 : 1),
          9,
          dt
        );

        const activity = Math.max(m.activity, turning * 0.3) * (1 - courierAsset.greeting.weight);
        courierAsset.run.setEffectiveWeight(activity);
        courierAsset.idle.setEffectiveWeight(1 - activity);
        courierAsset.idle.paused = prefersReducedMotion;

        const playback = Math.max(Math.abs(m.characterVelocity) * 2.25 / GAIT_DISTANCE * courierAsset.duration, turning * 0.72);
        courierAsset.run.setEffectiveTimeScale(damp(courierAsset.run.timeScale, playback, 10, dt));

        courierAsset.greeting.restore();
        courierAsset.bag.restore();
        courierAsset.mixer.update(dt);
        courierAsset.scene.updateWorldMatrix(true, true);
        courierAsset.greeting.apply(prefersReducedMotion);
        courierAsset.bag.update(dt, activity, m.phase, courierAsset.turnVelocity, prefersReducedMotion, lean.rotation.x);
      }

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 600;
      const h = container.clientHeight || 520;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Pointer Drag Handlers
  const handlePointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragPointerRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };

    const m = motionRef.current;
    m.dragTarget = m.planetAngle;
    m.pitchTarget = m.pitchAngle;
    m.dragging = true;
    m.lastInteraction = m.time;
    setIsDragging(true);
  }, []);

  const handlePointerMove = useCallback((e) => {
    const drag = dragPointerRef.current;
    if (!motionRef.current.dragging || drag.id !== e.pointerId) return;

    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const containerWidth = mountRef.current?.clientWidth || 500;
    const sensitivity = 5 / Math.max(360, containerWidth);

    const m = motionRef.current;
    m.dragTarget = Math.max(m.planetAngle - 0.55, Math.min(m.planetAngle + 0.55, m.dragTarget + dx * sensitivity));
    m.pitchTarget = Math.max(m.pitchAngle - 0.45, Math.min(m.pitchAngle + 0.45, m.pitchTarget + dy * sensitivity * 0.7));

    drag.x = e.clientX;
    drag.y = e.clientY;
    m.lastInteraction = m.time;
  }, []);

  const handlePointerUp = useCallback((e) => {
    if (dragPointerRef.current.id === e.pointerId) {
      dragPointerRef.current.id = null;
      motionRef.current.dragging = false;
      motionRef.current.lastInteraction = motionRef.current.time;
      setIsDragging(false);
    }
  }, []);

  const handleHubSelect = (hub) => {
    setActiveHub(hub.name);
    const m = motionRef.current;
    m.planetVelocity += 0.4;
    m.lastInteraction = m.time;
  };

  return (
    <section
      className="relative w-full min-h-[92vh] text-white flex flex-col justify-between overflow-hidden select-none"
      style={{
        background: 'linear-gradient(160deg, #011a15 0%, #032f28 40%, #021f1a 100%)'
      }}
    >
      {/* ─── Center Hero Content & 3D Interactive World ───────────── */}
      <div className="relative z-10 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-10 flex flex-col lg:flex-row items-center justify-between gap-8 flex-1">
        
        {/* Left Column: Hero Typography & Actions */}
        <div className="flex-1 max-w-2xl text-left space-y-6">
          
          {/* Illustrative Product Visualization Badge */}
          <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-emerald-500/15 border border-emerald-400/40 backdrop-blur-md text-xs font-semibold text-emerald-300 shadow-sm">
            <span className="material-symbols-outlined text-sm text-emerald-400">hub</span>
            <span>Medicine Access Network Visualization</span>
          </div>

          {/* Main Headline */}
          <h1
            className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.12]"
            style={{ color: '#ffffff' }}
          >
            Critical Medicines.{' '}
            <span
              className="text-transparent bg-clip-text bg-gradient-to-r from-[#6ee7b7] via-[#a7f3d0] to-[#38bdf8]"
              style={{ color: 'transparent' }}
            >
              Verified Availability.
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-base sm:text-lg font-normal leading-relaxed max-w-xl" style={{ color: '#e2e8f0' }}>
            MediFind AI connects patients and emergency responders with participating community pharmacies, prescription verification, and coordinated medicine delivery.
          </p>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-3.5 pt-2">
            <button
              id="hero-proceed-app-btn"
              type="button"
              onClick={onProceed}
              className="px-7 py-3.5 rounded-full bg-[#10b981] hover:bg-[#059669] text-white font-extrabold text-sm tracking-wide shadow-lg shadow-emerald-950/50 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer flex items-center gap-2"
            >
              <span>Explore Platform</span>
              <span className="material-symbols-outlined text-lg">arrow_forward</span>
            </button>

            <button
              type="button"
              onClick={onDirectLogin}
              className="px-6 py-3.5 rounded-full bg-white/10 hover:bg-white/20 text-white font-bold text-sm border border-white/25 backdrop-blur-md transition-all cursor-pointer flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-base text-emerald-300">verified_user</span>
              <span>Sign In / Enter Portal</span>
            </button>
          </div>

          {/* Platform Capability Overview */}
          <div className="grid grid-cols-3 gap-6 pt-6 border-t border-white/15 max-w-lg">
            <div>
              <div className="text-2xl font-extrabold text-white font-mono">50</div>
              <div className="text-emerald-300 font-semibold text-xs mt-0.5">Catalog Medicines</div>
            </div>
            <div>
              <div className="text-2xl font-extrabold text-white font-mono">5-Stage</div>
              <div className="text-emerald-300 font-semibold text-xs mt-0.5">Prescription OCR</div>
            </div>
            <div>
              <div className="text-2xl font-extrabold text-white font-mono">24/7</div>
              <div className="text-emerald-300 font-semibold text-xs mt-0.5">Emergency Locator</div>
            </div>
          </div>
        </div>

        {/* Right Column: 3D Globe with Human Courier Runner */}
        <div className="flex-1 w-full max-w-xl flex flex-col items-center justify-center relative">
          
          {/* Container that holds canvas at fixed height — no loading overlay */}
          <div className="relative w-full h-[420px] sm:h-[500px]">
            {/* 3D Canvas Container — always in-flow so renderer gets correct dimensions */}
            <div
              ref={mountRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onLostPointerCapture={handlePointerUp}
              tabIndex={0}
              role="region"
              aria-label="3D Interactive Kerala Pharmacy Globe. Drag to rotate."
              className="absolute inset-0 rounded-3xl cursor-grab active:cursor-grabbing outline-none select-none z-10"
            />
          </div>

          {/* Ethereal Cloud Bank at Planet Base */}
          <div className="cloud-bank" aria-hidden="true">
            <i /><i /><i /><i /><i />
          </div>

          {/* "Drag to turn the world" Arrow Prompt */}
          <div className={`planet-caption ${isDragging ? 'is-dragging' : ''}`} aria-hidden="true">
            <p className="text-emerald-300 font-bold text-xs sm:text-sm">
              {!isRotating ? 'Orbit Paused' : isDragging ? 'Exploring Kerala' : 'Drag to turn'}
              <br />
              {!isRotating ? 'Tap Resume' : isDragging ? 'Network Grid' : 'the world'}
            </p>
            <svg viewBox="0 0 180 165" fill="none">
              <path
                d="M161 148C137 82 103 39 28 14m0 0 6 16m-6-16 19-2"
                stroke="#6ee7b7"
                strokeWidth="2.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          {/* Interactive Controls Bar */}
          {worldLoaded && !hasError && (
            <div className="mt-2 flex items-center gap-3 bg-black/60 backdrop-blur-md px-5 py-2 rounded-full border border-white/20 text-xs text-white z-20 shadow-lg">
              <button
                type="button"
                onClick={() => setIsRotating(prev => !prev)}
                className="hover:text-emerald-300 transition-colors flex items-center gap-1.5 cursor-pointer font-bold"
                title={isRotating ? 'Pause planet rotation' : 'Resume planet rotation'}
              >
                <span className="material-symbols-outlined text-base text-emerald-400">
                  {isRotating ? 'pause_circle' : 'play_circle'}
                </span>
                <span>{isRotating ? 'Pause Orbit' : 'Resume Orbit'}</span>
              </button>
              <span className="text-white/30">•</span>
              <span className="text-emerald-300 font-medium">Drag to rotate</span>
            </div>
          )}

          {/* Regional Kerala Hub Chips */}
          <div className="flex flex-wrap justify-center gap-2 mt-3 max-w-md z-20">
            {hubs.map(hub => (
              <button
                key={hub.name}
                type="button"
                onClick={() => handleHubSelect(hub)}
                className={`px-3.5 py-1.5 rounded-full text-[11px] font-bold transition-all cursor-pointer backdrop-blur-md ${
                  activeHub === hub.name
                    ? 'bg-emerald-500 text-white shadow-md scale-105 border border-emerald-300/50'
                    : 'bg-black/55 text-white border border-emerald-400/50 hover:bg-emerald-900/60 hover:border-emerald-400/80 hover:scale-[1.03]'
                }`}
              >
                {hub.name}
              </button>
            ))}
          </div>

        </div>

      </div>

      {/* ─── Bottom Scroll Prompt ─────────────────────────────────── */}
      <div className="relative z-10 w-full py-4 text-center flex flex-col items-center gap-1 text-xs text-white/80">
        <button
          type="button"
          onClick={onProceed}
          className="hover:text-white transition-colors flex flex-col items-center gap-1 cursor-pointer focus:outline-none group"
        >
          <span className="text-xs font-bold tracking-wide text-emerald-300 group-hover:text-white transition-colors">
            Scroll or tap to enter 3D Transit Map
          </span>
          <span className="material-symbols-outlined text-lg animate-bounce text-emerald-400 group-hover:text-emerald-300">
            keyboard_arrow_down
          </span>
        </button>
      </div>

    </section>
  );
}
