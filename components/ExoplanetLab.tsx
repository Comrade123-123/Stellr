"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Plot, { type Layer, type Marker } from "@/components/charts/Plot";
import ScrambleText from "@/components/ui/ScrambleText";
import {
  BTJD,
  CATALOG_FIELDS,
  EARTH_PER_SUN,
  fromTransit,
  planetFromRow,
  relation,
  type BlsResult,
  type Checks,
  type Curve,
  type Planet,
} from "@/lib/exoplanets";

type Load = "idle" | "loading" | "ready" | "error";
type Method = "all" | "Transit" | "Radial Velocity" | "other";
type Sort = "newest" | "nearest" | "smallest";

interface Sector {
  sector: number;
  obsid: string;
  cadence: number;
  pipeline: string;
}

interface Target {
  tic: string;
  label: string;
  host: string | null;
}

/** One search's outcome: what was searched (after masking earlier signals), what was found, and the checks on it. */
interface Signal {
  flat: Curve;
  result: BlsResult | null;
  checks: Checks | null;
}

const GOLD = "#c9a46a";
const INK = "rgba(236,238,242,0.85)";
const DIM = "rgba(236,238,242,0.35)";
const LIST_LIMIT = 80;
/** Sectors loaded at first; more can be added. */
const FIRST_SECTORS = 3;
/** Thresholds for calling a peak a detection (common in TESS searches). */
const MIN_SDE = 9;
const MIN_SNR = 7;
/** Planets worth a first look, if the catalogue has them. */
const SUGGESTED = ["WASP-18 b", "TOI-270 b", "LHS 3844 b", "TOI-700 d", "pi Men c"];

const fmtNum = (v: number | null, digits = 2, unit = "") => (v === null ? "—" : `${v.toLocaleString("en", { maximumFractionDigits: digits })}${unit}`);
const depthText = (d: number) => (d < 0.01 ? `${Math.round(d * 1e6).toLocaleString("en")} PPM` : `${(d * 100).toFixed(2)}%`);
const tic = (s: string | null) => s?.replace(/^TIC\s*/i, "").trim() ?? "";

const chip = (on: boolean) =>
  `rounded-full border px-3 py-1 font-mono text-[10px] tracking-[0.18em] transition-colors ${on ? "border-gold bg-gold text-void" : "border-ink/25 text-ink/70 hover:border-ink/60"}`;

/** What a signal most likely is, by the checks this lab can run. Never "confirmed". */
function verdict(s: Signal, known: Planet[]) {
  const r = s.result;
  const c = s.checks;
  if (!r || !c || r.sde < MIN_SDE || r.snr < MIN_SNR) {
    return { kind: "none" as const, title: "NO SIGNIFICANT SIGNAL", notes: [`The strongest peak (SDE ${r ? r.sde.toFixed(1) : "—"}, SNR ${r ? r.snr.toFixed(1) : "—"}) is below the usual detection bar of SDE ${MIN_SDE} and SNR ${MIN_SNR}.`] };
  }
  for (const k of known) {
    if (!k.period) continue;
    const rel = relation(r.period, k.period);
    if (rel === "same period") return { kind: "known" as const, title: `KNOWN PLANET RECOVERED · ${k.name.toUpperCase()}`, notes: [`Same period as ${k.name} (${k.period.toFixed(4)} d) in the NASA Exoplanet Archive.`] };
    if (rel) return { kind: "alias" as const, title: `RELATED TO ${k.name.toUpperCase()}`, notes: [`At ${rel} of ${k.name}: most likely the same planet, seen at a multiple of its period.`] };
  }
  const notes: string[] = [];
  const oe = Math.abs(c.odd.depth - c.even.depth) / Math.hypot(c.odd.err, c.even.err);
  if (c.odd.n && c.even.n && oe > 3) notes.push("Odd and even transits differ in depth: the mark of an eclipsing binary star at half its true period.");
  if (c.secondary.n && c.secondary.depth / c.secondary.err > 3) notes.push("A dip half an orbit later (a secondary eclipse): a glowing companion star, not a planet.");
  if (r.depth > 0.03) notes.push("Over 3% deep: more likely a small star than a planet.");
  if (r.transits < 3) notes.push("Fewer than three transits: the period is uncertain.");
  if (notes.length) return { kind: "doubt" as const, title: "SIGNAL · PROBABLY NOT A PLANET", notes };
  return {
    kind: "candidate" as const,
    title: "STELLR CANDIDATE · UNVETTED",
    notes: ["Passes the checks this lab runs, and matches no known planet of this star. That makes it a candidate, not a planet: confirming one needs follow-up this lab can't do yet (pixel-level checks for nearby stars, spectra of the star's wobble)."],
  };
}

function Section({ step, title, children, aside }: { step: string; title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="frame bg-void/70 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-mono text-[10px] tracking-[0.22em] text-ink/50">
          <span className="text-gold">{step}</span> · {title}
        </h2>
        {aside}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] tracking-[0.2em] text-ink/45">{label}</dt>
      <dd className="mt-1 font-mono text-sm text-ink">{value}</dd>
      {sub && <dd className="mt-0.5 font-mono text-[10px] tracking-[0.12em] text-ink/45">{sub}</dd>}
    </div>
  );
}

