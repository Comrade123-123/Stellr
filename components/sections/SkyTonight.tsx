"use client";

import { useEffect, useRef, useState } from "react";
import { useReveal } from "@/components/ui/useReveal";
import IndexBar from "@/components/ui/IndexBar";
import SplitWords from "@/components/ui/SplitWords";
import ScrambleText from "@/components/ui/ScrambleText";
import MoonSphere from "@/components/ui/MoonSphere";
import { CITIES, guessCity, type Place } from "@/lib/places";
import type { SkyReport } from "@/lib/sky";
import { appStore } from "@/lib/store";

const MY_LOCATION = "__here";

function formatTime(date: Date | null, timeZone?: string) {
  if (!date) return "—";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", timeZone }).format(date);
}

function formatDay(date: Date | null, timeZone?: string) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone }).format(date).toUpperCase();
}

function inDays(date: Date | null) {
  if (!date) return "";
  const days = Math.round((date.getTime() - Date.now()) / 86_400_000);
  return days <= 0 ? "TONIGHT" : days === 1 ? "TOMORROW" : `IN ${days} DAYS`;
}

/** Personal hook: tonight's Moon, darkness and naked-eye planets for the visitor's sky. */
export default function SkyTonight() {
  const root = useRef<HTMLElement>(null);
  useReveal(root);

  const [place, setPlace] = useState<Place | null>(null);
  const [here, setHere] = useState<Place | null>(null);
  const [report, setReport] = useState<SkyReport | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState("");

  // Time-zone guess needs the browser; no permission prompt involved.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlace(guessCity());
  }, []);

  useEffect(() => {
    if (!place) return;
    // `?poster` renders the shared no-WebGL backdrops, which must not carry one city's pin.
    if (!new URLSearchParams(location.search).has("poster")) appStore.set({ observer: place });
    let cancelled = false;
    const run = async () => {
      const { computeSky } = await import("@/lib/sky");
      if (!cancelled) setReport(computeSky(place));
    };
    run();
    const id = setInterval(run, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [place]);

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
  const selectValue = place && place === here ? MY_LOCATION : (place?.name ?? "");

  return (
    <section
      ref={root}
      id="sky"
      data-scene="sky"
      data-label="YOUR SKY"
      // Portrait screens (same rule as the camera's "tall" framing) leave the top
      // of the screen to the globe and the visitor's pin.
      className="relative min-h-svh px-5 pb-24 pt-[40vh] sm:px-10 lg:px-16 [@media(min-aspect-ratio:9/10)]:pt-[18vh]"
    >
      <div className="lg:ml-auto lg:w-[52%]">
        <IndexBar index="002" label="YOUR SKY" />

        <h2 className="display mt-14 text-[clamp(1.7rem,3.4vw,3.5rem)] text-ink">
          <SplitWords text="Your sky, tonight." />
        </h2>
        <p className="caps reveal-fade mt-6 max-w-[52ch] text-[12px] text-ink/60 sm:text-[13px]">
          Computed in your browser for wherever you are standing. Your location never leaves this page.
        </p>

        <div className="reveal-fade mt-10 flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="sky-place">
            Location
          </label>
          <select
            id="sky-place"
            value={selectValue}
            onChange={(e) => {
              const v = e.target.value;
              setPlace(v === MY_LOCATION ? here : (CITIES.find((c) => c.name === v) ?? null));
            }}
            className="h-11 rounded-full border border-ink/30 bg-void px-5 font-mono text-xs tracking-[0.12em] text-ink outline-none transition-colors focus:border-ink/70"
          >
            {here && <option value={MY_LOCATION}>MY LOCATION · {here.name}</option>}
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
            className="h-11 rounded-full border border-ink/40 px-5 text-[11px] font-semibold tracking-[0.12em] text-ink transition-colors hover:border-ink hover:bg-ink hover:text-void disabled:opacity-50"
          >
            <ScrambleText text={locating ? "LOCATING…" : "USE MY LOCATION"} />
          </button>
          {geoError && <p className="w-full font-mono text-xs text-gold">{geoError}</p>}
        </div>

        <div className="reveal-fade frame mt-8 bg-void/55 backdrop-blur-sm" aria-live="polite">
          {report ? (
            <>
              <div className="flex flex-col items-center gap-6 border-b border-ink/10 p-6 sm:flex-row sm:items-center sm:gap-8 sm:p-7">
                <div className="relative">
                  <MoonSphere phaseAngle={report.moon.phaseAngle} southern={(place?.lat ?? 0) < 0} size={168} />
                  <span className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_60px_rgba(236,238,242,0.08)]" />
                </div>

                <div className="w-full min-w-0 flex-1">
                  <p className="font-mono text-[10px] tracking-[0.22em] text-ink/45">MOON · TONIGHT</p>
                  <p className="display mt-3 text-[1.6rem] leading-none text-ink">{report.moon.name}</p>

                  <div className="mt-5 flex items-baseline gap-2">
                    <span className="display text-[2.6rem] leading-none tabular-nums text-gold">
                      {Math.round(report.moon.illuminated * 100)}
                    </span>
                    <span className="font-mono text-xs tracking-[0.18em] text-gold/80">% LIT</span>
                  </div>
                  <div className="mt-3 h-px w-full bg-ink/15">
                    <div className="h-px bg-gold" style={{ width: `${report.moon.illuminated * 100}%` }} />
                  </div>

                  <dl className="mt-5 grid grid-cols-2 gap-4 font-mono text-xs">
                    {[
                      ["NEXT FULL MOON", report.moon.nextFull],
                      ["NEXT NEW MOON", report.moon.nextNew],
                    ].map(([label, date]) => (
                      <div key={label as string}>
                        <dt className="text-[10px] tracking-[0.2em] text-ink/45">{label as string}</dt>
                        <dd className="mt-1.5 tracking-[0.08em] text-ink">
                          {formatDay(date as Date | null, tz)}
                          <span className="ml-2 text-ink/45">{inDays(date as Date | null)}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>

              <dl className="grid grid-cols-2 border-b border-ink/10 font-mono text-xs sm:grid-cols-4">
                {[
                  ["SUNSET", formatTime(report.sunset, tz)],
                  ["DARK SKY", report.darkNow ? "NOW" : formatTime(report.darkness, tz)],
                  [
                    "MOON",
                    report.moon.up
                      ? `SETS ${formatTime(report.moon.set, tz)}`
                      : `RISES ${formatTime(report.moon.rise, tz)}`,
                  ],
                  ["SUNRISE", formatTime(report.sunrise, tz)],
                ].map(([label, value], i) => (
                  <div
                    key={label}
                    className={`p-4 sm:p-5 ${i % 2 === 0 ? "border-r" : ""} ${i < 2 ? "border-b sm:border-b-0" : ""} border-ink/10 sm:[&:not(:last-child)]:border-r`}
                  >
                    <dt className="text-[10px] tracking-[0.2em] text-ink/45">{label}</dt>
                    <dd className="mt-1.5 tabular-nums tracking-[0.08em] text-ink">{value}</dd>
                  </div>
                ))}
              </dl>

              <div className="p-5 sm:p-6">
                <p className="font-mono text-[10px] tracking-[0.2em] text-ink/45">
                  NAKED-EYE PLANETS · {report.darkNow ? "NOW" : `AT ${formatTime(report.at, tz)}`}
                </p>
                {report.planets.length ? (
                  <ul className="mt-4 divide-y divide-ink/10">
                    {report.planets.map((p) => (
                      <li key={p.name} className="flex items-baseline justify-between gap-4 py-3">
                        <span className="display text-base text-ink">{p.name}</span>
                        <span className="font-mono text-xs tracking-[0.12em] text-ink/70">
                          {p.direction} · {Math.round(p.altitude)}° UP · MAG {p.magnitude.toFixed(1)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="caps mt-4 text-[12px] text-ink/60">
                    No bright planets above the horizon then — the Moon has the sky.
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="p-6 font-mono text-xs tracking-[0.15em] text-ink/45">CALCULATING…</p>
          )}
        </div>

        <a
          href="#tools"
          className="reveal-fade mt-6 inline-block font-mono text-[11px] tracking-[0.18em] text-ink/60 transition-colors hover:text-gold"
        >
          <ScrambleText text="SATELLITE PASSES ARRIVE WITH ORBIT WATCH →" />
        </a>
      </div>
    </section>
  );
}
