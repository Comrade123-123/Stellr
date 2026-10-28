import { pipeline, withinRate } from "./redis";

/**
 * Waitlist storage, server side only (route handlers import it; client code must not).
 *
 * Emails live in Upstash Redis (lib/redis.ts).
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

export { isConfigured, StorageError } from "./redis";

/** Lower-cased and trimmed if it looks like an email, otherwise null. */
export function normaliseEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  return email.length <= MAX_LENGTH && EMAIL.test(email) ? email : null;
}

/** Counts this sign-up against the caller's per-minute allowance; true while within it. */
export const withinRateLimit = (caller: string) => withinRate("waitlist", caller, RATE_LIMIT);

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
