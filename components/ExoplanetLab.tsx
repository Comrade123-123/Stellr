"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Plot, { type Layer, type Marker } from "@/components/charts/Plot";
import PlanetPortrait from "@/components/PlanetPortrait";
import ScrambleText from "@/components/ui/ScrambleText";
import {
  BTJD,
  CATALOG_FIELDS,
  EARTH_PER_SUN,
  MAX_PLANET_RADIUS,
  fromTransit,
  longestTransit,
  planetFromRow,
  relation,
  type BlsResult,
  type Checks,
  type Curve,
  type Planet,
} from "@/lib/exoplanets";
import { planetScore, vetFeatures, type StarParams, type VetterModel } from "@/lib/vetter";
import { describe, KIND_LABEL, radiusFromMass, transitForecast } from "@/lib/worlds";

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

/** A TESS Object of Interest on the target star, with the follow-up team's verdict. */
interface Toi {
  toi: string;
  disposition: string;
  period: number | null;
  depthPpm: number | null;
  durationH: number | null;
}

/** An investigation kept in this browser's storage. */
interface Saved {
  id: string;
  tic: string;
  label: string;
  host: string | null;
  at: string;
  findings: { title: string; period: number | null; depth: number | null; score: number | null }[];
}
const SAVED_KEY = "stellr.exoplanet-lab.investigations";
function readSaved(): Saved[] {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]");
    return Array.isArray(v) ? (v as Saved[]) : [];
  } catch {
    return [];
  }
}
function writeSaved(list: Saved[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 50)));
    return true;
  } catch {
    return false;
  }
}

