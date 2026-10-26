import {
  AngleBetween,
  ApsisKind,
  Body,
  EclipseKind,
  Elongation,
  Equator,
  GeoVector,
  Horizon,
  Illumination,
  NextGlobalSolarEclipse,
  NextLocalSolarEclipse,
  NextLunarApsis,
  NextLunarEclipse,
  NextMoonQuarter,
  Observer,
  SearchGlobalSolarEclipse,
  SearchLocalSolarEclipse,
  SearchLunarApsis,
  SearchLunarEclipse,
  SearchMaxElongation,
  SearchMoonQuarter,
  SearchRelativeLongitude,
  Seasons,
} from "astronomy-engine";
import type { Place } from "./places";

/**
 * Sky Events: what's coming up in the sky over the next year, for one observer.
 * Everything here is computed in the browser with astronomy-engine, except the
 * meteor showers, whose peaks come from the IMO's annual calendar (they repeat
 * to within a day each year). ISS passes and rocket launches are added by the page.
 */

export type EventKind = "eclipse" | "moon" | "planets" | "meteors" | "season" | "iss" | "launch";

export interface SkyEvent {
  id: string;
  kind: EventKind;
  title: string;
  /** When it happens (the peak, for things that build and fade). */
  at: Date;
  /** For events with a duration worth putting in a calendar. */
  end?: Date;
  detail: string;
  /** true: you can see it from here; false: not from here; null: doesn't apply (launches, seasons). */
  visible: boolean | null;
  /** How or where to look, when there's something useful to say. */
  howTo?: string;
  url?: string;
}

const DAY = 86_400_000;
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (azimuth: number) => COMPASS[Math.round(azimuth / 45) % 8];

