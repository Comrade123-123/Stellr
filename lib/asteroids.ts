import { Body, HelioVector } from "astronomy-engine";

/**
 * Asteroid Sentinel's maths, in the browser: Keplerian propagation of JPL's
 * osculating elements (heliocentric, ecliptic J2000), Earth's position from
 * astronomy-engine, and the asteroid's path past Earth around its close approach.
 * Two-body motion only: accurate to a small fraction of the miss distance over the
 * few days of a flyby, which is what the scene shows; JPL's numbers are the official ones.
 */

export const AU_KM = 149_597_870.7;
/** Mean Earth–Moon distance, the unit flybys are usually quoted in. */
export const LD_KM = 384_400;

export interface Approach {
  /** JPL designation, e.g. "2024 YR4" or "99942". */
  des: string;
  name: string;
  /** Close-approach time (TDB, treated as UTC: they differ by about a minute). */
  at: string;
  /** Nominal miss distance from Earth's centre, km. */
  distKm: number;
  /** Speed relative to Earth at closest approach, km/s. */
  speed: number;
  /** Absolute magnitude H. */
  h: number | null;
  /** Measured diameter in km, when JPL has one. */
  diameterKm: number | null;
  /** On JPL's Sentry list of objects with a non-zero chance of a future impact. */
  sentry: { ip: number; torino: number; range: string } | null;
}

export interface Elements {
  des: string;
  name: string;
  /** Epoch as a Julian date (TDB). */
  epoch: number;
  a: number; // AU
  e: number;
  i: number; // degrees
  om: number; // longitude of ascending node, degrees
  w: number; // argument of perihelion, degrees
  ma: number; // mean anomaly at epoch, degrees
  /** Mean motion from JPL, degrees per day; derived from a when missing. */
  n?: number;
  /** Pha flag from JPL: a potentially hazardous asteroid. */
  pha: boolean;
  orbitClass: string;
}

/**
 * Size from brightness when JPL has no measured diameter: D = 1329 / √p × 10^(−H/5) km,
 * bracketed by a dark (p = 0.05) and a bright (p = 0.25) surface.
 */
export function sizeRange(h: number | null, diameterKm: number | null): [number, number] | null {
  if (diameterKm) return [diameterKm * 1000, diameterKm * 1000];
  if (h === null) return null;
  const d = (p: number) => (1329 / Math.sqrt(p)) * Math.pow(10, -h / 5) * 1000;
  return [d(0.25), d(0.05)];
}

/** A familiar thing about that size, in metres. */
export function sizeLike(m: number) {
  if (m < 8) return "a car";
  if (m < 18) return "a bus";
  if (m < 35) return "a house";
  if (m < 70) return "a jumbo jet";
  if (m < 140) return "a football field";
  if (m < 350) return "a stadium";
  if (m < 900) return "a skyscraper";
  return "a mountain";
}

export const metres = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `${Math.round(m)} m`);

const DEG = Math.PI / 180;
const K = 0.01720209895; // Gaussian gravitational constant, rad/day for a in AU
const jd = (date: Date) => date.getTime() / 86_400_000 + 2440587.5;
const OBLIQUITY = 23.439291 * DEG;

/** Heliocentric ecliptic J2000 position (AU) of the asteroid at `date`. */
const meanMotion = (el: Elements) => (el.n ? el.n * DEG : K / Math.pow(el.a, 1.5)); // rad/day

