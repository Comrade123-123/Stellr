"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls, useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { asteroidAt, orbitPath, swarmAt, type Elements } from "@/lib/asteroids";
import {
  BODIES,
  CRAFT,
  bodyFrame,
  EARTH_UNITS,
  MOONS,
  STORM_LOCAL,
  blendRadius,
  helio,
  moonDistance,
  moonOffset,
  orbitPoints,
  sceneDistance,
  toScene,
  trackAt,
  trueRadius,
  type BodyName,
  type Track,
} from "@/lib/cosmoscope";
import { getQuality } from "@/lib/quality";
import type { Swarm } from "./AsteroidScene";
import { Stars } from "./OrbitScene";
import { RING_VERTEX } from "./cosmoscope/glsl";
import CraftModel from "./cosmoscope/CraftModel";
import { AIR, THIN_RINGS, airMaterial, cloudMaterial, moonMaterial, onGlobe, planetMaterial, plateLines, potatoGeometry, thinRing, type Common } from "./cosmoscope/materials";

/*
 * The solar system at any moment: the Sun, the planets and Pluto where astronomy-engine puts
 * them, each on its real orbit (directions and inclinations true) and turned to its real pole
 * and spin, with twenty moons, four spacecraft on their JPL trajectories, and optionally
 * asteroids. Surfaces are shaded in ./cosmoscope/glsl.ts: Earth's night lights and ocean glint,
 * Jupiter's polar cyclones, Saturn's hexagon and ring shadows, and the moons after spacecraft
 * images. Two scales, glided between: compressed distances with enlarged bodies (so everything
 * is visible), and true scale. Ecliptic north is up. Time comes from a clock the page controls;
 * the camera flies to a chosen object and then rides along with it.
 */

/** The page's clock: `t` is the shown moment (ms); `rate` is days per second of playback; `live` tracks real time. */
export interface Clock {
  t: number;
  rate: number;
  live: boolean;
}

/** A particular view of the chosen body; `n` makes a repeat request a new one. */
export interface Look {
  kind: "storm" | "rings" | "north" | "south" | "plates" | "journey" | "close";
  n: number;
}

/** One chosen asteroid, from Asteroid Sentinel. */
export interface Rock {
  el: Elements;
  name: string;
}

/** What the map shows. */
export interface Layers {
  orbits: boolean;
  labels: boolean;
  moons: boolean;
  craft: boolean;
  plates: boolean;
}

const GOLD = new THREE.Color("#c9a46a");
const INK = new THREE.Color("#eceef2");
const CRAFT_COLOR = new THREE.Color("#7fd4ff");
const ROCK_COLOR = new THREE.Color("#ff8a4c");
const OVERVIEW = new THREE.Vector3(0, 95, 150);
/** Faster than this, real spin would strobe; planets then turn slowly for show. */
const MAX_TRUE_SPIN_RATE = 0.05;
/** Radius the camera treats spacecraft and asteroids as having, for framing them. */
const MARKER_RADIUS = 0.15;

/** Positions, drawn radii and the scale blend, shared by everything in the scene each frame. */
interface Shared {
  places: Map<string, THREE.Vector3>;
  radii: Map<string, number>;
  /** 0 compressed … 1 true scale. */
  mix: number;
  /** The clock's moment this frame. */
  date: Date;
  /** North poles (scene axes) of the bodies. */
  axes: Map<string, THREE.Vector3>;
  /** Each spacecraft's path so far, as a bounding sphere in scene units, for framing it whole. */
  paths: Map<string, THREE.Sphere>;
}

const coronaFragment = /* glsl */ `
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float glow = pow(max(1.0 - d, 0.0), 3.0) * 0.9 + exp(-d * 9.0) * 0.6;
    gl_FragColor = vec4(vec3(1.0, 0.78, 0.45) * glow, glow);
  }
`;
const glowFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float a = (exp(-r * r * 6.0) + exp(-r * 18.0) * 2.0) * uAlpha;
    gl_FragColor = vec4(uColor * a, a);
  }
`;
const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const place = (shared: React.RefObject<Shared>, key: string, at: THREE.Vector3, radius: number) => {
  const p = shared.current.places.get(key);
  if (p) p.copy(at);
  else shared.current.places.set(key, at.clone());
  shared.current.radii.set(key, radius);
};

/** A clickable name tag that follows its object, with a dot marking the spot when the object itself is too small to see. */
function Tag({ id, label, onSelect, dot = false, above = false, tone = "text-ink/60" }: { id: string; label: string; onSelect: (id: string) => void; dot?: boolean; above?: boolean; tone?: string }) {
  return (
    <Html center zIndexRange={[5, 0]}>
      <div className="relative">
        <span className={`block h-1.5 w-1.5 rounded-full bg-ink/80 transition-opacity duration-700 ${dot ? "opacity-100" : "opacity-0"}`} />
        <button
          type="button"
          onClick={() => onSelect(id)}
          className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-1.5 py-0.5 font-mono text-[10px] tracking-[0.22em] transition-colors hover:bg-ink/10 hover:text-ink ${tone} ${
            above ? "bottom-full mb-9" : "top-full mt-6"
          }`}
        >
          {label.toUpperCase()}
        </button>
      </div>
    </Html>
  );
}

