import { createHash, timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { list } from "@/lib/waitlist";

/** True when `given` matches WAITLIST_ADMIN_TOKEN, compared in constant time. */
function authorised(given: string | null) {
  const expected = process.env.WAITLIST_ADMIN_TOKEN;
  if (!expected || !given) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/** A CSV cell: quoted, and defused if a spreadsheet would read it as a formula. */
function cell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * GET /api/waitlist/export → every sign-up as CSV (email, joined_at), oldest first.
 * Send the admin token as `Authorization: Bearer <token>`, or as `?token=` to
 * download straight from a browser. Without a configured token this route doesn't exist.
 */
export async function GET(request: Request) {
  // Always answer per request: never prerender this at build time, when the token may not be set yet.
  await connection();
  if (!process.env.WAITLIST_ADMIN_TOKEN) return new Response("Not found", { status: 404 });
  const bearer = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? null;
  const token = bearer ?? new URL(request.url).searchParams.get("token");
  if (!authorised(token)) return new Response("Unauthorized", { status: 401 });

  try {
    const rows = await list();
    const csv = ["email,joined_at", ...rows.map((r) => `${cell(r.email)},${cell(r.at)}`)].join("\n") + "\n";
    const day = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="stellr-waitlist-${day}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[waitlist] export failed", error);
    return new Response("Storage unavailable", { status: 502 });
  }
}
