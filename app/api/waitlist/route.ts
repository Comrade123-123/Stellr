import { isConfigured, join, normaliseEmail, StorageError, withinRateLimit } from "@/lib/waitlist";

type Status = "joined" | "already" | "invalid" | "rate_limited" | "unavailable" | "error";

const reply = (status: Status, code: number) =>
  Response.json({ status }, { status: code, headers: { "Cache-Control": "no-store" } });

/** The caller's address as the platform reports it, for rate limiting only; never stored with the email. */
function callerOf(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

/**
 * POST { email, website } → { status }.
 * `website` is a honeypot: hidden from people, so only bots fill it. They get the
 * same "joined" answer as everyone else, and nothing is stored.
 */
export async function POST(request: Request) {
  if (!isConfigured()) return reply("unavailable", 503);

  let body: { email?: unknown; website?: unknown };
  try {
    body = await request.json();
  } catch {
    return reply("invalid", 400);
  }
  if (typeof body.website === "string" && body.website.trim() !== "") return reply("joined", 200);

  const email = normaliseEmail(body.email);
  if (!email) return reply("invalid", 400);

  try {
    if (!(await withinRateLimit(callerOf(request)))) return reply("rate_limited", 429);
    return reply(await join(email), 200);
  } catch (error) {
    console.error("[waitlist] sign-up failed", error instanceof StorageError ? error.message : error);
    return reply("error", 502);
  }
}
