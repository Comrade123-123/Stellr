import { connection } from "next/server";
import { pipeline } from "@/lib/redis";
import { fromRequest, valid } from "@/lib/wobble-auth";

/**
 * GET /api/wobble/log?offset=0 → a page of Wobble's notebook from Redis, newest first, for a
 * signed-in browser only. Written by scripts/wobble.ts: `wobble:investigations` (a list of
 * JSON records), `wobble:runs` and `wobble:updated`.
 */
const PAGE = 40;

export async function GET(request: Request) {
  await connection();
  if (!valid(fromRequest(request))) return Response.json({ error: "sign in" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  const offset = Math.max(0, Math.min(10_000, Number(new URL(request.url).searchParams.get("offset")) || 0));
  try {
    const [items, total, runs, updated] = await pipeline([
      ["LRANGE", "wobble:investigations", offset, offset + PAGE - 1],
      ["LLEN", "wobble:investigations"],
      ["LRANGE", "wobble:runs", 0, 59],
      ["GET", "wobble:updated"],
    ]);
    const parse = (list: unknown) => (Array.isArray(list) ? list.map((s) => JSON.parse(String(s))) : []);
    return Response.json(
      { investigations: parse(items), total: Number(total) || 0, runs: parse(runs), updated: updated ?? "", offset, page: PAGE },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[wobble] log", error instanceof Error ? error.message : error);
    return Response.json({ error: "notebook unavailable" }, { status: 502, headers: { "Cache-Control": "private, no-store" } });
  }
}
