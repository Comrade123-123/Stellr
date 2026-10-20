"use client";

import { useRef } from "react";
import { useReveal } from "@/components/ui/useReveal";

/** Opening frame: black sky, centred lockup, "Scroll down". */
export default function Intro() {
  const root = useRef<HTMLElement>(null);
  useReveal(root, "top bottom");

  return (
    <section
      ref={root}
      id="top"
      data-scene="intro"
      data-label="OPEN SKY"
      className="relative flex h-svh min-h-[560px] flex-col items-center justify-center px-5"
    >
      <div className="reveal-fade flex items-center gap-6 sm:gap-8">
        <span className="font-sans text-2xl font-semibold tracking-[0.55em] text-ink sm:text-4xl">STELLR</span>
        <span className="h-10 w-px bg-ink/35 sm:h-14" />
        <span className="font-mono text-[10px] leading-snug tracking-[0.3em] text-ink/80 sm:text-xs">
          SPACE TOOLS
          <br />
          FOR THE BROWSER
        </span>
      </div>

      <a
        href="#hero"
        className="reveal-fade absolute bottom-10 flex flex-col items-center gap-3 text-ink/85 transition-colors hover:text-gold"
      >
        <span className="caps text-[11px] tracking-[0.3em]">Scroll down</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-current">
          <svg className="scroll-cue" width="12" height="14" viewBox="0 0 12 14" fill="none" aria-hidden>
            <path d="M6 1v11M1.5 7.5 6 12l4.5-4.5" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </span>
      </a>
    </section>
  );
}
