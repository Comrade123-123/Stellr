"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { Swarm } from "@/components/canvas/AsteroidScene";
import type { Clock, Look, Rock } from "@/components/canvas/CosmoscopeScene";
import PlacePicker, { usePlace } from "@/components/PlacePicker";
import ScrambleText from "@/components/ui/ScrambleText";
import { asteroidAt, type Elements } from "@/lib/asteroids";
import {
  AU_KM,
  BODIES,
  CRAFT,
  MOONS,
  bodyInfo,
  distances,
  helio,
  moonOffset,
  nextOpposition,
  night,
  stormInDaylight,
  trackAt,
  trackSpan,
  type BodyName,
  type MoonName,
  type Track,
} from "@/lib/cosmoscope";

const Scene = dynamic(() => import("@/components/canvas/CosmoscopeScene"), { ssr: false });

const DAY_MS = 86_400_000;
/** Playback speeds, days per second; 0 is paused. */
const SPEEDS: [string, number, string][] = [
  ["DAY/S", 1, "A DAY EVERY SECOND"],
  ["WEEK/S", 7, "A WEEK EVERY SECOND"],
  ["MONTH/S", 30, "A MONTH EVERY SECOND"],
  ["YEAR/S", 365, "A YEAR EVERY SECOND"],
];
/** The slider reaches this far either side of today; the date box goes anywhere. */
const SLIDER_DAYS = 3650;

const fmt = (t: number, opts: Intl.DateTimeFormatOptions, timeZone?: string) =>
  new Intl.DateTimeFormat("en-GB", { ...opts, timeZone }).format(new Date(t)).toUpperCase();

function lightTime(s: number) {
  if (s < 60) return `${s.toFixed(1)} S`;
  if (s < 3600) return `${Math.floor(s / 60)} MIN ${Math.round(s % 60)} S`;
  return `${Math.floor(s / 3600)} H ${Math.round((s % 3600) / 60)} MIN`;
}
const auText = (au: number) => `${au.toFixed(au < 10 ? 3 : 2)} AU`;
const kmText = (au: number) => {
  const km = au * AU_KM;
  return km >= 1e9 ? `${(km / 1e9).toFixed(2)} BILLION KM` : `${(km / 1e6).toFixed(1)} MILLION KM`;
};
const dayText = (h: number) => (Math.abs(h) < 48 ? `${Math.abs(h).toFixed(1)} HOURS` : `${(Math.abs(h) / 24).toFixed(1)} EARTH DAYS`);
const yearText = (d: number) => (d < 730 ? `${Math.round(d)} DAYS` : `${(d / 365.25).toFixed(1)} YEARS`);
const AU_LIGHT_S = 499.004784;
const isBody = (k: string | null): k is BodyName => BODIES.some((b) => b.name === k);
const isMoon = (k: string | null): k is MoonName => MOONS.some((m) => m.name === k);
/** Titan's track is fetched in 20-day blocks of ±40 days, so the moment shown is always well inside one. */
const TITAN_BLOCK_DAYS = 20;

const chip = (on: boolean, tone = "border-gold bg-gold text-void") =>
  `whitespace-nowrap rounded-full border px-3 py-1.5 font-mono text-[9px] tracking-[0.2em] transition-colors sm:px-4 sm:py-2 sm:text-[10px] ${on ? tone : "border-ink/30 text-ink/70 hover:border-ink/60"}`;

/** A labelled figure in the panel. */
function Fact({ label, value, sub, wide = false, accent = false }: { label: string; value: string; sub?: string; wide?: boolean; accent?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-[10px] tracking-[0.2em] text-ink/45">{label}</dt>
      <dd className={`mt-1 text-sm ${accent ? "text-gold" : "text-ink"}`}>{value}</dd>
      {sub && <dd className="mt-0.5 text-[10px] tracking-[0.12em] text-ink/50">{sub}</dd>}
    </div>
  );
}

