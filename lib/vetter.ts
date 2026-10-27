/**
 * Exoplanet Lab's vetter in the browser: evaluates the gradient-boosted trees that
 * scripts/train_vetter.py trains on NASA's Kepler signals (see .github/workflows/train-vetter.yml)
 * and saves to public/models/vetter.json. The inputs must match that script's `features`.
 */

interface Tree {
  /** Per node: feature index (−2 at leaves), threshold, left and right child (−1 at leaves), value. */
  f: number[];
  t: number[];
  l: number[];
  r: number[];
  v: number[];
}

interface Metrics {
  auc: number;
  precision: number;
  recall: number;
  n: number;
  planets: number;
}

export interface VetterModel {
  features: string[];
  init: number;
  rate: number;
  trees: Tree[];
  metrics: { kepler: Metrics; tess: Metrics | null };
  trained: string;
  source: string;
}

/** log10 period, depth (ppm), duration (h), and duration against 13 h · (P / 1 yr)^(1/3). */
export function vetFeatures(period: number, durationH: number, depth: number) {
  const ppm = depth * 1e6;
  if (!(period > 0 && durationH > 0 && ppm > 0)) return null;
  return [Math.log10(period), Math.log10(ppm), Math.log10(durationH), Math.log10(durationH / (13 * Math.cbrt(period / 365.25)))];
}

/** Probability (0…1) that a signal with these features is a planet, by the model's lights. */
export function planetScore(model: VetterModel, x: number[]) {
  let raw = model.init;
  for (const tree of model.trees) {
    let n = 0;
    while (tree.l[n] !== -1) n = x[tree.f[n]] <= tree.t[n] ? tree.l[n] : tree.r[n];
    raw += model.rate * tree.v[n];
  }
  return 1 / (1 + Math.exp(-raw));
}
