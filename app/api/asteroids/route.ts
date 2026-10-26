import { connection } from "next/server";
import { approaches, day, sentry } from "@/lib/jpl";

/**
 * GET /api/asteroids[?range=year] → asteroids passing Earth within 0.05 AU (about 19.5 lunar
 * distances) from a week ago to 60 days ahead, or a year ahead with `range=year`, from JPL's
 * close-approach API, each flagged if it is also on JPL's Sentry impact-risk list
 * (https://ssd-api.jpl.nasa.gov/doc/sentry.html).
 *
 * The close-approach list changes slowly, so the CDN keeps it an hour.
 */
export async function GET(request: Request) {
  // Only at request time; builds shouldn't call JPL.
  await connection();
  const ahead = new URL(request.url).searchParams.get("range") === "year" ? 365 : 60;
  try {
    const risks = await sentry();
    const list = await approaches(`dist-max=0.05&date-min=${day(-7)}&date-max=${day(ahead)}&sort=date`, risks);
    return Response.json(
      { approaches: list, at: new Date().toISOString() },
      { headers: { "Cache-Control": "public, max-age=900, s-maxage=3600, stale-while-revalidate=21600" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[asteroids]", detail);
    return Response.json({ approaches: [], error: true, detail }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
