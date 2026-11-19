"use client";

import { useMemo, useState } from "react";
import { CRAFT, MOONS, helio, type BodyName } from "@/lib/cosmoscope";
import { Icon, Thumb, glass, isMoon } from "./ui";

const GROUPS: { title: string; items: BodyName[] }[] = [
  { title: "STAR", items: ["Sun"] },
  { title: "PLANETS", items: ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"] },
  { title: "DWARF PLANET", items: ["Pluto"] },
];

const au = (v: number) => (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v).toString());

/**
 * The left-hand navigator: every body with its distance from the Sun, the chosen planet's moons
 * opened beneath it, and the spacecraft. Folds down to a column of thumbnails.
 */
export default function Navigator({
  selected,
  onSelect,
  shown,
  craftSunAu,
}: {
  selected: string | null;
  onSelect: (id: string | null) => void;
  shown: number;
  /** Distance from the Sun of each spacecraft (AU), or a status word where there is none. */
  craftSunAu: (name: string) => number | string;
}) {
  const [folded, setFolded] = useState(false);
  // Distances move slowly: worked out once per day shown.
  const day = shown ? Math.floor(shown / 86_400_000) : 0;
  const sunAu = useMemo(() => {
    const out = new Map<string, number>();
    if (!day) return out;
    const date = new Date(day * 86_400_000);
    for (const g of GROUPS) for (const name of g.items) if (name !== "Sun") out.set(name, Math.hypot(...helio(name, date)));
    return out;
  }, [day]);
  const openPlanet = isMoon(selected) ? MOONS.find((m) => m.name === selected)!.parent : selected;
  const pick = (id: string) => onSelect(selected === id ? null : id);

  if (folded)
    return (
      <div className={`${glass} flex flex-col items-center gap-1 p-1.5`}>
        <button type="button" onClick={() => setFolded(false)} title="Open the navigator" className="flex h-9 w-9 items-center justify-center rounded-xl text-ink/60 transition-colors hover:bg-ink/10 hover:text-ink">
          <Icon name="up" className="h-3.5 w-3.5 rotate-90" />
        </button>
        {GROUPS.flatMap((g) => g.items).map((name) => (
          <button
            key={name}
            type="button"
            title={name}
            aria-label={name}
            onClick={() => pick(name)}
            className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${openPlanet === name ? "bg-ink/[0.12] ring-1 ring-gold/60" : "hover:bg-ink/[0.07]"}`}
          >
            <Thumb name={name} size={22} />
          </button>
        ))}
      </div>
    );

  return (
    <div className={`${glass} cosmo-scroll max-h-[calc(100svh-12rem)] w-[236px] overflow-y-auto`}>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink/[0.07] bg-[#07080b]/90 px-4 py-3 backdrop-blur-xl">
        <p className="font-mono text-[10px] tracking-[0.24em] text-ink/55">NAVIGATOR</p>
        <div className="flex items-center gap-1">
          <span className="font-mono text-[9px] tracking-[0.12em] text-ink/30">AU FROM SUN</span>
          <button type="button" onClick={() => setFolded(true)} title="Fold the navigator" className="ml-1 flex h-6 w-6 items-center justify-center rounded-md text-ink/50 transition-colors hover:bg-ink/10 hover:text-ink">
            <Icon name="up" className="h-3 w-3 -rotate-90" />
          </button>
        </div>
      </div>

      <div className="p-2">
        {GROUPS.map((g) => (
          <div key={g.title} className="mb-1.5">
            <p className="px-2.5 pb-1 pt-2 font-mono text-[9px] tracking-[0.22em] text-ink/30">{g.title}</p>
            {g.items.map((name) => {
              const on = openPlanet === name;
              const moons = MOONS.filter((m) => m.parent === name);
              return (
                <div key={name}>
                  <button
                    type="button"
                    onClick={() => pick(name)}
                    className={`group relative flex w-full items-center gap-3 rounded-xl px-2.5 py-[7px] text-left transition-colors ${on ? "bg-ink/[0.09]" : "hover:bg-ink/[0.05]"}`}
                  >
                    {on && <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-gold" />}
                    <Thumb name={name} size={24} />
                    <span className={`flex-1 text-[13px] ${on ? "text-ink" : "text-ink/75 group-hover:text-ink"}`}>{name}</span>
                    <span className="font-mono text-[10px] tabular-nums text-ink/35">{name === "Sun" ? "—" : sunAu.has(name) ? au(sunAu.get(name)!) : ""}</span>
                  </button>
                  {on && moons.length > 0 && (
                    <div className="mb-1 ml-[22px] border-l border-ink/10 py-0.5 pl-2">
                      {moons.map((m) => (
                        <button
                          key={m.name}
                          type="button"
                          onClick={() => onSelect(m.name)}
                          className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-[5px] text-left text-[12px] transition-colors ${selected === m.name ? "bg-ink/[0.09] text-ink" : "text-ink/55 hover:bg-ink/[0.05] hover:text-ink"}`}
                        >
                          <Thumb name={m.name} size={14} />
                          {m.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        <p className="px-2.5 pb-1 pt-2 font-mono text-[9px] tracking-[0.22em] text-ink/30">SPACECRAFT</p>
        {CRAFT.map((c) => {
          const d = craftSunAu(c.name);
          const on = selected === c.name;
          return (
            <button
              key={c.name}
              type="button"
              onClick={() => pick(c.name)}
              className={`group relative flex w-full items-center gap-3 rounded-xl px-2.5 py-[7px] text-left transition-colors ${on ? "bg-[#7fd4ff]/[0.1]" : "hover:bg-ink/[0.05]"}`}
            >
              {on && <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-[#7fd4ff]" />}
              <span className="flex h-6 w-6 items-center justify-center">
                <span className="block h-2 w-2 rotate-45 border border-[#7fd4ff] bg-[#7fd4ff]/30 shadow-[0_0_8px_#7fd4ff]" />
              </span>
              <span className={`flex-1 text-[13px] ${on ? "text-ink" : "text-ink/75 group-hover:text-ink"}`}>{c.name}</span>
              <span className="font-mono text-[10px] tabular-nums text-ink/35">{typeof d === "number" ? au(d) : d}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
