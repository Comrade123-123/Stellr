"use client";

import { useRef } from "react";
import Link from "next/link";
import { useReveal } from "@/components/ui/useReveal";
import IndexBar from "@/components/ui/IndexBar";
import ScrambleText from "@/components/ui/ScrambleText";
import SplitWords from "@/components/ui/SplitWords";
import { useNow } from "@/lib/time";

/** First big zoom-out: the camera leaves Earth and the solar system appears around it. */
export default function Cosmoscope() {
  const root = useRef<HTMLElement>(null);
  useReveal(root);
  const now = useNow();
  const today = now
    ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(now).toUpperCase()
    : "TODAY";

  return (
    <section
      ref={root}
      id="cosmoscope"
      data-scene="cosmoscope"
      data-label="COSMOSCOPE"
      className="relative flex min-h-[130svh] flex-col px-5 pt-[18vh] sm:px-10"
    >
      <IndexBar index="006" label="COSMOSCOPE" className="mx-auto w-full max-w-[1100px]" />

      <div className="mx-auto mt-14 w-full max-w-[1100px]">
        <h2 className="display max-w-[16ch] text-[clamp(1.7rem,3.4vw,3.5rem)] text-ink">
          <SplitWords text="Zoom out. The planets are exactly where they are." />
        </h2>
        <p className="caps reveal-fade mt-8 max-w-[46ch] text-[12px] text-ink/60 sm:text-[13px]">
          Cosmoscope places every planet at its real position for today, then lets you fly between them.
          Sizes and distances are compressed — space is mostly empty.
        </p>
        <Link
          href="/cosmoscope"
          className="reveal-fade mt-8 inline-block rounded-full bg-ink px-5 py-2.5 text-[12px] font-semibold tracking-[0.08em] text-void transition-colors hover:bg-gold"
        >
          <ScrambleText text="OPEN COSMOSCOPE →" />
        </Link>
      </div>

      <p className="reveal-fade mt-auto mb-24 font-mono text-[10px] tracking-[0.22em] text-ink/45 sm:text-right">
        POSITIONS FOR {today} · ORBITS NOT TO SCALE
      </p>
    </section>
  );
}
