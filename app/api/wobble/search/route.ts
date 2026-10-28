import { connection } from "next/server";
import { pipeline } from "@/lib/redis";
import { fromRequest, valid } from "@/lib/wobble-auth";

/**
 * GET /api/wobble/search?q=toi-2992 → investigations anywhere in Wobble's notebook whose star,
 * TIC or TOI number, known planets, verdicts or world kinds contain every word of the query,
 * newest first, at most 60. Signed-in browsers only. The notebook is read in chunks so no
 * single Redis reply grows large.
 */
const CHUNK = 100;
const MAX_SCAN = 1000;
const MAX_RESULTS = 60;

/** Everything a record can be found by, lower-cased. */
function haystack(r: Record<string, unknown>) {
  const findings = Array.isArray(r.findings) ? (r.findings as Record<string, unknown>[]) : [];
  return [
    r.label,
    `tic ${r.tic}`,
    r.reason === "blind" ? "blind search" : "re-examine candidate toi",
    ...(Array.isArray(r.known) ? r.known : []),
    ...findings.flatMap((f) => [f.title, f.kind, (f.world as { kind?: string } | null)?.kind, ...(Array.isArray(f.notes) ? f.notes : [])]),
    findings.length || r.error ? "" : "quiet no signal",
    r.error ? "error could not" : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export async function GET(request: Request) {
  await connection();
  if (!valid(fromRequest(request))) return Response.json({ error: "sign in" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  const q = (new URL(request.url).searchParams.get("q") ?? "").toLowerCase().slice(0, 80);
  const words = q.split(/\s+/).filter(Boolean);
  if (!words.length) return Response.json({ investigations: [] }, { headers: { "Cache-Control": "private, no-store" } });
  try {
    const found: unknown[] = [];
    for (let start = 0; start < MAX_SCAN && found.length < MAX_RESULTS; start += CHUNK) {
      const [items] = (await pipeline([["LRANGE", "wobble:investigations", start, start + CHUNK - 1]])) as [string[] | null];
      if (!items?.length) break;
      for (const s of items) {
        const r = JSON.parse(s) as Record<string, unknown>;
        const text = haystack(r);
        if (words.every((w) => text.includes(w))) found.push(r);
        if (found.length >= MAX_RESULTS) break;
      }
      if (items.length < CHUNK) break;
    }
    return Response.json({ investigations: found }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[wobble] search", error instanceof Error ? error.message : error);
    return Response.json({ error: "notebook unavailable" }, { status: 502, headers: { "Cache-Control": "private, no-store" } });
  }
}
