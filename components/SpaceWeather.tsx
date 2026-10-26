"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import * as THREE from "three";
import type { SpaceWeather as Data } from "@/app/api/space-weather/route";
import type { Drivers, View } from "@/components/canvas/SpaceWeatherScene";
import PlacePicker, { usePlace } from "@/components/PlacePicker";
import ScrambleText from "@/components/ui/ScrambleText";

const Scene = dynamic(() => import("@/components/canvas/SpaceWeatherScene"), { ssr: false });

/** Typical quiet conditions, used for any feed that's missing so the scene still makes sense. */
const QUIET: Drivers = { speed: 400, density: 5, bz: 0, flux: 1e-7 };

type Load = "loading" | "ready" | "error";

/** NOAA's G scale from Kp: G1 at Kp 5 up to G5 at Kp 9. */
const gLevel = (kp: number) => (kp >= 9 ? 5 : kp >= 8 ? 4 : kp >= 7 ? 3 : kp >= 6 ? 2 : kp >= 5 ? 1 : 0);
const G_NAMES = ["", "MINOR", "MODERATE", "STRONG", "SEVERE", "EXTREME"];

function headline(kp: number | null) {
  if (kp === null) return { text: "CONDITIONS UNKNOWN", tone: "text-ink/60" };
  const g = gLevel(kp);
  if (g) return { text: `${G_NAMES[g]} GEOMAGNETIC STORM · G${g}`, tone: "text-gold" };
  if (kp >= 4) return { text: "ACTIVE · UNSETTLED FIELD", tone: "text-ink" };
  return { text: "QUIET", tone: "text-ink" };
}

const windWord = (v: number) => (v >= 700 ? "VERY FAST" : v >= 550 ? "FAST" : v >= 400 ? "MODERATE" : "SLOW");

/** Decodes the API's 180 × 91 aurora grid (2° cells) into bytes and a texture for the globe. */
function useAurora(aurora: Data["aurora"] | undefined) {
  return useMemo(() => {
    if (!aurora) return null;
    const bytes = Uint8Array.from(atob(aurora.grid), (c) => c.charCodeAt(0));
    // Stretch 0–100 to 0–255 so the shader reads it as 0–1.
    const tex = new THREE.DataTexture(bytes.map((v) => Math.round(v * 2.55)), aurora.width, aurora.height, THREE.RedFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return { bytes, width: aurora.width, height: aurora.height, texture: tex };
  }, [aurora]);
}

/**
 * Chance of aurora for a place: directly overhead (the grid cell there), and anywhere
 * on the poleward horizon, which from a dark site reaches about 8° of latitude away.
 */
function auroraChance(grid: NonNullable<ReturnType<typeof useAurora>>, lat: number, lon: number) {
  const cell = (la: number, lo: number) => {
    const x = Math.floor((((lo % 360) + 360) % 360) / 2) % grid.width;
    const y = Math.min(grid.height - 1, Math.max(0, Math.round((la + 90) / 2)));
    return grid.bytes[y * grid.width + x];
  };
  const overhead = cell(lat, lon);
  let horizon = overhead;
  const pole = lat >= 0 ? 1 : -1;
  for (let d = 0; d <= 8; d += 2) for (let dl = -6; dl <= 6; dl += 2) horizon = Math.max(horizon, cell(lat + pole * d, lon + dl));
  return { overhead, horizon };
}

function fmtTime(iso: string | null | undefined, timeZone?: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso)).toUpperCase();
}

function Stat({ label, value, note, hot }: { label: string; value: string; note?: string; hot?: boolean }) {
  return (
    <div className="p-4">
      <dt className="font-mono text-[10px] tracking-[0.2em] text-ink/45">{label}</dt>
      <dd className={`mt-1.5 font-mono text-sm tabular-nums tracking-[0.06em] ${hot ? "text-gold" : "text-ink"}`}>{value}</dd>
      {note && <dd className="mt-1 font-mono text-[9px] tracking-[0.16em] text-ink/40">{note}</dd>}
    </div>
  );
}

