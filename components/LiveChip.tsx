"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { scroll, CAMERA_PATH } from "@/lib/scroll";
import { formatUtc, useNow } from "@/lib/time";
import { useAppStore } from "@/lib/store";

/**
 * Floating picture-in-picture style readout (after Oakley's pinned video
 * thumbnail): live UTC clock and how far through the journey you are.
 */
export default function LiveChip() {
  const now = useNow();
  const ready = useAppStore((s) => s.ready);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const max = CAMERA_PATH.length - 1;
    const tick = () => {
      if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, scroll.journey / max)})`;
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, []);

  return (
    <div
      aria-hidden
      className={`frame pointer-events-none fixed bottom-6 left-6 z-30 hidden w-[200px] bg-void/50 p-3 font-mono text-[10px] tracking-[0.18em] text-ink/70 backdrop-blur-md transition-opacity duration-1000 md:block ${
        ready ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="live-dot block h-1.5 w-1.5 rounded-full bg-gold" />
          LIVE
        </span>
        <span className="tabular-nums text-ink">{now ? `${formatUtc(now)} UTC` : "--:--:-- UTC"}</span>
      </div>
      <div className="mt-3 h-px w-full bg-ink/15">
        <div ref={bar} className="h-px origin-left scale-x-0 bg-ink/80" />
      </div>
      <div className="mt-2 flex justify-between text-ink/45">
        <span>EARTH</span>
        <span>JOURNEY</span>
      </div>
    </div>
  );
}
