"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls, useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { earthRotation, observerOnGlobe, sunDirection, type Observer } from "@/lib/orbits";
import { getQuality } from "@/lib/quality";
import {
  airFragment,
  airVertex,
  behindEarth,
  earthFragment,
  earthVertex,
  MakeRoomForPanel,
  Stars,
} from "./OrbitScene";

/*
 * Sun → solar wind → magnetosphere → aurora, driven by NOAA's live numbers.
 * Earth sits at the origin with radius 1 and the Sun far down −x; distances and
 * sizes are not to scale (at true scale Earth would be a speck), but every moving
 * part follows the data: wind speed and density, the field's Bz, the flare class
 * and the aurora nowcast.
 */

const SUN = new THREE.Vector3(-44, 0, 0);
const SUN_RADIUS = 7;
/** Magnetosphere size in scene units per Earth radius; the real one is ~10 R⊕ to the nose. */
const MP_SCALE = 0.32;
const GOLD = new THREE.Color("#c9a46a");

export interface Drivers {
  /** Solar wind speed, km/s. */
  speed: number;
  /** Proton density, per cm³. */
  density: number;
  /** Interplanetary field north–south component, nT; negative (southward) couples into Earth's field. */
  bz: number;
  /** GOES 0.1–0.8 nm flux, W/m². */
  flux: number;
}

/**
 * Shue et al. (1998) magnetopause: nose distance r0 (Earth radii) and flaring α
 * from the wind's dynamic pressure and Bz; r(θ) = r0·(2 / (1 + cos θ))^α.
 */
function magnetopause({ speed, density, bz }: Drivers) {
  const pressure = Math.max(0.1, 1.6726e-6 * density * speed * speed); // nPa
  const r0 = (10.22 + 1.29 * Math.tanh(0.184 * (bz + 8.14))) * Math.pow(pressure, -1 / 6.6);
  const alpha = (0.58 - 0.007 * bz) * (1 + 0.024 * Math.log(pressure));
  return { r0, alpha };
}

const sunVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPos;
  varying vec3 vView;
  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vPos = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vView = normalize(cameraPosition - w.xyz);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

/* Boiling granulation and sunspot-dark lanes, limb-darkened; a flare brightens and whitens it. */
const sunFragment = /* glsl */ `
  uniform float uTime;
  uniform float uFlare;
  varying vec3 vNormal;
  varying vec3 vPos;
  varying vec3 vView;
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.1; a *= 0.5; } return s; }
  void main() {
    vec3 p = normalize(vPos);
    float t = uTime * 0.04;
    float cells = fbm(p * 7.0 + vec3(t, -t, t * 0.5));
    float fine = fbm(p * 26.0 - vec3(t * 2.0));
    float spots = smoothstep(0.55, 0.8, fbm(p * 2.2 + vec3(0.0, t * 0.3, 0.0)));
    float mu = clamp(dot(normalize(vNormal), vView), 0.0, 1.0);
    float limb = 0.35 + 0.65 * pow(mu, 0.55);
    vec3 base = mix(vec3(1.0, 0.42, 0.08), vec3(1.0, 0.82, 0.45), cells * 0.8 + fine * 0.35);
    base *= 1.0 - spots * 0.35 * (1.0 - fine);
    base += vec3(1.0, 0.9, 0.7) * spots * fine * uFlare * 1.5;
    vec3 col = base * limb * (1.4 + uFlare * 0.8);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const glowVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
/* Corona: a soft radial glow with faint streamers, larger and brighter during flares. */
const glowFragment = /* glsl */ `
  uniform float uFlare;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    float a = atan(c.y, c.x);
    float streak = 0.6 + 0.4 * sin(a * 9.0 + sin(a * 3.0 + uTime * 0.1) * 2.0);
    float glow = exp(-max(r - 0.3, 0.0) * mix(7.0, 4.0, uFlare)) * (0.5 + 0.5 * streak);
    glow *= 1.0 - smoothstep(0.85, 1.0, r);
    vec3 col = mix(vec3(1.0, 0.55, 0.2), vec3(1.0, 0.9, 0.75), uFlare) * glow * (0.9 + uFlare * 1.2);
    gl_FragColor = vec4(col, glow);
  }
