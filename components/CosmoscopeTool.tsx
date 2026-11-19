"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { Swarm } from "@/components/canvas/AsteroidScene";
import type { Clock, Layers, Look, Rock } from "@/components/canvas/CosmoscopeScene";
import { usePlace } from "@/components/PlacePicker";
import Dossier from "@/components/cosmoscope/Dossier";
import Navigator from "@/components/cosmoscope/Navigator";
import Timeline, { type Mode } from "@/components/cosmoscope/Timeline";
import { AU_LIGHT_S, DAY_MS, Icon, Stat, Thumb, Toggle, auText, dayText, fmt, glass, isBody, isMoon, kmText, lightTime } from "@/components/cosmoscope/ui";
import ScrambleText from "@/components/ui/ScrambleText";
import { asteroidAt, type Elements } from "@/lib/asteroids";
import { AU_KM, BODIES, CRAFT, MOONS, bodyInfo, distances, helio, moonOffset, nextOpposition, night, stormInDaylight, trackAt, trackSpan, type BodyName, type Track } from "@/lib/cosmoscope";
import { PROFILES, type Feature } from "@/lib/cosmoscope-profiles";

const Scene = dynamic(() => import("@/components/canvas/CosmoscopeScene"), { ssr: false });

/** Titan's track is fetched in 20-day blocks of ±40 days, so the moment shown is always well inside one. */
const TITAN_BLOCK_DAYS = 20;

const LOOK_LABEL: Record<NonNullable<Feature["look"]>, string> = {
  storm: "Great Red Spot",
  rings: "Rings from above",
  north: "North pole",
  south: "South pole",
  plates: "Tectonic plates",
};

