import { connection } from "next/server";
import { jpl, num } from "@/lib/jpl";

/**
 * GET /api/asteroids/hazardous → the orbits of every known potentially hazardous asteroid
 * (bigger than ~140 m and able to come within 0.05 AU of Earth's orbit), from JPL's
 * Small-Body Database query API (https://ssd-api.jpl.nasa.gov/doc/sbdb_query.html).
 * Sent as one flat array, eight numbers each (epoch JD, a, e, i, om, w, ma, H), trimmed to
 * the precision a dot on the map needs. The list grows by a handful a month: a day's cache.
 */
const FIELDS = ["epoch", "a", "e", "i", "om", "w", "ma", "H"];

export async function GET() {
  await connection();
  try {
    const data = await jpl(`/sbdb_query.api?fields=pdes,${FIELDS.join(",")}&sb-group=pha`);
    const fields = (Array.isArray(data.fields) ? data.fields : []).map(String);
    const cols = FIELDS.map((f) => fields.indexOf(f));
    const out: number[] = [];
    for (const r of (Array.isArray(data.data) ? data.data : []) as unknown[][]) {
      const v = cols.map((c) => (c >= 0 ? num(r[c]) : null));
      // H may be missing; everything else must be there and the orbit closed.
      if (v.slice(0, 7).some((x) => x === null) || (v[2] as number) >= 1) continue;
      out.push(...v.map((x, k) => (x === null ? 99 : k === 0 ? Math.round(x * 10) / 10 : Math.round(x * 1e5) / 1e5)));
    }
    return Response.json(
      { stride: FIELDS.length, orbits: out },
      { headers: { "Cache-Control": "public, max-age=21600, s-maxage=86400, stale-while-revalidate=172800" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[asteroids] hazardous", detail);
    return Response.json({ error: true, detail }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
