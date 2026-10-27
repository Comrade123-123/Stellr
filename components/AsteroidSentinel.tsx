"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { Swarm, View } from "@/components/canvas/AsteroidScene";
import ScrambleText from "@/components/ui/ScrambleText";
import { LD_KM, metres, sizeLike, sizeRange, type Approach, type Elements } from "@/lib/asteroids";

const Scene = dynamic(() => import("@/components/canvas/AsteroidScene"), { ssr: false });

type Load = "loading" | "ready" | "error";
type Sort = "date" | "closest" | "largest";
type Range = "60d" | "year";
/** An object looked up in JPL's full catalogue, with its next close pass if it has one; `since` is when it was looked up. */
type Found = { el: Elements; next: Approach | null; since: number };
type Lookup = { state: "idle" | "loading" | "none" | "unsupported" | "error"; q: string; matches: { des: string; name: string }[] };

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

/** The flyby view propagates JPL's elements two-body from their epoch, so it is offered only for passes this close in time. */
const FLYBY_DAYS = 400;
const DAY_MS = 86_400_000;

function PassFacts({ a }: { a: Approach }) {
  const size = sizeRange(a.h, a.diameterKm);
  return (
    <dl className="mt-4 grid grid-cols-2 gap-4 font-mono">
      <div>
        <dt className="text-[10px] tracking-[0.2em] text-ink/45">MISS DISTANCE</dt>
        <dd className="mt-1 text-sm text-gold">{ld(a.distKm).toFixed(2)} × MOON</dd>
        <dd className="mt-0.5 text-[10px] tracking-[0.12em] text-ink/50">{fmtKm(a.distKm)}</dd>
      </div>
      <div>
        <dt className="text-[10px] tracking-[0.2em] text-ink/45">SPEED</dt>
        <dd className="mt-1 text-sm text-ink">{a.speed.toFixed(1)} KM/S</dd>
        <dd className="mt-0.5 text-[10px] tracking-[0.12em] text-ink/50">{Math.round(a.speed * 3600).toLocaleString("en")} KM/H</dd>
      </div>
      <div className="col-span-2">
        <dt className="text-[10px] tracking-[0.2em] text-ink/45">{a.diameterKm ? "SIZE" : "ESTIMATED SIZE"}</dt>
        <dd className="mt-1 text-sm text-ink">{sizeText(a)}</dd>
        {size && <dd className="mt-0.5 text-[10px] tracking-[0.12em] text-ink/50">ABOUT {sizeLike((size[0] + size[1]) / 2).toUpperCase()}</dd>}
      </div>
    </dl>
  );
}

/** Opens Cosmoscope on this asteroid, at its close approach when there is one. */
const cosmoscopeLink = (des: string, at: string | null) =>
  `/cosmoscope?asteroid=${encodeURIComponent(des)}${at ? `&at=${encodeURIComponent(at)}` : ""}`;

const sentryNote = (s: NonNullable<Approach["sentry"]>) =>
  `On NASA's Sentry watch list: a ${(s.ip * 100).toPrecision(2)}% chance of impact over ${s.range}, Torino scale ${s.torino}.`;

