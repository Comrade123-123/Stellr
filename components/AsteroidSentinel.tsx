"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { Swarm, View } from "@/components/canvas/AsteroidScene";
import { CleanHint, SceneShade, Section, Segmented, Stat, Status, ToolBar, glass, useClean, wide } from "@/components/tools/ToolShell";
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
    <div className="grid grid-cols-2 gap-x-4 gap-y-4">
      <Stat label="MISS DISTANCE" value={`${ld(a.distKm).toFixed(2)} × Moon`} sub={fmtKm(a.distKm).toLowerCase()} accent />
      <Stat label="SPEED" value={`${a.speed.toFixed(1)} km/s`} sub={`${Math.round(a.speed * 3600).toLocaleString("en")} km/h`} />
      <div className="col-span-2">
        <Stat label={a.diameterKm ? "SIZE" : "ESTIMATED SIZE"} value={sizeText(a).toLowerCase()} sub={size ? `about ${sizeLike((size[0] + size[1]) / 2)}` : undefined} />
      </div>
    </div>
  );
}

/** How close a pass comes, on a bar running out to 20 Moon-distances, with the Moon's distance marked. */
function MissBar({ km, on }: { km: number; on: boolean }) {
  const f = Math.min(1, ld(km) / 20);
  return (
    <div className="relative mt-1.5 h-1 rounded-full bg-ink/10">
      <span className="absolute top-1/2 block h-2 w-px -translate-y-1/2 bg-ink/30" style={{ left: "5%" }} title="The Moon's distance" />
      <span className={`absolute top-1/2 block h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ${on ? "bg-gold" : "bg-ink/60"}`} style={{ left: `${f * 100}%` }} />
    </div>
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
  const [clean, setClean] = useClean();
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

  const oneOrbit = (e: Elements) => {
    const days = 360 / (e.n ?? 0.9856 / Math.pow(e.a, 1.5));
    return days < 730 ? `${Math.round(days)} days` : `${(days / 365.25).toFixed(1)} years`;
  };

  /** The chosen asteroid. */
  const detailCard = (
    <div className={glass}>
      {found ? (
        <>
          <Section>
            <p className="font-mono text-[9px] tracking-[0.22em] text-ink/45">
              {found.next ? `NEXT CLOSE PASS · ${fmtDate(found.next.at, { day: "2-digit", month: "short", year: "numeric" })}` : "FROM JPL'S FULL CATALOGUE"}
            </p>
            <h2 className="display mt-2 text-[22px] leading-tight text-ink">{found.el.name}</h2>
            <p className="mt-1.5 font-mono text-[9px] tracking-[0.16em] text-ink/45">
              {found.el.orbitClass.toUpperCase()}
              {found.el.pha ? <span className="text-[#ff8a4c]"> · POTENTIALLY HAZARDOUS CLASS</span> : ""}
            </p>
          </Section>
          {found.next && (
            <Section>
              <PassFacts a={found.next} />
            </Section>
          )}
          <Section>
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Stat label="FROM THE SUN" value={`${(found.el.a * (1 - found.el.e)).toFixed(2)}–${(found.el.a * (1 + found.el.e)).toFixed(2)} AU`} />
              <Stat label="ONE ORBIT" value={oneOrbit(found.el)} />
            </div>
            <p className="mt-4 text-[12px] leading-relaxed text-ink/55">
              {found.next?.sentry ? `${sentryNote(found.next.sentry)} ` : ""}
              {!found.next
                ? "It doesn't come within 0.2 AU (78 Moon-distances) of Earth before 2100. The orbit view shows where it is now."
                : flybyOk
                  ? "Its next pass is shown in the flyby view, with JPL's figures above."
                  : `Its next close pass is ${((nextMs! - found.since) / (365.25 * DAY_MS)).toFixed(1)} years away, too far ahead to draw the flyby well. The orbit view shows where it is now.`}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => setFound(null)} className="rounded-full border border-ink/20 px-3 py-1.5 text-[12px] text-ink/80 hover:border-ink/50">
                ← Close passes
              </button>
              <Link href={cosmoscopeLink(found.el.des, found.next && flybyOk ? found.next.at : null)} className="rounded-full border border-gold/50 px-3 py-1.5 text-[12px] text-gold hover:bg-gold hover:text-void">
                See it in Cosmoscope →
              </Link>
            </div>
          </Section>
        </>
      ) : current ? (
        <>
          <Section>
            <p className="font-mono text-[9px] tracking-[0.22em] text-ink/45">
              {passed ? "PASSED" : "CLOSEST APPROACH"} · {fmtDate(current.at, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            </p>
            <h2 className="display mt-2 text-[22px] leading-tight text-ink">{current.name}</h2>
            {el && (
              <p className="mt-1.5 font-mono text-[9px] tracking-[0.16em] text-ink/45">
                {el.orbitClass.toUpperCase()}
                {el.pha ? <span className="text-[#ff8a4c]"> · POTENTIALLY HAZARDOUS CLASS</span> : ""}
              </p>
            )}
          </Section>
          <Section>
            <PassFacts a={current} />
            <div className="mt-4">
              <p className="flex justify-between font-mono text-[9px] tracking-[0.14em] text-ink/40">
                <span>EARTH · TICK = MOON</span>
                <span>10 LD</span>
                <span>20 LD</span>
              </p>
              <MissBar km={current.distKm} on />
            </div>
          </Section>
          <Section>
            <p className={`text-[13px] leading-relaxed ${current.sentry ? "text-[#ffb08a]" : "text-ink/65"}`}>
              {current.sentry ? `${sentryNote(current.sentry)} This pass is a miss.` : passed ? "It passed safely." : "A safe pass: it will miss Earth by the distance above."}
            </p>
            <Link href={cosmoscopeLink(current.des, current.at)} className="mt-4 inline-block rounded-full border border-gold/50 px-3 py-1.5 text-[12px] text-gold hover:bg-gold hover:text-void">
              See it among the planets →
            </Link>
          </Section>
        </>
      ) : (
        <Section>
          {load === "loading" ? (
            <Status>READING JPL&apos;S CLOSE-APPROACH LIST…</Status>
          ) : load === "error" ? (
            <>
              <Status tone="red">
                JPL DATA UNAVAILABLE ·{" "}
                <button type="button" onClick={fetchList} className="text-gold hover:underline">
                  RETRY
                </button>
              </Status>
              {detail && <p className="mt-2 break-words font-mono text-[9px] text-ink/35">{detail}</p>}
            </>
          ) : (
            <Status>NO CLOSE APPROACHES IN THIS WINDOW</Status>
          )}
        </Section>
      )}
    </div>
  );

  /** The close passes: a summary, the window, sorting, search, and the list. */
  const listCard = (
    <div className={glass}>
      {load === "ready" && (
        <div className="grid grid-cols-3 border-b border-ink/[0.08]">
          {[
            [String(list.length), "PASSES", "text-ink"],
            [closestKm !== null ? `${ld(closestKm).toFixed(2)}` : "—", "CLOSEST · LD", "text-gold"],
            [String(risky.length), "ON SENTRY", risky.length ? "text-[#ff8a4c]" : "text-ink"],
          ].map(([v, k, tone], i) => (
            <div key={k} className={`px-4 py-3.5 ${i ? "border-l border-ink/[0.08]" : ""}`}>
              <p className={`display text-[22px] leading-none ${tone}`}>{v}</p>
              <p className="mt-1.5 font-mono text-[8px] tracking-[0.18em] text-ink/45">{k}</p>
            </div>
          ))}
        </div>
      )}
      <Section>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented options={[["60d", "Next 60 days"], ["year", "Next year"]]} value={range} onChange={(r) => setRange(r as Range)} />
          <Segmented options={[["date", "Date"], ["closest", "Closest"], ["largest", "Largest"]]} value={sort} onChange={(v) => setSort(v as Sort)} />
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
            placeholder="Find any asteroid · name or designation"
            className="mt-3 h-10 w-full rounded-full border border-ink/15 bg-ink/[0.04] px-4 text-[13px] text-ink outline-none placeholder:text-ink/35 focus:border-ink/50"
          />
        </form>
        {query.trim() && (
          <div className="mt-3 text-[12px]">
            {lookup.state === "loading" ? (
              <p className="text-ink/50">Searching JPL&apos;s full catalogue…</p>
            ) : (
              <button type="button" onClick={() => runLookup(query)} className="text-left text-gold hover:underline">
                Search all of JPL&apos;s catalogue for “{query.trim()}” →
              </button>
            )}
            {lookup.state === "none" && <p className="mt-2 text-ink/50">JPL has no object called “{lookup.q}”.</p>}
            {lookup.state === "unsupported" && <p className="mt-2 text-ink/50">That one isn&apos;t on a closed orbit, so there&apos;s no orbit to draw.</p>}
            {lookup.state === "error" && <p className="mt-2 text-ink/50">JPL&apos;s catalogue didn&apos;t answer. Try again in a moment.</p>}
            {lookup.matches.length > 0 && (
              <>
                <p className="mt-2 text-ink/50">Several objects match. Which one?</p>
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
      </Section>
      <ul className="space-y-1 px-2 pb-2">
        {shown.map((a) => {
          const isPast = new Date(a.at).getTime() < now;
          const on = !found && a.des === selected;
          return (
            <li key={`${a.des}-${a.at}`}>
              <button
                type="button"
                onClick={() => pick(a.des)}
                className={`w-full rounded-xl px-3 py-2.5 text-left transition-colors ${on ? "bg-gold/[0.1]" : "hover:bg-ink/[0.05]"} ${isPast ? "opacity-55" : ""}`}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className={`truncate text-[13px] ${on ? "text-gold" : "text-ink/90"}`}>{a.name}</span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink/80">{ld(a.distKm).toFixed(2)} LD</span>
                </span>
                <span className="mt-0.5 flex items-baseline justify-between gap-3 font-mono text-[9px] tracking-[0.12em] text-ink/45">
                  <span>
                    {isPast ? "PASSED " : ""}
                    {fmtDate(a.at, { day: "2-digit", month: "short", ...(range === "year" ? { year: "2-digit" } : {}) })} · {sizeText(a)}
                  </span>
                  {a.sentry && <span className="text-[#ff8a4c]">SENTRY</span>}
                </span>
                <MissBar km={a.distKm} on={on} />
              </button>
            </li>
          );
        })}
      </ul>
      {load === "ready" && !shown.length && query.trim() && <p className="px-5 pb-4 text-[12px] text-ink/50">None of the close passes in this window matches “{query.trim()}”.</p>}
    </div>
  );

  const note = (
    <p className="px-2 font-mono text-[9px] leading-relaxed tracking-[0.14em] text-ink/35">
      LD = LUNAR DISTANCE, 384,400 KM · SIZES ESTIMATED FROM BRIGHTNESS UNLESS MEASURED · DATA FROM{" "}
      <a href="https://ssd.jpl.nasa.gov" target="_blank" rel="noreferrer" className="text-ink/60 hover:text-gold">
        NASA JPL
      </a>
      {" · "}PATHS COMPUTED IN YOUR BROWSER; EARTH AND MOON DRAWN 4× LARGER
    </p>
  );

  return (
    <main className="relative bg-void text-ink">
      <section className={`relative w-full overflow-hidden ${clean ? "h-svh" : "h-[64svh] lg:h-svh"} min-h-[480px]`}>
        <div className="absolute inset-0">
          <Scene el={sceneEl} at={sceneAt} approach={!found || (flybyOk && nextMs !== null)} view={shownView} swarm={showSwarm ? swarm : null} reducedMotion={reducedMotion} />
        </div>
        <SceneShade clean={clean} />
        <ToolBar title="Asteroid Sentinel" tagline={`Every asteroid passing within about twenty Moon-distances of Earth in ${windowText}, on its real path.`} clean={clean} onClean={() => setClean(!clean)}>
          <Segmented
            options={flybyOk ? [["flyby", "Flyby"], ["orbit", "Orbit"]] : [["orbit", "Orbit"]]}
            value={shownView}
            onChange={(v) => {
              setView(v as View);
              if (v === "flyby") setHazard((h) => (h === "on" ? "off" : h));
            }}
          />
          <button
            type="button"
            onClick={toggleHazard}
            aria-pressed={showSwarm}
            className={`hidden items-center gap-2 rounded-full border px-3.5 py-2 text-[12px] backdrop-blur-md transition-colors sm:flex ${showSwarm ? "border-[#ff6a3d] bg-[#ff6a3d] text-void" : "border-ink/20 bg-black/40 text-ink/80 hover:border-ink/50"}`}
          >
            <span className={`block h-1.5 w-1.5 rounded-full ${showSwarm ? "bg-void" : "bg-[#ff6a3d]"}`} />
            {hazard === "loading" ? "Hazardous…" : "Hazardous"}
          </button>
        </ToolBar>

        {!found && current && !el && (
          <p className="pointer-events-none absolute inset-x-0 bottom-6 z-10 text-center font-mono text-[10px] tracking-[0.2em] text-ink/50">
            {elFailed ? "ORBIT UNAVAILABLE FOR THIS ONE RIGHT NOW" : "LOADING ORBIT…"}
          </p>
        )}
        {!clean && (showSwarm || hazard === "loading" || hazard === "error") && (
          <p className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] tracking-[0.18em] text-ink/60">
            {hazard === "loading" ? (
              "READING JPL'S HAZARDOUS-ASTEROID ORBITS…"
            ) : hazard === "error" ? (
              "HAZARDOUS-ASTEROID ORBITS UNAVAILABLE RIGHT NOW"
            ) : (
              <>
                <span className="text-[#ff6a3d]">●</span> {swarmCount.toLocaleString("en")} POTENTIALLY HAZARDOUS ASTEROIDS ON THEIR REAL ORBITS
              </>
            )}
          </p>
        )}

        <div className={`cosmo-scroll absolute left-4 top-20 z-10 max-h-[calc(100svh-7rem)] w-[300px] overflow-y-auto ${wide(clean)}`}>{detailCard}</div>
        <aside className={`cosmo-scroll absolute bottom-4 right-4 top-20 z-10 w-[360px] overflow-y-auto ${wide(clean)}`}>
          {listCard}
          <div className="mt-3">{note}</div>
        </aside>
        <CleanHint clean={clean} />
      </section>

      <div className={`space-y-4 px-4 pb-10 pt-4 lg:hidden ${clean ? "hidden" : ""}`}>
        <button
          type="button"
          onClick={toggleHazard}
          aria-pressed={showSwarm}
          className={`flex items-center gap-2 rounded-full border px-3.5 py-2 text-[12px] sm:hidden ${showSwarm ? "border-[#ff6a3d] bg-[#ff6a3d] text-void" : "border-ink/20 text-ink/80"}`}
        >
          <span className={`block h-1.5 w-1.5 rounded-full ${showSwarm ? "bg-void" : "bg-[#ff6a3d]"}`} />
          {hazard === "loading" ? "Hazardous…" : "Hazardous asteroids"}
        </button>
        {detailCard}
        {listCard}
        {note}
      </div>
    </main>
  );
}
