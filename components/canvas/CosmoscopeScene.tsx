"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls, useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { BODIES, helio, orbitPoints, toScene, type BodyName } from "@/lib/cosmoscope";
import { MakeRoomForPanel, Stars } from "./OrbitScene";

/*
 * The solar system at any moment: the Sun and eight planets where astronomy-engine puts
 * them, each on its real orbit (directions and inclinations true, distances compressed,
 * sizes exaggerated). Ecliptic north is up. Time comes from a shared clock the page
 * controls; the camera flies to a chosen body and then rides along with it.
 */

/** The page's clock: `t` is the shown moment (ms); `rate` is days per second of playback; `live` tracks real time. */
export interface Clock {
  t: number;
  rate: number;
  live: boolean;
}

const GOLD = new THREE.Color("#c9a46a");
const INK = new THREE.Color("#eceef2");
const OVERVIEW = new THREE.Vector3(0, 95, 150);
/** Faster than this, real spin would strobe; planets then turn slowly for show. */
const MAX_TRUE_SPIN_RATE = 0.05;

const coronaFragment = /* glsl */ `
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float glow = pow(max(1.0 - d, 0.0), 3.0) * 0.9 + exp(-d * 9.0) * 0.6;
    gl_FragColor = vec4(vec3(1.0, 0.78, 0.45) * glow, glow);
  }
`;
const coronaVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/** A clickable name tag that follows its body: under planets, over the Sun so the crowded middle stays legible. */
function Tag({ name, onSelect }: { name: BodyName; onSelect: (n: BodyName) => void }) {
  return (
    <Html center zIndexRange={[5, 0]}>
      <button
        type="button"
        onClick={() => onSelect(name)}
        className={`${name === "Sun" ? "mb-12" : "mt-10"} block whitespace-nowrap font-mono text-[10px] tracking-[0.22em] text-ink/55 transition-colors hover:text-ink`}
      >
        {name.toUpperCase()}
      </button>
    </Html>
  );
}

