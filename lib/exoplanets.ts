/**
 * Exoplanet Lab's science, shared by the page and its worker: the catalogue's shape, the
 * light-curve clean-up, a Box Least Squares transit search, quick checks on what it finds,
 * and comparison with planets already known around the same star.
 *
 * BLS: Kovács, Zucker & Mazeh (2002), A&A 391, 369. A transit is modelled as a box-shaped
 * dip; for each trial period the light curve is folded and every box position and width
 * tried, scored by how much better a box fits than a flat line.
 */

/** One confirmed planet from the NASA Exoplanet Archive's composite table. */
export interface Planet {
  name: string;
  host: string;
  /** "TIC 123456789" when the star has a TESS Input Catalog number. */
  tic: string | null;
  method: string;
  year: number | null;
  facility: string;
  /** Orbital period, days. */
  period: number | null;
  /** Radius, Earth radii. */
  radius: number | null;
  /** Mass (or minimum mass), Earth masses. */
  mass: number | null;
  /** Equilibrium temperature, K. */
  temp: number | null;
  /** Distance from Earth, parsecs. */
  distance: number | null;
  /** Star's radius, solar radii. */
  starRadius: number | null;
  /** Star's temperature, K. */
  starTemp: number | null;
  /** Mid-transit time, BJD (TDB), when it transits. */
  t0: number | null;
  /** Transit depth, %, when it transits. */
  depth: number | null;
}

/** The catalogue as sent: column names once, then rows of values in that order. */
export const CATALOG_FIELDS = [
  "pl_name",
  "hostname",
  "tic_id",
  "discoverymethod",
  "disc_year",
  "disc_facility",
  "pl_orbper",
  "pl_rade",
  "pl_bmasse",
  "pl_eqt",
  "sy_dist",
  "st_rad",
  "st_teff",
  "pl_tranmid",
  "pl_trandep",
] as const;

export function planetFromRow(r: unknown[]): Planet {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    name: s(r[0]),
    host: s(r[1]),
    tic: s(r[2]) || null,
    method: s(r[3]),
    year: n(r[4]),
    facility: s(r[5]),
    period: n(r[6]),
    radius: n(r[7]),
    mass: n(r[8]),
    temp: n(r[9]),
    distance: n(r[10]),
    starRadius: n(r[11]),
    starTemp: n(r[12]),
    t0: n(r[13]),
    depth: n(r[14]),
  };
}

/**
 * A light curve: times in BTJD (BJD − 2457000) and flux normalised to 1, with the star's
 * light centre (pixels from its median) where the file had it.
 */
export interface Curve {
  t: Float64Array;
  f: Float64Array;
  cx?: Float64Array;
  cy?: Float64Array;
}

/** The points of a curve at `idx`, keeping the centroid columns aligned. */
export function pick(curve: Curve, idx: number[], f?: ArrayLike<number>): Curve {
  const out: Curve = { t: Float64Array.from(idx, (i) => curve.t[i]), f: Float64Array.from(idx, (i) => (f ?? curve.f)[i]) };
  if (curve.cx && curve.cy) {
    out.cx = Float64Array.from(idx, (i) => curve.cx![i]);
    out.cy = Float64Array.from(idx, (i) => curve.cy![i]);
  }
  return out;
}

/** Curves joined in time order. */
export function join(parts: Curve[]): Curve {
  const sorted = [...parts].sort((a, b) => a.t[0] - b.t[0]);
  const n = sorted.reduce((a, p) => a + p.t.length, 0);
  const withC = sorted.every((p) => p.cx && p.cy);
  const out: Curve = { t: new Float64Array(n), f: new Float64Array(n) };
  if (withC) {
    out.cx = new Float64Array(n);
    out.cy = new Float64Array(n);
  }
  let k = 0;
  for (const p of sorted) {
    out.t.set(p.t, k);
    out.f.set(p.f, k);
    if (withC) {
      out.cx!.set(p.cx!, k);
      out.cy!.set(p.cy!, k);
    }
    k += p.t.length;
  }
  return out;
}

/** A transit ephemeris: period and mid-transit (days, BTJD) and duration (hours). */
export interface Ephemeris {
  period: number;
  t0: number;
  duration: number;
}