/** A label pinned to a spot on a globe, shown only while that spot faces the camera. */
function SurfaceLabel({ at, text, tone = "text-gold", track }: { at: [number, number, number]; text: string; tone?: string; track?: (world: THREE.Vector3) => void }) {
  const group = useRef<THREE.Group>(null);
  const label = useRef<HTMLSpanElement>(null);
  const world = useMemo(() => new THREE.Vector3(), []);
  const center = useMemo(() => new THREE.Vector3(), []);
  const toCam = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    const g = group.current;
    if (!g?.parent) return;
    g.getWorldPosition(world);
    g.parent.getWorldPosition(center);
    track?.(world);
    toCam.copy(camera.position).sub(world);
    const facing = world.sub(center).dot(toCam) > 0;
    if (label.current) label.current.style.opacity = facing ? "1" : "0";
  });
  return (
    <group ref={group} position={at}>
      <Html center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
        <span ref={label} className={`block whitespace-nowrap pt-10 font-mono text-[9px] tracking-[0.22em] transition-opacity duration-500 ${tone}`}>
          {text}
        </span>
      </Html>
    </group>
  );
}

/**
 * A soft glowing point that always faces the camera. It keeps the same apparent size however
 * close the camera comes (`size` is a fraction of the distance to it), so a spacecraft stays a
 * point of light rather than swelling to fill the screen.
 */
function Glow({ color, size, overlay = false, fadeNear = 0 }: { color: THREE.Color; size: number; overlay?: boolean; fadeNear?: number }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: color }, uAlpha: { value: 1 } },
        vertexShader: quadVertex,
        fragmentShader: glowFragment,
        transparent: true,
        depthWrite: false,
        // An overlay is drawn over the enlarged planets, which can swallow an object passing close by.
        depthTest: !overlay,
        blending: THREE.AdditiveBlending,
      }),
    [color, overlay],
  );
  const mesh = useRef<THREE.Mesh>(null);
  const world = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    const m = mesh.current;
    if (!m) return;
    m.quaternion.copy(camera.quaternion);
    const d = camera.position.distanceTo(m.getWorldPosition(world));
    m.scale.setScalar(d * size);
    // Close up, a model takes over from the point of light.
    if (fadeNear) material.uniforms.uAlpha.value = THREE.MathUtils.smoothstep(d, fadeNear * 0.5, fadeNear * 2);
  });
  return (
    <mesh ref={mesh} material={material}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}

/** A line through heliocentric ecliptic points (AU) that follows the scale blend. */
function useScaledLine(points: ArrayLike<number>[] | null, color: THREE.Color, opacity: number) {
  const line = useMemo(() => {
    if (!points || points.length < 2) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(points.length * 3), 3));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    l.frustumCulled = false;
    return { line: l, points, mix: -1 };
  }, [points, color, opacity]);
  const out = useMemo<[number, number, number]>(() => [0, 0, 0], []);
  const update = (mix: number) => {
    if (!line || Math.abs(line.mix - mix) < 1e-4) return;
    const attr = line.line.geometry.getAttribute("position") as THREE.BufferAttribute;
    line.points.forEach((p, i) => {
      toScene(p, out, mix);
      attr.setXYZ(i, out[0], out[1], out[2]);
    });
    attr.needsUpdate = true;
    line.mix = mix;
  };
  return { object: line?.line ?? null, update };
}

function OrbitLine({ points, color, opacity, shared, highlight }: { points: ArrayLike<number>[]; color: THREE.Color; opacity: number; shared: React.RefObject<Shared>; highlight: boolean }) {
  const { object, update } = useScaledLine(points, color, opacity);
  useEffect(() => {
    if (!object) return;
    const m = object.material as THREE.LineBasicMaterial;
    m.opacity = highlight ? Math.min(0.75, opacity * 3.2) : opacity;
  }, [object, highlight, opacity]);
  useFrame(() => update(shared.current.mix));
  return object ? <primitive object={object} /> : null;
}

/*
 * Saturn's rings lit by the Sun at the origin: bright on the sunlit face, dimmer (light
 * scattered through) on the other, and darkened where the planet's shadow falls across them.
 */
