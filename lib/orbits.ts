import {
  degreesLat,
  degreesLong,
  degreesToRadians,
  ecfToLookAngles,
  eciToEcf,
  eciToGeodetic,
  gstime,
  jday,
  propagate,
  sunPos,
  twoline2satrec,
  type EciVec3,
  type GeodeticLocation,
  type SatRec,
} from "satellite.js";

/**
 * Orbit maths for Orbit Watch, all in the browser: SGP4 propagation of
 * CelesTrak two-line elements via satellite.js, and pass prediction for an
 * observer on the ground.
 *
 * Scene coordinates are Earth radii with +y through the North Pole, matching
 * three.js (y up): ECI (x, y, z) maps to scene (x, z, −y).
 */

export const EARTH_RADIUS_KM = 6371;
const AU_KM = 149_597_870.7;

export interface Satellite {
  name: string;
  /** NORAD catalogue number. */
  id: number;
  satrec: SatRec;
}

/** Parses CelesTrak's three-line format (name, line 1, line 2), skipping anything malformed. */
export function parseTLE(text: string): Satellite[] {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  const out: Satellite[] = [];
  for (let i = 0; i + 2 < lines.length; i++) {
    const [name, l1, l2] = [lines[i], lines[i + 1], lines[i + 2]];
    if (!l1?.startsWith("1 ") || !l2?.startsWith("2 ")) continue;
    try {
      const satrec = twoline2satrec(l1, l2);
      if (satrec.error) continue;
      out.push({ name: name.trim(), id: Number(l1.slice(2, 7)), satrec });
      i += 2;
    } catch {
      // Skip this record; the rest of the file is still usable.
    }
  }
  return out;
}

export interface State {
  /** Position in the scene, Earth radii. */
  scene: [number, number, number];
  latitude: number;
  longitude: number;
  altitudeKm: number;
  speedKmS: number;
  /** True when the satellite is in sunlight, not in Earth's shadow. */
  sunlit: boolean;
}

const toScene = (v: EciVec3<number>, scale: number): [number, number, number] => [v.x / scale, v.z / scale, -v.y / scale];

/** The Sun's position, ECI kilometres. */
function sunEci(date: Date): EciVec3<number> {
  const [x, y, z] = sunPos(jday(date)).rsun;
  return { x: x * AU_KM, y: y * AU_KM, z: z * AU_KM };
}

/**
 * True when Earth hides the Sun from a satellite at `p` (ECI km): behind Earth relative to
 * the Sun and within Earth's cylinder of shadow. The cylinder ignores the penumbra, which
 * moves the moment of entering shadow by only a few seconds for low orbits.
 */
function inShadow(p: EciVec3<number>, sun: EciVec3<number>) {
  const len = Math.hypot(sun.x, sun.y, sun.z);
  const along = (p.x * sun.x + p.y * sun.y + p.z * sun.z) / len;
  if (along > 0) return false;
  const perp2 = p.x * p.x + p.y * p.y + p.z * p.z - along * along;
  return perp2 < EARTH_RADIUS_KM * EARTH_RADIUS_KM;
}

/** Where the Sun is, as a unit vector in the scene, for lighting the globe. */
export function sunDirection(date: Date): [number, number, number] {
  const sun = sunEci(date);
  return toScene(sun, Math.hypot(sun.x, sun.y, sun.z));
}

/** Earth's rotation angle at `date` (Greenwich sidereal time, radians): the globe's turn about +y. */
export const earthRotation = (date: Date) => gstime(date);

export function stateAt(sat: Satellite, date: Date): State | null {
  const pv = propagate(sat.satrec, date);
  if (!pv) return null;
  const { position: p, velocity: v } = pv;
  const geo = eciToGeodetic(p, gstime(date));
  return {
    scene: toScene(p, EARTH_RADIUS_KM),
    latitude: degreesLat(geo.latitude),
    longitude: degreesLong(geo.longitude),
    altitudeKm: geo.height,
    speedKmS: Math.hypot(v.x, v.y, v.z),
    sunlit: !inShadow(p, sunEci(date)),
  };
}