function System({
  clock,
  selected,
  onSelect,
  bodies,
  reducedMotion,
}: {
  clock: React.RefObject<Clock>;
  selected: BodyName | null;
  onSelect: (n: BodyName) => void;
  bodies: React.RefObject<Map<BodyName, THREE.Vector3>>;
  reducedMotion: boolean;
}) {
  const textures = useTexture([...BODIES.map((b) => b.texture), "/textures/2k_saturn_ring_alpha.png"]);
  const camera = useThree((s) => s.camera);

  const parts = useMemo(() => {
    for (const t of textures) t.colorSpace = THREE.SRGBColorSpace;
    const ringMap = textures[textures.length - 1];
    const materials = BODIES.map((b, i) =>
      b.name === "Sun"
        ? new THREE.MeshBasicMaterial({ map: textures[i], color: new THREE.Color(1.6, 1.35, 1.05), toneMapped: false })
        : new THREE.MeshLambertMaterial({ map: textures[i] }),
    );
    // Ring UVs run radially so the 1-D ring texture maps inner → outer edge.
    const ring = new THREE.RingGeometry(1.25, 2.3, 128, 1);
    const pos = ring.attributes.position;
    const uv = ring.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (Math.hypot(pos.getX(i), pos.getY(i)) - 1.25) / 1.05, 0.5);
    const ringMaterial = new THREE.MeshLambertMaterial({ map: ringMap, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const corona = new THREE.ShaderMaterial({
      vertexShader: coronaVertex,
      fragmentShader: coronaFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { materials, ring, ringMaterial, corona };
  }, [textures]);

  // Orbits barely change over a human lifetime: drawn once, from today.
  const orbits = useMemo(() => {
    const today = new Date();
    return BODIES.filter((b) => b.name !== "Sun").map((b) => {
      const g = new THREE.BufferGeometry().setFromPoints(orbitPoints(b.name, today).map((p) => new THREE.Vector3(...p)));
      const m = new THREE.LineBasicMaterial({
        color: b.name === "Earth" ? GOLD : INK,
        transparent: true,
        opacity: b.name === "Earth" ? 0.5 : 0.16,
        depthWrite: false,
      });
      return { name: b.name, line: new THREE.Line(g, m) };
    });
  }, []);

  const groups = useRef(new Map<BodyName, THREE.Group>());
  const spinners = useRef(new Map<BodyName, THREE.Mesh>());
  const corona = useRef<THREE.Mesh>(null);
  const scratch = useMemo<[number, number, number]>(() => [0, 0, 0], []);

  useFrame((_, delta) => {
    const c = clock.current;
    const dt = Math.min(delta, 0.1);
    if (c.live) c.t = Date.now();
    else c.t += dt * c.rate * 86_400_000;
    const date = new Date(c.t);
    const trueSpin = c.live || Math.abs(c.rate) <= MAX_TRUE_SPIN_RATE;
    for (const b of BODIES) {
      const g = groups.current.get(b.name);
      if (!g) continue;
      toScene(helio(b.name, date), scratch);
      g.position.set(scratch[0], scratch[1], scratch[2]);
      const shared = bodies.current.get(b.name);
      if (shared) shared.copy(g.position);
      else bodies.current.set(b.name, g.position.clone());
      const spin = spinners.current.get(b.name);
      if (spin && !reducedMotion) {
        spin.rotation.y = trueSpin ? ((c.t / 3_600_000 / b.spinHours) % 1) * Math.PI * 2 : spin.rotation.y + dt * 0.3 * Math.sign(b.spinHours);
      }
    }
    corona.current?.quaternion.copy(camera.quaternion);
  });

  return (
    <>
      <ambientLight intensity={0.06} />
      <pointLight position={[0, 0, 0]} intensity={3.4} decay={0} />
      {orbits.map((o) => (
        <primitive key={o.name} object={o.line} />
      ))}
      {BODIES.map((b, i) => (
        <group
          key={b.name}
          ref={(g) => {
            if (g) groups.current.set(b.name, g);
          }}
        >
          {/* Tilt the spin axis; the pole's true direction is simplified to a lean away from ecliptic north. */}
          <group rotation={[0, 0, THREE.MathUtils.degToRad(b.tilt)]}>
            <mesh
              ref={(m) => {
                if (m) spinners.current.set(b.name, m);
              }}
              material={parts.materials[i]}
              scale={b.radius}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(b.name);
              }}
            >
              <sphereGeometry args={[1, 64, 64]} />
            </mesh>
            {b.ring && <mesh geometry={parts.ring} material={parts.ringMaterial} scale={b.radius} rotation={[-Math.PI / 2, 0, 0]} />}
          </group>
          {b.name === "Sun" && (
            <mesh ref={corona} material={parts.corona} scale={b.radius * 7}>
              <planeGeometry args={[1, 1]} />
            </mesh>
          )}
          {/* The chosen body fills the view; its tag would only sit on its face. */}
          {selected !== b.name && <Tag name={b.name} onSelect={onSelect} />}
        </group>
      ))}
    </>
  );
}

/**
 * Flies to the chosen body, then rides along with it as it moves, leaving the visitor free to
 * orbit and zoom around it. With nothing chosen, it returns to a view of the whole system.
 */
function Fly({
  selected,
  bodies,
  controls,
}: {
  selected: BodyName | null;
  bodies: React.RefObject<Map<BodyName, THREE.Vector3>>;
  controls: React.RefObject<OrbitControlsImpl | null>;
}) {
  const camera = useThree((s) => s.camera);
  const flying = useRef(true);
  const last = useMemo(() => new THREE.Vector3(), []);
  const goal = useMemo(() => new THREE.Vector3(), []);
  const offset = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    flying.current = true;
  }, [selected]);

  useFrame((_, delta) => {
    const c = controls.current;
    if (!c) return;
    const target = selected ? bodies.current.get(selected) : null;
    if (selected && !target) return;
    const k = 1 - Math.exp(-Math.min(delta, 0.1) * 2.2);
    if (!target) {
      if (!flying.current) return;
      camera.position.lerp(OVERVIEW, k);
      c.target.lerp(goal.set(0, 0, 0), k);
      c.update();
      if (camera.position.distanceTo(OVERVIEW) < 0.05) flying.current = false;
      return;
    }
    const radius = BODIES.find((b) => b.name === selected)!.radius;
    if (flying.current) {
      // Come in from the Sun's side, a little above, so the lit face shows.
      const distance = selected === "Sun" ? radius * 9 : radius * 6 + 0.6;
      offset.copy(target).negate();
      if (offset.lengthSq() < 1e-6) offset.set(0, 0, 1);
      offset.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.7);
      offset.y += 0.35;
      goal.copy(target).add(offset.normalize().multiplyScalar(distance));
      camera.position.lerp(goal, k);
      c.target.lerp(target, k);
      c.update();
      if (camera.position.distanceTo(goal) < distance * 0.01 && c.target.distanceTo(target) < radius * 0.05) flying.current = false;
    } else {
      // Ride along: move camera and target by however far the body moved this frame.
      offset.copy(target).sub(last);
      camera.position.add(offset);
      c.target.add(offset);
      c.update();
    }
    last.copy(target);
  });

  // Stop flying the moment the visitor grabs the view.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const stop = () => (flying.current = false);
    c.addEventListener("start", stop);
    return () => c.removeEventListener("start", stop);
  }, [controls]);
  return null;
}

export default function CosmoscopeScene({
  clock,
  selected,
  onSelect,
  reducedMotion,
}: {
  clock: React.RefObject<Clock>;
  selected: BodyName | null;
  onSelect: (n: BodyName) => void;
  reducedMotion: boolean;
}) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  const bodies = useRef(new Map<BodyName, THREE.Vector3>());
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ fov: 40, near: 0.05, far: 4000, position: [0, 140, 220] }}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      onCreated={({ gl }) => gl.setClearColor("#000000")}
    >
      <group scale={6}>
        <Stars />
      </group>
      <System clock={clock} selected={selected} onSelect={onSelect} bodies={bodies} reducedMotion={reducedMotion} />
      <Fly selected={selected} bodies={bodies} controls={controls} />
      <MakeRoomForPanel />
      <OrbitControls ref={controls} enablePan={false} enableDamping dampingFactor={0.08} rotateSpeed={0.5} minDistance={0.4} maxDistance={600} />
    </Canvas>
  );
}
