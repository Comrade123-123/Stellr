"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Launch } from "@/app/api/launches/route";
import PlacePicker, { usePlace } from "@/components/PlacePicker";
import ScrambleText from "@/components/ui/ScrambleText";
import { compass, parseTLE, passes } from "@/lib/orbits";
import type { Place } from "@/lib/places";
import { computeEvents, type EventKind, type SkyEvent } from "@/lib/skyEvents";

const DAY = 86_400_000;

const FILTERS: { kind: EventKind | "all"; label: string }[] = [
  { kind: "all", label: "ALL" },
  { kind: "eclipse", label: "ECLIPSES" },
  { kind: "meteors", label: "METEORS" },
  { kind: "planets", label: "PLANETS" },
  { kind: "moon", label: "MOON" },
  { kind: "iss", label: "ISS" },
  { kind: "launch", label: "LAUNCHES" },
  { kind: "season", label: "SEASONS" },
];

const KIND_LABEL: Record<EventKind, string> = {
  eclipse: "ECLIPSE",
  meteors: "METEORS",
  planets: "PLANETS",
  moon: "MOON",
  iss: "ISS",
  launch: "LAUNCH",
  season: "SEASON",
};

type Load = "loading" | "ready" | "error";

/** Bright ISS passes over the next week: sunlit station, dark sky. */
async function issEvents(place: Place): Promise<SkyEvent[]> {
  const res = await fetch("/api/tle?group=stations");
  if (!res.ok) throw new Error(String(res.status));
  const iss = parseTLE(await res.text()).find((s) => s.id === 25544);
  if (!iss) return [];
  return passes(iss, place, new Date(), 7 * 24)
    .filter((p) => p.visible)
    .map((p) => ({
      id: `iss-${p.start.getTime()}`,
      kind: "iss" as const,
      title: "ISS flies over",
      at: p.start,
      end: p.end,
      detail: `The International Space Station crosses your sky as a bright, steady star, ${Math.round(p.maxElevation)}° high at its best.`,
      visible: true,
      howTo: `Appears in the ${compass(p.startAzimuth)}, disappears in the ${compass(p.endAzimuth)}, about ${Math.max(1, Math.round((p.end.getTime() - p.start.getTime()) / 60_000))} minutes.`,
    }));
}

async function launchEvents(): Promise<SkyEvent[]> {
  const res = await fetch("/api/launches");
  const data = (await res.json()) as { launches: Launch[]; error?: boolean };
  if (!res.ok || data.error) throw new Error("launches");
  return data.launches.map((l) => ({
    id: `launch-${l.id}`,
    kind: "launch" as const,
    title: l.name,
    at: new Date(l.net),
    detail: [l.provider, l.rocket, l.orbit && `to ${l.orbit}`].filter(Boolean).join(" · ") + (l.mission ? `. ${l.mission}` : ""),
    visible: null,
    howTo: [l.pad, l.country].filter(Boolean).join(" · "),
    url: l.video ?? undefined,
    status: l.status,
    timeKnown: l.timeKnown,
  }));
}

type Shown = SkyEvent & { status?: string; timeKnown?: boolean };

function fmt(date: Date, opts: Intl.DateTimeFormatOptions, timeZone?: string) {
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone }).format(date).toUpperCase();
}

