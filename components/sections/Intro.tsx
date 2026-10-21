"use client";

import { useRef } from "react";
import { useReveal } from "@/components/ui/useReveal";

/**
 * Opening frame: a night launch. The lockup splits around the rocket, which
 * the camera centres between the two halves.
 */
export default function Intro() {
  const root = useRef<HTMLElement>(null);
  useReveal(root, "top bottom");

  return (
    <section
      ref={root}
      id="top"
      data-scene="intro"
      data-label="LAUNCH"
      className="relative flex h-svh min-h-[560px] flex-col items-center justify-center px-5"
    >
      {/* At the rocket's height (about a quarter down), split around it. */}
      <div className="reveal-fade absolute inset-x-0 top-[25%] flex items-center justify-center px-5 [@media(max-aspect-ratio:9/10)]:top-[29%]">
        <span className="flex-1 text-right font-sans text-lg font-semibold tracking-[0.55em] text-ink sm:text-3xl">
          STELLR
        </span>
        {/* The rocket sits in this gap. */}
        <span aria-hidden className="w-16 shrink-0 sm:w-28" />
        <span className="flex-1 text-left font-mono text-[9px] leading-snug tracking-[0.3em] text-ink/80 sm:text-xs">
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
