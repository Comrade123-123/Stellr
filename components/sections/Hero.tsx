"use client";

import { useRef } from "react";
import { useReveal } from "@/components/ui/useReveal";
import SplitWords from "@/components/ui/SplitWords";
import WaitlistForm from "@/components/WaitlistForm";

/** Earth's limb rises under a centred serif headline. */
export default function Hero() {
  const root = useRef<HTMLElement>(null);
  useReveal(root, "top 55%");

  return (
    <section
      ref={root}
      id="hero"
      data-scene="hero"
      data-label="EARTH"
      className="relative flex min-h-svh flex-col items-center px-5 pt-[16vh] text-center sm:pt-[14vh]"
    >
      <h1 className="display max-w-[22ch] text-[clamp(1.9rem,4.2vw,4.4rem)] text-ink">
        <SplitWords text="From your backyard to the edge of the observable universe." />
      </h1>

      <p className="caps reveal-fade mt-8 max-w-[60ch] text-[12px] text-ink/60 sm:text-[13px]">
        Stellr is a family of space tools that run in your browser. Live satellites, near-Earth asteroids,
        sky events and space weather — rendered in real-time 3D. No installs. Open a tab and look up.
      </p>

      <div className="reveal-fade mt-10 flex w-full justify-center">
        <WaitlistForm />
      </div>
    </section>
  );
}