/** A calendar file for one event, so it can be saved to a phone or Google Calendar. */
function downloadIcs(e: Shown) {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  const end = e.end && e.end > e.at ? e.end : new Date(e.at.getTime() + 60 * 60_000);
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Stellr//Sky Events//EN",
    "BEGIN:VEVENT",
    `UID:${e.id}@stellr`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(e.at)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(e.title)}`,
    `DESCRIPTION:${esc([e.detail, e.howTo].filter(Boolean).join("\n"))}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(e.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${e.title.replace(/[^\w]+/g, "-").toLowerCase()}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

function Badge({ e }: { e: Shown }) {
  if (e.kind === "launch") {
    const go = e.status?.toUpperCase() === "GO";
    return <span className={`font-mono text-[10px] tracking-[0.18em] ${go ? "text-gold" : "text-ink/45"}`}>{go ? "● GO" : e.status?.toUpperCase()}</span>;
  }
  if (e.visible === null) return null;
  return (
    <span className={`font-mono text-[10px] tracking-[0.18em] ${e.visible ? "text-gold" : "text-ink/35"}`}>
      {e.visible ? "VISIBLE FROM HERE" : "NOT FROM HERE"}
    </span>
  );
}

function EventRow({ e, timeZone }: { e: Shown; timeZone?: string }) {
  const roughDate = e.kind === "launch" && e.timeKnown === false;
  const dayOnly = e.kind === "meteors";
  return (
    <li className="grid grid-cols-[3.5rem_1fr] gap-x-5 border-b border-ink/10 py-5 sm:grid-cols-[4.5rem_1fr]">
      <div className="text-right">
        <p className="display text-2xl leading-none text-ink sm:text-3xl">{fmt(e.at, { day: "2-digit" }, timeZone)}</p>
        <p className="mt-1.5 font-mono text-[10px] tracking-[0.18em] text-ink/50">{fmt(e.at, { weekday: "short" }, timeZone)}</p>
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="font-mono text-[10px] tracking-[0.2em] text-ink/45">
            {KIND_LABEL[e.kind]} ·{" "}
            {roughDate ? "TIME TBD" : dayOnly ? "NIGHT OF THE PEAK" : fmt(e.at, { hour: "2-digit", minute: "2-digit", hour12: false }, timeZone)}
          </p>
          <Badge e={e} />
        </div>
        <h3 className="display mt-2 text-lg text-ink sm:text-xl">{e.title}</h3>
        <p className="mt-2 text-[14px] leading-relaxed text-ink/65">{e.detail}</p>
        {e.howTo && <p className="mt-2 font-mono text-[11px] leading-relaxed tracking-[0.04em] text-ink/50">{e.howTo}</p>}
        <div className="mt-3 flex flex-wrap gap-4 font-mono text-[10px] tracking-[0.18em]">
          {!roughDate && (
            <button type="button" onClick={() => downloadIcs(e)} className="text-ink/60 transition-colors hover:text-gold">
              + ADD TO CALENDAR
            </button>
          )}
          {e.url && (
            <a href={e.url} target="_blank" rel="noreferrer" className="text-ink/60 transition-colors hover:text-gold">
              WATCH LIVE ↗
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

/** Sky Events: eclipses, meteor showers, planets, the Moon, bright ISS passes and launches, for where you are. */
export default function SkyEvents() {
  const placeState = usePlace();
  const { place } = placeState;
  const [filter, setFilter] = useState<EventKind | "all">("all");
  const [onlyVisible, setOnlyVisible] = useState(false);
  const [computed, setComputed] = useState<SkyEvent[] | null>(null);
  const [iss, setIss] = useState<{ load: Load; events: SkyEvent[] }>({ load: "loading", events: [] });
  const [launches, setLaunches] = useState<{ load: Load; events: Shown[] }>({ load: "loading", events: [] });
  // The page's idea of "now", ticking each minute so past events drop off and "this week" moves on.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  // A year of sky events takes a few hundred milliseconds; let the page paint first.
  useEffect(() => {
    if (!place) return;
    const id = setTimeout(() => setComputed(computeEvents(place)), 30);
    return () => clearTimeout(id);
  }, [place]);

  useEffect(() => {
    if (!place) return;
    let cancelled = false;
    issEvents(place)
      .then((events) => !cancelled && setIss({ load: "ready", events }))
      .catch(() => !cancelled && setIss({ load: "error", events: [] }));
    return () => {
      cancelled = true;
    };
  }, [place]);

  const loadLaunches = useCallback(() => {
    setLaunches({ load: "loading", events: [] });
    launchEvents()
      .then((events) => setLaunches({ load: "ready", events }))
      .catch(() => setLaunches({ load: "error", events: [] }));
  }, []);
  useEffect(() => {
    // Launches come over the network, so they can only load after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadLaunches();
  }, [loadLaunches]);

  const all: Shown[] = useMemo(() => {
    return [...(computed ?? []), ...iss.events, ...launches.events]
      .filter((e) => (e.end ?? e.at).getTime() > now - 12 * 3_600_000)
      .sort((a, b) => a.at.getTime() - b.at.getTime());
  }, [computed, iss.events, launches.events, now]);

  const shown = all.filter((e) => (filter === "all" || e.kind === filter) && (!onlyVisible || e.visible !== false));
  const week = shown.filter((e) => e.at.getTime() < now + 7 * DAY);
  const later = shown.filter((e) => e.at.getTime() >= now + 7 * DAY);
  const tz = place?.timeZone;

  const months = new Map<string, Shown[]>();
  for (const e of later) {
    const key = fmt(e.at, { month: "long", year: "numeric" }, tz);
    months.set(key, [...(months.get(key) ?? []), e]);
  }

  const note =
    filter === "launch" && launches.load !== "ready"
      ? launches.load === "loading"
        ? "LOADING LAUNCHES…"
        : null
      : filter === "iss" && iss.load === "loading"
        ? "COMPUTING ISS PASSES…"
        : null;

  return (
    <main className="relative min-h-svh bg-void px-5 pb-24 pt-8 text-ink sm:px-8 lg:px-16">
      <div className="mx-auto max-w-[1100px]">
        <Link href="/" className="font-mono text-[11px] tracking-[0.2em] text-ink/60 transition-colors hover:text-gold">
          <ScrambleText text="← STELLR" />
        </Link>

        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_360px] lg:items-end">
          <div>
            <h1 className="display text-[clamp(2rem,4.4vw,4rem)] text-ink">Sky Events</h1>
            <p className="caps mt-4 max-w-[46ch] text-[12px] text-ink/60 sm:text-[13px]">
              Eclipses, meteor showers, planets, the Moon, the ISS and rocket launches: a year of the sky, in your time zone,
              marked by what you can see from where you stand.
            </p>
          </div>
          <div className="frame bg-void/70 p-5">
            <p className="font-mono text-[10px] tracking-[0.2em] text-ink/45">YOUR SKY</p>
            <div className="mt-3">
              <PlacePicker state={placeState} />
            </div>
            <p className="caps mt-3 text-[10px] text-ink/45">Computed in your browser. Your location never leaves this page.</p>
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-center gap-2 border-b border-ink/10 pb-6">
          {FILTERS.map((f) => (
            <button
              key={f.kind}
              type="button"
              onClick={() => setFilter(f.kind)}
              className={`rounded-full border px-4 py-1.5 font-mono text-[10px] tracking-[0.2em] transition-colors ${
                filter === f.kind ? "border-gold bg-gold text-void" : "border-ink/25 text-ink/70 hover:border-ink/60"
              }`}
            >
              {f.label}
            </button>
          ))}
          <label className="ml-auto flex cursor-pointer items-center gap-3 font-mono text-[10px] tracking-[0.18em] text-ink/60">
            <input
              type="checkbox"
              checked={onlyVisible}
              onChange={(e) => setOnlyVisible(e.target.checked)}
              className="h-4 w-4 accent-[#c9a46a]"
            />
            ONLY WHAT I CAN SEE
          </label>
        </div>

        {!computed ? (
          <p className="py-10 font-mono text-xs tracking-[0.15em] text-ink/45">CALCULATING THE NEXT YEAR OF SKY…</p>
        ) : (
          <>
            <section className="mt-10">
              <h2 className="font-mono text-[11px] tracking-[0.22em] text-gold">● THIS WEEK</h2>
              {week.length ? (
                <ul>
                  {week.map((e) => (
                    <EventRow key={e.id} e={e} timeZone={tz} />
                  ))}
                </ul>
              ) : (
                <p className="caps py-6 text-[12px] text-ink/50">Nothing of this kind in the next seven days.</p>
              )}
            </section>

            {[...months].map(([month, events]) => (
              <section key={month} className="mt-14">
                <h2 className="font-mono text-[11px] tracking-[0.22em] text-ink/50">{month}</h2>
                <ul>
                  {events.map((e) => (
                    <EventRow key={e.id} e={e} timeZone={tz} />
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}

        {note && <p className="mt-8 font-mono text-[10px] tracking-[0.18em] text-ink/45">{note}</p>}
        <div className="mt-14 space-y-2 font-mono text-[10px] tracking-[0.15em] text-ink/40">
          {launches.load === "error" && (
            <p>
              LAUNCH SCHEDULE UNAVAILABLE RIGHT NOW.{" "}
              <button type="button" onClick={loadLaunches} className="text-gold hover:underline">
                RETRY
              </button>
            </p>
          )}
          {iss.load === "error" && <p>ISS PASSES UNAVAILABLE RIGHT NOW.</p>}
          <p>
            ECLIPSES, MOON AND PLANETS COMPUTED IN YOUR BROWSER · METEOR PEAKS FROM THE IMO CALENDAR · LAUNCHES FROM{" "}
            <a href="https://thespacedevs.com" target="_blank" rel="noreferrer" className="text-ink/70 hover:text-gold">
              THE SPACE DEVS
            </a>{" "}
            · ISS FROM{" "}
            <a href="https://celestrak.org" target="_blank" rel="noreferrer" className="text-ink/70 hover:text-gold">
              CELESTRAK
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
