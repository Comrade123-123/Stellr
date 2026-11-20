"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { SwarmStatus } from "@/components/canvas/OrbitScene";
import PlacePicker, { usePlace } from "@/components/PlacePicker";
import { CleanHint, SceneShade, Section, Stat, Status, Toggle, ToolBar, glass, useClean, wide } from "@/components/tools/ToolShell";
import { compass, parseTLE, passes, stateAt, type Pass, type Satellite, type State } from "@/lib/orbits";

const OrbitScene = dynamic(() => import("@/components/canvas/OrbitScene"), { ssr: false });


/** The objects worth following by name; the rest are dots. NORAD numbers. */
const TRACKABLE: { id: number; label: string }[] = [
  { id: 25544, label: "ISS" },
  { id: 48274, label: "Tiangong" },
  { id: 20580, label: "Hubble" },
];

type Load = "loading" | "ready" | "error";

/** Upper-cased, with CelesTrak's bracketed suffixes kept: "STARLINK-1007", "ISS (ZARYA)". */
const display = (sat: Satellite) => sat.name.toUpperCase();

/** Looks a satellite up in CelesTrak's full catalogue by NORAD number or by part of its name. */
async function searchCatalogue(text: string): Promise<Satellite[]> {
  const param = /^\d+$/.test(text) ? `catnr=${text}` : `name=${encodeURIComponent(text)}`;
  const res = await fetch(`/api/tle?${param}`);
  if (!res.ok) throw new Error(String(res.status));
  return parseTLE(await res.text());
}

/**
 * Find any satellite by name or NORAD number: matches from the objects already on the
 * globe show at once, the full catalogue is searched after a short pause in typing.
 */
function SatelliteSearch({ onBoard, onPick }: { onBoard: Satellite[]; onPick: (sat: Satellite) => void }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState<{ for: string; sats: Satellite[]; failed: boolean } | null>(null);
  const q = text.trim();
  const numeric = /^\d+$/.test(q);

  const local = useMemo(() => {
    if (!q) return [];
    const needle = q.toUpperCase();
    return onBoard.filter((s) => (numeric ? String(s.id).startsWith(q) : s.name.toUpperCase().includes(needle))).slice(0, 8);
  }, [onBoard, q, numeric]);

  useEffect(() => {
    if (q.length < (numeric ? 1 : 3)) return;
    let cancelled = false;
    const id = setTimeout(() => {
      searchCatalogue(q)
        .then((sats) => !cancelled && setRemote({ for: q, sats, failed: false }))
        .catch(() => !cancelled && setRemote({ for: q, sats: [], failed: true }));
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [q, numeric]);

  const fresh = remote?.for === q ? remote : null;
  const seen = new Set(local.map((s) => s.id));
  const more = (fresh?.sats ?? []).filter((s) => !seen.has(s.id)).slice(0, 12);
  const searching = q.length >= (numeric ? 1 : 3) && !fresh;
  const results = [...local, ...more];

  const pick = (sat: Satellite) => {
    onPick(sat);
    setText("");
    setOpen(false);
  };

  return (
    <div className="relative">
      <label htmlFor="sat-search" className="sr-only">
        Find a satellite by name or NORAD number
      </label>
      <input
        id="sat-search"
        type="search"
        autoComplete="off"
        spellCheck={false}
        placeholder="Find a satellite · name or NORAD no."
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) pick(results[0]);
          if (e.key === "Escape") setOpen(false);
        }}
        className="h-10 w-full rounded-full border border-ink/15 bg-ink/[0.04] px-4 text-[13px] text-ink outline-none placeholder:text-ink/35 focus:border-ink/50"
      />
      {open && q && (
        <ul
          role="listbox"
          className="cosmo-scroll absolute inset-x-0 top-12 z-20 max-h-72 overflow-y-auto rounded-xl border border-ink/15 bg-[#07080b]/95 p-1 backdrop-blur-xl"
        >
          {results.map((s) => (
            <li key={s.id} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                className="flex w-full items-baseline justify-between gap-4 rounded-lg px-3 py-2 text-left text-[13px] text-ink/85 transition-colors hover:bg-ink/[0.07] hover:text-gold"
              >
                <span className="truncate">{display(s)}</span>
                <span className="shrink-0 text-[10px] text-ink/40">#{s.id}</span>
              </button>
            </li>
          ))}
          <li className="px-4 py-2.5 font-mono text-[10px] tracking-[0.15em] text-ink/40">
            {searching
              ? "SEARCHING THE FULL CATALOGUE…"
              : fresh?.failed
                ? "CATALOGUE SEARCH UNAVAILABLE"
                : q.length < 3 && !numeric
                  ? "TYPE 3 LETTERS TO SEARCH THE FULL CATALOGUE"
                  : results.length
                    ? `${results.length} FOUND`
                    : "NO SATELLITE BY THAT NAME OR NUMBER"}
          </li>
        </ul>
      )}
    </div>
  );
}

