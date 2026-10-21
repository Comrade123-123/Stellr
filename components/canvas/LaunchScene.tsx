"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { LAUNCH_BASE, rocketAltitude } from "@/lib/launch";
import { scroll } from "@/lib/scroll";

/** Saturn V from NASA 3D Resources, re-optimised (meshopt + WebP). Repainted plain white below. */
const MODEL = "/models/saturn-v.glb";
const ROCKET_HEIGHT = 3;

const NOISE = /* glsl */ `
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  vec3 turb(vec3 q) { return vec3(noise(q), noise(q + 11.3), noise(q + 23.7)) - 0.5; }
`;

/*
 * The exhaust as billowing smoke: a few thousand large soft puffs. Two kinds:
 * the column (tight under the engine, swelling as it nears the pad) and the
 * ground cloud rolling outward across the pad, mostly to the left. Each puff
 * slowly grows and fades on its own cycle so the smoke keeps churning. Light
 * comes from the engine flame, the pad's afterglow and cool moonlight.
 */
const cloudVertex = /* glsl */ `
  attribute vec4 aSeed;
  attribute float aKind;   // 0 column, 1 ground cloud
  uniform float uTop;
  uniform float uTime;
  uniform float uScale;    // pixels per world unit at distance 1
  uniform float uOpacity;
  uniform vec3 uBase;
  varying vec3 vWarm;
  varying vec3 vWarmDir;
  varying vec3 vMoonDir;
  varying vec3 vEmit;
  varying float vAlpha;
  varying float vSeed;
  varying float vDim;
  ${NOISE}

  void main() {
    float t = uTime;
    float dim = 1.0;
    float phase = fract(aSeed.w * 7.13 + t * 0.03);      // each puff's own swell-and-fade cycle
    vec3 p;
    float size;
    float alpha;
    float heat = 0.0;
    if (aKind < 0.5) {
      float s = pow(aSeed.x, 1.25);                       // 0 at the pad, 1 at the engine
      float top = uTop - 0.25;
      float spread = mix(2.4, 0.08, pow(s, 0.42));
      float ang = aSeed.y * 6.2831853;
      float rad = spread * sqrt(aSeed.z) * 0.65 * (0.8 + 0.4 * phase);
      p = vec3(cos(ang) * rad, s * top, sin(ang) * rad);
      p += turb(p * 0.22 + vec3(0.0, -t * 0.05, aSeed.w)) * spread * 0.9;
      size = mix(3.0, 0.32, pow(s, 0.55)) * (0.75 + 0.5 * phase) * mix(0.8, 1.25, fract(aSeed.y * 7.7));
      alpha = 0.6;
      heat = smoothstep(0.86, 1.0, s);
    } else {
      float side = aSeed.y < 0.62 ? -1.0 : 1.0;           // the cloud leans left, like a crosswind
      float d = pow(aSeed.x, 0.8) * 15.0 + phase * 1.6;
      float h = mix(4.2, 0.6, smoothstep(0.0, 16.0, d)) * (0.55 + 0.9 * noise(vec3(d * 0.25, side * 3.0, aSeed.w * 2.0)));
      size = mix(4.4, 2.6, smoothstep(0.0, 16.0, d)) * (0.75 + 0.5 * fract(aSeed.z * 5.3));
      p = vec3(side * d, fract(aSeed.z * 7.31) * h * 0.75 + size * 0.28, (aSeed.z - 0.5) * (4.0 + d * 0.8));
      p += turb(p * 0.15 + vec3(t * 0.02 * side, 0.0, aSeed.w * 3.0)) * vec3(2.0, 0.9, 1.8);
      alpha = 0.5;
      dim = mix(1.0, 0.4, smoothstep(3.0, 17.0, d));   // the cloud's far reaches sink into the dark
    }
    alpha *= smoothstep(0.0, 0.25, phase) * (1.0 - smoothstep(0.7, 1.0, phase)) * 0.75 + 0.25;

    vec4 mv = viewMatrix * vec4(uBase + p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(size * uScale / -mv.z, 1.0, 900.0);

    // Warm light from the flame just under the engine and the pad's glow.
    vec3 flame = vec3(0.0, uTop - 0.35, 0.0);
    vec3 toFlame = flame - p;
    float engine = 5.5 / (1.0 + dot(toFlame, toFlame) * 0.09);
    vec3 pad = vec3(0.0, 0.6, 0.0);
    float glow = 1.4 * exp(-length(p - pad) * 0.17);
    vec3 warmDir = normalize(toFlame * engine + (pad - p) * glow + vec3(0.0, 0.0, 0.001));
    vWarm = vec3(1.0, 0.66, 0.36) * (engine + glow);
    vWarmDir = normalize((viewMatrix * vec4(warmDir, 0.0)).xyz);
    vMoonDir = normalize((viewMatrix * vec4(-0.45, 0.8, 0.4, 0.0)).xyz);
    vEmit = vec3(1.0, 0.78, 0.5) * heat * 2.6;
    vAlpha = alpha * uOpacity;
    vSeed = aSeed.w;
    vDim = dim;
  }
`;

