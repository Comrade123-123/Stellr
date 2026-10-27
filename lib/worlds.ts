/**
 * What a planet's measured numbers imply, for Exoplanet Lab's portrait: its orbit's size, how
 * much starlight it gets, how warm it would be, whether that falls in the star's habitable
 * zone, what kind of world its size suggests, and the colour of its star.
 */

const AU_PER_SUN_RADIUS = 0.00465047;
export const SUN_TEFF = 5772;

/** Semi-major axis (AU) from the period (days) and star mass (solar masses), by Kepler's third law. */
export const orbitAu = (periodDays: number, starMass: number) => Math.cbrt(Math.pow(periodDays / 365.25, 2) * starMass);

/** Starlight received, in multiples of what Earth gets from the Sun. */
export const insolation = (starRadius: number, starTeff: number, au: number) => (starRadius * starRadius * Math.pow(starTeff / SUN_TEFF, 4)) / (au * au);

/** Equilibrium temperature (K) for a planet reflecting 30% of its light (like Earth), heat spread all round. */
export const equilibriumTemp = (starRadius: number, starTeff: number, au: number, albedo = 0.3) =>
  starTeff * Math.sqrt((starRadius * AU_PER_SUN_RADIUS) / (2 * au)) * Math.pow(1 - albedo, 0.25);

/**
 * The conservative habitable zone as starlight limits, from Kopparapu et al. (2014, ApJL 787, L29),
 * for an Earth-mass planet: inner edge "runaway greenhouse", outer edge "maximum greenhouse".
 * Fitted for stars of 2,600–7,200 K; outside that the star's temperature is clamped.
 */
export function habitableZone(starTeff: number) {
  const t = Math.min(Math.max(starTeff, 2600), 7200) - 5780;
  const s = (s0: number, a: number, b: number, c: number, d: number) => s0 + a * t + b * t ** 2 + c * t ** 3 + d * t ** 4;
  return {
    inner: s(1.107, 1.332e-4, 1.58e-8, -8.308e-12, -1.931e-15),
    outer: s(0.356, 6.171e-5, 1.698e-9, -3.198e-12, -5.575e-16),
  };
}

export type WorldKind = "rocky" | "super-earth" | "neptune" | "giant" | "too-big";

/** What its size suggests. Boundaries follow the radius valley (~1.6–1.8 R⊕) and common size classes. */
export function worldKind(radiusEarth: number): WorldKind {
  if (radiusEarth < 1.6) return "rocky";
  if (radiusEarth < 2.5) return "super-earth";
  if (radiusEarth < 6) return "neptune";
  if (radiusEarth <= 22.4) return "giant";
  return "too-big";
}

export const KIND_LABEL: Record<WorldKind, string> = {
  rocky: "Rocky world",
  "super-earth": "Super-Earth or mini-Neptune",
  neptune: "Neptune-like",
  giant: "Gas giant",
  "too-big": "Too big for a planet",
};

/** An approximate colour for a star's light (black-body curve fitted to sRGB, after T. Helland). */
export function starColor(teff: number): [number, number, number] {
  const t = Math.min(Math.max(teff, 1000), 40000) / 100;
  const clamp = (v: number) => Math.min(255, Math.max(0, v));
  const r = t <= 66 ? 255 : clamp(329.698727446 * Math.pow(t - 60, -0.1332047592));
  const g = t <= 66 ? clamp(99.4708025861 * Math.log(t) - 161.1195681661) : clamp(288.1221695283 * Math.pow(t - 60, -0.0755148492));
  const b = t >= 66 ? 255 : t <= 19 ? 0 : clamp(138.5177312231 * Math.log(t - 10) - 305.0447927307);
  return [r, g, b];
}

/** Everything the portrait needs, from what was measured; null where the star is unknown. */
export function describe(o: { radiusEarth: number; period: number; starRadius: number; starTeff: number; starMass?: number | null }) {
  // Without a measured mass, a main-sequence star's mass is close to its radius in solar units.
  const mass = o.starMass && o.starMass > 0 ? o.starMass : o.starRadius;
  const au = orbitAu(o.period, mass);
  const s = insolation(o.starRadius, o.starTeff, au);
  const teq = equilibriumTemp(o.starRadius, o.starTeff, au);
  const hz = habitableZone(o.starTeff);
  // Starlight limits turned into distances (AU) for the orbit diagram.
  const lum = o.starRadius * o.starRadius * Math.pow(o.starTeff / SUN_TEFF, 4);
  return {
    au,
    insolation: s,
    teq,
    inZone: s <= hz.inner && s >= hz.outer,
    zone: { innerAu: Math.sqrt(lum / hz.inner), outerAu: Math.sqrt(lum / hz.outer) },
    kind: worldKind(o.radiusEarth),
    ratio: (o.radiusEarth / 109.1) / o.starRadius,
  };
}
