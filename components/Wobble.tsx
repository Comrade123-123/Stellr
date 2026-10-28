"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Plot from "@/components/charts/Plot";
import ScrambleText from "@/components/ui/ScrambleText";

/** The shape scripts/wobble.ts writes to public/wobble/log.json. */
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
  fold: { x: number[]; y: number[] };
}

interface Investigation {
  id: string;
  at: string;
  tic: string;
  label: string;
  reason: "candidate" | "blind";
  star: { radius: number | null; teff: number | null; tmag: number | null } | null;
  sectors: number[];
  points: number;
  days: number;
  known: string[];
  findings: Finding[];
  quiet: { sde: number; snr: number } | null;
  error?: string;
}

interface Log {
  updated: string;
  runs: { at: string; investigated: number; candidates: number }[];
  investigations: Investigation[];
}

type Filter = "all" | "candidate" | "recovered" | "doubt" | "quiet";

const FILTERS: [Filter, string][] = [
  ["all", "ALL"],
  ["candidate", "NEW CANDIDATES"],
  ["recovered", "RECOVERED"],
  ["doubt", "RULED OUT"],
  ["quiet", "QUIET STARS"],
];

const GOLD = "#c9a46a";
const INK = "rgba(236,238,242,0.85)";
const PAGE = 30;

const depthText = (d: number) => (d < 0.01 ? `${Math.round(d * 1e6).toLocaleString("en")} PPM` : `${(d * 100).toFixed(2)}%`);
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)).toUpperCase();

const matches = (i: Investigation, f: Filter) => {
  if (f === "all") return true;
  if (f === "quiet") return !i.error && i.findings.length === 0;
  if (f === "recovered") return i.findings.some((x) => x.kind === "known" || x.kind === "alias" || x.kind === "toi");
  return i.findings.some((x) => x.kind === f);
};

const tone = (kind: string) => (kind === "candidate" || kind === "toi" ? "text-gold" : kind === "known" || kind === "alias" ? "text-ink" : "text-ink/60");

