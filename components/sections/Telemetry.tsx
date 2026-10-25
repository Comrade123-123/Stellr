"use client";

import { useRef } from "react";
import { useReveal } from "@/components/ui/useReveal";
import IndexBar from "@/components/ui/IndexBar";
import SplitWords from "@/components/ui/SplitWords";
import { dayOfYear, formatUtc, gmst, useNow } from "@/lib/time";

/** Turion-style HUD readout. Clock values are computed live; the rest are physical constants. */
export default function Telemetry() {
  const root = useRef<HTMLElement>(null);
  useReveal(root);
  const now = useNow();

  const readouts: [string, string, boolean?][] = [
    ["UTC", now ? formatUtc(now) : "--:--:--", true],
    ["SIDEREAL TIME · GREENWICH", now ? gmst(now) : "--:--:--", true],
    ["DAY OF YEAR", now ? String(dayOfYear(now)).padStart(3, "0") : "---", true],
    ["EARTH AXIAL TILT", "23.44°"],
    ["EQUATORIAL ROTATION", "0.465 KM/S"],
    ["LOW EARTH ORBIT VELOCITY", "7.66 KM/S"],
    ["ISS ORBITAL PERIOD", "≈ 92.9 MIN"],
    ["SUNLIGHT TRAVEL TIME", "8 MIN 19 S"],
    ["MEAN EARTH–MOON DISTANCE", "384,400 KM"],
    ["TELEMETRY", "LIVE", true],
  ];

  return (
    <section
      ref={root}
      data-scene="telemetry"
      data-label="REAL TIME"
      className="relative flex min-h-[120svh] flex-col px-5 pt-[18vh] sm:px-10"
    >
      <IndexBar index="005" label="REAL TIME" centered />

      <div className="mx-auto mt-14 flex w-full max-w-[1100px] flex-col items-center text-center">
        <h2 className="display max-w-[22ch] text-[clamp(1.7rem,3.4vw,3.5rem)] text-ink">
          <SplitWords text="Running on the same clock as the sky." />
        </h2>
        <p className="caps reveal-fade mt-8 max-w-[56ch] text-[12px] text-ink/60 sm:text-[13px]">
          Every Stellr view is computed for this second, not baked into a video. Look away, come back, and the
          planet has moved on.
        </p>

        <dl className="reveal-fade frame mt-14 grid w-full grid-cols-2 bg-void/55 text-left backdrop-blur-sm md:grid-cols-5">
          {readouts.map(([label, value, live]) => (
            <div key={label} className="border-b border-r border-ink/10 p-4 sm:p-5">
              <dt className="font-mono text-[9px] tracking-[0.2em] text-ink/45 sm:text-[10px]">{label}</dt>
              <dd className={`mt-3 font-mono text-sm tabular-nums sm:text-base ${live ? "text-gold" : "text-ink"}`}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
