"use client";

import { useEffect, useMemo, useRef } from "react";
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
  type Track,
} from "@/lib/cosmoscope";
import type { Swarm } from "./AsteroidScene";
import { MakeRoomForPanel, Stars } from "./OrbitScene";

/*
 * The solar system at any moment: the Sun and eight planets where astronomy-engine puts
 * them, each on its real orbit (directions and inclinations true), with the larger moons,
 * four spacecraft on their JPL trajectories, and optionally asteroids. Two scales, glided
 * between: compressed distances with enlarged bodies (so everything is visible), and true
 * scale (where the planets all but vanish). Ecliptic north is up. Time comes from a shared
 * clock the page controls; the camera flies to a chosen object and then rides along with it.
 */

/** The page's clock: `t` is the shown moment (ms); `rate` is days per second of playback; `live` tracks real time. */
export interface Clock {
  t: number;
  rate: number;
  live: boolean;
}

/** A particular view of the chosen planet; `n` makes a repeat request a new one. */
export interface Look {
  kind: "storm" | "rings";
  n: number;
}

/** One chosen asteroid, from Asteroid Sentinel. */
export interface Rock {
  el: Elements;
  name: string;
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
  /** North poles (scene axes) of bodies the camera may look along. */
  axes: Map<string, THREE.Vector3>;
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
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float a = exp(-r * r * 6.0) + exp(-r * 18.0) * 2.0;
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
function Tag({ id, label, onSelect, dot = false, above = false, tone = "text-ink/55" }: { id: string; label: string; onSelect: (id: string) => void; dot?: boolean; above?: boolean; tone?: string }) {
  return (
    <Html center zIndexRange={[5, 0]}>
      <div className="relative">
        <span className={`block h-1.5 w-1.5 rounded-full bg-ink/80 transition-opacity duration-700 ${dot ? "opacity-100" : "opacity-0"}`} />
        <button
          type="button"
          onClick={() => onSelect(id)}
          className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] tracking-[0.22em] transition-colors hover:text-ink ${tone} ${
            above ? "bottom-full mb-10" : "top-full mt-7"
          }`}
        >
          {label.toUpperCase()}
        </button>
      </div>
    </Html>
  );
}

/**
 * A soft glowing point that always faces the camera. It keeps the same apparent size however
 * close the camera comes (`size` is a fraction of the distance to it), so a spacecraft stays a
 * point of light rather than swelling to fill the screen.
 */
function Glow({ color, size, overlay = false }: { color: THREE.Color; size: number; overlay?: boolean }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: color } },
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
    m.scale.setScalar(camera.position.distanceTo(m.getWorldPosition(world)) * size);
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

function OrbitLine({ points, color, opacity, shared }: { points: ArrayLike<number>[]; color: THREE.Color; opacity: number; shared: React.RefObject<Shared> }) {
  const { object, update } = useScaledLine(points, color, opacity);
  useFrame(() => update(shared.current.mix));
  return object ? <primitive object={object} /> : null;
}

const ringVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
/*
 * Saturn's rings lit by the Sun at the origin: bright on the sunlit face, dimmer (light
 * scattered through) on the other, and darkened where the planet's shadow falls across them.
 */
const ringFragment = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 uCenter;
  uniform float uRadius;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec4 t = texture2D(map, vUv);
    vec3 toSun = normalize(-vWorld);
    vec3 oc = vWorld - uCenter;
    float b = dot(oc, toSun);
    float c = dot(oc, oc) - uRadius * uRadius;
    float shadow = (b < 0.0 && b * b - c > 0.0) ? 0.06 : 1.0;
    vec3 view = normalize(cameraPosition - vWorld);
    float sunward = dot(vNormal, toSun) * dot(vNormal, view) > 0.0 ? 1.0 : 0.38;
    float k = sunward * (0.6 + 0.4 * sqrt(abs(dot(vNormal, toSun)))) * shadow;
    gl_FragColor = vec4(t.rgb * k * 1.35, t.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Just above the Great Red Spot, in Jupiter's own axes. */
const GRS_LOCAL = new THREE.Vector3(...STORM_LOCAL).multiplyScalar(1.01);

/** A label on Jupiter's storm, shown only while it faces the camera. */
function StormLabel({ shared }: { shared: React.RefObject<Shared> }) {
  const group = useRef<THREE.Group>(null);
  const label = useRef<HTMLSpanElement>(null);
  const world = useMemo(() => new THREE.Vector3(), []);
  const out = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    const g = group.current;
    const center = shared.current.places.get("Jupiter");
    if (!g || !center) return;
    g.getWorldPosition(world);
    place(shared, "grs", world, 0);
    out.copy(world).sub(center);
    const facing = out.dot(camera.position.clone().sub(world)) > 0;
    if (label.current) label.current.style.opacity = facing ? "1" : "0";
  });
  return (
    <group ref={group} position={GRS_LOCAL}>
      <Html center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
        <span ref={label} className="block whitespace-nowrap pt-12 font-mono text-[10px] tracking-[0.22em] text-gold transition-opacity duration-500">
          GREAT RED SPOT
        </span>
      </Html>
    </group>
  );
}

function Planets({
  clock,
  shared,
  trueScale,
  selected,
  onSelect,
  reducedMotion,
}: {
  clock: React.RefObject<Clock>;
  shared: React.RefObject<Shared>;
  trueScale: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
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
    const ring = new THREE.RingGeometry(1.25, 2.3, 160, 1);
    const pos = ring.attributes.position;
    const uv = ring.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (Math.hypot(pos.getX(i), pos.getY(i)) - 1.25) / 1.05, 0.5);
    const ringMaterial = new THREE.ShaderMaterial({
      uniforms: { map: { value: ringMap }, uCenter: { value: new THREE.Vector3() }, uRadius: { value: 1 } },
      vertexShader: ringVertex,
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
    return { materials, ring, ringMaterial, corona };
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
    const goal = trueScale ? 1 : 0;
    s.mix += (goal - s.mix) * (1 - Math.exp(-dt * 1.6));
    if (Math.abs(goal - s.mix) < 1e-3) s.mix = goal;

    const trueSpin = (c.live || Math.abs(c.rate) <= MAX_TRUE_SPIN_RATE) && !reducedMotion;
    for (const b of BODIES) {
      const g = groups.current.get(b.name);
      if (!g) continue;
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
      if (b.name === "Saturn") s.axes.set("Saturn", (s.axes.get("Saturn") ?? new THREE.Vector3()).set(...f.north));
      if (b.ring) {
        parts.ringMaterial.uniforms.uCenter.value.copy(at);
        parts.ringMaterial.uniforms.uRadius.value = radius;
      }
      // The Sun keeps a visible glow even at true scale, where its disc is a speck.
      if (b.name === "Sun" && corona.current) corona.current.scale.setScalar(radius * 7 + s.mix * 1.5);
    }
    corona.current?.quaternion.copy(camera.quaternion);
  });

  return (
    <>
      <ambientLight intensity={0.06} />
      <pointLight position={[0, 0, 0]} intensity={3.4} decay={0} />
      {orbits.map((o) => (
        <OrbitLine key={o.name} points={o.points} color={o.name === "Earth" ? GOLD : INK} opacity={o.name === "Earth" ? 0.5 : 0.16} shared={shared} />
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
              <sphereGeometry args={[1, 64, 64]} />
            </mesh>
            {/* The rings lie in the planet's equator: its local x–z plane. */}
            {b.ring && <mesh geometry={parts.ring} material={parts.ringMaterial} rotation={[-Math.PI / 2, 0, 0]} />}
            {b.name === "Jupiter" && selected === "Jupiter" && !trueScale && <StormLabel shared={shared} />}
          </group>
          {b.name === "Sun" && (
            <mesh ref={corona} material={parts.corona}>
              <planeGeometry args={[1, 1]} />
            </mesh>
          )}
          {/* The chosen body fills the view; its tag would only sit on its face. */}
          {selected !== b.name && <Tag id={b.name} label={b.name} onSelect={onSelect} dot={trueScale && b.name !== "Sun"} above={b.name === "Sun"} />}
        </group>
      ))}
    </>
  );
}

/** The Moon, Jupiter's four big moons and Titan, around their planets. Hidden at true scale, where they merge with them. */
function Moons({
  shared,
  titan,
  trueScale,
  selected,
  onSelect,
}: {
  shared: React.RefObject<Shared>;
  titan: Track | null;
  trueScale: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [moonMap] = useTexture(["/textures/1k_moon.jpg"]);
  const materials = useMemo(() => {
    moonMap.colorSpace = THREE.SRGBColorSpace;
    return MOONS.map((m) => new THREE.MeshLambertMaterial(m.texture ? { map: moonMap } : { color: m.color }));
  }, [moonMap]);
  const groups = useRef(new Map<string, THREE.Group>());
  const meshes = useRef(new Map<string, THREE.Mesh>());
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
          <mesh
            ref={(mesh) => {
              if (mesh) meshes.current.set(m.name, mesh);
            }}
            material={materials[i]}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(m.name);
            }}
          >
            <sphereGeometry args={[1, 32, 32]} />
          </mesh>
          {!trueScale && near(m.parent) && selected !== m.name && <Tag id={m.name} label={m.name} onSelect={onSelect} />}
        </group>
      ))}
    </>
  );
}

/** One spacecraft: its JPL path since launch and where it is now. */
function Craft({ name, track, shared, trueScale, selected, onSelect }: { name: string; track: Track; shared: React.RefObject<Shared>; trueScale: boolean; selected: string | null; onSelect: (id: string) => void }) {
  const points = useMemo(() => {
    const list: Float64Array[] = [];
    for (let i = 0; i < track.length; i += 4) list.push(track.subarray(i + 1, i + 4));
    return list;
  }, [track]);
  const { object, update } = useScaledLine(points, CRAFT_COLOR, 0.28);
  const group = useRef<THREE.Group>(null);
  const out = useMemo<[number, number, number]>(() => [0, 0, 0], []);
  const at = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const s = shared.current;
    update(s.mix);
    const v = trackAt(track, s.date);
    if (group.current) group.current.visible = !!v;
    if (!v) {
      s.places.delete(name);
      return;
    }
    toScene(v, out, s.mix);
    at.set(out[0], out[1], out[2]);
    group.current?.position.copy(at);
    place(shared, name, at, MARKER_RADIUS);
  });
  return (
    <>
      {object && <primitive object={object} />}
      <group ref={group}>
        <Glow color={CRAFT_COLOR} size={0.045} />
        {selected !== name && <Tag id={name} label={name} onSelect={onSelect} dot={trueScale} tone="text-[#7fd4ff]/70" />}
      </group>
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
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  /** A particular view asked for: Jupiter's storm face-on, or Saturn's rings from above. */
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
    if (flying.current) {
      // Come in from the Sun's side, a little above, so the lit face shows.
      const distance = selected === "Sun" ? radius * 9 + 0.6 : radius * 6 + 0.6;
      const spot = s.places.get("grs");
      const north = s.axes.get("Saturn");
      if (looking.current === "storm" && spot) {
        // Above the storm, leaning towards the Sun so the spot is seen in daylight where it can be.
        offset.copy(spot).sub(target).normalize();
        offset.add(goal.copy(target).negate().normalize().multiplyScalar(0.5)).normalize();
        goal.copy(target).add(offset.multiplyScalar(radius * 4.2));
      } else if (looking.current === "rings" && north) {
        // High over the sunlit face of the rings, the Sun behind the camera.
        offset.copy(target).negate().normalize();
        offset.addScaledVector(north, 1.4 * (Math.sign(offset.dot(north)) || 1)).normalize();
        goal.copy(target).add(offset.multiplyScalar(radius * 7.5));
      } else {
        offset.copy(target).negate();
        if (offset.lengthSq() < 1e-6) offset.set(0, 0, 1);
        offset.normalize().applyAxisAngle(up, 0.7);
        offset.y += 0.35;
        goal.copy(target).add(offset.normalize().multiplyScalar(distance));
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
}) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  const shared = useRef<Shared>({ places: new Map(), radii: new Map(), mix: 0, date: new Date(0), axes: new Map() });
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ fov: 40, near: 0.01, far: 8000, position: [0, 140, 220] }}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      onCreated={({ gl }) => gl.setClearColor("#000000")}
    >
      <group scale={12}>
        <Stars />
      </group>
      {/* Planets first: it moves the clock and the scale for the rest each frame. */}
      <Planets clock={clock} shared={shared} trueScale={trueScale} selected={selected} onSelect={onSelect} reducedMotion={reducedMotion} />
      <Moons shared={shared} titan={tracks.get("Titan") ?? null} trueScale={trueScale} selected={selected} onSelect={onSelect} />
      {CRAFT.map((c) => {
        const track = tracks.get(c.name);
        return track ? <Craft key={c.name} name={c.name} track={track} shared={shared} trueScale={trueScale} selected={selected} onSelect={onSelect} /> : null;
      })}
      {swarm && <Hazardous swarm={swarm} shared={shared} />}
      {rock && <Asteroid rock={rock} shared={shared} trueScale={trueScale} selected={selected} onSelect={onSelect} />}
      <Fly selected={selected} trueScale={trueScale} look={look} shared={shared} controls={controls} />
      <MakeRoomForPanel />
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