function FindingCard({ f }: { f: Finding }) {
  const lo = Math.min(...f.fold.y, 1 - f.depth) - f.depth * 0.3 - 0.0003;
  const hi = Math.max(...f.fold.y, 1) + f.depth * 0.3 + 0.0003;
  const half = f.duration / 2;
  const w = f.fold.x.length ? Math.max(...f.fold.x.map(Math.abs)) : 6;
  return (
    <div className="border-t border-ink/10 pt-4">
      <p className={`font-mono text-[11px] tracking-[0.16em] ${tone(f.kind)}`}>{f.title}</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_200px]">
        <dl className="grid grid-cols-3 gap-x-4 gap-y-3 font-mono">
          {[
            ["PERIOD", `${f.period.toFixed(3)} D`],
            ["DEPTH", depthText(f.depth)],
            ["DURATION", `${f.duration.toFixed(1)} H`],
            ["SNR · SDE", `${f.snr.toFixed(0)} · ${f.sde.toFixed(0)}`],
            ["SIZE", f.radiusEarth ? `≈ ${f.radiusEarth.toFixed(1)} × EARTH` : "—"],
            ["ML VETTER", f.score === null ? "—" : `${Math.round(f.score * 100)}% PLANET-LIKE`],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-[9px] tracking-[0.2em] text-ink/40">{k}</dt>
              <dd className="mt-1 text-[12px] text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        {f.fold.x.length > 3 && (
          <Plot
            layers={[
              { kind: "points", x: f.fold.x, y: f.fold.y, color: INK, size: 3 },
              { kind: "line", x: [-w, -half, -half, half, half, w], y: [1, 1, 1 - f.depth, 1 - f.depth, 1, 1], color: GOLD },
            ]}
            height={120}
            xDomain={[-w, w]}
            yDomain={[lo, hi]}
            xLabel="HOURS"
            yLabel=""
            formatX={(v) => String(Math.round(v))}
            formatY={() => ""}
            ariaLabel={`Folded transit: ${depthText(f.depth)} deep, ${f.duration.toFixed(1)} hours`}
          />
        )}
      </div>
      {f.world && (
        <p className="mt-3 font-mono text-[10px] tracking-[0.12em] text-ink/50">
          IF A PLANET: {f.world.kind.toUpperCase()} · {f.world.teq.toLocaleString("en")} K · {f.world.insolation.toFixed(1)} × EARTH&apos;S STARLIGHT
          {f.world.inZone ? " · IN THE HABITABLE ZONE" : ""}
        </p>
      )}
      <ul className="mt-2 space-y-1">
        {f.notes.map((n) => (
          <li key={n} className="caps text-[11px] leading-relaxed text-ink/55">
            {n}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Wobble's notebook: every star the agent has investigated, newest first. */
export default function Wobble() {
  const [log, setLog] = useState<Log | null>(null);
  const [load, setLoad] = useState<"loading" | "ready" | "empty">("loading");
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    fetch("/wobble/log.json", { cache: "no-cache" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        setLog((await res.json()) as Log);
        setLoad("ready");
      })
      .catch(() => setLoad("empty"));
  }, []);

  const all = useMemo(() => log?.investigations ?? [], [log]);
  const list = useMemo(() => all.filter((i) => matches(i, filter)), [all, filter]);
  const stats = useMemo(() => {
    const findings = all.flatMap((i) => i.findings);
    return {
      stars: all.filter((i) => !i.error).length,
      signals: findings.length,
      candidates: findings.filter((f) => f.kind === "candidate").length,
      recovered: findings.filter((f) => f.kind === "known" || f.kind === "alias" || f.kind === "toi").length,
      ruledOut: findings.filter((f) => f.kind === "doubt").length,
    };
  }, [all]);

  return (
    <main className="relative min-h-svh bg-void px-5 pb-24 pt-8 text-ink sm:px-8 lg:px-12">
      <div className="mx-auto max-w-[1200px]">
        <Link href="/" className="font-mono text-[11px] tracking-[0.2em] text-ink/60 transition-colors hover:text-gold">
          <ScrambleText text="← STELLR" />
        </Link>
        <h1 className="display mt-8 text-[clamp(2rem,4.4vw,4rem)] text-ink">Wobble</h1>
        <p className="caps mt-3 max-w-[54ch] text-[12px] text-ink/60 sm:text-[13px]">
          Investigate the unknown. Stellr&apos;s research agent: every day it picks stars TESS has watched, searches their light for planets
          with Exoplanet Lab&apos;s methods, and writes down what it finds.
        </p>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_1fr]">
          <section className="frame bg-void/70 p-5">
            <p className="font-mono text-[10px] tracking-[0.22em] text-ink/50">
              NOTEBOOK{log?.updated ? ` · LAST RUN ${when(log.updated)}` : ""}
            </p>
            <dl className="mt-4 grid grid-cols-3 gap-4 font-mono sm:grid-cols-5">
              {[
                ["STARS", stats.stars],
                ["SIGNALS", stats.signals],
                ["CANDIDATES", stats.candidates],
                ["RECOVERED", stats.recovered],
                ["RULED OUT", stats.ruledOut],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[9px] tracking-[0.2em] text-ink/40">{k}</dt>
                  <dd className={`mt-1 text-2xl ${k === "CANDIDATES" && Number(v) > 0 ? "text-gold" : "text-ink"}`}>{Number(v).toLocaleString("en")}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="frame bg-void/70 p-5">
            <p className="font-mono text-[10px] tracking-[0.22em] text-ink/50">HOW IT CHOOSES</p>
            <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-ink/70">
              <li>
                <span className="font-mono text-[10px] tracking-[0.18em] text-gold">RE-EXAMINE · </span>
                TESS planet candidates still waiting for a verdict, checked again independently.
              </li>
              <li>
                <span className="font-mono text-[10px] tracking-[0.18em] text-gold">BLIND SEARCH · </span>
                stars TESS watched closely that have no known planet and no candidate, searched for anything new.
              </li>
            </ul>
            <p className="mt-3 font-mono text-[10px] tracking-[0.12em] text-ink/40">
              UP TO THREE SECTORS PER STAR · UP TO THREE SIGNALS · SAME CHECKS AND ML VETTER AS EXOPLANET LAB
            </p>
          </section>
        </div>

        <div className="mt-8 flex flex-wrap gap-2 border-b border-ink/10 pb-5">
          {FILTERS.map(([f, label]) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                setFilter(f);
                setShown(PAGE);
              }}
              className={`rounded-full border px-4 py-1.5 font-mono text-[10px] tracking-[0.2em] transition-colors ${
                filter === f ? "border-gold bg-gold text-void" : "border-ink/25 text-ink/70 hover:border-ink/60"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {load === "loading" && <p className="mt-8 font-mono text-[11px] tracking-[0.16em] text-ink/55">OPENING THE NOTEBOOK…</p>}
        {load === "empty" && <p className="mt-8 font-mono text-[11px] tracking-[0.16em] text-ink/55">WOBBLE HASN&apos;T RUN YET. ITS FIRST INVESTIGATIONS WILL APPEAR HERE.</p>}
        {load === "ready" && !list.length && <p className="mt-8 font-mono text-[11px] tracking-[0.16em] text-ink/55">NOTHING HERE YET.</p>}

        <ol className="mt-8 grid gap-6 lg:grid-cols-2">
          {list.slice(0, shown).map((i) => (
            <li key={i.id} className="frame bg-void/70 p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-mono text-[10px] tracking-[0.2em] text-ink/45">
                  <span className="text-gold">{i.reason === "candidate" ? "RE-EXAMINE" : "BLIND SEARCH"}</span> · {when(i.at)}
                </p>
                <Link
                  href={`/exoplanet-lab?tic=${i.tic}&label=${encodeURIComponent(i.label)}`}
                  className="font-mono text-[10px] tracking-[0.18em] text-ink/70 transition-colors hover:text-gold"
                >
                  OPEN IN EXOPLANET LAB →
                </Link>
              </div>
              <h2 className="display mt-3 text-2xl text-ink">{i.label}</h2>
              <p className="mt-1 font-mono text-[10px] tracking-[0.14em] text-ink/45">
                TIC {i.tic}
                {i.star?.radius ? ` · ${i.star.radius.toFixed(2)} × SUN'S SIZE` : ""}
                {i.star?.teff ? ` · ${Math.round(i.star.teff).toLocaleString("en")} K` : ""}
                {i.sectors.length ? ` · SECTORS ${i.sectors.join(", ")} · ${i.days} DAYS` : ""}
                {i.known.length ? ` · KNOWN: ${i.known.join(", ")}` : ""}
              </p>
              <div className="mt-4 space-y-4">
                {i.error ? (
                  <p className="caps text-[11px] text-ink/50">Couldn&apos;t investigate: {i.error}.</p>
                ) : i.findings.length ? (
                  i.findings.map((f, k) => <FindingCard key={k} f={f} />)
                ) : (
                  <p className="caps border-t border-ink/10 pt-4 text-[11px] text-ink/55">
                    Quiet: no repeating dip above the detection bar{i.quiet ? ` (strongest peak SDE ${i.quiet.sde}, SNR ${i.quiet.snr})` : ""}.
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
        {list.length > shown && (
          <button
            type="button"
            onClick={() => setShown(shown + PAGE)}
            className="mt-8 rounded-full border border-ink/30 px-5 py-2.5 font-mono text-[10px] tracking-[0.16em] text-ink/85 hover:border-ink/70"
          >
            SHOW MORE ({list.length - shown} LEFT)
          </button>
        )}

        <p className="mt-10 max-w-[90ch] font-mono text-[10px] leading-relaxed tracking-[0.14em] text-ink/40">
          RUNS DAILY ON GITHUB ACTIONS WITH NASA DATA: LIGHT CURVES FROM TESS VIA MAST, CATALOGUES FROM THE NASA EXOPLANET ARCHIVE. A
          CANDIDATE HERE IS UNVETTED: IT PASSED THE CHECKS STELLR CAN RUN, NOT THE FOLLOW-UP THAT CONFIRMS A PLANET. MANY WILL TURN OUT TO
          BE STARS, NOT PLANETS.
        </p>
      </div>
    </main>
  );
}