`;

const windVertex = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uSpeed;     // traversals per second
  uniform float uR0;        // magnetopause nose, scene units
  uniform float uAlpha;
  uniform float uPixelRatio;
  uniform vec3 uSun;
  varying float vFade;
  varying float vHot;
  void main() {
    float phase = fract(aSeed.x + uTime * uSpeed * (0.85 + 0.3 * aSeed.w));
    float start = uSun.x + ${SUN_RADIUS.toFixed(1)};
    float x = mix(start, 22.0, phase);
    // Fan out from the Sun's disc into a broad stream that fills the space around Earth.
    float spread = mix(${(SUN_RADIUS * 0.8).toFixed(1)}, 9.0, smoothstep(0.0, 0.45, phase));
    float ang = aSeed.y * 6.2831853;
    float rad = spread * sqrt(aSeed.z);
    vec3 p = vec3(x, cos(ang) * rad, sin(ang) * rad);

    // Flow around the magnetosphere: anything inside the Shue surface is pushed out onto it.
    float r = length(p);
    float cosT = clamp(-p.x / max(r, 1e-3), -1.0, 1.0);
    float theta = min(acos(cosT), 2.4);
    float rmp = uR0 * pow(2.0 / (1.0 + cos(theta)), uAlpha) * 1.08;
    if (cosT > cos(2.4)) {
      if (r < rmp) p *= rmp / max(r, 1e-3);
    } else {
      float rho = length(p.yz);
      float tail = rmp * sin(theta);
      if (rho < tail) p.yz *= tail / max(rho, 1e-3);
    }

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uPixelRatio * 110.0 / -mv.z, 1.5, 3.5);
    vFade = smoothstep(0.0, 0.05, phase) * (1.0 - smoothstep(0.85, 1.0, phase));
    vHot = 1.0 - smoothstep(0.0, 0.3, phase);
  }
`;
const windFragment = /* glsl */ `
  uniform float uDensity;
  varying float vFade;
  varying float vHot;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.4, 1.0, d)) * vFade * uDensity;
    vec3 col = mix(vec3(1.0, 0.86, 0.6), vec3(1.0, 0.6, 0.25), vHot);
    gl_FragColor = vec4(col * a, a);
  }
`;

const shellVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - w.xyz);
    vPos = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
/* The magnetopause as a thin glowing membrane, brighter where the wind presses and when Bz turns south. */
const shellFragment = /* glsl */ `
  uniform float uTime;
  uniform float uStress;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos;
  void main() {
    float rim = pow(1.0 - abs(dot(normalize(vNormal), vView)), 2.5);
    float nose = smoothstep(0.0, 1.0, -normalize(vPos).x);
    float lines = 0.75 + 0.25 * sin(vPos.x * 3.0 - uTime * 1.5);
    vec3 calm = vec3(0.3, 0.65, 1.0);
    vec3 hot = vec3(0.75, 0.45, 1.0);
    vec3 col = mix(calm, hot, uStress) * rim * lines * (0.45 + nose * (0.5 + uStress));
    gl_FragColor = vec4(col, rim * 0.6);
  }
`;

const auroraVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
/*
 * The OVATION nowcast painted on a shell just above the ground: green where the chance
 * is moderate, red fringes at the strongest spots, rippling like curtains, and only on
 * the night side, where aurora can be seen.
 */
const auroraFragment = /* glsl */ `
  uniform sampler2D uGrid;
  uniform vec3 uSun;
  uniform float uTime;
  uniform float uLayer;   // 0 low green layer, 1 high red layer
  varying vec2 vUv;
  varying vec3 vNormal;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    float lonE = mod(vUv.x * 360.0 - 180.0 + 360.0, 360.0);
    float lat = vUv.y * 180.0 - 90.0;
    vec2 st = vec2((lonE / 2.0 + 0.5) / 180.0, ((lat + 90.0) / 2.0 + 0.5) / 91.0);
    float v = texture2D(uGrid, st).r;          // 0–1 (0–100%)
    float night = smoothstep(0.15, -0.2, dot(normalize(vNormal), normalize(uSun)));
    float curtain = 0.55 + 0.45 * n2(vec2(lonE * 0.35 + uTime * 0.25, lat * 2.0 - uTime * 0.6));
    float a = smoothstep(0.03, 0.5, v) * curtain * night;
    vec3 green = vec3(0.25, 1.0, 0.55);
    vec3 red = vec3(1.0, 0.25, 0.45);
    vec3 col = uLayer < 0.5 ? mix(green, vec3(0.5, 1.0, 0.7), smoothstep(0.6, 1.0, v) * 0.6) : red * smoothstep(0.45, 0.95, v);
    gl_FragColor = vec4(col * a * (uLayer < 0.5 ? 1.15 : 0.6), a);
  }
`;

