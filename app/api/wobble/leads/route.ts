import { connection } from "next/server";
import { pipeline } from "@/lib/redis";
import { fromRequest, valid } from "@/lib/wobble-auth";

/**
 * GET /api/wobble/leads → has Wobble found anything new? Every signal in the notebook that
 * matches no known planet and no TESS Object of Interest and passed the checks (kind
 * "candidate"), strongest first, with counts for the whole notebook. Signed-in browsers only.
 * Strongest = the ML vetter's score, then signal-to-noise.
 */
const CHUNK = 100;
const MAX_SCAN = 1000;
const MAX_LEADS = 12;
const PRIVATE = { "Cache-Control": "private, no-store" };

interface Finding {
  kind: string;
  score: number | null;
  snr: number;
  transits: number;
  period: number;
}

export async function GET(request: Request) {
  await connection();
  if (!valid(fromRequest(request))) return Response.json({ error: "sign in" }, { status: 401, headers: PRIVATE });
  try {
    const leads: { investigation: Record<string, unknown>; finding: Finding }[] = [];
    const stars = new Set<string>();
    let signals = 0;
    let recovered = 0;
    let ruledOut = 0;
    for (let start = 0; start < MAX_SCAN; start += CHUNK) {
      const [items] = (await pipeline([["LRANGE", "wobble:investigations", start, start + CHUNK - 1]])) as [string[] | null];
      if (!items?.length) break;
      for (const s of items) {
        const r = JSON.parse(s) as Record<string, unknown> & { tic: string; error?: string; findings?: Finding[] };
        if (!r.error) stars.add(String(r.tic));
        for (const f of r.findings ?? []) {
          signals++;
          if (f.kind === "known" || f.kind === "alias" || f.kind === "toi") recovered++;
          if (f.kind === "doubt") ruledOut++;
          if (f.kind === "candidate") {
            const { findings: _all, ...rest } = r;
            void _all;
            leads.push({ investigation: rest, finding: f });
          }
        }
      }
      if (items.length < CHUNK) break;
    }
    // The same star re-checked on another day may give the same signal twice: keep the stronger.
    const best = new Map<string, (typeof leads)[number]>();
    const strength = (f: Finding) => (f.score ?? 0) * 100 + Math.min(f.snr, 99) / 100;
    for (const l of leads) {
      const key = `${l.investigation.tic}:${l.finding.period.toFixed(2)}`;
      const had = best.get(key);
      if (!had || strength(l.finding) > strength(had.finding)) best.set(key, l);
    }
    const ranked = [...best.values()].sort((a, b) => strength(b.finding) - strength(a.finding));
    return Response.json(
      {
        stars: stars.size,
        signals,
        recovered,
        ruledOut,
        candidates: ranked.length,
        strong: ranked.filter((l) => (l.finding.score ?? 0) >= 0.5 && l.finding.snr >= 10 && l.finding.transits >= 3).length,
        leads: ranked.slice(0, MAX_LEADS),
      },
      { headers: PRIVATE },
    );
  } catch (error) {
    console.error("[wobble] leads", error instanceof Error ? error.message : error);
    return Response.json({ error: "notebook unavailable" }, { status: 502, headers: PRIVATE });
  }
}
