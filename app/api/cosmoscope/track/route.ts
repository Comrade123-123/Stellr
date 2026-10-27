import { connection } from "next/server";

/**
 * GET /api/cosmoscope/track?id=-31 → a spacecraft's whole path since launch, or
 * GET /api/cosmoscope/track?id=606&around=2026-10-27 → Titan around Saturn for ±40 days,
 * as ecliptic J2000 vectors in AU from JPL Horizons (https://ssd-api.jpl.nasa.gov/doc/horizons.html).
 * Spacecraft paths are heliocentric; Titan's is relative to Saturn, as astronomy-engine has no Titan.
 *
 * Sent as one flat array, four numbers per sample (Julian date, x, y, z). Horizons only has
 * trajectories for the dates a mission's navigators published, so a path that the first
 * end date overruns is asked for again ending a little after today.
 * Paths change only when JPL updates a prediction: a day's cache. JPL_HORIZONS exists only
 * so tests can point this at a local stand-in.
 */
const BASE = process.env.JPL_HORIZONS ?? "https://ssd.jpl.nasa.gov";

/** What may be asked for, so the route can't be used to page through Horizons. */
const TARGETS: Record<string, { center: string; from?: string; step: string }> = {
  "-31": { center: "500@10", from: "1977-09-08", step: "30 d" }, // Voyager 1
  "-32": { center: "500@10", from: "1977-08-23", step: "30 d" }, // Voyager 2
  "-98": { center: "500@10", from: "2006-01-21", step: "10 d" }, // New Horizons
  "-96": { center: "500@10", from: "2018-08-14", step: "1 d" }, // Parker Solar Probe
  "606": { center: "500@699", step: "6 h" }, // Titan, around Saturn
};

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

async function horizons(id: string, center: string, start: string, stop: string, step: string) {
  // Spaces as %20 (not "+"), as Horizons' own examples write them.
  const q = Object.entries({
    format: "json",
    COMMAND: `'${id}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'VECTORS'",
    CENTER: `'${center}'`,
    START_TIME: `'${start}'`,
    STOP_TIME: `'${stop}'`,
    STEP_SIZE: `'${step}'`,
    REF_PLANE: "'ECLIPTIC'",
    REF_SYSTEM: "'ICRF'",
    VEC_TABLE: "'1'",
    OUT_UNITS: "'AU-D'",
    CSV_FORMAT: "'YES'",
    VEC_LABELS: "'NO'",
  })
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  const res = await fetch(`${BASE}/api/horizons.api?${q}`, {
    cache: "no-store",
    headers: { "User-Agent": "Stellr Cosmoscope", Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as { result?: string; error?: string };
  if (!res.ok || data.error) throw new Error(`Horizons ${res.status}: ${String(data.error ?? "").slice(0, 160)}`);
  const text = data.result ?? "";
  const body = text.split("$$SOE")[1]?.split("$$EOE")[0];
  // No table means Horizons refused the span; its reason is in the text.
  if (!body) throw new Error(`Horizons: ${text.replace(/\s+/g, " ").slice(-200)}`);
  const out: number[] = [];
  for (const line of body.split("\n")) {
    const cols = line.split(",").map((c) => c.trim());
    const v = [cols[0], cols[2], cols[3], cols[4]].map(Number);
    if (cols.length >= 5 && v.every(Number.isFinite)) out.push(Math.round(v[0] * 1e4) / 1e4, ...v.slice(1).map((x) => Math.round(x * 1e7) / 1e7));
  }
  return out;
}

export async function GET(request: Request) {
  await connection();
  const params = new URL(request.url).searchParams;
  const id = params.get("id") ?? "";
  const target = TARGETS[id];
  if (!target) return new Response("Unknown target", { status: 400 });
  try {
    let points: number[];
    if (target.from) {
      try {
        points = await horizons(id, target.center, target.from, "2030-01-01", target.step);
      } catch {
        points = await horizons(id, target.center, target.from, day(Date.now() + 30 * 86_400_000), target.step);
      }
    } else {
      const around = Date.parse(`${params.get("around") ?? ""}T00:00:00Z`);
      if (!Number.isFinite(around)) return new Response("Bad date", { status: 400 });
      points = await horizons(id, target.center, day(around - 40 * 86_400_000), day(around + 40 * 86_400_000), target.step);
    }
    return Response.json(
      { points },
      { headers: { "Cache-Control": "public, max-age=21600, s-maxage=86400, stale-while-revalidate=172800" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cosmoscope] track", id, detail);
    return Response.json({ error: true, detail }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
