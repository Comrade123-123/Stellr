import { connection } from "next/server";
import { lightCurveFromFits } from "@/lib/lightcurve";
import { lightCurveFile } from "@/lib/mast";

/**
 * GET /api/exoplanets/lightcurve?obsid=… → one TESS sector's light curve (SPOC, TESS-SPOC or
 * QLP; see lib/lightcurve.ts): good-quality points only, normalised to 1 and averaged into
 * 10-minute bins so a sector is a few thousand points rather than twenty thousand, with the
 * star's light centre (cx, cy) where the file has it.
 * Times are BTJD (BJD − 2457000). Archived data never changes: a week's cache.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  await connection();
  const obsid = new URL(request.url).searchParams.get("obsid") ?? "";
  if (!/^\d{1,15}$/.test(obsid)) return new Response("Bad observation id", { status: 400 });
  try {
    const c = lightCurveFromFits(await lightCurveFile(obsid));
    return Response.json(
      { obsid, ...c },
      { headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[exoplanets] lightcurve", obsid, detail);
    return Response.json({ error: true, detail }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