const ringFragment = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 uCenter;
  uniform float uRadius;
  uniform float uFill;
  varying vec3 vRing;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec4 t = texture2D(map, vec2((length(vRing.xy) - 1.25) / 1.05, 0.5));
    vec3 toSun = normalize(-vWorld);
    vec3 oc = vWorld - uCenter;
    float b = dot(oc, toSun);
    float c = dot(oc, oc) - uRadius * uRadius;
    float shadow = (b < 0.0 && b * b - c > 0.0) ? 0.06 : 1.0;
    vec3 view = normalize(cameraPosition - vWorld);
    float sunward = dot(vNormal, toSun) * dot(vNormal, view) > 0.0 ? 1.0 : 0.38;
    float k = sunward * (0.6 + 0.4 * sqrt(abs(dot(vNormal, toSun)))) * shadow + uFill * 0.4;
    gl_FragColor = vec4(t.rgb * k * 1.35, t.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Just above the Great Red Spot, in Jupiter's own axes. */
const GRS_LOCAL: [number, number, number] = [STORM_LOCAL[0] * 1.01, STORM_LOCAL[1] * 1.01, STORM_LOCAL[2] * 1.01];

/** Earth's major plates, labelled near their middles (approximate). */
const PLATES: [string, number, number][] = [
  ["PACIFIC", -5, -150],
  ["NORTH AMERICAN", 48, -100],
  ["SOUTH AMERICAN", -18, -55],
  ["EURASIAN", 52, 75],
  ["AFRICAN", 2, 18],
  ["ANTARCTIC", -78, 60],
  ["AUSTRALIAN", -25, 130],
  ["INDIAN", 10, 75],
  ["NAZCA", -18, -92],
  ["ARABIAN", 23, 47],
  ["PHILIPPINE SEA", 18, 133],
  ["CARIBBEAN", 15, -75],
  ["COCOS", 9, -95],
];

/** Earth's plate boundaries, loaded the first time they're asked for. */
function Plates({ selected }: { selected: boolean }) {
  const [lines, setLines] = useState<THREE.LineSegments | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/data/earth-plates.json")
      .then((res) => res.json())
      .then((data) => !cancelled && setLines(plateLines(data)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  if (!lines) return null;
  return (
    <>
      <primitive object={lines} />
      {selected && PLATES.map(([name, lat, lon]) => <SurfaceLabel key={name} at={onGlobe(lat, lon, 1.01)} text={name} tone="text-[#ffd49a]" />)}
    </>
  );
}

const PLANET_TEXTURES = ["/textures/2k_saturn_ring_alpha.png", "/textures/2k_earth_nightmap.jpg", "/textures/2k_earth_clouds.jpg"];

function Planets({
  clock,
  shared,
  common,
  trueScale,
  selected,
  onSelect,
  reducedMotion,
  layers,
  segments,
}: {
  clock: React.RefObject<Clock>;
  shared: React.RefObject<Shared>;
  common: Common;
  trueScale: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  reducedMotion: boolean;
  layers: Layers;
  segments: number;
}) {
  const mapped = BODIES.filter((b) => b.texture);
  const textures = useTexture([...mapped.map((b) => b.texture!), ...PLANET_TEXTURES]);
  const camera = useThree((s) => s.camera);

  const parts = useMemo(() => {
    for (const t of textures) {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
    }
    const [ringMap, nightMap, cloudMap] = textures.slice(mapped.length);
    cloudMap.colorSpace = THREE.NoColorSpace;
    const map = (b: (typeof BODIES)[number]) => (b.texture ? textures[mapped.indexOf(b)] : undefined);
    const materials = BODIES.map((b) => planetMaterial(b.name, common, { map: map(b), night: b.name === "Earth" ? nightMap : undefined, ring: b.name === "Saturn" ? ringMap : undefined }));
    // The ring texture runs from the inner edge (1.25 radii) to the outer (2.3); the shader reads it by radius.
    const ring = new THREE.RingGeometry(1.25, 2.3, 256, 1);
    const ringMaterial = new THREE.ShaderMaterial({
      uniforms: { map: { value: ringMap }, uCenter: { value: new THREE.Vector3() }, uRadius: { value: 1 }, uFill: common.uFill },
      vertexShader: RING_VERTEX,
      fragmentShader: ringFragment,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const corona = new THREE.ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: coronaFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const air = new Map(BODIES.filter((b) => AIR[b.name]).map((b) => [b.name, airMaterial(b.name)]));
    const clouds = cloudMaterial(common, cloudMap);
    const thin = new Map(BODIES.filter((b) => THIN_RINGS[b.name]).map((b) => [b.name, thinRing(b.name)]));
    return { materials, ring, ringMaterial, corona, air, clouds, thin };
    // `mapped` is derived from the constant BODIES; `common` is made once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textures]);

  // Orbits barely change over a human lifetime: traced once, from today.
  const orbits = useMemo(() => {
    const today = new Date();
    return BODIES.filter((b) => b.name !== "Sun").map((b) => ({ name: b.name, points: orbitPoints(b.name, today) }));
  }, []);

  const groups = useRef(new Map<string, THREE.Group>());
  /** Each body's turned and scaled frame: x its prime meridian, y its north pole. */
  const frames = useRef(new Map<string, THREE.Group>());
  /** Spin angle used for show while time runs too fast for the true one, per body. */
  const showSpin = useRef(new Map<string, number>());
  const corona = useRef<THREE.Mesh>(null);
  const clouds = useRef<THREE.Mesh>(null);
  const scratch = useMemo<[number, number, number]>(() => [0, 0, 0], []);
  const at = useMemo(() => new THREE.Vector3(), []);
  const basis = useMemo(() => ({ m: new THREE.Matrix4(), x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3() }), []);

  useFrame((_, delta) => {
    // This runs first each frame: it moves the clock and the scale blend for everything else.
    const c = clock.current;
    const s = shared.current;
    const dt = Math.min(delta, 0.1);
    if (c.live) c.t = Date.now();
    else c.t += dt * c.rate * 86_400_000;
    s.date = new Date(c.t);
    if (!reducedMotion) common.uTime.value += dt;
    const goal = trueScale ? 1 : 0;
    s.mix += (goal - s.mix) * (1 - Math.exp(-dt * 1.6));
    if (Math.abs(goal - s.mix) < 1e-3) s.mix = goal;

    const trueSpin = (c.live || Math.abs(c.rate) <= MAX_TRUE_SPIN_RATE) && !reducedMotion;
    BODIES.forEach((b, i) => {
      const g = groups.current.get(b.name);
      if (!g) return;
      toScene(helio(b.name, s.date), scratch, s.mix);
      at.set(scratch[0], scratch[1], scratch[2]);
      g.position.copy(at);
      const radius = blendRadius(b.radius, trueRadius(b.diameterKm), s.mix);
      place(shared, b.name, at, radius);

      // Real pole and real spin (IAU), or a slow turn for show when time runs fast.
      const shown = showSpin.current.get(b.name);
      const spin = trueSpin || shown === undefined ? undefined : reducedMotion ? shown : shown + dt * 20 * Math.sign(b.spinHours);
      const f = bodyFrame(b.name, s.date, spin);
      showSpin.current.set(b.name, f.spin);
      const frame = frames.current.get(b.name);
      if (frame) {
        basis.x.set(...f.prime);
        basis.y.set(...f.north);
        basis.z.set(-f.east[0], -f.east[1], -f.east[2]);
        frame.quaternion.setFromRotationMatrix(basis.m.makeBasis(basis.x, basis.y, basis.z));
        frame.scale.setScalar(radius);
      }
      const north = s.axes.get(b.name) ?? new THREE.Vector3();
      s.axes.set(b.name, north.set(...f.north));
      if (b.ring) {
        parts.ringMaterial.uniforms.uCenter.value.copy(at);
        parts.ringMaterial.uniforms.uRadius.value = radius;
        const u = parts.materials[i].uniforms;
        u.uCenter.value.copy(at);
        u.uNorth.value.copy(north);
        u.uRadius.value = radius;
      }
      // The Sun keeps a visible glow even at true scale, where its disc is a speck.
      if (b.name === "Sun" && corona.current) corona.current.scale.setScalar(radius * 7 + s.mix * 1.5);
    });
    corona.current?.quaternion.copy(camera.quaternion);
    // Earth's weather drifts a little against the ground.
    if (clouds.current && !reducedMotion) clouds.current.rotation.y += dt * 0.004;
  });

  return (
    <>
      {layers.orbits &&
        orbits.map((o) => (
          <OrbitLine key={o.name} points={o.points} color={o.name === "Earth" ? GOLD : INK} opacity={o.name === "Earth" ? 0.42 : 0.14} shared={shared} highlight={selected === o.name} />
        ))}
      {BODIES.map((b, i) => (
        <group
          key={b.name}
          ref={(g) => {
            if (g) groups.current.set(b.name, g);
          }}
        >
          <group
            ref={(g) => {
              if (g) frames.current.set(b.name, g);
            }}
          >
            <mesh
              material={parts.materials[i]}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(b.name);
              }}
            >
              <sphereGeometry args={[1, segments, segments]} />
            </mesh>
            {b.name === "Earth" && (
              <mesh ref={clouds} material={parts.clouds} scale={1.008}>
                <sphereGeometry args={[1, segments, segments]} />
              </mesh>
            )}
            {parts.air.get(b.name) && (
              <mesh material={parts.air.get(b.name)} scale={AIR[b.name]!.scale}>
                <sphereGeometry args={[1, 64, 64]} />
              </mesh>
            )}
            {/* Rings lie in the planet's equator: its local x–z plane. */}
            {b.ring && <mesh geometry={parts.ring} material={parts.ringMaterial} rotation={[-Math.PI / 2, 0, 0]} />}
            {parts.thin.get(b.name) && <mesh geometry={parts.thin.get(b.name)!.geometry} material={parts.thin.get(b.name)!.material} rotation={[-Math.PI / 2, 0, 0]} />}
            {b.name === "Earth" && layers.plates && !trueScale && <Plates selected={selected === "Earth"} />}
            {selected === b.name && !trueScale && layers.labels && <Landmarks name={b.name} shared={shared} />}
          </group>
          {b.name === "Sun" && (
            <mesh ref={corona} material={parts.corona}>
              <planeGeometry args={[1, 1]} />
            </mesh>
          )}
          {/* The chosen body fills the view; its tag would only sit on its face. */}
          {layers.labels && selected !== b.name && <Tag id={b.name} label={b.name} onSelect={onSelect} dot={trueScale && b.name !== "Sun"} above={b.name === "Sun"} />}
        </group>
      ))}
    </>
  );
}

/** Named features on the chosen body, pinned to its surface. */
function Landmarks({ name, shared }: { name: BodyName; shared: React.RefObject<Shared> }) {
  const grs = useMemo(() => new THREE.Vector3(), []);
  if (name === "Jupiter")
    return (
      <>
        <SurfaceLabel
          at={GRS_LOCAL}
          text="GREAT RED SPOT"
          track={(w) => {
            grs.copy(w);
            place(shared, "grs", grs, 0);
          }}
        />
        <SurfaceLabel at={onGlobe(89, 0, 1.01)} text="NORTH POLAR CYCLONES" />
        <SurfaceLabel at={onGlobe(-89, 0, 1.01)} text="SOUTH POLAR CYCLONES" />
      </>
    );
  if (name === "Saturn")
    return (
      <>
        <SurfaceLabel at={onGlobe(80, 30, 1.01)} text="NORTH POLAR HEXAGON" />
        <SurfaceLabel at={onGlobe(-89, 0, 1.01)} text="SOUTH POLAR VORTEX" />
      </>
    );
  if (name === "Mars")
    return (
      <>
        <SurfaceLabel at={onGlobe(18.65, -133.8, 1.01)} text="OLYMPUS MONS" />
        <SurfaceLabel at={onGlobe(-14, -59, 1.01)} text="VALLES MARINERIS" />
        <SurfaceLabel at={onGlobe(18.4, 77.5, 1.01)} text="JEZERO · PERSEVERANCE" tone="text-ink/70" />
        <SurfaceLabel at={onGlobe(-4.6, 137.4, 1.01)} text="GALE · CURIOSITY" tone="text-ink/70" />
      </>
    );
  if (name === "Pluto") return <SurfaceLabel at={onGlobe(20, 175, 1.01)} text="TOMBAUGH REGIO" />;
  if (name === "Mercury") return <SurfaceLabel at={onGlobe(30.5, 170.2, 1.01)} text="CALORIS BASIN" />;
  if (name === "Venus") return <SurfaceLabel at={onGlobe(65, 3, 1.01)} text="MAXWELL MONTES" />;
  return null;
}

/** Twenty moons around their planets. Hidden at true scale, where they merge with them. */
function Moons({
  shared,
  common,
  titan,
  trueScale,
  selected,
  onSelect,
  labels,
}: {
  shared: React.RefObject<Shared>;
  common: Common;
  titan: Track | null;
  trueScale: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  labels: boolean;
}) {
  const [moonMap] = useTexture(["/textures/1k_moon.jpg"]);
  const parts = useMemo(() => {
    moonMap.colorSpace = THREE.SRGBColorSpace;
    const materials = MOONS.map((m, i) => (m.surface === "moon" ? planetMaterial("Moon", common, { map: moonMap }) : moonMaterial(m.surface, m.color, i * 7.31, common)));
    const geometries = MOONS.map((m, i) => (m.surface === "potato" ? potatoGeometry(i * 1.7) : null));
    const titanAir = airMaterial("Titan");
    return { materials, geometries, titanAir };
    // `common` is made once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moonMap]);
  const sphere = useMemo(() => new THREE.SphereGeometry(1, 48, 32), []);
  const groups = useRef(new Map<string, THREE.Group>());
  const meshes = useRef(new Map<string, THREE.Group>());
  const dir = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const s = shared.current;
    for (const m of MOONS) {
      const g = groups.current.get(m.name);
      const parent = s.places.get(m.parent);
      const offset = moonOffset(m.name, s.date, titan);
      if (!g) continue;
      g.visible = !!parent && !!offset && s.mix < 0.5;
      if (!parent || !offset) {
        s.places.delete(m.name);
        continue;
      }
      const au = Math.hypot(offset[0], offset[1], offset[2]);
      dir.set(offset[0], offset[2], -offset[1]).divideScalar(au || 1);
      const length = moonDistance(m) * (1 - s.mix) + au * EARTH_UNITS * s.mix;
      g.position.copy(parent).addScaledVector(dir, length);
      const radius = blendRadius(m.radius, trueRadius(m.diameterKm), s.mix);
      meshes.current.get(m.name)?.scale.setScalar(radius);
      place(shared, m.name, g.position, radius);
    }
  });

  // Moon names only near their planet, or the overview would drown in labels.
  const near = (parent: string) => {
    if (!selected) return false;
    return selected === parent || MOONS.some((m) => m.name === selected && m.parent === parent);
  };

  return (
    <>
      {MOONS.map((m, i) => (
        <group
          key={m.name}
          ref={(g) => {
            if (g) groups.current.set(m.name, g);
          }}
        >
          <group
            ref={(g) => {
              if (g) meshes.current.set(m.name, g);
            }}
          >
            <mesh
              geometry={parts.geometries[i] ?? sphere}
              material={parts.materials[i]}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(m.name);
              }}
            />
            {m.name === "Titan" && <mesh geometry={sphere} material={parts.titanAir} scale={1.08} />}
          </group>
          {labels && !trueScale && near(m.parent) && selected !== m.name && <Tag id={m.name} label={m.name} onSelect={onSelect} tone="text-ink/50" />}
        </group>
      ))}
    </>
  );
}

const pathVertex = /* glsl */ `
  attribute float aT;
  varying float vT;
  void main() {
    vT = aT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
/** The path flown so far bright, the planned path ahead faint; brighter for the chosen craft. */
const pathFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uNow;
  uniform float uOn;
  varying float vT;
  void main() {
    float past = step(vT, uNow);
    float a = past * (0.32 + 0.5 * uOn) + (1.0 - past) * (0.07 + 0.08 * uOn);
    gl_FragColor = vec4(uColor, a);
  }
`;

/** Drawn size of a spacecraft model (its dish or shield, across), scene units: enlarged like everything else. */
const CRAFT_SIZE = 0.09;
const julian = (d: Date) => d.getTime() / 86_400_000 + 2440587.5;

/** One spacecraft: its JPL path since launch, its model turned to Earth or the Sun, and the milestones on the way. */
function Craft({ info, track, shared, trueScale, selected, onSelect, labels }: { info: (typeof CRAFT)[number]; track: Track; shared: React.RefObject<Shared>; trueScale: boolean; selected: string | null; onSelect: (id: string) => void; labels: boolean }) {
  const name = info.name;
  const on = selected === name;
  const path = useMemo(() => {
    const n = track.length / 4;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const t = new Float32Array(n);
    for (let i = 0; i < n; i++) t[i] = track[i * 4];
    g.setAttribute("aT", new THREE.BufferAttribute(t, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: CRAFT_COLOR }, uNow: { value: 0 }, uOn: { value: 0 } },
      vertexShader: pathVertex,
      fragmentShader: pathFragment,
      transparent: true,
      depthWrite: false,
    });
    const line = new THREE.Line(g, material);
    line.frustumCulled = false;
    return { line, material, mix: -1, n };
  }, [track]);
  // Milestones: flybys where the planet was, the rest where the craft was.
  const events = useMemo(
    () =>
      info.events.map((e) => {
        const date = new Date(`${e.date}T12:00:00Z`);
        return { ...e, au: e.body ? helio(e.body, date) : trackAt(track, date), at: new THREE.Vector3() };
      }),
    [info, track],
  );
  const group = useRef<THREE.Group>(null);
  const model = useRef<THREE.Group>(null);
  const marks = useRef<(THREE.Group | null)[]>([]);
  const out = useMemo<[number, number, number]>(() => [0, 0, 0], []);
  const at = useMemo(() => new THREE.Vector3(), []);
  const bounds = useMemo(() => new THREE.Sphere(), []);
  useFrame(() => {
    const s = shared.current;
    const now = julian(s.date);
    path.material.uniforms.uNow.value = now;
    path.material.uniforms.uOn.value = on ? 1 : 0;
    if (Math.abs(path.mix - s.mix) > 1e-4) {
      const attr = path.line.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < path.n; i++) {
        toScene(track.subarray(i * 4 + 1, i * 4 + 4), out, s.mix);
        attr.setXYZ(i, out[0], out[1], out[2]);
      }
      attr.needsUpdate = true;
      path.mix = s.mix;
      events.forEach((e, i) => {
        if (!e.au) return;
        toScene(e.au, out, s.mix);
        e.at.set(out[0], out[1], out[2]);
        marks.current[i]?.position.copy(e.at);
      });
    }
    const v = trackAt(track, s.date);
    if (group.current) group.current.visible = !!v;
    if (!v) {
      s.places.delete(name);
      return;
    }
    toScene(v, out, s.mix);
    at.set(out[0], out[1], out[2]);
    group.current?.position.copy(at);
    place(shared, name, at, CRAFT_SIZE);
    // The path flown so far, for framing the whole journey.
    bounds.setFromPoints([new THREE.Vector3(0, 0, 0), at, ...events.filter((e) => e.au && Date.parse(e.date) <= s.date.getTime()).map((e) => e.at)]);
    s.paths.set(name, bounds);
    // Dish to Earth (the Voyagers, New Horizons), or shield to the Sun (Parker).
    const m = model.current;
    if (m) {
      const earth = s.places.get("Earth");
      if (info.faces === "sun" || !earth) m.lookAt(0, 0, 0);
      else m.lookAt(earth);
    }
  });
  return (
    <>
      <primitive object={path.line} />
      <group ref={group}>
        <Glow color={CRAFT_COLOR} size={0.045} fadeNear={CRAFT_SIZE * 12} />
        <group ref={model} scale={CRAFT_SIZE}>
          <group
            onClick={(e) => {
              e.stopPropagation();
              onSelect(name);
            }}
          >
            <CraftModel name={name} />
          </group>
        </group>
        {labels && !on && <Tag id={name} label={name} onSelect={onSelect} dot={trueScale} tone="text-[#7fd4ff]/75" />}
      </group>
      {on &&
        labels &&
        events.map((e, i) =>
          e.au ? (
            <group
              key={e.label}
              ref={(g) => {
                marks.current[i] = g;
                if (g) g.position.copy(e.at);
              }}
            >
              <Html center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
                <div className="flex flex-col items-center">
                  <span className="block h-2.5 w-2.5 rounded-full border border-[#7fd4ff] bg-[#7fd4ff]/25 shadow-[0_0_10px_#7fd4ff]" />
                  <span className="mt-1.5 whitespace-nowrap rounded-full bg-black/55 px-2 py-0.5 font-mono text-[9px] tracking-[0.16em] text-[#bfe9ff]">
                    {e.label.toUpperCase()} · {e.date.slice(0, 4)}
                  </span>
                </div>
              </Html>
            </group>
          ) : null,
        )}
    </>
  );
}

