import { connection } from "next/server";
import { tessSectors } from "@/lib/mast";

/**
 * GET /api/exoplanets/sectors?tic=261136679 → the TESS sectors with a light curve for this
 * star: for each, the observation to fetch, preferring the mission's own 2-minute pipeline
 * (SPOC) and falling back to its full-frame-image light curves (TESS-SPOC). A day's cache:
 * new sectors arrive about monthly.
 */
export async function GET(request: Request) {
  await connection();
  const tic = new URL(request.url).searchParams.get("tic")?.replace(/^TIC\s*/i, "").trim() ?? "";
  if (!/^\d{1,12}$/.test(tic)) return new Response("Bad TIC number", { status: 400 });
  try {
    const sectors = await tessSectors(tic);
    return Response.json({ tic, sectors }, { headers: { "Cache-Control": "public, max-age=21600, s-maxage=86400, stale-while-revalidate=86400" } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[exoplanets] sectors", tic, detail);
    return Response.json({ error: true, detail }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
