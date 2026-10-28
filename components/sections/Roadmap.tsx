"use client";

import { useRef } from "react";
import Link from "next/link";
import { useReveal } from "@/components/ui/useReveal";
import IndexBar from "@/components/ui/IndexBar";
import SplitWords from "@/components/ui/SplitWords";

const PHASES: { phase: string; name: string; body: string; status: string; live?: boolean; href?: string }[] = [
  { phase: "01", name: "Your Sky, Tonight", body: "Moon, planets and twilight for wherever you stand.", status: "LIVE", live: true },
  { phase: "02", name: "Orbit Watch", body: "The ISS and satellites overhead, live, with passes for your sky.", status: "LIVE", live: true, href: "/orbit-watch" },
  { phase: "03", name: "Sky Events", body: "Meteor showers, eclipses and launches, timed to where you are.", status: "LIVE", live: true, href: "/sky-events" },
  { phase: "04", name: "Space Weather", body: "Flares, the solar wind and aurora as they develop.", status: "LIVE", live: true, href: "/space-weather" },
  { phase: "05", name: "Asteroid Sentinel", body: "Near-Earth objects on approach, plotted in 3D.", status: "LIVE", live: true, href: "/asteroid-sentinel" },
  { phase: "06", name: "Cosmoscope", body: "Explore the universe: fly between the planets, moons and spacecraft at their real positions.", status: "LIVE", live: true, href: "/cosmoscope" },
  { phase: "07", name: "Exoplanet Lab", body: "Research other worlds: search real TESS starlight for planets and weigh the evidence.", status: "LIVE", live: true, href: "/exoplanet-lab" },
  { phase: "08", name: "Wobble", body: "Investigate the unknown: a research agent that runs and records investigations on its own.", status: "NEXT" },
];

/** The road ahead, laid over the Milky Way seen from outside, the Sun marked on its arm. */
export default function Roadmap() {
  const root = useRef<HTMLElement>(null);
  useReveal(root);

  return (
    <section
      ref={root}
      id="roadmap"
      data-scene="roadmap"
      data-label="ROADMAP"
      className="relative min-h-[130svh] px-5 pb-24 pt-[18vh] sm:px-10 lg:px-16"
    >
      <IndexBar index="007" label="ROADMAP" className="max-w-[1100px] lg:w-[46%]" />

      <div className="max-sm:mt-[38svh] lg:w-[46%]">
        <h2 className="display mt-14 max-w-[18ch] text-[clamp(1.7rem,3.4vw,3.5rem)] text-ink">
          <SplitWords text="One sky at a time. Then the galaxy." />
        </h2>
        <p className="caps reveal-fade mt-6 max-w-[46ch] text-[12px] text-ink/60 sm:text-[13px]">
          Stellr grows one instrument at a time. Here is what is live, and what comes next.
        </p>

        <ol className="reveal-fade frame mt-10 bg-void/55 backdrop-blur-sm">
          {PHASES.map((p) => (
            <li key={p.phase} className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-5 border-b border-ink/10 p-5 last:border-b-0">
              <span className="font-mono text-xs tracking-[0.15em] text-gold">[{p.phase}]</span>
              <div>
                <h3 className="display text-base text-ink sm:text-lg">
                  {p.href ? (
                    <Link href={p.href} className="transition-colors hover:text-gold">
                      {p.name} →
                    </Link>
                  ) : (
                    p.name
                  )}
                </h3>
                <p className="mt-2 text-[14px] leading-relaxed text-ink/60">{p.body}</p>
              </div>
              <span className={`font-mono text-[10px] tracking-[0.18em] ${p.live ? "text-gold" : "text-ink/45"}`}>
                {p.live && <span className="mr-2 inline-block h-[6px] w-[6px] rounded-full bg-gold align-middle" />}
                {p.status}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
