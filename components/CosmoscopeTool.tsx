"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { Clock } from "@/components/canvas/CosmoscopeScene";
import PlacePicker, { usePlace } from "@/components/PlacePicker";
import ScrambleText from "@/components/ui/ScrambleText";
import { AU_KM, BODIES, bodyInfo, distances, nextOpposition, night, type BodyName } from "@/lib/cosmoscope";

const Scene = dynamic(() => import("@/components/canvas/CosmoscopeScene"), { ssr: false });

const DAY_MS = 86_400_000;
/** Playback speeds, days per second; 0 is paused. */
const SPEEDS: [string, number][] = [
  ["DAY/S", 1],
  ["WEEK/S", 7],
  ["MONTH/S", 30],
  ["YEAR/S", 365],
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

/** Cosmoscope: the Sun and planets where they really are, at any moment, to fly between. */
export default function CosmoscopeTool() {
  const clock = useRef<Clock>({ t: 0, rate: 0, live: true });
  const [shown, setShown] = useState(0);
  const [mode, setMode] = useState<{ live: boolean; rate: number }>({ live: true, rate: 0 });
  const [reverse, setReverse] = useState(false);
  const [selected, setSelected] = useState<BodyName | null>(null);
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
  const jump = (t: number, body?: BodyName | null) => {
    clock.current.live = false;
    clock.current.rate = 0;
    clock.current.t = t;
    setMode({ live: false, rate: 0 });
    setShown(t);
    if (body !== undefined) setSelected(body);
  };

  // Today's start, for the slider's zero.
  const today = opened ? Math.floor(opened / DAY_MS) * DAY_MS : 0;
  const sliderDays = shown ? Math.max(-SLIDER_DAYS, Math.min(SLIDER_DAYS, Math.round((shown - today) / DAY_MS))) : 0;

  const presets = useMemo(() => {
    if (!opened) return [];
    const now = new Date(opened);
    const list: { label: string; t: number; body: BodyName | null }[] = [];
    for (const p of ["Mars", "Jupiter", "Saturn"] as const) {
      const d = nextOpposition(p, now);
      if (d) list.push({ label: `${p.toUpperCase()} AT OPPOSITION · ${fmt(d.getTime(), { month: "short", year: "numeric" })}`, t: d.getTime(), body: p });
    }
    if (now.getTime() < Date.UTC(2029, 3, 14)) list.push({ label: "APOPHIS FLIES PAST EARTH · APR 2029", t: Date.UTC(2029, 3, 13, 21, 46), body: "Earth" });
    return list;
  }, [opened]);

  const info = selected ? bodyInfo(selected) : null;
  const dist = useMemo(() => (selected && shown ? distances(selected, new Date(shown)) : null), [selected, shown]);
  // The night is worked out once per day shown, not every tick.
  const nightDay = shown ? Math.floor(shown / DAY_MS) : 0;
  const sky = useMemo(
    () => (selected && selected !== "Sun" && selected !== "Earth" && place && nightDay ? night(selected, place, new Date(nightDay * DAY_MS)) : null),
    [selected, place, nightDay],
  );
  const table = useMemo(
    () => (shown && !selected ? BODIES.filter((b) => b.name !== "Earth").map((b) => ({ name: b.name, d: distances(b.name, new Date(shown)) })) : []),
    [shown, selected],
  );
  const tz = place?.timeZone;
  const isTonight = shown ? fmt(shown, { day: "2-digit", month: "short", year: "numeric" }, tz) === fmt(opened, { day: "2-digit", month: "short", year: "numeric" }, tz) : true;

  return (
    <main className="relative min-h-svh bg-void text-ink lg:h-svh lg:overflow-hidden">
      <div className="relative h-[58svh] w-full lg:absolute lg:inset-0 lg:h-full">
        <Scene clock={clock} selected={selected} onSelect={setSelected} reducedMotion={reducedMotion} />
      </div>

      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-5 sm:p-8">
        <div className="pointer-events-auto">
          <Link href="/" className="font-mono text-[11px] tracking-[0.2em] text-ink/60 transition-colors hover:text-gold">
            <ScrambleText text="← STELLR" />
          </Link>
          <h1 className="display mt-5 text-[clamp(1.6rem,3vw,2.8rem)] text-ink">Cosmoscope</h1>
          <p className="caps mt-2 hidden max-w-[36ch] text-[11px] text-ink/55 sm:block sm:text-[12px]">
            The Sun and planets exactly where they are, at any moment you choose. Click a world to fly there.
          </p>
        </div>
      </header>

      {/* Time controls: over the scene on wide screens, under it on phones. */}
      <section
        aria-label="Time"
        className="relative z-10 px-5 pt-4 sm:px-8 lg:absolute lg:bottom-8 lg:left-8 lg:right-[436px] lg:p-0"
      >
        <div className="frame bg-void/70 p-4 backdrop-blur-md">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 font-mono">
            <p className="text-sm tracking-[0.14em] text-ink tabular-nums">
              {shown ? fmt(shown, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }, "UTC") : "—"} UTC
            </p>
            <p className="text-[10px] tracking-[0.18em] text-ink/45">
              {mode.live ? (
                <>
                  <span className="text-gold">●</span> LIVE
                </>
              ) : mode.rate ? (
                `PLAYING ${reverse ? "BACKWARDS " : ""}· ${SPEEDS.find(([, r]) => r === mode.rate)?.[0] ?? ""}`
              ) : (
                "PAUSED"
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
            <span>−10 YEARS</span>
            <span>TODAY</span>
            <span>+10 YEARS</span>
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
              ⇄ BACKWARDS
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
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] tracking-[0.16em]">
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

              <dl className="mt-5 grid grid-cols-2 gap-4 font-mono">
                {dist.earthAu !== null ? (
                  <div className="col-span-2">
                    <dt className="text-[10px] tracking-[0.2em] text-ink/45">FROM EARTH</dt>
                    <dd className="mt-1 text-sm text-gold">{kmText(dist.earthAu)}</dd>
                    <dd className="mt-0.5 text-[10px] tracking-[0.12em] text-ink/50">
                      {auText(dist.earthAu)} · LIGHT TAKES {lightTime(dist.lightS!)}
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
                      {auText(dist.sunAu)} · SUNLIGHT TAKES {lightTime(dist.sunAu * 499.004784)}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-[10px] tracking-[0.2em] text-ink/45">{info.name === "Sun" ? "ONE TURN" : "ONE DAY"}</dt>
                  <dd className="mt-1 text-sm text-ink">{dayText(info.dayHours)}</dd>
                  {info.spinHours < 0 && <dd className="mt-0.5 text-[10px] tracking-[0.12em] text-ink/50">SPINS BACKWARDS</dd>}
                </div>
                {info.yearDays > 0 && (
                  <div>
                    <dt className="text-[10px] tracking-[0.2em] text-ink/45">ONE YEAR</dt>
                    <dd className="mt-1 text-sm text-ink">{yearText(info.yearDays)}</dd>
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
                  <dt className="text-[10px] tracking-[0.2em] text-ink/45">{info.name === "Sun" ? "SURFACE" : "AVERAGE TEMP"}</dt>
                  <dd className="mt-1 text-sm text-ink">{info.tempC.toLocaleString("en")} °C</dd>
                </div>
                {info.name !== "Sun" && (
                  <div>
                    <dt className="text-[10px] tracking-[0.2em] text-ink/45">MOONS</dt>
                    <dd className="mt-1 text-sm text-ink">{info.moons}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-[10px] tracking-[0.2em] text-ink/45">AXIAL TILT</dt>
                  <dd className="mt-1 text-sm text-ink">{info.tilt}°</dd>
                </div>
              </dl>

              {sky && (
                <div className="mt-6 border-t border-ink/10 pt-5">
                  <p className="font-mono text-[10px] tracking-[0.2em] text-ink/45">
                    {isTonight ? "TONIGHT" : `NIGHT OF ${fmt(shown, { day: "2-digit", month: "short", year: "numeric" }, tz)}`} · FROM {place?.name.toUpperCase()}
                  </p>
                  <p className="caps mt-2 text-[12px] leading-relaxed text-ink/80">
                    {sky.kind === "visible"
                      ? `Visible to the eye. Best around ${fmt(sky.best.getTime(), { hour: "2-digit", minute: "2-digit" }, tz)}, ${Math.round(sky.altitude)}° up in the ${sky.direction}, at magnitude ${sky.magnitude.toFixed(1)}. Up from ${fmt(sky.from.getTime(), { hour: "2-digit", minute: "2-digit" }, tz)} to ${fmt(sky.until.getTime(), { hour: "2-digit", minute: "2-digit" }, tz)}.`
                      : sky.kind === "glare"
                        ? `Lost in the Sun's glare: only ${Math.round(sky.elongation)}° from it in the sky.`
                        : sky.kind === "below"
                          ? "Below the horizon all night from here."
                          : "No proper night at this latitude on this date."}
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
          ) : (
            <div className="p-5">
              <p className="font-mono text-[10px] tracking-[0.2em] text-ink/45">
                THE SOLAR SYSTEM · {shown ? fmt(shown, { day: "2-digit", month: "short", year: "numeric" }) : ""}
              </p>
              <h2 className="display mt-3 text-2xl text-ink">Pick a world</h2>
              <ul className="mt-4 divide-y divide-ink/10">
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
              <p className="mt-3 font-mono text-[10px] tracking-[0.14em] text-ink/40">DISTANCES FROM EARTH AT THE MOMENT SHOWN</p>
            </div>
          )}
        </div>

        <p className="mt-4 font-mono text-[10px] leading-relaxed tracking-[0.15em] text-ink/40">
          POSITIONS COMPUTED IN YOUR BROWSER WITH ASTRONOMY-ENGINE · DIRECTIONS TRUE, DISTANCES COMPRESSED, SIZES ENLARGED · FIGURES FROM NASA FACT SHEETS
        </p>
      </aside>
    </main>
  );
}
