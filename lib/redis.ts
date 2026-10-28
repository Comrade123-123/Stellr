/**
 * Upstash Redis over its REST API, server side only: no client library to bundle. Vercel's
 * Upstash integration sets the connection as KV_REST_API_URL / KV_REST_API_TOKEN (older
 * projects) or UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN; either pair works. Used by
 * the old waitlist's export, Wobble's sign-in and Wobble's notebook (written from GitHub Actions too).
 */

function connection() {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export const isConfigured = () => connection() !== null;

export class StorageError extends Error {}

/** Runs Redis commands in one round trip; returns each command's result in order. */
export async function pipeline(commands: (string | number)[][]): Promise<unknown[]> {
  const conn = connection();
  if (!conn) throw new StorageError("Redis is not configured");
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

/** Counts a request against `scope`'s per-minute allowance for `caller`; true while within `limit`. */
export async function withinRate(scope: string, caller: string, limit: number): Promise<boolean> {
  const key = `${scope}:rate:${caller}:${Math.floor(Date.now() / 60_000)}`;
  const [count] = await pipeline([
    ["INCR", key],
    ["EXPIRE", key, 120],
  ]);
  return Number(count) <= limit;
}