/** TESS times are BJD − 2457000. */
export const BTJD = 2457000;

function median(values: number[]) {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Tukey's biweight location of `v` (c = 5): a mean that ignores outliers, starting from the
 * median and down-weighting points far from it. Kept points that are dips pull it far less
 * than a plain mean, and it follows the star more smoothly than a median. (Hippke et al. 2019,
 * "Wōtan", found it the best of the common detrending filters for finding transits.)
 */
function biweight(v: number[]) {
  let m = median(v);
  for (let it = 0; it < 4; it++) {
    const mad = median(v.map((x) => Math.abs(x - m))) || 1e-9;
    let num = 0;
    let den = 0;
    for (const x of v) {
      const u = (x - m) / (5 * mad);
      if (u * u >= 1) continue;
      const w = (1 - u * u) * (1 - u * u);
      num += w * x;
      den += w;
    }
    if (!den) break;
    const next = num / den;
    if (Math.abs(next - m) < 1e-7) {
      m = next;
      break;
    }
    m = next;
  }
  return m;
}

/**
 * Takes out the star's slow changes (spots, rotation, instrument drift) so only short dips
 * remain: each point is divided by the biweight location of its neighbours within ±`window`
 * days, sampled on a grid every eighth of the window and interpolated. Points in `exclude`
 * (known transits) don't shape the trend, so a dip found once isn't partly flattened away when
 * the curve is cleaned again around it. Bright outliers (more than 4σ above) are dropped;
 * dips are kept, since they may be transits.
 */
export function flatten(curve: Curve, window = 0.5, exclude: Ephemeris[] = []): Curve {
  const { t, f } = curve;
  const n = t.length;
  if (n < 10) return curve;
  const out = new Uint8Array(n);
  for (const e of exclude) {
    const half = (e.duration / 24) * 0.75;
    for (let i = 0; i < n; i++) if (Math.abs(fromTransit(t[i], e.period, e.t0)) < half) out[i] = 1;
  }
  const step = window / 8;
  const knots: { t: number; m: number }[] = [];
  let lo = 0;
  let hi = 0;
  for (let k = t[0]; k <= t[n - 1] + step; k += step) {
    while (lo < n && t[lo] < k - window) lo++;
    while (hi < n && t[hi] <= k + window) hi++;
    const vals: number[] = [];
    for (let i = lo; i < hi; i++) if (!out[i]) vals.push(f[i]);
    if (vals.length >= 5) knots.push({ t: k, m: biweight(vals) });
  }
  if (knots.length < 2) return curve;
  const trend = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    while (j < knots.length - 2 && knots[j + 1].t < t[i]) j++;
    const a = knots[j];
    const b = knots[Math.min(j + 1, knots.length - 1)];
    const w = b.t === a.t ? 0 : (t[i] - a.t) / (b.t - a.t);
    trend[i] = a.m + (b.m - a.m) * Math.min(Math.max(w, 0), 1);
  }
  const flat = Array.from(f, (v, i) => v / trend[i]);
  const sigma = 1.4826 * median(flat.map((v) => Math.abs(v - 1)));
  const keep: number[] = [];
  flat.forEach((v, i) => {
    if (Number.isFinite(v) && v - 1 < 4 * sigma) keep.push(i);
  });
  return pick(curve, keep, flat);
}

/** Robust scatter (σ) of a flattened light curve around 1. */
export const scatter = (f: ArrayLike<number>) => 1.4826 * median(Array.from(f, (v) => Math.abs(v - 1)));

/** Trial transit durations, hours. */
const DURATIONS_H = [0.75, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12];
const PHASE_BINS = 400;

export interface BlsResult {
  /** Days. */
  period: number;
  /** Mid-transit time, BTJD. */
  t0: number;
  /** Hours. */
  duration: number;
  /** Fractional dip, e.g. 0.01 = 1%. */
  depth: number;
  /** Depth over its uncertainty from the scatter and the number of in-transit points. */
  snr: number;
  /** Signal Detection Efficiency: how far the peak stands above the rest of the periodogram, in σ. */
  sde: number;
  /** Transits with data in them. */
  transits: number;
  /** Periodogram for drawing, thinned: periods (days) and power. */
  periods: Float64Array;
  power: Float64Array;
}

