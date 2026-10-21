"use client";

import { useRef } from "react";
import { useReveal } from "@/components/ui/useReveal";
import SplitWords from "@/components/ui/SplitWords";
import WaitlistForm from "@/components/WaitlistForm";

/**
 * Sunrise from orbit: the headline sits in the dark sky above Earth's horizon,
 * the copy and waitlist below it over the planet's night side.
 */
export default function Hero() {
  const root = useRef<HTMLElement>(null);
  useReveal(root, "top 55%");

  return (
    <section
      ref={root}
      id="hero"
      data-scene="hero"
      data-label="FIRST LIGHT"
      className="relative flex min-h-svh flex-col items-center justify-between px-5 pb-[9vh] pt-[15vh] text-center"
    >
      <h1 className="display max-w-[20ch] text-[clamp(1.7rem,3.6vw,3.6rem)] text-ink">
        <SplitWords text="From your backyard to the edge of the observable universe." />
      </h1>

      <div className="flex w-full flex-col items-center">
        <p className="caps reveal-fade hidden max-w-[56ch] text-[12px] text-ink/60 sm:block sm:text-[13px]">
          Stellr is a family of space tools that run in your browser. Live satellites, near-Earth asteroids,
          sky events and space weather — rendered in real-time 3D. No installs. Open a tab and look up.
        </p>
        <div className="reveal-fade mt-8 flex w-full justify-center">
          <WaitlistForm />
        </div>
      </div>
    </section>
  );
}
