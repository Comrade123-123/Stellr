"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { scroll, CAMERA_PATH } from "@/lib/scroll";
import { formatUtc, useNow } from "@/lib/time";
import { useAppStore } from "@/lib/store";

/** Anything the chip shouldn't sit on top of. */
const CONTENT = "a, button, input, p, h2, h3, li";

/**
 * Floating picture-in-picture style readout (after Oakley's pinned video
 * thumbnail): live UTC clock and how far through the journey you are. It steps
 * aside (fades out) while text or a button scrolls underneath it.
 */
export default function LiveChip() {
  const now = useNow();
  const ready = useAppStore((s) => s.ready);
  const root = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const max = CAMERA_PATH.length - 1;
    let checked = 0;
    const tick = (time: number) => {
      if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, scroll.journey / max)})`;
      const el = root.current;
      // A few times a second, look at what lies under the chip's corners and middle. The chip
      // itself ignores the pointer, so elementsFromPoint sees straight through it.
      if (!el || time - checked < 0.2) return;
      checked = time;
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      const points: [number, number][] = [
        [r.left + 2, r.top + 2],
        [r.right - 2, r.top + 2],
        [r.left + 2, r.bottom - 2],
        [r.right - 2, r.bottom - 2],
        [(r.left + r.right) / 2, (r.top + r.bottom) / 2],
      ];
      const covered = points.some(([x, y]) => document.elementsFromPoint(x, y).some((e) => e.matches(CONTENT)));
      el.dataset.covered = covered ? "true" : "false";
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, []);

  return (
    <div
      ref={root}
      aria-hidden
      className={`frame pointer-events-none fixed bottom-6 left-6 z-30 hidden w-[200px] bg-void/50 p-3 font-mono text-[10px] tracking-[0.18em] text-ink/70 backdrop-blur-md transition-opacity duration-500 data-[covered=true]:opacity-0 md:block ${
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
