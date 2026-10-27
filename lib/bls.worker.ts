/// <reference lib="webworker" />
import { bls, flatten, mask, measure, type Curve } from "./exoplanets";

/**
 * Exoplanet Lab's transit search, off the main thread: flattens the light curve, removes any
 * signals already found, runs Box Least Squares and the quick checks.
 *
 * In:  { t, f, masks: { period, t0, duration }[] }   (Float64Arrays, BTJD and normalised flux)
 * Out: { type: "progress", value } | { type: "result", flat, result, checks } | { type: "error", message }
 */

self.onmessage = (e: MessageEvent<{ t: Float64Array; f: Float64Array; masks: { period: number; t0: number; duration: number }[] }>) => {
  try {
    const flat = flatten({ t: e.data.t, f: e.data.f });
    let search: Curve = flat;
    for (const m of e.data.masks) search = mask(search, m.period, m.t0, m.duration);
    const result = bls(search, { progress: (value) => self.postMessage({ type: "progress", value }) });
    const checks = result ? measure(search, result.period, result.t0, result.duration) : null;
    self.postMessage({ type: "result", flat: search, result, checks });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
