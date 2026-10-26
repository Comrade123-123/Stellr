import { connection } from "next/server";
import { AU_KM, type Approach } from "@/lib/asteroids";

/**
 * GET /api/asteroids → asteroids passing Earth within 0.05 AU (about 19.5 lunar distances)
 * from a week ago to 60 days ahead, from JPL's Small-Body Database close-approach API
 * (https://ssd-api.jpl.nasa.gov/doc/cad.html), each flagged if it is also on JPL's Sentry
 * impact-risk list (https://ssd-api.jpl.nasa.gov/doc/sentry.html).
 *
 * The close-approach list changes slowly, so the CDN keeps it an hour. The table comes as
 * `fields` plus rows of strings, read here by field name. JPL_BASE exists only so tests
 * can point this at a local stand-in.
 */
const BASE = process.env.JPL_BASE ?? "https://ssd-api.jpl.nasa.gov";

async function get(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    headers: { "User-Agent": "Stellr Asteroid Sentinel", Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`${path.split("?")[0]}: ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-Nov-03 14:22" → ISO. */
function calendarDate(v: unknown): string | null {
  const m = typeof v === "string" ? v.match(/^(\d{4})-([A-Za-z]{3})-(\d{2})\s+(\d{2}):(\d{2})/) : null;
  if (!m) return null;
  const month = MONTHS.indexOf(m[2]);
  if (month < 0) return null;
  return new Date(Date.UTC(+m[1], month, +m[3], +m[4], +m[5])).toISOString();
}

/** Sentry's list, keyed by designation; an empty map if it can't be read. */
async function sentry() {
  const map = new Map<string, Approach["sentry"]>();
  try {
    const data = await get("/sentry.api");
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

export async function GET() {
  // Only at request time; builds shouldn't call JPL.
  await connection();
  try {
    const [cad, risks] = await Promise.all([
      get("/cad.api?dist-max=0.05&date-min=now-7&date-max=%2B60&sort=date&fullname=true&diameter=true"),
      sentry(),
    ]);
    const fields = (Array.isArray(cad.fields) ? cad.fields : []).map(String);
    const col = (name: string) => fields.indexOf(name);
    const rows = (Array.isArray(cad.data) ? cad.data : []) as unknown[][];
    const approaches: Approach[] = [];
    for (const r of rows) {
      const des = String(r[col("des")] ?? "").trim();
      const at = calendarDate(r[col("cd")]);
      const dist = num(r[col("dist")]);
      if (!des || !at || dist === null) continue;
      const fullname = col("fullname") >= 0 ? String(r[col("fullname")] ?? "").trim() : "";
      approaches.push({
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
    return Response.json(
      { approaches, at: new Date().toISOString() },
      { headers: { "Cache-Control": "public, max-age=900, s-maxage=3600, stale-while-revalidate=21600" } },
    );
  } catch (error) {
    console.error("[asteroids]", error instanceof Error ? error.message : error);
    return Response.json({ approaches: [], error: true }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
