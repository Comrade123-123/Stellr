import {
  Body,
  Equator,
  Horizon,
  Illumination,
  MoonPhase,
  Observer,
  SearchAltitude,
  SearchMoonPhase,
  SearchRiseSet,
} from "astronomy-engine";
import type { Place } from "./places";

const PHASES = [
  "New Moon",
  "Waxing crescent",
  "First quarter",
  "Waxing gibbous",
  "Full Moon",
  "Waning gibbous",
  "Last quarter",
  "Waning crescent",
];

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (azimuth: number) => COMPASS[Math.round(azimuth / 45) % 8];

const PLANETS: [Body, string][] = [
  [Body.Mercury, "Mercury"],
  [Body.Venus, "Venus"],
  [Body.Mars, "Mars"],
  [Body.Jupiter, "Jupiter"],
  [Body.Saturn, "Saturn"],
];

export interface PlanetView {
  name: string;
  altitude: number;
  direction: string;
  magnitude: number;
}

export interface SkyReport {
  /** The moment the "tonight" view is computed for. */
  at: Date;
  darkNow: boolean;
  moon: {
    phaseAngle: number;
    illuminated: number;
    name: string;
    up: boolean;
    rise: Date | null;
    set: Date | null;
    nextFull: Date | null;
    nextNew: Date | null;
  };
  sunset: Date | null;
  darkness: Date | null;
  sunrise: Date | null;
  planets: PlanetView[];
}

/** Everything is computed locally with astronomy-engine; no network, no location upload. */
export function computeSky(place: Place, now = new Date()): SkyReport {
  const observer = new Observer(place.lat, place.lon, 0);

  const altitude = (body: Body, date: Date) => {
    const eq = Equator(body, date, observer, true, true);
    return Horizon(date, observer, eq.ra, eq.dec, "normal").altitude;
  };

  const darkNow = altitude(Body.Sun, now) < -12;
  // Prefer astronomical darkness; very high latitudes in summer only reach nautical.
  const dusk =
    SearchAltitude(Body.Sun, observer, -1, now, 1, -18)?.date ??
    SearchAltitude(Body.Sun, observer, -1, now, 1, -12)?.date ??
    null;
  const at = darkNow || !dusk ? now : new Date(dusk.getTime() + 30 * 60_000);

  const phaseAngle = MoonPhase(now);
  const illuminated = Illumination(Body.Moon, now).phase_fraction;

  const planets = PLANETS.map(([body, name]) => {
    const eq = Equator(body, at, observer, true, true);
    const hor = Horizon(at, observer, eq.ra, eq.dec, "normal");
    return { name, altitude: hor.altitude, direction: compass(hor.azimuth), magnitude: Illumination(body, at).mag };
  })
    .filter((p) => p.altitude > 5)
    .sort((a, b) => a.magnitude - b.magnitude);

  return {
    at,
    darkNow,
    moon: {
      phaseAngle,
      illuminated,
      name: PHASES[Math.round(phaseAngle / 45) % 8],
      up: altitude(Body.Moon, now) > 0,
      rise: SearchRiseSet(Body.Moon, observer, +1, now, 1)?.date ?? null,
      set: SearchRiseSet(Body.Moon, observer, -1, now, 1)?.date ?? null,
      nextFull: SearchMoonPhase(180, now, 31)?.date ?? null,
      nextNew: SearchMoonPhase(0, now, 31)?.date ?? null,
    },
    sunset: SearchRiseSet(Body.Sun, observer, -1, now, 1)?.date ?? null,
    darkness: darkNow ? null : dusk,
    sunrise: SearchRiseSet(Body.Sun, observer, +1, now, 1)?.date ?? null,
    planets,
  };
}
