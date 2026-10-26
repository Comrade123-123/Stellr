"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { SwarmStatus } from "@/components/canvas/OrbitScene";
import ScrambleText from "@/components/ui/ScrambleText";
import { CITIES, guessCity, type Place } from "@/lib/places";
import { compass, parseTLE, passes, stateAt, type Pass, type Satellite, type State } from "@/lib/orbits";

const OrbitScene = dynamic(() => import("@/components/canvas/OrbitScene"), { ssr: false });

const MY_LOCATION = "__here";

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
        placeholder="FIND A SATELLITE · NAME OR NORAD NO."
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
        className="h-10 w-full rounded-full border border-ink/25 bg-void px-4 font-mono text-[11px] tracking-[0.12em] text-ink outline-none placeholder:text-ink/35 focus:border-ink/60"
      />
      {open && q && (
        <ul
          role="listbox"
          className="absolute inset-x-0 top-12 z-20 max-h-72 overflow-y-auto border border-ink/15 bg-void/95 backdrop-blur-md"
        >
          {results.map((s) => (
            <li key={s.id} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                className="flex w-full items-baseline justify-between gap-4 px-4 py-2.5 text-left font-mono text-[11px] tracking-[0.1em] text-ink/85 transition-colors hover:bg-ink/5 hover:text-gold"
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
  const [sats, setSats] = useState<Satellite[]>([]);
  const [load, setLoad] = useState<Load>("loading");
  const [trackedId, setTrackedId] = useState(25544);
  const [place, setPlace] = useState<Place | null>(null);
  const [here, setHere] = useState<Place | null>(null);
  const [geoError, setGeoError] = useState("");
  const [locating, setLocating] = useState(false);
  const [follow, setFollow] = useState(true);
  const [swarm, setSwarm] = useState(false);
  const [swarmStatus, setSwarmStatus] = useState<SwarmStatus>({ state: "off" });
  const [live, setLive] = useState<State | null>(null);
  const [clock, setClock] = useState(0);
  const [list, setList] = useState<Pass[]>([]);
  /** Satellites found by search that aren't in the loaded groups; drawn and trackable like the rest. */
  const [extra, setExtra] = useState<Satellite[]>([]);

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
    // Both need the browser: the time zone for a first guess, and the network for elements.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlace(guessCity());
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

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setGeoError("Location isn't available in this browser.");
      return;
    }
    setLocating(true);
    setGeoError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const mine: Place = {
          name: `${pos.coords.latitude.toFixed(1)}°, ${pos.coords.longitude.toFixed(1)}°`,
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        };
        setHere(mine);
        setPlace(mine);
        setLocating(false);
      },
      () => {
        setGeoError("Couldn't get your location. Pick a city instead.");
        setLocating(false);
      },
      { maximumAge: 600_000, timeout: 10_000 },
    );
  };

  const tz = place?.timeZone;
  const label = TRACKABLE.find((t) => t.id === trackedId)?.label ?? tracked?.name ?? "";
  const noOrbit = tracked && !live;

  return (
    <main className="relative min-h-svh bg-void text-ink lg:h-svh lg:overflow-hidden">
      {/* Globe: fills the screen on desktop, the top of it on phones. */}
      <div className="relative h-[58svh] w-full lg:absolute lg:inset-0 lg:h-full">
        <OrbitScene
          sats={all}
          tracked={tracked}
          trackedName={label}
          observer={place}
          follow={follow}
          onUserMove={() => setFollow(false)}
          swarm={swarm}
          onSwarmStatus={setSwarmStatus}
        />
      </div>

      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-5 sm:p-8">
        <div className="pointer-events-auto">
          <Link href="/" className="font-mono text-[11px] tracking-[0.2em] text-ink/60 transition-colors hover:text-gold">
            <ScrambleText text="← STELLR" />
          </Link>
          <h1 className="display mt-5 text-[clamp(1.6rem,3vw,2.8rem)] text-ink">Orbit Watch</h1>
          <p className="caps mt-2 hidden max-w-[34ch] text-[11px] text-ink/55 sm:block sm:text-[12px]">
            Satellites and space stations where they are right now, and when they cross your sky.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFollow((f) => !f)}
          className={`pointer-events-auto whitespace-nowrap rounded-full border px-4 py-2 font-mono text-[10px] tracking-[0.2em] transition-colors ${
            follow ? "border-gold text-gold" : "border-ink/30 text-ink/70 hover:border-ink/60"
          }`}
        >
          {follow ? "● FOLLOWING" : "FOLLOW"}{" "}
          <span className="hidden max-w-[24ch] truncate align-bottom sm:inline-block">{label.toUpperCase()}</span>
        </button>
      </header>

      <aside className="relative z-10 px-5 pb-10 sm:px-8 lg:absolute lg:bottom-8 lg:right-8 lg:top-28 lg:w-[380px] lg:overflow-y-auto lg:p-0">
        <div className="frame bg-void/70 backdrop-blur-md">
          {/* What to follow */}
          <div className="border-b border-ink/10 p-5">
            <SatelliteSearch onBoard={all} onPick={pick} />
            <div className="mt-4 flex flex-wrap gap-2">
              {(options.length ? options : TRACKABLE.slice(0, 1)).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    setTrackedId(o.id);
                    setFollow(true);
                  }}
                  className={`rounded-full border px-4 py-1.5 font-mono text-[10px] tracking-[0.2em] transition-colors ${
                    o.id === trackedId ? "border-gold bg-gold text-void" : "border-ink/25 text-ink/70 hover:border-ink/60"
                  }`}
                >
                  {o.label.toUpperCase()}
                </button>
              ))}
              {custom && (
                <span className="max-w-full truncate rounded-full border border-gold bg-gold px-4 py-1.5 font-mono text-[10px] tracking-[0.2em] text-void">
                  {display(custom)}
                </span>
              )}
            </div>
            {custom && (
              <p className="mt-3 font-mono text-[10px] tracking-[0.15em] text-ink/45">NORAD #{custom.id}</p>
            )}
          </div>

          {/* Live state */}
          <dl className="grid grid-cols-2 border-b border-ink/10 font-mono text-xs">
            {[
              ["LATITUDE", live ? latLabel(live.latitude) : "—"],
              ["LONGITUDE", live ? lonLabel(live.longitude) : "—"],
              ["ALTITUDE", live ? `${Math.round(live.altitudeKm)} KM` : "—"],
              ["SPEED", live ? `${fixed(live.speedKmS)} KM/S` : "—"],
            ].map(([k, v], i) => (
              <div key={k} className={`p-4 ${i % 2 === 0 ? "border-r" : ""} ${i < 2 ? "border-b" : ""} border-ink/10`}>
                <dt className="text-[10px] tracking-[0.2em] text-ink/45">{k}</dt>
                <dd className="mt-1.5 tabular-nums tracking-[0.06em] text-gold">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="border-b border-ink/10 px-4 py-3 font-mono text-[10px] tracking-[0.2em] text-ink/55">
            {load === "loading" && "LOADING ORBITAL ELEMENTS…"}
            {load === "error" && (
              <>
                ORBITAL DATA UNAVAILABLE.{" "}
                <button type="button" onClick={fetchAll} className="text-gold underline-offset-4 hover:underline">
                  RETRY
                </button>
              </>
            )}
            {load === "ready" && noOrbit && "NO CURRENT ORBIT · IT MAY HAVE RE-ENTERED"}
            {load === "ready" && live && (live.sunlit ? "IN SUNLIGHT" : "IN EARTH'S SHADOW")}
            {load === "ready" && ` · ${all.length} OBJECTS ON THE GLOBE`}
          </p>

          {/* Every active satellite, on request: thousands of dots, so it starts off. */}
          <div className="flex items-center justify-between gap-4 border-b border-ink/10 px-4 py-3">
            <div className="font-mono text-[10px] tracking-[0.2em]">
              <p className="text-ink/70">ALL ACTIVE SATELLITES</p>
              <p className="mt-1 text-ink/40">
                {swarmStatus.state === "loading" && "LOADING THE FULL ACTIVE LIST…"}
                {swarmStatus.state === "on" && `${swarmStatus.count.toLocaleString("en")} SHOWN · UPDATED EVERY 4 S`}
                {swarmStatus.state === "error" && "UNAVAILABLE RIGHT NOW"}
                {swarmStatus.state === "off" && "THOUSANDS OF DOTS · HEAVIER ON OLDER DEVICES"}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={swarm}
              aria-label="Show all active satellites"
              onClick={() => setSwarm((v) => !v)}
              className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${swarm ? "border-gold bg-gold" : "border-ink/30"}`}
            >
              <span
                className={`absolute top-1/2 block h-4 w-4 -translate-y-1/2 rounded-full transition-all ${swarm ? "left-[22px] bg-void" : "left-[3px] bg-ink/70"}`}
              />
            </button>
          </div>

          {/* Where the visitor is */}
          <div className="border-b border-ink/10 p-5">
            <p className="font-mono text-[10px] tracking-[0.2em] text-ink/45">YOUR SKY</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                aria-label="Location"
                value={place && place === here ? MY_LOCATION : (place?.name ?? "")}
                onChange={(e) => {
                  if (e.target.value === MY_LOCATION && here) setPlace(here);
                  else setPlace(CITIES.find((c) => c.name === e.target.value) ?? null);
                }}
                className="h-9 min-w-0 flex-1 rounded-full border border-ink/25 bg-void px-4 font-mono text-[11px] tracking-[0.12em] text-ink outline-none focus:border-ink/60"
              >
                {here && <option value={MY_LOCATION}>MY LOCATION ({here.name})</option>}
                {CITIES.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name.toUpperCase()}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={locate}
                disabled={locating}
                className="h-9 shrink-0 rounded-full border border-ink/25 px-4 font-mono text-[10px] tracking-[0.18em] text-ink/80 transition-colors hover:border-ink/60 disabled:opacity-50"
              >
                {locating ? "LOCATING…" : "USE MY LOCATION"}
              </button>
            </div>
            {geoError && <p className="mt-2 font-mono text-[10px] text-gold">{geoError}</p>}
            <p className="caps mt-3 text-[10px] text-ink/45">Computed in your browser. Your location never leaves this page.</p>
          </div>

          {/* Passes */}
          <div className="p-5">
            <p className="font-mono text-[10px] tracking-[0.2em] text-ink/45">
              NEXT PASSES · {label.toUpperCase()} · ABOVE 10°
            </p>
            {load !== "ready" ? (
              <p className="mt-4 font-mono text-xs text-ink/45">—</p>
            ) : list.length ? (
              <ul className="mt-3 divide-y divide-ink/10">
                {list.slice(0, 6).map((p) => {
                  const overhead = p.start.getTime() <= clock && p.end.getTime() > clock;
                  return (
                    <li key={p.start.getTime()} className="flex items-start justify-between gap-4 py-3 font-mono text-xs">
                      <div>
                        <p className="tracking-[0.08em] text-ink">
                          {day(p.start, tz)} · {time(p.start, tz)}
                        </p>
                        <p className="mt-1 text-[10px] tracking-[0.14em] text-ink/50">
                          {compass(p.startAzimuth)} → {compass(p.endAzimuth)} · {Math.round(p.maxElevation)}° HIGH ·{" "}
                          {Math.max(1, Math.round((p.end.getTime() - p.start.getTime()) / 60_000))} MIN
                        </p>
                      </div>
                      <span
                        className={`shrink-0 text-[10px] tracking-[0.18em] ${overhead || p.visible ? "text-gold" : "text-ink/35"}`}
                      >
                        {overhead ? "● NOW" : p.visible ? "VISIBLE" : "NOT VISIBLE"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="caps mt-4 text-[11px] text-ink/55">No passes above 10° in the next three days from here.</p>
            )}
            <p className="caps mt-4 text-[10px] leading-relaxed text-ink/40">
              Visible means it catches sunlight while your sky is dark, so you can see it with your own eyes. Times are
              local to the place chosen.
            </p>
          </div>
        </div>

        <p className="mt-4 font-mono text-[10px] tracking-[0.15em] text-ink/40">
          ORBITAL ELEMENTS FROM{" "}
          <a href="https://celestrak.org" target="_blank" rel="noreferrer" className="text-ink/70 hover:text-gold">
            CELESTRAK
          </a>{" "}
          · POSITIONS BY SGP4, LIVE IN YOUR BROWSER
        </p>
      </aside>
    </main>
  );
}