async function loadSatellites(): Promise<Satellite[]> {
  const groups = await Promise.all(
    ["stations", "visual"].map(async (group) => {
      const res = await fetch(`/api/tle?group=${group}`);
      if (!res.ok) throw new Error(`${group}: ${res.status}`);
      return parseTLE(await res.text());
    }),
  );
  const seen = new Set<number>();
  return groups.flat().filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

function time(date: Date, timeZone?: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", timeZone }).format(date);
}
function day(date: Date, timeZone?: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone })
    .format(date)
    .toUpperCase();
}
const fixed = (n: number, digits = 2) => n.toFixed(digits);
const latLabel = (lat: number) => `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? "N" : "S"}`;
const lonLabel = (lon: number) => `${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? "E" : "W"}`;

/** Orbit Watch: live satellites on a real-time globe, and the next passes over the visitor. */
export default function OrbitWatch() {
  const placeState = usePlace();
  const { place } = placeState;
  const [sats, setSats] = useState<Satellite[]>([]);
  const [load, setLoad] = useState<Load>("loading");
  const [trackedId, setTrackedId] = useState(25544);
  const [follow, setFollow] = useState(true);
  const [swarm, setSwarm] = useState(false);
  const [swarmStatus, setSwarmStatus] = useState<SwarmStatus>({ state: "off" });
  const [live, setLive] = useState<State | null>(null);
  const [clock, setClock] = useState(0);
  const [list, setList] = useState<Pass[]>([]);
  /** Satellites found by search that aren't in the loaded groups; drawn and trackable like the rest. */
  const [extra, setExtra] = useState<Satellite[]>([]);
  const [clean, setClean] = useClean();

  const fetchAll = useCallback(() => {
    setLoad("loading");
    loadSatellites()
      .then((s) => {
        setSats(s);
        setLoad(s.length ? "ready" : "error");
      })
      .catch(() => setLoad("error"));
  }, []);

  useEffect(() => {
    // Elements come over the network, so they can only load after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAll();
  }, [fetchAll]);

  const all = useMemo(() => [...sats, ...extra], [sats, extra]);
  const options = useMemo(() => TRACKABLE.filter((t) => sats.some((s) => s.id === t.id)), [sats]);
  const tracked = useMemo(() => all.find((s) => s.id === trackedId) ?? null, [all, trackedId]);
  const custom = tracked && !TRACKABLE.some((t) => t.id === tracked.id) ? tracked : null;

  const pick = (sat: Satellite) => {
    if (!sats.some((s) => s.id === sat.id)) setExtra((xs) => [...xs.filter((x) => x.id !== sat.id), sat]);
    setTrackedId(sat.id);
    setFollow(true);
  };

  // Live readout, once a second.
  useEffect(() => {
    if (!tracked) return;
    const tick = () => {
      const t = new Date();
      setLive(stateAt(tracked, t));
      setClock(t.getTime());
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [tracked]);

  // Passes for the next three days, refreshed every five minutes so finished ones drop off.
  useEffect(() => {
    if (!tracked || !place) return;
    const run = () => setList(passes(tracked, place, new Date(Date.now() - 15 * 60_000), 72).filter((p) => p.end.getTime() > Date.now()));
    run();
    const id = setInterval(run, 5 * 60_000);
    return () => clearInterval(id);
  }, [tracked, place]);



  const tz = place?.timeZone;
  const label = TRACKABLE.find((t) => t.id === trackedId)?.label ?? tracked?.name ?? "";
  const noOrbit = tracked && !live;

  const next = list.find((p) => p.visible && p.end.getTime() > clock);
  const nowOver = list.find((p) => p.start.getTime() <= clock && p.end.getTime() > clock);

  const status =
    load === "loading" ? (
      <Status>LOADING ORBITAL ELEMENTS…</Status>
    ) : load === "error" ? (
      <Status tone="red">
        ORBITAL DATA UNAVAILABLE ·{" "}
        <button type="button" onClick={fetchAll} className="text-gold hover:underline">
          RETRY
        </button>
      </Status>
    ) : noOrbit ? (
      <Status tone="red">NO CURRENT ORBIT · IT MAY HAVE RE-ENTERED</Status>
    ) : live ? (
      <Status tone={live.sunlit ? "gold" : "blue"}>{live.sunlit ? "IN SUNLIGHT" : "IN EARTH'S SHADOW"} · {all.length} OBJECTS ON THE GLOBE</Status>
    ) : null;

  /** What's being followed: its name, where it is, and when it's next overhead. */
  const summary = (
    <div className={glass}>
      <Section>
        <p className="font-mono text-[9px] tracking-[0.22em] text-ink/45">{custom ? `NORAD #${custom.id}` : "FOLLOWING"}</p>
        <h2 className="display mt-2 truncate text-[22px] leading-none text-ink">{label}</h2>
        <div className="mt-3">{status}</div>
      </Section>
      <Section>
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Stat label="LATITUDE" value={live ? latLabel(live.latitude) : "—"} />
          <Stat label="LONGITUDE" value={live ? lonLabel(live.longitude) : "—"} />
          <Stat label="ALTITUDE" value={live ? `${Math.round(live.altitudeKm).toLocaleString("en")} km` : "—"} accent />
          <Stat label="SPEED" value={live ? `${fixed(live.speedKmS)} km/s` : "—"} sub={live ? `${Math.round(live.speedKmS * 3600).toLocaleString("en")} km/h` : undefined} accent />
        </div>
      </Section>
      {place && load === "ready" && (
        <Section eyebrow={nowOver ? "OVERHEAD NOW" : "NEXT TIME YOU CAN SEE IT"}>
          {nowOver ? (
            <p className="text-[14px] text-gold">Above your horizon now · {Math.round(nowOver.maxElevation)}° at its highest</p>
          ) : next ? (
            <>
              <p className="text-[16px] text-ink">
                {day(next.start, tz)} · {time(next.start, tz)}
              </p>
              <p className="mt-1 text-[12px] text-ink/55">
                {compass(next.startAzimuth)} → {compass(next.endAzimuth)} · {Math.round(next.maxElevation)}° high · {Math.max(1, Math.round((next.end.getTime() - next.start.getTime()) / 60_000))} min
              </p>
            </>
          ) : (
            <p className="text-[13px] text-ink/55">No visible pass in the next three days from {place.name}.</p>
          )}
        </Section>
      )}
    </div>
  );

  /** Choosing what to follow, the passes, and the visitor's place. */
  const controls = (
    <div className={glass}>
      <Section eyebrow="FOLLOW">
        <SatelliteSearch onBoard={all} onPick={pick} />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(options.length ? options : TRACKABLE.slice(0, 1)).map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                setTrackedId(o.id);
                setFollow(true);
              }}
              className={`rounded-full border px-3 py-1.5 text-[12px] transition-colors ${o.id === trackedId ? "border-gold bg-gold text-void" : "border-ink/20 text-ink/75 hover:border-ink/50"}`}
            >
              {o.label}
            </button>
          ))}
          {custom && <span className="max-w-full truncate rounded-full border border-gold bg-gold px-3 py-1.5 text-[12px] text-void">{display(custom)}</span>}
        </div>
      </Section>
      <Section eyebrow={`NEXT PASSES · ${label.toUpperCase()}`} right={<span className="font-mono text-[9px] tracking-[0.16em] text-ink/35">ABOVE 10°</span>}>
        {load !== "ready" ? (
          <p className="text-[13px] text-ink/45">—</p>
        ) : list.length ? (
          <ul className="space-y-1.5">
            {list.slice(0, 6).map((p) => {
              const overhead = p.start.getTime() <= clock && p.end.getTime() > clock;
              const on = overhead || p.visible;
              return (
                <li key={p.start.getTime()} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${on ? "bg-gold/[0.08]" : "bg-ink/[0.03]"}`}>
                  <div className="w-[86px] shrink-0 whitespace-nowrap">
                    <p className="font-mono text-[10px] tracking-[0.1em] text-ink/50">{day(p.start, tz).split(" ").slice(0, 1)}</p>
                    <p className="font-mono text-[14px] tabular-nums text-ink">{time(p.start, tz)}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] text-ink/75">
                      {compass(p.startAzimuth)} → {compass(p.endAzimuth)} · {Math.max(1, Math.round((p.end.getTime() - p.start.getTime()) / 60_000))} min
                    </p>
                    <div className="mt-1.5 h-1 rounded-full bg-ink/10">
                      <div className={`h-1 rounded-full ${on ? "bg-gold" : "bg-ink/35"}`} style={{ width: `${Math.min(100, (p.maxElevation / 90) * 100)}%` }} />
                    </div>
                  </div>
                  <span className={`w-[84px] shrink-0 whitespace-nowrap text-right font-mono text-[9px] tracking-[0.12em] ${on ? "text-gold" : "text-ink/35"}`}>
                    {overhead ? "● NOW" : p.visible ? "VISIBLE" : "NOT VISIBLE"}
                    <span className="block text-ink/40">{Math.round(p.maxElevation)}° HIGH</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[13px] text-ink/55">No passes above 10° in the next three days from here.</p>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-ink/40">Visible: it catches sunlight while your sky is dark, so you can see it with your own eyes. Times are local to the place chosen.</p>
      </Section>
      <Section eyebrow="YOUR SKY">
        <PlacePicker state={placeState} />
        <p className="mt-2 text-[11px] text-ink/40">Computed in your browser. Your location never leaves this page.</p>
      </Section>
      <div className="border-t border-ink/[0.08] p-2">
        <Toggle
          label="All active satellites"
          note={
            swarmStatus.state === "loading"
              ? "Loading the full active list…"
              : swarmStatus.state === "on"
                ? `${swarmStatus.count.toLocaleString("en")} shown · updated every 4 s`
                : swarmStatus.state === "error"
                  ? "Unavailable right now"
                  : "Thousands of dots · heavier on older devices"
          }
          on={swarm}
          onChange={() => setSwarm((v) => !v)}
        />
      </div>
    </div>
  );

  return (
    <main className="relative bg-void text-ink">
      <section className={`relative w-full overflow-hidden ${clean ? "h-svh" : "h-[64svh] lg:h-svh"} min-h-[480px]`}>
        <div className="absolute inset-0">
          <OrbitScene
            sats={all}
            tracked={tracked}
            trackedName={label}
            observer={place}
            follow={follow}
            onUserMove={() => setFollow(false)}
            swarm={swarm}
            onSwarmStatus={setSwarmStatus}
            panelShift={clean ? 0 : 30}
          />
        </div>
        <SceneShade clean={clean} />
        <ToolBar title="Orbit Watch" tagline="Satellites and space stations where they are right now, and when they cross your sky." clean={clean} onClean={() => setClean(!clean)}>
          <button
            type="button"
            onClick={() => setFollow((f) => !f)}
            className={`flex items-center gap-2 rounded-full border px-3.5 py-2 text-[12px] backdrop-blur-md transition-colors ${follow ? "border-gold/70 bg-black/40 text-gold" : "border-ink/20 bg-black/40 text-ink/80 hover:border-ink/50"}`}
          >
            <span className={`block h-1.5 w-1.5 rounded-full ${follow ? "live-dot bg-gold" : "bg-ink/40"}`} />
            {follow ? "Following" : "Follow"}
            <span className="hidden max-w-[16ch] truncate sm:inline">{label}</span>
          </button>
        </ToolBar>

        <div className={`absolute left-4 top-20 z-10 w-[300px] ${wide(clean)}`}>{summary}</div>
        <aside className={`cosmo-scroll absolute bottom-4 right-4 top-20 z-10 w-[360px] overflow-y-auto ${wide(clean)}`}>
          {controls}
          <p className="mt-3 px-2 font-mono text-[9px] leading-relaxed tracking-[0.14em] text-ink/35">
            ORBITAL ELEMENTS FROM{" "}
            <a href="https://celestrak.org" target="_blank" rel="noreferrer" className="text-ink/60 hover:text-gold">
              CELESTRAK
            </a>{" "}
            · POSITIONS BY SGP4, LIVE IN YOUR BROWSER
          </p>
        </aside>
        <CleanHint clean={clean} />
      </section>

      {/* Phones and tablets: the panels under the globe. */}
      <div className={`space-y-4 px-4 pb-10 pt-4 lg:hidden ${clean ? "hidden" : ""}`}>
        {summary}
        {controls}
        <p className="px-2 font-mono text-[9px] tracking-[0.14em] text-ink/35">ORBITAL ELEMENTS FROM CELESTRAK · POSITIONS BY SGP4, LIVE IN YOUR BROWSER</p>
      </div>
    </main>
  );
}
