/// <reference lib="webworker" />
import { propagate, twoline2satrec, type SatRec } from "satellite.js";

/**
 * Orbit Watch's "all active satellites" layer, off the main thread: fetches CelesTrak's
 * active group (thousands of objects), then every 4 s propagates them all with SGP4 and
 * posts their scene positions back as one transferable Float32Array.
 *
 * In:  { type: "start" } | { type: "stop" }
 * Out: { type: "loaded", count } | { type: "positions", positions } | { type: "error" }
 */

const INTERVAL_MS = 4000;
const EARTH_RADIUS_KM = 6371;

let satrecs: SatRec[] = [];
let timer: ReturnType<typeof setInterval> | undefined;

function parse(text: string) {
  const lines = text.split(/\r?\n/);
  const out: SatRec[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!lines[i].startsWith("1 ") || !lines[i + 1]?.startsWith("2 ")) continue;
    try {
      const s = twoline2satrec(lines[i], lines[i + 1]);
      if (!s.error) out.push(s);
    } catch {
      // A malformed record; the rest are still usable.
    }
    i++;
  }
  return out;
}

function tick() {
  const now = new Date();
  const positions = new Float32Array(satrecs.length * 3);
  for (let i = 0; i < satrecs.length; i++) {
    const pv = propagate(satrecs[i], now);
    // Decayed or unpropagatable objects stay at the origin, hidden inside the globe.
    if (!pv || typeof pv.position !== "object") continue;
    const p = pv.position;
    // ECI → scene (Earth radii, +y north), the same mapping as lib/orbits.ts.
    positions[i * 3] = p.x / EARTH_RADIUS_KM;
    positions[i * 3 + 1] = p.z / EARTH_RADIUS_KM;
    positions[i * 3 + 2] = -p.y / EARTH_RADIUS_KM;
  }
  self.postMessage({ type: "positions", positions }, [positions.buffer]);
}

self.onmessage = async (e: MessageEvent<{ type: "start" | "stop" }>) => {
  if (e.data.type === "stop") {
    clearInterval(timer);
    timer = undefined;
    return;
  }
  try {
    if (!satrecs.length) {
      const res = await fetch("/api/tle?group=active");
      if (!res.ok) throw new Error(String(res.status));
      satrecs = parse(await res.text());
      if (!satrecs.length) throw new Error("empty");
    }
    self.postMessage({ type: "loaded", count: satrecs.length });
    clearInterval(timer);
    tick();
    timer = setInterval(tick, INTERVAL_MS);
  } catch {
    self.postMessage({ type: "error" });
  }
};
