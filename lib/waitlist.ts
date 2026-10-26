/**
 * Waitlist storage, server side only (route handlers import it; client code must not).
 *
 * Emails live in Upstash Redis, reached over its REST API so there's no client
 * library to bundle. Vercel's Upstash integration sets the connection as
 * KV_REST_API_URL / KV_REST_API_TOKEN (older projects) or UPSTASH_REDIS_REST_URL /
 * UPSTASH_REDIS_REST_TOKEN; either pair works.
 *
 * Layout: one hash, `waitlist:emails`, field = lower-cased email, value = JSON
 * { at } with the sign-up time. HSETNX makes a second sign-up a no-op, so the
 * first timestamp is kept and duplicates are reported, not stored.
 */

const KEY = "waitlist:emails";

/** Longest address RFC 5321 allows; anything longer isn't an email. */
const MAX_LENGTH = 254;
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** Sign-ups allowed per address (IP) per minute before we start refusing. */
export const RATE_LIMIT = 5;

function connection() {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export const isConfigured = () => connection() !== null;

export class StorageError extends Error {}

/** Runs Redis commands in one round trip; returns each command's result in order. */
async function pipeline(commands: (string | number)[][]): Promise<unknown[]> {
  const conn = connection();
  if (!conn) throw new StorageError("Waitlist storage is not configured");
  const res = await fetch(`${conn.url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${conn.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    cache: "no-store",
  });
  if (!res.ok) throw new StorageError(`Upstash responded ${res.status}`);
  const replies = (await res.json()) as { result?: unknown; error?: string }[];
  const failed = replies.find((r) => r.error);
  if (failed) throw new StorageError(`Upstash error: ${failed.error}`);
  return replies.map((r) => r.result);
}

/** Lower-cased and trimmed if it looks like an email, otherwise null. */
export function normaliseEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  return email.length <= MAX_LENGTH && EMAIL.test(email) ? email : null;
}

/** Counts this sign-up against the caller's per-minute allowance; true while within it. */
export async function withinRateLimit(caller: string): Promise<boolean> {
  const key = `waitlist:rate:${caller}:${Math.floor(Date.now() / 60_000)}`;
  const [count] = await pipeline([
    ["INCR", key],
    ["EXPIRE", key, 120],
  ]);
  return Number(count) <= RATE_LIMIT;
}

/** Adds the email; "already" if it was on the list before. */
export async function join(email: string): Promise<"joined" | "already"> {
  const [added] = await pipeline([["HSETNX", KEY, email, JSON.stringify({ at: new Date().toISOString() })]]);
  return Number(added) === 1 ? "joined" : "already";
}

/** Every sign-up, oldest first. */
export async function list(): Promise<{ email: string; at: string }[]> {
  const [flat] = (await pipeline([["HGETALL", KEY]])) as [string[] | null];
  const rows: { email: string; at: string }[] = [];
  for (let i = 0; i + 1 < (flat?.length ?? 0); i += 2) {
    let at = "";
    try {
      at = (JSON.parse(flat![i + 1]) as { at?: string }).at ?? "";
    } catch {
      // A hand-edited value; keep the email, leave the time blank.
    }
    rows.push({ email: flat![i], at });
  }
  return rows.sort((a, b) => a.at.localeCompare(b.at));
}
