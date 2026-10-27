import {
  Body,
  Elongation,
  Equator,
  GeoVector,
  HelioVector,
  Horizon,
  Illumination,
  Observer,
  SearchAltitude,
  SearchRelativeLongitude,
} from "astronomy-engine";
import type { Place } from "./places";

/**
 * Cosmoscope's sky maths, all in the browser with astronomy-engine: where the Sun and
 * planets are at any moment (heliocentric, ecliptic J2000), their orbits, how far each is
 * from Earth, and whether it can be seen on a given night from a given place.
 */

export const AU_KM = 149_597_870.7;
/** Light's travel time across one AU, seconds. */
const AU_LIGHT_S = 499.004784;
const OBLIQUITY = (23.439291 * Math.PI) / 180;

export type BodyName = "Sun" | "Mercury" | "Venus" | "Earth" | "Mars" | "Jupiter" | "Saturn" | "Uranus" | "Neptune";

export interface BodyInfo {
  name: BodyName;
  kind: string;
  /** Radius in scene units: hugely exaggerated, since true sizes would be invisible at these distances. */
  radius: number;
  texture: string;
  ring?: string;
  /** Equatorial diameter, km. */
  diameterKm: number;
  /** Length of a solar day (sunrise to sunrise), hours. */
  dayHours: number;
  /** Sidereal rotation, hours; negative for Venus and Uranus, which spin backwards. */
  spinHours: number;
  /** Orbital period, days. */
  yearDays: number;
  /** Known moons; "+" where the count keeps growing. */
  moons: string;
  /** Mean surface (or 1-bar) temperature, °C. */
  tempC: number;
  /** Axial tilt, degrees. */
  tilt: number;
}

/** Figures from NASA's planetary fact sheets. Moon counts as of 2025. */
export const BODIES: BodyInfo[] = [
  { name: "Sun", kind: "Star", radius: 2.2, texture: "/textures/2k_sun.jpg", diameterKm: 1_392_700, dayHours: 609.1, spinHours: 609.1, yearDays: 0, moons: "—", tempC: 5500, tilt: 7.25 },
  { name: "Mercury", kind: "Rocky planet", radius: 0.22, texture: "/textures/2k_mercury.jpg", diameterKm: 4879, dayHours: 4222.6, spinHours: 1407.6, yearDays: 88.0, moons: "0", tempC: 167, tilt: 0.03 },
  { name: "Venus", kind: "Rocky planet", radius: 0.4, texture: "/textures/2k_venus_atmosphere.jpg", diameterKm: 12_104, dayHours: 2802.0, spinHours: -5832.5, yearDays: 224.7, moons: "0", tempC: 464, tilt: 177.4 },
  { name: "Earth", kind: "Rocky planet · home", radius: 0.42, texture: "/textures/2k_earth_daymap.jpg", diameterKm: 12_756, dayHours: 24.0, spinHours: 23.93, yearDays: 365.26, moons: "1", tempC: 15, tilt: 23.4 },
  { name: "Mars", kind: "Rocky planet", radius: 0.3, texture: "/textures/2k_mars.jpg", diameterKm: 6792, dayHours: 24.7, spinHours: 24.62, yearDays: 687.0, moons: "2", tempC: -65, tilt: 25.2 },
  { name: "Jupiter", kind: "Gas giant", radius: 1.3, texture: "/textures/2k_jupiter.jpg", diameterKm: 142_984, dayHours: 9.9, spinHours: 9.93, yearDays: 4331, moons: "95+", tempC: -110, tilt: 3.1 },
  { name: "Saturn", kind: "Gas giant", radius: 1.1, texture: "/textures/2k_saturn.jpg", ring: "/textures/2k_saturn_ring_alpha.png", diameterKm: 120_536, dayHours: 10.7, spinHours: 10.66, yearDays: 10_747, moons: "270+", tempC: -140, tilt: 26.7 },
  { name: "Uranus", kind: "Ice giant", radius: 0.75, texture: "/textures/2k_uranus.jpg", diameterKm: 51_118, dayHours: 17.2, spinHours: -17.24, yearDays: 30_589, moons: "28+", tempC: -195, tilt: 97.8 },
  { name: "Neptune", kind: "Ice giant", radius: 0.72, texture: "/textures/2k_neptune.jpg", diameterKm: 49_528, dayHours: 16.1, spinHours: 16.11, yearDays: 59_800, moons: "16", tempC: -200, tilt: 28.3 },
];

export const bodyInfo = (name: BodyName) => BODIES.find((b) => b.name === name)!;

/** Scene units for 1 AU at Earth's distance; farther out, distances are compressed. */
export const EARTH_UNITS = 12;
/** Compressed distance: AU^0.55 keeps Mercury clear of the Sun and Neptune on screen. */
export const compress = (au: number) => EARTH_UNITS * Math.pow(au, 0.55);

