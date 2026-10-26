/**
 * GET /api/launches → the next rocket launches worldwide, from The Space Devs'
 * Launch Library 2 (https://thespacedevs.com/llapi), trimmed to what Sky Events shows.
 *
 * Anonymous access allows only a handful of requests an hour, so the CDN keeps each
 * answer for an hour and serves the old one while it refreshes: the upstream sees about
 * one request an hour however many people open the page. Fields are read defensively
 * because the API's shapes differ slightly between versions and modes.
 * LAUNCHES_BASE exists only so tests can point this at a local stand-in.
 */
import { connection } from "next/server";

const BASE = process.env.LAUNCHES_BASE ?? "https://ll.thespacedevs.com";

export interface Launch {
  id: string;
  name: string;
  /** ISO time of the planned launch ("NET": no earlier than). */
  net: string;
  windowEnd: string | null;
  /** How firm the time is: "Go", "TBD", "TBC", "Success", "Hold"… */
  status: string;
  /** False when only the day (or month) is known, not the time. */
  timeKnown: boolean;
  provider: string;
  rocket: string;
  mission: string;
  orbit: string;
  pad: string;
  country: string;
  image: string | null;
  video: string | null;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function trim(raw: Json): Launch | null {
  const net = str(raw.net);
  if (!net) return null;
  const status = obj(raw.status);
  const precision = str(obj(raw.net_precision).abbrev).toUpperCase();
  const mission = obj(raw.mission);
  const pad = obj(raw.pad);
  const location = obj(pad.location);
  const country = obj(location.country);
  const rocket = obj(obj(raw.rocket).configuration);
  const image = typeof raw.image === "string" ? raw.image : str(obj(raw.image).thumbnail_url) || str(obj(raw.image).image_url);
  const videos = (Array.isArray(raw.vid_urls) ? raw.vid_urls : Array.isArray(raw.vidURLs) ? raw.vidURLs : []) as unknown[];
  return {
    id: str(raw.id) || net,
    name: str(raw.name),
    net,
    windowEnd: str(raw.window_end) || null,
    status: str(status.abbrev) || str(status.name) || "TBD",
    // Precision "SEC"/"MIN"/"HR" or none means a real time; "DAY", "MONTH", "Q1"… mean only a rough date.
    timeKnown: !precision || ["SEC", "MIN", "HR", "S", "M", "H"].includes(precision),
    provider: str(obj(raw.launch_service_provider).name),
    rocket: str(rocket.full_name) || str(rocket.name),
    mission: str(mission.description),
    orbit: str(obj(mission.orbit).name),
    pad: [str(pad.name), str(location.name)].filter(Boolean).join(", "),
    country: str(country.name) || str(location.country_code) || str(pad.country_code),
    image: image || null,
    video: str(obj(videos[0]).url) || null,
  };
}

export async function GET() {
  // Only ever at request time: prerendering at build would spend the upstream's small hourly allowance.
  await connection();
  try {
    const res = await fetch(`${BASE}/2.3.0/launches/upcoming/?limit=40&mode=normal&hide_recent_previous=true`, {
      cache: "no-store",
      headers: { "User-Agent": "Stellr Sky Events", Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Launch Library ${res.status}`);
    const data = obj(await res.json());
    const results = Array.isArray(data.results) ? data.results : [];
    const launches = results.map((r) => trim(obj(r))).filter((l): l is Launch => l !== null);
    return Response.json(
      { launches },
      { headers: { "Cache-Control": "public, max-age=900, s-maxage=3600, stale-while-revalidate=21600" } },
    );
  } catch (error) {
    console.error("[launches]", error instanceof Error ? error.message : error);
    return Response.json({ launches: [], error: true }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
