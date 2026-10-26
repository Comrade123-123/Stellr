import { connection } from "next/server";

/**
 * GET /api/space-weather → one compact snapshot of NOAA SWPC's real-time feeds
 * (https://www.swpc.noaa.gov), for the Space Weather tool:
 *   - planetary Kp (observed, last 3 days) and NOAA's 3-day Kp forecast
 *   - solar wind at L1: speed, density, magnetic field Bz and Bt
 *   - GOES X-ray flux, turned into the current flare class and the day's peak
 *   - NOAA scales R, S, G (now)
 *   - the OVATION aurora nowcast, downsampled to a 2° grid of 0–100 values
 *
 * Each feed is fetched and parsed on its own, so one being down leaves the rest
 * working (its section comes back null). SWPC's "products" files have shipped both
 * as arrays of arrays (first row = header) and as arrays of objects, so rows are
 * read by column name either way. The CDN keeps the snapshot five minutes, about
 * how often the feeds update. SWPC_BASE exists only so tests can point this at a
 * local stand-in.
 */
const BASE = process.env.SWPC_BASE ?? "https://services.swpc.noaa.gov";

type Row = Record<string, unknown>;

async function get(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    headers: { "User-Agent": "Stellr Space Weather", Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

/** Rows as objects keyed by column name, from either SWPC table shape. */
function rows(data: unknown): Row[] {
  if (!Array.isArray(data) || !data.length) return [];
  if (Array.isArray(data[0])) {
    const [header, ...body] = data as unknown[][];
    const keys = header.map((h) => String(h).toLowerCase());
    return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i]])));
  }
  return (data as Row[]).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), v])));
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
/** SWPC times are UTC without a zone ("2026-10-26 12:00:00.000"). */
const time = (v: unknown): string | null => {
  if (typeof v !== "string" || !v) return null;
  const iso = v.includes("T") ? v : v.replace(" ", "T");
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** The last row with a usable value for every column asked for. */
function latest(list: Row[], cols: string[]) {
  for (let i = list.length - 1; i >= 0; i--) {
    if (cols.every((c) => num(list[i][c]) !== null)) return list[i];
  }
  return null;
}

/** GOES long-wave (0.1–0.8 nm) flux in W/m² → flare class, e.g. 3.2e-5 → "M3.2". */
function flareClass(flux: number) {
  const scales: [string, number][] = [
    ["X", 1e-4],
    ["M", 1e-5],
    ["C", 1e-6],
    ["B", 1e-7],
    ["A", 1e-8],
  ];
  for (const [letter, base] of scales) if (flux >= base) return `${letter}${(flux / base).toFixed(1)}`;
  return "A0.0";
}

async function kp() {
  const list = rows(await get("/products/noaa-planetary-k-index.json"))
    .map((r) => ({ at: time(r.time_tag), kp: num(r.kp ?? r.kp_index ?? r.estimated_kp) }))
    .filter((r): r is { at: string; kp: number } => r.at !== null && r.kp !== null);
  if (!list.length) throw new Error("kp: no rows");
  return { now: list[list.length - 1], recent: list.slice(-24) };
}

async function kpForecast() {
  return rows(await get("/products/noaa-planetary-k-index-forecast.json"))
    .map((r) => ({ at: time(r.time_tag), kp: num(r.kp), observed: String(r.observed ?? "") }))
    .filter((r): r is { at: string; kp: number; observed: string } => r.at !== null && r.kp !== null)
    .filter((r) => r.observed !== "observed")
    .map(({ at, kp }) => ({ at, kp }));
}

async function solarWind() {
  const [plasma, mag] = await Promise.all([
    get("/products/solar-wind/plasma-1-day.json").then(rows),
    get("/products/solar-wind/mag-1-day.json").then(rows),
  ]);
  const p = latest(plasma, ["speed", "density"]);
  const m = latest(mag, ["bz_gsm", "bt"]);
  if (!p && !m) throw new Error("solar wind: no rows");
  return {
    at: time(p?.time_tag ?? m?.time_tag),
    speed: p ? num(p.speed) : null,
    density: p ? num(p.density) : null,
    bz: m ? num(m.bz_gsm) : null,
    bt: m ? num(m.bt) : null,
  };
}

async function xrays() {
  const list = rows(await get("/json/goes/primary/xrays-1-day.json"))
    .filter((r) => String(r.energy ?? "").startsWith("0.1"))
    .map((r) => ({ at: time(r.time_tag), flux: num(r.flux) }))
    .filter((r): r is { at: string; flux: number } => r.at !== null && r.flux !== null && r.flux > 0);
  if (!list.length) throw new Error("xrays: no rows");
  const now = list[list.length - 1];
  const peak = list.reduce((a, b) => (b.flux > a.flux ? b : a));
  return { now: { ...now, class: flareClass(now.flux) }, peak: { ...peak, class: flareClass(peak.flux) } };
}

async function scales() {
  const data = (await get("/products/noaa-scales.json")) as Record<string, Row>;
  const current = data["0"] ?? data[0];
  if (!current) throw new Error("scales: no current entry");
  const pick = (k: string) => {
    const s = (current[k] ?? {}) as Row;
    return { level: num(s.Scale) ?? 0, text: typeof s.Text === "string" ? s.Text : "" };
  };
  return { R: pick("R"), S: pick("S"), G: pick("G") };
}

/**
 * The OVATION grid (1° steps, longitude 0–359 east, latitude −90…90) → base64 of a
 * 180 × 91 byte grid at 2° steps, row by latitude from −90, each the max of its cell.
 */
async function aurora() {
  const data = (await get("/json/ovation_aurora_latest.json")) as Row;
  const coords = Array.isArray(data.coordinates) ? (data.coordinates as unknown[][]) : [];
  if (!coords.length) throw new Error("aurora: no coordinates");
  const W = 180;
  const H = 91;
  const grid = new Uint8Array(W * H);
  for (const c of coords) {
    const lon = num(c[0]);
    const lat = num(c[1]);
    const v = num(c[2]);
    if (lon === null || lat === null || v === null) continue;
    const x = Math.floor((((lon % 360) + 360) % 360) / 2) % W;
    const y = Math.min(H - 1, Math.max(0, Math.round((lat + 90) / 2)));
    const i = y * W + x;
    grid[i] = Math.max(grid[i], Math.min(100, Math.round(v)));
  }
  return {
    at: time(data["Forecast Time"] ?? data["Observation Time"]),
    width: W,
    height: H,
    grid: Buffer.from(grid).toString("base64"),
  };
}

const settle = async <T,>(name: string, p: Promise<T>): Promise<T | null> => {
  try {
    return await p;
  } catch (error) {
    console.error("[space-weather]", name, error instanceof Error ? error.message : error);
    return null;
  }
};

export async function GET() {
  // Only at request time: the feeds change by the minute, and a build shouldn't fetch them.
  await connection();
  const [k, forecast, wind, flares, noaa, oval] = await Promise.all([
    settle("kp", kp()),
    settle("forecast", kpForecast()),
    settle("solar wind", solarWind()),
    settle("xrays", xrays()),
    settle("scales", scales()),
    settle("aurora", aurora()),
  ]);
  const body = { kp: k, forecast, wind, flares, scales: noaa, aurora: oval, at: new Date().toISOString() };
  const nothing = [k, forecast, wind, flares, noaa, oval].every((x) => x === null);
  return Response.json(body, {
    status: nothing ? 502 : 200,
    headers: { "Cache-Control": nothing ? "no-store" : "public, max-age=120, s-maxage=300, stale-while-revalidate=900" },
  });
}

export type SpaceWeather = {
  kp: Awaited<ReturnType<typeof kp>> | null;
  forecast: Awaited<ReturnType<typeof kpForecast>> | null;
  wind: Awaited<ReturnType<typeof solarWind>> | null;
  flares: Awaited<ReturnType<typeof xrays>> | null;
  scales: Awaited<ReturnType<typeof scales>> | null;
  aurora: Awaited<ReturnType<typeof aurora>> | null;
  at: string;
};
