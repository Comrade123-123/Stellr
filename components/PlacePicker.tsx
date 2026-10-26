"use client";

import { useEffect, useState } from "react";
import { CITIES, guessCity, type Place } from "@/lib/places";

const MY_LOCATION = "__here";

/**
 * Where the visitor is: a first guess from the browser's time zone (no prompt),
 * a city list, and the browser's own location on request. Shared by the tools.
 */
export function usePlace() {
  const [place, setPlace] = useState<Place | null>(null);
  const [here, setHere] = useState<Place | null>(null);
  const [error, setError] = useState("");
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    // The time zone needs the browser, so the guess can only happen after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlace(guessCity());
  }, []);

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setError("Location isn't available in this browser.");
      return;
    }
    setLocating(true);
    setError("");
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
        setError("Couldn't get your location. Pick a city instead.");
        setLocating(false);
      },
      { maximumAge: 600_000, timeout: 10_000 },
    );
  };

  return { place, setPlace, here, error, locating, locate };
}

/** City list plus "use my location", in the tools' panel style. */
export default function PlacePicker({ state }: { state: ReturnType<typeof usePlace> }) {
  const { place, setPlace, here, error, locating, locate } = state;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Location"
          value={place && place === here ? MY_LOCATION : (place?.name ?? "")}
          onChange={(e) => {
            if (e.target.value === MY_LOCATION && here) setPlace(here);
            else setPlace(CITIES.find((c) => c.name === e.target.value) ?? null);
          }}
          className="h-9 min-w-0 flex-1 rounded-full border border-ink/25 bg-void px-4 font-mono text-[11px] tracking-[0.12em] text-ink outline-none focus:border-ink/60"
        >
          {here && <option value={MY_LOCATION}>MY LOCATION ({here.name})</option>}
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
          className="h-9 shrink-0 rounded-full border border-ink/25 px-4 font-mono text-[10px] tracking-[0.18em] text-ink/80 transition-colors hover:border-ink/60 disabled:opacity-50"
        >
          {locating ? "LOCATING…" : "USE MY LOCATION"}
        </button>
      </div>
      {error && <p className="mt-2 font-mono text-[10px] text-gold">{error}</p>}
    </>
  );
}
