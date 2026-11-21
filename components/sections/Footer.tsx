import ScrambleText from "@/components/ui/ScrambleText";
import { GITHUB, SECTIONS, TOOLS } from "@/lib/nav";

const SOURCES: [string, string][] = [
  ["NASA JPL", "https://ssd.jpl.nasa.gov"],
  ["NOAA SWPC", "https://www.swpc.noaa.gov"],
  ["CelesTrak", "https://celestrak.org"],
  ["MAST · TESS", "https://mast.stsci.edu"],
  ["NASA Exoplanet Archive", "https://exoplanetarchive.ipac.caltech.edu"],
  ["The Space Devs", "https://thespacedevs.com"],
];

const COLUMNS: { title: string; links: { label: string; href: string; note?: string; external?: boolean }[] }[] = [
  { title: "Live tools", links: TOOLS.filter((t) => t.group === "live").map((t) => ({ label: t.name, href: t.href })) },
  { title: "Research", links: TOOLS.filter((t) => t.group === "research").map((t) => ({ label: t.name, href: t.href, note: t.note })) },
  {
    title: "Explore",
    links: [
      ...SECTIONS.map(([label, href]) => ({ label, href })),
      { label: "Back to top", href: "#top" },
    ],
  },
  {
    title: "Stellr",
    links: [
      { label: "Your account", href: "/account" },
      { label: "Source on GitHub", href: GITHUB, external: true },
      { label: "Report a problem", href: `${GITHUB}/issues`, external: true },
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
];

const link = "text-ink/70 transition-colors hover:text-gold";

export default function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-ink/10 bg-void px-5 pt-20 sm:px-10">
      {/* A thin gold horizon along the top edge, echoing the sunrise in the hero. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-40 w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold/10 blur-3xl" />

      <div className="relative mx-auto max-w-[1180px]">
        {/* Who we are, and the way in. */}
        <div className="grid gap-10 border-b border-ink/10 pb-14 lg:grid-cols-[1.2fr_1fr] lg:items-end">
          <div>
            <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] text-ink/50">
              <span className="live-dot block h-1.5 w-1.5 rounded-full bg-gold" />
              ALL TOOLS LIVE · FREE · NO INSTALL
            </p>
            <p className="display mt-5 max-w-[22ch] text-[clamp(1.5rem,2.8vw,2.4rem)] leading-tight text-ink">From your backyard to the edge of the observable universe.</p>
            <p className="mt-4 max-w-[52ch] text-[14px] leading-relaxed text-ink/55">
              Stellr turns open data from NASA, NOAA and the TESS mission into tools anyone can use in a browser: where things are in the sky, what&apos;s coming, and a lab for
              searching starlight for new worlds.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 lg:justify-end">
            <a href="/cosmoscope" className="rounded-full bg-ink px-5 py-3 text-[13px] font-semibold text-void transition-colors hover:bg-gold">
              <ScrambleText text="Open Cosmoscope" />
            </a>
            <a href="/exoplanet-lab" className="rounded-full border border-ink/25 px-5 py-3 text-[13px] text-ink transition-colors hover:border-ink">
              <ScrambleText text="Try Exoplanet Lab" />
            </a>
          </div>
        </div>

        {/* Every page. */}
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-10 py-14 md:grid-cols-4">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="font-mono text-[10px] tracking-[0.22em] text-ink/40">{col.title.toUpperCase()}</p>
              <ul className="mt-5 space-y-3 text-[14px]">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a href={l.href} className={link} {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}>
                      {l.label}
                      {l.note && <span className="ml-2 rounded-full border border-ink/15 px-1.5 py-px font-mono text-[8px] tracking-[0.16em] text-ink/45">{l.note.toUpperCase()}</span>}
                      {l.external && <span className="ml-1 text-ink/35">↗</span>}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Where the data comes from. */}
        <div className="flex flex-wrap items-center gap-2 border-t border-ink/10 py-6">
          <span className="mr-1 font-mono text-[10px] tracking-[0.2em] text-ink/45">DATA FROM</span>
          {SOURCES.map(([name, href]) => (
            <a key={name} href={href} target="_blank" rel="noreferrer" className="rounded-full border border-ink/12 px-3 py-1 text-[12px] text-ink/60 transition-colors hover:border-ink/40 hover:text-ink">
              {name}
            </a>
          ))}
        </div>

        <div className="grid gap-4 border-t border-ink/10 py-6 text-[12px] leading-relaxed text-ink/40 md:grid-cols-[auto_1fr] md:gap-10">
          <span>© 2026 Stellr</span>
          <div className="space-y-1.5 md:text-right">
            <p>
              Planet and star textures by{" "}
              <a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noreferrer" className={link}>
                Solar System Scope
              </a>{" "}
              (
              <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer" className={link}>
                CC BY 4.0
              </a>
              ). Saturn V model by{" "}
              <a href="https://science.nasa.gov/3d-resources/" target="_blank" rel="noreferrer" className={link}>
                NASA 3D Resources
              </a>
              , repainted.
            </p>
            <p>Plate boundaries: Bird (2003), via Nordpil (ODC-By). Stellr is independent and not endorsed by NASA, NOAA or any agency whose data it uses.</p>
          </div>
        </div>
      </div>

      {/* The wordmark, set huge and sinking into the dark at the very bottom of the page. */}
      <p
        aria-hidden
        className="display pointer-events-none relative mt-6 select-none whitespace-nowrap bg-gradient-to-b from-ink/25 via-ink/10 to-transparent bg-clip-text text-center text-[clamp(3.6rem,16vw,15rem)] leading-[0.78] tracking-[0.02em] text-transparent"
      >
        STELLR
      </p>
    </footer>
  );
}
