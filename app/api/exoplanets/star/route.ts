import { connection } from "next/server";
import { ticStar } from "@/lib/mast";

/**
 * GET /api/exoplanets/star?tic=261136679 → the star's entry in the TESS Input Catalog, via
 * MAST: size, temperature, surface gravity, mass, distance and TESS-band brightness. Catalogue
 * values change only with new releases: a week's cache.
 */
export async function GET(request: Request) {
  await connection();
  const tic = new URL(request.url).searchParams.get("tic")?.replace(/^TIC\s*/i, "").trim() ?? "";
  if (!/^\d{1,12}$/.test(tic)) return new Response("Bad TIC number", { status: 400 });
  try {
    const star = await ticStar(tic);
    if (!star) return Response.json({ tic, star: null }, { headers: { "Cache-Control": "public, s-maxage=86400" } });
    return Response.json({ tic, star }, { headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800" } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[exoplanets] star", tic, detail);
    return Response.json({ error: true, detail }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
