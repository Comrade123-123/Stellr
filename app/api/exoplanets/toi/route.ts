import { connection } from "next/server";

/**
 * GET /api/exoplanets/toi?tic=150428135 → the TESS Objects of Interest on this star: signals
 * the TESS team has flagged, with the follow-up working group's verdict on each (TFOPWG
 * disposition: CP/KP confirmed or known planet, PC/APC candidate, FP/FA false positive or
 * alarm), from the NASA Exoplanet Archive's TOI table. A day's cache.
 */
const BASE = process.env.EXO_BASE ?? "https://exoplanetarchive.ipac.caltech.edu";

export async function GET(request: Request) {
  await connection();
  const tic = new URL(request.url).searchParams.get("tic")?.replace(/^TIC\s*/i, "").trim() ?? "";
  if (!/^\d{1,12}$/.test(tic)) return new Response("Bad TIC number", { status: 400 });
  try {
    const query = `select toi, tid, tfopwg_disp, pl_orbper, pl_trandep, pl_trandurh from toi where tid = ${Number(tic)}`;
    const res = await fetch(`${BASE}/TAP/sync?query=${encodeURIComponent(query)}&format=json`, {
      cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": "Stellr Exoplanet Lab" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Exoplanet Archive ${res.status}`);
    const rows = (await res.json()) as Record<string, unknown>[];
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const tois = rows.map((r) => ({
      toi: String(r.toi ?? ""),
      disposition: typeof r.tfopwg_disp === "string" ? r.tfopwg_disp : "",
      period: num(r.pl_orbper),
      depthPpm: num(r.pl_trandep),
      durationH: num(r.pl_trandurh),
    }));
    return Response.json({ tic, tois }, { headers: { "Cache-Control": "public, max-age=21600, s-maxage=86400, stale-while-revalidate=86400" } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[exoplanets] toi", tic, detail);
    return Response.json({ error: true, detail }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
