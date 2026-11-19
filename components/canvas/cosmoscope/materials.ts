import * as THREE from "three";
import type { BodyName, Surface } from "@/lib/cosmoscope";
import { AIR_FRAGMENT, CLOUD_FRAGMENT, LINE_FRAGMENT, LINE_VERTEX, MOON_FRAGMENT, PLANET_FRAGMENT, RING_VERTEX, THIN_RING_FRAGMENT, WORLD_VERTEX } from "./glsl";

/** Uniforms every world shares: the clock for animated surfaces, and the fill light (0 off, 1 on). */
export interface Common {
  uTime: { value: number };
  uFill: { value: number };
}

const DEFINES: Partial<Record<BodyName, Record<string, string>>> = {
  Sun: { SUN: "" },
  Earth: { EARTH: "" },
  Jupiter: { JUPITER: "", GIANT: "" },
  Saturn: { SATURN: "", GIANT: "" },
  Uranus: { GIANT: "" },
  Neptune: { GIANT: "" },
  Pluto: { PLUTO: "" },
};

/** A planet's (or the Sun's, or the textured Moon's) surface. */
export function planetMaterial(name: BodyName | "Moon", common: Common, maps: { map?: THREE.Texture; night?: THREE.Texture; ring?: THREE.Texture }) {
  const blank = new THREE.Texture();
  return new THREE.ShaderMaterial({
    defines: name === "Moon" ? {} : (DEFINES[name] ?? {}),
    uniforms: {
      ...common,
      map: { value: maps.map ?? blank },
      nightMap: { value: maps.night ?? blank },
      ringMap: { value: maps.ring ?? blank },
      uCenter: { value: new THREE.Vector3() },
      uNorth: { value: new THREE.Vector3(0, 1, 0) },
      uRadius: { value: 1 },
    },
    vertexShader: WORLD_VERTEX,
    fragmentShader: PLANET_FRAGMENT,
    toneMapped: name !== "Sun",
  });
}

export function cloudMaterial(common: Common, map: THREE.Texture) {
  return new THREE.ShaderMaterial({
    uniforms: { ...common, map: { value: map } },
    vertexShader: WORLD_VERTEX,
    fragmentShader: CLOUD_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
}

/** Air colour, how tightly it hugs the limb, and how bright, for each world with an atmosphere worth seeing. */
export const AIR: Partial<Record<BodyName | "Titan", { color: string; power: number; strength: number; scale: number }>> = {
  Venus: { color: "#f5dca0", power: 2.2, strength: 1.0, scale: 1.04 },
  Earth: { color: "#5b9dff", power: 3.0, strength: 1.4, scale: 1.035 },
  Mars: { color: "#e8a07a", power: 4.0, strength: 0.5, scale: 1.02 },
  Jupiter: { color: "#e8d6b8", power: 3.5, strength: 0.45, scale: 1.02 },
  Saturn: { color: "#efdcb0", power: 3.5, strength: 0.45, scale: 1.02 },
  Uranus: { color: "#a9f0ff", power: 2.8, strength: 0.8, scale: 1.03 },
  Neptune: { color: "#6f96ff", power: 2.8, strength: 0.9, scale: 1.03 },
  Pluto: { color: "#8fb6ff", power: 4.0, strength: 0.6, scale: 1.03 },
  Titan: { color: "#f0a050", power: 2.0, strength: 1.2, scale: 1.08 },
};

export function airMaterial(name: keyof typeof AIR) {
  const a = AIR[name]!;
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(a.color) }, uPower: { value: a.power }, uStrength: { value: a.strength } },
    vertexShader: WORLD_VERTEX,
    fragmentShader: AIR_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Faint rings, as [radius, half-width, opacity] in planet radii, after NASA's ring fact sheets. */
export const THIN_RINGS: Partial<Record<BodyName, { color: string; inner: number; outer: number; bands: [number, number, number][] }>> = {
  Jupiter: { color: "#c9a77f", inner: 1.3, outer: 2.6, bands: [[1.55, 0.18, 0.015], [1.765, 0.045, 0.1], [2.1, 0.3, 0.012], [2.45, 0.18, 0.008]] },
  Uranus: {
    color: "#6f7478",
    inner: 1.55,
    outer: 2.08,
    bands: [[1.64, 0.004, 0.16], [1.66, 0.004, 0.16], [1.68, 0.004, 0.16], [1.75, 0.005, 0.2], [1.79, 0.005, 0.2], [1.84, 0.004, 0.2], [1.86, 0.004, 0.2], [1.9, 0.005, 0.22], [2.0, 0.012, 0.42], [1.96, 0.06, 0.02]],
  },
  Neptune: { color: "#7d848c", inner: 1.6, outer: 2.65, bands: [[1.69, 0.01, 0.08], [2.15, 0.006, 0.14], [2.28, 0.13, 0.02], [2.54, 0.008, 0.22]] },
};

export function thinRing(name: keyof typeof THIN_RINGS) {
  const r = THIN_RINGS[name]!;
  const geometry = new THREE.RingGeometry(r.inner, r.outer, 160, 1);
  const bands = Array.from({ length: 10 }, (_, i) => {
    const b = r.bands[i];
    return b ? new THREE.Vector4(b[0], b[1], b[2], 0) : new THREE.Vector4(0, 0, 0, 0);
  });
  const material = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(r.color) }, uBands: { value: bands }, uInner: { value: r.inner }, uOuter: { value: r.outer } },
    vertexShader: RING_VERTEX,
    fragmentShader: THIN_RING_FRAGMENT,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  return { geometry, material };
}

