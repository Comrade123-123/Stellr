/**
 * CelesTrak two-line elements, passed through:
 *   GET /api/tle?group=stations|visual|active → a whole group (active: every working satellite, thousands)
 *   GET /api/tle?name=starlink-1007     → objects whose name contains the text (at least 3 characters)
 *   GET /api/tle?catnr=25544            → one object by NORAD catalogue number
 *
 * CelesTrak updates elements a few times a day and asks clients not to fetch the same
 * data more than once every two hours, so the CDN keeps each answer for two hours and
 * serves the old one while it refreshes. CELESTRAK_BASE exists only so tests can point
 * this at a local stand-in.
 */
const GROUPS = new Set(["stations", "visual", "active"]);
const BASE = process.env.CELESTRAK_BASE ?? "https://celestrak.org";
/** Most objects a name search returns; "starlink" alone would otherwise be thousands. */
const MAX_RESULTS = 25;

function query(params: URLSearchParams): string | null {
  const group = params.get("group");
  if (group !== null) return GROUPS.has(group) ? `GROUP=${group}` : null;
  const catnr = params.get("catnr");
  if (catnr !== null) return /^\d{1,9}$/.test(catnr) ? `CATNR=${catnr}` : null;
  const name = params.get("name")?.trim() ?? "";
  // Letters, digits and the punctuation satellite names use; nothing that could reshape the upstream URL.
  if (name.length >= 3 && name.length <= 40 && /^[\w\s\-().+/]+$/.test(name)) return `NAME=${encodeURIComponent(name)}`;
  return null;
}

/** First `max` three-line records of a TLE file. */
const firstRecords = (text: string, max: number) => text.split(/\r?\n/).filter(Boolean).slice(0, max * 3).join("\n") + "\n";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = query(params);
  if (!q) return new Response("Bad query", { status: 400 });

  try {
    const res = await fetch(`${BASE}/NORAD/elements/gp.php?${q}&FORMAT=tle`, {
      cache: "no-store",
      headers: { "User-Agent": "Stellr Orbit Watch" },
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`CelesTrak ${res.status}: ${text.slice(0, 80)}`);
    const found = /^1 \d{5}/m.test(text);
    // For a group, no elements means CelesTrak is down or throttling us. For a search it just means no match.
    if (!found && params.has("group")) throw new Error(`CelesTrak returned no elements: ${text.slice(0, 80)}`);
    return new Response(found ? firstRecords(text, params.has("group") ? Infinity : MAX_RESULTS) : "", {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=600, s-maxage=7200, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("[tle]", q, error instanceof Error ? error.message : error);
    return new Response("Orbital elements unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