/** Every known potentially hazardous asteroid as a faint dot on its real orbit. */
function Hazardous({ swarm, shared }: { swarm: Swarm; shared: React.RefObject<Shared> }) {
  const parts = useMemo(() => {
    const count = Math.floor(swarm.orbits.length / swarm.stride);
    const g = new THREE.BufferGeometry();
    const position = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    position.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", position);
    const points = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: new THREE.Color("#ff6a3d"), size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    points.frustumCulled = false;
    return { points, position, au: new Float32Array(count * 3) };
  }, [swarm]);
  useFrame(() => {
    const s = shared.current;
    // Positions in AU as (x, z, −y), then each distance mapped like everything else.
    swarmAt(swarm.orbits, swarm.stride, s.date, 1, parts.au);
    const out = parts.position.array as Float32Array;
    for (let i = 0; i < parts.au.length; i += 3) {
      const r = Math.hypot(parts.au[i], parts.au[i + 1], parts.au[i + 2]);
      const k = r > 0 ? sceneDistance(r, s.mix) / r : 0;
      out[i] = parts.au[i] * k;
      out[i + 1] = parts.au[i + 1] * k;
      out[i + 2] = parts.au[i + 2] * k;
    }
    parts.position.needsUpdate = true;
  });
  return <primitive object={parts.points} />;
}

