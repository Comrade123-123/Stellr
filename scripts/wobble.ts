/**
 * Wobble, Stellr's research agent: each run it chooses stars on its own, investigates their
 * TESS light curves with the same pipeline as Exoplanet Lab, and records what it finds in
 * Upstash Redis, which the password-protected /wobble page reads. Run daily by
 * .github/workflows/wobble.yml. The repository and its Actions logs are public, so findings
 * go only to Redis and the log prints counts, never results.
 *
 * Each run looks at two kinds of star, mostly the second:
 *  - TESS Objects of Interest still marked "planet candidate", re-examined independently
 *    (a quarter of the run by default);
 *  - stars TESS watched closely (2-minute cadence) with no known planet and no TOI, searched
 *    blind for anything new; those watched in two or more sectors come first, as more time on
 *    a star is what reveals longer periods and shallower dips.
 * For each it loads up to three sectors, flattens them, searches with Box Least Squares up to
 * three times (hiding each signal before looking for the next), and judges every signal with
 * the shared checks (lib/verdict.ts), the ML vetter and the star's catalogue values.
 *
 *     npx tsx scripts/wobble.ts            (writes to Redis: UPSTASH_REDIS_REST_URL / _TOKEN)
 *     npx tsx scripts/wobble.ts out.json   (tests: writes a file instead)
 *
 * WOBBLE_TARGETS sets how many stars per run (default 8) and WOBBLE_BLIND_SHARE the share of
 * them searched blind (default 0.75); EXO_BASE and MAST_BASE point it at
 * local stand-ins for tests.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isConfigured, pipeline } from "../lib/redis";
import { dirname } from "node:path";
import { fromTransit, join, relation, searchOnce, EARTH_PER_SUN, type Curve, type Ephemeris } from "../lib/exoplanets";
import { lightCurveFromFits } from "../lib/lightcurve";
import { invoke, lightCurveFile, tessSectors, ticStar, type TicStar } from "../lib/mast";
import { failedChecks, verdict, type Toi } from "../lib/verdict";
import { afterChecks, planetScore, vetFeatures, type VetterModel } from "../lib/vetter";
import { describe, KIND_LABEL } from "../lib/worlds";

/** A file to write instead of Redis, for tests. */
const FILE = process.argv[2] ?? null;
const KEEP_REDIS = 500;
const EXO = process.env.EXO_BASE ?? "https://exoplanetarchive.ipac.caltech.edu";
const TARGETS = Number(process.env.WOBBLE_TARGETS ?? 8);
const BLIND_SHARE = Math.min(1, Math.max(0, Number(process.env.WOBBLE_BLIND_SHARE ?? 0.75)));
/** More sectors reveal longer periods and shallower dips; the newest are used. */
const SECTORS_PER_STAR = 6;
/** Longest period searched, days, and the most trial frequencies (search time grows with both). */
const MAX_PERIOD = 40;
const MAX_FREQS = 150_000;
const SEARCHES_PER_STAR = 3;
const KEEP = 300;
const AGENT = "Stellr Wobble";

interface Finding {
  kind: string;
  title: string;
  notes: string[];
  period: number;
  t0: number;
  duration: number;
  depth: number;
  snr: number;
  sde: number;
  transits: number;
  score: number | null;
  /** The vetter's score after the light-curve checks (lib/vetter.ts `afterChecks`). */
  scoreAfter?: number | null;
  /** How far from the target the dip's source seems to lie, pixels (21″ each), and its significance. */
  centroid?: { offsetPx: number; sigma: number } | null;
  radiusEarth: number | null;
  world: { kind: string; teq: number; insolation: number; inZone: boolean } | null;
  /** The transit folded and averaged: hours from mid-transit, brightness. */
  fold: { x: number[]; y: number[] };
}

interface Investigation {
  id: string;
  at: string;
  tic: string;
  label: string;
  reason: "candidate" | "blind";
  star: TicStar | null;
  sectors: number[];
  /** Pipeline of each sector read: SPOC (2-minute) or a full-frame-image one (TESS-SPOC, QLP). */
  pipelines?: string[];
  points: number;
  days: number;
  known: string[];
  findings: Finding[];
  /** The strongest peak when nothing passed the bar. */
  quiet: { sde: number; snr: number } | null;
  /** Sectors that couldn't be read, when others could. */
  skipped?: string;
  error?: string;
}

interface Log {
  updated: string;
  runs: { at: string; investigated: number; candidates: number }[];
  investigations: Investigation[];
}

