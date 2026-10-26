"use client";

import { useRef } from "react";
import Link from "next/link";
import { useReveal } from "@/components/ui/useReveal";
import IndexBar from "@/components/ui/IndexBar";
import ScrambleText from "@/components/ui/ScrambleText";
import SplitWords from "@/components/ui/SplitWords";

const TOOLS: { name: string; body: string; tags: string[]; href?: string }[] = [
  {
    name: "Orbit Watch",
    body: "Track satellites and the ISS live, with pass predictions for wherever you're standing.",
    tags: ["SATELLITES", "ISS", "PASS PREDICTION"],
    href: "/orbit-watch",
  },
  {
    name: "Asteroid Sentinel",
    body: "Every near-Earth object on approach — distance, size and closest pass, plotted in 3D.",
    tags: ["NEO", "CLOSE APPROACH", "HAZARD"],
  },
  {
    name: "Sky Events",
    body: "Meteor showers, eclipses, conjunctions and launches, timed to your local sky.",
    tags: ["ECLIPSES", "METEORS", "LAUNCHES"],
    href: "/sky-events",
  },
  {
    name: "Space Weather",
    body: "Solar flares, geomagnetic storms and aurora forecasts as they develop.",
    tags: ["SOLAR WIND", "KP INDEX", "AURORA"],
  },
];

/** Turion-style numbered mission panels, framed Oakley-style; Earth and its orbits sit to the right. */
export default function Tools() {
  const root = useRef<HTMLElement>(null);
  useReveal(root);

  return (
    <section
      ref={root}
      id="tools"
      data-scene="tools"
      data-label="LIVE TOOLS"
      className="relative min-h-svh px-5 pb-24 pt-[18vh] sm:px-10 lg:px-16"
    >
      <IndexBar index="004" label="LIVE TOOLS" className="max-w-[1100px] lg:w-[58%]" />

      <div className="lg:w-[58%]">
        <h2 className="display mt-14 max-w-[18ch] text-[clamp(1.7rem,3.4vw,3.5rem)] text-ink">
          <SplitWords text="Four instruments. One live sky." />
        </h2>
        <p className="caps reveal-fade mt-6 max-w-[46ch] text-[12px] text-ink/60 sm:text-[13px]">
          Each one opens in a browser tab, runs on live data and draws the sky around you in real-time 3D.
        </p>

        <ul className="mt-12 grid gap-5 sm:grid-cols-2">
          {TOOLS.map((tool, i) => (
            <li key={tool.name} className="reveal-fade frame bg-void/55 p-6 backdrop-blur-sm sm:p-7">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs tracking-[0.15em] text-gold">[{String(i + 1).padStart(2, "0")}]</span>
                <span className={`font-mono text-[10px] tracking-[0.18em] ${tool.href ? "text-gold" : "text-ink/40"}`}>
                  {tool.href ? "● LIVE" : "COMING SOON"}
                </span>
              </div>
              <h3 className="display mt-5 text-xl text-ink">{tool.name}</h3>
              <p className="mt-4 text-[15px] leading-relaxed text-ink/70">{tool.body}</p>
              <ul className="mt-6 flex flex-wrap gap-2">
                {tool.tags.map((tag) => (
                  <li key={tag} className="border border-ink/15 px-2 py-1 font-mono text-[10px] tracking-[0.15em] text-ink/60">
                    {tag}
                  </li>
                ))}
              </ul>
              {tool.href && (
                <Link
                  href={tool.href}
                  className="mt-6 inline-block rounded-full bg-ink px-5 py-2.5 text-[12px] font-semibold tracking-[0.08em] text-void transition-colors hover:bg-gold"
                >
                  <ScrambleText text={`OPEN ${tool.name.toUpperCase()} →`} />
                </Link>
              )}
            </li>
          ))}
        </ul>

        <p className="reveal-fade mt-8 font-mono text-[11px] tracking-[0.18em] text-ink/45">
          COMING NEXT — COSMOSCOPE · EXOPLANET LAB · ANVESHAK RESEARCH AGENT
        </p>
      </div>
    </section>
  );
}
