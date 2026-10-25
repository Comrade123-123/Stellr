"use client";

import { useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { GALAXY_CENTER, GALAXY_QUATERNION, GALAXY_RADIUS } from "@/lib/galaxy";
import { scroll, sceneIndex } from "@/lib/scroll";
import { SUN_POSITION } from "@/lib/solar";

const NOISE = /* glsl */ `
  float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * n2(p); p = p * 2.07 + 13.1; a *= 0.5; }
    return v;
  }
`;

// Spiral geometry of the disk shader.
const PITCH = 2.9; // 1 / tan(pitch angle ≈ 19°): how tightly the arms wind
const BAR_ANGLE = 0.45;

const diskVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = (uv - 0.5) * 2.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/*
 * The unresolved light of a barred spiral seen from outside: a small warm core
 * and bar, two loosely wound arms broken into flocculent star clouds of young
 * blue stars, pink star-forming knots, and dark dust lanes along the inner edge
 * of each arm with filaments of dust between them.
 */
const diskFragment = /* glsl */ `
  uniform float uOpacity;
  varying vec2 vP;
  ${NOISE}

  void main() {
    vec2 p = vP;
    float r = length(p);
    if (r > 1.0 || uOpacity <= 0.0) discard;
    float th = atan(p.y, p.x);

    float c = cos(${BAR_ANGLE}), s = sin(${BAR_ANGLE});
    vec2 q = mat2(c, -s, s, c) * p;
    float bar = exp(-pow(length(q * vec2(1.0, 3.2)) / 0.15, 1.4));
    float core = exp(-r / 0.022) + exp(-pow(r / 0.11, 0.8)) * 0.35;
    float disk = exp(-r / 0.32) * (1.0 - smoothstep(0.75, 1.0, r));

    float warp = fbm(p * 3.0) * 0.9;
    float ph = th + ${PITCH.toFixed(2)} * log(max(r, 0.03)) + warp;
    float arms = pow(0.5 + 0.5 * cos(2.0 * ph), 2.2) * smoothstep(0.12, 0.24, r);
    // Arms break up into separate star clouds rather than running as smooth bands.
    float clouds = smoothstep(0.22, 0.8, fbm(p * 9.0 + warp * 1.5));
    // Grain at two scales, so the arms read as crowds of stars rather than smooth smoke.
    float speckle = fbm(p * 46.0 + 2.0) * 0.6 + n2(p * 160.0) * 0.4;
    float light = disk * (0.08 + 2.4 * arms * clouds) * (0.35 + 1.3 * speckle * speckle);

    // Dust: lanes on the inner edge of each arm, plus filaments across the inner disk.
    float lane = pow(0.5 + 0.5 * cos(2.0 * (ph - 0.5)), 7.0) * smoothstep(0.07, 0.22, r) * (1.0 - smoothstep(0.6, 0.95, r));
    float filaments = smoothstep(0.5, 0.72, fbm(p * 14.0 + 5.0)) * smoothstep(0.05, 0.15, r) * (1.0 - smoothstep(0.5, 0.8, r));
    float dust = clamp(lane * (0.4 + 1.2 * fbm(p * 24.0 + 4.0)) + filaments * 0.35, 0.0, 0.85);
    float knots = smoothstep(0.66, 0.84, fbm(p * 38.0 + 3.1)) * arms * clouds * smoothstep(0.2, 0.35, r);

    vec3 young = vec3(0.6, 0.72, 1.0);
    vec3 old = vec3(1.0, 0.84, 0.62);
    vec3 col = vec3(1.0, 0.82, 0.58) * (core * 1.6 + bar * 0.7)
             + mix(old, young, smoothstep(0.1, 0.4, r) * clamp(arms * clouds * 2.0, 0.0, 1.0)) * light
             + vec3(1.0, 0.4, 0.55) * knots * disk * 2.6;
    col *= 1.0 - dust;
    gl_FragColor = vec4(col * uOpacity * 0.7, 1.0);
  }
`;

/* The bulge's glow seen face-on to the camera, so the centre keeps its depth from any angle. */
const bulgeVertex = diskVertex;
const bulgeFragment = /* glsl */ `
  uniform float uOpacity;
  varying vec2 vP;
  void main() {
    float r = length(vP);
    float glow = exp(-r * 10.0) * 0.55 + exp(-r * 3.0) * 0.08;
    gl_FragColor = vec4(vec3(1.0, 0.8, 0.56) * glow * uOpacity * (1.0 - smoothstep(0.8, 1.0, r)), 1.0);
  }
`;

const starVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  uniform float uScale;
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float px = aSize * uScale / -mv.z;
    gl_PointSize = clamp(px, 1.0, 2.5);
    // Stars smaller than a pixel dim instead of shrinking, so distant ones fade rather than flicker.
    vColor = aColor * uOpacity * clamp(px, 0.15, 1.0);
  }
`;
const starFragment = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float core = exp(-d * d * 4.0) * (1.0 - smoothstep(0.8, 1.0, d));
    gl_FragColor = vec4(vColor * core, 1.0);
  }
`;

