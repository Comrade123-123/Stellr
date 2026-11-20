"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Launch } from "@/app/api/launches/route";
import PlacePicker, { usePlace } from "@/components/PlacePicker";
import { ToolBar, glass } from "@/components/tools/ToolShell";
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
    keywords: l.providerAbbrev,
  }));
}

type Shown = SkyEvent & { status?: string; timeKnown?: boolean; /** Extra words search should find, like ISRO for its full name. */ keywords?: string };

/** True when every word of the query appears somewhere in the event: its name, description, kind or month. */
function matches(e: Shown, words: string[], timeZone?: string) {
  if (!words.length) return true;
  const text = [e.title, e.detail, e.howTo ?? "", e.keywords ?? "", KIND_LABEL[e.kind], fmt(e.at, { month: "long", year: "numeric" }, timeZone)]
    .join(" ")
    .toLowerCase();
  return words.every((w) => text.includes(w));
}

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

/** Each kind's colour, for the dot, the card's edge and the filter chip. */
const KIND_COLOR: Record<EventKind, string> = {
  eclipse: "#ff8a5c",
  meteors: "#7fd4ff",
  planets: "#c9a46a",
  moon: "#dfe3ea",
  iss: "#8fe3b0",
  launch: "#ff6a3d",
  season: "#b9a2ff",
};

function Badge({ e }: { e: Shown }) {
  if (e.kind === "launch") {
    const go = e.status?.toUpperCase() === "GO";
    return (
      <span className={`whitespace-nowrap rounded-full px-2.5 py-1 font-mono text-[9px] tracking-[0.16em] ${go ? "bg-gold/15 text-gold" : "bg-ink/[0.06] text-ink/50"}`}>
        {go ? "● GO" : e.status?.toUpperCase()}
      </span>
    );
  }
  if (e.visible === null) return null;
  return (
    <span className={`whitespace-nowrap rounded-full px-2.5 py-1 font-mono text-[9px] tracking-[0.16em] ${e.visible ? "bg-gold/15 text-gold" : "bg-ink/[0.05] text-ink/40"}`}>
      {e.visible ? "VISIBLE FROM HERE" : "NOT FROM HERE"}
    </span>
  );
}

/** "In 3 days", "in 5 h", "now". */
function until(at: Date, now: number) {
  const ms = at.getTime() - now;
  if (ms <= 0) return "now";
  const h = ms / 3_600_000;
  if (h < 1) return `in ${Math.max(1, Math.round(ms / 60_000))} min`;
  if (h < 36) return `in ${Math.round(h)} h`;
  return `in ${Math.round(h / 24)} days`;
}

function Actions({ e }: { e: Shown }) {
  const roughDate = e.kind === "launch" && e.timeKnown === false;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {!roughDate && (
        <button type="button" onClick={() => downloadIcs(e)} className="rounded-full border border-ink/15 px-3 py-1.5 text-[12px] text-ink/70 transition-colors hover:border-gold/60 hover:text-gold">
          + Add to calendar
        </button>
      )}
      {e.url && (
        <a href={e.url} target="_blank" rel="noreferrer" className="rounded-full border border-ink/15 px-3 py-1.5 text-[12px] text-ink/70 transition-colors hover:border-gold/60 hover:text-gold">
          Watch live ↗
        </a>
      )}
    </div>
  );
}

function when(e: Shown, timeZone?: string) {
  const roughDate = e.kind === "launch" && e.timeKnown === false;
  return roughDate ? "time TBD" : e.kind === "meteors" ? "night of the peak" : fmt(e.at, { hour: "2-digit", minute: "2-digit", hour12: false }, timeZone);
}

/** One event on the timeline: a date block, then the card. */
function EventRow({ e, timeZone }: { e: Shown; timeZone?: string }) {
  const color = KIND_COLOR[e.kind];
  return (
    <li className="grid grid-cols-[3.2rem_1fr] gap-x-4 py-2 sm:grid-cols-[4.5rem_1fr] sm:gap-x-6">
      <div className="pt-4 text-right">
        <p className="display text-[26px] leading-none text-ink sm:text-[30px]">{fmt(e.at, { day: "2-digit" }, timeZone)}</p>
        <p className="mt-1.5 font-mono text-[9px] tracking-[0.18em] text-ink/45">{fmt(e.at, { weekday: "short" }, timeZone)}</p>
      </div>
      <article className="relative overflow-hidden rounded-2xl border border-ink/[0.08] bg-ink/[0.025] p-5 transition-colors hover:border-ink/20">
        <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="flex items-center gap-2 font-mono text-[9px] tracking-[0.2em] text-ink/50">
            <span className="block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
            {KIND_LABEL[e.kind]} · {when(e, timeZone).toUpperCase()}
          </p>
          <Badge e={e} />
        </div>
        <h3 className="mt-2.5 text-[18px] leading-snug text-ink sm:text-[20px]">{e.title}</h3>
        <p className="mt-2 text-[14px] leading-relaxed text-ink/65">{e.detail}</p>
        {e.howTo && <p className="mt-2 text-[13px] leading-relaxed text-ink/45">{e.howTo}</p>}
        <Actions e={e} />
      </article>
    </li>
  );
}

