"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ScrambleText from "@/components/ui/ScrambleText";
import { Icon } from "@/components/cosmoscope/ui";

/**
 * The frame every Stellr tool shares with Cosmoscope: a slim top bar, frosted panels, and a way
 * to hide the panels (button, H, Esc) to see only the scene.
 */

export { glass, Icon, Stat, Toggle } from "@/components/cosmoscope/ui";

/** Panels hidden, toggled with H and brought back with Esc (not while typing in a field). */
export function useClean() {
  const [clean, setClean] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || el?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "h" || e.key === "H") setClean((c) => !c);
      else if (e.key === "Escape") setClean(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return [clean, setClean] as const;
}

/** The top bar: back to Stellr, the tool's name and line, and its controls on the right. */
export function ToolBar({ title, tagline, clean, onClean, children }: { title: string; tagline: string; clean?: boolean; onClean?: () => void; children?: React.ReactNode }) {
  const hide = clean ? "hidden" : "";
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
      <div className={`pointer-events-auto flex min-w-0 items-center gap-3 sm:gap-4 ${hide}`}>
        <Link href="/" aria-label="Back to Stellr" className="font-mono text-[11px] tracking-[0.2em] text-ink/60 transition-colors hover:text-gold">
          <span className="sm:hidden">←</span>
          <span className="hidden sm:inline">
            <ScrambleText text="← STELLR" />
          </span>
        </Link>
        <span className="hidden h-5 w-px bg-ink/20 sm:block" />
        <div className="min-w-0">
          <h1 className="truncate font-sans text-[13px] font-semibold tracking-[0.22em] text-ink sm:text-[15px] sm:tracking-[0.32em]">{title.toUpperCase()}</h1>
          <p className="hidden truncate text-[11px] text-ink/50 md:block">{tagline}</p>
        </div>
      </div>
      <div className="pointer-events-auto ml-auto flex items-center gap-2">
        <div className={`flex items-center gap-2 ${hide}`}>{children}</div>
        {onClean && (
          <button
            type="button"
            onClick={onClean}
            title={clean ? "Show the panels (H or Esc)" : "Hide the panels (H)"}
            className="flex items-center gap-2 rounded-full border border-ink/20 bg-black/40 px-3.5 py-2 text-[12px] text-ink/85 backdrop-blur-md transition-colors hover:border-ink/50"
          >
            <Icon name={clean ? "eye" : "eye-off"} />
            <span className="hidden sm:inline">{clean ? "Show panels" : "Hide panels"}</span>
          </button>
        )}
      </div>
    </header>
  );
}

/** A pill switch between a few choices. */
export function Segmented<T extends string>({ options, value, onChange, className = "" }: { options: [T, string][]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={`flex rounded-full border border-ink/15 bg-black/40 p-0.5 backdrop-blur-md ${className}`}>
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] transition-colors sm:px-3.5 ${value === v ? "bg-ink text-void" : "text-ink/65 hover:text-ink"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** A labelled block inside a panel. */
export function Section({ eyebrow, children, className = "", right }: { eyebrow?: string; children: React.ReactNode; className?: string; right?: React.ReactNode }) {
  return (
    <div className={`border-t border-ink/[0.08] px-5 py-4 first:border-t-0 ${className}`}>
      {(eyebrow || right) && (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          {eyebrow && <p className="font-mono text-[9px] tracking-[0.22em] text-ink/45">{eyebrow}</p>}
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

/** Shade at the top and bottom of a full-screen scene, so the bars read over it. */
export function SceneShade({ clean }: { clean?: boolean }) {
  if (clean) return null;
  return (
    <>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-36 bg-gradient-to-b from-black/80 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-40 bg-gradient-to-t from-black/70 to-transparent" />
    </>
  );
}

/** The hint shown while the panels are hidden. */
export function CleanHint({ clean, text = "DRAG TO TURN · SCROLL TO ZOOM" }: { clean: boolean; text?: string }) {
  if (!clean) return null;
  return (
    <p className="pointer-events-none absolute inset-x-0 bottom-5 z-10 text-center font-mono text-[10px] tracking-[0.2em] text-ink/40">
      {text} · <span className="hidden sm:inline">H OR ESC</span>
      <span className="sm:hidden">TAP SHOW PANELS</span> TO BRING THE PANELS BACK
    </p>
  );
}

/** A status line with a coloured dot. */
export function Status({ tone = "ink", children }: { tone?: "gold" | "ink" | "blue" | "red"; children: React.ReactNode }) {
  const dot = tone === "gold" ? "bg-gold live-dot" : tone === "blue" ? "bg-[#7fd4ff]" : tone === "red" ? "bg-[#ff6a3d]" : "bg-ink/40";
  return (
    <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-ink/60">
      <span className={`block h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      {children}
    </p>
  );
}

/** Wide-screen panel classes that also obey hiding: `lg:block` would otherwise override `hidden`. */
export const wide = (clean: boolean) => (clean ? "hidden" : "hidden lg:block");
