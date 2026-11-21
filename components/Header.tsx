"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { CAMERA_PATH, scroll } from "@/lib/scroll";
import { SECTIONS, TOOLS } from "@/lib/nav";
import ScrambleText from "@/components/ui/ScrambleText";

/**
 * The landing page's header: the wordmark, a Tools menu reaching every tool, links to the
 * page's own sections, and the account. It stays on screen the whole way down, with a thin
 * line under it showing how far along the journey you are and which section you're in.
 */
export default function Header() {
  const [labels, setLabels] = useState<string[]>([]);
  const [current, setCurrent] = useState(0);
  const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // The intro shows the big lockup itself; the header's wordmark appears once we leave it.
  const pastIntro = current > 0;

  useEffect(() => {
    const found = Array.from(document.querySelectorAll<HTMLElement>("[data-scene]")).map((el) => el.dataset.label ?? "");
    // Section labels live in the DOM, which only exists after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLabels(found);
    let last = -1;
    const max = Math.max(1, CAMERA_PATH.length - 1);
    const tick = () => {
      if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, scroll.journey / max)})`;
      const i = Math.round(scroll.journey);
      if (i !== last) {
        last = i;
        setCurrent(i);
      }
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, []);

  /** The signed-in account, if any; the header shows its picture. */
  const [me, setMe] = useState<{ name: string; picture: string } | null>(null);
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((d: { user: { name: string; picture: string } | null } | null) => setMe(d?.user ?? null))
      .catch(() => {});
  }, []);

  // The Tools menu closes on a click outside it or on Esc.
  useEffect(() => {
    if (!menu && !mobile) return;
    const close = (e: PointerEvent) => {
      if (menu && !menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(false);
        setMobile(false);
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", key);
    };
  }, [menu, mobile]);

  const label = labels[current] ?? "";
  const live = TOOLS.filter((t) => t.group === "live");
  const research = TOOLS.filter((t) => t.group === "research");

  const ToolLink = ({ t, onPick }: { t: (typeof TOOLS)[number]; onPick?: () => void }) => (
    <a href={t.href} onClick={onPick} className="group flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-ink/[0.06]">
      <span className="mt-1.5 block h-2 w-2 shrink-0 rounded-full" style={{ background: t.color, boxShadow: `0 0 10px ${t.color}` }} />
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-[14px] text-ink">
          {t.name}
          {t.note && <span className="rounded-full border border-ink/20 px-1.5 py-px font-mono text-[8px] tracking-[0.16em] text-ink/50">{t.note.toUpperCase()}</span>}
        </span>
        <span className="mt-0.5 block text-[12px] leading-snug text-ink/50 group-hover:text-ink/65">{t.line}</span>
      </span>
    </a>
  );

  return (
    <header className="fixed inset-x-0 top-0 z-40">
      {/* Over the intro, a soft fade; past it, a solid frosted bar so the page never shows through the links. */}
      <div className={`header-scrim pointer-events-none absolute inset-0 h-[140%] transition-opacity duration-500 ${pastIntro ? "opacity-0" : "opacity-100"}`} />
      <div className={`pointer-events-none absolute inset-0 bg-[#050608]/85 backdrop-blur-xl transition-opacity duration-500 ${pastIntro ? "opacity-100" : "opacity-0"}`} />
      <div className="relative flex items-center justify-between gap-4 px-4 py-3.5 sm:px-8">
        {/* Wordmark, and where you are on the journey. */}
        <div className="flex min-w-0 items-center gap-4">
          <a href="#top" aria-label="Stellr, back to top" className="flex items-center gap-3 text-ink">
            <span className="block h-[7px] w-[7px] bg-gold" />
            <span className={`font-sans text-[15px] font-semibold tracking-[0.42em] transition-opacity duration-700 ${pastIntro ? "opacity-100" : "opacity-0"}`}>STELLR</span>
          </a>
          <span className={`hidden items-center gap-2 font-mono text-[10px] tracking-[0.2em] text-ink/45 transition-opacity duration-700 xl:flex ${pastIntro ? "opacity-100" : "opacity-0"}`}>
            <span className="h-4 w-px bg-ink/20" />
            <span className="tabular-nums">{String(current).padStart(2, "0")}</span>
            <span key={label} className="text-ink/60">
              <ScrambleText text={label} />
            </span>
          </span>
        </div>

        {/* Navigation, on wide screens. */}
        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          <div ref={menuRef} className="relative">
            <button
              type="button"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] transition-colors ${menu ? "bg-ink/10 text-ink" : "text-ink/75 hover:text-ink"}`}
            >
              Tools
              <svg viewBox="0 0 16 16" className={`h-3 w-3 transition-transform ${menu ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
                <path d="M4 6l4 4 4-4" />
              </svg>
            </button>
            {menu && (
              <div className="absolute left-1/2 top-full mt-3 w-[640px] -translate-x-1/2 rounded-2xl border border-ink/10 bg-[#07080b]/95 p-3 shadow-[0_30px_80px_rgba(0,0,0,0.6)] backdrop-blur-xl">
                <div className="grid grid-cols-[1.35fr_1fr] gap-3">
                  <div>
                    <p className="px-3 pb-1 pt-1 font-mono text-[9px] tracking-[0.24em] text-ink/40">LIVE TOOLS</p>
                    {live.map((t) => (
                      <ToolLink key={t.href} t={t} onPick={() => setMenu(false)} />
                    ))}
                  </div>
                  <div className="flex flex-col rounded-xl bg-ink/[0.03] p-1">
                    <p className="px-3 pb-1 pt-2 font-mono text-[9px] tracking-[0.24em] text-ink/40">RESEARCH</p>
                    {research.map((t) => (
                      <ToolLink key={t.href} t={t} onPick={() => setMenu(false)} />
                    ))}
                    <a href="#tools" onClick={() => setMenu(false)} className="mt-auto px-3 py-2.5 font-mono text-[10px] tracking-[0.2em] text-ink/50 transition-colors hover:text-gold">
                      SEE THEM ALL ON THIS PAGE ↓
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>
          <a href="/cosmoscope" className="rounded-full px-3.5 py-2 text-[13px] text-ink/75 transition-colors hover:text-ink">
            Cosmoscope
          </a>
          <a href="/exoplanet-lab" className="rounded-full px-3.5 py-2 text-[13px] text-ink/75 transition-colors hover:text-ink">
            Exoplanet Lab
          </a>
          {SECTIONS.filter(([, h]) => h !== "#tools").map(([name, href]) => (
            <a key={href} href={href} className="rounded-full px-3.5 py-2 text-[13px] text-ink/75 transition-colors hover:text-ink">
              {name}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href="/account"
            aria-label={me ? `Your account, ${me.name}` : "Sign in"}
            className="flex items-center gap-2 whitespace-nowrap rounded-full border border-ink/20 p-1 text-[12px] text-ink/85 transition-colors hover:border-ink/60 sm:pr-3.5"
          >
            {me?.picture ? (
              // Google's avatar host; a plain img keeps it out of the image optimiser.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={me.picture} alt="" referrerPolicy="no-referrer" className="h-7 w-7 rounded-full" />
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-ink/20 font-mono text-[11px] text-gold">{me ? me.name.slice(0, 1).toUpperCase() : "→"}</span>
            )}
            <span className="hidden sm:inline">{me ? "Account" : "Sign in"}</span>
          </a>
          <a href="/cosmoscope" className="hidden rounded-full bg-ink px-4 py-2 text-[12px] font-semibold text-void transition-colors hover:bg-gold md:block">
            Launch
          </a>
          <button
            type="button"
            aria-label={mobile ? "Close menu" : "Open menu"}
            aria-expanded={mobile}
            onClick={() => setMobile(!mobile)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-ink/20 text-ink lg:hidden"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
              {mobile ? <path d="M4 4l8 8M12 4l-8 8" /> : <path d="M2.5 5h11M2.5 8h11M2.5 11h11" />}
            </svg>
          </button>
        </div>
      </div>

      {/* Journey progress. */}
      <div className="relative h-px bg-ink/[0.06]">
        <div ref={bar} className="h-px origin-left scale-x-0 bg-gradient-to-r from-gold/40 via-gold to-gold/40" />
      </div>

      {/* Phones and tablets: the whole menu. */}
      {mobile && (
        <div className="cosmo-scroll relative max-h-[calc(100svh-4rem)] overflow-y-auto border-b border-ink/10 bg-[#050608]/97 px-4 pb-6 pt-2 backdrop-blur-xl lg:hidden">
          <p className="px-3 pb-1 pt-3 font-mono text-[9px] tracking-[0.24em] text-ink/40">LIVE TOOLS</p>
          {live.map((t) => (
            <ToolLink key={t.href} t={t} onPick={() => setMobile(false)} />
          ))}
          <p className="px-3 pb-1 pt-4 font-mono text-[9px] tracking-[0.24em] text-ink/40">RESEARCH</p>
          {research.map((t) => (
            <ToolLink key={t.href} t={t} onPick={() => setMobile(false)} />
          ))}
          <p className="px-3 pb-1 pt-4 font-mono text-[9px] tracking-[0.24em] text-ink/40">ON THIS PAGE</p>
          <div className="flex flex-wrap gap-2 px-3 pt-1">
            {SECTIONS.map(([name, href]) => (
              <a key={href} href={href} onClick={() => setMobile(false)} className="rounded-full border border-ink/15 px-3 py-1.5 text-[13px] text-ink/80">
                {name}
              </a>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
