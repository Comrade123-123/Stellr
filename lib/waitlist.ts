import { pipeline } from "./redis";

/**
 * The closed waitlist, server side only. Sign-ups have stopped (every tool is open), but the
 * emails already collected stay in Upstash Redis — one hash, `waitlist:emails`, field =
 * lower-cased email, value = JSON { at } — and can still be exported from /api/waitlist/export.
 */

const KEY = "waitlist:emails";

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