function Sun({ flare, reducedMotion }: { flare: number; reducedMotion: boolean }) {
  const glow = useRef<THREE.Mesh>(null);
  const materials = useMemo(
    () => ({
      sun: new THREE.ShaderMaterial({
        vertexShader: sunVertex,
        fragmentShader: sunFragment,
        uniforms: { uTime: { value: 0 }, uFlare: { value: 0 } },
      }),
      glow: new THREE.ShaderMaterial({
        vertexShader: glowVertex,
        fragmentShader: glowFragment,
        uniforms: { uFlare: { value: 0 }, uTime: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    }),
    [],
  );
  useFrame(({ clock, camera }) => {
    const t = reducedMotion ? 0 : clock.elapsedTime;
    materials.sun.uniforms.uTime.value = t;
    materials.glow.uniforms.uTime.value = t;
    // Ease towards the flare level so a new reading swells in rather than jumps.
    for (const m of [materials.sun, materials.glow]) m.uniforms.uFlare.value += (flare - m.uniforms.uFlare.value) * 0.03;
    glow.current?.quaternion.copy(camera.quaternion);
  });
  return (
    <group position={SUN}>
      <mesh material={materials.sun}>
        <sphereGeometry args={[SUN_RADIUS, 96, 96]} />
      </mesh>
      <mesh ref={glow} material={materials.glow} scale={SUN_RADIUS * 5}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
}

function SolarWind({ drivers, count, reducedMotion }: { drivers: Drivers; count: number; reducedMotion: boolean }) {
  const dpr = useThree((s) => s.viewport.dpr);
  const geometry = useMemo(() => {
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
    return g;
  }, [count]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: windVertex,
        fragmentShader: windFragment,
        uniforms: {
          uTime: { value: 0 },
          uSpeed: { value: 0.07 },
          uR0: { value: 3 },
          uAlpha: { value: 0.6 },
          uDensity: { value: 0.5 },
          uPixelRatio: { value: 1 },
          uSun: { value: SUN },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const target = useMemo(() => {
    const mp = magnetopause(drivers);
    return {
      // 400 km/s crosses the scene in ~14 s; a fast stream twice as quickly.
      speed: (drivers.speed / 400) / 14,
      r0: mp.r0 * MP_SCALE,
      alpha: mp.alpha,
      density: THREE.MathUtils.clamp(0.25 + Math.log2(1 + drivers.density) * 0.18, 0.25, 1),
    };
  }, [drivers]);
  const time = useRef(0);
  useFrame((_, delta) => {
    const u = material.uniforms;
    const k = 1 - Math.exp(-Math.min(delta, 0.1) * 1.5);
    u.uSpeed.value += (target.speed - u.uSpeed.value) * k;
    u.uR0.value += (target.r0 - u.uR0.value) * k;
    u.uAlpha.value += (target.alpha - u.uAlpha.value) * k;
    u.uDensity.value += (target.density - u.uDensity.value) * k;
    u.uPixelRatio.value = dpr;
    // Advance our own clock at the eased speed so a change in speed doesn't make particles jump.
    if (!reducedMotion) time.current += Math.min(delta, 0.1);
    u.uTime.value = time.current;
  });
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={2} />;
}

/** The magnetopause as a surface of revolution about the Sun–Earth line, rebuilt when its shape changes. */
function Magnetosphere({ drivers, reducedMotion }: { drivers: Drivers; reducedMotion: boolean }) {
  const { r0, alpha } = magnetopause(drivers);
  const key = `${r0.toFixed(2)}:${alpha.toFixed(3)}`;
  const geometry = useMemo(() => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 64; i++) {
      const theta = (i / 64) * 2.35;
      const r = r0 * MP_SCALE * Math.pow(2 / (1 + Math.cos(theta)), alpha);
      pts.push(new THREE.Vector2(r * Math.sin(theta), r * Math.cos(theta)));
    }
    return new THREE.LatheGeometry(pts, 96);
    // Rebuilt only when the rounded shape changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: shellVertex,
        fragmentShader: shellFragment,
        uniforms: { uTime: { value: 0 }, uStress: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  // Southward Bz and a compressed nose both read as stress.
  const stress = THREE.MathUtils.clamp(Math.max(0, -drivers.bz) / 15 + Math.max(0, 9 - r0) / 5, 0, 1);
  useFrame(({ clock }) => {
    material.uniforms.uTime.value = reducedMotion ? 0 : clock.elapsedTime;
    material.uniforms.uStress.value += (stress - material.uniforms.uStress.value) * 0.03;
  });
  // The lathe's axis is +y; turn it so +y points at the Sun (−x).
  return <mesh geometry={geometry} material={material} rotation={[0, 0, Math.PI / 2]} renderOrder={3} />;
}

const WORLD_SUN = new THREE.Vector3(-1, 0, 0);

/** Earth, turned to the real time of day so its sunlit side faces this scene's Sun, with the live aurora. */
function Earth({ aurora, observer, reducedMotion }: { aurora: THREE.DataTexture | null; observer: Observer | null; reducedMotion: boolean }) {
  const frame = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const pinGroup = useRef<THREE.Group>(null);
  const pinLabel = useRef<HTMLSpanElement>(null);
  const [day, night, clouds] = useTexture([
    "/textures/2k_earth_daymap.jpg",
    "/textures/2k_earth_nightmap.jpg",
    "/textures/2k_earth_clouds.jpg",
  ]);
  const empty = useMemo(() => {
    const t = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat);
    t.needsUpdate = true;
    return t;
  }, []);
  const materials = useMemo(() => {
    day.colorSpace = THREE.SRGBColorSpace;
    night.colorSpace = THREE.SRGBColorSpace;
    const auroraLayer = (layer: number) =>
      new THREE.ShaderMaterial({
        vertexShader: auroraVertex,
        fragmentShader: auroraFragment,
        uniforms: { uGrid: { value: empty }, uSun: { value: WORLD_SUN }, uTime: { value: 0 }, uLayer: { value: layer } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
    return {
      earth: new THREE.ShaderMaterial({
        vertexShader: earthVertex,
        fragmentShader: earthFragment,
        uniforms: { uDay: { value: day }, uNight: { value: night }, uClouds: { value: clouds }, uSun: { value: WORLD_SUN } },
      }),
      air: new THREE.ShaderMaterial({
        vertexShader: airVertex,
        fragmentShader: airFragment,
        uniforms: { uSun: { value: WORLD_SUN } },
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      green: auroraLayer(0),
      red: auroraLayer(1),
    };
  }, [day, night, clouds, empty]);

  useEffect(() => {
    for (const m of [materials.green, materials.red]) m.uniforms.uGrid.value = aurora ?? empty;
  }, [aurora, empty, materials]);

  const pin = useMemo(() => (observer ? new THREE.Vector3(...observerOnGlobe(observer)) : null), [observer]);
  const sunEci = useMemo(() => new THREE.Vector3(), []);
  const pinWorld = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock, camera }) => {
    const now = new Date();
    // Turn the inertial frame so the real Sun direction lines up with this scene's Sun.
    sunEci.set(...sunDirection(now));
    frame.current?.quaternion.setFromUnitVectors(sunEci, WORLD_SUN);
    if (spin.current) spin.current.rotation.y = earthRotation(now);
    const t = reducedMotion ? 0 : clock.elapsedTime;
    materials.green.uniforms.uTime.value = t;
    materials.red.uniforms.uTime.value = t;
    if (pinGroup.current && pinLabel.current) {
      pinGroup.current.getWorldPosition(pinWorld);
      pinLabel.current.style.opacity = behindEarth(camera.position, pinWorld) ? "0" : "1";
    }
  });

  return (
    <group ref={frame}>
      <group ref={spin}>
        <mesh material={materials.earth}>
          <sphereGeometry args={[1, 96, 96]} />
        </mesh>
        <mesh material={materials.green} scale={1.012} renderOrder={4}>
          <sphereGeometry args={[1, 128, 64]} />
        </mesh>
        <mesh material={materials.red} scale={1.03} renderOrder={4}>
          <sphereGeometry args={[1, 128, 64]} />
        </mesh>
        {pin && (
          <group ref={pinGroup} position={pin.clone().multiplyScalar(1.004)}>
            <mesh>
              <sphereGeometry args={[0.008, 12, 12]} />
              <meshBasicMaterial color={GOLD} toneMapped={false} />
            </mesh>
            <Html center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
              <span ref={pinLabel} className="block whitespace-nowrap pt-7 font-mono text-[10px] tracking-[0.22em] text-gold">
                YOU
              </span>
            </Html>
          </group>
        )}
      </group>
      <mesh material={materials.air} scale={1.045}>
        <sphereGeometry args={[1, 64, 64]} />
      </mesh>
    </group>
  );
}

export type View = "system" | "aurora";

const VIEWS: Record<View, { position: THREE.Vector3; target: THREE.Vector3 }> = {
  // Sun on the left, the stream crossing to Earth and its shield on the right.
  // Framed so the Sun sits near the left edge and Earth left of the panel on wide screens.
  system: { position: new THREE.Vector3(-20, 22, 75), target: new THREE.Vector3(-20, 0, 0) },
  // Close over the night side, looking down on the northern oval.
  aurora: { position: new THREE.Vector3(2.4, 2.6, 0.9), target: new THREE.Vector3(0, 0.35, 0) },
};

/** Flies the camera to the chosen view; the visitor can still drag around it afterwards. */
function Fly({ view, controls }: { view: View; controls: React.RefObject<OrbitControlsImpl | null> }) {
  const camera = useThree((s) => s.camera);
  const flying = useRef(true);
  useEffect(() => {
    flying.current = true;
  }, [view]);
  useFrame((_, delta) => {
    const c = controls.current;
    if (!flying.current || !c) return;
    const goal = VIEWS[view];
    const k = 1 - Math.exp(-Math.min(delta, 0.1) * 2.2);
    camera.position.lerp(goal.position, k);
    c.target.lerp(goal.target, k);
    c.update();
    if (camera.position.distanceTo(goal.position) < 0.02 && c.target.distanceTo(goal.target) < 0.02) flying.current = false;
  });
  // Grabbing the scene stops the flight.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const stop = () => (flying.current = false);
    c.addEventListener("start", stop);
    return () => c.removeEventListener("start", stop);
  }, [controls]);
  return null;
}

export default function SpaceWeatherScene({
  drivers,
  aurora,
  observer,
  view,
}: {
  drivers: Drivers;
  aurora: THREE.DataTexture | null;
  observer: Observer | null;
  view: View;
}) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  const quality = useMemo(() => getQuality(), []);
  const count = quality.tier === "high" ? 7000 : quality.tier === "medium" ? 4500 : 2500;
  // Flare intensity 0–1: B and below calm, C a little, M clearly, X fully.
  const flare = THREE.MathUtils.clamp((Math.log10(Math.max(drivers.flux, 1e-9)) + 7) / 3, 0, 1);
  return (
    <Canvas
      dpr={quality.dpr}
      camera={{ fov: 40, near: 0.01, far: 600, position: VIEWS.system.position.toArray() }}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      onCreated={({ gl, camera, size }) => {
        gl.setClearColor("#000000");
        // Portrait screens can't fit Sun and Earth side by side: frame Earth and the incoming
        // stream, with the Sun's glow at the left edge.
        if (size.width / size.height < 0.9) {
          VIEWS.system.position.set(-5, 7, 24);
          VIEWS.system.target.set(-3.5, 0, 0);
        }
        camera.position.copy(VIEWS.system.position);
      }}
    >
      <Stars />
      <Sun flare={flare} reducedMotion={quality.reducedMotion} />
      <SolarWind drivers={drivers} count={count} reducedMotion={quality.reducedMotion} />
      <Magnetosphere drivers={drivers} reducedMotion={quality.reducedMotion} />
      <Earth aurora={aurora} observer={observer} reducedMotion={quality.reducedMotion} />
      <MakeRoomForPanel />
      <Fly view={view} controls={controls} />
      <OrbitControls
        ref={controls}
        target={VIEWS.system.target.toArray()}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.5}
        minDistance={1.4}
        maxDistance={85}
      />
    </Canvas>
  );
}
