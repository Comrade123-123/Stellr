"use client";

import { useRef } from "react";
import { useReveal } from "@/components/ui/useReveal";
import IndexBar from "@/components/ui/IndexBar";
import SplitWords from "@/components/ui/SplitWords";
import WaitlistForm from "@/components/WaitlistForm";

/** Earth rises again at the end, Oakley-style, with the waitlist. */
export default function FinalCTA() {
  const root = useRef<HTMLElement>(null);
  useReveal(root);

  return (
    <section
      ref={root}
      id="waitlist"
      data-scene="cta"
      data-label="WAITLIST"
      className="relative flex min-h-svh flex-col items-center px-5 pt-[16vh] text-center sm:px-10"
    >
      <IndexBar index="006" label="WAITLIST" className="w-full max-w-[1100px] text-left" />
      <h2 className="display mt-14 max-w-[20ch] text-[clamp(1.9rem,4.2vw,4.4rem)] text-ink">
        <SplitWords text="Be first to fly through the universe." />
      </h2>
      <p className="caps reveal-fade mt-8 max-w-[52ch] text-[12px] text-ink/60 sm:text-[13px]">
        Early access opens in waves. One email when it&apos;s your turn — nothing else.
      </p>
      <div className="reveal-fade mt-10 flex w-full justify-center">
        <WaitlistForm />
      </div>
    </section>
  );
}
