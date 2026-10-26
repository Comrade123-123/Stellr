"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls, useTexture } from "@react-three/drei";
import { GeoMoon } from "astronomy-engine";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { asteroidAt, earthAt, flyby, LD_KM, orbitPath, type Elements } from "@/lib/asteroids";
import { MakeRoomForPanel, Stars } from "./OrbitScene";

/*
 * Two views of one asteroid, both from JPL elements propagated in the browser:
 *  - flyby: Earth-centred, 1 lunar distance = 10 units, the true path past Earth over
 *    a few days either side of closest approach, with the Moon where it really is;
 *  - orbit: Sun-centred, 1 AU = 10 units, the asteroid's orbit against Earth's and the
 *    other inner planets', the two bodies racing towards the encounter.
 * Ecliptic coordinates map to the scene as (x, z, −y): ecliptic north is up.
 */

const GOLD = new THREE.Color("#c9a46a");
const ROCK = new THREE.Color("#ff8a4c");
const LD = 10; // scene units per lunar distance (flyby)
const AU = 10; // scene units per AU (orbit)
/** Earth and Moon are drawn this much larger than true scale in the flyby, or they'd be specks. */
const BODY_SCALE = 4;
const EARTH_R = (6371 / LD_KM) * LD * BODY_SCALE;
const MOON_R = (1737 / LD_KM) * LD * BODY_SCALE;
const OBLIQUITY = (23.439291 * Math.PI) / 180;

const toScene = (v: [number, number, number], scale: number) => new THREE.Vector3(v[0] * scale, v[2] * scale, -v[1] * scale);

export type View = "flyby" | "orbit";

function Label({ text, accent = false, below = false }: { text: string; accent?: boolean; below?: boolean }) {
  return (
    <Html center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
      <span
        className={`block whitespace-nowrap font-mono text-[10px] tracking-[0.2em] ${below ? "pt-7" : "pb-7"} ${accent ? "text-gold" : "text-ink/60"}`}
      >
        {text}
      </span>
    </Html>
  );
}

function Line({ points, color, opacity, dashed = false }: { points: THREE.Vector3[]; color: THREE.Color; opacity: number; dashed?: boolean }) {
  const line = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints(points);
    const m = dashed
      ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.6, gapSize: 0.5, depthWrite: false })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const l = new THREE.Line(g, m);
    if (dashed) l.computeLineDistances();
    return l;
  }, [points, color, opacity, dashed]);
  return <primitive object={line} />;
}

const circle = (r: number, n = 128) => Array.from({ length: n + 1 }, (_, k) => new THREE.Vector3(Math.cos((k / n) * Math.PI * 2) * r, 0, Math.sin((k / n) * Math.PI * 2) * r));

