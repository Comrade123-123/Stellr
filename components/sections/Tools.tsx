"use client";

import { useRef } from "react";
import { useReveal } from "@/components/ui/useReveal";
import IndexBar from "@/components/ui/IndexBar";
import SplitWords from "@/components/ui/SplitWords";

const TOOLS = [
  {
    name: "Orbit Watch",
    body: "Track satellites and the ISS live, with pass predictions for wherever you're standing.",
    tags: ["SATELLITES", "ISS", "PASS PREDICTION"],
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

        <ul className="mt-14 grid gap-5 sm:grid-cols-2">
          {TOOLS.map((tool, i) => (
            <li key={tool.name} className="reveal-fade frame bg-void/55 p-6 backdrop-blur-sm sm:p-7">
              <span className="font-mono text-xs tracking-[0.15em] text-gold">[{String(i + 1).padStart(2, "0")}]</span>
              <h3 className="display mt-5 text-xl text-ink">{tool.name}</h3>
              <p className="mt-4 text-[15px] leading-relaxed text-ink/70">{tool.body}</p>
              <ul className="mt-6 flex flex-wrap gap-2">
                {tool.tags.map((tag) => (
                  <li key={tag} className="border border-ink/15 px-2 py-1 font-mono text-[10px] tracking-[0.15em] text-ink/60">
                    {tag}
                  </li>
                ))}
              </ul>
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
