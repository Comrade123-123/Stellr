"use client";

import { useRef } from "react";
import { useReveal } from "@/components/ui/useReveal";
import IndexBar from "@/components/ui/IndexBar";
import SplitWords from "@/components/ui/SplitWords";
import WaitlistForm from "@/components/WaitlistForm";

/** The ending: the black hole at the galaxy's heart, with the waitlist. */
export default function FinalCTA() {
  const root = useRef<HTMLElement>(null);
  useReveal(root);

  return (
    <section
      ref={root}
      id="waitlist"
      data-scene="cta"
      data-label="WAITLIST"
      className="relative flex min-h-svh flex-col items-center justify-between px-5 pb-[8vh] pt-[13vh] text-center sm:px-10"
    >
      {/* Copy above and below, so the black hole holds the middle of the screen. */}
      <div className="flex w-full flex-col items-center">
        <IndexBar index="008" label="WAITLIST" className="w-full max-w-[1100px] text-left" />
        <h2 className="display mt-10 max-w-[20ch] text-[clamp(1.7rem,3.4vw,3.6rem)] text-ink">
          <SplitWords text="Be first to fly through the universe." />
        </h2>
      </div>
      <div className="flex w-full flex-col items-center">
        <p className="caps reveal-fade max-w-[52ch] text-[12px] text-ink/60 sm:text-[13px]">
          Early access opens in waves. One email when it&apos;s your turn — nothing else.
        </p>
        <div className="reveal-fade mt-8 flex w-full justify-center">
          <WaitlistForm />
        </div>
      </div>
    </section>
  );
}
