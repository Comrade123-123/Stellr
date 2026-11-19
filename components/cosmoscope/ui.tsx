import { BODIES, MOONS, type BodyName, type MoonName } from "@/lib/cosmoscope";
import { PROFILES } from "@/lib/cosmoscope-profiles";

/** Small shared pieces of Cosmoscope's interface. */

export const AU_LIGHT_S = 499.004784;
export const DAY_MS = 86_400_000;

export const fmt = (t: number, opts: Intl.DateTimeFormatOptions, timeZone?: string) => new Intl.DateTimeFormat("en-GB", { ...opts, timeZone }).format(new Date(t)).toUpperCase();

export function lightTime(s: number) {
  if (s < 60) return `${s.toFixed(1)} s`;
  if (s < 3600) {
    const t = Math.round(s);
    return `${Math.floor(t / 60)} min ${t % 60} s`;
  }
  const m = Math.round(s / 60);
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
export const auText = (au: number) => `${au.toFixed(au < 10 ? 3 : 2)} AU`;
export const kmText = (km: number) =>
  km >= 1e9 ? `${(km / 1e9).toFixed(2)} billion km` : km >= 1e6 ? `${(km / 1e6).toFixed(1)} million km` : `${Math.round(km).toLocaleString("en")} km`;
export const dayText = (h: number) => (Math.abs(h) < 48 ? `${Math.abs(h).toFixed(1)} hours` : `${(Math.abs(h) / 24).toFixed(1)} Earth days`);
export const yearText = (d: number) => (d < 730 ? `${Math.round(d)} days` : `${(d / 365.25).toFixed(1)} years`);

export const isBody = (k: string | null): k is BodyName => BODIES.some((b) => b.name === k);
export const isMoon = (k: string | null): k is MoonName => MOONS.some((m) => m.name === k);

/** A planet drawn in CSS: a lit sphere in its colours, with Saturn's rings. Cheap enough for lists. */
export function Thumb({ name, size = 28, ring = true }: { name: string; size?: number; ring?: boolean }) {
  const profile = isBody(name) ? PROFILES[name] : null;
  const moon = isMoon(name) ? MOONS.find((m) => m.name === name) : null;
  const [light, dark] = profile?.swatch ?? (moon ? [moon.color, "#1a1a1a"] : ["#7fd4ff", "#0d3a52"]);
  const glow = name === "Sun" ? `0 0 ${size * 0.6}px rgba(255,180,80,0.55)` : "none";
  return (
    <span aria-hidden className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <span
        className="block rounded-full"
        style={{
          width: size * (name === "Saturn" && ring ? 0.62 : 1),
          height: size * (name === "Saturn" && ring ? 0.62 : 1),
          background: `radial-gradient(circle at 34% 30%, ${light} 0%, ${dark} 62%, #050505 100%)`,
          boxShadow: glow,
        }}
      />
      {name === "Saturn" && ring && (
        <span className="absolute left-1/2 top-1/2 block -translate-x-1/2 -translate-y-1/2 rotate-[-18deg] rounded-[50%] border border-[#d9c49a]/70" style={{ width: size, height: size * 0.32 }} />
      )}
    </span>
  );
}

export function Icon({ name, className = "h-3.5 w-3.5" }: { name: "play" | "pause" | "back" | "layers" | "eye" | "eye-off" | "down" | "up" | "close" | "sun" | "expand"; className?: string }) {
  const common = { className, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "play":
      return (
        <svg {...common}>
          <path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "pause":
      return (
        <svg {...common}>
          <path d="M5.5 3.5v9M10.5 3.5v9" strokeWidth={2} />
        </svg>
      );
    case "back":
      return (
        <svg {...common}>
          <path d="M11 3.5v9l-7-4.5z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "layers":
      return (
        <svg {...common}>
          <path d="M8 2.5 14 6 8 9.5 2 6z" />
          <path d="M2 9l6 3.5L14 9" />
        </svg>
      );
    case "eye":
      return (
        <svg {...common}>
          <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
          <circle cx="8" cy="8" r="2" />
        </svg>
      );
    case "eye-off":
      return (
        <svg {...common}>
          <path d="M2 2l12 12M6.5 4C7 3.7 7.5 3.5 8 3.5c4 0 6.5 4.5 6.5 4.5s-.7 1.3-2 2.5M4 5.5C2.4 6.7 1.5 8 1.5 8S4 12.5 8 12.5c1 0 1.9-.3 2.7-.7" />
        </svg>
      );
    case "down":
      return (
        <svg {...common}>
          <path d="M4 6l4 4 4-4" />
        </svg>
      );
    case "up":
      return (
        <svg {...common}>
          <path d="M4 10l4-4 4 4" />
        </svg>
      );
    case "close":
      return (
        <svg {...common}>
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      );
    case "sun":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="2.6" />
          <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
        </svg>
      );
    case "expand":
      return (
        <svg {...common}>
          <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
        </svg>
      );
  }
}

/** A switch row for the layers menu. */
export function Toggle({ label, note, on, onChange, tone = "bg-gold" }: { label: string; note?: string; on: boolean; onChange: () => void; tone?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onChange} className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-ink/[0.06]">
      <span>
        <span className="block text-[13px] text-ink/90">{label}</span>
        {note && <span className="mt-0.5 block text-[11px] leading-snug text-ink/45">{note}</span>}
      </span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? tone : "bg-ink/20"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-void transition-[left] ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

/** A figure with its label, for stat grids. */
export function Stat({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[9px] tracking-[0.2em] text-ink/45">{label}</p>
      <p className={`mt-1 truncate text-[15px] ${accent ? "text-gold" : "text-ink"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] leading-snug text-ink/45">{sub}</p>}
    </div>
  );
}

/** Frosted panel used across the stage. */
export const glass = "rounded-2xl border border-ink/10 bg-[#07080b]/72 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl";
