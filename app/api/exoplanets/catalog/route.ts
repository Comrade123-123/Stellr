import { connection } from "next/server";
import { CATALOG_FIELDS } from "@/lib/exoplanets";

/**
 * GET /api/exoplanets/catalog → every confirmed exoplanet, from the NASA Exoplanet Archive's
 * Planetary Systems Composite table (https://exoplanetarchive.ipac.caltech.edu/docs/TAP/usingTAP.html),
 * as column names once and then rows. The archive adds planets a few times a month: a day's
 * cache. EXO_BASE exists only so tests can point this at a local stand-in.
 */
const BASE = process.env.EXO_BASE ?? "https://exoplanetarchive.ipac.caltech.edu";

export async function GET() {
  await connection();
  try {
    const query = `select ${CATALOG_FIELDS.join(",")} from pscomppars order by disc_year desc, pl_name`;
    const res = await fetch(`${BASE}/TAP/sync?query=${encodeURIComponent(query)}&format=json`, {
      cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": "Stellr Exoplanet Lab" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Exoplanet Archive ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const data = (await res.json()) as Record<string, unknown>[];
    const round = (v: unknown) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v ?? null);
    const rows = data.map((r) => CATALOG_FIELDS.map((k) => round(r[k])));
    return Response.json(
      { fields: CATALOG_FIELDS, rows },
      { headers: { "Cache-Control": "public, max-age=21600, s-maxage=86400, stale-while-revalidate=172800" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[exoplanets] catalog", detail);
    return Response.json({ error: true, detail }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
