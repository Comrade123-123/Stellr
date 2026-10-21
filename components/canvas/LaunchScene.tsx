"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { LAUNCH_BASE, rocketAltitude } from "@/lib/launch";
import { scroll } from "@/lib/scroll";

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
 * The exhaust plume as tens of thousands of glowing grains. Two populations:
 * the column (needle-thin at the rocket, billowing wide at the pad) and the
 * ground cloud (rolling outward from the pad, mostly to the left). Each grain
 * is lit warm by the engine and the pad's afterglow, cool by moonlight; a few
 * percent glitter. Additive blending makes dense regions read as volume.
 */
const plumeVertex = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTop;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uOpacity;
  uniform vec3 uBase;
  varying vec3 vColor;
  varying float vAlpha;
  ${NOISE}

  void main() {
    float t = uTime;
    vec3 p;
    float column = step(aSeed.w, 0.5);
    if (column > 0.5) {
      float s = pow(aSeed.x, 1.5);                       // denser low down
      float spread = mix(3.0, 0.05, pow(s, 0.38));       // wide at the pad, a needle at the top
      float ang = aSeed.y * 6.2831853;
      float rad = spread * sqrt(aSeed.z);
      p = vec3(cos(ang) * rad, s * uTop, sin(ang) * rad);
      p += turb(p * 0.33 + vec3(0.0, -t * 0.22, 0.0)) * spread * 1.5;
    } else {
      float side = aSeed.y < 0.64 ? -1.0 : 1.0;          // the cloud leans left, like a crosswind
      float d = pow(aSeed.x, 0.9) * 13.0;
      float h = mix(4.2, 0.5, smoothstep(0.0, 13.0, d));
      p = vec3(side * d, pow(fract(aSeed.z * 7.31), 1.7) * h, (aSeed.z - 0.5) * (3.0 + d * 0.7));
      p += turb(p * 0.26 + vec3(t * 0.06 * side, -t * 0.05, 0.0)) * vec3(2.6, 1.5, 2.2);
      p.y = max(p.y, 0.02);
    }

    vec4 mv = viewMatrix * vec4(uBase + p, 1.0);
    gl_Position = projectionMatrix * mv;

    float glitter = step(0.955, fract(aSeed.x * 91.7 + aSeed.y * 13.1));
    float size = mix(0.9, 2.4, fract(aSeed.z * 37.1)) * mix(1.0, 0.65, glitter);
    gl_PointSize = max(1.0, size * uPixelRatio * (115.0 / -mv.z));

    // Light: the engine at the top of the column, the pad's afterglow at the base, cool moonlight.
    float toEngine = length(p - vec3(0.0, uTop, 0.0));
    float engine = 1.0 / (1.0 + toEngine * toEngine * 0.08);
    float pad = exp(-length(p) * 0.16);
    vec3 moon = vec3(0.42, 0.47, 0.56);
    vColor = moon * (0.55 + 0.45 * aSeed.z) + vec3(1.0, 0.72, 0.42) * (engine * 2.2 + pad * 0.5);
    float twinkle = 0.55 + 0.45 * sin(t * 3.0 + aSeed.x * 60.0);
    vAlpha = mix(0.2, 0.9 * twinkle, glitter) * uOpacity;
  }