/** Heliocentric ecliptic J2000 position (AU): astronomy-engine's equatorial vector, turned by the obliquity. */
export function helio(name: BodyName, date: Date): [number, number, number] {
  if (name === "Sun") return [0, 0, 0];
  const v = HelioVector(Body[name], date);
  return [v.x, Math.cos(OBLIQUITY) * v.y + Math.sin(OBLIQUITY) * v.z, -Math.sin(OBLIQUITY) * v.y + Math.cos(OBLIQUITY) * v.z];
}

/**
 * Scene position for an ecliptic vector: distance from the Sun compressed, direction kept
 * (so inclinations stay true), ecliptic north up: (x, z, −y).
 */
export function toScene(v: [number, number, number], out: [number, number, number] = [0, 0, 0]) {
  const r = Math.hypot(v[0], v[1], v[2]);
  const k = r > 0 ? compress(r) / r : 0;
  out[0] = v[0] * k;
  out[1] = v[2] * k;
  out[2] = -v[1] * k;
  return out;
}

/** One full lap of a planet's real orbit, starting at `date`, in scene coordinates. */
export function orbitPoints(name: BodyName, date: Date, points = 360): [number, number, number][] {
  const days = bodyInfo(name).yearDays;
  const out: [number, number, number][] = [];
  for (let k = 0; k <= points; k++) out.push(toScene(helio(name, new Date(date.getTime() + (k / points) * days * 86_400_000))));
  return out;
}

export interface Distances {
  /** From Earth, AU (null for Earth itself). */
  earthAu: number | null;
  /** Light travel time from the body to Earth, seconds. */
  lightS: number | null;
  /** From the Sun, AU (null for the Sun). */
  sunAu: number | null;
}

export function distances(name: BodyName, date: Date): Distances {
  const sunAu = name === "Sun" ? null : Math.hypot(...helio(name, date));
  if (name === "Earth") return { earthAu: null, lightS: null, sunAu };
  const g = GeoVector(Body[name], date, true);
  const earthAu = Math.hypot(g.x, g.y, g.z);
  return { earthAu, lightS: earthAu * AU_LIGHT_S, sunAu };
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export type Night =
  | { kind: "visible"; best: Date; altitude: number; direction: string; magnitude: number; from: Date; until: Date }
  | { kind: "glare"; elongation: number }
  | { kind: "below" }
  | { kind: "no-night" };

/**
 * Can `name` be seen with the eye from `place` on the night after `date`? The night runs from
 * the Sun reaching 6° below the horizon (civil dusk) to the same in the morning; the planet
 * counts as seen when it stands at least 10° up in that time. Planets within 12° of the Sun
 * are lost in its glare whatever the hour.
 */
export function night(name: BodyName, place: Place, date: Date): Night {
  const body = Body[name as Exclude<BodyName, "Sun" | "Earth">];
  const elongation = Elongation(body, date).elongation;
  if (elongation < 12) return { kind: "glare", elongation };
  const observer = new Observer(place.lat, place.lon, 0);
  // Start from local noon of the chosen day, found from the longitude rather than a time zone.
  const noon = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12) - (place.lon / 15) * 3_600_000);
  const dusk = SearchAltitude(Body.Sun, observer, -1, noon, 1, -6)?.date;
  const dawn = dusk ? SearchAltitude(Body.Sun, observer, +1, dusk, 1, -6)?.date : undefined;
  if (!dusk || !dawn) return { kind: "no-night" };
  let best = { at: dusk, altitude: -90, azimuth: 0 };
  let from: Date | null = null;
  let until: Date | null = null;
  for (let t = dusk.getTime(); t <= dawn.getTime(); t += 10 * 60_000) {
    const at = new Date(t);
    const eq = Equator(body, at, observer, true, true);
    const hor = Horizon(at, observer, eq.ra, eq.dec, "normal");
    if (hor.altitude >= 10) {
      from ??= at;
      until = at;
    }
    if (hor.altitude > best.altitude) best = { at, altitude: hor.altitude, azimuth: hor.azimuth };
  }
  if (!from || !until) return { kind: "below" };
  return {
    kind: "visible",
    best: best.at,
    altitude: best.altitude,
    direction: COMPASS[Math.round(best.azimuth / 45) % 8],
    magnitude: Illumination(body, best.at).mag,
    from,
    until,
  };
}

/** Next opposition (the planet opposite the Sun, closest and brightest) after `date`, for an outer planet. */
export function nextOpposition(name: "Mars" | "Jupiter" | "Saturn", date: Date): Date | null {
  return SearchRelativeLongitude(Body[name], 0, date)?.date ?? null;
}
