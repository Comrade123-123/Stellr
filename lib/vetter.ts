/**
 * Exoplanet Lab's vetter in the browser: evaluates the gradient-boosted trees that
 * scripts/train_vetter.py trains on NASA's Kepler and TESS signals (run by
 * .github/workflows/train-vetter.yml) and saves to public/models/vetter.json. The inputs must
 * match that script's `features`, in order.
 *
 * Version 2 (histogram gradient boosting) takes the star's size, temperature and gravity too,
 * any of which may be missing; version 1 (plain gradient boosting) took the signal alone.
 */

interface Metrics {
  auc: number;
  precision: number;
  recall: number;
  n: number;
  planets: number;
}

/** Version 2 tree: per node feature, threshold, whether a missing value goes left, children, value, leaf flag. */
interface TreeV2 {
  f: number[];
  t: number[];
  m: number[];
  l: number[];
  r: number[];
  v: number[];
  leaf: number[];
}

/** Version 1 tree: leaves are the nodes with no left child (−1). */
interface TreeV1 {
  f: number[];
  t: number[];
  l: number[];
  r: number[];
  v: number[];
}

export type VetterModel =
  | {
      version: 2;
      features: string[];
      init: number;
      trees: TreeV2[];
      metrics: { tess: Metrics; kepler: Metrics; tess_previous: Metrics };
      counts: { kepler: number; tess: number };
      trained: string;
      source: string;
    }
  | {
      version?: 1;
      features: string[];
      init: number;
      rate: number;
      trees: TreeV1[];
      metrics: { kepler: Metrics; tess: Metrics | null };
      trained: string;
      source: string;
    };

export interface StarParams {
  /** Solar radii. */
  radius: number | null;
  /** Kelvin. */
  teff: number | null;
  /** log10 of surface gravity in cgs. */
  logg: number | null;
}

const EARTH_PER_SUN = 109.1;

/** The model's inputs for a signal (depth as a fraction), NaN where the star is unknown. */
export function vetFeatures(period: number, durationH: number, depth: number, star: StarParams | null = null) {
  const ppm = depth * 1e6;
  if (!(period > 0 && durationH > 0 && ppm > 0)) return null;
  const r = star?.radius && star.radius > 0 ? star.radius : NaN;
  const planet = Math.sqrt(depth) * r * EARTH_PER_SUN;
  const longest = 13 * Math.cbrt(period / 365.25) * Math.pow(r, 2 / 3);
  return [
    Math.log10(period),
    Math.log10(ppm),
    Math.log10(durationH),
    Math.log10(durationH / (13 * Math.cbrt(period / 365.25))),
    planet > 0 ? Math.log10(planet) : NaN,
    longest > 0 ? Math.log10(durationH / longest) : NaN,
    star?.teff ?? NaN,
    star?.logg ?? NaN,
    1, // the lab's data is TESS
  ];
}

/** Probability (0…1) that a signal with these features is a planet, by the model's lights. */
export function planetScore(model: VetterModel, x: number[]) {
  let raw = model.init;
  if (model.version === 2) {
    for (const t of model.trees) {
      let n = 0;
      while (!t.leaf[n]) {
        const v = x[t.f[n]];
        n = Number.isNaN(v) ? (t.m[n] ? t.l[n] : t.r[n]) : v <= t.t[n] ? t.l[n] : t.r[n];
      }
      raw += t.v[n];
    }
  } else {
    for (const t of model.trees) {
      let n = 0;
      while (t.l[n] !== -1) n = x[t.f[n]] <= t.t[n] ? t.l[n] : t.r[n];
      raw += model.rate * t.v[n];
    }
  }
  return 1 / (1 + Math.exp(-raw));
}