/** One asteroid sent over from Asteroid Sentinel: its orbit and where it is. */
function Asteroid({ rock, shared, trueScale, selected, onSelect }: { rock: Rock; shared: React.RefObject<Shared>; trueScale: boolean; selected: string | null; onSelect: (id: string) => void }) {
  const points = useMemo(() => orbitPath(rock.el, 360), [rock]);
  const { object, update } = useScaledLine(points, ROCK_COLOR, 0.7);
  const group = useRef<THREE.Group>(null);
  const out = useMemo<[number, number, number]>(() => [0, 0, 0], []);
  const at = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const s = shared.current;
    update(s.mix);
    toScene(asteroidAt(rock.el, s.date), out, s.mix);
    at.set(out[0], out[1], out[2]);
    group.current?.position.copy(at);
    place(shared, "asteroid", at, MARKER_RADIUS);
  });
  return (
    <>
      {object && <primitive object={object} />}
      <group ref={group}>
        <Glow color={ROCK_COLOR} size={0.05} overlay />
        {selected !== "asteroid" && <Tag id="asteroid" label={rock.name} onSelect={onSelect} dot={trueScale} tone="text-[#ff8a4c]/80" />}
      </group>
    </>
  );
}

/**
 * Flies to the chosen object, then rides along with it as it moves, leaving the visitor free to
 * orbit and zoom around it. With nothing chosen, it returns to a view of the whole system.
 */