const cloudFragment = /* glsl */ `
  varying vec3 vWarm;
  varying vec3 vWarmDir;
  varying vec3 vMoonDir;
  varying vec3 vEmit;
  varying float vAlpha;
  varying float vSeed;
  varying float vDim;

  float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * n2(p); p = p * 2.03 + 7.1; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    c.y = -c.y;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    float f = fbm(c * 2.1 + vSeed * 41.0);
    // A cauliflower edge: the disc's falloff broken up by the noise.
    float shape = (1.0 - r2) * (0.45 + 1.1 * f);
    float a = smoothstep(0.08, 0.5, shape) * vAlpha;
    if (a < 0.003) discard;

    // Shade each puff as a lumpy ball.
    vec3 n = normalize(vec3(c * 1.15 + (f - 0.5) * 0.9, sqrt(max(0.0, 1.0 - r2)) + 0.15));
    float warm = clamp(dot(n, vWarmDir) * 0.6 + 0.4, 0.0, 1.0);
    float moon = clamp(dot(n, vMoonDir) * 0.5 + 0.5, 0.0, 1.0);
    vec3 albedo = vec3(0.8, 0.79, 0.78) * (0.7 + 0.45 * f);
    vec3 col = albedo * (vec3(0.03, 0.035, 0.05) + vec3(0.3, 0.35, 0.46) * moon * 0.4 * vDim + vWarm * warm)
             + vEmit * (0.55 + 0.6 * f);
    gl_FragColor = vec4(col * a, a);
    // Tone-mapped here only when drawing straight to the screen (no post-processing), matching the composer's look.
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/* Dark ground under the pad, warmed by the plume's glow, fading out toward the horizon. */
const groundVertex = /* glsl */ `
  varying vec3 vLocal;
  void main() {
    vLocal = position.xzy * vec3(1.0, 1.0, -1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const groundFragment = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vLocal;
  ${NOISE}
  void main() {
    float d = length(vLocal.xz);
    float grain = noise(vLocal * 0.6) * 0.6 + noise(vLocal * 3.1) * 0.4;
    vec3 col = vec3(0.016, 0.018, 0.024) * (0.7 + 0.6 * grain)
             + vec3(1.0, 0.55, 0.25) * exp(-d * 0.15) * 0.22 * (0.75 + 0.5 * grain);
    float fade = smoothstep(-70.0, -30.0, vLocal.z) * (1.0 - smoothstep(45.0, 70.0, abs(vLocal.x)));
    gl_FragColor = vec4(col, fade * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/* Engine flare: white-hot core, soft halo and a long horizontal anamorphic streak. */
const flareVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const flareFragment = /* glsl */ `
  uniform float uOpacity;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vec2 q = (vUv - 0.5) * vec2(16.0, 2.0);
    float r = length(q * vec2(1.0, 8.0));
    float flicker = 0.92 + 0.08 * sin(uTime * 40.0) * sin(uTime * 23.0);
    float core = exp(-r * r * 18.0) * 6.0;
    float halo = exp(-r * 2.2) * 0.7;
    float streak = exp(-abs(q.y) * 70.0) * exp(-abs(q.x) * 0.55) * 1.4;
    vec3 col = vec3(1.0, 0.95, 0.85) * core + vec3(1.0, 0.68, 0.35) * (halo + streak);
    float a = clamp(core + halo + streak, 0.0, 1.0);
    gl_FragColor = vec4(col * flicker, a) * uOpacity;
  }
`;

/** The NASA model, scaled so its engines sit at the origin, repainted as a plain white launcher. */
function Rocket() {
  const { scene } = useGLTF(MODEL, false, true);
  const model = useMemo(() => {
    const root = scene.clone(true);
    const box = new THREE.Box3().setFromObject(root);
    const centre = box.getCenter(new THREE.Vector3());
    const scale = ROCKET_HEIGHT / (box.max.y - box.min.y);
    root.scale.setScalar(scale);
    root.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);

    // The livery's black roll pattern stays; the blue band, flags and lettering go white.
    const painted = new Map<THREE.Material, THREE.Material>();
    const paint = (source: THREE.Material) => {
      let m = painted.get(source);
      if (!m) {
        const map = (source as THREE.MeshStandardMaterial).map ?? null;
        const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.5, metalness: 0.05 });
        mat.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <map_fragment>",
            /* glsl */ `#include <map_fragment>
            float paint = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            diffuseColor.rgb = vec3(mix(0.03, 0.85, smoothstep(0.012, 0.035, paint)));`,
          );
        };
        m = mat;
        painted.set(source, m);
      }
      return m;
    };
    const engines = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.09, 0.085, 0.08), roughness: 0.4, metalness: 0.7 });

    root.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      const mesh = o as THREE.Mesh;
      const isEngine = /^polySurf/.test(mesh.name) || /^polySurf/.test(mesh.parent?.name ?? "");
      mesh.material = isEngine ? engines : paint(mesh.material as THREE.Material);
      mesh.frustumCulled = false;
    });
    return root;
  }, [scene]);

  return <primitive object={model} />;
}