/** Cosmoscope: the Sun, planets, moons and spacecraft where they really are, at any moment, with a profile of each. */
export default function CosmoscopeTool() {
  const clock = useRef<Clock>({ t: 0, rate: 0, live: true });
  const [shown, setShown] = useState(0);
  const [mode, setMode] = useState<Mode>({ live: true, rate: 0 });
  const [reverse, setReverse] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [trueScale, setTrueScale] = useState(false);
  /** Panels hidden: nothing on screen but the solar system. */
  const [clean, setClean] = useState(false);
  const [layers, setLayers] = useState<Layers>({ orbits: true, labels: true, moons: true, craft: true, plates: false });
  const [fill, setFill] = useState(false);
  const [menu, setMenu] = useState(false);
  const [look, setLook] = useState<Look | null>(null);
  /** JPL Horizons paths: spacecraft by name, and "Titan". */
  const [tracks, setTracks] = useState<Map<string, Track>>(() => new Map());
  const [trackFailed, setTrackFailed] = useState<Set<string>>(() => new Set());
  const [swarm, setSwarm] = useState<Swarm | null>(null);
  const [hazard, setHazard] = useState<"off" | "loading" | "on" | "error">("off");
  const [rock, setRock] = useState<(Rock & { des: string }) | null>(null);
  /** Whether the 3D stage is on screen; it stops rendering while scrolled away. */
  const [onStage, setOnStage] = useState(true);
  const stage = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const placeState = usePlace();
  const place = placeState.place;
  const reducedMotion = useMemo(() => typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  /** When the page opened; 0 until mounted, since the time only exists in the browser. */
  const [opened, setOpened] = useState(0);

  // The scene moves the clock every frame; the panels read it a few times a second.
  useEffect(() => {
    clock.current.t = Date.now();
    setOpened(clock.current.t);
    const read = () => setShown(clock.current.t);
    read();
    const id = setInterval(read, 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOnStage(e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // H hides or shows the panels; Esc brings them back. Not while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || el?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "h" || e.key === "H") setClean((c) => !c);
      else if (e.key === "Escape") {
        setClean(false);
        setMenu(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The layers menu closes on a click outside it.
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);

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
  const toTop = () => stage.current?.scrollIntoView({ behavior: "smooth" });
  const toProfile = () => document.getElementById("profile")?.scrollIntoView({ behavior: "smooth" });
  const choose = (id: string | null, scrollUp = false) => {
    setSelected(id);
    if (scrollUp) toTop();
  };

  const addTrack = (name: string, points: number[]) => setTracks((prev) => new Map(prev).set(name, Float64Array.from(points)));
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

  /** Flies to a feature: some need time moved on (the storm into daylight) or a layer switched on. */
  const showFeature = (kind: NonNullable<Feature["look"]>, body: BodyName) => {
    setSelected(body);
    setTrueScale(false);
    if (kind === "plates") setLayers((l) => ({ ...l, plates: true }));
    if (kind === "storm") {
      setLayers((l) => ({ ...l, labels: true }));
      const lit = stormInDaylight(new Date(clock.current.t)).getTime();
      if (lit !== clock.current.t) jump(lit);
    }
    // Poles spend years in darkness; light the night side to see them.
    if (kind === "north" || kind === "south") setFill(true);
    setLook((prev) => ({ kind, n: (prev?.n ?? 0) + 1 }));
  };

  // Today's start, for the slider's zero.
  const today = opened ? Math.floor(opened / DAY_MS) * DAY_MS : 0;

  const presets = useMemo(() => {
    if (!opened) return [];
    const now = new Date(opened);
    const list: { label: string; t: number; body: string | null }[] = [];
    for (const p of ["Mars", "Jupiter", "Saturn"] as const) {
      const d = nextOpposition(p, now);
      if (d) list.push({ label: `${p} at opposition · ${fmt(d.getTime(), { month: "short", year: "numeric" }).toLowerCase()}`, t: d.getTime(), body: p });
    }
    if (now.getTime() < Date.UTC(2029, 3, 14)) list.push({ label: "Apophis passes Earth · apr 2029", t: Date.UTC(2029, 3, 13, 21, 46), body: "Earth" });
    return list;
  }, [opened]);

  const info = isBody(selected) ? bodyInfo(selected) : null;
  const profile = isBody(selected) ? PROFILES[selected] : null;
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
  const trackNote = (name: string) => {
    const track = tracks.get(name);
    if (!track) return trackFailed.has(name) ? "JPL's data is unavailable right now." : "Reading from JPL…";
    const [first, last] = trackSpan(track);
    if (name === "Titan") return null;
    return shown < first.getTime() ? "Not launched yet on this date." : `JPL's trajectory for it runs to ${fmt(last.getTime(), { day: "2-digit", month: "short", year: "numeric" })}.`;
  };
  const table = useMemo(() => (shown ? BODIES.filter((b) => b.name !== "Earth").map((b) => ({ name: b.name, d: distances(b.name, new Date(shown)) })) : []), [shown]);
  const tz = place?.timeZone;
  const isTonight = shown ? fmt(shown, { day: "2-digit", month: "short", year: "numeric" }, tz) === fmt(opened, { day: "2-digit", month: "short", year: "numeric" }, tz) : true;

  const hide = clean ? "hidden" : "";
  const flip = (k: keyof Layers) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  const looks = profile?.features.filter((f) => f.look) ?? [];
  const rail: { group: string; items: string[] }[] = [
    { group: "STAR", items: ["Sun"] },
    { group: "PLANETS", items: ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"] },
    { group: "DWARF PLANET", items: ["Pluto"] },
  ];

  /** The card's summary of the chosen object. */
  const card = (() => {
    if (info && profile && dist)
      return (
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <Thumb name={info.name} size={40} />
              <div>
                <h2 className="display text-[22px] leading-none text-ink">{info.name}</h2>
                <p className="mt-1.5 font-mono text-[9px] tracking-[0.18em] text-ink/45">{info.kind.toUpperCase()}</p>
              </div>
            </div>
            <button type="button" onClick={() => setSelected(null)} aria-label="Back to the whole Solar System" className="rounded-full p-1.5 text-ink/50 transition-colors hover:bg-ink/10 hover:text-ink">
              <Icon name="close" />
            </button>
          </div>
          <p className="mt-4 text-[13px] leading-relaxed text-ink/65">{profile.tagline}.</p>
          <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
            <Stat label="FROM EARTH" value={dist.earthAu === null ? "You are here" : kmText(dist.earthAu * AU_KM)} sub={dist.lightS === null ? undefined : `light ${lightTime(dist.lightS)}`} accent />
            <Stat label="FROM THE SUN" value={dist.sunAu === null ? "—" : auText(dist.sunAu)} />
            <Stat label="DIAMETER" value={`${info.diameterKm.toLocaleString("en")} km`} />
            <Stat label={info.name === "Sun" ? "ONE TURN" : "DAY"} value={dayText(info.dayHours)} />
          </div>
          {looks.length > 0 && !trueScale && (
            <div className="mt-5">
              <p className="font-mono text-[9px] tracking-[0.2em] text-ink/40">SEE IN 3D</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {looks.map((f) => (
                  <button
                    key={f.title}
                    type="button"
                    onClick={() => showFeature(f.look!, info.name)}
                    className="rounded-full border border-gold/45 px-3 py-1.5 text-[12px] text-gold transition-colors hover:bg-gold hover:text-void"
                  >
                    {f.look === "north" && info.name === "Saturn" ? "The hexagon" : f.look === "north" && info.name === "Jupiter" ? "Polar cyclones" : LOOK_LABEL[f.look!]}
                  </button>
                ))}
              </div>
            </div>
          )}
          {MOONS.some((m) => m.parent === info.name) && (
            <div className="mt-5">
              <p className="font-mono text-[9px] tracking-[0.2em] text-ink/40">{trueScale ? "MOONS · OFF AT TRUE SCALE" : "MOONS"}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {MOONS.filter((m) => m.parent === info.name).map((m) => (
                  <button key={m.name} type="button" onClick={() => setSelected(m.name)} className="flex items-center gap-1.5 rounded-full border border-ink/15 py-1 pl-1 pr-2.5 text-[12px] text-ink/75 transition-colors hover:border-ink/50 hover:text-ink">
                    <Thumb name={m.name} size={16} />
                    {m.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button type="button" onClick={toProfile} className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-ink py-2.5 text-[13px] font-medium text-void transition-colors hover:bg-gold">
            Full profile of {info.name}
            <Icon name="down" />
          </button>
        </div>
      );
    if (moon)
      return (
        <div className="p-5">
          <button type="button" onClick={() => setSelected(moon.parent)} className="font-mono text-[10px] tracking-[0.2em] text-gold hover:underline">
            ← {moon.parent.toUpperCase()}
          </button>
          <div className="mt-4 flex items-center gap-3">
            <Thumb name={moon.name} size={40} />
            <div>
              <h2 className="display text-[22px] leading-none text-ink">{moon.name}</h2>
              <p className="mt-1.5 font-mono text-[9px] tracking-[0.18em] text-ink/45">{moon.name === "Moon" ? "EARTH'S MOON" : `MOON OF ${moon.parent.toUpperCase()}`}</p>
            </div>
          </div>
          <p className="mt-4 text-[13px] leading-relaxed text-ink/65">{moon.note}</p>
          <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
            <Stat label={`FROM ${moon.parent.toUpperCase()}`} value={`${moon.distanceKm.toLocaleString("en")} km`} accent />
            <Stat label="DIAMETER" value={`${moon.diameterKm.toLocaleString("en")} km`} />
            <Stat label="ONE ORBIT" value={dayText(Math.abs(moon.periodDays) * 24)} sub={moon.periodDays < 0 ? "backwards" : undefined} />
            {objectDist && <Stat label="FROM EARTH" value={kmText(objectDist.earthAu * AU_KM)} />}
          </div>
          {moon.source === "mean" && <p className="mt-4 text-[11px] leading-relaxed text-ink/40">Real orbit and period; its place along the orbit is approximate.</p>}
          {moon.name === "Titan" && !tracks.get("Titan") && <p className="mt-4 text-[11px] text-ink/45">{trackFailed.has("Titan") ? "Its position from JPL is unavailable right now." : "Reading its position from JPL…"}</p>}
          <button type="button" onClick={toProfile} className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-ink py-2.5 text-[13px] font-medium text-void transition-colors hover:bg-gold">
            More about {moon.name}
            <Icon name="down" />
          </button>
        </div>
      );
    if (craft)
      return (
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="display text-[22px] leading-none text-ink">{craft.name}</h2>
              <p className="mt-1.5 font-mono text-[9px] tracking-[0.18em] text-ink/45">SPACECRAFT · LAUNCHED {craft.launched.slice(0, 4)}</p>
            </div>
            <button type="button" onClick={() => setSelected(null)} aria-label="Back to the whole Solar System" className="rounded-full p-1.5 text-ink/50 hover:bg-ink/10 hover:text-ink">
              <Icon name="close" />
            </button>
          </div>
          <p className="mt-4 text-[13px] leading-relaxed text-ink/65">{craft.note}</p>
          {objectDist ? (
            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
              <Stat label="FROM EARTH" value={kmText(objectDist.earthAu * AU_KM)} sub={`signal ${lightTime(objectDist.earthAu * AU_LIGHT_S)}`} accent />
              {craftSpeed !== null && <Stat label="SPEED" value={`${craftSpeed.toFixed(1)} km/s`} />}
            </div>
          ) : (
            <p className="mt-4 text-[12px] text-gold">{trackNote(craft.name)}</p>
          )}
          {tracks.get(craft.name) && (
            <div className="mt-5">
              <p className="font-mono text-[9px] tracking-[0.2em] text-ink/40">SEE IN 3D</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setLook((prev) => ({ kind: "journey", n: (prev?.n ?? 0) + 1 }))} className="rounded-full border border-[#7fd4ff]/50 px-3 py-1.5 text-[12px] text-[#9fdcff] transition-colors hover:bg-[#7fd4ff] hover:text-void">
                  Its whole journey
                </button>
                <button
                  type="button"
                  onClick={() => setLook((prev) => ({ kind: "close", n: (prev?.n ?? 0) + 1 }))}
                  className="rounded-full border border-[#7fd4ff]/50 px-3 py-1.5 text-[12px] text-[#9fdcff] transition-colors hover:bg-[#7fd4ff] hover:text-void"
                >
                  The spacecraft up close
                </button>
              </div>
              <ul className="mt-4 space-y-1.5">
                {craft.events.map((e) => (
                  <li key={e.label}>
                    <button type="button" onClick={() => jump(Date.parse(`${e.date}T12:00:00Z`))} className="flex w-full items-baseline justify-between gap-3 text-left text-[12px] text-ink/70 transition-colors hover:text-[#9fdcff]">
                      <span>{e.body ? `${e.label} flyby` : e.label}</span>
                      <span className="font-mono text-[10px] text-ink/40">{fmt(Date.parse(`${e.date}T12:00:00Z`), { day: "2-digit", month: "short", year: "numeric" })}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[10px] text-ink/35">Choose a milestone to go to that day.</p>
            </div>
          )}
        </div>
      );
    if (selected === "asteroid" && rock)
      return (
        <div className="p-5">
          <h2 className="display text-[22px] leading-none text-ink">{rock.name}</h2>
          <p className="mt-1.5 font-mono text-[9px] tracking-[0.18em] text-ink/45">
            ASTEROID · {rock.el.orbitClass.toUpperCase()}
            {rock.el.pha ? " · POTENTIALLY HAZARDOUS CLASS" : ""}
          </p>
          {objectDist && (
            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
              <Stat label="FROM EARTH" value={kmText(objectDist.earthAu * AU_KM)} sub={`${((objectDist.earthAu * AU_KM) / 384_400).toFixed(1)} × the Moon's distance`} accent />
              <Stat label="FROM THE SUN" value={auText(objectDist.sunAu)} />
            </div>
          )}
          {objectDist && objectDist.earthAu < 0.05 && !trueScale && (
            <p className="mt-4 text-[11px] leading-relaxed text-ink/45">So close to Earth that at this scale it sits inside Earth&apos;s enlarged globe; the glow marks it.</p>
          )}
        </div>
      );
    return (
      <div className="p-5">
        <p className="font-mono text-[9px] tracking-[0.2em] text-ink/45">RIGHT NOW · {shown ? fmt(shown, { day: "2-digit", month: "short", year: "numeric" }) : ""}</p>
        <h2 className="display mt-2 text-[22px] text-ink">Where they are</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink/55">Distance from Earth, and how long each one&apos;s light takes to reach us.</p>
        <ul className="mt-4 divide-y divide-ink/[0.08]">
          {table.map(({ name, d }) => (
            <li key={name}>
              <button type="button" onClick={() => setSelected(name)} className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:text-gold">
                <Thumb name={name} size={18} ring={false} />
                <span className="flex-1 text-[13px] text-ink/90">{name}</span>
                <span className="text-right font-mono text-[10px] tracking-[0.04em] text-ink/45">{d.earthAu !== null && `${auText(d.earthAu)} · ${lightTime(d.lightS!)}`}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-5 font-mono text-[9px] tracking-[0.2em] text-ink/40">SPACECRAFT</p>
        <ul className="mt-1 divide-y divide-ink/[0.08]">
          {CRAFT.map((c) => {
            const d = shown ? away(c.name, shown) : null;
            return (
              <li key={c.name}>
                <button type="button" onClick={() => setSelected(c.name)} className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:text-[#7fd4ff]">
                  <span className="block h-1.5 w-1.5 rounded-full bg-[#7fd4ff] shadow-[0_0_8px_#7fd4ff]" />
                  <span className="flex-1 text-[13px] text-ink/90">{c.name}</span>
                  <span className="text-right font-mono text-[10px] text-ink/45">{d ? auText(d.earthAu) : trackFailed.has(c.name) ? "unavailable" : tracks.get(c.name) ? "not in flight" : "…"}</span>
                </button>
              </li>
            );
          })}
          {rock && (
            <li>
              <button type="button" onClick={() => setSelected("asteroid")} className="flex w-full items-center gap-3 py-2.5 text-left text-[#ff8a4c] hover:text-ink">
                <span className="block h-1.5 w-1.5 rounded-full bg-[#ff8a4c]" />
                <span className="flex-1 truncate text-[13px]">{rock.name}</span>
                <span className="font-mono text-[10px]">asteroid</span>
              </button>
            </li>
          )}
        </ul>
      </div>
    );
  })();

  return (
    <main className="relative bg-void text-ink">
      <section ref={stage} className={`relative w-full overflow-hidden ${clean ? "h-svh" : "h-[72svh] lg:h-svh"} min-h-[520px]`}>
        <div className="absolute inset-0">
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
            layers={layers}
            fill={fill}
            active={onStage}
            panelShift={clean ? 0 : 150}
          />
        </div>
        {/* Shade at top and bottom, so the bars read over bright planets. */}
        <div aria-hidden className={`pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-black/80 to-transparent ${hide}`} />
        <div aria-hidden className={`pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/85 to-transparent ${hide}`} />

        {/* Top bar. */}
        <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className={`pointer-events-auto flex min-w-0 items-center gap-3 sm:gap-4 ${hide}`}>
            <Link href="/" aria-label="Back to Stellr" className="font-mono text-[11px] tracking-[0.2em] text-ink/60 transition-colors hover:text-gold">
              <span className="sm:hidden">←</span>
              <span className="hidden sm:inline">
                <ScrambleText text="← STELLR" />
              </span>
            </Link>
            <span className="hidden h-5 w-px bg-ink/20 sm:block" />
            <div className="min-w-0">
              <h1 className="truncate font-sans text-[13px] font-semibold tracking-[0.22em] text-ink sm:text-[15px] sm:tracking-[0.32em]">COSMOSCOPE</h1>
              <p className="hidden truncate text-[11px] text-ink/50 md:block">Every planet, moon and spacecraft, where it really is.</p>
            </div>
          </div>
          <div className="pointer-events-auto ml-auto flex items-center gap-2">
            <div className={`hidden rounded-full border border-ink/15 bg-black/40 p-0.5 backdrop-blur-md sm:flex ${hide}`}>
              {[false, true].map((t) => (
                <button
                  key={String(t)}
                  type="button"
                  aria-pressed={trueScale === t}
                  onClick={() => setTrueScale(t)}
                  className={`rounded-full px-3.5 py-1.5 text-[12px] transition-colors ${trueScale === t ? "bg-ink text-void" : "text-ink/65 hover:text-ink"}`}
                >
                  {t ? "True scale" : "Scaled view"}
                </button>
              ))}
            </div>
            <div ref={menuRef} className={`relative ${hide}`}>
              <button
                type="button"
                aria-expanded={menu}
                onClick={() => setMenu(!menu)}
                className={`flex items-center gap-2 rounded-full border px-3.5 py-2 text-[12px] backdrop-blur-md transition-colors ${menu ? "border-ink bg-ink text-void" : "border-ink/20 bg-black/40 text-ink/85 hover:border-ink/50"}`}
              >
                <Icon name="layers" />
                <span className="hidden sm:inline">Layers</span>
              </button>
              {menu && (
                <div className={`${glass} absolute right-0 top-full mt-2 w-[290px] p-2`}>
                  <div className="sm:hidden">
                    <Toggle label="True scale" note="Real distances and sizes" on={trueScale} onChange={() => setTrueScale(!trueScale)} />
                  </div>
                  <Toggle label="Orbits" on={layers.orbits} onChange={() => flip("orbits")} />
                  <Toggle label="Labels" note="Names and landmarks" on={layers.labels} onChange={() => flip("labels")} />
                  <Toggle label="Moons" note="Twenty of the largest" on={layers.moons} onChange={() => flip("moons")} />
                  <Toggle label="Spacecraft" note="Voyagers, New Horizons, Parker" on={layers.craft} onChange={() => flip("craft")} tone="bg-[#7fd4ff]" />
                  <Toggle label="Earth's plates" note="Tectonic plate boundaries" on={layers.plates} onChange={() => flip("plates")} tone="bg-[#ff6f3c]" />
                  <Toggle
                    label="Hazardous asteroids"
                    note={hazard === "loading" ? "Reading JPL's orbits…" : hazard === "error" ? "Unavailable right now" : hazard === "on" ? `${Math.floor((swarm?.orbits.length ?? 0) / (swarm?.stride ?? 1)).toLocaleString("en")} on their real orbits` : "Every known one, from JPL"}
                    on={hazard === "on"}
                    onChange={toggleHazard}
                    tone="bg-[#ff6a3d]"
                  />
                  <div className="my-1 h-px bg-ink/10" />
                  <Toggle label="Light the night side" note="See surfaces in shadow" on={fill} onChange={() => setFill(!fill)} />
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setClean(!clean)}
              title={clean ? "Show the panels (H or Esc)" : "Hide the panels (H)"}
              className="flex items-center gap-2 rounded-full border border-ink/20 bg-black/40 px-3.5 py-2 text-[12px] text-ink/85 backdrop-blur-md transition-colors hover:border-ink/50"
            >
              <Icon name={clean ? "eye" : "eye-off"} />
              <span className="hidden sm:inline">{clean ? "Show panels" : "Hide panels"}</span>
            </button>
          </div>
        </header>

        {/* Bodies, down the left on wide screens; a strip along the bottom on phones. */}
        <nav aria-label="Bodies" className={`absolute left-4 top-20 z-10 hidden lg:block ${hide}`}>
          <Navigator
            selected={selected}
            onSelect={setSelected}
            shown={shown}
            craftSunAu={(name) => {
              const d = shown ? away(name, shown) : null;
              return d ? d.sunAu : trackFailed.has(name) ? "—" : tracks.get(name) ? "off" : "…";
            }}
          />
        </nav>
        <nav aria-label="Bodies" className={`cosmo-scroll absolute inset-x-0 bottom-3 z-10 flex gap-2 overflow-x-auto px-4 lg:hidden ${hide}`}>
          {rail.flatMap((g) => g.items).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setSelected(selected === name ? null : name)}
              className={`flex shrink-0 items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-[12px] backdrop-blur-md transition-colors ${selected === name ? "border-gold/70 bg-black/60 text-ink" : "border-ink/15 bg-black/45 text-ink/75"}`}
            >
              <Thumb name={name} size={20} ring={false} />
              {name}
            </button>
          ))}
        </nav>

        {/* Summary of the chosen object, on the right on wide screens. */}
        <aside className={`absolute right-4 top-20 z-10 hidden w-[340px] lg:block ${hide}`}>
          <div className={`${glass} cosmo-scroll max-h-[calc(100svh-15rem)] overflow-y-auto`}>{card}</div>
          {trueScale && <p className="mt-3 px-2 text-[11px] leading-relaxed text-gold/90">True scale: distances and sizes in proportion. Dots mark the planets; at this scale even Jupiter is a speck.</p>}
        </aside>

        {/* Time, along the bottom on wide screens. */}
        <div className={`absolute bottom-4 left-4 right-[372px] z-10 hidden lg:block ${hide}`}>
          <Timeline shown={shown} today={today} mode={mode} reverse={reverse} presets={presets} onLive={goLive} onRate={(r) => setRate(r)} onReverse={() => {
            setReverse(!reverse);
            if (!mode.live && mode.rate) setRate(mode.rate, !reverse);
          }} onJump={jump} />
        </div>

        {clean && (
          <p className="pointer-events-none absolute inset-x-0 bottom-5 text-center font-mono text-[10px] tracking-[0.2em] text-ink/40">
            {shown ? `${fmt(shown, { day: "2-digit", month: "short", year: "numeric" }, "UTC")} · ` : ""}DRAG TO TURN · SCROLL TO ZOOM · <span className="hidden sm:inline">H OR ESC</span>
            <span className="sm:hidden">TAP SHOW PANELS</span> TO BRING THE PANELS BACK
          </p>
        )}
      </section>

      {/* On phones and tablets, the time bar and summary sit under the scene. */}
      <div className={`space-y-4 px-4 pt-4 lg:hidden ${hide}`}>
        <Timeline shown={shown} today={today} mode={mode} reverse={reverse} presets={presets} onLive={goLive} onRate={(r) => setRate(r)} onReverse={() => {
          setReverse(!reverse);
          if (!mode.live && mode.rate) setRate(mode.rate, !reverse);
        }} onJump={jump} />
        <div className={glass}>{card}</div>
      </div>

      <div id="profile" className="scroll-mt-0">
        <Dossier
          selected={selected}
          shown={shown}
          dist={dist}
          sky={sky}
          placeState={placeState}
          isTonight={isTonight}
          away={away}
          onSelect={choose}
          onLook={(f, body) => {
            showFeature(f.look!, body);
            toTop();
          }}
          trackNote={trackNote}
          craftSpeed={craftSpeed}
          rockName={rock?.name ?? null}
        />
      </div>

      <footer className="mx-auto mt-16 max-w-[1180px] border-t border-ink/10 px-5 py-10 font-mono text-[10px] leading-relaxed tracking-[0.14em] text-ink/40 sm:px-8">
        <p className="text-ink/55">HOW TO READ THIS MAP</p>
        <p className="mt-2 max-w-[110ch]">
          {trueScale ? "DISTANCES AND SIZES ARE IN TRUE PROPORTION." : "DIRECTIONS ARE TRUE, BUT DISTANCES ARE SQUEEZED AND BODIES ENLARGED, OR THE OUTER PLANETS WOULD BE OFF SCREEN AND EVERY WORLD A SPECK. TRY TRUE SCALE TO SEE THE REAL THING."}{" "}
          ECLIPTIC NORTH IS UP. AU = 149.6 MILLION KM, THE EARTH–SUN DISTANCE.
        </p>
        <p className="mt-3 max-w-[110ch]">
          PLANETS, THE MOON AND JUPITER&apos;S FOUR LARGE MOONS COMPUTED IN YOUR BROWSER WITH ASTRONOMY-ENGINE · TITAN AND SPACECRAFT FROM NASA JPL HORIZONS · OTHER MOONS ON THEIR MEAN ORBITS, PLACE ALONG THEM APPROXIMATE ·
          FIGURES FROM NASA FACT SHEETS · PLANET TEXTURES BY SOLAR SYSTEM SCOPE (CC BY 4.0) · POLAR STORMS, MOON SURFACES AND PLUTO DRAWN AFTER JUNO, CASSINI, VOYAGER AND NEW HORIZONS IMAGES · PLATE BOUNDARIES: PETER BIRD (2003) VIA HUGO AHLENIUS, NORDPIL (ODC-BY)
        </p>
      </footer>
    </main>
  );
}
