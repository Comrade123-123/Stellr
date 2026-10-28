/**
 * Wobble, Stellr's research agent: each run it chooses stars on its own, investigates their
 * TESS light curves with the same pipeline as Exoplanet Lab, and records what it finds in
 * public/wobble/log.json, which the /wobble page shows. Run daily by
 * .github/workflows/wobble.yml; free, with no keys.
 *
 * Each run looks at two kinds of star:
 *  - TESS Objects of Interest still marked "planet candidate", re-examined independently;
 *  - stars TESS watched closely (2-minute cadence) with no known planet and no TOI, searched
 *    blind for anything new.
 * For each it loads up to three sectors, flattens them, searches with Box Least Squares up to
 * three times (hiding each signal before looking for the next), and judges every signal with
 * the shared checks (lib/verdict.ts), the ML vetter and the star's catalogue values.
 *
 *     npx tsx scripts/wobble.ts public/wobble/log.json
 *
 * WOBBLE_TARGETS sets how many stars per run (default 8); EXO_BASE and MAST_BASE point it at
 * local stand-ins for tests.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { bls, flatten, fromTransit, mask, measure, relation, EARTH_PER_SUN, type Curve } from "../lib/exoplanets";
import { lightCurveFromFits } from "../lib/lightcurve";
import { invoke, lightCurveFile, tessSectors, ticStar, type TicStar } from "../lib/mast";
import { verdict, type Toi } from "../lib/verdict";
import { planetScore, vetFeatures, type VetterModel } from "../lib/vetter";
import { describe, KIND_LABEL } from "../lib/worlds";

const OUT = process.argv[2] ?? "public/wobble/log.json";
const EXO = process.env.EXO_BASE ?? "https://exoplanetarchive.ipac.caltech.edu";
const TARGETS = Number(process.env.WOBBLE_TARGETS ?? 8);
const SECTORS_PER_STAR = 3;
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
      tessSectors(tic),
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
    // A sector that fails (a missing file, a bad download) is skipped; the rest still count.
    const parts = [];
    const failures: string[] = [];
    for (const s of chosen) {
      try {
        parts.push(lightCurveFromFits(await lightCurveFile(s.obsid, AGENT)));
      } catch (e) {
        failures.push(`sector ${s.sector}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (!parts.length) throw new Error(failures.join("; "));
    if (failures.length) record.skipped = failures.join("; ");
    parts.sort((a, b) => a.t[0] - b.t[0]);
    const curve: Curve = { t: Float64Array.from(parts.flatMap((p) => p.t)), f: Float64Array.from(parts.flatMap((p) => p.f)) };
    record.points = curve.t.length;
    record.days = round(curve.t[curve.t.length - 1] - curve.t[0], 1);

    let search = flatten(curve);
    for (let round_ = 0; round_ < SEARCHES_PER_STAR; round_++) {
      const result = bls(search);
      const checks = result ? measure(search, result.period, result.t0, result.duration) : null;
      const x = result && model ? vetFeatures(result.period, result.duration, result.depth, star ? { radius: star.radius, teff: star.teff, logg: star.logg } : null) : null;
      const score = model && x ? planetScore(model, x) : null;
      const v = verdict({ result, checks }, known, tois, star?.radius ?? null, score);
      // The same period (or a simple multiple) again means masking didn't remove it: a smooth variation, not new dips.
      if (result && record.findings.some((f) => relation(result.period, f.period))) break;
      if (v.kind === "none" || !result) {
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
        radiusEarth: radiusEarth ? round(radiusEarth, 2) : null,
        world: world ? { kind: KIND_LABEL[world.kind], teq: Math.round(world.teq), insolation: round(world.insolation, 2), inZone: world.inZone } : null,
        fold: foldOf(search, result.period, result.t0, result.duration),
      });
      search = mask(search, result.period, result.t0, result.duration);
    }
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
  }
  return record;
}

/** The TESS sector most likely processed by now: one every ~27.4 days since 25 July 2018, less a couple for processing. */
const latestSector = () => Math.floor((Date.now() - Date.UTC(2018, 6, 25)) / (27.4 * 86_400_000)) - 1;

async function main() {
  const log: Log = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, "utf8")) as Log) : { updated: "", runs: [], investigations: [] };
  const seen = new Set(log.investigations.map((i) => i.tic));
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
   * Worth an investigation: TESS has a light curve for it and, for a blind search, it is a
   * dwarf star (under 2.5 solar radii) bright enough (TESS magnitude ≤ 13) for small dips to show.
   */
  const eligible = async (tic: string, blind: boolean) => {
    try {
      if (!(await tessSectors(tic)).length) return false;
      if (!blind) return true;
      const s = await ticStar(tic);
      return !!s && s.tmag !== null && s.tmag <= 13 && s.radius !== null && s.radius < 2.5;
    } catch {
      return false;
    }
  };
  const MAX_TRIES = 40;

  // Half the run: open planet candidates, re-examined.
  const pcs = shuffle(
    tois.filter((r) => r.tfopwg_disp === "PC" && !seen.has(String(r.tid))),
    rnd,
  );
  const picks: { tic: string; label: string; reason: Investigation["reason"] }[] = [];
  let tries = 0;
  for (const r of pcs) {
    if (picks.length >= Math.ceil(TARGETS / 2) || tries++ >= MAX_TRIES) break;
    const t = String(r.tid);
    if (picks.some((p) => p.tic === t) || !(await eligible(t, false))) continue;
    picks.push({ tic: t, label: `TOI-${Math.floor(Number(r.toi))}`, reason: "candidate" });
  }
  // The rest: stars watched closely in a sector, with nothing known about them.
  const sector = 1 + Math.floor(rnd() * Math.max(1, latestSector()));
  const watched = await invoke({
    service: "Mast.Caom.Filtered",
    params: {
      columns: "target_name",
      filters: [
        { paramName: "obs_collection", values: ["TESS"] },
        { paramName: "dataproduct_type", values: ["timeseries"] },
        { paramName: "provenance_name", values: ["SPOC"] },
        { paramName: "sequence_number", values: [{ min: sector, max: sector }] },
        { paramName: "t_exptime", values: [{ min: 119, max: 121 }] },
      ],
    },
  }).catch(() => []);
  const quiet = shuffle(
    [...new Set(watched.map((r) => String(r.target_name ?? "")))].filter((t) => /^\d+$/.test(t) && !toiStars.has(t) && !hosts.has(t) && !seen.has(t)),
    rnd,
  );
  tries = 0;
  for (const t of quiet) {
    if (picks.length >= TARGETS || tries++ >= MAX_TRIES) break;
    if (await eligible(t, true)) picks.push({ tic: t, label: `TIC ${t}`, reason: "blind" });
  }
  console.log(`sector ${sector}: ${quiet.length} unknown stars to choose from; investigating ${picks.length}`);

  const results: Investigation[] = [];
  for (const p of picks) {
    const r = await investigate(p.tic, p.label, p.reason, model);
    console.log(`${p.label}: ${r.error ?? (r.findings.map((f) => f.title).join("; ") || "nothing above the bar")}`);
    results.push(r);
  }

  log.investigations = [...results, ...log.investigations].slice(0, KEEP);
  log.runs = [{ at: new Date().toISOString(), investigated: results.length, candidates: results.reduce((a, r) => a + r.findings.filter((f) => f.kind === "candidate").length, 0) }, ...log.runs].slice(0, 60);
  log.updated = new Date().toISOString();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(log));
  console.log(`wrote ${OUT}: ${log.investigations.length} investigations`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
