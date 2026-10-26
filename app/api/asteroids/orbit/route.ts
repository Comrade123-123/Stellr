import { type Elements } from "@/lib/asteroids";

/**
 * GET /api/asteroids/orbit?des=99942 → one asteroid's osculating orbital elements from
 * JPL's Small-Body Database (https://ssd-api.jpl.nasa.gov/doc/sbdb.html), for drawing its
 * orbit and its path past Earth. Elements change little day to day, so the CDN keeps
 * them a day. JPL_BASE exists only so tests can point this at a local stand-in.
 */
const BASE = process.env.JPL_BASE ?? "https://ssd-api.jpl.nasa.gov";

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export async function GET(request: Request) {
  const des = new URL(request.url).searchParams.get("des")?.trim() ?? "";
  // Designations are letters, digits, spaces and a few marks, e.g. "2024 YR4", "P/2010 A2".
  if (!des || des.length > 40 || !/^[\w\s/()'-]+$/.test(des)) return new Response("Bad designation", { status: 400 });
  try {
    const res = await fetch(`${BASE}/sbdb.api?sstr=${encodeURIComponent(des)}`, {
      cache: "no-store",
      headers: { "User-Agent": "Stellr Asteroid Sentinel", Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`sbdb ${res.status}`);
    const data = (await res.json()) as Record<string, Record<string, unknown>>;
    const object = data.object ?? {};
    const orbit = data.orbit ?? {};
    const list = (Array.isArray(orbit.elements) ? orbit.elements : []) as { name?: string; value?: unknown }[];
    const el = (name: string) => num(list.find((e) => e.name === name)?.value);
    const [a, e, i, om, w, ma, epoch] = [el("a"), el("e"), el("i"), el("om"), el("w"), el("ma"), num(orbit.epoch)];
    if (a === null || e === null || i === null || om === null || w === null || ma === null || epoch === null) {
      throw new Error(`sbdb: incomplete elements for ${des}`);
    }
    const elements: Elements = {
      des: String(object.des ?? des),
      name: String(object.fullname ?? des).trim(),
      epoch,
      a,
      e,
      i,
      om,
      w,
      ma,
      n: el("n") ?? undefined,
      pha: object.pha === true,
      orbitClass: String((object.orbit_class as Record<string, unknown> | undefined)?.name ?? ""),
    };
    return Response.json(elements, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400" } });
  } catch (error) {
    console.error("[asteroids] orbit", des, error instanceof Error ? error.message : error);
    return Response.json({ error: true }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
