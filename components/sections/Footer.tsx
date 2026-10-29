import ScrambleText from "@/components/ui/ScrambleText";

const COLUMNS: { title: string; links: [string, string][] }[] = [
  {
    title: "LIVE TOOLS",
    links: [
      ["ORBIT WATCH", "/orbit-watch"],
      ["ASTEROID SENTINEL", "/asteroid-sentinel"],
      ["SKY EVENTS", "/sky-events"],
      ["SPACE WEATHER", "/space-weather"],
    ],
  },
  {
    title: "EXPLORE & RESEARCH",
    links: [
      ["COSMOSCOPE", "/cosmoscope"],
      ["EXOPLANET LAB", "/exoplanet-lab"],
      ["WOBBLE · PRIVATE", "/wobble"],
    ],
  },
  {
    title: "YOU",
    links: [
      ["YOUR ACCOUNT", "/account"],
      ["PRIVACY", "/privacy"],
      ["TERMS", "/terms"],
    ],
  },
  {
    title: "STELLR",
    links: [
      ["ROADMAP", "#roadmap"],
      ["START EXPLORING", "#start"],
      ["BACK TO TOP ↑", "#top"],
    ],
  },
];

const SOURCES = ["NASA", "JPL", "NOAA SWPC", "CELESTRAK", "MAST · TESS", "EXOPLANET ARCHIVE"];

const linkClass = "text-ink/80 transition-colors hover:text-gold";

export default function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-ink/10 bg-void px-5 pt-20 font-mono text-[11px] tracking-[0.15em] sm:px-10">
      {/* A thin gold horizon along the top edge, echoing the sunrise in the hero. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-40 w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold/10 blur-3xl" />

      <div className="relative mx-auto max-w-[1100px]">
        <div className="flex flex-col gap-8 border-b border-ink/10 pb-14 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="flex items-center gap-2 text-ink/50">
              <span className="live-dot block h-1.5 w-1.5 rounded-full bg-gold" />
              ALL TOOLS LIVE · FREE · IN YOUR BROWSER
            </p>
            <p className="display mt-5 max-w-[22ch] text-[clamp(1.4rem,2.6vw,2.2rem)] leading-tight tracking-normal text-ink">
              From your backyard to the edge of the observable universe.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a
              href="/cosmoscope"
              className="rounded-full bg-ink px-5 py-3 text-[11px] font-semibold tracking-[0.12em] text-void transition-colors hover:bg-gold"
            >
              <ScrambleText text="OPEN COSMOSCOPE" />
            </a>
            <a
              href="/account"
              className="rounded-full border border-ink/30 px-5 py-3 text-[11px] font-semibold tracking-[0.12em] text-ink transition-colors hover:border-ink"
            >
              <ScrambleText text="YOUR ACCOUNT" />
            </a>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-10 py-14 md:grid-cols-4">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="text-ink/40">{col.title}</p>
              <ul className="mt-5 space-y-3.5">
                {col.links.map(([label, href]) => (
                  <li key={label}>
                    <a href={href} className={linkClass}>
                      <ScrambleText text={label} />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-ink/10 py-6 text-[10px] text-ink/40">
          <span className="text-ink/55">DATA FROM</span>
          {SOURCES.map((s) => (
            <span key={s} className="rounded-full border border-ink/15 px-2.5 py-1">
              {s}
            </span>
          ))}
        </div>

        <div className="flex flex-col gap-3 border-t border-ink/10 pt-6 text-[10px] text-ink/40 sm:flex-row sm:justify-between">
          <span>© 2026 STELLR</span>
          <span className="space-y-2 sm:text-right">
            <span className="block">
              PLANET &amp; STAR TEXTURES BY{" "}
              <a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noreferrer" className={linkClass}>
                SOLAR SYSTEM SCOPE
              </a>
              , LICENSED{" "}
              <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer" className={linkClass}>
                CC BY 4.0
              </a>
            </span>
            <span className="block">
              SATURN V MODEL BY{" "}
              <a href="https://science.nasa.gov/3d-resources/" target="_blank" rel="noreferrer" className={linkClass}>
                NASA 3D RESOURCES
              </a>
              , REPAINTED · NO ENDORSEMENT IMPLIED
            </span>
          </span>
        </div>
      </div>

      {/* The wordmark, set huge and sinking into the dark at the very bottom of the page. */}
      <p
        aria-hidden
        className="display pointer-events-none relative mt-10 select-none bg-gradient-to-b from-ink/25 via-ink/10 to-transparent bg-clip-text text-center whitespace-nowrap text-[clamp(3.6rem,16vw,15rem)] leading-[0.78] tracking-[0.02em] text-transparent"
      >
        STELLR
      </p>
    </footer>
  );
}
