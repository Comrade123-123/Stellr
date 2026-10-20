"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";

export default function Loader() {
  const progress = useAppStore((s) => s.progress);
  const ready = useAppStore((s) => s.ready);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setGone(true), 1100);
    return () => clearTimeout(t);
  }, [ready]);

  if (gone) return null;
  const pct = ready ? 100 : Math.min(99, Math.round(progress));

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={ready ? "Loaded" : `Loading ${pct}%`}
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-void transition-opacity duration-1000 ease-out ${
        ready ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      <div className="w-[min(240px,60vw)]">
        <div className="mb-3 flex justify-between font-mono text-[11px] tracking-[0.2em] text-ink/60">
          <span>STELLR</span>
          <span className="tabular-nums text-ink">{String(pct).padStart(3, "0")}</span>
        </div>
        <div className="h-px w-full bg-ink/15">
          <div
            className="h-px bg-gold transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
