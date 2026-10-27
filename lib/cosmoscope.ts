import {
  Body,
  Elongation,
  Equator,
  GeoVector,
  GeoMoon,
  HelioVector,
  Horizon,
  Illumination,
  JupiterMoons,
  Observer,
  RotationAxis,
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

export type BodyName = "Sun" | "Mercury" | "Venus" | "Earth" | "Mars" | "Jupiter" | "Saturn" | "Uranus" | "Neptune" | "Pluto";

export interface BodyInfo {
  name: BodyName;
  kind: string;
  /** A sentence or two on what makes it itself. */
  about: string;
  /** Radius in scene units: hugely exaggerated, since true sizes would be invisible at these distances. */
  radius: number;
  /** Surface map; a body with none is drawn in `color`. */
  texture?: string;
  color?: string;
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

/** Figures from NASA's planetary fact sheets. Moon counts as of 2025. Pluto, a dwarf planet, is included for its fame and its orbit. */
export const BODIES: BodyInfo[] = [
  { name: "Sun", kind: "Star", about: "A middle-aged, middle-sized star, 109 Earths wide, holding 99.8% of all the mass in the Solar System. Everything on this map circles it.", radius: 1.5, texture: "/textures/2k_sun.jpg", diameterKm: 1_392_700, dayHours: 609.1, spinHours: 609.1, yearDays: 0, moons: "—", tempC: 5500, tilt: 7.25 },
  { name: "Mercury", kind: "Rocky planet", about: "The smallest planet and the closest to the Sun. With almost no air to hold heat, it swings from about 430 °C by day to −180 °C by night.", radius: 0.22, texture: "/textures/2k_mercury.jpg", diameterKm: 4879, dayHours: 4222.6, spinHours: 1407.6, yearDays: 88.0, moons: "0", tempC: 167, tilt: 0.03 },
  { name: "Venus", kind: "Rocky planet", about: "Nearly Earth's twin in size, but wrapped in thick clouds of sulphuric acid over a carbon-dioxide atmosphere that traps heat: the hottest planet of all.", radius: 0.4, texture: "/textures/2k_venus_atmosphere.jpg", diameterKm: 12_104, dayHours: 2802.0, spinHours: -5832.5, yearDays: 224.7, moons: "0", tempC: 464, tilt: 177.4 },
  { name: "Earth", kind: "Rocky planet · home", about: "Our home, and the only world known to carry life. Oceans cover 71% of its surface; one large Moon steadies its tilt.", radius: 0.42, texture: "/textures/2k_earth_daymap.jpg", diameterKm: 12_756, dayHours: 24.0, spinHours: 23.93, yearDays: 365.26, moons: "1", tempC: 15, tilt: 23.4 },
  { name: "Mars", kind: "Rocky planet", about: "A cold, dusty desert with the tallest volcano known, Olympus Mons, and dry riverbeds from a wetter past. Rovers are exploring it now.", radius: 0.3, texture: "/textures/2k_mars.jpg", diameterKm: 6792, dayHours: 24.7, spinHours: 24.62, yearDays: 687.0, moons: "2", tempC: -65, tilt: 25.2 },
  { name: "Jupiter", kind: "Gas giant", about: "The largest planet, more than twice the mass of all the others together: a ball of hydrogen and helium with no solid surface, banded by storms.", radius: 1.3, texture: "/textures/2k_jupiter.jpg", diameterKm: 142_984, dayHours: 9.9, spinHours: 9.93, yearDays: 4331, moons: "95+", tempC: -110, tilt: 3.1 },
  { name: "Saturn", kind: "Gas giant", about: "A gas giant less dense than water, circled by the brightest rings of any planet: ice and rock spread 280,000 km wide.", radius: 1.1, texture: "/textures/2k_saturn.jpg", ring: "/textures/2k_saturn_ring_alpha.png", diameterKm: 120_536, dayHours: 10.7, spinHours: 10.66, yearDays: 10_747, moons: "270+", tempC: -140, tilt: 26.7 },
  { name: "Uranus", kind: "Ice giant", about: "An ice giant knocked onto its side: each pole spends 42 years in sunlight, then 42 in darkness. Only Voyager 2 has visited.", radius: 0.75, texture: "/textures/2k_uranus.jpg", diameterKm: 51_118, dayHours: 17.2, spinHours: -17.24, yearDays: 30_589, moons: "28+", tempC: -195, tilt: 97.8 },
  { name: "Neptune", kind: "Ice giant", about: "The farthest planet, with the fastest winds measured anywhere in the Solar System, over 2,000 km/h. It was found by mathematics before it was seen, in 1846.", radius: 0.72, texture: "/textures/2k_neptune.jpg", diameterKm: 49_528, dayHours: 16.1, spinHours: 16.11, yearDays: 59_800, moons: "16", tempC: -200, tilt: 28.3 },
  { name: "Pluto", kind: "Dwarf planet", about: "A dwarf planet of the Kuiper Belt, smaller than our Moon, with a heart-shaped plain of nitrogen ice. Its tilted, stretched orbit brings it closer to the Sun than Neptune for 20 years in every 248. New Horizons flew past in 2015.", radius: 0.2, color: "#c9b59a", diameterKm: 2377, dayHours: 153.3, spinHours: -153.3, yearDays: 90_560, moons: "5", tempC: -225, tilt: 122.5 },
];

export const bodyInfo = (name: BodyName) => BODIES.find((b) => b.name === name)!;

/** Scene units for 1 AU at Earth's distance; farther out, distances are compressed. */
export const EARTH_UNITS = 12;
/** Compressed distance: AU^0.55 keeps Mercury clear of the Sun and Neptune on screen. */
export const compress = (au: number) => EARTH_UNITS * Math.pow(au, 0.55);

/**
 * Scene distance for `au` from the Sun. `mix` runs from 0 (compressed, the default view) to
 * 1 (true scale: distances proportional), so the view can glide between the two.
 */
export const sceneDistance = (au: number, mix = 0) => compress(au) * (1 - mix) + EARTH_UNITS * au * mix;

/** A body's true radius in scene units at true scale. */
export const trueRadius = (diameterKm: number) => (EARTH_UNITS * diameterKm) / 2 / AU_KM;

/** Drawn radius between the enlarged one (mix 0) and the true one (mix 1), blended on a log scale. */
export const blendRadius = (shown: number, real: number, mix: number) => Math.exp(Math.log(shown) * (1 - mix) + Math.log(real) * mix);

/** Equatorial J2000 → ecliptic J2000, turned by the obliquity. */
const ecliptic = (x: number, y: number, z: number): [number, number, number] => [
  x,
  Math.cos(OBLIQUITY) * y + Math.sin(OBLIQUITY) * z,
  -Math.sin(OBLIQUITY) * y + Math.cos(OBLIQUITY) * z,
];

/** Heliocentric ecliptic J2000 position (AU). */
export function helio(name: BodyName, date: Date): [number, number, number] {
  if (name === "Sun") return [0, 0, 0];
  const v = HelioVector(Body[name], date);
  return ecliptic(v.x, v.y, v.z);
}

/**
 * Scene position for a heliocentric ecliptic vector (AU): distance from the Sun mapped by
 * `sceneDistance`, direction kept (so inclinations stay true), ecliptic north up: (x, z, −y).
 */
export function toScene(v: ArrayLike<number>, out: [number, number, number] = [0, 0, 0], mix = 0) {
  const r = Math.hypot(v[0], v[1], v[2]);
  const k = r > 0 ? sceneDistance(r, mix) / r : 0;
  out[0] = v[0] * k;
  out[1] = v[2] * k;
  out[2] = -v[1] * k;
  return out;
}

/** Turns an ecliptic vector into scene axes: (x, z, −y), ecliptic north up. */
const sceneAxes = (v: [number, number, number]): [number, number, number] => [v[0], v[2], -v[1]];
const cross = (a: number[], b: number[]): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/**
 * A body's real orientation, in scene axes, from the IAU rotation model in astronomy-engine:
 * its north pole, and its prime meridian `spin` degrees east of where its equator crosses
 * Earth's (the node). `spin` defaults to the true angle for the moment; pass another to turn it
 * for show. Returns the spin used, so callers can carry on from it.
 */
export function bodyFrame(name: BodyName, date: Date, spin?: number) {
  const axis = RotationAxis(Body[name], date);
  const north = unit(sceneAxes(ecliptic(axis.north.x, axis.north.y, axis.north.z)));
  const ra = axis.ra * 15 * (Math.PI / 180);
  const node = unit(sceneAxes(ecliptic(-Math.sin(ra), Math.cos(ra), 0)));
  const ninety = cross(north, node);
  const w = ((spin ?? axis.spin) * Math.PI) / 180;
  const prime = unit([node[0] * Math.cos(w) + ninety[0] * Math.sin(w), node[1] * Math.cos(w) + ninety[1] * Math.sin(w), node[2] * Math.cos(w) + ninety[2] * Math.sin(w)]);
  const east = cross(north, prime);
  return { north, prime, east, spin: spin ?? axis.spin };
}

/** One full lap of a planet's real orbit, starting at `date`, as heliocentric ecliptic vectors (AU). */
export function orbitPoints(name: BodyName, date: Date, points = 360): [number, number, number][] {
  const days = bodyInfo(name).yearDays;
  const out: [number, number, number][] = [];
  for (let k = 0; k <= points; k++) out.push(helio(name, new Date(date.getTime() + (k / points) * days * 86_400_000)));
  return out;
}

export type MoonName = "Moon" | "Io" | "Europa" | "Ganymede" | "Callisto" | "Titan";

export interface MoonInfo {
  name: MoonName;
  parent: BodyName;
  /** Drawn radius, scene units. */
  radius: number;
  color: string;
  texture?: string;
  diameterKm: number;
  /** Mean distance from its planet, km. */
  distanceKm: number;
  /** Orbital period, days. */
  periodDays: number;
  note: string;
}

export const MOONS: MoonInfo[] = [
  { name: "Moon", parent: "Earth", radius: 0.12, color: "#bdbdbd", texture: "/textures/1k_moon.jpg", diameterKm: 3475, distanceKm: 384_400, periodDays: 27.32, note: "Always shows Earth the same face." },
  { name: "Io", parent: "Jupiter", radius: 0.13, color: "#e8d27a", diameterKm: 3643, distanceKm: 421_700, periodDays: 1.769, note: "The most volcanic world known." },
  { name: "Europa", parent: "Jupiter", radius: 0.12, color: "#d9cbb3", diameterKm: 3122, distanceKm: 671_034, periodDays: 3.551, note: "An ocean of liquid water under its ice." },
  { name: "Ganymede", parent: "Jupiter", radius: 0.19, color: "#9c9284", diameterKm: 5268, distanceKm: 1_070_412, periodDays: 7.155, note: "The largest moon in the Solar System, bigger than Mercury." },
  { name: "Callisto", parent: "Jupiter", radius: 0.17, color: "#6f6659", diameterKm: 4821, distanceKm: 1_882_709, periodDays: 16.689, note: "One of the most heavily cratered surfaces known." },
  { name: "Titan", parent: "Saturn", radius: 0.18, color: "#d39a4a", diameterKm: 5150, distanceKm: 1_221_870, periodDays: 15.945, note: "A thick orange atmosphere, with lakes of liquid methane." },
];

export const moonInfo = (name: MoonName) => MOONS.find((m) => m.name === name)!;

/**
 * A moon's position relative to its planet (ecliptic, AU), from astronomy-engine for the Moon
 * and Jupiter's four; Titan comes from JPL Horizons (`titan`), as astronomy-engine lacks it.
 */
export function moonOffset(name: MoonName, date: Date, titan: Track | null): [number, number, number] | null {
  if (name === "Moon") {
    const v = GeoMoon(date);
    return ecliptic(v.x, v.y, v.z);
  }
  if (name === "Titan") return titan ? trackAt(titan, date) : null;
  const m = JupiterMoons(date)[name.toLowerCase() as "io" | "europa" | "ganymede" | "callisto"];
  return ecliptic(m.x, m.y, m.z);
}

/**
 * How far from its planet a moon is drawn: proportional to the planet's drawn size, with the
 * real distance (in planet radii) compressed, so a moon never lands inside its planet.
 */
export function moonDistance(moon: MoonInfo) {
  const parent = bodyInfo(moon.parent);
  const ratio = moon.distanceKm / (parent.diameterKm / 2);
  return parent.radius * 0.5 * Math.pow(ratio, 0.6);
}

export interface CraftInfo {
  /** JPL Horizons ID. */
  id: string;
  name: string;
  launched: string;
  note: string;
}

export const CRAFT: CraftInfo[] = [
  { id: "-31", name: "Voyager 1", launched: "1977-09-05", note: "The farthest object humans have built. In interstellar space since 2012, still sending data." },
  { id: "-32", name: "Voyager 2", launched: "1977-08-20", note: "The only spacecraft to visit Uranus and Neptune. In interstellar space since 2018." },
  { id: "-98", name: "New Horizons", launched: "2006-01-19", note: "Flew past Pluto in 2015 and Arrokoth, the most distant world ever visited, in 2019." },
  { id: "-96", name: "Parker Solar Probe", launched: "2018-08-12", note: "The fastest and closest to the Sun of anything ever built: 6.1 million km from its surface in December 2024." },
];

/** Positions from JPL Horizons: Julian dates and ecliptic vectors (AU), 4 numbers per sample, in time order. */
export type Track = Float64Array;

const jd = (date: Date) => date.getTime() / 86_400_000 + 2440587.5;

/** Linear interpolation along a track; null outside it. */
export function trackAt(track: Track, date: Date): [number, number, number] | null {
  const n = track.length / 4;
  const t = jd(date);
  if (n < 2 || t < track[0] || t > track[(n - 1) * 4]) return null;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid * 4] <= t) lo = mid;
    else hi = mid;
  }
  const a = lo * 4;
  const b = hi * 4;
  const f = (t - track[a]) / (track[b] - track[a] || 1);
  return [track[a + 1] + (track[b + 1] - track[a + 1]) * f, track[a + 2] + (track[b + 2] - track[a + 2]) * f, track[a + 3] + (track[b + 3] - track[a + 3]) * f];
}