const DISPOSITIONS: Record<string, string> = {
  CP: "confirmed planet",
  KP: "known planet",
  PC: "planet candidate",
  APC: "ambiguous planet candidate",
  FP: "false positive",
  FA: "false alarm",
};

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
function verdict(s: Signal, known: Planet[], tois: Toi[] = [], starRadius: number | null = null) {
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
  const toi = tois.find((x) => x.period && relation(r.period, x.period) === "same period");
  if (toi && (toi.disposition === "CP" || toi.disposition === "KP")) {
    return { kind: "known" as const, title: `KNOWN PLANET RECOVERED · TOI-${toi.toi}`, notes: [`Same period as TOI-${toi.toi}, which the TESS follow-up team lists as a ${DISPOSITIONS[toi.disposition]}.`] };
  }
  if (toi && (toi.disposition === "FP" || toi.disposition === "FA")) notes.push(`The TESS follow-up team has already ruled this signal out: TOI-${toi.toi}, a ${DISPOSITIONS[toi.disposition]}.`);
  const oe = Math.abs(c.odd.depth - c.even.depth) / Math.hypot(c.odd.err, c.even.err);
  if (c.odd.n && c.even.n && oe > 3) notes.push("Odd and even transits differ in depth: the mark of an eclipsing binary star at half its true period.");
  if (c.secondary.n && c.secondary.depth / c.secondary.err > 3) notes.push("A dip half an orbit later (a secondary eclipse): a glowing companion star, not a planet.");
  if (r.depth > 0.03) notes.push("Over 3% deep: more likely a small star than a planet.");
  if (c.shape.core > 0 && c.shape.edge < 0.5 * c.shape.core && (c.shape.core - c.shape.edge) / c.shape.err > 3)
    notes.push("V-shaped rather than flat-bottomed: typical of two stars grazing each other.");
  if (starRadius) {
    const longest = longestTransit(r.period, starRadius);
    if (r.duration > 1.5 * longest) notes.push(`Lasts ${r.duration.toFixed(1)} h, longer than a planet's transit can across this star (about ${longest.toFixed(1)} h at most).`);
    if (Math.sqrt(r.depth) * starRadius * EARTH_PER_SUN > MAX_PLANET_RADIUS) notes.push("Too large for a planet: over twice Jupiter's size for this star.");
  }
  if (r.transits < 3) notes.push("Fewer than three transits: the period is uncertain.");
  if (notes.length) return { kind: "doubt" as const, title: "SIGNAL · PROBABLY NOT A PLANET", notes };
  if (toi) {
    return {
      kind: "toi" as const,
      title: `ALREADY UNDER STUDY · TOI-${toi.toi}`,
      notes: [`The TESS team flagged this same signal as TOI-${toi.toi}, now a ${DISPOSITIONS[toi.disposition] ?? (toi.disposition || "signal under review")}. Follow-up observations decide whether it is a planet.`],
    };
  }
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
  const [model, setModel] = useState<VetterModel | null>(null);
  const [modelLoad, setModelLoad] = useState<Load>("loading");
  const [tois, setTois] = useState<Toi[]>([]);
  /** The target in the TESS Input Catalog: known for any star TESS watched, not only planet hosts. */
  const [ticStar, setTicStar] = useState<(StarParams & { tmag: number | null; mass: number | null }) | null>(null);
  /** Investigations kept in this browser: what was found, not the data, which reloads from MAST. */
  const [saved, setSaved] = useState<Saved[]>([]);
  const [savedNote, setSavedNote] = useState("");

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
    // Browser storage exists only after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaved(readSaved());
    // The vetter, trained in GitHub Actions on NASA's Kepler and TESS signals.
    fetch("/models/vetter.json")
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        setModel((await res.json()) as VetterModel);
        setModelLoad("ready");
      })
      .catch(() => setModelLoad("error"));
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
  const starRadius = ticStar?.radius ?? star?.starRadius ?? null;
  const starParams: StarParams = { radius: starRadius, teff: ticStar?.teff ?? star?.starTemp ?? null, logg: ticStar?.logg ?? null };

  const loadTarget = useCallback((t: Target) => {
    setTarget(t);
    setSectors([]);
    setChosen([]);
    setCurve(null);
    setSignals([]);
    setSearchError("");
    setDetail("");
    setSectorLoad("loading");
    setTois([]);
    setTicStar(null);
    fetch(`/api/exoplanets/star?tic=${t.tic}`)
      .then(async (res) => {
        const data = (await res.json()) as { star?: (StarParams & { tmag: number | null; mass: number | null }) | null };
        if (res.ok && data.star) setTicStar(data.star);
      })
      .catch(() => {});
    fetch(`/api/exoplanets/toi?tic=${t.tic}`)
      .then(async (res) => {
        const data = (await res.json()) as { tois?: Toi[] };
        if (res.ok && data.tois) setTois(data.tois);
      })
      .catch(() => {});
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
  const judge = (s: Signal) => verdict(s, known, tois, starRadius);
  const latestVerdict = latest ? judge(latest) : null;
  const found = signals.filter((s) => s.result && judge(s).kind !== "none");
  const score = (s: Signal) => {
    if (!model || !s.result) return null;
    const x = vetFeatures(s.result.period, s.result.duration, s.result.depth, starParams);
    return x ? planetScore(model, x) : null;
  };

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

  const radiusEarth = (d: number) => (starRadius ? Math.sqrt(d) * starRadius * EARTH_PER_SUN : null);
  /** Every confirmed planet with a size and an orbit, for the size–orbit chart. */
  const worldLayer = useMemo<Layer>(() => {
    const w = catalog.filter((p) => p.radius && p.period);
    return { kind: "points", x: w.map((p) => p.period!), y: w.map((p) => p.radius!), color: DIM, size: 2 };
  }, [catalog]);

  const report = () => {
    if (!target || !curve) return;
    const lines: string[] = [];
    const now = new Date().toISOString().replace("T", " ").slice(0, 16);
    lines.push(`# Exoplanet Lab report: ${target.label} (TIC ${target.tic})`, "", `Generated by Stellr Exoplanet Lab, ${now} UTC.`, "");
    lines.push("## Data", "");
    for (const s of sectors.filter((x) => chosen.includes(x.sector))) lines.push(`- TESS sector ${s.sector}: ${s.pipeline} pipeline, ${s.cadence}-second cadence, MAST observation ${s.obsid}`);
    lines.push(`- ${curve.t.length.toLocaleString("en")} points after quality filtering and 10-minute binning (PDCSAP flux, normalised)`, "");
    lines.push("## Method", "", "- Flattened with a ±0.5-day running median; bright outliers (>4σ) removed.", "- Box Least Squares search, periods 0.4 d to half the baseline (max 30 d), durations 0.75–12 h.", `- Detection bar: SDE ≥ ${MIN_SDE} and SNR ≥ ${MIN_SNR}. Earlier signals masked before each new search.`, "");
    lines.push("## TESS Objects of Interest on this star", "");
    if (tois.length) for (const x of tois) lines.push(`- TOI-${x.toi}: period ${fmtNum(x.period, 5)} d, ${DISPOSITIONS[x.disposition] ?? (x.disposition || "no disposition")}`);
    else lines.push("- None listed.");
    lines.push("");
    lines.push("## Known planets of this star (NASA Exoplanet Archive)", "");
    if (known.length) for (const k of known) lines.push(`- ${k.name}: period ${fmtNum(k.period, 5)} d, radius ${fmtNum(k.radius)} R⊕, found ${k.year ?? "?"} by ${k.method}`);
    else lines.push("- None listed.");
    lines.push("");
    signals.forEach((s, i) => {
      const v = judge(s);
      lines.push(`## Search ${i + 1}: ${v.title}`, "");
      if (s.result && s.checks) {
        const r = s.result;
        const c = s.checks;
        const rad = radiusEarth(r.depth);
        lines.push(
          `- Period: ${r.period.toFixed(5)} d`,
          `- Mid-transit: BTJD ${r.t0.toFixed(4)} (BJD ${(r.t0 + BTJD).toFixed(4)})`,
          `- Duration: ${r.duration.toFixed(2)} h`,
          `- Depth: ${depthText(r.depth)}${rad ? ` (radius ≈ ${rad.toFixed(1)} R⊕ for a star of ${starRadius!.toFixed(2)} R☉)` : ""}`,
          `- SNR ${r.snr.toFixed(1)}, SDE ${r.sde.toFixed(1)}, ${r.transits} transits with data`,
          `- Odd vs even depth: ${depthText(c.odd.depth)} ± ${depthText(c.odd.err)} vs ${depthText(c.even.depth)} ± ${depthText(c.even.err)}`,
          `- Secondary eclipse (phase 0.5): ${depthText(Math.max(c.secondary.depth, 0))} ± ${depthText(c.secondary.err)}`,
          `- Shape: edges ${depthText(Math.max(c.shape.edge, 0))} vs middle ${depthText(Math.max(c.shape.core, 0))} deep`,
          ...(score(s) !== null && model
            ? [`- ML vetter: ${Math.round(score(s)! * 100)}% planet-like (gradient-boosted trees trained ${model.trained}; AUC on unseen TESS signals ${model.metrics.tess?.auc ?? "n/a"})`]
            : []),
        );
      }
      for (const n of v.notes) lines.push(`- ${n}`);
      lines.push("");
    });
    if (latest?.result && starRadius && starParams.teff && radiusEarth(latest.result.depth)) {
      const d = describe({ radiusEarth: radiusEarth(latest.result.depth)!, period: latest.result.period, starRadius, starTeff: starParams.teff, starMass: ticStar?.mass ?? null });
      lines.push(
        "## What the latest signal would be like",
        "",
        `- Kind by size: ${KIND_LABEL[d.kind]} (${radiusEarth(latest.result.depth)!.toFixed(1)} R⊕)`,
        `- Orbit: ${d.au.toFixed(3)} AU; starlight ${d.insolation.toFixed(2)} × Earth's; equilibrium temperature ${Math.round(d.teq)} K (albedo 0.3)`,
        `- Habitable zone (Kopparapu et al. 2014, conservative): ${d.zone.innerAu.toFixed(2)}–${d.zone.outerAu.toFixed(2)} AU; ${d.inZone ? "inside" : "outside"}`,
        "",
      );
    }
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
          <aside className="flex flex-col gap-6">
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
                  <Fact label="SIZE" value={fmtNum(picked.radius, 2, " × EARTH")} sub={picked.method === "Transit" ? "RADIUS" : picked.radius ? "ESTIMATED, NOT MEASURED" : "UNKNOWN: NO TRANSIT"} />
                  <Fact label="MASS" value={fmtNum(picked.mass, 1, " × EARTH")} />
                  <Fact label="TEMPERATURE" value={picked.temp ? `${Math.round(picked.temp - 273)} °C` : "—"} sub="IF IT WERE A BARE ROCK" />
                  <Fact label="DISTANCE" value={fmtNum(picked.distance ? picked.distance * 3.2616 : null, 1, " LIGHT-YEARS")} />
                  <Fact label="ITS STAR" value={picked.starTemp ? `${Math.round(picked.starTemp).toLocaleString("en")} K` : "—"} sub={picked.starRadius ? `${picked.starRadius} × THE SUN'S SIZE` : undefined} />
                </dl>
                {(() => {
                  // No transit, no measured size: forecast it from the mass, and what a transit would look like.
                  const est = !picked.radius && picked.mass ? radiusFromMass(picked.mass) : null;
                  const size = picked.radius ?? est?.radius ?? null;
                  if (!size || !picked.period || !picked.starRadius || !picked.starTemp) return null;
                  const forecast = picked.method !== "Transit" ? transitForecast({ radiusEarth: size, period: picked.period, starRadius: picked.starRadius }) : null;
                  return (
                    <div className="mt-5 border-t border-ink/10 pt-5">
                      {picked.method !== "Transit" && (
                        <p className="mb-4 font-mono text-[10px] leading-relaxed tracking-[0.14em] text-gold">
                          NO TRANSIT, SO NO MEASURED SIZE ·{" "}
                          {est
                            ? `PREDICTED FROM ITS MASS: ≈ ${est.radius.toFixed(1)} × EARTH (${est.low.toFixed(1)}–${est.high.toFixed(1)})`
                            : "THE ARCHIVE'S SIZE IS ITSELF AN ESTIMATE FROM ITS MASS"}
                          {picked.method === "Radial Velocity" ? " · ITS MASS IS A MINIMUM, SO IT MAY BE LARGER" : ""}
                        </p>
                      )}
                      <PlanetPortrait
                        compact
                        name={picked.name}
                        radiusEarth={size}
                        period={picked.period}
                        starRadius={picked.starRadius}
                        starTeff={picked.starTemp}
                        seed={Math.round(picked.period * 1000)}
                        sizeNote={picked.method !== "Transit" ? "SIZE ESTIMATED FROM MASS" : undefined}
                      />
                      {forecast && (
                        <div className="mt-5 border-t border-ink/10 pt-4">
                          <p className="font-mono text-[10px] tracking-[0.2em] text-ink/50">IF ITS ORBIT LINES UP WITH US</p>
                          <dl className="mt-3 grid grid-cols-2 gap-4">
                            <Fact label="CHANCE" value={forecast.chance < 0.01 ? `${(forecast.chance * 100).toFixed(2)}%` : `${(forecast.chance * 100).toFixed(1)}%`} sub="THAT IT TRANSITS" />
                            <Fact label="DIMMING" value={depthText(forecast.depth)} sub="OF ITS STAR" />
                            <Fact label="LASTING" value={`UP TO ${forecast.hours.toFixed(1)} H`} />
                            <Fact label="EVERY" value={fmtNum(picked.period, picked.period < 10 ? 2 : 0, " DAYS")} />
                          </dl>
                          <p className="caps mt-3 text-[11px] leading-relaxed text-ink/50">
                            {picked.period > 200
                              ? "Its orbit is longer than TESS usually watches a star, so even a transit would be hard to catch."
                              : forecast.chance < 0.02
                                ? "Unlikely, but worth a look: a transit would give its true size."
                                : "Worth a look: a transit would give its true size."}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })()}
                {picked.tic ? (
                  <button
                    type="button"
                    onClick={() => analyse(picked)}
                    className="mt-5 rounded-full bg-ink px-5 py-2.5 font-mono text-[11px] font-semibold tracking-[0.12em] text-void transition-colors hover:bg-gold"
                  >
                    {picked.method === "Transit" ? "ANALYSE ITS STAR'S LIGHT →" : "LOOK FOR IT IN TESS DATA →"}
                  </button>
                ) : (
                  <p className="caps mt-4 text-[11px] text-ink/50">No TESS catalogue number for this star, so no light curve to analyse here.</p>
                )}
              </section>
            )}

            {saved.length > 0 && (
              <section className="frame bg-void/70 p-5">
                <p className="font-mono text-[10px] tracking-[0.22em] text-ink/50">YOUR INVESTIGATIONS · KEPT IN THIS BROWSER</p>
                <ul className="mt-3 divide-y divide-ink/10">
                  {saved.map((v) => (
                    <li key={v.id} className="flex items-start justify-between gap-3 py-2.5 font-mono">
                      <button type="button" onClick={() => loadTarget({ tic: v.tic, label: v.label, host: v.host })} className="min-w-0 text-left text-ink/85 transition-colors hover:text-gold">
                        <span className="block truncate text-[12px] tracking-[0.04em]">{v.label}</span>
                        <span className="mt-0.5 block text-[10px] tracking-[0.1em] text-ink/45">
                          {v.at} · {v.findings.length} SEARCH{v.findings.length === 1 ? "" : "ES"}
                          {v.findings[0] ? ` · ${v.findings[0].title}` : ""}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Forget ${v.label}`}
                        onClick={() => {
                          const next = saved.filter((x) => x.id !== v.id);
                          setSaved(next);
                          writeSaved(next);
                        }}
                        className="shrink-0 text-[12px] text-ink/40 hover:text-gold"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 font-mono text-[10px] tracking-[0.12em] text-ink/35">OPEN ONE TO RELOAD ITS STAR AND SEARCH AGAIN.</p>
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
                        {starRadius ? ` · ${starRadius.toFixed(2)} × THE SUN'S SIZE` : ""}
                        {starParams.teff ? ` · ${Math.round(starParams.teff).toLocaleString("en")} K` : ""}
                        {ticStar?.tmag ? ` · TESS MAGNITUDE ${ticStar.tmag.toFixed(1)}` : ""}
                        {tois.length ? ` · ${tois.length} TESS OBJECT${tois.length > 1 ? "S" : ""} OF INTEREST` : ""}
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
                    latestVerdict.kind === "candidate" || latestVerdict.kind === "toi" ? "text-gold" : latestVerdict.kind === "known" || latestVerdict.kind === "alias" ? "text-ink" : "text-ink/60"
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
                        sub={starRadius ? "FROM DEPTH AND STAR SIZE" : "STAR SIZE UNKNOWN"}
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
                      [
                        !(c.shape.core > 0 && c.shape.edge < 0.5 * c.shape.core && (c.shape.core - c.shape.edge) / c.shape.err > 3),
                        "FLAT-BOTTOMED, NOT V-SHAPED",
                        `edges ${depthText(Math.max(c.shape.edge, 0))} vs middle ${depthText(Math.max(c.shape.core, 0))}`,
                      ],
                    ];
                    const R = starRadius;
                    if (R) {
                      const longest = longestTransit(latest.result!.period, R);
                      const size = Math.sqrt(latest.result!.depth) * R * EARTH_PER_SUN;
                      rows.push([latest.result!.duration <= 1.5 * longest, "SHORT ENOUGH FOR AN ORBIT", `${latest.result!.duration.toFixed(1)} h · up to ~${longest.toFixed(1)} h here`]);
                      rows.push([size <= MAX_PLANET_RADIUS, "PLANET-SIZED", `≈ ${size.toFixed(1)} × Earth`]);
                    }
                    const toi = tois.find((x) => x.period && relation(latest.result!.period, x.period) === "same period");
                    if (toi) rows.push([toi.disposition !== "FP" && toi.disposition !== "FA", `TESS LISTS IT AS TOI-${toi.toi}`, DISPOSITIONS[toi.disposition] ?? (toi.disposition || "no verdict yet")]);
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

                {/* Machine-learning vetter: a score with its track record, never a verdict on its own. */}
                <div className="mt-6 border-t border-ink/10 pt-5">
                  <p className="font-mono text-[10px] tracking-[0.22em] text-ink/50">ML VETTER · HOW PLANET-LIKE IS THIS SIGNAL?</p>
                  {model && score(latest) !== null ? (
                    <>
                      <div className="mt-3 flex items-baseline gap-3">
                        <span className="font-mono text-3xl text-ink">{Math.round(score(latest)! * 100)}%</span>
                        <span className="font-mono text-[10px] tracking-[0.14em] text-ink/50">PLANET-LIKE</span>
                      </div>
                      <div className="mt-2 h-1.5 w-full max-w-[420px] rounded-full bg-ink/10" role="meter" aria-valuenow={Math.round(score(latest)! * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Planet-like score">
                        <div className="h-1.5 rounded-full bg-gold" style={{ width: `${score(latest)! * 100}%` }} />
                      </div>
                      <p className="caps mt-3 max-w-[70ch] text-[11px] leading-relaxed text-ink/55">
                        {model.version === 2 ? (
                          <>
                            Gradient-boosted trees trained on {model.counts.tess.toLocaleString("en")} TESS and {model.counts.kepler.toLocaleString("en")}{" "}
                            Kepler signals already judged planet or false positive, from the signal&apos;s period, depth and duration and the star&apos;s
                            size, temperature and gravity. On TESS stars it never saw, it ranks a real planet above a false positive{" "}
                            {Math.round(model.metrics.tess.auc * 100)}% of the time (the earlier Kepler-only version:{" "}
                            {Math.round(model.metrics.tess_previous.auc * 100)}%).
                            {model.metrics.tess.auc < 0.75
                              ? " Still a weak hint on TESS data: weigh the checks above first."
                              : " A score to weigh with the checks above, not a verdict."}
                          </>
                        ) : (
                          <>
                            Gradient-boosted trees trained on {model.metrics.kepler.n.toLocaleString("en")} Kepler signals, from the signal&apos;s period,
                            depth and duration alone.
                            {model.metrics.tess ? ` On TESS signals it ranks a planet above a false positive ${Math.round(model.metrics.tess.auc * 100)}% of the time.` : ""}
                            {model.metrics.tess && model.metrics.tess.auc < 0.75
                              ? " It carries over poorly from Kepler to TESS, so on this data treat it as a weak hint."
                              : " A score to weigh with the checks above, not a verdict."}
                          </>
                        )}
                      </p>
                      <p className="mt-1 font-mono text-[10px] tracking-[0.12em] text-ink/35">TRAINED {model.trained} · NASA EXOPLANET ARCHIVE</p>
                    </>
                  ) : (
                    <p className="mt-3 font-mono text-[11px] tracking-[0.14em] text-ink/50">
                      {modelLoad === "loading" ? "LOADING THE MODEL…" : "THE MODEL HASN'T BEEN TRAINED YET."}
                    </p>
                  )}
                </div>

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
                  <button
                    type="button"
                    onClick={() => {
                      if (!target) return;
                      const entry: Saved = {
                        id: `${target.tic}-${Date.now()}`,
                        tic: target.tic,
                        label: target.label,
                        host: target.host,
                        at: new Date().toISOString().slice(0, 10),
                        findings: signals.map((x) => ({ title: judge(x).title, period: x.result?.period ?? null, depth: x.result?.depth ?? null, score: score(x) })),
                      };
                      const next = [entry, ...saved.filter((x) => x.tic !== target.tic)];
                      setSaved(next);
                      setSavedNote(writeSaved(next) ? "SAVED IN THIS BROWSER." : "THIS BROWSER WON'T LET THE PAGE SAVE.");
                    }}
                    className="rounded-full border border-ink/30 px-5 py-2.5 font-mono text-[10px] tracking-[0.16em] text-ink/85 transition-colors hover:border-ink/70"
                  >
                    SAVE INVESTIGATION
                  </button>
                  {savedNote && <span className="self-center font-mono text-[10px] tracking-[0.14em] text-ink/50">{savedNote}</span>}
                </div>
              </Section>
            )}

            {latest?.result && latestVerdict && latestVerdict.kind !== "none" && (
              <Section step="06" title="WHAT IT WOULD BE LIKE">
                {starRadius && starParams.teff ? (
                  <PlanetPortrait
                    name={target?.label ?? "this planet"}
                    radiusEarth={radiusEarth(latest.result.depth)!}
                    period={latest.result.period}
                    starRadius={starRadius}
                    starTeff={starParams.teff}
                    starMass={ticStar?.mass ?? null}
                    seed={Math.round(latest.result.period * 1000)}
                  />
                ) : (
                  <p className="caps text-[12px] text-ink/60">The star&apos;s size or temperature isn&apos;t known, so the planet&apos;s size and warmth can&apos;t be worked out.</p>
                )}
              </Section>
            )}

            {latest?.result && latestVerdict && latestVerdict.kind !== "none" && radiusEarth(latest.result.depth) && (
              <Section step="07" title="AMONG KNOWN WORLDS">
                <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] tracking-[0.14em] text-ink/55">
                  <span>
                    <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-ink/40 align-middle" />
                    CONFIRMED PLANETS
                  </span>
                  {known.length > 0 && (
                    <span>
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-ink align-middle" />
                      THIS STAR&apos;S KNOWN PLANETS
                    </span>
                  )}
                  <span>
                    <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-gold align-middle" />
                    THIS SIGNAL
                  </span>
                </div>
                <Plot
                  layers={[
                    worldLayer,
                    { kind: "points", x: known.filter((k) => k.radius && k.period).map((k) => k.period!), y: known.filter((k) => k.radius && k.period).map((k) => k.radius!), color: INK, size: 6 },
                    { kind: "points", x: [latest.result.period], y: [radiusEarth(latest.result.depth)!], color: GOLD, size: 10 },
                  ]}
                  height={260}
                  xLog
                  yLog
                  xDomain={[0.2, 3000]}
                  yDomain={[0.3, 30]}
                  xLabel="ORBIT (DAYS)"
                  yLabel="SIZE (× EARTH)"
                  formatX={(v) => (v < 1 ? v.toFixed(1) : String(v))}
                  formatY={(v) => (v < 1 ? v.toFixed(1) : String(v))}
                  ariaLabel={`This signal, ${radiusEarth(latest.result.depth)!.toFixed(1)} times Earth's size on a ${latest.result.period.toFixed(2)}-day orbit, among ${worldLayer.x.length} confirmed planets`}
                />
                <p className="caps mt-3 text-[11px] leading-relaxed text-ink/55">
                  Each dot a confirmed planet with a measured size. The empty band near 1.5–2 × Earth is the &ldquo;radius valley&rdquo;, and few
                  planets sit at small sizes on short orbits (the &ldquo;hot Neptune desert&rdquo;).
                </p>
              </Section>
            )}

            {signals.length > 1 && (
              <Section step="08" title="THIS INVESTIGATION">
                <ol className="space-y-2 font-mono text-[11px] tracking-[0.08em]">
                  {signals.map((s, i) => (
                    <li key={i} className="flex flex-wrap justify-between gap-2 border-b border-ink/10 pb-2">
                      <span className="text-ink/80">
                        {i + 1}. {judge(s).title}
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
