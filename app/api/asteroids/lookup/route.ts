import { approaches, day, elementsOf, jpl, sentry, validName } from "@/lib/jpl";
import type { Approach } from "@/lib/asteroids";

/**
 * GET /api/asteroids/lookup?q=apophis → any object in JPL's Small-Body Database, by name or
 * designation, whether or not it is near Earth now: its orbital elements plus its next pass
 * within 0.2 AU of Earth this century, if it has one. An ambiguous name answers with the
 * matching objects to pick from; an unknown one with `found: false`.
 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!validName(q)) return new Response("Bad name", { status: 400 });
  const cache = { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400" };
  try {
    // JPL answers an ambiguous search with HTTP 300 and a list of candidates.
    const data = await jpl(`/sbdb.api?sstr=${encodeURIComponent(q)}`, [300, 404]);
    if (Array.isArray(data.list)) {
      const matches = (data.list as Record<string, unknown>[])
        .map((m) => ({ des: String(m.pdes ?? "").trim(), name: String(m.name ?? m.pdes ?? "").trim() }))
        .filter((m) => m.des)
        .slice(0, 12);
      return Response.json({ matches }, { headers: cache });
    }
    if (!data.object) return Response.json({ found: false }, { headers: cache });
    const elements = elementsOf(data, q);
    if (!elements) return Response.json({ found: true, unsupported: true, name: String((data.object as Record<string, unknown>).fullname ?? q).trim() }, { headers: cache });
    let next: Approach | null = null;
    try {
      const risks = await sentry();
      const list = await approaches(`des=${encodeURIComponent(elements.des)}&neo=false&dist-max=0.2&date-min=${day(0)}&date-max=2100-01-01&sort=date`, risks);
      next = list[0] ?? null;
    } catch (error) {
      console.error("[asteroids] lookup next", elements.des, error instanceof Error ? error.message : error);
    }
    return Response.json({ elements, next }, { headers: cache });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[asteroids] lookup", q, detail);
    return Response.json({ error: true, detail }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