/** Sky Events: eclipses, meteor showers, planets, the Moon, bright ISS passes and launches, for where you are. */
export default function SkyEvents() {
  const placeState = usePlace();
  const { place } = placeState;
  const [filter, setFilter] = useState<EventKind | "all">("all");
  const [onlyVisible, setOnlyVisible] = useState(false);
  const [query, setQuery] = useState("");
  const searchBox = useRef<HTMLInputElement>(null);
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

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = all.filter(
    (e) => (filter === "all" || e.kind === filter) && (!onlyVisible || e.visible !== false) && matches(e, words, place?.timeZone),
  );
  const closeSearch = () => setQuery("");
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

  const next = all.find((e) => e.visible && e.at.getTime() > now);
  const counts = new Map<EventKind | "all", number>([["all", all.length]]);
  for (const e of all) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);

  return (
    <main className="relative min-h-svh overflow-x-clip bg-void text-ink">
      {/* Backdrop: stars over a faint horizon glow. */}
      <div aria-hidden className="starfield pointer-events-none absolute inset-x-0 top-0 h-[720px] opacity-60" />
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[560px] h-[1400px] w-[1800px] -translate-x-1/2 rounded-full bg-void shadow-[0_-2px_0_rgb(201_164_106/0.35),0_-40px_140px_rgb(201_164_106/0.16)]" />

      <div className="relative">
        <ToolBar title="Sky Events" tagline="A year of the sky, in your time zone, marked by what you can see from where you stand." />
      </div>

      <div className="relative mx-auto max-w-[1180px] px-5 pt-28 sm:px-8">
        <div className="grid gap-8 lg:grid-cols-[1fr_380px] lg:items-end">
          <div>
            <p className="font-mono text-[10px] tracking-[0.24em] text-ink/50">THE NEXT YEAR · {place ? place.name.toUpperCase() : "YOUR SKY"}</p>
            <h2 className="display mt-4 max-w-[16ch] text-[clamp(2.2rem,5vw,4.4rem)] leading-[1.02] text-ink">What&apos;s up in your sky.</h2>
            <p className="mt-5 max-w-[56ch] text-[15px] leading-relaxed text-ink/60">
              Eclipses, meteor showers, planets, the Moon, bright ISS passes and rocket launches, timed for where you are.
            </p>
          </div>
          <div className={`${glass} p-5`}>
            <p className="font-mono text-[9px] tracking-[0.22em] text-gold">NEXT UP YOU CAN SEE</p>
            {next ? (
              <>
                <p className="mt-3 text-[20px] leading-snug text-ink">{next.title}</p>
                <p className="mt-1.5 text-[13px] text-ink/55">
                  {fmt(next.at, { weekday: "short", day: "2-digit", month: "short" }, tz)} · {when(next, tz)} · <span className="text-gold">{until(next.at, now)}</span>
                </p>
              </>
            ) : (
              <p className="mt-3 text-[13px] text-ink/50">{computed ? "Nothing visible coming up." : "Calculating…"}</p>
            )}
            <div className="mt-5 border-t border-ink/[0.08] pt-4">
              <p className="mb-2.5 font-mono text-[9px] tracking-[0.22em] text-ink/45">YOUR SKY</p>
              <PlacePicker state={placeState} />
              <p className="mt-2 text-[11px] text-ink/40">Computed in your browser. Your location never leaves this page.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters, kept in reach while scrolling. */}
      <div className="sticky top-0 z-20 mt-12 border-y border-ink/[0.08] bg-[#050608]/85 backdrop-blur-xl">
        <div className="mx-auto max-w-[1180px] px-5 py-3 sm:px-8">
          <div className="cosmo-scroll flex items-center gap-1.5 overflow-x-auto">
            {FILTERS.map((f) => {
              const on = filter === f.kind;
              const color = f.kind === "all" ? "#eceef2" : KIND_COLOR[f.kind];
              return (
                <button
                  key={f.kind}
                  type="button"
                  onClick={() => setFilter(f.kind)}
                  className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] transition-colors ${on ? "border-ink bg-ink text-void" : "border-ink/15 text-ink/75 hover:border-ink/45"}`}
                >
                  {f.kind !== "all" && <span className="block h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
                  {f.kind === "iss" ? "ISS" : f.label.charAt(0) + f.label.slice(1).toLowerCase()}
                  <span className={`font-mono text-[10px] ${on ? "text-void/60" : "text-ink/35"}`}>{counts.get(f.kind) ?? 0}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <label htmlFor="event-search-input" className="sr-only">
                Search events
              </label>
              <svg className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/40" width="13" height="13" viewBox="0 0 12 12" fill="none" aria-hidden>
                <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.3" />
                <path d="M8 8l3 3" stroke="currentColor" strokeWidth="1.3" />
              </svg>
              <input
                ref={searchBox}
                id="event-search-input"
                type="search"
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && closeSearch()}
                placeholder="Search: Perseids, Mars, eclipse, ISRO, Falcon, December…"
                className="h-9 w-full rounded-full border border-ink/15 bg-ink/[0.04] pl-9 pr-4 text-[13px] text-ink outline-none placeholder:text-ink/35 focus:border-ink/50"
              />
            </div>
            {words.length > 0 && (
              <span className="font-mono text-[10px] tracking-[0.16em] text-ink/50" aria-live="polite">
                {shown.length} {shown.length === 1 ? "MATCH" : "MATCHES"}
              </span>
            )}
            <button
              type="button"
              role="switch"
              aria-checked={onlyVisible}
              onClick={() => setOnlyVisible(!onlyVisible)}
              className="flex items-center gap-2.5 text-[12px] text-ink/70"
            >
              <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${onlyVisible ? "bg-gold" : "bg-ink/20"}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-void transition-[left] ${onlyVisible ? "left-[18px]" : "left-0.5"}`} />
              </span>
              Only what I can see
            </button>
          </div>
        </div>
      </div>

      <div className="relative mx-auto max-w-[1180px] px-5 pb-24 sm:px-8">
        {!computed ? (
          <p className="py-12 font-mono text-[11px] tracking-[0.16em] text-ink/45">CALCULATING THE NEXT YEAR OF SKY…</p>
        ) : (
          <>
            <section className="pt-10">
              <h2 className="flex items-center gap-2 font-mono text-[11px] tracking-[0.22em] text-gold">
                <span className="live-dot block h-1.5 w-1.5 rounded-full bg-gold" /> THIS WEEK
              </h2>
              {week.length ? (
                <ul className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {week.map((e) => (
                    <li key={e.id} className="relative flex flex-col overflow-hidden rounded-2xl border border-ink/[0.1] bg-[#07080b]/80 p-5 backdrop-blur-md">
                      <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: KIND_COLOR[e.kind] }} />
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="display text-[34px] leading-none text-ink">{fmt(e.at, { day: "2-digit" }, tz)}</p>
                          <p className="mt-1 font-mono text-[9px] tracking-[0.18em] text-ink/45">
                            {fmt(e.at, { weekday: "short", month: "short" }, tz)} · {when(e, tz).toUpperCase()}
                          </p>
                        </div>
                        <span className="font-mono text-[10px] text-gold">{until(e.at, now)}</span>
                      </div>
                      <p className="mt-4 flex items-center gap-2 font-mono text-[9px] tracking-[0.2em] text-ink/50">
                        <span className="block h-1.5 w-1.5 rounded-full" style={{ background: KIND_COLOR[e.kind] }} />
                        {KIND_LABEL[e.kind]}
                      </p>
                      <h3 className="mt-1.5 text-[18px] leading-snug text-ink">{e.title}</h3>
                      <p className="mt-2 flex-1 text-[13px] leading-relaxed text-ink/60">{e.detail}</p>
                      {e.howTo && <p className="mt-2 text-[12px] leading-relaxed text-ink/45">{e.howTo}</p>}
                      <div className="mt-3">
                        <Badge e={e} />
                      </div>
                      <Actions e={e} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-6 text-[13px] text-ink/50">{words.length ? "No matches in the next seven days." : "Nothing of this kind in the next seven days."}</p>
              )}
            </section>

            {words.length > 0 && shown.length === 0 && (
              <p className="mt-10 text-[13px] text-ink/50">Nothing in the next year matches “{query.trim()}”. Try a shower, a planet, a rocket or a month.</p>
            )}
            {[...months].map(([month, events]) => (
              <section key={month} className="mt-14">
                <h2 className="flex items-baseline gap-3 border-b border-ink/[0.08] pb-3">
                  <span className="display text-[22px] text-ink">{month.split(" ")[0].charAt(0) + month.split(" ")[0].slice(1).toLowerCase()}</span>
                  <span className="font-mono text-[11px] tracking-[0.2em] text-ink/40">{month.split(" ")[1]}</span>
                  <span className="ml-auto font-mono text-[10px] tracking-[0.16em] text-ink/35">{events.length} EVENTS</span>
                </h2>
                <ul className="mt-2">
                  {events.map((e) => (
                    <EventRow key={e.id} e={e} timeZone={tz} />
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}

        {note && <p className="mt-8 font-mono text-[10px] tracking-[0.18em] text-ink/45">{note}</p>}
        <div className="mt-16 space-y-2 border-t border-ink/[0.08] pt-6 font-mono text-[9px] leading-relaxed tracking-[0.14em] text-ink/35">
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
            <a href="https://thespacedevs.com" target="_blank" rel="noreferrer" className="text-ink/60 hover:text-gold">
              THE SPACE DEVS
            </a>{" "}
            · ISS FROM{" "}
            <a href="https://celestrak.org" target="_blank" rel="noreferrer" className="text-ink/60 hover:text-gold">
              CELESTRAK
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
