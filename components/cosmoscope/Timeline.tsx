"use client";

import { useEffect, useRef, useState } from "react";
import { DAY_MS, Icon, fmt, glass } from "./ui";

/** Playback speeds, days per second. */
export const SPEEDS: [string, number, string][] = [
  ["1 day/s", 1, "a day every second"],
  ["1 week/s", 7, "a week every second"],
  ["1 month/s", 30, "a month every second"],
  ["1 year/s", 365, "a year every second"],
];
/** The slider reaches this far either side of today; the date box goes anywhere. */
export const SLIDER_DAYS = 3650;

export interface Mode {
  live: boolean;
  rate: number;
}

/** A small menu that opens upwards from its button and closes on a click outside. */
function Popover({ label, children, open, setOpen, align = "left" }: { label: React.ReactNode; children: React.ReactNode; open: boolean; setOpen: (o: boolean) => void; align?: "left" | "right" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open, setOpen]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12px] transition-colors ${open ? "border-ink bg-ink text-void" : "border-ink/15 text-ink/80 hover:border-ink/45"}`}
      >
        {label}
        <Icon name="up" className={`h-3 w-3 transition-transform ${open ? "" : "rotate-180"}`} />
      </button>
      {open && <div className={`${glass} absolute bottom-full z-30 mb-2 min-w-[210px] p-1.5 ${align === "right" ? "right-0" : "left-0"}`}>{children}</div>}
    </div>
  );
}

/** The time bar: what moment is shown, and controls to move it. One slim row on wide screens. */
export default function Timeline({
  shown,
  today,
  mode,
  reverse,
  presets,
  onLive,
  onRate,
  onReverse,
  onJump,
  className = "",
}: {
  shown: number;
  today: number;
  mode: Mode;
  reverse: boolean;
  presets: { label: string; t: number; body: string | null }[];
  onLive: () => void;
  onRate: (rate: number) => void;
  onReverse: () => void;
  onJump: (t: number, body?: string | null) => void;
  className?: string;
}) {
  const [menu, setMenu] = useState<"speed" | "jump" | null>(null);
  const sliderDays = shown ? Math.max(-SLIDER_DAYS, Math.min(SLIDER_DAYS, Math.round((shown - today) / DAY_MS))) : 0;
  const playing = !mode.live && mode.rate !== 0;
  const speed = SPEEDS.find(([, r]) => r === mode.rate) ?? SPEEDS[0];
  const fill = ((sliderDays + SLIDER_DAYS) / (2 * SLIDER_DAYS)) * 100;
  const year = today ? new Date(today).getUTCFullYear() : 0;

  return (
    <section aria-label="Time" className={`${glass} px-3 py-2.5 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 xl:flex-nowrap">
        {/* Transport. */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onReverse}
            aria-pressed={reverse}
            title={reverse ? "Running backwards" : "Run time backwards"}
            className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${reverse ? "border-ink bg-ink text-void" : "border-ink/15 text-ink/70 hover:border-ink/45"}`}
          >
            <Icon name="back" />
          </button>
          <button
            type="button"
            onClick={() => (playing ? onRate(0) : onRate(mode.rate || 1))}
            aria-label={playing ? "Pause" : "Play"}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-ink text-void shadow-[0_0_24px_rgba(236,238,242,0.18)] transition-colors hover:bg-gold"
          >
            <Icon name={playing ? "pause" : "play"} className="h-4 w-4" />
          </button>
          <Popover label={speed[0]} open={menu === "speed"} setOpen={(o) => setMenu(o ? "speed" : null)}>
            <p className="px-2.5 pb-1 pt-1.5 font-mono text-[9px] tracking-[0.2em] text-ink/40">PLAYBACK SPEED</p>
            {SPEEDS.map(([label, rate, words]) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  onRate(rate);
                  setMenu(null);
                }}
                className={`flex w-full items-baseline justify-between gap-4 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-ink/[0.07] ${playing && mode.rate === rate ? "text-gold" : "text-ink/85"}`}
              >
                {label}
                <span className="text-[11px] text-ink/40">{words}</span>
              </button>
            ))}
          </Popover>
        </div>

        <span className="hidden h-8 w-px bg-ink/10 xl:block" />

        {/* The moment shown. */}
        <div className="min-w-[168px]">
          <p className="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.2em] text-ink/45">
            <span className={`block h-1.5 w-1.5 rounded-full ${mode.live ? "live-dot bg-gold" : playing ? "bg-[#7fd4ff]" : "bg-ink/35"}`} />
            {mode.live ? "LIVE" : playing ? (reverse ? "REWINDING" : "PLAYING") : "PAUSED"}
          </p>
          <p className="mt-0.5 whitespace-nowrap font-mono text-[14px] tabular-nums tracking-[0.06em] text-ink">
            {shown ? fmt(shown, { day: "2-digit", month: "short", year: "numeric" }, "UTC") : "—"}
            <span className="ml-1.5 text-[11px] text-ink/45">{shown ? fmt(shown, { hour: "2-digit", minute: "2-digit" }, "UTC") : ""} UTC</span>
          </p>
        </div>

        {/* Ten years either way. */}
        <div className="order-last w-full min-w-[200px] xl:order-none xl:w-auto xl:flex-1">
          <label htmlFor="cosmo-time" className="sr-only">
            Days from today
          </label>
          <div className="relative">
            <input
              id="cosmo-time"
              type="range"
              min={-SLIDER_DAYS}
              max={SLIDER_DAYS}
              step={1}
              value={sliderDays}
              onChange={(e) => onJump(today + Number(e.target.value) * DAY_MS + 12 * 3_600_000)}
              className="cosmo-range relative z-10 w-full"
              style={{ ["--fill" as string]: `${fill}%` }}
            />
            <div aria-hidden className="pointer-events-none absolute inset-x-[8px] top-[13px] flex justify-between">
              {Array.from({ length: 21 }, (_, i) => (
                <span key={i} className={`block w-px ${i % 5 === 0 ? "h-2 bg-ink/35" : "h-1 bg-ink/15"}`} />
              ))}
            </div>
          </div>
          <div className="mt-1 flex justify-between px-[2px] font-mono text-[9px] tracking-[0.1em] text-ink/35">
            {[-10, -5, 0, 5, 10].map((y) => (
              <span key={y} className={y === 0 ? "text-ink/60" : ""}>
                {y === 0 ? "TODAY" : year ? year + y : ""}
              </span>
            ))}
          </div>
        </div>

        {/* Jumps. */}
        <div className="ml-auto flex items-center gap-1.5 xl:ml-0">
          {presets.length > 0 && (
            <Popover label="Jump to" open={menu === "jump"} setOpen={(o) => setMenu(o ? "jump" : null)} align="right">
              <p className="px-2.5 pb-1 pt-1.5 font-mono text-[9px] tracking-[0.2em] text-ink/40">COMING UP</p>
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    onJump(p.t, p.body);
                    setMenu(null);
                  }}
                  className="block w-full whitespace-nowrap rounded-lg px-2.5 py-2 text-left text-[13px] text-ink/85 transition-colors hover:bg-ink/[0.07] hover:text-gold"
                >
                  {p.label}
                </button>
              ))}
            </Popover>
          )}
          <button
            type="button"
            onClick={onLive}
            className={`h-9 rounded-full border px-3.5 font-mono text-[10px] tracking-[0.18em] transition-colors ${mode.live ? "border-gold bg-gold text-void" : "border-ink/15 text-ink/80 hover:border-ink/45"}`}
          >
            NOW
          </button>
          <label htmlFor="cosmo-date" className="sr-only">
            Go to date
          </label>
          <input
            id="cosmo-date"
            type="date"
            min="1900-01-01"
            max="2199-12-31"
            value={shown ? new Date(shown).toISOString().slice(0, 10) : ""}
            onChange={(e) => {
              const t = Date.parse(`${e.target.value}T12:00:00Z`);
              if (Number.isFinite(t)) onJump(t);
            }}
            className="h-9 w-[132px] rounded-full border border-ink/15 bg-transparent px-3 font-mono text-[11px] tracking-[0.04em] text-ink outline-none [color-scheme:dark] focus:border-ink/50"
          />
        </div>
      </div>
    </section>
  );
}
