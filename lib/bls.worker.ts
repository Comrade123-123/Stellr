/// <reference lib="webworker" />
import { searchOnce, type Curve } from "./exoplanets";

/**
 * Exoplanet Lab's transit search, off the main thread: the shared search (lib/exoplanets.ts),
 * with any signals already found hidden.
 *
 * In:  { t, f, cx?, cy?, masks: { period, t0, duration }[] }   (Float64Arrays, BTJD and normalised flux)
 * Out: { type: "progress", value } | { type: "result", flat, result, checks, singles } | { type: "error", message }
 */

self.onmessage = (e: MessageEvent<Curve & { masks: { period: number; t0: number; duration: number }[] }>) => {
  try {
    const { masks, ...curve } = e.data;
    const out = searchOnce(curve, masks, { progress: (value) => self.postMessage({ type: "progress", value }) });
    self.postMessage({ type: "result", ...out });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