/** Exoplanet Lab: the catalogue of known worlds, and a transit search on real TESS starlight. */
export default function ExoplanetLab() {
  const [catalog, setCatalog] = useState<Planet[]>([]);
  const [catLoad, setCatLoad] = useState<Load>("loading");
  const [catDetail, setCatDetail] = useState("");
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState<Method>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [picked, setPicked] = useState<Planet | null>(null);

  const [target, setTarget] = useState<Target | null>(null);
  const [ticInput, setTicInput] = useState("");
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [sectorLoad, setSectorLoad] = useState<Load>("idle");
  const [chosen, setChosen] = useState<number[]>([]);
  const [curve, setCurve] = useState<Curve | null>(null);
  const [curveLoad, setCurveLoad] = useState<Load>("idle");
  const [detail, setDetail] = useState("");
  const sectorCache = useRef(new Map<string, Curve>());

  const [signals, setSignals] = useState<Signal[]>([]);
  const [searching, setSearching] = useState<number | null>(null);
  const [searchError, setSearchError] = useState("");
  const worker = useRef<Worker | null>(null);

  // The catalogue, once.
  useEffect(() => {
    fetch("/api/exoplanets/catalog")
      .then(async (res) => {
        const data = (await res.json()) as { fields?: string[]; rows?: unknown[][]; error?: boolean; detail?: string };
        if (!res.ok || data.error || !data.rows) throw new Error(data.detail ?? `HTTP ${res.status}`);
        if (data.fields?.join() !== CATALOG_FIELDS.join()) throw new Error("catalogue columns changed");
        setCatalog(data.rows.map(planetFromRow));
        setCatLoad("ready");
      })
      .catch((e: unknown) => {
        setCatDetail(e instanceof Error ? e.message : "");
        setCatLoad("error");
      });
    return () => worker.current?.terminate();
  }, []);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of catalog) m.set(p.method, (m.get(p.method) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [catalog]);

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = catalog.filter(
      (p) =>
        (method === "all" || (method === "other" ? p.method !== "Transit" && p.method !== "Radial Velocity" : p.method === method)) &&
        words.every((w) => p.name.toLowerCase().includes(w) || p.host.toLowerCase().includes(w) || (p.tic ?? "").toLowerCase().includes(w)),
    );
    if (sort === "nearest") list.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    if (sort === "smallest") list.sort((a, b) => (a.radius ?? Infinity) - (b.radius ?? Infinity));
    return list;
  }, [catalog, query, method, sort]);

  const suggestions = useMemo(() => SUGGESTED.map((n) => catalog.find((p) => p.name.toLowerCase() === n.toLowerCase())).filter((p): p is Planet => !!p?.tic), [catalog]);

  /** Planets already known around the target star. */
  const known = useMemo(() => {
    if (!target) return [];
    return catalog.filter((p) => (p.tic && tic(p.tic) === target.tic) || (target.host && p.host === target.host));
  }, [catalog, target]);
  const star = known[0] ?? null;

  const loadTarget = useCallback((t: Target) => {
    setTarget(t);
    setSectors([]);
    setChosen([]);
    setCurve(null);
    setSignals([]);
    setSearchError("");
    setDetail("");
    setSectorLoad("loading");
    fetch(`/api/exoplanets/sectors?tic=${t.tic}`)
      .then(async (res) => {
        const data = (await res.json()) as { sectors?: Sector[]; error?: boolean; detail?: string };
        if (!res.ok || data.error || !data.sectors) throw new Error(data.detail ?? `HTTP ${res.status}`);
        setSectors(data.sectors);
        setChosen(data.sectors.slice(-FIRST_SECTORS).map((s) => s.sector));
        setSectorLoad("ready");
      })
      .catch((e: unknown) => {
        setDetail(e instanceof Error ? e.message : "");
        setSectorLoad("error");
      });
  }, []);

  const analyse = (p: Planet) => {
    if (!p.tic) return;
    loadTarget({ tic: tic(p.tic), label: p.host, host: p.host });
    document.getElementById("lab-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // The chosen sectors' light curves, joined in time order.
  useEffect(() => {
    if (!target || !chosen.length) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurveLoad("loading");
    const wanted = sectors.filter((s) => chosen.includes(s.sector));
    Promise.all(
      wanted.map(async (s) => {
        const hit = sectorCache.current.get(s.obsid);
        if (hit) return hit;
        const res = await fetch(`/api/exoplanets/lightcurve?obsid=${s.obsid}`);
        const data = (await res.json()) as { t?: number[]; f?: number[]; error?: boolean; detail?: string };
        if (!res.ok || data.error || !data.t || !data.f) throw new Error(data.detail ?? `HTTP ${res.status}`);
        const c = { t: Float64Array.from(data.t), f: Float64Array.from(data.f) };
        sectorCache.current.set(s.obsid, c);
        return c;
      }),
    )
      .then((parts) => {
        if (cancelled) return;
        const n = parts.reduce((a, p) => a + p.t.length, 0);
        const t = new Float64Array(n);
        const f = new Float64Array(n);
        let k = 0;
        for (const p of [...parts].sort((a, b) => a.t[0] - b.t[0])) {
          t.set(p.t, k);
          f.set(p.f, k);
          k += p.t.length;
        }
        setCurve({ t, f });
        setSignals([]);
        setCurveLoad("ready");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setDetail(e instanceof Error ? e.message : "");
        setCurveLoad("error");
      });
    return () => {
      cancelled = true;
    };
  }, [target, chosen, sectors]);

  const search = (masks: Signal[]) => {
    if (!curve) return;
    worker.current ??= new Worker(new URL("../lib/bls.worker.ts", import.meta.url), { type: "module" });
    setSearching(0);
    setSearchError("");
    worker.current.onmessage = (e: MessageEvent<{ type: string; value?: number; flat?: Curve; result?: BlsResult | null; checks?: Checks | null; message?: string }>) => {
      if (e.data.type === "progress") setSearching(e.data.value ?? 0);
      else if (e.data.type === "result") {
        setSignals([...masks, { flat: e.data.flat!, result: e.data.result ?? null, checks: e.data.checks ?? null }]);
        setSearching(null);
      } else {
        setSearchError(e.data.message ?? "search failed");
        setSearching(null);
      }
    };
    worker.current.postMessage({
      t: curve.t,
      f: curve.f,
      masks: masks.filter((s) => s.result).map((s) => ({ period: s.result!.period, t0: s.result!.t0, duration: s.result!.duration })),
    });
  };

  const latest = signals[signals.length - 1] ?? null;
  const latestVerdict = latest ? verdict(latest, known) : null;
  const found = signals.filter((s) => s.result && verdict(s, known).kind !== "none");

  // Chart layers.
  const curveLayers = useMemo<Layer[]>(() => (curve ? [{ kind: "points", x: curve.t, y: curve.f, color: INK, size: 1.5, alpha: 0.55 }] : []), [curve]);
  const transitMarks = useMemo<Marker[]>(() => {
    if (!curve || !found.length) return [];
    const marks: Marker[] = [];
    for (const s of found) {
      const r = s.result!;
      for (let tt = r.t0 - Math.ceil((r.t0 - curve.t[0]) / r.period) * r.period; tt <= curve.t[curve.t.length - 1]; tt += r.period) marks.push({ x: tt, color: "rgba(201,164,106,0.35)" });
    }
    return marks.slice(0, 400);
  }, [curve, found]);

  const periodogram = latest?.result ?? null;
  const pgLayers = useMemo<Layer[]>(() => {
    if (!periodogram) return [];
    const max = Math.max(...periodogram.power);
    return [{ kind: "line", x: periodogram.periods, y: Float64Array.from(periodogram.power, (p) => p / max), color: INK }];
  }, [periodogram]);
  const pgMarks = useMemo<Marker[]>(() => {
    if (!periodogram) return [];
    const marks: Marker[] = known
      .filter((k) => k.period && k.period >= periodogram.periods[periodogram.periods.length - 1] && k.period <= periodogram.periods[0])
      .map((k) => ({ x: k.period!, color: "rgba(236,238,242,0.35)", dashed: true, label: k.name.replace(k.host, "").trim() || k.name }));
    marks.push({ x: periodogram.period, color: GOLD, label: `${periodogram.period.toFixed(3)} D` });
    return marks;
  }, [periodogram, known]);

  const fold = useMemo(() => {
    const r = latest?.result;
    if (!latest || !r) return null;
    const window = Math.max(r.duration * 2.5, 6); // hours either side
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < latest.flat.t.length; i++) {
      const h = fromTransit(latest.flat.t[i], r.period, r.t0) * 24;
      if (Math.abs(h) <= window) {
        x.push(h);
        y.push(latest.flat.f[i]);
      }
    }
    // Averages in 40 bins across the window: the transit shape out of the noise.
    const bins = 40;
    const sx = new Float64Array(bins);
    const sy = new Float64Array(bins);
    const n = new Float64Array(bins);
    x.forEach((h, i) => {
      const b = Math.min(bins - 1, Math.floor(((h + window) / (2 * window)) * bins));
      sx[b] += h;
      sy[b] += y[i];
      n[b]++;
    });
    const bx: number[] = [];
    const by: number[] = [];
    for (let b = 0; b < bins; b++)
      if (n[b]) {
        bx.push(sx[b] / n[b]);
        by.push(sy[b] / n[b]);
      }
    const half = r.duration / 2;
    const model: Layer = { kind: "line", x: [-window, -half, -half, half, half, window], y: [1, 1, 1 - r.depth, 1 - r.depth, 1, 1], color: GOLD };
    const layers: Layer[] = [
      { kind: "points", x, y, color: DIM, size: 1.5 },
      { kind: "points", x: bx, y: by, color: INK, size: 5 },
      model,
    ];
    const lo = 1 - r.depth * 1.8 - 0.0005;
    const hi = 1 + r.depth * 0.8 + 0.0005;
    return { layers, window, y: [lo, hi] as [number, number], bins: { x: bx, y: by } };
  }, [latest]);

  const radiusEarth = (d: number) => (star?.starRadius ? Math.sqrt(d) * star.starRadius * EARTH_PER_SUN : null);

  const report = () => {
    if (!target || !curve) return;
    const lines: string[] = [];
    const now = new Date().toISOString().replace("T", " ").slice(0, 16);
    lines.push(`# Exoplanet Lab report: ${target.label} (TIC ${target.tic})`, "", `Generated by Stellr Exoplanet Lab, ${now} UTC.`, "");
    lines.push("## Data", "");
    for (const s of sectors.filter((x) => chosen.includes(x.sector))) lines.push(`- TESS sector ${s.sector}: ${s.pipeline} pipeline, ${s.cadence}-second cadence, MAST observation ${s.obsid}`);
    lines.push(`- ${curve.t.length.toLocaleString("en")} points after quality filtering and 10-minute binning (PDCSAP flux, normalised)`, "");
    lines.push("## Method", "", "- Flattened with a ±0.5-day running median; bright outliers (>4σ) removed.", "- Box Least Squares search, periods 0.4 d to half the baseline (max 30 d), durations 0.75–12 h.", `- Detection bar: SDE ≥ ${MIN_SDE} and SNR ≥ ${MIN_SNR}. Earlier signals masked before each new search.`, "");
    lines.push("## Known planets of this star (NASA Exoplanet Archive)", "");
    if (known.length) for (const k of known) lines.push(`- ${k.name}: period ${fmtNum(k.period, 5)} d, radius ${fmtNum(k.radius)} R⊕, found ${k.year ?? "?"} by ${k.method}`);
    else lines.push("- None listed.");
    lines.push("");
    signals.forEach((s, i) => {
      const v = verdict(s, known);
      lines.push(`## Search ${i + 1}: ${v.title}`, "");
      if (s.result && s.checks) {
        const r = s.result;
        const c = s.checks;
        const rad = radiusEarth(r.depth);
        lines.push(
          `- Period: ${r.period.toFixed(5)} d`,
          `- Mid-transit: BTJD ${r.t0.toFixed(4)} (BJD ${(r.t0 + BTJD).toFixed(4)})`,
          `- Duration: ${r.duration.toFixed(2)} h`,
          `- Depth: ${depthText(r.depth)}${rad ? ` (radius ≈ ${rad.toFixed(1)} R⊕ for a star of ${star!.starRadius} R☉)` : ""}`,
          `- SNR ${r.snr.toFixed(1)}, SDE ${r.sde.toFixed(1)}, ${r.transits} transits with data`,
          `- Odd vs even depth: ${depthText(c.odd.depth)} ± ${depthText(c.odd.err)} vs ${depthText(c.even.depth)} ± ${depthText(c.even.err)}`,
          `- Secondary eclipse (phase 0.5): ${depthText(Math.max(c.secondary.depth, 0))} ± ${depthText(c.secondary.err)}`,
        );
      }
      for (const n of v.notes) lines.push(`- ${n}`);
      lines.push("");
    });
    lines.push("## Caveats", "", "Box Least Squares finds periodic dips; it cannot tell a planet from a blended or eclipsing star on its own. Nothing here is a confirmed planet unless it is already in the NASA Exoplanet Archive.", "");
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `stellr-exoplanet-lab-tic${target.tic}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <main className="relative min-h-svh bg-void px-5 pb-24 pt-8 text-ink sm:px-8 lg:px-12">
      <div className="mx-auto max-w-[1320px]">
        <Link href="/" className="font-mono text-[11px] tracking-[0.2em] text-ink/60 transition-colors hover:text-gold">
          <ScrambleText text="← STELLR" />
        </Link>
        <h1 className="display mt-8 text-[clamp(2rem,4.4vw,4rem)] text-ink">Exoplanet Lab</h1>
        <p className="caps mt-3 max-w-[52ch] text-[12px] text-ink/60 sm:text-[13px]">
          Research other worlds: search real starlight from NASA&apos;s TESS for planets crossing their stars, and weigh what you find
          against every planet known.
        </p>

        <div className="mt-10 grid gap-6 lg:grid-cols-[380px_1fr] lg:items-start">
          {/* Catalogue */}
          <aside className="flex flex-col gap-6 lg:sticky lg:top-6">
            <section className="frame bg-void/70 p-5">
              <p className="font-mono text-[10px] tracking-[0.22em] text-ink/50">KNOWN WORLDS · NASA EXOPLANET ARCHIVE</p>
              {catLoad === "ready" ? (
                <>
                  <p className="mt-3 font-mono text-3xl text-ink">{catalog.length.toLocaleString("en")}</p>
                  <p className="font-mono text-[10px] tracking-[0.18em] text-ink/45">CONFIRMED PLANETS · HOW THEY WERE FOUND</p>
                  <ul className="mt-4 space-y-2">
                    {counts.slice(0, 5).map(([m, n]) => (
                      <li key={m} className="font-mono text-[10px] tracking-[0.12em]" title={`${n.toLocaleString("en")} planets`}>
                        <div className="flex justify-between text-ink/70">
                          <span>{m.toUpperCase()}</span>
                          <span className="tabular-nums">{n.toLocaleString("en")}</span>
                        </div>
                        <div className="mt-1 h-1.5 w-full rounded-full bg-ink/10">
                          <div className="h-1.5 rounded-full bg-gold" style={{ width: `${(n / counts[0][1]) * 100}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mt-3 font-mono text-[11px] tracking-[0.16em] text-ink/55">
                  {catLoad === "loading" ? "READING THE ARCHIVE…" : "THE ARCHIVE DIDN'T ANSWER. TRY AGAIN SHORTLY."}
                  {catDetail && <span className="mt-2 block text-[9px] normal-case tracking-[0.06em] text-ink/35">{catDetail}</span>}
                </p>
              )}
            </section>

            <section className="frame bg-void/70 p-5">
              <label htmlFor="planet-search" className="sr-only">
                Find a planet or star
              </label>
              <input
                id="planet-search"
                type="search"
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="FIND A PLANET OR STAR"
                className="h-9 w-full rounded-full border border-ink/25 bg-void px-4 font-mono text-[11px] tracking-[0.12em] text-ink outline-none placeholder:text-ink/35 focus:border-ink/60"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {(["all", "Transit", "Radial Velocity", "other"] as Method[]).map((m) => (
                  <button key={m} type="button" onClick={() => setMethod(m)} className={chip(method === m)}>
                    {m === "all" ? "ALL" : m === "Radial Velocity" ? "WOBBLE" : m.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["newest", "nearest", "smallest"] as Sort[]).map((s) => (
                  <button key={s} type="button" onClick={() => setSort(s)} className={chip(sort === s)}>
                    {s.toUpperCase()}
                  </button>
                ))}
              </div>
              <ul className="mt-3 max-h-[46svh] divide-y divide-ink/10 overflow-y-auto pr-1">
                {shown.slice(0, LIST_LIMIT).map((p) => (
                  <li key={p.name}>
                    <button
                      type="button"
                      onClick={() => setPicked(p)}
                      className={`flex w-full items-baseline justify-between gap-3 py-2.5 text-left font-mono transition-colors ${
                        picked?.name === p.name ? "text-gold" : "text-ink/85 hover:text-gold"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] tracking-[0.04em]">{p.name}</span>
                        <span className="mt-0.5 block text-[10px] tracking-[0.12em] text-ink/45">
                          {p.method.toUpperCase()} · {p.year ?? "—"}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-[10px] tracking-[0.1em] text-ink/55">
                        {sort === "nearest" ? fmtNum(p.distance ? p.distance * 3.2616 : null, 1, " LY") : p.radius ? `${fmtNum(p.radius, 2)} R⊕` : p.period ? `${fmtNum(p.period, 2)} D` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {catLoad === "ready" && (
                <p className="mt-3 font-mono text-[10px] tracking-[0.14em] text-ink/40">
                  {shown.length > LIST_LIMIT ? `FIRST ${LIST_LIMIT} OF ${shown.length.toLocaleString("en")} · SEARCH TO NARROW` : `${shown.length.toLocaleString("en")} SHOWN`} · R⊕ = EARTH RADII
                </p>
              )}
            </section>

            {picked && (
              <section className="frame bg-void/70 p-5">
                <p className="font-mono text-[10px] tracking-[0.22em] text-ink/50">
                  {picked.method.toUpperCase()} · {picked.year ?? "—"}
                </p>
                <h2 className="display mt-3 text-2xl text-ink">{picked.name}</h2>
                <p className="mt-1 font-mono text-[10px] tracking-[0.14em] text-ink/45">ORBITS {picked.host.toUpperCase()}{picked.facility ? ` · FOUND BY ${picked.facility.toUpperCase()}` : ""}</p>
                <dl className="mt-4 grid grid-cols-2 gap-4">
                  <Fact label="ONE ORBIT" value={fmtNum(picked.period, picked.period && picked.period < 10 ? 3 : 1, " DAYS")} />
                  <Fact label="SIZE" value={fmtNum(picked.radius, 2, " × EARTH")} sub="RADIUS" />
                  <Fact label="MASS" value={fmtNum(picked.mass, 1, " × EARTH")} />
                  <Fact label="TEMPERATURE" value={picked.temp ? `${Math.round(picked.temp - 273)} °C` : "—"} sub="IF IT WERE A BARE ROCK" />
                  <Fact label="DISTANCE" value={fmtNum(picked.distance ? picked.distance * 3.2616 : null, 1, " LIGHT-YEARS")} />
                  <Fact label="ITS STAR" value={picked.starTemp ? `${Math.round(picked.starTemp).toLocaleString("en")} K` : "—"} sub={picked.starRadius ? `${picked.starRadius} × THE SUN'S SIZE` : undefined} />
                </dl>
                {picked.tic ? (
                  <button
                    type="button"
                    onClick={() => analyse(picked)}
                    className="mt-5 rounded-full bg-ink px-5 py-2.5 font-mono text-[11px] font-semibold tracking-[0.12em] text-void transition-colors hover:bg-gold"
                  >
                    ANALYSE ITS STAR&apos;S LIGHT →
                  </button>
                ) : (
                  <p className="caps mt-4 text-[11px] text-ink/50">No TESS catalogue number for this star, so no light curve to analyse here.</p>
                )}
              </section>
            )}
          </aside>

          {/* Workspace */}
          <div id="lab-workspace" className="flex scroll-mt-6 flex-col gap-6">
            <Section step="01" title="TARGET STAR">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1">
                  {target ? (
                    <>
                      <p className="display text-2xl text-ink">{target.label}</p>
                      <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-ink/45">
                        TIC {target.tic}
                        {known.length ? ` · ${known.length} KNOWN PLANET${known.length > 1 ? "S" : ""}` : " · NO KNOWN PLANETS"}
                        {star?.starRadius ? ` · ${star.starRadius} × THE SUN'S SIZE` : ""}
                      </p>
                    </>
                  ) : (
                    <p className="caps text-[12px] leading-relaxed text-ink/65">
                      Pick a planet in the catalogue and analyse its star, start from one below, or enter any star&apos;s TESS Input Catalog
                      number.
                    </p>
                  )}
                </div>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const n = tic(ticInput);
                    if (/^\d{1,12}$/.test(n)) {
                      const host = catalog.find((p) => p.tic && tic(p.tic) === n)?.host ?? null;
                      loadTarget({ tic: n, label: host ?? `TIC ${n}`, host });
                    }
                  }}
                >
                  <label htmlFor="tic-input" className="sr-only">
                    TESS Input Catalog number
                  </label>
                  <input
                    id="tic-input"
                    inputMode="numeric"
                    value={ticInput}
                    onChange={(e) => setTicInput(e.target.value)}
                    placeholder="TIC NUMBER"
                    className="h-9 w-40 rounded-full border border-ink/25 bg-void px-4 font-mono text-[11px] tracking-[0.12em] text-ink outline-none placeholder:text-ink/35 focus:border-ink/60"
                  />
                  <button type="submit" className="h-9 rounded-full border border-ink/25 px-4 font-mono text-[10px] tracking-[0.18em] text-ink/80 hover:border-ink/60">
                    LOAD
                  </button>
                </form>
              </div>
              {!target && suggestions.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] tracking-[0.2em] text-ink/40">TRY</span>
                  {suggestions.map((p) => (
                    <button key={p.name} type="button" onClick={() => analyse(p)} className={chip(false)}>
                      {p.host.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
            </Section>

            {target && (
              <Section
                step="02"
                title="LIGHT CURVE · TESS"
                aside={
                  curve && (
                    <span className="font-mono text-[10px] tracking-[0.14em] text-ink/45">
                      {curve.t.length.toLocaleString("en")} POINTS · {Math.round(curve.t[curve.t.length - 1] - curve.t[0])} DAYS
                    </span>
                  )
                }
              >
                {sectorLoad === "loading" && <p className="font-mono text-[11px] tracking-[0.16em] text-ink/55">ASKING MAST WHICH SECTORS TESS OBSERVED…</p>}
                {sectorLoad === "error" && (
                  <p className="font-mono text-[11px] tracking-[0.16em] text-ink/55">
                    MAST DIDN&apos;T ANSWER. TRY AGAIN SHORTLY.
                    {detail && <span className="mt-2 block text-[9px] normal-case tracking-[0.06em] text-ink/35">{detail}</span>}
                  </p>
                )}
                {sectorLoad === "ready" && !sectors.length && (
                  <p className="caps text-[12px] text-ink/60">TESS has no light curve for this star yet: it may not have been observed, or only in full-frame images without a pipeline light curve.</p>
                )}
                {sectors.length > 0 && (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px] tracking-[0.2em] text-ink/40">SECTORS</span>
                      {sectors.map((s) => {
                        const on = chosen.includes(s.sector);
                        return (
                          <button
                            key={s.sector}
                            type="button"
                            title={`${s.pipeline}, ${s.cadence}-second cadence`}
                            onClick={() => setChosen(on ? chosen.filter((x) => x !== s.sector) : [...chosen, s.sector].sort((a, b) => a - b))}
                            className={chip(on)}
                          >
                            {s.sector}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 font-mono text-[10px] tracking-[0.12em] text-ink/40">
                      EACH SECTOR IS ~27 DAYS OF WATCHING. MORE SECTORS FIND LONGER PERIODS AND SHALLOWER DIPS, BUT SEARCH SLOWER.
                    </p>
                  </>
                )}
                {curveLoad === "loading" && <p className="mt-4 font-mono text-[11px] tracking-[0.16em] text-ink/55">DOWNLOADING AND READING THE LIGHT CURVES FROM MAST…</p>}
                {curveLoad === "error" && (
                  <p className="mt-4 font-mono text-[11px] tracking-[0.16em] text-ink/55">
                    COULDN&apos;T READ THE LIGHT CURVE.
                    {detail && <span className="mt-2 block text-[9px] normal-case tracking-[0.06em] text-ink/35">{detail}</span>}
                  </p>
                )}
                {curve && curveLoad === "ready" && (
                  <div className="mt-4">
                    <p className="font-mono text-[10px] tracking-[0.14em] text-ink/45">
                      THE STAR&apos;S BRIGHTNESS OVER TIME, 1 = ITS USUAL LEVEL{found.length ? " · GOLD LINES: TRANSITS FOUND" : ""}
                    </p>
                    <Plot
                      layers={curveLayers}
                      markers={transitMarks}
                      height={240}
                      xLabel="DAYS (BTJD)"
                      yLabel="BRIGHTNESS"
                      formatX={(v) => v.toFixed(0)}
                      formatY={(v) => v.toFixed(3)}
                      ariaLabel={`Light curve of ${target.label}: brightness over ${Math.round(curve.t[curve.t.length - 1] - curve.t[0])} days`}
                      tooltip={(x) => {
                        let lo = 0;
                        let hi = curve.t.length - 1;
                        while (hi - lo > 1) {
                          const m = (lo + hi) >> 1;
                          if (curve.t[m] < x) lo = m;
                          else hi = m;
                        }
                        const i = Math.abs(curve.t[lo] - x) < Math.abs(curve.t[hi] - x) ? lo : hi;
                        return Math.abs(curve.t[i] - x) > 0.2 ? null : `DAY ${curve.t[i].toFixed(2)} · ${curve.f[i].toFixed(5)}`;
                      }}
                    />
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        disabled={searching !== null}
                        onClick={() => search([])}
                        className="rounded-full bg-ink px-5 py-2.5 font-mono text-[11px] font-semibold tracking-[0.12em] text-void transition-colors hover:bg-gold disabled:opacity-60"
                      >
                        {searching !== null ? `SEARCHING… ${Math.round(searching * 100)}%` : signals.length ? "SEARCH AGAIN FROM SCRATCH" : "SEARCH FOR TRANSITS →"}
                      </button>
                      <span className="font-mono text-[10px] tracking-[0.12em] text-ink/40">BOX LEAST SQUARES · RUNS IN YOUR BROWSER</span>
                    </div>
                    {searchError && <p className="mt-2 font-mono text-[10px] text-gold">{searchError}</p>}
                  </div>
                )}
              </Section>
            )}

            {latest && periodogram && (
              <Section step="03" title="PERIOD SEARCH" aside={<span className="font-mono text-[10px] tracking-[0.14em] text-ink/45">SEARCH {signals.length}</span>}>
                <p className="font-mono text-[10px] tracking-[0.14em] text-ink/45">
                  HOW WELL A REPEATING DIP FITS AT EACH TRIAL PERIOD · GOLD: BEST · DASHED: KNOWN PLANETS
                </p>
                <Plot
                  layers={pgLayers}
                  markers={pgMarks}
                  height={200}
                  xLog
                  xDomain={[periodogram.periods[periodogram.periods.length - 1], periodogram.periods[0]]}
                  yDomain={[0, 1.08]}
                  xLabel="PERIOD (DAYS)"
                  yLabel="POWER"
                  formatX={(v) => (v < 1 ? v.toFixed(1) : v.toFixed(0))}
                  formatY={(v) => v.toFixed(1)}
                  ariaLabel={`Periodogram: strongest period ${periodogram.period.toFixed(3)} days`}
                  tooltip={(x) => {
                    const p = periodogram.periods;
                    let best = 0;
                    for (let i = 1; i < p.length; i++) if (Math.abs(p[i] - x) < Math.abs(p[best] - x)) best = i;
                    const max = Math.max(...periodogram.power);
                    return `${p[best].toFixed(3)} D · POWER ${(periodogram.power[best] / max).toFixed(2)}`;
                  }}
                />
              </Section>
            )}

            {latest && latestVerdict && (
              <Section step="04" title="RESULT">
                <p
                  className={`font-mono text-[12px] tracking-[0.18em] ${
                    latestVerdict.kind === "candidate" ? "text-gold" : latestVerdict.kind === "known" || latestVerdict.kind === "alias" ? "text-ink" : "text-ink/60"
                  }`}
                >
                  {latestVerdict.kind === "candidate" ? "◆ " : latestVerdict.kind === "known" ? "✓ " : latestVerdict.kind === "none" ? "○ " : "! "}
                  {latestVerdict.title}
                </p>
                {latest.result && latestVerdict.kind !== "none" && fold && (
                  <>
                    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] tracking-[0.14em] text-ink/55">
                      <span>
                        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-ink/40 align-middle" />
                        EVERY POINT, FOLDED
                      </span>
                      <span>
                        <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-ink align-middle" />
                        AVERAGED
                      </span>
                      <span>
                        <span className="mr-1.5 inline-block h-0.5 w-4 bg-gold align-middle" />
                        BOX MODEL
                      </span>
                    </div>
                    <Plot
                      layers={fold.layers}
                      height={230}
                      xDomain={[-fold.window, fold.window]}
                      yDomain={fold.y}
                      xLabel="HOURS FROM MID-TRANSIT"
                      yLabel="BRIGHTNESS"
                      formatX={(v) => (v > 0 ? `+${v}` : String(v))}
                      formatY={(v) => v.toFixed(4)}
                      ariaLabel={`Every transit folded on top of each other: a dip of ${depthText(latest.result.depth)} lasting ${latest.result.duration.toFixed(1)} hours`}
                      tooltip={(x) => {
                        const { x: bx, y: by } = fold.bins;
                        if (!bx.length) return null;
                        let best = 0;
                        for (let i = 1; i < bx.length; i++) if (Math.abs(bx[i] - x) < Math.abs(bx[best] - x)) best = i;
                        return `${bx[best].toFixed(1)} H · AVERAGE ${by[best].toFixed(5)}`;
                      }}
                    />
                    <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <Fact label="PERIOD" value={`${latest.result.period.toFixed(4)} D`} sub="ONE ORBIT" />
                      <Fact label="DEPTH" value={depthText(latest.result.depth)} sub="DIMMING IN TRANSIT" />
                      <Fact label="DURATION" value={`${latest.result.duration.toFixed(1)} H`} sub="EDGE TO EDGE" />
                      <Fact
                        label="SIZE"
                        value={radiusEarth(latest.result.depth) ? `≈ ${radiusEarth(latest.result.depth)!.toFixed(1)} × EARTH` : "—"}
                        sub={star?.starRadius ? "FROM DEPTH AND STAR SIZE" : "STAR SIZE UNKNOWN"}
                      />
                      <Fact label="SNR" value={latest.result.snr.toFixed(1)} sub="SIGNAL OVER NOISE" />
                      <Fact label="SDE" value={latest.result.sde.toFixed(1)} sub="PEAK ABOVE THE REST" />
                      <Fact label="TRANSITS" value={String(latest.result.transits)} sub="WITH DATA IN THEM" />
                      <Fact label="MID-TRANSIT" value={latest.result.t0.toFixed(3)} sub="BTJD" />
                    </dl>
                  </>
                )}
                <ul className="mt-5 space-y-2">
                  {latestVerdict.notes.map((n) => (
                    <li key={n} className="caps text-[11px] leading-relaxed text-ink/65">
                      {n}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {latest?.result && latest.checks && latestVerdict && latestVerdict.kind !== "none" && (
              <Section step="05" title="CHECKS">
                <ul className="space-y-3 font-mono text-[11px] tracking-[0.08em]">
                  {(() => {
                    const c = latest.checks!;
                    const oe = Math.abs(c.odd.depth - c.even.depth) / Math.hypot(c.odd.err, c.even.err);
                    const sec = c.secondary.depth / c.secondary.err;
                    const rows: [boolean, string, string][] = [
                      [oe <= 3, "ODD AND EVEN TRANSITS MATCH", `${depthText(c.odd.depth)} vs ${depthText(c.even.depth)} · ${oe.toFixed(1)}σ apart`],
                      [sec <= 3, "NO SECONDARY ECLIPSE", `${depthText(Math.max(c.secondary.depth, 0))} at half an orbit · ${Math.max(sec, 0).toFixed(1)}σ`],
                      [latest.result!.depth <= 0.03, "SHALLOW ENOUGH FOR A PLANET", depthText(latest.result!.depth)],
                      [latest.result!.transits >= 3, "THREE OR MORE TRANSITS", `${latest.result!.transits} seen`],
                    ];
                    return rows.map(([ok, label, value]) => (
                      <li key={label} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink/10 pb-2">
                        <span className={ok ? "text-ink" : "text-gold"}>
                          {ok ? "✓" : "✗"} {label}
                        </span>
                        <span className="text-[10px] text-ink/50">{value}</span>
                      </li>
                    ));
                  })()}
                </ul>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={searching !== null}
                    onClick={() => search(signals)}
                    className="rounded-full border border-ink/30 px-5 py-2.5 font-mono text-[10px] tracking-[0.16em] text-ink/85 transition-colors hover:border-ink/70 disabled:opacity-50"
                  >
                    HIDE THIS SIGNAL · LOOK FOR ANOTHER →
                  </button>
                  <button
                    type="button"
                    onClick={report}
                    className="rounded-full border border-gold/60 px-5 py-2.5 font-mono text-[10px] tracking-[0.16em] text-gold transition-colors hover:bg-gold hover:text-void"
                  >
                    DOWNLOAD REPORT (.MD)
                  </button>
                </div>
              </Section>
            )}

            {signals.length > 1 && (
              <Section step="06" title="THIS INVESTIGATION">
                <ol className="space-y-2 font-mono text-[11px] tracking-[0.08em]">
                  {signals.map((s, i) => (
                    <li key={i} className="flex flex-wrap justify-between gap-2 border-b border-ink/10 pb-2">
                      <span className="text-ink/80">
                        {i + 1}. {verdict(s, known).title}
                      </span>
                      <span className="text-[10px] text-ink/50">
                        {s.result ? `${s.result.period.toFixed(3)} D · ${depthText(s.result.depth)} · SNR ${s.result.snr.toFixed(0)}` : "—"}
                      </span>
                    </li>
                  ))}
                </ol>
              </Section>
            )}

            <p className="font-mono text-[10px] leading-relaxed tracking-[0.14em] text-ink/40">
              CATALOGUE FROM THE NASA EXOPLANET ARCHIVE · LIGHT CURVES FROM NASA&apos;S TESS MISSION VIA MAST (SPOC PIPELINE) · THE SEARCH RUNS IN YOUR
              BROWSER. A SIGNAL HERE IS NOT A CONFIRMED PLANET.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