/** 3-day Kp forecast as bars, coloured once they reach storm level. */
function Forecast({ points, timeZone }: { points: { at: string; kp: number }[]; timeZone?: string }) {
  const days = new Map<string, { at: string; kp: number }[]>();
  for (const p of points.slice(0, 24)) {
    const key = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", timeZone }).format(new Date(p.at)).toUpperCase();
    days.set(key, [...(days.get(key) ?? []), p]);
  }
  return (
    <div className="mt-4">
      <div className="flex h-24 items-end gap-[3px]" role="img" aria-label="Kp forecast for the next three days">
        {points.slice(0, 24).map((p) => (
          <div
            key={p.at}
            title={`${fmtTime(p.at, timeZone)} · Kp ${p.kp.toFixed(1)}`}
            className={`flex-1 ${p.kp >= 5 ? "bg-gold" : p.kp >= 4 ? "bg-ink/60" : "bg-ink/25"}`}
            style={{ height: `${Math.max(4, (p.kp / 9) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex font-mono text-[9px] tracking-[0.14em] text-ink/40">
        {[...days].map(([day, pts]) => (
          <span key={day} style={{ flex: pts.length }}>
            {day}
          </span>
        ))}
      </div>
      <p className="mt-2 font-mono text-[9px] tracking-[0.14em] text-ink/40">BARS IN GOLD REACH STORM LEVEL (KP 5+)</p>
    </div>
  );
}

/** Space Weather: the Sun, the solar wind, Earth's field and tonight's aurora, live from NOAA. */
export default function SpaceWeather() {
  const placeState = usePlace();
  const { place } = placeState;
  const [data, setData] = useState<Data | null>(null);
  const [load, setLoad] = useState<Load>("loading");
  const [view, setView] = useState<View>("system");

  const fetchData = useCallback(() => {
    fetch("/api/space-weather")
      .then(async (res) => {
        const body = (await res.json()) as Data;
        if (!res.ok) throw new Error(String(res.status));
        setData(body);
        setLoad("ready");
      })
      .catch(() => setLoad((l) => (l === "ready" ? l : "error")));
  }, []);
  useEffect(() => {
    // The feeds come over the network, so they can only load after mount; refresh every five minutes.
    fetchData();
    const id = setInterval(fetchData, 5 * 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const drivers: Drivers = useMemo(
    () => ({
      speed: data?.wind?.speed ?? QUIET.speed,
      density: data?.wind?.density ?? QUIET.density,
      bz: data?.wind?.bz ?? QUIET.bz,
      flux: data?.flares?.now.flux ?? QUIET.flux,
    }),
    [data],
  );
  const grid = useAurora(data?.aurora);
  const chance = grid && place ? auroraChance(grid, place.lat, place.lon) : null;
  const kp = data?.kp?.now.kp ?? null;
  const head = headline(kp);
  const tz = place?.timeZone;
  const wind = data?.wind;

  return (
    <main className="relative min-h-svh bg-void text-ink lg:h-svh lg:overflow-hidden">
      <div className="relative h-[58svh] w-full lg:absolute lg:inset-0 lg:h-full">
        <Scene drivers={drivers} aurora={grid?.texture ?? null} observer={place} view={view} />
      </div>

      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-5 sm:p-8">
        <div className="pointer-events-auto">
          <Link href="/" className="font-mono text-[11px] tracking-[0.2em] text-ink/60 transition-colors hover:text-gold">
            <ScrambleText text="← STELLR" />
          </Link>
          <h1 className="display mt-5 text-[clamp(1.6rem,3vw,2.8rem)] text-ink">Space Weather</h1>
          <p className="caps mt-2 hidden max-w-[36ch] text-[11px] text-ink/55 sm:block sm:text-[12px]">
            The Sun&apos;s wind, Earth&apos;s magnetic shield and tonight&apos;s aurora, live from NOAA. Sizes and distances are not to
            scale; the data is real.
          </p>
        </div>
        <div className="pointer-events-auto flex gap-2">
          {(["system", "aurora"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`whitespace-nowrap rounded-full border px-4 py-2 font-mono text-[10px] tracking-[0.2em] transition-colors ${
                view === v ? "border-gold bg-gold text-void" : "border-ink/30 text-ink/70 hover:border-ink/60"
              }`}
            >
              {v === "system" ? "SUN → EARTH" : "AURORA"}
            </button>
          ))}
        </div>
      </header>

      <aside className="relative z-10 px-5 pb-10 sm:px-8 lg:absolute lg:bottom-8 lg:right-8 lg:top-28 lg:w-[388px] lg:overflow-y-auto lg:overflow-x-hidden lg:p-[4px]">
        <div className="frame bg-void/70 backdrop-blur-md">
          {/* Now */}
          <div className="border-b border-ink/10 p-5">
            <p className="font-mono text-[10px] tracking-[0.2em] text-ink/45">GEOMAGNETIC FIELD · NOW</p>
            <p className={`mt-2 font-mono text-[12px] tracking-[0.18em] ${head.tone}`}>
              {load === "loading" ? "READING NOAA FEEDS…" : load === "error" ? "NOAA DATA UNAVAILABLE" : head.text}
            </p>
            <div className="mt-4 flex items-end gap-4">
              <span className="display text-5xl leading-none text-ink">{kp === null ? "—" : kp.toFixed(1)}</span>
              <span className="pb-1 font-mono text-[10px] tracking-[0.2em] text-ink/50">KP INDEX · 0–9</span>
            </div>
            <div className="mt-3 flex gap-[3px]" aria-hidden>
              {Array.from({ length: 9 }, (_, i) => (
                <div
                  key={i}
                  className={`h-1.5 flex-1 ${kp !== null && kp >= i + 0.5 ? (i >= 4 ? "bg-gold" : "bg-ink/70") : "bg-ink/15"}`}
                />
              ))}
            </div>
            {load === "error" && (
              <button type="button" onClick={fetchData} className="mt-3 font-mono text-[10px] tracking-[0.2em] text-gold hover:underline">
                RETRY
              </button>
            )}
          </div>

          {/* Solar wind */}
          <dl className="grid grid-cols-2 border-b border-ink/10 [&>div:nth-child(odd)]:border-r [&>div]:border-ink/10 [&>div:nth-child(-n+2)]:border-b">
            <Stat label="SOLAR WIND" value={wind?.speed != null ? `${Math.round(wind.speed)} KM/S` : "—"} note={wind?.speed != null ? windWord(wind.speed) : undefined} hot={(wind?.speed ?? 0) >= 550} />
            <Stat label="DENSITY" value={wind?.density != null ? `${wind.density.toFixed(1)} P/CM³` : "—"} hot={(wind?.density ?? 0) >= 15} />
            <Stat
              label="FIELD BZ"
              value={wind?.bz != null ? `${wind.bz > 0 ? "+" : ""}${wind.bz.toFixed(1)} NT` : "—"}
              note={wind?.bz != null ? (wind.bz <= -5 ? "SOUTHWARD · STORM FUEL" : wind.bz < 0 ? "SLIGHTLY SOUTH" : "NORTHWARD · CALM") : undefined}
              hot={(wind?.bz ?? 0) <= -5}
            />
            <Stat label="FIELD STRENGTH" value={wind?.bt != null ? `${wind.bt.toFixed(1)} NT` : "—"} />
          </dl>

          {/* Sun */}
          <dl className="grid grid-cols-2 border-b border-ink/10 [&>div:first-child]:border-r [&>div]:border-ink/10">
            <Stat label="X-RAYS NOW" value={data?.flares?.now.class ?? "—"} note="FLARE CLASS A·B·C·M·X" hot={/^[MX]/.test(data?.flares?.now.class ?? "")} />
            <Stat
              label="24 H PEAK"
              value={data?.flares?.peak.class ?? "—"}
              note={data?.flares ? fmtTime(data.flares.peak.at, tz) : undefined}
              hot={/^[MX]/.test(data?.flares?.peak.class ?? "")}
            />
          </dl>

          {/* NOAA scales */}
          <div className="grid grid-cols-3 border-b border-ink/10 text-center">
            {(["R", "S", "G"] as const).map((k, i) => {
              const s = data?.scales?.[k];
              return (
                <div key={k} className={`p-4 ${i < 2 ? "border-r border-ink/10" : ""}`}>
                  <p className={`display text-2xl ${s && s.level > 0 ? "text-gold" : "text-ink"}`}>
                    {k}
                    {s ? s.level : "–"}
                  </p>
                  <p className="mt-1 font-mono text-[9px] tracking-[0.16em] text-ink/45">
                    {k === "R" ? "RADIO BLACKOUT" : k === "S" ? "RADIATION" : "GEOMAG STORM"}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Aurora for the visitor */}
          <div className="border-b border-ink/10 p-5">
            <p className="font-mono text-[10px] tracking-[0.2em] text-ink/45">AURORA · YOUR SKY</p>
            <div className="mt-3">
              <PlacePicker state={placeState} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 font-mono">
              <div>
                <p className="text-[10px] tracking-[0.2em] text-ink/45">OVERHEAD</p>
                <p className={`mt-1 text-xl tabular-nums ${chance && chance.overhead >= 10 ? "text-gold" : "text-ink"}`}>
                  {chance ? `${chance.overhead}%` : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] tracking-[0.2em] text-ink/45">ON THE HORIZON</p>
                <p className={`mt-1 text-xl tabular-nums ${chance && chance.horizon >= 10 ? "text-gold" : "text-ink"}`}>
                  {chance ? `${chance.horizon}%` : "—"}
                </p>
              </div>
            </div>
            <p className="caps mt-3 text-[10px] leading-relaxed text-ink/45">
              {chance && chance.horizon >= 10
                ? `Look ${place && place.lat < 0 ? "south" : "north"} from somewhere dark, after full night falls. Your location never leaves this page.`
                : "Aurora is unlikely from here right now. Your location never leaves this page."}
            </p>
          </div>

          {/* Forecast */}
          <div className="p-5">
            <p className="font-mono text-[10px] tracking-[0.2em] text-ink/45">KP FORECAST · NEXT 3 DAYS</p>
            {data?.forecast?.length ? <Forecast points={data.forecast} timeZone={tz} /> : <p className="mt-4 font-mono text-xs text-ink/45">—</p>}
          </div>
        </div>

        <p className="mt-4 font-mono text-[10px] leading-relaxed tracking-[0.15em] text-ink/40">
          DATA FROM{" "}
          <a href="https://www.swpc.noaa.gov" target="_blank" rel="noreferrer" className="text-ink/70 hover:text-gold">
            NOAA SPACE WEATHER PREDICTION CENTER
          </a>{" "}
          · REFRESHED EVERY 5 MIN{data ? ` · UPDATED ${fmtTime(data.at, tz)}` : ""}
        </p>
      </aside>
    </main>
  );
}