useGLTF.preload(MODEL, false, true);

/** A night launch: the rocket on a column of billowing smoke. Shown in the Intro, gone by the Hero. */
export default function LaunchScene({
  plumeCount,
  groundCount,
  reducedMotion,
}: {
  plumeCount: number;
  groundCount: number;
  reducedMotion: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const rocket = useRef<THREE.Group>(null);
  const flare = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const moonTarget = useMemo(() => new THREE.Object3D(), []);

  const cloudGeometry = useMemo(() => {
    const count = plumeCount + groundCount;
    // Rough depth of each puff, so they can be drawn back to front (the camera looks down −z).
    const puffs = Array.from({ length: count }, (_, i) => {
      const seed = [Math.random(), Math.random(), Math.random(), Math.random()];
      const kind = i < plumeCount ? 0 : 1;
      let z: number;
      if (kind === 0) {
        const spread = 2.4 + (0.08 - 2.4) * Math.pow(Math.pow(seed[0], 1.25), 0.42);
        z = Math.sin(seed[1] * Math.PI * 2) * spread * Math.sqrt(seed[2]) * 0.65;
      } else {
        z = (seed[2] - 0.5) * (4 + Math.pow(seed[0], 0.8) * 15 * 0.8);
      }
      return { seed, kind, z };
    }).sort((a, b) => a.z - b.z);

    const seeds = new Float32Array(count * 4);
    const kinds = new Float32Array(count);
    puffs.forEach((p, i) => {
      seeds.set(p.seed, i * 4);
      kinds[i] = p.kind;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
    g.setAttribute("aKind", new THREE.BufferAttribute(kinds, 1));
    return g;
  }, [plumeCount, groundCount]);

  const cloud = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: cloudVertex,
        fragmentShader: cloudFragment,
        uniforms: {
          uTop: { value: 12 },
          uTime: { value: 0 },
          uScale: { value: 500 },
          uOpacity: { value: 1 },
          uBase: { value: LAUNCH_BASE },
        },
        transparent: true,
        depthWrite: false,
        premultipliedAlpha: true,
        blending: THREE.NormalBlending,
      }),
    [],
  );

  const ground = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: groundVertex,
        fragmentShader: groundFragment,
        uniforms: { uOpacity: { value: 1 } },
        transparent: true,
        depthWrite: false,
      }),
    [],
  );

  const flareMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: flareVertex,
        fragmentShader: flareFragment,
        uniforms: { uOpacity: { value: 1 }, uTime: { value: 0 } },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  const buffer = useMemo(() => new THREE.Vector2(), []);

  useFrame(({ clock }) => {
    const j = scroll.journey;
    // Fully present in the Intro, fading as the camera heads to orbit.
    const t = THREE.MathUtils.clamp((j - 0.45) / 0.35, 0, 1);
    const presence = 1 - t * t * (3 - 2 * t);
    if (group.current) group.current.visible = presence > 0.001;
    if (presence <= 0.001) return;

    const time = reducedMotion ? 0 : clock.elapsedTime;
    const top = rocketAltitude(j) + (reducedMotion ? 0 : Math.sin(time * 0.6) * 0.05);
    gl.getDrawingBufferSize(buffer);
    cloud.uniforms.uTop.value = top;
    cloud.uniforms.uTime.value = time;
    cloud.uniforms.uScale.value = camera.projectionMatrix.elements[5] * buffer.y * 0.5;
    cloud.uniforms.uOpacity.value = presence;
    ground.uniforms.uOpacity.value = presence;
    flareMaterial.uniforms.uOpacity.value = presence;
    flareMaterial.uniforms.uTime.value = time;

    if (rocket.current) rocket.current.position.set(LAUNCH_BASE.x, LAUNCH_BASE.y + top, LAUNCH_BASE.z);
    if (flare.current) {
      flare.current.position.set(LAUNCH_BASE.x, LAUNCH_BASE.y + top - 0.03, LAUNCH_BASE.z);
      flare.current.quaternion.copy(camera.quaternion);
      const dist = camera.position.distanceTo(flare.current.position);
      flare.current.scale.set(dist * 0.6, dist * 0.075, 1);
    }
  });

  return (
    <group ref={group}>
      <mesh material={ground} position={LAUNCH_BASE} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
        <planeGeometry args={[150, 150]} />
      </mesh>
      <points geometry={cloudGeometry} material={cloud} frustumCulled={false} renderOrder={2} />

      <group ref={rocket}>
        <Rocket />
        {/* The flame lights the body from below, the bright smoke fills it from the front, moonlight from above. */}
        <pointLight position={[0, -0.5, 0.5]} color="#ffc89a" intensity={8} distance={8} decay={2} />
        <directionalLight position={[0.6, -0.4, 3]} target={moonTarget} color="#fff1e2" intensity={1.4} />
        <primitive object={moonTarget} />
        <directionalLight position={[-3, 4, 3]} target={moonTarget} color="#b4c4e2" intensity={0.8} />
        <ambientLight intensity={0.05} />
      </group>
      <mesh ref={flare} material={flareMaterial} renderOrder={5} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
}