async function tap(query: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${EXO}/TAP/sync?query=${encodeURIComponent(query)}&format=json`, {
    headers: { Accept: "application/json", "User-Agent": AGENT },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Exoplanet Archive ${res.status}`);
  return (await res.json()) as Record<string, unknown>[];
}

/** A random generator seeded by the date, so a day's choice is reproducible. */
function seeded(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
function shuffle<T>(list: T[], rnd: () => number) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round = (v: number, d = 5) => Math.round(v * 10 ** d) / 10 ** d;

/** The transit folded into 50 averaged bins across ±max(2.5 durations, 6 h). */
function foldOf(curve: Curve, period: number, t0: number, durationH: number) {
  const window = Math.max(durationH * 2.5, 6);
  const bins = 50;
  const sy = new Float64Array(bins);
  const n = new Float64Array(bins);
  for (let i = 0; i < curve.t.length; i++) {
    const h = fromTransit(curve.t[i], period, t0) * 24;
    if (Math.abs(h) > window) continue;
    const b = Math.min(bins - 1, Math.floor(((h + window) / (2 * window)) * bins));
    sy[b] += curve.f[i];
    n[b]++;
  }
  const x: number[] = [];
  const y: number[] = [];
  for (let b = 0; b < bins; b++)
    if (n[b]) {
      x.push(round(-window + ((b + 0.5) / bins) * 2 * window, 2));
      y.push(round(sy[b] / n[b], 6));
    }
  return { x, y };
}

async function investigate(tic: string, label: string, reason: Investigation["reason"], model: VetterModel | null): Promise<Investigation> {
  const record: Investigation = {
    id: `${tic}-${Date.now()}`,
    at: new Date().toISOString(),
    tic,
    label,
    reason,
    star: null,
    sectors: [],
    points: 0,
    days: 0,
    known: [],
    findings: [],
    quiet: null,
  };
  try {
    const [sectors, star, knownRows, toiRows] = await Promise.all([
      tessSectors(tic, 60_000),
      ticStar(tic).catch(() => null),
      tap(`select pl_name, pl_orbper from pscomppars where tic_id = 'TIC ${Number(tic)}'`).catch(() => []),
      tap(`select toi, tfopwg_disp, pl_orbper, pl_trandep, pl_trandurh from toi where tid = ${Number(tic)}`).catch(() => []),
    ]);
    record.star = star;
    const known = knownRows.map((r) => ({ name: String(r.pl_name ?? ""), period: num(r.pl_orbper) }));
    record.known = known.map((k) => k.name);
    const tois: Toi[] = toiRows.map((r) => ({
      toi: String(r.toi ?? ""),
      disposition: typeof r.tfopwg_disp === "string" ? r.tfopwg_disp : "",
      period: num(r.pl_orbper),
      depthPpm: num(r.pl_trandep),
      durationH: num(r.pl_trandurh),
    }));

    const chosen = sectors.slice(-SECTORS_PER_STAR);
    if (!chosen.length) throw new Error("no TESS light curve");
    record.sectors = chosen.map((s) => s.sector);
    record.pipelines = chosen.map((s) => s.pipeline);
    // A sector that fails (a missing file, a bad download) is skipped; the rest still count.
    const parts: Curve[] = [];
    const failures: string[] = [];
    for (const s of chosen) {
      try {
        const c = lightCurveFromFits(await lightCurveFile(s.obsid, AGENT));
        parts.push({ t: Float64Array.from(c.t), f: Float64Array.from(c.f), ...(c.cx && c.cy ? { cx: Float64Array.from(c.cx), cy: Float64Array.from(c.cy) } : {}) });
      } catch (e) {
        failures.push(`sector ${s.sector}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (!parts.length) throw new Error(failures.join("; "));
    if (failures.length) record.skipped = failures.join("; ");
    const curve = join(parts);
    record.points = curve.t.length;
    record.days = round(curve.t[curve.t.length - 1] - curve.t[0], 1);

    const found: Ephemeris[] = [];
    let lastFlat: Curve = curve;
    let singles: ReturnType<typeof searchOnce>["singles"] = [];
    for (let round_ = 0; round_ < SEARCHES_PER_STAR; round_++) {
      const { flat, result, checks, singles: lone } = searchOnce(curve, found, { maxP: MAX_PERIOD, maxFreqs: MAX_FREQS });
      lastFlat = flat;
      singles = lone;
      const x = result && model ? vetFeatures(result.period, result.duration, result.depth, star ? { radius: star.radius, teff: star.teff, logg: star.logg } : null) : null;
      const score = model && x ? planetScore(model, x) : null;
      const v = verdict({ result, checks }, known, tois, star?.radius ?? null, score);
      // The same period (or a simple multiple) again means masking didn't remove it: a smooth variation, not new dips.
      if (result && record.findings.some((f) => relation(result.period, f.period))) break;
      if (v.kind === "none" || !result || !checks) {
        if (round_ === 0) record.quiet = result ? { sde: round(result.sde, 1), snr: round(result.snr, 1) } : null;
        break;
      }
      const radiusEarth = star?.radius ? Math.sqrt(result.depth) * star.radius * EARTH_PER_SUN : null;
      const world =
        radiusEarth && star?.radius && star.teff
          ? describe({ radiusEarth, period: result.period, starRadius: star.radius, starTeff: star.teff, starMass: star.mass })
          : null;
      record.findings.push({
        kind: v.kind,
        title: v.title,
        notes: v.notes,
        period: round(result.period),
        t0: round(result.t0),
        duration: round(result.duration, 2),
        depth: round(result.depth, 7),
        snr: round(result.snr, 1),
        sde: round(result.sde, 1),
        transits: result.transits,
        score: score === null ? null : round(score, 3),
        scoreAfter: score === null ? null : round(afterChecks(score, failedChecks(result, checks, star?.radius ?? null)), 3),
        centroid: checks.centroid ? { offsetPx: round(checks.centroid.offsetPx, 2), sigma: round(checks.centroid.sigma, 1) } : null,
        radiusEarth: radiusEarth ? round(radiusEarth, 2) : null,
        world: world ? { kind: KIND_LABEL[world.kind], teq: Math.round(world.teq), insolation: round(world.insolation, 2), inZone: world.inZone } : null,
        fold: foldOf(flat, result.period, result.t0, result.duration),
      });
      found.push({ period: result.period, t0: result.t0, duration: result.duration });
    }
    // Lone dips left once every periodic signal is hidden: a long orbit seen once. Not on a star
    // with a deep signal already ruled out (an eclipsing binary), whose leftovers would show here.
    const binaryLike = record.findings.some((f) => f.kind === "doubt" && f.depth > 0.005);
    for (const d of binaryLike ? [] : singles) {
      const radiusEarth = star?.radius ? Math.sqrt(d.depth) * star.radius * EARTH_PER_SUN : null;
      record.findings.push({
        kind: "single",
        title: "SINGLE DIP · PERIOD UNKNOWN",
        notes: [
          `One ${Math.round(d.depth * 1e6).toLocaleString("en")} ppm dip, ${d.duration} h long, at BTJD ${d.t0.toFixed(2)}, seen once in ${record.days} days of data. A planet on a long orbit can cross only once; so can a stray systematic. More TESS sectors would tell.`,
        ],
        period: 0,
        t0: round(d.t0),
        duration: d.duration,
        depth: round(d.depth, 7),
        snr: round(d.snr, 1),
        sde: 0,
        transits: 1,
        score: null,
        radiusEarth: radiusEarth ? round(radiusEarth, 2) : null,
        world: null,
        fold: foldOf(lastFlat, 1e6, d.t0, d.duration),
      });
    }
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
  }
  return record;
}

/** The TESS sector most likely processed by now: one every ~27.4 days since 25 July 2018, less a couple for processing. */
const latestSector = () => Math.floor((Date.now() - Date.UTC(2018, 6, 25)) / (27.4 * 86_400_000)) - 1;

async function main() {
  if (!FILE && !isConfigured()) throw new Error("Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (repository secrets) so Wobble can keep its notebook.");
  const log: Log = FILE && existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as Log) : { updated: "", runs: [], investigations: [] };
  const seen = new Set(log.investigations.map((i) => i.tic));
  if (!FILE) for (const t of ((await pipeline([["SMEMBERS", "wobble:tics"]]))[0] as string[] | null) ?? []) seen.add(t);
  const rnd = seeded(Math.floor(Date.now() / 86_400_000));
  let model: VetterModel | null = null;
  try {
    model = JSON.parse(readFileSync("public/models/vetter.json", "utf8")) as VetterModel;
  } catch {
    console.log("no vetter model; scores left out");
  }

  const tois = await tap("select tid, toi, tfopwg_disp from toi");
  const toiStars = new Set(tois.map((r) => String(r.tid)));
  const hosts = new Set((await tap("select distinct tic_id from pscomppars where tic_id is not null")).map((r) => String(r.tic_id ?? "").replace(/^TIC\s*/i, "")));

  /**
   * How many TESS sectors a star worth investigating has (0 if it isn't): it needs a light
   * curve and, for a blind search, must be a dwarf (under 2.5 solar radii) bright enough
   * (TESS magnitude ≤ 13) for small dips to show.
   */
  const eligible = async (tic: string, blind: boolean) => {
    try {
      const sectors = (await tessSectors(tic, 60_000)).length;
      if (!sectors || !blind) return sectors;
      const s = await ticStar(tic);
      return s && s.tmag !== null && s.tmag <= 13 && s.radius !== null && s.radius < 2.5 ? sectors : 0;
    } catch {
      return 0;
    }
  };
  const MAX_TRIES = 40;
  const toiPicks = Math.round(TARGETS * (1 - BLIND_SHARE));

  // A share of the run: open planet candidates, re-examined.
  const pcs = shuffle(
    tois.filter((r) => r.tfopwg_disp === "PC" && !seen.has(String(r.tid))),
    rnd,
  );
  const picks: { tic: string; label: string; reason: Investigation["reason"] }[] = [];
  let tries = 0;
  for (const r of pcs) {
    if (picks.length >= toiPicks || tries++ >= MAX_TRIES) break;
    const t = String(r.tid);
    if (picks.some((p) => p.tic === t) || !(await eligible(t, false))) continue;
    picks.push({ tic: t, label: `TOI-${Math.floor(Number(r.toi))}`, reason: "candidate" });
  }
  // The rest: stars watched closely in a sector, with nothing known about them.
  const sector = 1 + Math.floor(rnd() * Math.max(1, latestSector()));
  // Stars with 2-minute light curves, and stars with full-frame-image light curves from
  // TESS-SPOC: the second pool is far larger and far less searched by eye.
  const pool = async (collection: string, provenance: string) =>
    invoke(
      {
        service: "Mast.Caom.Filtered",
        params: {
          columns: "target_name",
          filters: [
            { paramName: "obs_collection", values: [collection] },
            { paramName: "dataproduct_type", values: ["timeseries"] },
            { paramName: "provenance_name", values: [provenance] },
            { paramName: "sequence_number", values: [{ min: sector, max: sector }] },
          ],
        },
      },
      60_000,
    ).catch(() => []);
  const watched = [...(await pool("TESS", "SPOC")), ...(await pool("HLSP", "TESS-SPOC"))];
  const quiet = shuffle(
    [...new Set(watched.map((r) => String(r.target_name ?? "")))].filter((t) => /^\d+$/.test(t) && !toiStars.has(t) && !hosts.has(t) && !seen.has(t)),
    rnd,
  );
  // Stars with two or more sectors first; single-sector ones only fill any places left.
  tries = 0;
  const single: string[] = [];
  for (const t of quiet) {
    if (picks.length >= TARGETS || tries++ >= MAX_TRIES * 1.5) break;
    const n = await eligible(t, true);
    if (n >= 2) picks.push({ tic: t, label: `TIC ${t}`, reason: "blind" });
    else if (n === 1) single.push(t);
  }
  for (const t of single) {
    if (picks.length >= TARGETS) break;
    picks.push({ tic: t, label: `TIC ${t}`, reason: "blind" });
  }
  console.log(`investigating ${picks.length} stars`);

  const results: Investigation[] = [];
  for (const p of picks) {
    const r = await investigate(p.tic, p.label, p.reason, model);
    results.push(r);
  }

  const run = { at: new Date().toISOString(), investigated: results.length, candidates: results.reduce((a, r) => a + r.findings.filter((f) => f.kind === "candidate").length, 0) };
  if (FILE) {
    log.investigations = [...results, ...log.investigations].slice(0, KEEP);
    log.runs = [run, ...log.runs].slice(0, 60);
    log.updated = run.at;
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(log));
  } else {
    // Newest at the head of the list.
    await pipeline([
      ...[...results].reverse().map((r) => ["LPUSH", "wobble:investigations", JSON.stringify(r)]),
      ["LTRIM", "wobble:investigations", 0, KEEP_REDIS - 1],
      ...(results.length ? [["SADD", "wobble:tics", ...results.map((r) => r.tic)]] : []),
      ["LPUSH", "wobble:runs", JSON.stringify(run)],
      ["LTRIM", "wobble:runs", 0, 59],
      ["SET", "wobble:updated", run.at],
    ]);
  }
  // Counts only: this log is public.
  console.log(`done: ${results.length} investigated, ${results.filter((r) => r.error).length} could not be read`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