/** Resolved stars: a thick swarm in the bulge and a thin, even scatter across the disk. */
function makeStars(count: number) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  const old = new THREE.Color(1.0, 0.82, 0.62);
  const young = new THREE.Color(0.7, 0.8, 1.0);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const kind = Math.random();
    let x: number, y: number, z: number;
    if (kind < 0.22) {
      // Bulge: a squashed spheroid.
      const r = -Math.log(1 - Math.random() * 0.98) * 0.07;
      const v = new THREE.Vector3().randomDirection().multiplyScalar(r);
      x = v.x;
      y = v.y * 0.55;
      z = v.z;
      c.copy(old);
    } else {
      // Disk: exponential in radius, spread evenly round; the shader draws the arms.
      const r = Math.min(0.98, 0.1 + -Math.log(1 - Math.random() * 0.95) * 0.28);
      const th = Math.random() * Math.PI * 2;
      x = Math.cos(th) * r;
      z = Math.sin(th) * r;
      y = gauss() * 0.012;
      c.copy(old).lerp(young, Math.random() * 0.8);
    }
    positions.set([x * GALAXY_RADIUS, y * GALAXY_RADIUS, -z * GALAXY_RADIUS], i * 3);
    const brightness = 0.15 + Math.random() ** 6 * 1.1;
    colors.set([c.r * brightness, c.g * brightness, c.b * brightness], i * 3);
    sizes[i] = 1.5 + Math.random() ** 4 * 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  g.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  return g;
}

/** The Milky Way from outside: shown for the roadmap, and around the black hole at its centre for the ending. */
export default function Galaxy({ starCount }: { starCount: number }) {
  const root = useRef<THREE.Group>(null);
  const bulge = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const cosmo = sceneIndex("cosmoscope");
  const ending = sceneIndex("cta");
  const roadmap = sceneIndex("roadmap");
  const [pin, setPin] = useState(false);

  const materials = useMemo(() => {
    const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
    return {
      disk: new THREE.ShaderMaterial({
        vertexShader: diskVertex,
        fragmentShader: diskFragment,
        uniforms: { uOpacity: { value: 0 } },
        side: THREE.DoubleSide,
        ...additive,
      }),
      bulge: new THREE.ShaderMaterial({
        vertexShader: bulgeVertex,
        fragmentShader: bulgeFragment,
        uniforms: { uOpacity: { value: 0 } },
        ...additive,
      }),
      stars: new THREE.ShaderMaterial({
        vertexShader: starVertex,
        fragmentShader: starFragment,
        uniforms: { uOpacity: { value: 0 }, uScale: { value: 500 } },
        ...additive,
      }),
    };
  }, []);
  const stars = useMemo(() => makeStars(starCount), [starCount]);
  const buffer = useMemo(() => new THREE.Vector2(), []);

  useFrame(() => {
    const j = scroll.view;
    const showPin = Math.abs(j - roadmap) < 0.45;
    if (showPin !== pin) setPin(showPin);
    // In as the camera leaves the planets behind.
    const t = THREE.MathUtils.clamp((j - (cosmo + 0.25)) / 0.6, 0, 1);
    // Almost gone by the ending, so the black hole sits on a dark sky.
    const inside = THREE.MathUtils.clamp((j - (ending - 0.85)) / 0.6, 0, 1);
    const fade = t * t * (3 - 2 * t) * (1 - 0.99 * inside * inside * (3 - 2 * inside));
    if (root.current) root.current.visible = fade > 0.001;
    if (fade <= 0.001) return;
    materials.disk.uniforms.uOpacity.value = fade;
    materials.bulge.uniforms.uOpacity.value = fade;
    materials.stars.uniforms.uOpacity.value = fade;
    gl.getDrawingBufferSize(buffer);
    materials.stars.uniforms.uScale.value = camera.projectionMatrix.elements[5] * buffer.y * 0.5;
    bulge.current?.quaternion.copy(camera.quaternion);
  });

  return (
    <group ref={root} visible={false}>
      <group position={GALAXY_CENTER} quaternion={GALAXY_QUATERNION}>
        <mesh material={materials.disk} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1} frustumCulled={false}>
          <planeGeometry args={[GALAXY_RADIUS * 2, GALAXY_RADIUS * 2]} />
        </mesh>
        <points geometry={stars} material={materials.stars} renderOrder={1} frustumCulled={false} />
      </group>
      <mesh ref={bulge} position={GALAXY_CENTER} material={materials.bulge} renderOrder={2} frustumCulled={false}>
        <planeGeometry args={[GALAXY_RADIUS * 0.9, GALAXY_RADIUS * 0.9]} />
      </mesh>
      {pin && (
        <group position={SUN_POSITION}>
          <Html center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
            <YouAreHere />
          </Html>
        </group>
      )}
    </group>
  );
}

/** A gold pin on the Sun's place in the disk, shown around the roadmap. */
function YouAreHere() {
  return (
    <span className="flex flex-col items-center gap-2 font-mono text-[10px] tracking-[0.22em] text-gold">
      <span className="block h-[7px] w-[7px] rounded-full bg-gold shadow-[0_0_10px_2px_rgba(201,164,106,0.7)]" />
      <span className="whitespace-nowrap">SUN · YOU ARE HERE</span>
    </span>
  );
}
