"use client";

import { useRef } from "react";
import { useReveal } from "@/components/ui/useReveal";
import SplitWords from "@/components/ui/SplitWords";
import WaitlistForm from "@/components/WaitlistForm";

/** The outpost: an astronaut on a dark horizon under a black hole, headline on the left. */
export default function Hero() {
  const root = useRef<HTMLElement>(null);
  useReveal(root, "top 55%");

  return (
    <section
      ref={root}
      id="hero"
      data-scene="hero"
      data-label="THE EDGE"
      className="relative flex min-h-svh flex-col items-center px-5 pt-[16vh] text-center sm:pt-[14vh] lg:items-start lg:px-16 lg:pt-[20vh] lg:text-left"
    >
      <h1 className="display max-w-[22ch] text-[clamp(1.9rem,4.2vw,4.4rem)] text-ink lg:max-w-[15ch] lg:text-[clamp(2rem,3.6vw,3.8rem)]">
        <SplitWords text="From your backyard to the edge of the observable universe." />
      </h1>

      <p className="caps reveal-fade mt-8 hidden max-w-[60ch] sm:block text-[12px] text-ink/60 sm:text-[13px] lg:max-w-[44ch]">
        Stellr is a family of space tools that run in your browser. Live satellites, near-Earth asteroids,
        sky events and space weather — rendered in real-time 3D. No installs. Open a tab and look up.
      </p>

      <div className="reveal-fade mt-10 flex w-full justify-center lg:justify-start">
        <WaitlistForm />
      </div>
    </section>
  );
}
