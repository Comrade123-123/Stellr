import { elementsOf, jpl, validName } from "@/lib/jpl";

/**
 * GET /api/asteroids/orbit?des=99942 → one asteroid's osculating orbital elements from
 * JPL's Small-Body Database (https://ssd-api.jpl.nasa.gov/doc/sbdb.html), for drawing its
 * orbit and its path past Earth. Elements change little day to day, so the CDN keeps
 * them a day.
 */
export async function GET(request: Request) {
  const des = new URL(request.url).searchParams.get("des")?.trim() ?? "";
  if (!validName(des)) return new Response("Bad designation", { status: 400 });
  try {
    const elements = elementsOf(await jpl(`/sbdb.api?sstr=${encodeURIComponent(des)}`), des);
    if (!elements) throw new Error(`sbdb: no drawable orbit for ${des}`);
    return Response.json(elements, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400" } });
  } catch (error) {
    console.error("[asteroids] orbit", des, error instanceof Error ? error.message : error);
    return Response.json({ error: true }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
