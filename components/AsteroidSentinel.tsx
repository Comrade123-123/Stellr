"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { View } from "@/components/canvas/AsteroidScene";
import ScrambleText from "@/components/ui/ScrambleText";
import { LD_KM, metres, sizeLike, sizeRange, type Approach, type Elements } from "@/lib/asteroids";

const Scene = dynamic(() => import("@/components/canvas/AsteroidScene"), { ssr: false });

type Load = "loading" | "ready" | "error";
type Sort = "date" | "closest" | "largest";

const ld = (km: number) => km / LD_KM;
const fmtKm = (km: number) => (km >= 1e6 ? `${(km / 1e6).toFixed(2)} M KM` : `${Math.round(km).toLocaleString("en")} KM`);
const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", opts).format(new Date(iso)).toUpperCase();
/** Largest plausible size in metres, for sorting. */
const bigness = (a: Approach) => sizeRange(a.h, a.diameterKm)?.[1] ?? 0;

function sizeText(a: Approach) {
  const r = sizeRange(a.h, a.diameterKm);
  if (!r) return "SIZE UNKNOWN";
  return r[0] === r[1] ? metres(r[0]).toUpperCase() : `${metres(r[0])}–${metres(r[1])}`.toUpperCase();
}

/** Asteroid Sentinel: every near-Earth asteroid passing within ~20 lunar distances, with its real path in 3D. */
export default function AsteroidSentinel() {
  const [list, setList] = useState<Approach[]>([]);
  const [load, setLoad] = useState<Load>("loading");
  const [selected, setSelected] = useState<string | null>(null);
  const [elements, setElements] = useState<{ des: string; el: Elements | null; failed: boolean } | null>(null);
  const [view, setView] = useState<View>("flyby");
  const [sort, setSort] = useState<Sort>("date");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(0);
  const reducedMotion = useMemo(() => typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  const fetchList = useCallback(() => {
    setLoad("loading");
    fetch("/api/asteroids")
      .then(async (res) => {
        const data = (await res.json()) as { approaches: Approach[]; error?: boolean };
        if (!res.ok || data.error) throw new Error("asteroids");
        setList(data.approaches);
        setLoad("ready");
        // Start on the next approach to come, or the latest if they've all passed.
        const t = Date.now();
        setNow(t);
        const next = data.approaches.find((a) => new Date(a.at).getTime() > t) ?? data.approaches[data.approaches.length - 1];
        setSelected((s) => s ?? next?.des ?? null);
      })
      .catch(() => setLoad("error"));
  }, []);
  useEffect(() => {
    // The list comes over the network, so it can only load after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchList();
  }, [fetchList]);

  const current = list.find((a) => a.des === selected) ?? null;

  // Elements for the selected asteroid, fetched when it changes.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    fetch(`/api/asteroids/orbit?des=${encodeURIComponent(selected)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const el = (await res.json()) as Elements;
        if (!cancelled) setElements({ des: selected, el, failed: false });
      })
      .catch(() => !cancelled && setElements({ des: selected, el: null, failed: true }));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const el = elements?.des === selected ? elements.el : null;
  const elFailed = elements?.des === selected && elements.failed;

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(() => {
    const filtered = list.filter((a) => words.every((w) => a.name.toLowerCase().includes(w) || a.des.toLowerCase().includes(w)));
    const sorted = [...filtered];
    if (sort === "closest") sorted.sort((a, b) => a.distKm - b.distKm);
    if (sort === "largest") sorted.sort((a, b) => bigness(b) - bigness(a));
    return sorted;
    // words is derived from query
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, sort, query]);

  const closestKm = list.length ? Math.min(...list.map((a) => a.distKm)) : null;
  const risky = list.filter((a) => a.sentry);
  const size = current ? sizeRange(current.h, current.diameterKm) : null;
  const passed = current ? new Date(current.at).getTime() < now : false;

  return (
    <main className="relative min-h-svh bg-void text-ink lg:h-svh lg:overflow-hidden">
      <div className="relative h-[58svh] w-full lg:absolute lg:inset-0 lg:h-full">
        <Scene el={el} at={current ? new Date(current.at) : null} view={view} reducedMotion={reducedMotion} />
        {current && !el && (
          <p className="pointer-events-none absolute inset-x-0 bottom-6 text-center font-mono text-[10px] tracking-[0.2em] text-ink/50 lg:right-[420px]">
            {elFailed ? "ORBIT UNAVAILABLE FOR THIS ONE RIGHT NOW" : "LOADING ORBIT…"}
          </p>
        )}
      </div>

      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-5 sm:p-8">
        <div className="pointer-events-auto">
          <Link href="/" className="font-mono text-[11px] tracking-[0.2em] text-ink/60 transition-colors hover:text-gold">
            <ScrambleText text="← STELLR" />
          </Link>
          <h1 className="display mt-5 text-[clamp(1.6rem,3vw,2.8rem)] text-ink">Asteroid Sentinel</h1>
          <p className="caps mt-2 hidden max-w-[36ch] text-[11px] text-ink/55 sm:block sm:text-[12px]">
            Every asteroid passing within about twenty Moon-distances of Earth in the coming two months, on its real path.
          </p>
        </div>
        <div className="pointer-events-auto flex gap-2">
          {(["flyby", "orbit"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`whitespace-nowrap rounded-full border px-4 py-2 font-mono text-[10px] tracking-[0.2em] transition-colors ${
                view === v ? "border-gold bg-gold text-void" : "border-ink/30 text-ink/70 hover:border-ink/60"
              }`}
            >
              {v === "flyby" ? "FLYBY" : "ORBIT"}
            </button>
          ))}
        </div>
      </header>

      <aside className="relative z-10 px-5 pb-10 sm:px-8 lg:absolute lg:bottom-8 lg:right-8 lg:top-28 lg:w-[380px] lg:overflow-y-auto lg:p-0">
        <div className="frame bg-void/70 backdrop-blur-md">
          {/* Selected */}
          <div className="border-b border-ink/10 p-5">
            {current ? (
              <>
                <p className="font-mono text-[10px] tracking-[0.2em] text-ink/45">
                  {passed ? "PASSED" : "CLOSEST APPROACH"} · {fmtDate(current.at, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </p>
                <h2 className="display mt-3 text-2xl text-ink">{current.name}</h2>
                {el && (
                  <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-ink/45">
                    {el.orbitClass.toUpperCase()}
                    {el.pha ? " · POTENTIALLY HAZARDOUS CLASS" : ""}
                  </p>
                )}
                <dl className="mt-4 grid grid-cols-2 gap-4 font-mono">
                  <div>
                    <dt className="text-[10px] tracking-[0.2em] text-ink/45">MISS DISTANCE</dt>
                    <dd className="mt-1 text-sm text-gold">{ld(current.distKm).toFixed(2)} × MOON</dd>
                    <dd className="mt-0.5 text-[10px] tracking-[0.12em] text-ink/50">{fmtKm(current.distKm)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] tracking-[0.2em] text-ink/45">SPEED</dt>
                    <dd className="mt-1 text-sm text-ink">{current.speed.toFixed(1)} KM/S</dd>
                    <dd className="mt-0.5 text-[10px] tracking-[0.12em] text-ink/50">{Math.round(current.speed * 3600).toLocaleString("en")} KM/H</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-[10px] tracking-[0.2em] text-ink/45">{current.diameterKm ? "SIZE" : "ESTIMATED SIZE"}</dt>
                    <dd className="mt-1 text-sm text-ink">{sizeText(current)}</dd>
                    {size && <dd className="mt-0.5 text-[10px] tracking-[0.12em] text-ink/50">ABOUT {sizeLike((size[0] + size[1]) / 2).toUpperCase()}</dd>}
                  </div>
                </dl>
                <p className="caps mt-4 text-[11px] leading-relaxed text-ink/55">
                  {current.sentry
                    ? `On NASA's Sentry watch list: a ${(current.sentry.ip * 100).toPrecision(2)}% chance of impact over ${current.sentry.range}, Torino scale ${current.sentry.torino}. This pass is a miss.`
                    : passed
                      ? "It passed safely."
                      : "A safe pass: it will miss Earth by the distance above."}
                </p>
              </>
            ) : (
              <p className="font-mono text-[11px] tracking-[0.18em] text-ink/55">
                {load === "loading" ? "READING JPL'S CLOSE-APPROACH LIST…" : load === "error" ? "JPL DATA UNAVAILABLE RIGHT NOW." : "NO CLOSE APPROACHES IN THIS WINDOW."}
                {load === "error" && (
                  <button type="button" onClick={fetchList} className="ml-2 text-gold hover:underline">
                    RETRY
                  </button>
                )}
              </p>
            )}
          </div>

          {/* Summary */}
          {load === "ready" && (
            <div className="grid grid-cols-3 border-b border-ink/10 text-center font-mono">
              <div className="border-r border-ink/10 p-3">
                <p className="text-lg text-ink">{list.length}</p>
                <p className="mt-1 text-[9px] tracking-[0.16em] text-ink/45">PASSES</p>
              </div>
              <div className="border-r border-ink/10 p-3">
                <p className="text-lg text-gold">{closestKm !== null ? ld(closestKm).toFixed(2) : "—"}</p>
                <p className="mt-1 text-[9px] tracking-[0.16em] text-ink/45">CLOSEST · LD</p>
              </div>
              <div className="p-3">
                <p className={`text-lg ${risky.length ? "text-gold" : "text-ink"}`}>{risky.length}</p>
                <p className="mt-1 text-[9px] tracking-[0.16em] text-ink/45">ON SENTRY</p>
              </div>
            </div>
          )}

          {/* List */}
          <div className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              {(["date", "closest", "largest"] as Sort[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSort(s)}
                  className={`rounded-full border px-3 py-1 font-mono text-[10px] tracking-[0.18em] transition-colors ${
                    sort === s ? "border-gold bg-gold text-void" : "border-ink/25 text-ink/70 hover:border-ink/60"
                  }`}
                >
                  {s.toUpperCase()}
                </button>
              ))}
            </div>
            <label htmlFor="asteroid-search" className="sr-only">
              Find an asteroid
            </label>
            <input
              id="asteroid-search"
              type="search"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="FIND BY NAME OR DESIGNATION"
              className="mt-3 h-9 w-full rounded-full border border-ink/25 bg-void px-4 font-mono text-[11px] tracking-[0.12em] text-ink outline-none placeholder:text-ink/35 focus:border-ink/60"
            />
            <ul className="mt-3 divide-y divide-ink/10">
              {shown.map((a) => {
                const isPast = new Date(a.at).getTime() < now;
                return (
                  <li key={`${a.des}-${a.at}`}>
                    <button
                      type="button"
                      onClick={() => setSelected(a.des)}
                      className={`flex w-full items-baseline justify-between gap-3 py-3 text-left font-mono transition-colors ${
                        a.des === selected ? "text-gold" : "text-ink/85 hover:text-gold"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] tracking-[0.06em]">{a.name}</span>
                        <span className="mt-1 block text-[10px] tracking-[0.14em] text-ink/45">
                          {isPast ? "PASSED " : ""}
                          {fmtDate(a.at, { day: "2-digit", month: "short" })} · {sizeText(a)}
                          {a.sentry ? " · SENTRY" : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums tracking-[0.08em]">{ld(a.distKm).toFixed(2)} LD</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {load === "ready" && !shown.length && (
              <p className="caps mt-3 text-[11px] text-ink/50">No asteroid in this window matches “{query.trim()}”.</p>
            )}
          </div>
        </div>

        <p className="mt-4 font-mono text-[10px] leading-relaxed tracking-[0.15em] text-ink/40">
          LD = LUNAR DISTANCE, 384,400 KM · SIZES ESTIMATED FROM BRIGHTNESS UNLESS MEASURED · DATA FROM{" "}
          <a href="https://ssd.jpl.nasa.gov" target="_blank" rel="noreferrer" className="text-ink/70 hover:text-gold">
            NASA JPL
          </a>
          {" · "}PATHS COMPUTED IN YOUR BROWSER; EARTH AND MOON DRAWN 4× LARGER
        </p>
      </aside>
    </main>
  );
}