function altitudeOf(body: Body, date: Date, observer: Observer) {
  const eq = Equator(body, date, observer, true, true);
  return Horizon(date, observer, eq.ra, eq.dec, "normal");
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function eclipses(from: Date, to: Date, observer: Observer): SkyEvent[] {
  const out: SkyEvent[] = [];

  for (let e = SearchLunarEclipse(from); e.peak.date < to; e = NextLunarEclipse(e.peak)) {
    const moon = altitudeOf(Body.Moon, e.peak.date, observer);
    const kind = e.kind === EclipseKind.Total ? "Total" : e.kind === EclipseKind.Partial ? "Partial" : "Penumbral";
    // Half-durations are in minutes; the penumbral phase is the whole event.
    const half = (e.kind === EclipseKind.Total ? e.sd_total : e.kind === EclipseKind.Partial ? e.sd_partial : e.sd_penum) * 60_000;
    out.push({
      id: `lunar-${e.peak.date.toISOString()}`,
      kind: "eclipse",
      title: `${kind} lunar eclipse`,
      at: e.peak.date,
      end: new Date(e.peak.date.getTime() + half),
      detail:
        e.kind === EclipseKind.Penumbral
          ? "The Moon slips into Earth's faint outer shadow and dims slightly."
          : e.kind === EclipseKind.Total
            ? `The Moon turns copper-red inside Earth's shadow for about ${Math.round(e.sd_total * 2)} minutes.`
            : `Earth's shadow takes a bite out of the Moon, covering ${pct(e.obscuration)} at its deepest.`,
      visible: moon.altitude > 0,
      howTo: moon.altitude > 0 ? `Moon ${Math.round(moon.altitude)}° up in the ${compass(moon.azimuth)} at its peak.` : "The Moon is below your horizon at the peak.",
    });
  }

  // Solar eclipses visible from here, with local circumstances…
  const local = new Map<number, ReturnType<typeof SearchLocalSolarEclipse>>();
  for (let e = SearchLocalSolarEclipse(from, observer); e.peak.time.date < to; e = NextLocalSolarEclipse(e.peak.time, observer)) {
    local.set(Math.round(e.peak.time.date.getTime() / DAY), e);
  }
  // …and every solar eclipse on Earth, so the ones you'd have to travel for still show.
  for (let g = SearchGlobalSolarEclipse(from); g.peak.date < to; g = NextGlobalSolarEclipse(g.peak)) {
    const day = Math.round(g.peak.date.getTime() / DAY);
    const here = local.get(day) ?? local.get(day - 1) ?? local.get(day + 1);
    const kind = g.kind === EclipseKind.Total ? "Total" : g.kind === EclipseKind.Annular ? "Annular" : "Partial";
    const where =
      g.latitude !== undefined && g.longitude !== undefined
        ? ` Deepest near ${Math.abs(g.latitude).toFixed(0)}°${g.latitude >= 0 ? "N" : "S"}, ${Math.abs(g.longitude).toFixed(0)}°${g.longitude >= 0 ? "E" : "W"}.`
        : "";
    out.push({
      id: `solar-${g.peak.date.toISOString()}`,
      kind: "eclipse",
      title: `${kind} solar eclipse`,
      at: here ? here.peak.time.date : g.peak.date,
      end: here ? here.partial_end.time.date : undefined,
      detail:
        (g.kind === EclipseKind.Total
          ? "The Moon covers the Sun completely along a narrow path; day turns to twilight."
          : g.kind === EclipseKind.Annular
            ? "The Moon covers the Sun's centre, leaving a ring of fire along a narrow path."
            : "The Moon covers part of the Sun.") + where,
      visible: Boolean(here && here.peak.altitude > 0),
      howTo: here
        ? `${here.kind === g.kind ? "From here" : "Partial from here"}: ${pct(here.obscuration)} of the Sun covered, ${Math.round(here.peak.altitude)}° up. Never look without eclipse glasses.`
        : "Not visible from your location.",
    });
  }
  return out;
}

function moon(from: Date, to: Date): SkyEvent[] {
  const out: SkyEvent[] = [];
  // Perigees in the window, to flag supermoons.
  const perigees: Date[] = [];
  for (let a = SearchLunarApsis(new Date(from.getTime() - 15 * DAY)); a.time.date < new Date(to.getTime() + 15 * DAY); a = NextLunarApsis(a)) {
    if (a.kind === ApsisKind.Pericenter) perigees.push(a.time.date);
  }
  for (let q = SearchMoonQuarter(from); q.time.date < to; q = NextMoonQuarter(q)) {
    const at = q.time.date;
    if (q.quarter === 2) {
      const dist = Illumination(Body.Moon, at).geo_dist * 149_597_870.7;
      const supermoon = dist < 362_000 && perigees.some((p) => Math.abs(p.getTime() - at.getTime()) < 2 * DAY);
      out.push({
        id: `full-${at.toISOString()}`,
        kind: "moon",
        title: supermoon ? "Supermoon" : "Full Moon",
        at,
        detail: supermoon
          ? `A full Moon near its closest to Earth (${Math.round(dist).toLocaleString("en")} km): a little bigger and brighter than usual.`
          : "The Moon is fully lit, rising around sunset and up all night.",
        visible: true,
      });
    } else if (q.quarter === 0) {
      out.push({
        id: `new-${at.toISOString()}`,
        kind: "moon",
        title: "New Moon",
        at,
        detail: "No Moon in the night sky: the darkest nights of the month for stars and the Milky Way.",
        visible: true,
      });
    }
  }
  return out;
}

const NAKED_EYE: [Body, string][] = [
  [Body.Mercury, "Mercury"],
  [Body.Venus, "Venus"],
  [Body.Mars, "Mars"],
  [Body.Jupiter, "Jupiter"],
  [Body.Saturn, "Saturn"],
];

function planets(from: Date, to: Date, place: Place): SkyEvent[] {
  const out: SkyEvent[] = [];

  // Oppositions: the planet is opposite the Sun, closest and brightest, up all night.
  for (const [body, name] of [...NAKED_EYE.slice(2), [Body.Uranus, "Uranus"], [Body.Neptune, "Neptune"]] as [Body, string][]) {
    const t = SearchRelativeLongitude(body, 0, from).date;
    if (t >= to) continue;
    const mag = Illumination(body, t).mag;
    out.push({
      id: `opp-${name}-${t.toISOString()}`,
      kind: "planets",
      title: `${name} at opposition`,
      at: t,
      detail: `${name} is opposite the Sun: at its closest and brightest (magnitude ${mag.toFixed(1)}), rising at sunset and up all night.`,
      // Magnitude 5.5 is about the faintest a planet shows from a dark site, and only if you know where to look.
      visible: mag < 5.5,
      howTo:
        mag < 5.5
          ? `Low in the east at sunset, highest in the ${place.lat >= 0 ? "south" : "north"} around midnight.`
          : "Too faint for the naked eye; binoculars or a telescope needed.",
    });
  }

  // Greatest elongations: the inner planets at their farthest from the Sun.
  for (const [body, name] of NAKED_EYE.slice(0, 2)) {
    for (let t = from; ; ) {
      const e = SearchMaxElongation(body, t);
      if (e.time.date >= to) break;
      out.push({
        id: `elong-${name}-${e.time.date.toISOString()}`,
        kind: "planets",
        title: `${name} at greatest ${e.visibility} elongation`,
        at: e.time.date,
        detail: `${name} is ${e.elongation.toFixed(0)}° from the Sun, as far as it gets: the best chance to see it.`,
        visible: true,
        howTo: e.visibility === "evening" ? "Look low in the west just after sunset." : "Look low in the east just before sunrise.",
      });
      t = new Date(e.time.date.getTime() + 10 * DAY);
    }
  }

  // Conjunctions: two bright planets within 2.5° of each other, and far enough from the Sun to see.
  for (let i = 0; i < NAKED_EYE.length; i++) {
    for (let j = i + 1; j < NAKED_EYE.length; j++) {
      const [a, an] = NAKED_EYE[i];
      const [b, bn] = NAKED_EYE[j];
      const sep = (d: Date) => AngleBetween(GeoVector(a, d, true), GeoVector(b, d, true));
      let prev2 = Infinity;
      let prev = sep(from);
      for (let t = from.getTime() + DAY; t < to.getTime(); t += DAY) {
        const cur = sep(new Date(t));
        if (prev < prev2 && prev <= cur && prev < 2.5) {
          // Refine the closest approach to the hour around the daily minimum.
          let best = t - DAY;
          let bestSep = prev;
          for (let h = t - 2 * DAY; h <= t; h += 3_600_000) {
            const s = sep(new Date(h));
            if (s < bestSep) {
              bestSep = s;
              best = h;
            }
          }
          const at = new Date(best);
          const el = Elongation(a, at);
          const visible = el.elongation > 15;
          out.push({
            id: `conj-${an}-${bn}-${at.toISOString()}`,
            kind: "planets",
            title: `${an} and ${bn} together`,
            at,
            detail: `${an} and ${bn} pass ${bestSep < 1 ? `${(bestSep * 60).toFixed(0)}′` : `${bestSep.toFixed(1)}°`} apart${bestSep < 1 ? ", close enough to share a binocular view" : ""}.`,
            visible,
            howTo: visible
              ? el.visibility === "evening"
                ? "Look west after sunset."
                : "Look east before sunrise."
              : "Too close to the Sun to see.",
          });
        }
        prev2 = prev;
        prev = cur;
      }
    }
  }
  return out;
}

/** Major annual showers: peak date (UTC month/day), zenithal hourly rate and radiant declination. Source: IMO calendar. */
const SHOWERS: { name: string; month: number; day: number; zhr: number; dec: number; parent: string }[] = [
  { name: "Quadrantids", month: 1, day: 3, zhr: 110, dec: 49, parent: "asteroid 2003 EH1" },
  { name: "Lyrids", month: 4, day: 22, zhr: 18, dec: 34, parent: "comet Thatcher" },
  { name: "Eta Aquariids", month: 5, day: 6, zhr: 50, dec: -1, parent: "Halley's Comet" },
  { name: "Southern Delta Aquariids", month: 7, day: 30, zhr: 25, dec: -16, parent: "comet 96P/Machholz" },
  { name: "Perseids", month: 8, day: 12, zhr: 100, dec: 58, parent: "comet Swift–Tuttle" },
  { name: "Draconids", month: 10, day: 8, zhr: 10, dec: 54, parent: "comet Giacobini–Zinner" },
  { name: "Orionids", month: 10, day: 21, zhr: 20, dec: 16, parent: "Halley's Comet" },
  { name: "Leonids", month: 11, day: 17, zhr: 15, dec: 22, parent: "comet Tempel–Tuttle" },
  { name: "Geminids", month: 12, day: 14, zhr: 150, dec: 33, parent: "asteroid 3200 Phaethon" },
  { name: "Ursids", month: 12, day: 22, zhr: 10, dec: 76, parent: "comet Tuttle" },
];

function meteors(from: Date, to: Date, place: Place): SkyEvent[] {
  const out: SkyEvent[] = [];
  for (const year of [from.getUTCFullYear(), from.getUTCFullYear() + 1]) {
    for (const s of SHOWERS) {
      // Peaks are usually best in the hours before dawn; mark the night of the peak.
      const at = new Date(Date.UTC(year, s.month - 1, s.day, 0));
      if (at < new Date(from.getTime() - DAY) || at >= to) continue;
      // A radiant that never rises above ~10° from here makes the shower practically invisible.
      const maxAlt = 90 - Math.abs(place.lat - s.dec);
      const lit = Illumination(Body.Moon, at).phase_fraction;
      const moonNote = lit > 0.75 ? "A bright Moon will wash out all but the brightest meteors." : lit < 0.3 ? "A dark Moon: good conditions." : `The Moon is ${pct(lit)} lit and will hide the fainter meteors.`;
      out.push({
        id: `meteors-${s.name}-${year}`,
        kind: "meteors",
        title: `${s.name} meteor shower`,
        at,
        detail: `Up to ${s.zhr} meteors an hour under perfect skies, debris of ${s.parent}.`,
        visible: maxAlt > 10,
        howTo:
          maxAlt > 10
            ? `Best after midnight, away from city lights; let your eyes adjust for 20 minutes. ${moonNote}`
            : "The radiant stays below your horizon; few if any meteors from here.",
      });
    }
  }
  return out;
}

function seasons(from: Date, to: Date, place: Place): SkyEvent[] {
  const out: SkyEvent[] = [];
  const north = place.lat >= 0;
  for (const year of [from.getUTCFullYear(), from.getUTCFullYear() + 1]) {
    const s = Seasons(year);
    const marks: [Date, string, string][] = [
      [s.mar_equinox.date, "March equinox", north ? "Spring begins in the north: day and night are about equal." : "Autumn begins in the south: day and night are about equal."],
      [s.jun_solstice.date, "June solstice", north ? "The longest day of the year in the northern hemisphere." : "The shortest day of the year in the southern hemisphere."],
      [s.sep_equinox.date, "September equinox", north ? "Autumn begins in the north: day and night are about equal." : "Spring begins in the south: day and night are about equal."],
      [s.dec_solstice.date, "December solstice", north ? "The shortest day of the year in the northern hemisphere." : "The longest day of the year in the southern hemisphere."],
    ];
    for (const [at, title, detail] of marks) {
      if (at >= from && at < to) out.push({ id: `season-${at.toISOString()}`, kind: "season", title, at, detail, visible: null });
    }
  }
  return out;
}

/** Every computed event in the next `days` days for `place`, soonest first. */
export function computeEvents(place: Place, from = new Date(), days = 365): SkyEvent[] {
  const to = new Date(from.getTime() + days * DAY);
  const observer = new Observer(place.lat, place.lon, 0);
  return [
    ...eclipses(from, to, observer),
    ...moon(from, to),
    ...planets(from, to, place),
    ...meteors(from, to, place),
    ...seasons(from, to, place),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
}
