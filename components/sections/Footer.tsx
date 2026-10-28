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
      ["WOBBLE · BY INVITATION", "/wobble"],
    ],
  },
  {
    title: "STELLR",
    links: [
      ["ROADMAP", "#roadmap"],
      ["JOIN THE WAITLIST", "#waitlist"],
      ["BACK TO TOP", "#top"],
    ],
  },
];

const linkClass = "text-ink/80 transition-colors hover:text-gold";

export default function Footer() {
  return (
    <footer className="relative border-t border-ink/10 bg-void px-5 pb-10 pt-16 font-mono text-[11px] tracking-[0.15em] sm:px-10">
      <div className="mx-auto grid max-w-[1100px] gap-10 sm:grid-cols-3">
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <p className="text-ink/40">{col.title}</p>
            <ul className="mt-4 space-y-3">
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

      <div className="mx-auto mt-16 flex max-w-[1100px] flex-col gap-3 border-t border-ink/10 pt-6 text-ink/40 sm:flex-row sm:justify-between">
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
    </footer>
  );
}
