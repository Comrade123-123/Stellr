"use client";

import { useRef } from "react";
import { useReveal } from "@/components/ui/useReveal";
import IndexBar from "@/components/ui/IndexBar";
import SplitWords from "@/components/ui/SplitWords";
import Link from "next/link";

/** The ending: the black hole at the galaxy's heart, with every tool one click away. */
const START: [string, string][] = [
  ["COSMOSCOPE", "/cosmoscope"],
  ["EXOPLANET LAB", "/exoplanet-lab"],
  ["ORBIT WATCH", "/orbit-watch"],
  ["ASTEROID SENTINEL", "/asteroid-sentinel"],
  ["SKY EVENTS", "/sky-events"],
  ["SPACE WEATHER", "/space-weather"],
];

export default function FinalCTA() {
  const root = useRef<HTMLElement>(null);
  useReveal(root);

  return (
    <section
      ref={root}
      id="start"
      data-scene="cta"
      data-label="START"
      className="relative flex min-h-svh flex-col items-center justify-between px-5 pb-[8vh] pt-[13vh] text-center sm:px-10"
    >
      {/* Copy above and below, so the black hole holds the middle of the screen. */}
      <div className="flex w-full flex-col items-center">
        <IndexBar index="008" label="START" centered />
        <h2 className="display mt-10 max-w-[20ch] text-[clamp(1.7rem,3.4vw,3.6rem)] text-ink">
          <SplitWords text="The universe is open. Start anywhere." />
        </h2>
      </div>
      <div className="flex w-full flex-col items-center">
        <p className="caps reveal-fade max-w-[52ch] text-[12px] text-ink/60 sm:text-[13px]">
          Every tool is live and free, in your browser. No sign-up, no installs.
        </p>
        <ul className="reveal-fade mt-8 flex max-w-[640px] flex-wrap justify-center gap-2.5">
          {START.map(([label, href]) => (
            <li key={href}>
              <Link
                href={href}
                className="block rounded-full border border-ink/30 px-4 py-2 font-mono text-[10px] tracking-[0.16em] text-ink/85 transition-colors hover:border-gold hover:text-gold"
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
