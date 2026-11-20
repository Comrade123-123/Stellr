"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import * as THREE from "three";
import type { SpaceWeather as Data } from "@/app/api/space-weather/route";
import type { Drivers, View } from "@/components/canvas/SpaceWeatherScene";
import PlacePicker, { usePlace } from "@/components/PlacePicker";
import { CleanHint, SceneShade, Section, Segmented, Stat, Status, ToolBar, glass, useClean, wide } from "@/components/tools/ToolShell";

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

/** 3-day Kp forecast as bars, coloured once they reach storm level. */
function Forecast({ points, timeZone }: { points: { at: string; kp: number }[]; timeZone?: string }) {
  const days = new Map<string, { at: string; kp: number }[]>();
  for (const p of points.slice(0, 24)) {
    const key = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", timeZone }).format(new Date(p.at)).toUpperCase();
    days.set(key, [...(days.get(key) ?? []), p]);
  }
  return (
    <div className="mt-4">
      <div className="relative flex h-24 items-end gap-[3px]" role="img" aria-label="Kp forecast for the next three days">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-gold/40" style={{ bottom: `${(5 / 9) * 100}%` }} />
        {points.slice(0, 24).map((p) => (
          <div
            key={p.at}
            title={`${fmtTime(p.at, timeZone)} · Kp ${p.kp.toFixed(1)}`}
            className={`flex-1 rounded-t-[3px] ${p.kp >= 5 ? "bg-gold" : p.kp >= 4 ? "bg-ink/55" : "bg-ink/20"}`}
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
      <p className="mt-2 text-[11px] text-ink/40">Gold bars reach storm level (Kp 5+), above the dashed line.</p>
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
  const [clean, setClean] = useClean();

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

  const storm = kp !== null && kp >= 5;

  /** The state of Earth's field right now, and NOAA's three scales. */
  const nowCard = (
    <div className={glass}>
      <Section eyebrow="GEOMAGNETIC FIELD · NOW">
        {load === "loading" ? (
          <Status>READING NOAA FEEDS…</Status>
        ) : load === "error" ? (
          <Status tone="red">
            NOAA DATA UNAVAILABLE ·{" "}
            <button type="button" onClick={fetchData} className="text-gold hover:underline">
              RETRY
            </button>
          </Status>
        ) : (
          <Status tone={storm ? "gold" : "ink"}>{head.text}</Status>
        )}
        <div className="mt-4 flex items-end gap-3">
          <span className={`display text-[56px] leading-[0.85] ${storm ? "text-gold" : "text-ink"}`}>{kp === null ? "—" : kp.toFixed(1)}</span>
          <span className="pb-1 font-mono text-[9px] tracking-[0.2em] text-ink/45">
            KP INDEX
            <br />0 CALM · 9 EXTREME
          </span>
        </div>
        <div className="mt-4 flex gap-[3px]" aria-hidden>
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className={`h-2 flex-1 rounded-full ${kp !== null && kp >= i + 0.5 ? (i >= 4 ? "bg-gold" : "bg-ink/70") : "bg-ink/12"}`} />
          ))}
        </div>
      </Section>
      <div className="grid grid-cols-3 border-t border-ink/[0.08]">
        {(["R", "S", "G"] as const).map((k, i) => {
          const sc = data?.scales?.[k];
          return (
            <div key={k} className={`px-3 py-4 text-center ${i ? "border-l border-ink/[0.08]" : ""}`}>
              <p className={`display text-[24px] leading-none ${sc && sc.level > 0 ? "text-gold" : "text-ink"}`}>
                {k}
                {sc ? sc.level : "–"}
              </p>
              <p className="mt-1.5 font-mono text-[8px] tracking-[0.16em] text-ink/45">{k === "R" ? "RADIO BLACKOUT" : k === "S" ? "RADIATION" : "GEOMAG STORM"}</p>
            </div>
          );
        })}
      </div>
      <Section eyebrow="THE SUN · X-RAYS">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Stat label="NOW" value={data?.flares?.now.class ?? "—"} sub="flare class A · B · C · M · X" accent={/^[MX]/.test(data?.flares?.now.class ?? "")} />
          <Stat label="24 H PEAK" value={data?.flares?.peak.class ?? "—"} sub={data?.flares ? fmtTime(data.flares.peak.at, tz).toLowerCase() : undefined} accent={/^[MX]/.test(data?.flares?.peak.class ?? "")} />
        </div>
      </Section>
    </div>
  );

  /** The solar wind, the aurora where the visitor is, and the forecast. */
  const detailCard = (
    <div className={glass}>
      <Section eyebrow="SOLAR WIND · AT L1">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Stat label="SPEED" value={wind?.speed != null ? `${Math.round(wind.speed)} km/s` : "—"} sub={wind?.speed != null ? windWord(wind.speed).toLowerCase() : undefined} accent={(wind?.speed ?? 0) >= 550} />
          <Stat label="DENSITY" value={wind?.density != null ? `${wind.density.toFixed(1)} p/cm³` : "—"} accent={(wind?.density ?? 0) >= 15} />
          <Stat
            label="FIELD BZ"
            value={wind?.bz != null ? `${wind.bz > 0 ? "+" : ""}${wind.bz.toFixed(1)} nT` : "—"}
            sub={wind?.bz != null ? (wind.bz <= -5 ? "southward · storm fuel" : wind.bz < 0 ? "slightly south" : "northward · calm") : undefined}
            accent={(wind?.bz ?? 0) <= -5}
          />
          <Stat label="FIELD STRENGTH" value={wind?.bt != null ? `${wind.bt.toFixed(1)} nT` : "—"} />
        </div>
      </Section>
      <Section eyebrow="AURORA · YOUR SKY">
        <PlacePicker state={placeState} />
        <div className="mt-4 grid grid-cols-2 gap-3">
          {[
            ["OVERHEAD", chance?.overhead],
            ["ON THE HORIZON", chance?.horizon],
          ].map(([k, v]) => (
            <div key={k as string} className={`rounded-xl px-3 py-3 ${typeof v === "number" && v >= 10 ? "bg-[#3dff9a]/[0.08]" : "bg-ink/[0.04]"}`}>
              <p className="font-mono text-[9px] tracking-[0.18em] text-ink/45">{k}</p>
              <p className={`display mt-1 text-[26px] leading-none ${typeof v === "number" && v >= 10 ? "text-[#7dffb8]" : "text-ink"}`}>{typeof v === "number" ? `${v}%` : "—"}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-ink/50">
          {chance && chance.horizon >= 10
            ? `Look ${place && place.lat < 0 ? "south" : "north"} from somewhere dark, after full night falls.`
            : "Aurora is unlikely from here right now."}{" "}
          Your location never leaves this page.
        </p>
      </Section>
      <Section eyebrow="KP FORECAST · NEXT 3 DAYS">
        {data?.forecast?.length ? <Forecast points={data.forecast} timeZone={tz} /> : <p className="text-[13px] text-ink/45">—</p>}
      </Section>
    </div>
  );

  const note = (
    <p className="px-2 font-mono text-[9px] leading-relaxed tracking-[0.14em] text-ink/35">
      DATA FROM{" "}
      <a href="https://www.swpc.noaa.gov" target="_blank" rel="noreferrer" className="text-ink/60 hover:text-gold">
        NOAA SPACE WEATHER PREDICTION CENTER
      </a>{" "}
      · REFRESHED EVERY 5 MIN{data ? ` · UPDATED ${fmtTime(data.at, tz)}` : ""} · SIZES AND DISTANCES NOT TO SCALE; THE DATA IS REAL
    </p>
  );

  return (
    <main className="relative bg-void text-ink">
      <section className={`relative w-full overflow-hidden ${clean ? "h-svh" : "h-[64svh] lg:h-svh"} min-h-[480px]`}>
        <div className="absolute inset-0">
          <Scene drivers={drivers} aurora={grid?.texture ?? null} observer={place} view={view} />
        </div>
        <SceneShade clean={clean} />
        <ToolBar title="Space Weather" tagline="The Sun's wind, Earth's magnetic shield and tonight's aurora, live from NOAA." clean={clean} onClean={() => setClean(!clean)}>
          <Segmented options={[["system", "Sun → Earth"], ["aurora", "Aurora"]]} value={view} onChange={(v) => setView(v as View)} />
        </ToolBar>
        {/* One column on the right: the Sun sits at the left of the scene. */}
        <aside className={`cosmo-scroll absolute bottom-4 right-4 top-20 z-10 w-[360px] space-y-3 overflow-y-auto ${wide(clean)}`}>
          {nowCard}
          {detailCard}
          <div className="mt-3">{note}</div>
        </aside>
        <CleanHint clean={clean} />
      </section>
      <div className={`space-y-4 px-4 pb-10 pt-4 lg:hidden ${clean ? "hidden" : ""}`}>
        {nowCard}
        {detailCard}
        {note}
      </div>
    </main>
  );
}
