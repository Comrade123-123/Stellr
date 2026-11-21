/** Where Stellr's pages are, shared by the landing page's header and footer. */

export interface NavTool {
  name: string;
  href: string;
  line: string;
  /** The tool's accent, for its dot. */
  color: string;
  group: "live" | "research";
  note?: string;
}

export const TOOLS: NavTool[] = [
  { name: "Cosmoscope", href: "/cosmoscope", line: "Every planet, moon and spacecraft, where it really is", color: "#c9a46a", group: "live" },
  { name: "Orbit Watch", href: "/orbit-watch", line: "Satellites and the ISS live, and when they pass over you", color: "#8fe3b0", group: "live" },
  { name: "Asteroid Sentinel", href: "/asteroid-sentinel", line: "Near-Earth asteroids on their real paths", color: "#ff8a4c", group: "live" },
  { name: "Sky Events", href: "/sky-events", line: "Eclipses, meteors, planets and launches for your sky", color: "#7fd4ff", group: "live" },
  { name: "Space Weather", href: "/space-weather", line: "Solar wind, storms and tonight's aurora odds", color: "#ffcf6b", group: "live" },
  { name: "Exoplanet Lab", href: "/exoplanet-lab", line: "Search real TESS starlight for other worlds", color: "#b9a2ff", group: "research" },
  { name: "Wobble", href: "/wobble", line: "Stellr's research agent and its notebook", color: "#eceef2", group: "research", note: "Private" },
];

/** Places on the landing page itself. */
export const SECTIONS: [string, string][] = [
  ["Your sky tonight", "#sky"],
  ["All tools", "#tools"],
  ["Roadmap", "#roadmap"],
];

export const GITHUB = "https://github.com/Comrade123-123/Stellr";