/** Scene positions along the orbit from `fromMin` to `toMin` minutes around `date`. */
export function track(sat: Satellite, date: Date, fromMin: number, toMin: number, stepMin = 0.5) {
  const pts: [number, number, number][] = [];
  for (let m = fromMin; m <= toMin; m += stepMin) {
    const pv = propagate(sat.satrec, new Date(date.getTime() + m * 60_000));
    if (pv) pts.push(toScene(pv.position, EARTH_RADIUS_KM));
  }
  return pts;
}

export interface Observer {
  lat: number;
  lon: number;
}

const observerGeodetic = (o: Observer): GeodeticLocation => ({
  latitude: degreesToRadians(o.lat),
  longitude: degreesToRadians(o.lon),
  height: 0,
});

/** The observer's place on the globe, in scene units before Earth's rotation is applied. */
export function observerOnGlobe(o: Observer): [number, number, number] {
  const lat = degreesToRadians(o.lat);
  const lon = degreesToRadians(o.lon);
  // Earth-fixed (x to 0°E, y to 90°E, z north) → scene (x, z, −y).
  return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)];
}

function lookAt(sat: Satellite, observer: GeodeticLocation, date: Date) {
  const pv = propagate(sat.satrec, date);
  if (!pv) return null;
  const look = ecfToLookAngles(observer, eciToEcf(pv.position, gstime(date)));
  return { elevation: (look.elevation * 180) / Math.PI, azimuth: (look.azimuth * 180) / Math.PI, eci: pv.position };
}

function sunElevation(observer: GeodeticLocation, date: Date) {
  return (ecfToLookAngles(observer, eciToEcf(sunEci(date), gstime(date))).elevation * 180) / Math.PI;
}

export interface Pass {
  start: Date;
  peak: Date;
  end: Date;
  maxElevation: number;
  startAzimuth: number;
  endAzimuth: number;
  /** Naked-eye visible: the satellite is sunlit while the observer's sky is dark, for part of the pass. */
  visible: boolean;
}

/**
 * Passes above `minElevation` degrees in the next `hours`. Samples every 20 s,
 * then refines rise and set to about a second.
 */
export function passes(sat: Satellite, o: Observer, from: Date, hours = 72, minElevation = 10): Pass[] {
  const obs = observerGeodetic(o);
  const stepMs = 20_000;
  const endMs = from.getTime() + hours * 3_600_000;
  const out: Pass[] = [];
  const elevAt = (t: number) => lookAt(sat, obs, new Date(t))?.elevation ?? -90;
  const crossing = (lo: number, hi: number, rising: boolean) => {
    for (let k = 0; k < 6; k++) {
      const mid = (lo + hi) / 2;
      if ((elevAt(mid) >= minElevation) === rising) hi = mid;
      else lo = mid;
    }
    return hi;
  };

  let prev = elevAt(from.getTime());
  let current: { start: number; peak: number; max: number; visible: boolean } | null =
    prev >= minElevation ? { start: from.getTime(), peak: from.getTime(), max: prev, visible: false } : null;

  for (let t = from.getTime() + stepMs; t <= endMs; t += stepMs) {
    const look = lookAt(sat, obs, new Date(t));
    if (!look) break;
    const e = look.elevation;
    if (!current && e >= minElevation && prev < minElevation) {
      const start = crossing(t - stepMs, t, true);
      current = { start, peak: t, max: e, visible: false };
    }
    if (current) {
      if (e > current.max) {
        current.max = e;
        current.peak = t;
      }
      if (!current.visible && e >= minElevation) {
        const at = new Date(t);
        current.visible = !inShadow(look.eci, sunEci(at)) && sunElevation(obs, at) < -6;
      }
      if (e < minElevation && prev >= minElevation) {
        const end = crossing(t - stepMs, t, false);
        out.push({
          start: new Date(current.start),
          peak: new Date(current.peak),
          end: new Date(end),
          maxElevation: current.max,
          startAzimuth: lookAt(sat, obs, new Date(current.start))?.azimuth ?? 0,
          endAzimuth: lookAt(sat, obs, new Date(end))?.azimuth ?? 0,
          visible: current.visible,
        });
        current = null;
      }
    }
    prev = e;
  }
  return out;
}

const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
/** 16-point compass direction for an azimuth in degrees. */
export const compass = (azimuth: number) => POINTS[Math.round((((azimuth % 360) + 360) % 360) / 22.5) % 16];
