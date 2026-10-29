"use client";

import { useEffect, useState } from "react";
import { gsap } from "gsap";
import { scroll } from "@/lib/scroll";
import ScrambleText from "@/components/ui/ScrambleText";

/**
 * Oakley-style centred lockup on a blurred band, with a live Turion-style
 * section index on the left.
 */
export default function Header() {
  const [labels, setLabels] = useState<string[]>([]);
  const [current, setCurrent] = useState(0);
  // The intro shows the big lockup itself; the header's copy appears once we leave it.
  const pastIntro = current > 0;

  useEffect(() => {
    const found = Array.from(document.querySelectorAll<HTMLElement>("[data-scene]")).map(
      (el) => el.dataset.label ?? "",
    );
    // Section labels live in the DOM, which only exists after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLabels(found);
    let last = -1;
    const tick = () => {
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

  const label = labels[current] ?? "";

  return (
    <header className="fixed inset-x-0 top-0 z-40">
      <div className="header-scrim pointer-events-none absolute inset-0 h-[140%]" />
      <div className="relative grid grid-cols-[1fr_auto_1fr] items-center px-5 py-5 sm:px-10 md:py-6">
        <div className="hidden items-center gap-3 font-mono text-[11px] tracking-[0.2em] text-ink/60 sm:flex">
          <span className="block h-[7px] w-[7px] bg-gold" />
          <span className="tabular-nums">{String(current).padStart(3, "0")}</span>
          <span className="text-ink/30">/</span>
          <span key={label}>
            <ScrambleText text={label} />
          </span>
        </div>

        <a
          href="#top"
          aria-label="Stellr, back to top"
          className={`col-start-2 flex items-center gap-4 text-ink transition-[opacity,transform] duration-700 ${
            pastIntro ? "opacity-100" : "pointer-events-none -translate-y-2 opacity-0"
          }`}
        >
          <span className="font-sans text-[15px] font-semibold tracking-[0.5em] sm:text-base">STELLR</span>
          <span className="hidden h-6 w-px bg-ink/30 sm:block" />
          <span className="hidden font-mono text-[9px] leading-tight tracking-[0.25em] text-ink/70 sm:block">
            SPACE TOOLS
            <br />
            FOR THE BROWSER
          </span>
        </a>

        <div className="flex items-center justify-end gap-2 sm:gap-3">
          <a
            href="/account"
            aria-label={me ? `Your account, ${me.name}` : "Sign in"}
            className="flex items-center gap-2 whitespace-nowrap rounded-full border border-ink/25 p-1 text-[11px] font-semibold tracking-[0.12em] text-ink/85 transition-colors hover:border-ink sm:pr-4"
          >
            {me?.picture ? (
              // Google's avatar host; a plain img keeps it out of the image optimiser.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={me.picture} alt="" referrerPolicy="no-referrer" className="h-7 w-7 rounded-full" />
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-ink/25 font-mono text-[11px] text-gold">
                {me ? me.name.slice(0, 1).toUpperCase() : "→"}
              </span>
            )}
            <span className="hidden sm:inline">{me ? "ACCOUNT" : "SIGN IN"}</span>
          </a>
          <a
            href="#tools"
            className="rounded-full border border-ink/40 px-4 py-2 text-[11px] font-semibold tracking-[0.12em] text-ink transition-colors hover:border-ink hover:bg-ink hover:text-void sm:px-5"
          >
            <ScrambleText text="TOOLS" />
          </a>
        </div>
      </div>
    </header>
  );
}
