import { AU_KM, type Approach, type Elements } from "@/lib/asteroids";

/**
 * Server-side reading of JPL's Solar System Dynamics APIs (https://ssd-api.jpl.nasa.gov),
 * shared by the Asteroid Sentinel routes. JPL_BASE exists only so tests can point these
 * at a local stand-in.
 */
const BASE = process.env.JPL_BASE ?? "https://ssd-api.jpl.nasa.gov";

/** GET a JPL API path as JSON; JPL's own reason in the error when it refuses. `ok` lists extra statuses that carry data. */
export async function jpl(path: string, ok: number[] = []): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    headers: { "User-Agent": "Stellr Asteroid Sentinel", Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok && !ok.includes(res.status)) {
    // JPL explains a refused query in a JSON "message"; keep a short form of it for the page.
    const body = (await res.text()).slice(0, 300);
    let message = body;
    try {
      message = String((JSON.parse(body) as { message?: unknown }).message ?? body);
    } catch {}
    throw new Error(`JPL ${res.status}: ${message.slice(0, 120)}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

export const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** A UTC calendar date `offset` days from today, as the CAD API wants it (YYYY-MM-DD; it takes no offsets like `now-7`). */
export const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-Nov-03 14:22" → ISO. */
function calendarDate(v: unknown): string | null {
  const m = typeof v === "string" ? v.match(/^(\d{4})-([A-Za-z]{3})-(\d{2})\s+(\d{2}):(\d{2})/) : null;
  if (!m) return null;
  const month = MONTHS.indexOf(m[2]);
  if (month < 0) return null;
  return new Date(Date.UTC(+m[1], month, +m[3], +m[4], +m[5])).toISOString();
}

/** JPL's Sentry impact-risk list, keyed by designation; an empty map if it can't be read. */
export async function sentry() {
  const map = new Map<string, Approach["sentry"]>();
  try {
    const data = await jpl("/sentry.api");
    for (const r of (Array.isArray(data.data) ? data.data : []) as Record<string, unknown>[]) {
      const des = typeof r.des === "string" ? r.des : "";
      if (!des) continue;
      map.set(des, { ip: num(r.ip) ?? 0, torino: num(r.ts_max) ?? 0, range: typeof r.range === "string" ? r.range : "" });
    }
  } catch (error) {
    console.error("[asteroids] sentry", error instanceof Error ? error.message : error);
  }
  return map;
}

/** Close approaches from the CAD API (https://ssd-api.jpl.nasa.gov/doc/cad.html); its table is `fields` plus rows of strings. */
export async function approaches(query: string, risks: Map<string, Approach["sentry"]>): Promise<Approach[]> {
  const cad = await jpl(`/cad.api?${query}&fullname=true&diameter=true`);
  const fields = (Array.isArray(cad.fields) ? cad.fields : []).map(String);
  const col = (name: string) => fields.indexOf(name);
  const out: Approach[] = [];
  for (const r of (Array.isArray(cad.data) ? cad.data : []) as unknown[][]) {
    const des = String(r[col("des")] ?? "").trim();
    const at = calendarDate(r[col("cd")]);
    const dist = num(r[col("dist")]);
    if (!des || !at || dist === null) continue;
    const fullname = col("fullname") >= 0 ? String(r[col("fullname")] ?? "").trim() : "";
    out.push({
      des,
      name: fullname || des,
      at,
      distKm: dist * AU_KM,
      speed: num(r[col("v_rel")]) ?? 0,
      h: num(r[col("h")]),
      diameterKm: col("diameter") >= 0 ? num(r[col("diameter")]) : null,
      sentry: risks.get(des) ?? null,
    });
  }
  return out;
}

const K_DEG = 0.01720209895 * (180 / Math.PI); // Gaussian constant, degrees/day for a in AU

/**
 * Osculating elements from one Small-Body Database answer (https://ssd-api.jpl.nasa.gov/doc/sbdb.html),
 * or null when the orbit isn't a closed ellipse we can draw. Comets often give the time of
 * perihelion instead of a mean anomaly, so that is turned into one.
 */
export function elementsOf(data: Record<string, unknown>, fallback: string): Elements | null {
  const object = (data.object ?? {}) as Record<string, unknown>;
  const orbit = (data.orbit ?? {}) as Record<string, unknown>;
  const list = (Array.isArray(orbit.elements) ? orbit.elements : []) as { name?: string; value?: unknown }[];
  const el = (name: string) => num(list.find((e) => e.name === name)?.value);
  const [a, e, i, om, w, epoch] = [el("a"), el("e"), el("i"), el("om"), el("w"), num(orbit.epoch)];
  if (a === null || e === null || i === null || om === null || w === null || epoch === null || e >= 1 || a <= 0) return null;
  const n = el("n") ?? K_DEG / Math.pow(a, 1.5);
  const tp = el("tp");
  const ma = el("ma") ?? (tp !== null ? n * (epoch - tp) : null);
  if (ma === null) return null;
  return {
    des: String(object.des ?? fallback),
    name: String(object.fullname ?? fallback).trim(),
    epoch,
    a,
    e,
    i,
    om,
    w,
    ma,
    n,
    pha: object.pha === true,
    orbitClass: String((object.orbit_class as Record<string, unknown> | undefined)?.name ?? ""),
  };
}

/** Designations and names are letters, digits, spaces and a few marks, e.g. "2024 YR4", "P/2010 A2", "Apophis". */
export const validName = (s: string) => s.length > 0 && s.length <= 40 && /^[\w\s/()'.-]+$/.test(s);
