/**
 * GET /api/tle?group=stations|visual → CelesTrak two-line elements, passed through.
 *
 * CelesTrak updates these a few times a day and asks clients not to fetch a group
 * more than once every two hours, so the CDN keeps each answer for two hours and
 * serves the old one while it refreshes. CELESTRAK_BASE exists only so tests can
 * point this at a local stand-in.
 */
const GROUPS = new Set(["stations", "visual"]);
const BASE = process.env.CELESTRAK_BASE ?? "https://celestrak.org";

export async function GET(request: Request) {
  const group = new URL(request.url).searchParams.get("group") ?? "";
  if (!GROUPS.has(group)) return new Response("Unknown group", { status: 400 });

  try {
    const res = await fetch(`${BASE}/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`, {
      cache: "no-store",
      headers: { "User-Agent": "Stellr Orbit Watch" },
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    // CelesTrak answers 200 with a plain-text note when it has nothing (or is throttling), so check for elements.
    if (!res.ok || !/^1 \d{5}/m.test(text)) throw new Error(`CelesTrak ${res.status}: ${text.slice(0, 80)}`);
    return new Response(text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=600, s-maxage=7200, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("[tle]", group, error instanceof Error ? error.message : error);
    return new Response("Orbital elements unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
