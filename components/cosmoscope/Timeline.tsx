"use client";

import { DAY_MS, Icon, fmt, glass } from "./ui";

/** Playback speeds, days per second. */
export const SPEEDS: [string, number, string][] = [
  ["1 day/s", 1, "a day every second"],
  ["1 wk/s", 7, "a week every second"],
  ["1 mo/s", 30, "a month every second"],
  ["1 yr/s", 365, "a year every second"],
];
/** The slider reaches this far either side of today; the date box goes anywhere. */
export const SLIDER_DAYS = 3650;

export interface Mode {
  live: boolean;
  rate: number;
}

/** The time bar: what moment is shown, and controls to move it. */
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
  const sliderDays = shown ? Math.max(-SLIDER_DAYS, Math.min(SLIDER_DAYS, Math.round((shown - today) / DAY_MS))) : 0;
  const playing = !mode.live && mode.rate !== 0;
  const status = mode.live ? "Live" : playing ? `${reverse ? "Rewinding" : "Playing"} · ${SPEEDS.find(([, r]) => r === mode.rate)?.[2] ?? ""}` : "Paused";
  const year = shown ? new Date(shown).getUTCFullYear() : 0;
  const ticks = [-10, -5, 0, 5, 10];

  return (
    <section aria-label="Time" className={`${glass} px-4 py-3.5 sm:px-5 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="min-w-[150px]">
          <p className="flex items-center gap-2 font-mono text-[9px] tracking-[0.22em] text-ink/45">
            <span className={`block h-1.5 w-1.5 rounded-full ${mode.live ? "live-dot bg-gold" : playing ? "bg-[#7fd4ff]" : "bg-ink/40"}`} />
            {status.toUpperCase()}
          </p>
          <p className="mt-1 font-mono text-[15px] tabular-nums tracking-[0.08em] text-ink">
            {shown ? fmt(shown, { day: "2-digit", month: "short", year: "numeric" }, "UTC") : "—"}
            <span className="ml-2 text-[12px] text-ink/50">{shown ? fmt(shown, { hour: "2-digit", minute: "2-digit" }, "UTC") : ""} UTC</span>
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onReverse}
            aria-pressed={reverse}
            title="Run time backwards"
            className={`flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${reverse ? "border-ink bg-ink text-void" : "border-ink/20 text-ink/75 hover:border-ink/60"}`}
          >
            <Icon name="back" />
          </button>
          <button
            type="button"
            onClick={() => (playing ? onRate(0) : onRate(mode.rate || 1))}
            aria-label={playing ? "Pause" : "Play"}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-ink text-void transition-colors hover:bg-gold"
          >
            <Icon name={playing ? "pause" : "play"} className="h-4 w-4" />
          </button>
          <div className="ml-1 flex min-w-0 rounded-full border border-ink/15 p-0.5">
            {SPEEDS.map(([label, rate]) => (
              <button
                key={label}
                type="button"
                onClick={() => onRate(rate)}
                className={`whitespace-nowrap rounded-full px-1.5 py-1 font-mono text-[9px] tracking-[0.02em] transition-colors sm:px-2.5 sm:text-[10px] sm:tracking-[0.06em] ${
                  playing && mode.rate === rate ? "bg-ink/90 text-void" : "text-ink/60 hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onLive}
            className={`rounded-full border px-3.5 py-1.5 font-mono text-[10px] tracking-[0.18em] transition-colors ${mode.live ? "border-gold bg-gold text-void" : "border-ink/25 text-ink/80 hover:border-ink/60"}`}
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
            className="h-8 rounded-full border border-ink/20 bg-transparent px-3 font-mono text-[11px] tracking-[0.06em] text-ink outline-none [color-scheme:dark] focus:border-ink/60"
          />
        </div>
      </div>

      <div className="mt-3">
        <label htmlFor="cosmo-time" className="sr-only">
          Days from today
        </label>
        <input
          id="cosmo-time"
          type="range"
          min={-SLIDER_DAYS}
          max={SLIDER_DAYS}
          step={1}
          value={sliderDays}
          onChange={(e) => onJump(today + Number(e.target.value) * DAY_MS + 12 * 3_600_000)}
          className="cosmo-range w-full"
          style={{ ["--fill" as string]: `${((sliderDays + SLIDER_DAYS) / (2 * SLIDER_DAYS)) * 100}%` }}
        />
        <div className="mt-1 flex justify-between font-mono text-[9px] tracking-[0.12em] text-ink/35">
          {ticks.map((y) => (
            <span key={y} className={y === 0 ? "text-ink/60" : ""}>
              {y === 0 ? "TODAY" : today ? new Date(today).getUTCFullYear() + y : ""}
            </span>
          ))}
        </div>
      </div>

      {presets.length > 0 && (
        <div className="cosmo-scroll mt-2.5 flex items-center gap-1.5 overflow-x-auto whitespace-nowrap border-t border-ink/10 pt-2.5">
          <span className="mr-1 font-mono text-[9px] tracking-[0.2em] text-ink/40">JUMP TO</span>
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => onJump(p.t, p.body)}
              className="shrink-0 rounded-full border border-ink/12 px-2.5 py-1 text-[11px] text-ink/65 transition-colors hover:border-gold/60 hover:text-gold"
            >
              {p.label}
            </button>
          ))}
          {year !== 0 && <span className="sr-only">Year shown {year}</span>}
        </div>
      )}
    </section>
  );
}