export function asteroidAt(el: Elements, date: Date): [number, number, number] {
  const n = meanMotion(el);
  let m = el.ma * DEG + n * (jd(date) - el.epoch);
  m = ((m % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  // Kepler's equation by Newton's method; start from M (or π for very eccentric orbits).
  let E = el.e < 0.8 ? m : Math.PI * Math.sign(m || 1);
  for (let k = 0; k < 30; k++) {
    const d = (E - el.e * Math.sin(E) - m) / (1 - el.e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  const x = el.a * (Math.cos(E) - el.e);
  const y = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  const [cw, sw] = [Math.cos(el.w * DEG), Math.sin(el.w * DEG)];
  const [co, so] = [Math.cos(el.om * DEG), Math.sin(el.om * DEG)];
  const [ci, si] = [Math.cos(el.i * DEG), Math.sin(el.i * DEG)];
  return [
    (co * cw - so * sw * ci) * x + (-co * sw - so * cw * ci) * y,
    (so * cw + co * sw * ci) * x + (-so * sw + co * cw * ci) * y,
    sw * si * x + cw * si * y,
  ];
}

/** Earth's heliocentric ecliptic J2000 position (AU): astronomy-engine's equatorial vector, turned by the obliquity. */
export function earthAt(date: Date): [number, number, number] {
  const v = HelioVector(Body.Earth, date);
  return [v.x, Math.cos(OBLIQUITY) * v.y + Math.sin(OBLIQUITY) * v.z, -Math.sin(OBLIQUITY) * v.y + Math.cos(OBLIQUITY) * v.z];
}

/** Points around the whole orbit, for drawing it. */
export function orbitPath(el: Elements, points = 256): [number, number, number][] {
  const out: [number, number, number][] = [];
  const period = (2 * Math.PI) / meanMotion(el); // days
  const t0 = new Date((el.epoch - 2440587.5) * 86_400_000);
  for (let k = 0; k <= points; k++) out.push(asteroidAt(el, new Date(t0.getTime() + (k / points) * period * 86_400_000)));
  return out;
}

export interface Flyby {
  /** Geocentric ecliptic positions in km, hourly from −days to +days around closest approach. */
  path: { at: Date; km: [number, number, number] }[];
  closest: { at: Date; km: [number, number, number]; distKm: number };
}

/** The asteroid's track relative to Earth around `near`, with our own closest point (refined to the minute). */
export function flyby(el: Elements, near: Date, days = 4): Flyby {
  const rel = (d: Date): [number, number, number] => {
    const a = asteroidAt(el, d);
    const e = earthAt(d);
    return [(a[0] - e[0]) * AU_KM, (a[1] - e[1]) * AU_KM, (a[2] - e[2]) * AU_KM];
  };
  const path: Flyby["path"] = [];
  let best = { at: near, km: rel(near), distKm: Infinity };
  for (let h = -days * 24; h <= days * 24; h++) {
    const at = new Date(near.getTime() + h * 3_600_000);
    const km = rel(at);
    path.push({ at, km });
    const d = Math.hypot(...km);
    if (d < best.distKm) best = { at, km, distKm: d };
  }
  const hour = best.at.getTime();
  for (let m = -60; m <= 60; m++) {
    const at = new Date(hour + m * 60_000);
    const km = rel(at);
    const d = Math.hypot(...km);
    if (d < best.distKm) best = { at, km, distKm: d };
  }
  return { path, closest: best };
}

/**
 * Positions of many asteroids at once, for the hazardous-asteroid layer: `orbits` holds
 * `stride` numbers per object (epoch JD, a, e, i, om, w, ma, …), and scene coordinates
 * (ecliptic x, z, −y, times `scale`) are written into `out`. Same Kepler solution as
 * asteroidAt, without allocating, since it runs every frame for a few thousand objects.
 */
export function swarmAt(orbits: ArrayLike<number>, stride: number, date: Date, scale: number, out: Float32Array) {
  const t = jd(date);
  for (let k = 0, o = 0; o + 6 < orbits.length; k += 3, o += stride) {
    const a = orbits[o + 1];
    const e = orbits[o + 2];
    let m = orbits[o + 6] * DEG + (K / Math.pow(a, 1.5)) * (t - orbits[o]);
    m = ((m % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
    let E = e < 0.8 ? m : Math.PI * Math.sign(m || 1);
    for (let n = 0; n < 12; n++) {
      const d = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
      E -= d;
      if (Math.abs(d) < 1e-9) break;
    }
    const x = a * (Math.cos(E) - e);
    const y = a * Math.sqrt(1 - e * e) * Math.sin(E);
    const i = orbits[o + 3] * DEG;
    const om = orbits[o + 4] * DEG;
    const w = orbits[o + 5] * DEG;
    const cw = Math.cos(w), sw = Math.sin(w), co = Math.cos(om), so = Math.sin(om), ci = Math.cos(i), si = Math.sin(i);
    out[k] = ((co * cw - so * sw * ci) * x + (-co * sw - so * cw * ci) * y) * scale;
    out[k + 1] = (sw * si * x + cw * si * y) * scale;
    out[k + 2] = -((so * cw + co * sw * ci) * x + (-so * sw + co * cw * ci) * y) * scale;
  }
}