/** Asteroid Sentinel: every near-Earth asteroid passing within ~20 lunar distances, with its real path in 3D. */
export default function AsteroidSentinel() {
  const [list, setList] = useState<Approach[]>([]);
  const [load, setLoad] = useState<Load>("loading");
  /** Why the list failed, as the API reports it, shown small so a screenshot carries it. */
  const [detail, setDetail] = useState("");
  const [range, setRange] = useState<Range>("60d");
  const [selected, setSelected] = useState<string | null>(null);
  const [elements, setElements] = useState<{ des: string; el: Elements | null; failed: boolean } | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [lookup, setLookup] = useState<Lookup>({ state: "idle", q: "", matches: [] });
  const [view, setView] = useState<View>("flyby");
  const [swarm, setSwarm] = useState<Swarm | null>(null);
  const [hazard, setHazard] = useState<"off" | "loading" | "on" | "error">("off");
  const [sort, setSort] = useState<Sort>("date");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(0);
  const reducedMotion = useMemo(() => typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  const fetchList = useCallback(() => {
    setLoad("loading");
    fetch(`/api/asteroids${range === "year" ? "?range=year" : ""}`)
      .then(async (res) => {
        const data = (await res.json().catch(() => ({ approaches: [], error: true, detail: `HTTP ${res.status}` }))) as {
          approaches: Approach[];
          error?: boolean;
          detail?: string;
        };
        if (!res.ok || data.error) throw new Error(data.detail ?? `HTTP ${res.status}`);
        setList(data.approaches);
        setLoad("ready");
        // Start on the next approach to come, or the latest if they've all passed; keep a choice still in the list.
        const t = Date.now();
        setNow(t);
        const next = data.approaches.find((a) => new Date(a.at).getTime() > t) ?? data.approaches[data.approaches.length - 1];
        setSelected((s) => (s && data.approaches.some((a) => a.des === s) ? s : (next?.des ?? null)));
      })
      .catch((e: unknown) => {
        setDetail(e instanceof Error ? e.message : "");
        setLoad("error");
      });
  }, [range]);
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

  /** Any object in JPL's catalogue, by name or designation. */
  const runLookup = useCallback((q: string) => {
    const name = q.trim();
    if (!name) return;
    setLookup({ state: "loading", q: name, matches: [] });
    fetch(`/api/asteroids/lookup?q=${encodeURIComponent(name)}`)
      .then(async (res) => {
        const data = (await res.json().catch(() => ({ error: true }))) as {
          error?: boolean;
          matches?: Lookup["matches"];
          found?: boolean;
          unsupported?: boolean;
          elements?: Elements;
          next?: Approach | null;
        };
        if (!res.ok || data.error) throw new Error(String(res.status));
        if (data.matches) return setLookup({ state: "idle", q: name, matches: data.matches });
        if (data.found === false) return setLookup({ state: "none", q: name, matches: [] });
        if (data.unsupported || !data.elements) return setLookup({ state: "unsupported", q: name, matches: [] });
        setFound({ el: data.elements, next: data.next ?? null, since: Date.now() });
        setLookup({ state: "idle", q: "", matches: [] });
        setQuery("");
      })
      .catch(() => setLookup({ state: "error", q: name, matches: [] }));
  }, []);

  const pick = (des: string) => {
    setFound(null);
    setSelected(des);
  };

  const toggleHazard = () => {
    if (hazard === "on") return setHazard("off");
    setView("orbit");
    if (swarm) return setHazard("on");
    setHazard("loading");
    fetch("/api/asteroids/hazardous")
      .then(async (res) => {
        const data = (await res.json()) as { stride: number; orbits: number[]; error?: boolean };
        if (!res.ok || data.error) throw new Error(String(res.status));
        setSwarm({ stride: data.stride, orbits: Float64Array.from(data.orbits) });
        setHazard("on");
      })
      .catch(() => setHazard("error"));
  };

  // What the scene shows: a looked-up object, else the selected pass. A looked-up object whose
  // next pass is far off (or never) is shown in the orbit view around today.
  const nextMs = found?.next ? new Date(found.next.at).getTime() : null;
  const flybyOk = !found || (nextMs !== null && Math.abs(nextMs - found.since) < FLYBY_DAYS * DAY_MS);
  const shownView: View = flybyOk ? view : "orbit";
  const sceneEl = found ? found.el : el;
  const atMs = found ? (flybyOk && nextMs !== null ? nextMs : found.since) : current ? new Date(current.at).getTime() : null;
  const sceneAt = atMs === null ? null : new Date(atMs);
  const swarmCount = swarm ? Math.floor(swarm.orbits.length / swarm.stride) : 0;
  const showSwarm = hazard === "on" && shownView === "orbit";

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
  const passed = current ? new Date(current.at).getTime() < now : false;
  const windowText = range === "year" ? "the coming year" : "the coming two months";

  return (
    <main className="relative min-h-svh bg-void text-ink lg:h-svh lg:overflow-hidden">
      <div className="relative h-[58svh] w-full lg:absolute lg:inset-0 lg:h-full">
        <Scene
          el={sceneEl}
          at={sceneAt}
          approach={!found || (flybyOk && nextMs !== null)}
          view={shownView}
          swarm={showSwarm ? swarm : null}
          reducedMotion={reducedMotion}
        />
        {!found && current && !el && (
          <p className="pointer-events-none absolute inset-x-0 bottom-6 text-center font-mono text-[10px] tracking-[0.2em] text-ink/50 lg:right-[420px]">
            {elFailed ? "ORBIT UNAVAILABLE FOR THIS ONE RIGHT NOW" : "LOADING ORBIT…"}
          </p>
        )}
        {(showSwarm || hazard === "loading" || hazard === "error") && (
          <p className="pointer-events-none absolute bottom-6 left-5 font-mono text-[10px] tracking-[0.18em] text-ink/55 sm:left-8">
            {hazard === "loading" ? (
              "READING JPL'S HAZARDOUS-ASTEROID ORBITS…"
            ) : hazard === "error" ? (
              "HAZARDOUS-ASTEROID ORBITS UNAVAILABLE RIGHT NOW"
            ) : (
              <>
                <span className="text-[#ff6a3d]">●</span> {swarmCount.toLocaleString("en")} POTENTIALLY HAZARDOUS ASTEROIDS, EACH ON ITS REAL ORBIT
              </>
            )}
          </p>
        )}
      </div>

      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-5 sm:p-8">
        <div className="pointer-events-auto">
          <Link href="/" className="font-mono text-[11px] tracking-[0.2em] text-ink/60 transition-colors hover:text-gold">
            <ScrambleText text="← STELLR" />
          </Link>
          <h1 className="display mt-5 text-[clamp(1.6rem,3vw,2.8rem)] text-ink">Asteroid Sentinel</h1>
          <p className="caps mt-2 hidden max-w-[36ch] text-[11px] text-ink/55 sm:block sm:text-[12px]">
            Every asteroid passing within about twenty Moon-distances of Earth in {windowText}, on its real path. Or find any other.
          </p>
        </div>
        <div className="pointer-events-auto flex max-w-[60%] flex-wrap justify-end gap-2">
          {(["flyby", "orbit"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              disabled={v === "flyby" && !flybyOk}
              onClick={() => {
                setView(v);
                if (v === "flyby") setHazard((h) => (h === "on" ? "off" : h));
              }}
              className={`whitespace-nowrap rounded-full border px-4 py-2 font-mono text-[10px] tracking-[0.2em] transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                shownView === v ? "border-gold bg-gold text-void" : "border-ink/30 text-ink/70 hover:border-ink/60"
              }`}
            >
              {v === "flyby" ? "FLYBY" : "ORBIT"}
            </button>
          ))}
          <button
            type="button"
            onClick={toggleHazard}
            aria-pressed={showSwarm}
            className={`whitespace-nowrap rounded-full border px-4 py-2 font-mono text-[10px] tracking-[0.2em] transition-colors ${
              showSwarm ? "border-[#ff6a3d] bg-[#ff6a3d] text-void" : "border-ink/30 text-ink/70 hover:border-ink/60"
            }`}
          >
            {hazard === "loading" ? "HAZARDOUS…" : "HAZARDOUS"}
          </button>
        </div>
      </header>

      <aside className="relative z-10 px-5 pb-10 sm:px-8 lg:absolute lg:bottom-8 lg:right-8 lg:top-28 lg:w-[388px] lg:overflow-y-auto lg:overflow-x-hidden lg:p-[4px]">
        <div className="frame bg-void/70 backdrop-blur-md">
          {/* Selected */}
          <div className="border-b border-ink/10 p-5">
            {found ? (
              <>
                <p className="font-mono text-[10px] tracking-[0.2em] text-ink/45">
                  {found.next
                    ? `NEXT CLOSE PASS · ${fmtDate(found.next.at, { day: "2-digit", month: "short", year: "numeric" })}`
                    : "FROM JPL'S FULL CATALOGUE"}
                </p>
                <h2 className="display mt-3 text-2xl text-ink">{found.el.name}</h2>
                <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-ink/45">
                  {found.el.orbitClass.toUpperCase()}
                  {found.el.pha ? " · POTENTIALLY HAZARDOUS CLASS" : ""}
                </p>
                {found.next && <PassFacts a={found.next} />}
                <dl className="mt-4 grid grid-cols-2 gap-4 font-mono">
                  <div>
                    <dt className="text-[10px] tracking-[0.2em] text-ink/45">FROM THE SUN</dt>
                    <dd className="mt-1 text-sm text-ink">
                      {(found.el.a * (1 - found.el.e)).toFixed(2)}–{(found.el.a * (1 + found.el.e)).toFixed(2)} AU
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] tracking-[0.2em] text-ink/45">ONE ORBIT</dt>
                    <dd className="mt-1 text-sm text-ink">
                      {(() => {
                        const days = 360 / (found.el.n ?? 0.9856 / Math.pow(found.el.a, 1.5));
                        return days < 730 ? `${Math.round(days)} DAYS` : `${(days / 365.25).toFixed(1)} YEARS`;
                      })()}
                    </dd>
                  </div>
                </dl>
                <p className="caps mt-4 text-[11px] leading-relaxed text-ink/55">
                  {found.next?.sentry ? `${sentryNote(found.next.sentry)} ` : ""}
                  {!found.next
                    ? "It doesn't come within 0.2 AU (78 Moon-distances) of Earth before 2100. The orbit view shows where it is now."
                    : flybyOk
                      ? "Its next pass is shown in the flyby view; JPL's figures above."
                      : `Its next close pass is ${((nextMs! - found.since) / (365.25 * DAY_MS)).toFixed(1)} years away, too far ahead to draw the flyby well; JPL's figures above. The orbit view shows where it is now.`}
                </p>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[10px] tracking-[0.2em]">
                  <button type="button" onClick={() => setFound(null)} className="text-gold hover:underline">
                    ← BACK TO THE CLOSE PASSES
                  </button>
                  <Link href={cosmoscopeLink(found.el.des, found.next && flybyOk ? found.next.at : null)} className="text-ink/70 hover:text-gold">
                    SEE IT IN COSMOSCOPE →
                  </Link>
                </div>
              </>
            ) : current ? (
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
                <PassFacts a={current} />
                <p className="caps mt-4 text-[11px] leading-relaxed text-ink/55">
                  {current.sentry
                    ? `${sentryNote(current.sentry)} This pass is a miss.`
                    : passed
                      ? "It passed safely."
                      : "A safe pass: it will miss Earth by the distance above."}
                </p>
                <Link href={cosmoscopeLink(current.des, current.at)} className="mt-4 inline-block font-mono text-[10px] tracking-[0.2em] text-ink/70 hover:text-gold">
                  SEE IT AMONG THE PLANETS IN COSMOSCOPE →
                </Link>
              </>
            ) : (
              <p className="font-mono text-[11px] tracking-[0.18em] text-ink/55">
                {load === "loading" ? "READING JPL'S CLOSE-APPROACH LIST…" : load === "error" ? "JPL DATA UNAVAILABLE RIGHT NOW." : "NO CLOSE APPROACHES IN THIS WINDOW."}
                {load === "error" && (
                  <button type="button" onClick={fetchList} className="ml-2 text-gold hover:underline">
                    RETRY
                  </button>
                )}
                {load === "error" && detail && <span className="mt-2 block break-words text-[9px] normal-case tracking-[0.06em] text-ink/35">{detail}</span>}
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
              {(["60d", "year"] as Range[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={`rounded-full border px-3 py-1 font-mono text-[10px] tracking-[0.18em] transition-colors ${
                    range === r ? "border-ink/80 bg-ink text-void" : "border-ink/25 text-ink/70 hover:border-ink/60"
                  }`}
                >
                  {r === "60d" ? "NEXT 60 DAYS" : "NEXT YEAR"}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
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
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                runLookup(query);
              }}
            >
              <label htmlFor="asteroid-search" className="sr-only">
                Find an asteroid
              </label>
              <input
                id="asteroid-search"
                type="search"
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLookup({ state: "idle", q: "", matches: [] });
                }}
                placeholder="FIND BY NAME OR DESIGNATION"
                className="mt-3 h-9 w-full rounded-full border border-ink/25 bg-void px-4 font-mono text-[11px] tracking-[0.12em] text-ink outline-none placeholder:text-ink/35 focus:border-ink/60"
              />
            </form>
            {query.trim() && (
              <div className="mt-3 font-mono text-[10px] tracking-[0.16em]">
                {lookup.state === "loading" ? (
                  <p className="text-ink/50">SEARCHING JPL&apos;S FULL CATALOGUE…</p>
                ) : (
                  <button type="button" onClick={() => runLookup(query)} className="text-left text-gold hover:underline">
                    SEARCH ALL OF JPL&apos;S CATALOGUE FOR “{query.trim().toUpperCase()}” →
                  </button>
                )}
                {lookup.state === "none" && <p className="mt-2 text-ink/50">JPL HAS NO OBJECT CALLED “{lookup.q.toUpperCase()}”.</p>}
                {lookup.state === "unsupported" && <p className="mt-2 text-ink/50">THAT ONE ISN&apos;T ON A CLOSED ORBIT, SO THERE&apos;S NO ORBIT TO DRAW.</p>}
                {lookup.state === "error" && <p className="mt-2 text-ink/50">JPL&apos;S CATALOGUE DIDN&apos;T ANSWER. TRY AGAIN IN A MOMENT.</p>}
                {lookup.matches.length > 0 && (
                  <>
                    <p className="mt-2 text-ink/50">SEVERAL OBJECTS MATCH. WHICH ONE?</p>
                    <ul className="mt-1">
                      {lookup.matches.map((m) => (
                        <li key={m.des}>
                          <button type="button" onClick={() => runLookup(m.des)} className="py-1 text-left text-ink/85 hover:text-gold">
                            {m.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
            <ul className="mt-3 divide-y divide-ink/10">
              {shown.map((a) => {
                const isPast = new Date(a.at).getTime() < now;
                return (
                  <li key={`${a.des}-${a.at}`}>
                    <button
                      type="button"
                      onClick={() => pick(a.des)}
                      className={`flex w-full items-baseline justify-between gap-3 py-3 text-left font-mono transition-colors ${
                        !found && a.des === selected ? "text-gold" : "text-ink/85 hover:text-gold"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] tracking-[0.06em]">{a.name}</span>
                        <span className="mt-1 block text-[10px] tracking-[0.14em] text-ink/45">
                          {isPast ? "PASSED " : ""}
                          {fmtDate(a.at, { day: "2-digit", month: "short", ...(range === "year" ? { year: "2-digit" } : {}) })} · {sizeText(a)}
                          {a.sentry ? " · SENTRY" : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums tracking-[0.08em]">{ld(a.distKm).toFixed(2)} LD</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {load === "ready" && !shown.length && query.trim() && (
              <p className="caps mt-3 text-[11px] text-ink/50">None of the close passes in this window matches “{query.trim()}”.</p>
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