function Fly({
  selected,
  trueScale,
  look,
  shared,
  controls,
}: {
  selected: string | null;
  trueScale: boolean;
  look: Look | null;
  shared: React.RefObject<Shared>;
  controls: React.RefObject<OrbitControlsImpl | null>;
}) {
  const camera = useThree((s) => s.camera);
  const flying = useRef(true);
  const last = useMemo(() => new THREE.Vector3(), []);
  const goal = useMemo(() => new THREE.Vector3(), []);
  const offset = useMemo(() => new THREE.Vector3(), []);
  const sunward = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  /** A particular view asked for: a storm face-on, the rings from above, a pole. */
  const looking = useRef<Look["kind"] | null>(null);
  useEffect(() => {
    flying.current = true;
    looking.current = null;
  }, [selected, trueScale]);
  useEffect(() => {
    if (!look) return;
    flying.current = true;
    looking.current = look.kind;
  }, [look]);

  useFrame((_, delta) => {
    const c = controls.current;
    if (!c) return;
    const s = shared.current;
    const target = selected ? s.places.get(selected) : null;
    if (selected && !target) return;
    const k = 1 - Math.exp(-Math.min(delta, 0.1) * 2.2);
    if (!target) {
      if (!flying.current) return;
      // Pull back further at true scale, where Neptune is five times farther out.
      goal.copy(OVERVIEW).multiplyScalar(1 + s.mix * 2.6);
      camera.position.lerp(goal, k);
      c.target.lerp(offset.set(0, 0, 0), k);
      c.update();
      if (camera.position.distanceTo(goal) < 0.05) flying.current = false;
      return;
    }
    const radius = s.radii.get(selected!) ?? MARKER_RADIUS;
    const journey = looking.current === "journey" ? s.paths.get(selected!) : null;
    if (journey) {
      // The whole path so far, from above and a little to the side; no riding along.
      if (!flying.current) return;
      offset.set(0.35, 1, 0.75).normalize();
      goal.copy(journey.center).addScaledVector(offset, Math.max(journey.radius, 1) * 3.1);
      camera.position.lerp(goal, k);
      c.target.lerp(journey.center, k);
      c.update();
      if (camera.position.distanceTo(goal) < journey.radius * 0.01 + 0.01) flying.current = false;
      return;
    }
    if (flying.current) {
      // Come in from the Sun's side, a little above, so the lit face shows.
      const isCraft = CRAFT.some((x) => x.name === selected);
      const distance = selected === "Sun" ? radius * 9 + 0.6 : isCraft ? radius * 5 : radius * 6 + 0.6;
      const spot = s.places.get("grs");
      const north = selected ? s.axes.get(selected) : null;
      sunward.copy(target).negate().normalize();
      if (looking.current === "storm" && spot) {
        // Above the storm, leaning towards the Sun so the spot is seen in daylight where it can be.
        offset.copy(spot).sub(target).normalize();
        offset.add(goal.copy(sunward).multiplyScalar(0.5)).normalize();
        goal.copy(target).add(offset.multiplyScalar(radius * 4.2));
      } else if (looking.current === "rings" && north) {
        // High over the sunlit face of the rings, the Sun behind the camera.
        offset.copy(sunward).addScaledVector(north, 1.4 * (Math.sign(sunward.dot(north)) || 1)).normalize();
        goal.copy(target).add(offset.multiplyScalar(radius * 7.5));
      } else if ((looking.current === "north" || looking.current === "south") && north) {
        // Over the pole, leaning sunwards.
        offset.copy(north).multiplyScalar(looking.current === "north" ? 1 : -1).addScaledVector(sunward, 0.35).normalize();
        goal.copy(target).add(offset.multiplyScalar(radius * 3.4));
      } else {
        offset.copy(sunward);
        if (offset.lengthSq() < 1e-6) offset.set(0, 0, 1);
        // Spacecraft are seen from the side, so the dish doesn't hide the rest.
        offset.applyAxisAngle(up, isCraft ? 1.35 : 0.7);
        offset.y += isCraft ? 0.5 : 0.35;
        goal.copy(target).add(offset.normalize().multiplyScalar(looking.current === "plates" ? radius * 3.6 : distance));
      }
      camera.position.lerp(goal, k);
      c.target.lerp(target, k);
      c.update();
      if (camera.position.distanceTo(goal) < goal.distanceTo(target) * 0.01 && c.target.distanceTo(target) < Math.max(radius, 0.01) * 0.05) flying.current = false;
    } else {
      // Ride along: move camera and target by however far the object moved this frame.
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

/** Shifts the view left on wide screens, so what the camera looks at isn't hidden behind the side panel. */
function MakeRoom({ shift }: { shift: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  useEffect(() => {
    const px = size.width >= 1024 ? shift : 0;
    if (px) camera.setViewOffset(size.width, size.height, px, 0, size.width, size.height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }, [camera, size, shift]);
  return null;
}

/** Keeps the fill light's uniform in step with the page. */
function Fill({ common, on }: { common: Common; on: boolean }) {
  useFrame((_, delta) => {
    const goal = on ? 1 : 0;
    common.uFill.value += (goal - common.uFill.value) * (1 - Math.exp(-Math.min(delta, 0.1) * 4));
  });
  return null;
}

export default function CosmoscopeScene({
  clock,
  selected,
  onSelect,
  trueScale,
  tracks,
  swarm,
  rock,
  look = null,
  reducedMotion,
  layers,
  fill,
  active,
  panelShift,
}: {
  clock: React.RefObject<Clock>;
  selected: string | null;
  onSelect: (id: string) => void;
  trueScale: boolean;
  /** JPL Horizons paths: spacecraft by name, and "Titan" around Saturn. */
  tracks: Map<string, Track>;
  swarm: Swarm | null;
  rock: Rock | null;
  look?: Look | null;
  reducedMotion: boolean;
  layers: Layers;
  /** Light the night sides, to see what's there. */
  fill: boolean;
  /** Render only while the scene is on screen. */
  active: boolean;
  /** Pixels to shift the view left for the side panel on wide screens. */
  panelShift: number;
}) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  const shared = useRef<Shared>({ places: new Map(), radii: new Map(), mix: 0, date: new Date(0), axes: new Map(), paths: new Map() });
  const common = useMemo<Common>(() => ({ uTime: { value: 0 }, uFill: { value: 0 } }), []);
  const quality = useMemo(() => getQuality(), []);
  return (
    <Canvas
      dpr={quality.dpr}
      frameloop={active ? "always" : "never"}
      camera={{ fov: 40, near: 0.01, far: 8000, position: [0, 140, 220] }}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      onCreated={({ gl }) => gl.setClearColor("#000000")}
    >
      <group scale={12}>
        <Stars />
      </group>
      {/* Only the spacecraft models use three.js lights; the worlds light themselves in their shaders. */}
      <ambientLight intensity={0.25} />
      <pointLight position={[0, 0, 0]} intensity={2.6} decay={0} />
      {/* Planets first: it moves the clock and the scale for the rest each frame. */}
      <Planets
        clock={clock}
        shared={shared}
        common={common}
        trueScale={trueScale}
        selected={selected}
        onSelect={onSelect}
        reducedMotion={reducedMotion}
        layers={layers}
        segments={Math.min(quality.sphereSegments, 96)}
      />
      {layers.moons && <Moons shared={shared} common={common} titan={tracks.get("Titan") ?? null} trueScale={trueScale} selected={selected} onSelect={onSelect} labels={layers.labels} />}
      {layers.craft &&
        CRAFT.map((c) => {
          const track = tracks.get(c.name);
          return track ? <Craft key={c.name} info={c} track={track} shared={shared} trueScale={trueScale} selected={selected} onSelect={onSelect} labels={layers.labels} /> : null;
        })}
      {swarm && <Hazardous swarm={swarm} shared={shared} />}
      {rock && <Asteroid rock={rock} shared={shared} trueScale={trueScale} selected={selected} onSelect={onSelect} />}
      <Fly selected={selected} trueScale={trueScale} look={look} shared={shared} controls={controls} />
      <Fill common={common} on={fill} />
      <MakeRoom shift={panelShift} />
      <OrbitControls
        ref={controls}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.5}
        minDistance={0.05}
        maxDistance={trueScale ? 4000 : 700}
      />
    </Canvas>
  );
}