const KIND: Record<Exclude<Surface, "moon">, number> = {
  potato: 1,
  io: 2,
  europa: 3,
  ganymede: 4,
  callisto: 5,
  mimas: 6,
  enceladus: 7,
  icy: 8,
  titan: 9,
  iapetus: 10,
  miranda: 11,
  "dark-icy": 12,
  triton: 13,
  charon: 14,
};

export function moonMaterial(surface: Exclude<Surface, "moon">, color: string, seed: number, common: Common) {
  return new THREE.ShaderMaterial({
    uniforms: { ...common, uKind: { value: KIND[surface] }, uColor: { value: new THREE.Color(color) }, uSeed: { value: seed } },
    vertexShader: WORLD_VERTEX,
    fragmentShader: MOON_FRAGMENT,
  });
}

/** A lumpy little moon (Phobos, Deimos): a sphere pushed in and out by a few smooth waves. */
export function potatoGeometry(seed: number) {
  const g = new THREE.SphereGeometry(1, 40, 28);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const bump =
      0.16 * Math.sin(v.x * 2.1 + seed) * Math.cos(v.y * 1.7 - seed) +
      0.1 * Math.sin(v.z * 3.3 + seed * 2) +
      0.06 * Math.sin((v.x + v.y) * 5.0 + seed * 3);
    v.multiply(new THREE.Vector3(1.25, 0.85, 1)).multiplyScalar(1 + bump);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Earth's plate boundaries as line segments on the unit sphere: gold, with subduction zones orange. */
export function plateLines(data: { lines: [number, number[]][] }) {
  const points: number[] = [];
  const colors: number[] = [];
  const gold = new THREE.Color("#e9c47c");
  const orange = new THREE.Color("#ff6f3c");
  const r = 1.004;
  const at = (lon: number, lat: number) => {
    const lo = (lon * Math.PI) / 180;
    const la = (lat * Math.PI) / 180;
    return [r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo)];
  };
  for (const [kind, flat] of data.lines) {
    const c = kind ? orange : gold;
    for (let i = 0; i + 3 < flat.length; i += 2) {
      // A step across the date line would draw a chord through the globe.
      if (Math.abs(flat[i + 2] - flat[i]) > 180) continue;
      points.push(...at(flat[i], flat[i + 1]), ...at(flat[i + 2], flat[i + 3]));
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.ShaderMaterial({ vertexShader: LINE_VERTEX, fragmentShader: LINE_FRAGMENT, transparent: true, depthWrite: false });
  return new THREE.LineSegments(g, material);
}

/** Where on a globe a latitude and longitude (degrees) lies, in the body's own axes (y north, x the prime meridian). */
export const onGlobe = (lat: number, lon: number, r = 1): [number, number, number] => {
  const lo = (lon * Math.PI) / 180;
  const la = (lat * Math.PI) / 180;
  return [r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo)];
};