/** Cosmoscope: the Sun and planets where they really are, at any moment, to fly between. */
export default function CosmoscopeTool() {
  const clock = useRef<Clock>({ t: 0, rate: 0, live: true });
  const [shown, setShown] = useState(0);
  const [mode, setMode] = useState<{ live: boolean; rate: number }>({ live: true, rate: 0 });
  const [reverse, setReverse] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [trueScale, setTrueScale] = useState(false);
  const [look, setLook] = useState<Look | null>(null);
  /** JPL Horizons paths: spacecraft by name, and "Titan". */
  const [tracks, setTracks] = useState<Map<string, Track>>(() => new Map());
  const [trackFailed, setTrackFailed] = useState<Set<string>>(() => new Set());
  const [swarm, setSwarm] = useState<Swarm | null>(null);
  const [hazard, setHazard] = useState<"off" | "loading" | "on" | "error">("off");
  const [rock, setRock] = useState<(Rock & { des: string }) | null>(null);
  const placeState = usePlace();
  const place = placeState.place;
  const reducedMotion = useMemo(() => typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  /** When the page opened; 0 until mounted, since the time only exists in the browser. */
  const [opened, setOpened] = useState(0);

  // The scene moves the clock every frame; the panel reads it a few times a second.
  useEffect(() => {
    clock.current.t = Date.now();
    setOpened(clock.current.t);
    const read = () => setShown(clock.current.t);
    read();
    const id = setInterval(read, 250);
    return () => clearInterval(id);
  }, []);

  const setRate = (rate: number, back = reverse) => {
    clock.current.live = false;
    clock.current.rate = back ? -rate : rate;
    setMode({ live: false, rate });
  };
  const goLive = () => {
    clock.current.live = true;
    clock.current.rate = 0;
    clock.current.t = Date.now();
    setMode({ live: true, rate: 0 });
    setShown(clock.current.t);
  };
  const jump = (t: number, body?: string | null) => {
    clock.current.live = false;
    clock.current.rate = 0;
    clock.current.t = t;
    setMode({ live: false, rate: 0 });
    setShown(t);
    if (body !== undefined) setSelected(body);
  };

  const addTrack = (name: string, points: number[]) =>
    setTracks((prev) => new Map(prev).set(name, Float64Array.from(points)));
  const failTrack = (name: string) => setTrackFailed((prev) => new Set(prev).add(name));

  // Spacecraft paths, once: each is a whole mission, cached a day at the edge.
  useEffect(() => {
    for (const c of CRAFT) {
      fetch(`/api/cosmoscope/track?id=${c.id}`)
        .then(async (res) => {
          const data = (await res.json()) as { points?: number[] };
          if (!res.ok || !data.points?.length) throw new Error(String(res.status));
          addTrack(c.name, data.points);
        })
        .catch(() => failTrack(c.name));
    }
  }, []);

  // Titan around Saturn, for the stretch of time being shown.
  const titanBlock = shown ? Math.floor(shown / (TITAN_BLOCK_DAYS * DAY_MS)) : 0;
  useEffect(() => {
    if (!titanBlock) return;
    const around = new Date(titanBlock * TITAN_BLOCK_DAYS * DAY_MS).toISOString().slice(0, 10);
    let cancelled = false;
    fetch(`/api/cosmoscope/track?id=606&around=${around}`)
      .then(async (res) => {
        const data = (await res.json()) as { points?: number[] };
        if (!res.ok || !data.points?.length) throw new Error(String(res.status));
        if (!cancelled) addTrack("Titan", data.points);
      })
      .catch(() => !cancelled && failTrack("Titan"));
    return () => {
      cancelled = true;
    };
  }, [titanBlock]);

  // An asteroid sent from Asteroid Sentinel: /cosmoscope?asteroid=99942&at=2029-04-13T21:46Z.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const des = params.get("asteroid")?.trim();
    if (!des) return;
    const at = Date.parse(params.get("at") ?? "");
    fetch(`/api/asteroids/orbit?des=${encodeURIComponent(des)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const el = (await res.json()) as Elements;
        setRock({ el, name: el.name, des });
        if (Number.isFinite(at)) {
          clock.current.live = false;
          clock.current.rate = 0;
          clock.current.t = at;
          setMode({ live: false, rate: 0 });
          setShown(at);
        }
        setSelected("asteroid");
      })
      .catch(() => {});
  }, []);

  const toggleHazard = () => {
    if (hazard === "on") return setHazard("off");
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

  // Today's start, for the slider's zero.
  const today = opened ? Math.floor(opened / DAY_MS) * DAY_MS : 0;
  const sliderDays = shown ? Math.max(-SLIDER_DAYS, Math.min(SLIDER_DAYS, Math.round((shown - today) / DAY_MS))) : 0;

  const presets = useMemo(() => {
    if (!opened) return [];
    const now = new Date(opened);
    const list: { label: string; t: number; body: string | null }[] = [];
    for (const p of ["Mars", "Jupiter", "Saturn"] as const) {
      const d = nextOpposition(p, now);
      if (d) list.push({ label: `${p.toUpperCase()} AT OPPOSITION · ${fmt(d.getTime(), { month: "short", year: "numeric" })}`, t: d.getTime(), body: p });
    }
    if (now.getTime() < Date.UTC(2029, 3, 14)) list.push({ label: "APOPHIS FLIES PAST EARTH · APR 2029", t: Date.UTC(2029, 3, 13, 21, 46), body: "Earth" });
    return list;
  }, [opened]);

  const info = isBody(selected) ? bodyInfo(selected) : null;
  const dist = useMemo(() => (isBody(selected) && shown ? distances(selected, new Date(shown)) : null), [selected, shown]);
  // The night is worked out once per day shown, not every tick.
  const nightDay = shown ? Math.floor(shown / DAY_MS) : 0;
  const sky = useMemo(
    () => (isBody(selected) && selected !== "Sun" && selected !== "Earth" && place && nightDay ? night(selected, place, new Date(nightDay * DAY_MS)) : null),
    [selected, place, nightDay],
  );

  /** Heliocentric ecliptic position (AU) of anything the scene shows, or null where it has none. */
  const where = (key: string, t: number): [number, number, number] | null => {
    const date = new Date(t);
    if (isBody(key)) return helio(key, date);
    if (isMoon(key)) {
      const m = MOONS.find((x) => x.name === key)!;
      const off = moonOffset(key, date, tracks.get("Titan") ?? null);
      if (!off) return null;
      const p = helio(m.parent, date);
      return [p[0] + off[0], p[1] + off[1], p[2] + off[2]];
    }
    if (key === "asteroid") return rock ? asteroidAt(rock.el, date) : null;
    const track = tracks.get(key);
    return track ? trackAt(track, date) : null;
  };
  /** From Earth and the Sun (AU) for an object that isn't a planet. */
  const away = (key: string, t: number) => {
    const p = where(key, t);
    if (!p) return null;
    const e = helio("Earth", new Date(t));
    return { earthAu: Math.hypot(p[0] - e[0], p[1] - e[1], p[2] - e[2]), sunAu: Math.hypot(...p) };
  };
  const moon = isMoon(selected) ? MOONS.find((m) => m.name === selected)! : null;
  const craft = CRAFT.find((c) => c.name === selected) ?? null;
  const objectDist = shown && selected && !isBody(selected) ? away(selected, shown) : null;
  const craftSpeed = (() => {
    if (!craft || !shown) return null;
    const a = where(craft.name, shown - DAY_MS / 2);
    const b = where(craft.name, shown + DAY_MS / 2);
    return a && b ? (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * AU_KM) / 86_400 : null;
  })();
  const craftTable = shown && !selected ? CRAFT.map((c) => ({ name: c.name, d: away(c.name, shown) })) : [];
  const table = useMemo(
    () => (shown && !selected ? BODIES.filter((b) => b.name !== "Earth").map((b) => ({ name: b.name, d: distances(b.name, new Date(shown)) })) : []),
    [shown, selected],
  );
  const tz = place?.timeZone;
  const isTonight = shown ? fmt(shown, { day: "2-digit", month: "short", year: "numeric" }, tz) === fmt(opened, { day: "2-digit", month: "short", year: "numeric" }, tz) : true;

  return (
    <main className="relative min-h-svh bg-void text-ink lg:h-svh lg:overflow-hidden">
      <div className="relative h-[58svh] w-full lg:absolute lg:inset-0 lg:h-full">
        <Scene
          clock={clock}
          selected={selected}
          onSelect={setSelected}
          trueScale={trueScale}
          tracks={tracks}
          swarm={hazard === "on" ? swarm : null}
          rock={rock}
          look={look}
          reducedMotion={reducedMotion}
        />
      </div>

      {/* A soft shade behind the title, so it stays readable when a planet drifts behind it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 hidden h-[340px] w-[680px] sm:block"
        style={{ background: "radial-gradient(ellipse at 0% 0%, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.45) 45%, transparent 72%)" }}
      />
      <header className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-4 p-5 sm:flex-nowrap sm:p-8">
        <div className="pointer-events-auto">
          <Link href="/" className="font-mono text-[11px] tracking-[0.2em] text-ink/60 transition-colors hover:text-gold">
            <ScrambleText text="← STELLR" />
          </Link>
          <h1 className="display mt-5 text-[clamp(1.6rem,3vw,2.8rem)] text-ink">Cosmoscope</h1>
          <p className="caps mt-2 text-[11px] text-ink/60 sm:hidden">A live map of the Solar System, at any moment.</p>
          <p className="caps mt-2 hidden max-w-[40ch] text-[11px] leading-relaxed text-ink/60 sm:block sm:text-[12px]">
            A live map of the Solar System. The Sun, the planets, their larger moons and four spacecraft, each exactly where it is at the
            moment shown: now, or any date from 1900 to 2199.
          </p>
          <p className="mt-3 hidden font-mono text-[10px] tracking-[0.18em] text-ink/40 lg:block">CLICK A NAME TO FLY THERE · DRAG TO TURN · SCROLL TO ZOOM</p>
        </div>
        <div className="pointer-events-auto flex flex-wrap gap-2 sm:max-w-[60%] sm:justify-end">
          <button
            type="button"
            aria-pressed={trueScale}
            title="Show distances and sizes in their true proportions"
            onClick={() => setTrueScale(!trueScale)}
            className={chip(trueScale)}
          >
            TRUE SCALE
          </button>
          <button
            type="button"
            aria-pressed={hazard === "on"}
            title="Show every known potentially hazardous asteroid"
            onClick={toggleHazard}
            className={chip(hazard === "on", "border-[#ff6a3d] bg-[#ff6a3d] text-void")}
          >
            {hazard === "loading" ? "HAZARDOUS…" : "HAZARDOUS"}
          </button>
        </div>
      </header>

      {/* Time controls: over the scene on wide screens, under it on phones. */}
      <section
        aria-label="Time"
        className="relative z-10 px-5 pt-4 sm:px-8 lg:absolute lg:bottom-8 lg:left-8 lg:right-[436px] lg:p-0"
      >
        <div className="frame bg-void/70 p-4 backdrop-blur-md">
          <p className="font-mono text-[9px] tracking-[0.2em] text-ink/40">THE MOMENT SHOWN</p>
          <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 font-mono">
            <p className="text-sm tracking-[0.14em] text-ink tabular-nums">
              {shown ? fmt(shown, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }, "UTC") : "—"} UTC
            </p>
            <p className="text-[10px] tracking-[0.18em] text-ink/45">
              {mode.live ? (
                <>
                  <span className="text-gold">●</span> LIVE · REAL TIME
                </>
              ) : mode.rate ? (
                `${reverse ? "REWINDING" : "PLAYING"} · ${SPEEDS.find(([, r]) => r === mode.rate)?.[2] ?? ""}`
              ) : (
                "PAUSED · PRESS NOW TO RETURN"
              )}
            </p>
          </div>
          <label htmlFor="cosmo-time" className="sr-only">
            Days from today
          </label>
          <input
            id="cosmo-time"
            type="range"
            min={-SLIDER_DAYS}
            max={SLIDER_DAYS}
            step={1}
            value={sliderDays}
            onChange={(e) => jump(today + Number(e.target.value) * DAY_MS + 12 * 3_600_000)}
            className="mt-3 w-full accent-[#c9a46a]"
          />
          <div className="mt-1 flex justify-between font-mono text-[9px] tracking-[0.16em] text-ink/35">
            <span>10 YEARS AGO</span>
            <span>TODAY</span>
            <span>10 YEARS AHEAD</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={goLive}
              className={`rounded-full border px-3 py-1 font-mono text-[10px] tracking-[0.18em] transition-colors ${
                mode.live ? "border-gold bg-gold text-void" : "border-ink/25 text-ink/70 hover:border-ink/60"
              }`}
            >
              NOW
            </button>
            <button
              type="button"
              onClick={() => setRate(0)}
              aria-label="Pause"
              className={`rounded-full border px-3 py-1 font-mono text-[10px] tracking-[0.18em] transition-colors ${
                !mode.live && !mode.rate ? "border-gold bg-gold text-void" : "border-ink/25 text-ink/70 hover:border-ink/60"
              }`}
            >
              PAUSE
            </button>
            {SPEEDS.map(([label, rate]) => (
              <button
                key={label}
                type="button"
                onClick={() => setRate(rate)}
                className={`rounded-full border px-3 py-1 font-mono text-[10px] tracking-[0.18em] transition-colors ${
                  !mode.live && mode.rate === rate ? "border-gold bg-gold text-void" : "border-ink/25 text-ink/70 hover:border-ink/60"
                }`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={reverse}
              onClick={() => {
                setReverse(!reverse);
                if (!mode.live && mode.rate) setRate(mode.rate, !reverse);
              }}
              className={`rounded-full border px-3 py-1 font-mono text-[10px] tracking-[0.18em] transition-colors ${
                reverse ? "border-ink/80 bg-ink text-void" : "border-ink/25 text-ink/70 hover:border-ink/60"
              }`}
            >
              ⇄ REWIND
            </button>
            <label htmlFor="cosmo-date" className="sr-only">
              Go to date
            </label>
            <input
              id="cosmo-date"
              type="date"
              min="1900-01-01"
              max="2199-12-31"
              value={shown ? new Date(shown).toISOString().slice(0, 10) : ""}
              onChange={(e) => {
                const t = Date.parse(`${e.target.value}T12:00:00Z`);
                if (Number.isFinite(t)) jump(t);
              }}
              className="h-7 rounded-full border border-ink/25 bg-void px-3 font-mono text-[10px] tracking-[0.12em] text-ink outline-none [color-scheme:dark] focus:border-ink/60"
            />
          </div>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[10px] tracking-[0.16em]">
            <span className="text-[9px] tracking-[0.2em] text-ink/40">JUMP TO</span>
            {presets.map((p) => (
              <button key={p.label} type="button" onClick={() => jump(p.t, p.body)} className="text-left text-ink/55 transition-colors hover:text-gold">
                → {p.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <aside className="relative z-10 px-5 pb-10 pt-4 sm:px-8 lg:absolute lg:bottom-8 lg:right-8 lg:top-28 lg:w-[388px] lg:overflow-y-auto lg:overflow-x-hidden lg:p-[4px]">
        <div className="frame bg-void/70 backdrop-blur-md">
          {info && dist ? (
            <div className="p-5">
              <button type="button" onClick={() => setSelected(null)} className="font-mono text-[10px] tracking-[0.2em] text-gold hover:underline">
                ← WHOLE SOLAR SYSTEM
              </button>
              <h2 className="display mt-4 text-2xl text-ink">{info.name}</h2>
              <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-ink/45">{info.kind.toUpperCase()}</p>
              <p className="mt-3 text-[13px] leading-relaxed text-ink/70">{info.about}</p>

              <dl className="mt-5 grid grid-cols-2 gap-4 font-mono">
                {dist.earthAu !== null ? (
                  <div className="col-span-2">
                    <dt className="text-[10px] tracking-[0.2em] text-ink/45">FROM EARTH</dt>
                    <dd className="mt-1 text-sm text-gold">{kmText(dist.earthAu)}</dd>
                    <dd className="mt-0.5 text-[10px] tracking-[0.12em] text-ink/50">
                      {auText(dist.earthAu)} · ITS LIGHT TAKES {lightTime(dist.lightS!)} TO REACH US
                    </dd>
                  </div>
                ) : (
                  <div className="col-span-2">
                    <dt className="text-[10px] tracking-[0.2em] text-ink/45">FROM EARTH</dt>
                    <dd className="mt-1 text-sm text-gold">YOU ARE HERE</dd>
                  </div>
                )}
                {dist.sunAu !== null && (
                  <div className="col-span-2">
                    <dt className="text-[10px] tracking-[0.2em] text-ink/45">FROM THE SUN</dt>
                    <dd className="mt-1 text-sm text-ink">{kmText(dist.sunAu)}</dd>
                    <dd className="mt-0.5 text-[10px] tracking-[0.12em] text-ink/50">
                      {auText(dist.sunAu)} · SUNLIGHT TAKES {lightTime(dist.sunAu * 499.004784)} TO GET THERE
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-[10px] tracking-[0.2em] text-ink/45">{info.name === "Sun" ? "ONE TURN" : "LENGTH OF A DAY"}</dt>
                  <dd className="mt-1 text-sm text-ink">{dayText(info.dayHours)}</dd>
                  <dd className="mt-0.5 text-[10px] tracking-[0.12em] text-ink/50">
                    {info.name === "Sun" ? "AT ITS EQUATOR" : info.spinHours < 0 ? "SUNRISE TO SUNRISE · SPINS BACKWARDS" : "SUNRISE TO SUNRISE"}
                  </dd>
                </div>
                {info.yearDays > 0 && (
                  <div>
                    <dt className="text-[10px] tracking-[0.2em] text-ink/45">LENGTH OF A YEAR</dt>
                    <dd className="mt-1 text-sm text-ink">{yearText(info.yearDays)}</dd>
                    <dd className="mt-0.5 text-[10px] tracking-[0.12em] text-ink/50">ONE LAP OF THE SUN</dd>
                  </div>
                )}
                <div>
                  <dt className="text-[10px] tracking-[0.2em] text-ink/45">DIAMETER</dt>
                  <dd className="mt-1 text-sm text-ink">{info.diameterKm.toLocaleString("en")} KM</dd>
                  {info.name !== "Earth" && (
                    <dd className="mt-0.5 text-[10px] tracking-[0.12em] text-ink/50">
                      {(info.diameterKm / 12_756).toFixed(info.diameterKm < 12_756 ? 2 : 1)} × EARTH
                    </dd>
                  )}
                </div>
                <div>
                  <dt className="text-[10px] tracking-[0.2em] text-ink/45">{info.name === "Sun" ? "SURFACE TEMPERATURE" : "AVERAGE TEMPERATURE"}</dt>
                  <dd className="mt-1 text-sm text-ink">{info.tempC.toLocaleString("en")} °C</dd>
                </div>
                {info.name !== "Sun" && (
                  <div>
                    <dt className="text-[10px] tracking-[0.2em] text-ink/45">KNOWN MOONS</dt>
                    <dd className="mt-1 text-sm text-ink">{info.moons}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-[10px] tracking-[0.2em] text-ink/45">AXIAL TILT</dt>
                  <dd className="mt-1 text-sm text-ink">{info.tilt}°</dd>
                  <dd className="mt-0.5 text-[10px] tracking-[0.12em] text-ink/50">{info.tilt > 90 ? "TURNED OVER: IT SPINS BACKWARDS" : "LEAN OF ITS SPIN AXIS"}</dd>
                </div>
              </dl>

              {(info.name === "Jupiter" || info.name === "Saturn") && !trueScale && (
                <button
                  type="button"
                  onClick={() => {
                    // The storm may be on the night side: run the clock on (under ten hours) until it turns into daylight.
                    if (info.name === "Jupiter") {
                      const lit = stormInDaylight(new Date(clock.current.t)).getTime();
                      if (lit !== clock.current.t) jump(lit);
                    }
                    setLook({ kind: info.name === "Jupiter" ? "storm" : "rings", n: Date.now() });
                  }}
                  className="mt-5 rounded-full border border-gold/60 px-4 py-2 font-mono text-[10px] tracking-[0.2em] text-gold transition-colors hover:bg-gold hover:text-void"
                >
                  {info.name === "Jupiter" ? "FACE THE GREAT RED SPOT →" : "SEE THE RINGS FROM ABOVE →"}
                </button>
              )}
              {info.name === "Jupiter" && (
                <p className="caps mt-3 text-[11px] leading-relaxed text-ink/55">
                  The Great Red Spot is a storm wider than Earth that has raged for at least 150 years. Jupiter turns once in under ten hours, carrying it round; the button moves time on to when it is in daylight. Its longitude here is approximate.
                </p>
              )}
              {info.name === "Saturn" && (
                <p className="caps mt-3 text-[11px] leading-relaxed text-ink/55">
                  The rings are 280,000 km across but mostly only tens of metres thick: ice and rock, lit here by the Sun, with Saturn&apos;s shadow falling across them.
                </p>
              )}

              {MOONS.some((m) => m.parent === info.name) && (
                <div className="mt-5">
                  <p className="font-mono text-[10px] tracking-[0.2em] text-ink/45">{trueScale ? "MOONS · SWITCH OFF TRUE SCALE TO SEE THEM" : "ITS MOONS ON THE MAP · CHOOSE ONE TO FLY THERE"}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {MOONS.filter((m) => m.parent === info.name).map((m) => (
                      <button
                        key={m.name}
                        type="button"
                        onClick={() => setSelected(m.name)}
                        className="rounded-full border border-ink/25 px-3 py-1 font-mono text-[10px] tracking-[0.18em] text-ink/75 transition-colors hover:border-ink/60 hover:text-ink"
                      >
                        {m.name.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {sky && (
                <div className="mt-6 border-t border-ink/10 pt-5">
                  <p className="font-mono text-[10px] tracking-[0.2em] text-ink/45">
                    CAN YOU SEE IT? · {isTonight ? "TONIGHT" : `NIGHT OF ${fmt(shown, { day: "2-digit", month: "short", year: "numeric" }, tz)}`} FROM {place?.name.toUpperCase()}
                  </p>
                  <p className="caps mt-2 text-[12px] leading-relaxed text-ink/80">
                    {sky.kind === "visible"
                      ? `Yes. It is up from ${fmt(sky.from.getTime(), { hour: "2-digit", minute: "2-digit" }, tz)} to ${fmt(sky.until.getTime(), { hour: "2-digit", minute: "2-digit" }, tz)}; best around ${fmt(sky.best.getTime(), { hour: "2-digit", minute: "2-digit" }, tz)}, ${Math.round(sky.altitude)}° above the horizon in the ${sky.direction}, shining at magnitude ${sky.magnitude.toFixed(1)}${sky.magnitude < 0 ? ", brighter than almost every star" : ""}.`
                      : sky.kind === "glare"
                        ? `No. It sits only ${Math.round(sky.elongation)}° from the Sun in the sky, lost in its glare.`
                        : sky.kind === "below"
                          ? "No. It stays below the horizon all night from here."
                          : "No proper night at this latitude on this date: the Sun never sets far enough."}
                  </p>
                  {(selected === "Uranus" || selected === "Neptune") && sky.kind === "visible" && (
                    <p className="mt-1 font-mono text-[10px] tracking-[0.12em] text-ink/45">
                      {selected === "Uranus" ? "AT THE EDGE OF NAKED-EYE SIGHT; BINOCULARS HELP." : "TOO FAINT FOR THE EYE; NEEDS A TELESCOPE."}
                    </p>
                  )}
                  <div className="mt-4">
                    <PlacePicker state={placeState} />
                  </div>
                </div>
              )}
            </div>
          ) : moon ? (
            <div className="p-5">
              <button type="button" onClick={() => setSelected(moon.parent)} className="font-mono text-[10px] tracking-[0.2em] text-gold hover:underline">
                ← {moon.parent.toUpperCase()}
              </button>
              <h2 className="display mt-4 text-2xl text-ink">{moon.name}</h2>
              <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-ink/45">MOON OF {moon.parent.toUpperCase()}</p>
              <dl className="mt-5 grid grid-cols-2 gap-4 font-mono">
                <Fact wide label={`FROM ${moon.parent.toUpperCase()}`} value={`${moon.distanceKm.toLocaleString("en")} KM`} sub="ON AVERAGE" accent />
                {objectDist && moon.parent !== "Earth" && (
                  <Fact wide label="FROM EARTH" value={kmText(objectDist.earthAu)} sub={`ITS LIGHT TAKES ${lightTime(objectDist.earthAu * AU_LIGHT_S)} TO REACH US`} />
                )}
                {moon.parent === "Earth" && objectDist && (
                  <Fact wide label="FROM EARTH RIGHT NOW" value={`${Math.round(objectDist.earthAu * AU_KM).toLocaleString("en")} KM`} sub={`MOONLIGHT TAKES ${lightTime(objectDist.earthAu * AU_LIGHT_S)} TO REACH US`} />
                )}
                <Fact label="ONE ORBIT" value={dayText(moon.periodDays * 24)} sub={`ONE LAP OF ${moon.parent.toUpperCase()}`} />
                <Fact label="DIAMETER" value={`${moon.diameterKm.toLocaleString("en")} KM`} sub={`${(moon.diameterKm / 3475).toFixed(2)} × OUR MOON`} />
              </dl>
              <p className="caps mt-4 text-[11px] leading-relaxed text-ink/55">
                {moon.note}
                {moon.name === "Titan" && !tracks.get("Titan") && (trackFailed.has("Titan") ? " Its position from JPL is unavailable right now." : " Reading its position from JPL…")}
              </p>
            </div>
          ) : craft ? (
            <div className="p-5">
              <button type="button" onClick={() => setSelected(null)} className="font-mono text-[10px] tracking-[0.2em] text-gold hover:underline">
                ← WHOLE SOLAR SYSTEM
              </button>
              <h2 className="display mt-4 text-2xl text-ink">{craft.name}</h2>
              <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-ink/45">
                SPACECRAFT · LAUNCHED {fmt(Date.parse(`${craft.launched}T12:00:00Z`), { day: "2-digit", month: "short", year: "numeric" })}
              </p>
              {objectDist ? (
                <dl className="mt-5 grid grid-cols-2 gap-4 font-mono">
                  <Fact wide accent label="FROM EARTH" value={kmText(objectDist.earthAu)} sub={`${auText(objectDist.earthAu)} · A RADIO SIGNAL TAKES ${lightTime(objectDist.earthAu * AU_LIGHT_S)}`} />
                  <Fact wide label="FROM THE SUN" value={kmText(objectDist.sunAu)} sub={auText(objectDist.sunAu)} />
                  {craftSpeed !== null && <Fact wide label="SPEED AROUND THE SUN" value={`${craftSpeed.toFixed(1)} KM/S`} sub={`${Math.round(craftSpeed * 3600).toLocaleString("en")} KM/H`} />}
                </dl>
              ) : (
                <p className="caps mt-5 text-[11px] leading-relaxed text-gold">
                  {(() => {
                    const track = tracks.get(craft.name);
                    if (!track) return trackFailed.has(craft.name) ? "JPL's trajectory is unavailable right now." : "Reading its trajectory from JPL…";
                    const [first, last] = trackSpan(track);
                    return shown < first.getTime()
                      ? "Not launched yet on this date."
                      : `JPL's trajectory for it runs to ${fmt(last.getTime(), { day: "2-digit", month: "short", year: "numeric" })}.`;
                  })()}
                </p>
              )}
              <p className="caps mt-4 text-[11px] leading-relaxed text-ink/55">{craft.note}</p>
            </div>
          ) : selected === "asteroid" && rock ? (
            <div className="p-5">
              <button type="button" onClick={() => setSelected(null)} className="font-mono text-[10px] tracking-[0.2em] text-gold hover:underline">
                ← WHOLE SOLAR SYSTEM
              </button>
              <h2 className="display mt-4 text-2xl text-ink">{rock.name}</h2>
              <p className="mt-1 font-mono text-[10px] tracking-[0.16em] text-ink/45">
                ASTEROID · {rock.el.orbitClass.toUpperCase()}
                {rock.el.pha ? " · POTENTIALLY HAZARDOUS CLASS" : ""}
              </p>
              {objectDist && (
                <dl className="mt-5 grid grid-cols-2 gap-4 font-mono">
                  <Fact wide accent label="FROM EARTH" value={kmText(objectDist.earthAu)} sub={`${auText(objectDist.earthAu)} · ${(objectDist.earthAu * AU_KM / 384_400).toFixed(1)} × THE MOON'S DISTANCE`} />
                  <Fact wide label="FROM THE SUN" value={kmText(objectDist.sunAu)} sub={auText(objectDist.sunAu)} />
                  <Fact label="CLOSEST–FARTHEST FROM THE SUN" value={`${(rock.el.a * (1 - rock.el.e)).toFixed(2)}–${(rock.el.a * (1 + rock.el.e)).toFixed(2)} AU`} />
                  <Fact label="ONE LAP OF THE SUN" value={yearText(360 / (rock.el.n ?? 0.9856 / Math.pow(rock.el.a, 1.5)))} />
                </dl>
              )}
              <p className="caps mt-4 text-[11px] leading-relaxed text-ink/55">
                {objectDist && objectDist.earthAu < 0.05 && !trueScale
                  ? "It is passing so close to Earth that at this scale it sits inside Earth's enlarged globe; the glow marks it. Asteroid Sentinel's flyby view shows the pass properly. "
                  : ""}
                Its orbit from JPL, propagated in your browser: close to the truth for months around today, approximate decades away.
              </p>
              <Link href="/asteroid-sentinel" className="mt-4 inline-block font-mono text-[10px] tracking-[0.2em] text-gold hover:underline">
                ASTEROID SENTINEL →
              </Link>
            </div>
          ) : (
            <div className="p-5">
              <p className="font-mono text-[10px] tracking-[0.2em] text-ink/45">
                THE SOLAR SYSTEM · {shown ? fmt(shown, { day: "2-digit", month: "short", year: "numeric" }) : ""}
              </p>
              <h2 className="display mt-3 text-2xl text-ink">Where they are</h2>
              <p className="mt-3 text-[13px] leading-relaxed text-ink/70">
                How far each world is from Earth at the moment shown, and how long its light takes to reach us. Choose one to fly there.
              </p>
              <p className="mt-5 font-mono text-[10px] tracking-[0.2em] text-ink/45">THE SUN AND PLANETS</p>
              <ul className="mt-1 divide-y divide-ink/10">
                {table.map(({ name, d }) => (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => setSelected(name)}
                      className="flex w-full items-baseline justify-between gap-3 py-3 text-left font-mono text-ink/85 transition-colors hover:text-gold"
                    >
                      <span className="text-[12px] tracking-[0.1em]">{name.toUpperCase()}</span>
                      <span className="text-right text-[10px] tracking-[0.12em] text-ink/50">
                        {d.earthAu !== null && `${auText(d.earthAu)} · LIGHT ${lightTime(d.lightS!)}`}
                      </span>
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    onClick={() => setSelected("Earth")}
                    className="flex w-full items-baseline justify-between gap-3 py-3 text-left font-mono text-gold transition-colors hover:text-ink"
                  >
                    <span className="text-[12px] tracking-[0.1em]">EARTH</span>
                    <span className="text-[10px] tracking-[0.12em]">YOU ARE HERE</span>
                  </button>
                </li>
              </ul>
              <p className="mt-6 font-mono text-[10px] tracking-[0.2em] text-ink/45">SPACECRAFT · DISTANCE AND RADIO-SIGNAL TIME</p>
              <ul className="mt-1 divide-y divide-ink/10">
                {craftTable.map(({ name, d }) => (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => setSelected(name)}
                      className="flex w-full items-baseline justify-between gap-3 py-3 text-left font-mono text-ink/85 transition-colors hover:text-[#7fd4ff]"
                    >
                      <span className="text-[12px] tracking-[0.1em]">{name.toUpperCase()}</span>
                      <span className="text-right text-[10px] tracking-[0.12em] text-ink/50">
                        {d ? `${auText(d.earthAu)} · SIGNAL ${lightTime(d.earthAu * AU_LIGHT_S)}` : trackFailed.has(name) ? "UNAVAILABLE" : tracks.get(name) ? "NOT IN FLIGHT THEN" : "…"}
                      </span>
                    </button>
                  </li>
                ))}
                {rock && (
                  <li>
                    <button
                      type="button"
                      onClick={() => setSelected("asteroid")}
                      className="flex w-full items-baseline justify-between gap-3 py-3 text-left font-mono text-[#ff8a4c] transition-colors hover:text-ink"
                    >
                      <span className="truncate text-[12px] tracking-[0.1em]">{rock.name.toUpperCase()}</span>
                      <span className="shrink-0 text-[10px] tracking-[0.12em]">ASTEROID</span>
                    </button>
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        {trueScale && (
          <p className="caps mt-4 text-[11px] leading-relaxed text-gold">
            True scale: distances and sizes in proportion. Dots mark where the planets are — at this scale even Jupiter is a speck, and space is almost entirely empty.
          </p>
        )}
        {hazard !== "off" && (
          <p className="mt-4 font-mono text-[10px] tracking-[0.16em] text-ink/55">
            {hazard === "loading"
              ? "READING JPL'S HAZARDOUS-ASTEROID ORBITS…"
              : hazard === "error"
                ? "HAZARDOUS-ASTEROID ORBITS UNAVAILABLE RIGHT NOW"
                : <><span className="text-[#ff6a3d]">●</span> {Math.floor((swarm?.orbits.length ?? 0) / (swarm?.stride ?? 1)).toLocaleString("en")} POTENTIALLY HAZARDOUS ASTEROIDS, EACH ON ITS REAL ORBIT</>}
          </p>
        )}
        <div className="mt-4 font-mono text-[10px] leading-relaxed tracking-[0.15em] text-ink/40">
          <p className="text-ink/55">HOW TO READ THIS MAP</p>
          <p className="mt-1">
            {trueScale
              ? "DISTANCES AND SIZES ARE IN TRUE PROPORTION."
              : "DIRECTIONS ARE TRUE, BUT DISTANCES ARE SQUEEZED AND BODIES ENLARGED, OR THE OUTER PLANETS WOULD BE OFF SCREEN AND EVERY WORLD A SPECK. TRY TRUE SCALE TO SEE THE REAL THING."}{" "}
            ECLIPTIC NORTH IS UP. AU = 149.6 MILLION KM, THE EARTH–SUN DISTANCE.
          </p>
          <p className="mt-2">
            PLANETS AND MOONS COMPUTED IN YOUR BROWSER WITH ASTRONOMY-ENGINE · TITAN AND SPACECRAFT FROM NASA JPL HORIZONS · FIGURES FROM NASA FACT SHEETS
          </p>
        </div>
      </aside>
    </main>
  );
}