`;

const pointFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = exp(-d * d * 4.0) * vAlpha;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

/* Ground as flowing rows of fine points, lit by the pad and fading into the dark. */
const groundVertex = /* glsl */ `
  attribute vec2 aGrid;   // x along the row, row index (0..1 near→far)
  uniform float uPixelRatio;
  uniform float uOpacity;
  uniform vec3 uBase;
  uniform float uTime;
  varying vec3 vColor;
  varying float vAlpha;
  ${NOISE}

  void main() {
    float z = mix(26.0, -40.0, pow(aGrid.y, 0.8));
    float x = aGrid.x;
    float y = (noise(vec3(x * 0.08, 0.0, z * 0.08)) - 0.5) * 1.6 + sin(x * 0.11 + z * 0.23) * 0.22;
    vec3 p = vec3(x + sin(z * 0.05) * 3.0, y, z);
    vec4 mv = viewMatrix * vec4(uBase + p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(1.0, uPixelRatio * (60.0 / -mv.z));
    float glow = exp(-length(p.xz) * 0.09);
    vColor = vec3(0.45, 0.5, 0.58) * 0.5 + vec3(1.0, 0.72, 0.45) * glow * 1.2;
    vAlpha = (0.32 + 0.6 * glow) * uOpacity * smoothstep(-40.0, -20.0, z);
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

function usePointMaterial(vertex: string) {
  return useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: pointFragment,
        uniforms: {
          uTop: { value: 12 },
          uTime: { value: 0 },
          uPixelRatio: { value: 1 },
          uOpacity: { value: 1 },
          uBase: { value: LAUNCH_BASE },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [vertex],
  );
}

/** A night launch: rocket, glowing particle plume and particle ground. Shown in the Intro, gone by the Hero. */
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
  const camera = useThree((s) => s.camera);
  const pixelRatio = useThree((s) => s.viewport.dpr);

  const plumeGeometry = useMemo(() => {
    const seeds = new Float32Array(plumeCount * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(plumeCount * 3), 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
    return g;
  }, [plumeCount]);

  const groundGeometry = useMemo(() => {
    const rows = Math.round(Math.sqrt(groundCount / 3));
    const perRow = Math.round(groundCount / rows);
    const grid = new Float32Array(rows * perRow * 2);
    let k = 0;
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < perRow; i++) {
        grid[k++] = -55 + (i / perRow) * 110 + (Math.random() - 0.5) * 0.35;
        grid[k++] = (r + Math.random() * 0.4) / rows;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(rows * perRow * 3), 3));
    g.setAttribute("aGrid", new THREE.BufferAttribute(grid, 2));
    return g;
  }, [groundCount]);

  const plume = usePointMaterial(plumeVertex);
  const ground = usePointMaterial(groundVertex);

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
  const hull = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.05, 0.06) }), []);

  useFrame(({ clock }) => {
    const j = scroll.journey;
    // Fully present in the Intro, fading as the camera heads to orbit.
    const t = THREE.MathUtils.clamp((j - 0.45) / 0.35, 0, 1);
    const presence = 1 - t * t * (3 - 2 * t);
    if (group.current) group.current.visible = presence > 0.001;
    if (presence <= 0.001) return;

    const time = reducedMotion ? 0 : clock.elapsedTime;
    const top = rocketAltitude(j) + (reducedMotion ? 0 : Math.sin(time * 0.6) * 0.05);
    for (const m of [plume, ground]) {
      m.uniforms.uTop.value = top;
      m.uniforms.uTime.value = time;
      m.uniforms.uPixelRatio.value = pixelRatio;
      m.uniforms.uOpacity.value = presence;
    }
    flareMaterial.uniforms.uOpacity.value = presence;
    flareMaterial.uniforms.uTime.value = time;

    if (rocket.current) rocket.current.position.set(LAUNCH_BASE.x, LAUNCH_BASE.y + top, LAUNCH_BASE.z);
    if (flare.current) {
      flare.current.position.set(LAUNCH_BASE.x, LAUNCH_BASE.y + top - 0.05, LAUNCH_BASE.z);
      flare.current.quaternion.copy(camera.quaternion);
      const dist = camera.position.distanceTo(flare.current.position);
      flare.current.scale.set(dist * 0.6, dist * 0.075, 1);
    }
  });

  return (
    <group ref={group}>
      <points geometry={groundGeometry} material={ground} frustumCulled={false} />
      <points geometry={plumeGeometry} material={plume} frustumCulled={false} />

      {/* A slim launcher: body, interstage band and nose, seen as a silhouette against its own light. */}
      <group ref={rocket}>
        <mesh material={hull} position={[0, 1.0, 0]}>
          <cylinderGeometry args={[0.055, 0.06, 1.9, 12]} />
        </mesh>
        <mesh material={hull} position={[0, 2.18, 0]}>
          <coneGeometry args={[0.055, 0.45, 12]} />
        </mesh>
      </group>
      <mesh ref={flare} material={flareMaterial} renderOrder={5} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
}