/**
 * Searches for a periodic box-shaped dip between `minP` and `maxP` days. The frequency grid
 * is fine enough that a transit drifts by no more than a third of its likely duration across
 * the whole baseline. `progress` is called with 0…1.
 */
export function bls(curve: Curve, opts: { minP?: number; maxP?: number; maxFreqs?: number; progress?: (p: number) => void } = {}): BlsResult | null {
  const { t, f } = curve;
  const n = t.length;
  if (n < 50) return null;
  const span = t[n - 1] - t[0];
  const minP = opts.minP ?? 0.4;
  const maxP = Math.min(opts.maxP ?? 40, span / 2);
  if (maxP <= minP) return null;

  // Weights from the scatter, the same for every point; flux as dip below 1.
  const y = Float64Array.from(f, (v) => v - 1);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += y[i];
  mean /= n;
  for (let i = 0; i < n; i++) y[i] -= mean;

  // Frequency grid: Δf = q / (3 · span) with q the expected duty cycle ~ duration/period, so a
  // transit drifts by under a third of its length across the whole baseline. Data spread over
  // years need very many; past the cap, every step is widened by the same factor, keeping the
  // grid finest where it must be (long periods) rather than thinning it evenly.
  const fmin = 1 / maxP;
  const fmax = 1 / minP;
  const likelyDuration = (P: number) => Math.max(0.04, 0.1 * Math.cbrt(P)); // days, Sun-like star
  const step = (fr: number) => likelyDuration(1 / fr) * fr / (3 * span);
  const build = (k: number) => {
    const out: number[] = [];
    for (let fr = fmin; fr <= fmax; fr += k * step(fr)) out.push(fr);
    return out;
  };
  const cap = opts.maxFreqs ?? 150_000;
  let grid = build(1);
  if (grid.length > cap) grid = build(grid.length / cap);

  const power = new Float64Array(grid.length);
  const best = { power: -1, freq: 0, start: 0, width: 0 };
  const wBins = new Float64Array(PHASE_BINS);
  const yBins = new Float64Array(PHASE_BINS);
  const cw = new Float64Array(2 * PHASE_BINS + 1);
  const cy = new Float64Array(2 * PHASE_BINS + 1);
  const t0 = t[0];

  for (let g = 0; g < grid.length; g++) {
    const fr = grid[g];
    const P = 1 / fr;
    wBins.fill(0);
    yBins.fill(0);
    for (let i = 0; i < n; i++) {
      const ph = ((t[i] - t0) * fr) % 1;
      const b = (ph * PHASE_BINS) | 0;
      wBins[b] += 1;
      yBins[b] += y[i];
    }
    // Prefix sums over two laps, so a box can wrap past phase 1.
    for (let k = 0; k < 2 * PHASE_BINS; k++) {
      cw[k + 1] = cw[k] + wBins[k % PHASE_BINS];
      cy[k + 1] = cy[k] + yBins[k % PHASE_BINS];
    }
    let peak = 0;
    let peakStart = 0;
    let peakWidth = 0;
    for (const hours of DURATIONS_H) {
      const q = hours / 24 / P;
      if (q > 0.15) continue;
      const width = Math.max(1, Math.round(q * PHASE_BINS));
      for (let s = 0; s < PHASE_BINS; s++) {
        const r = cw[s + width] - cw[s];
        if (r < 3) continue;
        const sum = cy[s + width] - cy[s];
        if (sum >= 0) continue; // a dip, not a bump
        const rf = r / n;
        const sr = (sum * sum) / (n * n * rf * (1 - rf));
        if (sr > peak) {
          peak = sr;
          peakStart = s;
          peakWidth = width;
        }
      }
    }
    power[g] = peak;
    if (peak > best.power) Object.assign(best, { power: peak, freq: fr, start: peakStart, width: peakWidth });
    if (opts.progress && g % 2000 === 0) opts.progress(g / grid.length);
  }
  if (best.power <= 0) return null;

  // The peak against the rest: SDE.
  let sum = 0;
  let sq = 0;
  for (const p of power) {
    sum += p;
    sq += p * p;
  }
  const avg = sum / power.length;
  const sd = Math.sqrt(Math.max(sq / power.length - avg * avg, 1e-30));
  const sde = (best.power - avg) / sd;

  const period = 1 / best.freq;
  const tMid = t0 + ((best.start + best.width / 2) / PHASE_BINS) * period;
  const duration = (best.width / PHASE_BINS) * period * 24;
  const fit = measure(curve, period, tMid, duration);

  // Thin the periodogram for drawing: the highest power in each of 1,500 slices.
  const slices = Math.min(1500, grid.length);
  const periods = new Float64Array(slices);
  const thin = new Float64Array(slices);
  for (let k = 0; k < slices; k++) {
    const a = Math.floor((k * grid.length) / slices);
    const b = Math.max(a + 1, Math.floor(((k + 1) * grid.length) / slices));
    let m = 0;
    let at = a;
    for (let g = a; g < b; g++)
      if (power[g] > m) {
        m = power[g];
        at = g;
      }
    periods[k] = 1 / grid[at];
    thin[k] = m;
  }

  return { period, t0: tMid, duration, depth: fit.depth, snr: fit.snr, sde, transits: fit.transits, periods, power: thin };
}

