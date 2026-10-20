"use client";

import { useRef } from "react";
import { useReveal } from "@/components/ui/useReveal";
import IndexBar from "@/components/ui/IndexBar";
import ScrubText from "@/components/ui/ScrubText";
import SplitWords from "@/components/ui/SplitWords";

export default function Manifesto() {
  const root = useRef<HTMLElement>(null);
  useReveal(root);

  return (
    <section
      ref={root}
      data-scene="manifesto"
      data-label="WHY STELLR"
      className="relative flex min-h-[110svh] flex-col px-5 pt-[18vh] sm:px-10"
    >
      <IndexBar index="003" label="WHY STELLR" className="mx-auto w-full max-w-[1100px]" />

      <div className="mx-auto mt-16 flex max-w-[1000px] flex-col items-center text-center">
        <h2 className="display max-w-[20ch] text-[clamp(1.7rem,3.4vw,3.5rem)] text-ink">
          <SplitWords text="Space is not a still image." />
        </h2>
        <ScrubText
          className="mt-10 text-[clamp(0.95rem,1.6vw,1.35rem)] text-ink"
          text="Satellites cross your sky every ninety minutes. Asteroids slip past the Moon. Distant stars dim as unseen planets cross their faces. Stellr turns that motion into tools anyone can use — real data, real-time 3D, nothing to install."
        />
      </div>
    </section>
  );
}