/** A soft glowing point, for the asteroid itself and the Sun. */
function Glow({ color, size }: { color: THREE.Color; size: number }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: color } },
        vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `uniform vec3 uColor; varying vec2 vUv;
          void main() { float r = length(vUv - 0.5) * 2.0; float a = exp(-r * r * 6.0) + exp(-r * 18.0) * 2.0; gl_FragColor = vec4(uColor * a, a); }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [color],
  );
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => mesh.current?.quaternion.copy(camera.quaternion));
  return (
    <mesh ref={mesh} material={material} scale={size}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}

function Earth({ radius }: { radius: number }) {
  const [day] = useTexture(["/textures/2k_earth_daymap.jpg"]);
  const material = useMemo(() => {
    day.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshLambertMaterial({ map: day });
  }, [day]);
  return (
    <mesh material={material} scale={radius}>
      <sphereGeometry args={[1, 64, 64]} />
    </mesh>
  );
}

/** Earth-centred: the asteroid's real track past Earth, the Moon at its real place, and a marker riding the path. */
function FlybyView({ el, at, reducedMotion }: { el: Elements; at: Date; reducedMotion: boolean }) {
  const f = useMemo(() => flyby(el, at, 3), [el, at]);
  const path = useMemo(() => f.path.map((p) => toScene([p.km[0] / LD_KM, p.km[1] / LD_KM, p.km[2] / LD_KM], LD)), [f]);
  const closest = useMemo(() => toScene([f.closest.km[0] / LD_KM, f.closest.km[1] / LD_KM, f.closest.km[2] / LD_KM], LD), [f]);
  const moon = useMemo(() => {
    const m = GeoMoon(f.closest.at); // equatorial, AU
    const k = 149_597_870.7 / LD_KM;
    const ecl: [number, number, number] = [m.x * k, (Math.cos(OBLIQUITY) * m.y + Math.sin(OBLIQUITY) * m.z) * k, (-Math.sin(OBLIQUITY) * m.y + Math.cos(OBLIQUITY) * m.z) * k];
    return toScene(ecl, LD);
  }, [f]);
  const rider = useRef<THREE.Group>(null);
  const sun = useMemo(() => {
    const e = earthAt(f.closest.at);
    return toScene([-e[0], -e[1], -e[2]], 1).normalize();
  }, [f]);

  useFrame(({ clock }) => {
    // Ride the path in 10 s, slowing near the closest point the way the real thing does.
    const t = reducedMotion ? 0.5 : (clock.elapsedTime / 10) % 1;
    const idx = t * (path.length - 1);
    const i = Math.floor(idx);
    rider.current?.position.lerpVectors(path[i], path[Math.min(i + 1, path.length - 1)], idx - i);
  });

  return (
    <>
      <directionalLight position={sun.clone().multiplyScalar(50)} intensity={2.2} />
      <ambientLight intensity={0.08} />
      <Earth radius={EARTH_R} />
      <group position={[0, EARTH_R, 0]}>
        <Label text="EARTH" />
      </group>
      <Line points={circle(LD)} color={new THREE.Color(0.8, 0.85, 0.95)} opacity={0.18} />
      <mesh position={moon} scale={MOON_R}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshLambertMaterial color="#9a9a9a" />
      </mesh>
      <group position={moon}>
        <Label text="MOON" />
      </group>
      <Line points={path} color={ROCK} opacity={0.75} />
      <Line points={[new THREE.Vector3(), closest]} color={GOLD} opacity={0.6} dashed />
      <group position={closest}>
        <Glow color={GOLD} size={0.9} />
        <Label text={`CLOSEST · ${(f.closest.distKm / LD_KM).toFixed(2)} LD`} accent />
      </group>
      <group ref={rider}>
        <Glow color={ROCK} size={1.4} />
      </group>
    </>
  );
}

const INNER: [string, number][] = [
  ["MERCURY", 0.387],
  ["VENUS", 0.723],
  ["MARS", 1.524],
];

/** Sun-centred: the asteroid's orbit and Earth's, both bodies moving through the weeks around the encounter. */
function OrbitView({ el, at, reducedMotion }: { el: Elements; at: Date; reducedMotion: boolean }) {
  const orbit = useMemo(() => orbitPath(el).map((p) => toScene(p, AU)), [el]);
  const earthOrbit = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let d = 0; d <= 366; d += 3) pts.push(toScene(earthAt(new Date(at.getTime() + d * 86_400_000)), AU));
    return pts;
  }, [at]);
  const earth = useRef<THREE.Group>(null);
  const rock = useRef<THREE.Group>(null);
  const date = useRef<HTMLSpanElement>(null);

  useFrame(({ clock }) => {
    // 90 days before the approach to 30 after, in 12 s.
    const f = reducedMotion ? 0.75 : (clock.elapsedTime / 12) % 1;
    const t = new Date(at.getTime() + (-90 + f * 120) * 86_400_000);
    earth.current?.position.copy(toScene(earthAt(t), AU));
    rock.current?.position.copy(toScene(asteroidAt(el, t), AU));
    if (date.current) {
      const days = Math.round((t.getTime() - at.getTime()) / 86_400_000);
      date.current.textContent = `${t.toISOString().slice(0, 10)} · ${days === 0 ? "CLOSEST APPROACH" : days < 0 ? `${-days} DAYS BEFORE` : `${days} DAYS AFTER`}`;
    }
  });

  return (
    <>
      <Glow color={new THREE.Color(1, 0.8, 0.5)} size={3} />
      <Label text="SUN" below />
      {/* The clock for the animation, under the Sun where it never collides with the moving bodies. */}
      <Html center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
        <span ref={date} className="block whitespace-nowrap pt-16 font-mono text-[10px] tracking-[0.2em] text-[#ff8a4c]" />
      </Html>
      {INNER.map(([name, r]) => (
        <Line key={name} points={circle(r * AU)} color={new THREE.Color(0.8, 0.85, 0.95)} opacity={0.12} />
      ))}
      <Line points={earthOrbit} color={GOLD} opacity={0.55} />
      <Line points={orbit} color={ROCK} opacity={0.8} />
      <group ref={earth}>
        <mesh scale={0.22}>
          <sphereGeometry args={[1, 24, 24]} />
          <meshBasicMaterial color="#5a8cff" />
        </mesh>
        <Label text="EARTH" accent />
      </group>
      <group ref={rock}>
        <Glow color={ROCK} size={1.1} />
      </group>
    </>
  );
}

/** Frames each view: the flyby around the closest point, the orbit from above and to the side. */
function Frame({ view, el, at, controls }: { view: View; el: Elements; at: Date; controls: React.RefObject<OrbitControlsImpl | null> }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const goal = useMemo(() => {
    const tall = size.width / size.height < 0.9;
    if (view === "orbit") {
      const reach = Math.min(Math.max(el.a * (1 + el.e), 1.6), 4.5) * AU;
      return { position: new THREE.Vector3(reach * 0.35, reach * (tall ? 2.6 : 1.45), reach * (tall ? 1.6 : 1.05)), target: new THREE.Vector3() };
    }
    const f = flyby(el, at, 1);
    const near = f.path.reduce((m, p) => Math.max(m, Math.hypot(...p.km)), 0) / LD_KM;
    const span = Math.max(1.6, Math.min(near, 12)) * LD;
    const c = toScene([f.closest.km[0] / LD_KM, f.closest.km[1] / LD_KM, f.closest.km[2] / LD_KM], LD).multiplyScalar(0.5);
    return { position: c.clone().add(new THREE.Vector3(span * 0.5, span * 0.9, span * (tall ? 2.4 : 1.6))), target: c };
  }, [view, el, at, size]);
  const flying = useRef(true);
  useEffect(() => {
    flying.current = true;
  }, [goal]);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const stop = () => (flying.current = false);
    c.addEventListener("start", stop);
    return () => c.removeEventListener("start", stop);
  }, [controls]);
  useFrame((_, delta) => {
    const c = controls.current;
    if (!flying.current || !c) return;
    const k = 1 - Math.exp(-Math.min(delta, 0.1) * 2.5);
    camera.position.lerp(goal.position, k);
    c.target.lerp(goal.target, k);
    c.update();
    if (camera.position.distanceTo(goal.position) < 0.01) flying.current = false;
  });
  return null;
}

export default function AsteroidScene({ el, at, view, reducedMotion }: { el: Elements | null; at: Date | null; view: View; reducedMotion: boolean }) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ fov: 40, near: 0.01, far: 2000, position: [12, 18, 40] }}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      onCreated={({ gl }) => gl.setClearColor("#000000")}
    >
      <Stars />
      {el && at && view === "flyby" && <FlybyView el={el} at={at} reducedMotion={reducedMotion} />}
      {el && at && view === "orbit" && <OrbitView el={el} at={at} reducedMotion={reducedMotion} />}
      {el && at && <Frame view={view} el={el} at={at} controls={controls} />}
      <MakeRoomForPanel />
      <OrbitControls ref={controls} enablePan={false} enableDamping dampingFactor={0.08} rotateSpeed={0.5} minDistance={0.5} maxDistance={85} />
    </Canvas>
  );
}