/** Days from the nearest mid-transit, for a point at `time`. */
export const fromTransit = (time: number, period: number, t0: number) => {
  const ph = (((time - t0) / period) % 1 + 1.5) % 1 - 0.5;
  return ph * period;
};

/** Depth and its significance for a given ephemeris; also odd and even transits separately and a look at phase 0.5. */
export function measure(curve: Curve, period: number, t0: number, durationH: number) {
  const half = durationH / 24 / 2;
  const sigma = scatter(curve.f);
  const inside: number[] = [];
  const core: number[] = [];
  const edge: number[] = [];
  const odd: number[] = [];
  const even: number[] = [];
  const opposite: number[] = [];
  const out: number[] = [];
  const epochs = new Set<number>();
  for (let i = 0; i < curve.t.length; i++) {
    const dt = fromTransit(curve.t[i], period, t0);
    const v = curve.f[i];
    if (Math.abs(dt) < half) {
      inside.push(v);
      (Math.abs(dt) < half / 2 ? core : edge).push(v);
      const epoch = Math.round((curve.t[i] - t0) / period);
      epochs.add(epoch);
      (epoch % 2 === 0 ? even : odd).push(v);
    } else {
      out.push(v);
      const dOpp = fromTransit(curve.t[i], period, t0 + period / 2);
      if (Math.abs(dOpp) < half) opposite.push(v);
    }
  }
  const base = out.length ? out.reduce((a, b) => a + b, 0) / out.length : 1;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const depth = base - avg(inside);
  const err = (k: number) => sigma / Math.sqrt(Math.max(k, 1));
  return {
    depth,
    snr: depth / err(inside.length),
    transits: epochs.size,
    odd: { depth: base - avg(odd), err: err(odd.length), n: odd.length },
    even: { depth: base - avg(even), err: err(even.length), n: even.length },
    secondary: { depth: base - avg(opposite), err: err(opposite.length), n: opposite.length },
    /** The middle half of the transit against its outer half: a flat-bottomed (U) dip has them alike; a V-shaped one, typical of grazing eclipsing stars, is much shallower at the edges. */
    shape: { core: base - avg(core), edge: base - avg(edge), err: Math.hypot(err(core.length), err(edge.length)) },
    variability: variability(curve, period, t0, half, sigma),
    centroid: centroid(curve, period, t0, half, depth),
  };
}

/**
 * Does the star's light centre move during the dip? For each transit, the centroid inside it
 * against the centroid just around it (out to three transit-lengths away), averaged over all
 * transits. A shift divided by the depth estimates how far from the target the dimming star
 * lies, in pixels (21″ each): a planet's own star gives ~0, a blended neighbour several. Null
 * when the light curve carries no centroid or too little is around the transits.
 */
