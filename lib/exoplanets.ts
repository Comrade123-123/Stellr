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

/** A light curve: times in BTJD (BJD − 2457000) and flux normalised to 1. */
export interface Curve {
  t: Float64Array;
  f: Float64Array;
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
 * Takes out the star's slow changes (spots, rotation, instrument drift) so only short dips
 * remain: each point is divided by the median of its neighbours within ±`window` days,
 * sampled on a grid every quarter of the window and interpolated. Bright outliers
 * (more than 4σ above) are dropped; dips are kept, since they may be transits.
 */
export function flatten(curve: Curve, window = 0.5): Curve {
  const { t, f } = curve;
  const n = t.length;
  if (n < 10) return curve;
  const step = window / 4;
  const knots: { t: number; m: number }[] = [];
  let lo = 0;
  let hi = 0;
  for (let k = t[0]; k <= t[n - 1] + step; k += step) {
    while (lo < n && t[lo] < k - window) lo++;
    while (hi < n && t[hi] <= k + window) hi++;
    if (hi - lo >= 5) knots.push({ t: k, m: median(Array.from(f.subarray(lo, hi))) });
  }
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
  const keepT: number[] = [];
  const keepF: number[] = [];
  flat.forEach((v, i) => {
    if (Number.isFinite(v) && v - 1 < 4 * sigma) {
      keepT.push(t[i]);
      keepF.push(v);
    }
  });
  return { t: Float64Array.from(keepT), f: Float64Array.from(keepF) };
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
  const maxP = Math.min(opts.maxP ?? 30, span / 2);
  if (maxP <= minP) return null;

  // Weights from the scatter, the same for every point; flux as dip below 1.
  const y = Float64Array.from(f, (v) => v - 1);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += y[i];
  mean /= n;
  for (let i = 0; i < n; i++) y[i] -= mean;

  // Frequency grid: Δf = q / (3 · span) with q the expected duty cycle ~ duration/period.
  const freqs: number[] = [];
  const fmin = 1 / maxP;
  const fmax = 1 / minP;
  const likelyDuration = (P: number) => Math.max(0.04, 0.1 * Math.cbrt(P)); // days, Sun-like star
  for (let fr = fmin; fr <= fmax; ) {
    freqs.push(fr);
    const P = 1 / fr;
    fr += likelyDuration(P) / P / (3 * span);
  }
  // Too fine for the time available: thin evenly in frequency.
  const cap = opts.maxFreqs ?? 60_000;
  const grid = freqs.length > cap ? Array.from({ length: cap }, (_, k) => fmin + ((fmax - fmin) * k) / (cap - 1)) : freqs;

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
  };
}

export type Checks = ReturnType<typeof measure>;

/** Points within each transit of a signal removed, so the next search can find another. */
export function mask(curve: Curve, period: number, t0: number, durationH: number): Curve {
  const half = (durationH / 24) * 0.75;
  const keep: number[] = [];
  for (let i = 0; i < curve.t.length; i++) if (Math.abs(fromTransit(curve.t[i], period, t0)) > half) keep.push(i);
  return { t: Float64Array.from(keep, (i) => curve.t[i]), f: Float64Array.from(keep, (i) => curve.f[i]) };
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