/** First and last moments a track covers. */
export const trackSpan = (track: Track): [Date, Date] => [
  new Date((track[0] - 2440587.5) * 86_400_000),
  new Date((track[track.length - 4] - 2440587.5) * 86_400_000),
];

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

/**
 * Where the Great Red Spot sits on the Jupiter texture (u, v from the top-left, found from its
 * colour), as a direction in the planet's own axes (three.js sphere mapping: x the prime
 * meridian, y north). Its longitude on the texture is not the storm's measured one.
 */
export const STORM_LOCAL: [number, number, number] = (() => {
  const phi = 0.366 * Math.PI * 2;
  const theta = 0.611 * Math.PI;
  return [-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta)];
})();

/**
 * The first moment from `date` (within one Jupiter day) when the storm, as placed here, is
 * well into daylight: its sunlit side facing the Sun.
 */
export function stormInDaylight(date: Date): Date {
  let best = { at: date, light: -2 };
  for (let k = 0; k <= 120; k++) {
    const at = new Date(date.getTime() + k * 5 * 60_000);
    const f = bodyFrame("Jupiter", at);
    const [x, y, z] = STORM_LOCAL;
    const spot = [0, 1, 2].map((i) => f.prime[i] * x + f.north[i] * y - f.east[i] * z);
    const h = sceneAxes(helio("Jupiter", at));
    const r = Math.hypot(...h);
    const light = -(spot[0] * h[0] + spot[1] * h[1] + spot[2] * h[2]) / r;
    if (light > 0.6) return at;
    if (light > best.light) best = { at, light };
  }
  return best.at;
}