function centroid(curve: Curve, period: number, t0: number, half: number, depth: number) {
  const { cx, cy } = curve;
  if (!cx || !cy || !(depth > 0)) return null;
  const inX: number[] = [];
  const inY: number[] = [];
  const outX: number[] = [];
  const outY: number[] = [];
  // Baselines per transit, so slow drifts in the centroid cancel.
  const byEpoch = new Map<number, { ix: number[]; iy: number[]; ox: number[]; oy: number[] }>();
  for (let i = 0; i < curve.t.length; i++) {
    const dt = Math.abs(fromTransit(curve.t[i], period, t0));
    if (dt > half * 6) continue;
    const e = Math.round((curve.t[i] - t0) / period);
    const g = byEpoch.get(e) ?? { ix: [], iy: [], ox: [], oy: [] };
    byEpoch.set(e, g);
    if (dt < half * 0.8) {
      g.ix.push(cx[i]);
      g.iy.push(cy[i]);
    } else if (dt > half * 1.5) {
      g.ox.push(cx[i]);
      g.oy.push(cy[i]);
    }
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  for (const g of byEpoch.values()) {
    if (g.ix.length < 2 || g.ox.length < 4) continue;
    const bx = mean(g.ox);
    const by = mean(g.oy);
    for (const v of g.ix) inX.push(v - bx);
    for (const v of g.iy) inY.push(v - by);
    for (const v of g.ox) outX.push(v - bx);
    for (const v of g.oy) outY.push(v - by);
  }
  if (inX.length < 3 || outX.length < 10) return null;
  const sd = (xs: number[]) => 1.4826 * median(xs.map((v) => Math.abs(v)));
  const dx = mean(inX);
  const dy = mean(inY);
  const ex = sd(outX) / Math.sqrt(inX.length);
  const ey = sd(outY) / Math.sqrt(inY.length);
  const shift = Math.hypot(dx, dy);
  const sigma = Math.hypot(dx / (ex || 1e-9), dy / (ey || 1e-9)) / Math.SQRT2;
  return { dx, dy, sigma, offsetPx: shift / depth, offsetErr: Math.hypot(ex, ey) / depth };
}

/**
 * How much the star brightens and dims on the same period away from the dip: the light curve
 * outside the transit folded into 24 phase bins, the spread of their averages, and the noise
 * such a spread would show by chance. Spots, pulsation and close binaries vary smoothly all
 * the way round; a transiting planet leaves the rest flat.
 */
function variability(curve: Curve, period: number, t0: number, half: number, sigma: number) {
  const BINS = 24;
  const sum = new Float64Array(BINS);
  const n = new Float64Array(BINS);
  for (let i = 0; i < curve.t.length; i++) {
    const dt = fromTransit(curve.t[i], period, t0);
    if (Math.abs(dt) < half * 1.5) continue;
    const b = Math.min(BINS - 1, Math.floor(((dt / period + 0.5) % 1) * BINS));
    sum[b] += curve.f[i];
    n[b]++;
  }
  const means: number[] = [];
  let fewest = Infinity;
  for (let b = 0; b < BINS; b++)
    if (n[b] >= 5) {
      means.push(sum[b] / n[b]);
      fewest = Math.min(fewest, n[b]);
    }
  if (means.length < 6) return { amplitude: 0, noise: Infinity };
  return { amplitude: Math.max(...means) - Math.min(...means), noise: (4 * sigma) / Math.sqrt(fewest) };
}

export type Checks = ReturnType<typeof measure>;

/** Points within each transit of a signal removed, so the next search can find another. */
export function mask(curve: Curve, period: number, t0: number, durationH: number): Curve {
  const half = (durationH / 24) * 0.75;
  const keep: number[] = [];
  for (let i = 0; i < curve.t.length; i++) if (Math.abs(fromTransit(curve.t[i], period, t0)) > half) keep.push(i);
  return pick(curve, keep);
}

/** How a found period relates to a known planet's: the same, or a simple multiple (often a sign of a missed or doubled transit). */
export function relation(found: number, known: number): string | null {
  for (const [k, label] of [
    [1, "same period"],
    [2, "twice its period"],
    [0.5, "half its period"],
    [3, "three times its period"],
    [1 / 3, "a third of its period"],
  ] as const) {
    if (Math.abs(found / (known * k) - 1) < 0.01) return label;
  }
  return null;
}

/** Earth radii per solar radius. */
export const EARTH_PER_SUN = 109.1;

/**
 * The longest a transit can last, in hours, for a planet crossing the middle of a star of
 * `starRadius` solar radii: 13 h for Earth around the Sun, scaling with P^(1/3) and with the
 * star's size over the cube root of its mass. The mass is taken as ≈ its radius (true for
 * Sun-like and smaller main-sequence stars), so this is approximate.
 */
export const longestTransit = (period: number, starRadius: number) => 13 * Math.cbrt(period / 365.25) * Math.pow(starRadius, 2 / 3);

/** Twice Jupiter's radius, in Earth radii: anything larger is a star, not a planet. */
export const MAX_PLANET_RADIUS = 22.4;

/**
 * A transit-shaped refit of a BLS detection, after Transit Least Squares (Hippke & Heller 2019):
 * a real transit has sloped ingress and egress and a limb-darkened, rounded bottom, not a
 * box. Around the BLS peak, nearby periods, mid-times, durations and ingress lengths are
 * tried with that shape, and the best is kept. Depths and durations come out closer to the
 * truth, and small planets gain signal-to-noise. A box would leave part of each transit out.
 */
export function refine(curve: Curve, r: { period: number; t0: number; duration: number }) {
  const { t, f } = curve;
  const n = t.length;
  if (n < 50) return null;
  const span = t[n - 1] - t[0];
  const sigma = scatter(f);
  // Quadratic limb darkening for a Sun-like star in the TESS band.
  const u1 = 0.4;
  const u2 = 0.25;
  const norm = 1 - u1 / 3 - u2 / 6;
  const shape = (x: number, ingress: number) => {
    // x: distance from mid-transit in units of half the duration.
    const ax = Math.abs(x);
    if (ax >= 1) return 0;
    const edge = ax > 1 - ingress ? (1 - ax) / ingress : 1;
    const r2 = Math.min(1, (ax * ax) / ((1 - ingress / 2) ** 2));
    const mu = Math.sqrt(1 - r2);
    const ld = (1 - u1 * (1 - mu) - u2 * (1 - mu) ** 2) / norm;
    return edge * ld;
  };
  let best = { chi: Infinity, period: r.period, t0: r.t0, duration: r.duration, depth: 0, snr: 0, ingress: 0.2 };
  const half0 = r.duration / 48;
  const dP = (r.period * half0) / Math.max(span, r.period);
  for (let ip = -3; ip <= 3; ip++) {
    const P = r.period + ip * dP * 0.5;
    for (let it = -4; it <= 4; it++) {
      const tc = r.t0 + it * half0 * 0.15;
      for (const k of [0.6, 0.75, 0.9, 1.0, 1.15, 1.3, 1.5]) {
        const half = half0 * k;
        for (const ingress of [0.1, 0.25, 0.4, 0.6]) {
          let sy = 0;
          let ss = 0;
          let yy = 0;
          for (let i = 0; i < n; i++) {
            const dt = fromTransit(t[i], P, tc);
            if (Math.abs(dt) > half * 2.5) continue;
            const y = 1 - f[i];
            const m = shape(dt / half, ingress);
            sy += m * y;
            ss += m * m;
            yy += y * y;
          }
          if (ss <= 0) continue;
          const depth = sy / ss;
          if (depth <= 0) continue;
          // χ² of the window with the model, relative to the flat line (yy): lower is better.
          const chi = yy - (sy * sy) / ss;
          if (chi < best.chi) best = { chi, period: P, t0: tc, duration: half * 48, depth, snr: (depth * Math.sqrt(ss)) / sigma, ingress };
        }
      }
    }
  }
  return Number.isFinite(best.chi) ? best : null;
}

export interface SingleDip {
  /** Mid-dip, BTJD. */
  t0: number;
  /** Hours. */
  duration: number;
  depth: number;
  snr: number;
}

/**
 * Lone dips: a planet on a long orbit may cross its star only once while TESS watches. Boxes of
 * 2 to 13 hours are slid along the (already flattened, already masked) light curve; a dip
 * counts when it is at least `minSnr` deep for the noise, well covered by data, has data on
 * both sides, and sits away from the gaps where the spacecraft's data are least trustworthy.
 * The strongest few, not overlapping, are returned.
 */
export function singleDips(curve: Curve, minSnr = 10, max = 3): SingleDip[] {
  const { t, f } = curve;
  const n = t.length;
  if (n < 100) return [];
  const sigma = scatter(f);
  const cadence = median(Array.from({ length: Math.min(n - 1, 2000) }, (_, i) => t[i + 1] - t[i]));
  // Gaps over half a day, and how near each point is to one.
  const gaps: number[] = [t[0]];
  for (let i = 1; i < n; i++) if (t[i] - t[i - 1] > 0.5) gaps.push(t[i - 1], t[i]);
  gaps.push(t[n - 1]);
  const nearGap = (time: number) => gaps.some((g) => Math.abs(g - time) < 0.75);
  const found: SingleDip[] = [];
  for (const hours of [2, 3, 4, 6, 9, 13]) {
    const w = hours / 24;
    const expect = w / cadence;
    let lo = 0;
    let hi = 0;
    for (let c = t[0] + w; c < t[n - 1] - w; c += w / 4) {
      while (lo < n && t[lo] < c - w / 2) lo++;
      while (hi < n && t[hi] <= c + w / 2) hi++;
      const k = hi - lo;
      if (k < Math.max(3, 0.6 * expect)) continue;
      let sum = 0;
      for (let i = lo; i < hi; i++) sum += 1 - f[i];
      const depth = sum / k;
      const snr = (depth / sigma) * Math.sqrt(k);
      if (snr < minSnr || depth > 0.03) continue;
      if (nearGap(c)) continue;
      // Data on both sides, within a dip-length.
      let before = 0;
      let after = 0;
      for (let i = Math.max(0, lo - Math.ceil(expect * 1.5)); i < lo; i++) if (t[i] > c - w * 1.5) before++;
      for (let i = hi; i < Math.min(n, hi + Math.ceil(expect * 1.5)); i++) if (t[i] < c + w * 1.5) after++;
      if (before < 0.4 * expect || after < 0.4 * expect) continue;
      found.push({ t0: c, duration: hours, depth, snr });
    }
  }
  found.sort((a, b) => b.snr - a.snr);
  const out: SingleDip[] = [];
  for (const d of found) {
    if (out.some((o) => Math.abs(o.t0 - d.t0) < (o.duration + d.duration) / 24)) continue;
    out.push(d);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * One full search, shared by Exoplanet Lab's worker and the Wobble agent so both find alike:
 * flatten, hide signals already found, Box Least Squares, then a transit-shaped refit; then the
 * light curve is flattened again with this signal's transits kept out of the trend (so the
 * clean-up doesn't eat into them) and measured, and finally searched for lone dips with every
 * signal hidden.
 */
export function searchOnce(curve: Curve, found: Ephemeris[], opts: { maxP?: number; maxFreqs?: number; progress?: (p: number) => void } = {}) {
  const hide = (c: Curve, list: Ephemeris[]) => list.reduce((acc, m) => mask(acc, m.period, m.t0, m.duration), c);
  const flat = hide(flatten(curve, 0.5, found), found);
  const first = bls(flat, opts);
  if (!first) return { flat, result: null, checks: null, singles: singleDips(flat) };
  const fit = refine(flat, first);
  const result: BlsResult = fit && fit.snr > first.snr ? { ...first, period: fit.period, t0: fit.t0, duration: fit.duration, depth: fit.depth, snr: fit.snr } : first;
  const eph = { period: result.period, t0: result.t0, duration: result.duration };
  const clean = hide(flatten(curve, 0.5, [...found, eph]), found);
  const checks = measure(clean, result.period, result.t0, result.duration);
  // Measured on the clean curve, the box depth and its significance are the better figures.
  if (checks.depth > 0 && checks.snr > result.snr) Object.assign(result, { depth: checks.depth, snr: checks.snr });
  return { flat: clean, result, checks, singles: singleDips(mask(clean, eph.period, eph.t0, eph.duration)) };
}
