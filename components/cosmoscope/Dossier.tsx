"use client";

import Link from "next/link";
import PlacePicker, { usePlace } from "@/components/PlacePicker";
import { AU_KM, BODIES, CRAFT, MOONS, bodyInfo, type BodyName, type Distances, type Night } from "@/lib/cosmoscope";
import { PROFILES, type Feature } from "@/lib/cosmoscope-profiles";
import { AU_LIGHT_S, Thumb, auText, dayText, fmt, isBody, isMoon, kmText, lightTime, yearText } from "./ui";

type Away = { earthAu: number; sunAu: number } | null;

const Section = ({ eyebrow, title, children, id }: { eyebrow: string; title?: string; children: React.ReactNode; id?: string }) => (
  <section id={id} className="border-t border-ink/10 py-12 sm:py-16">
    <p className="font-mono text-[10px] tracking-[0.24em] text-gold">{eyebrow}</p>
    {title && <h3 className="display mt-3 text-[clamp(1.4rem,2.4vw,2rem)] text-ink">{title}</h3>}
    <div className="mt-8">{children}</div>
  </section>
);

const Row = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="flex items-baseline justify-between gap-6 border-b border-ink/10 py-3">
    <dt className="shrink-0 font-mono text-[10px] tracking-[0.18em] text-ink/45">{label}</dt>
    <dd className="text-right text-[14px] text-ink/90">
      {value}
      {sub && <span className="block text-[11px] text-ink/45">{sub}</span>}
    </dd>
  </div>
);

const massText = (earths: number) =>
  earths >= 1000 ? `${earths.toLocaleString("en")} × Earth` : earths >= 1 ? `${earths.toLocaleString("en", { maximumFractionDigits: 1 })} × Earth` : `${earths.toFixed(earths < 0.01 ? 4 : 3)} × Earth`;

/** Long-form profile under the 3D view: whatever is chosen, or the whole system when nothing is. */
export default function Dossier({
  selected,
  shown,
  dist,
  sky,
  placeState,
  isTonight,
  away,
  onSelect,
  onLook,
  trackNote,
  craftSpeed,
  rockName,
}: {
  selected: string | null;
  shown: number;
  dist: Distances | null;
  sky: Night | null;
  placeState: ReturnType<typeof usePlace>;
  isTonight: boolean;
  away: (key: string, t: number) => Away;
  onSelect: (id: string | null, scrollUp?: boolean) => void;
  onLook: (feature: Feature, body: BodyName) => void;
  trackNote: (name: string) => string | null;
  craftSpeed: number | null;
  rockName: string | null;
}) {
  const place = placeState.place;
  const tz = place?.timeZone;

  if (isBody(selected)) {
    const info = bodyInfo(selected);
    const p = PROFILES[selected];
    const moons = MOONS.filter((m) => m.parent === selected);
    return (
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <header className="grid gap-10 pb-12 pt-16 sm:pt-20 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="font-mono text-[10px] tracking-[0.24em] text-ink/50">PROFILE · {info.kind.toUpperCase()}</p>
            <h2 className="display mt-4 text-[clamp(2.6rem,7vw,6rem)] leading-[0.95] text-ink">{info.name}</h2>
            <p className="mt-5 max-w-[40ch] text-[clamp(1.05rem,1.6vw,1.35rem)] leading-snug text-ink/70">{p.tagline}.</p>
          </div>
          <div className="hidden lg:block">
            <Thumb name={selected} size={150} />
          </div>
        </header>

        {dist && (
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-ink/10 bg-ink/10 sm:grid-cols-4">
            {[
              ["RIGHT NOW · FROM EARTH", dist.earthAu === null ? "You are here" : kmText(dist.earthAu * AU_KM), dist.earthAu === null ? "" : auText(dist.earthAu)],
              ["LIGHT TIME TO EARTH", dist.lightS === null ? "—" : lightTime(dist.lightS), "how old the light you'd see is"],
              ["FROM THE SUN", dist.sunAu === null ? "—" : kmText(dist.sunAu * AU_KM), dist.sunAu === null ? "" : auText(dist.sunAu)],
              ["ON", shown ? fmt(shown, { day: "2-digit", month: "short", year: "numeric" }, "UTC") : "—", "the moment shown above"],
            ].map(([label, value, sub]) => (
              <div key={label} className="bg-void p-5">
                <p className="font-mono text-[9px] tracking-[0.2em] text-ink/45">{label}</p>
                <p className="mt-2 text-[17px] text-ink">{value}</p>
                {sub && <p className="mt-1 text-[11px] text-ink/45">{sub}</p>}
              </div>
            ))}
          </div>
        )}

        <Section eyebrow="OVERVIEW" title={`What ${info.name === "Sun" ? "the Sun" : info.name} is like`}>
          <div className="grid gap-12 lg:grid-cols-[1.35fr_1fr]">
            <div className="space-y-5 text-[16px] leading-relaxed text-ink/75">
              {p.overview.map((para) => (
                <p key={para.slice(0, 24)}>{para}</p>
              ))}
              <p className="text-[14px] leading-relaxed text-ink/55">
                <span className="text-ink/80">Inside: </span>
                {p.interior}
              </p>
            </div>
            <dl>
              <Row label="DIAMETER" value={`${info.diameterKm.toLocaleString("en")} km`} sub={info.name !== "Earth" ? `${(info.diameterKm / 12_756).toFixed(info.diameterKm < 12_756 ? 2 : 1)} × Earth` : undefined} />
              <Row label="MASS" value={massText(p.massEarths)} />
              <Row label="DENSITY" value={`${p.density} g/cm³`} sub={p.density < 1 ? "less than water" : undefined} />
              <Row label="GRAVITY" value={`${p.gravity.toFixed(p.gravity < 100 ? 1 : 0)} m/s²`} sub={`${(p.gravity / 9.81).toFixed(2)} × Earth's`} />
              <Row label="ESCAPE VELOCITY" value={`${p.escape} km/s`} />
              <Row label={info.name === "Sun" ? "ONE TURN" : "LENGTH OF A DAY"} value={dayText(info.dayHours)} sub={info.spinHours < 0 ? "spins backwards" : undefined} />
              {info.yearDays > 0 && <Row label="LENGTH OF A YEAR" value={yearText(info.yearDays)} />}
              {p.orbitMkm > 0 && <Row label="MEAN DISTANCE FROM THE SUN" value={`${p.orbitMkm.toLocaleString("en")} million km`} />}
              <Row label="AXIAL TILT" value={`${info.tilt}°`} />
              <Row label={info.name === "Sun" ? "SURFACE TEMPERATURE" : "MEAN TEMPERATURE"} value={`${info.tempC.toLocaleString("en")} °C`} sub={p.tempRange ? `${p.tempRange[0]} to ${p.tempRange[1]} °C` : undefined} />
              {info.name !== "Sun" && <Row label="KNOWN MOONS" value={info.moons} />}
              <Row label="ATMOSPHERE" value={p.atmosphere} />
              <Row label="SURFACE PRESSURE" value={p.pressure} />
            </dl>
          </div>
        </Section>

        <Section eyebrow="FEATURES" title="What to look for">
          <div className="grid gap-4 md:grid-cols-3">
            {p.features.map((f) => (
              <article key={f.title} className="flex flex-col rounded-2xl border border-ink/10 bg-ink/[0.025] p-6">
                <h4 className="text-[17px] text-ink">{f.title}</h4>
                <p className="mt-3 flex-1 text-[14px] leading-relaxed text-ink/65">{f.text}</p>
                {f.look && (
                  <button type="button" onClick={() => onLook(f, selected)} className="mt-5 self-start rounded-full border border-gold/50 px-4 py-2 font-mono text-[10px] tracking-[0.18em] text-gold transition-colors hover:bg-gold hover:text-void">
                    SEE IT IN 3D ↑
                  </button>
                )}
              </article>
            ))}
          </div>
        </Section>

        {moons.length > 0 && (
          <Section eyebrow={`MOONS · ${info.moons} KNOWN`} title={moons.length === 1 ? "Its moon" : `The ${moons.length} on the map`}>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {moons.map((m) => (
                <li key={m.name}>
                  <button type="button" onClick={() => onSelect(m.name, true)} className="group flex h-full w-full flex-col rounded-2xl border border-ink/10 p-5 text-left transition-colors hover:border-ink/30 hover:bg-ink/[0.03]">
                    <span className="flex items-center gap-3">
                      <Thumb name={m.name} size={34} />
                      <span>
                        <span className="block text-[16px] text-ink">{m.name}</span>
                        <span className="block font-mono text-[10px] tracking-[0.14em] text-ink/45">
                          {m.diameterKm.toLocaleString("en")} KM WIDE · {Math.abs(m.periodDays) < 2 ? `${(Math.abs(m.periodDays) * 24).toFixed(1)} H` : `${Math.abs(m.periodDays).toFixed(1)} D`} ORBIT
                        </span>
                      </span>
                    </span>
                    <span className="mt-3 block flex-1 text-[13px] leading-relaxed text-ink/60">{m.note}</span>
                    <span className="mt-4 font-mono text-[10px] tracking-[0.18em] text-ink/50 transition-colors group-hover:text-gold">FLY TO {m.name.toUpperCase()} ↑</span>
                  </button>
                </li>
              ))}
            </ul>
            {(selected === "Jupiter" || selected === "Saturn" || selected === "Uranus" || selected === "Neptune") && (
              <p className="mt-5 max-w-[70ch] text-[13px] leading-relaxed text-ink/45">
                The map shows the large, round moons. The rest, {info.moons} in all, are mostly small captured rocks a few kilometres across.
              </p>
            )}
          </Section>
        )}

        <Section eyebrow="EXPLORATION" title="Who has been there">
          <ol className="relative space-y-6 border-l border-ink/15 pl-6">
            {p.missions.map((m) => (
              <li key={m.name} className="relative">
                <span className="absolute -left-[29px] top-1.5 block h-2 w-2 rounded-full bg-gold" />
                <p className="font-mono text-[10px] tracking-[0.18em] text-ink/45">{m.when.toUpperCase()}</p>
                <p className="mt-1 text-[16px] text-ink">{m.name}</p>
                <p className="mt-1 max-w-[70ch] text-[14px] leading-relaxed text-ink/60">{m.what}</p>
              </li>
            ))}
          </ol>
        </Section>

        {sky && (
          <Section eyebrow="FROM WHERE YOU ARE" title="Can you see it?">
            <div className="grid gap-8 lg:grid-cols-[1.35fr_1fr]">
              <div>
                <p className="font-mono text-[10px] tracking-[0.18em] text-ink/45">
                  {isTonight ? "TONIGHT" : `THE NIGHT OF ${fmt(shown, { day: "2-digit", month: "short", year: "numeric" }, tz)}`} · {place?.name.toUpperCase()}
                </p>
                <p className="mt-3 text-[17px] leading-relaxed text-ink/85">
                  {sky.kind === "visible"
                    ? `Yes. It is up from ${fmt(sky.from.getTime(), { hour: "2-digit", minute: "2-digit" }, tz)} to ${fmt(sky.until.getTime(), { hour: "2-digit", minute: "2-digit" }, tz)}, best around ${fmt(sky.best.getTime(), { hour: "2-digit", minute: "2-digit" }, tz)}, ${Math.round(sky.altitude)}° above the horizon in the ${sky.direction}, at magnitude ${sky.magnitude.toFixed(1)}${sky.magnitude < 0 ? ": brighter than almost every star" : ""}.`
                    : sky.kind === "glare"
                      ? `No. It is only ${Math.round(sky.elongation)}° from the Sun in the sky, lost in its glare.`
                      : sky.kind === "below"
                        ? "No. It stays below the horizon all night from here."
                        : "No proper night at this latitude on this date: the Sun never sets far enough."}
                </p>
                {(selected === "Uranus" || selected === "Neptune" || selected === "Pluto") && sky.kind === "visible" && (
                  <p className="mt-2 text-[13px] text-ink/50">
                    {selected === "Uranus" ? "At the edge of naked-eye sight; binoculars help." : selected === "Pluto" ? "Far too faint for the eye: it takes a large telescope and a dark sky." : "Too faint for the eye; it needs a telescope."}
                  </p>
                )}
              </div>
              <div>
                <PlacePicker state={placeState} />
              </div>
            </div>
          </Section>
        )}
      </div>
    );
  }

  if (isMoon(selected)) {
    const m = MOONS.find((x) => x.name === selected)!;
    const d = shown ? away(m.name, shown) : null;
    const parent = bodyInfo(m.parent);
    return (
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <header className="flex flex-wrap items-end justify-between gap-8 pb-12 pt-16 sm:pt-20">
          <div>
            <button type="button" onClick={() => onSelect(m.parent, true)} className="font-mono text-[10px] tracking-[0.22em] text-gold hover:underline">
              ← {m.parent.toUpperCase()}
            </button>
            <h2 className="display mt-4 text-[clamp(2.6rem,7vw,6rem)] leading-[0.95] text-ink">{m.name}</h2>
            <p className="mt-4 font-mono text-[11px] tracking-[0.2em] text-ink/50">{m.name === "Moon" ? "EARTH'S MOON" : `MOON OF ${m.parent.toUpperCase()}`}</p>
          </div>
          <Thumb name={m.name} size={110} />
        </header>
        <div className="grid gap-12 border-t border-ink/10 py-12 lg:grid-cols-[1.35fr_1fr]">
          <p className="text-[clamp(1.05rem,1.6vw,1.3rem)] leading-relaxed text-ink/75">{m.note}</p>
          <dl>
            <Row label="DIAMETER" value={`${m.diameterKm.toLocaleString("en")} km`} sub={`${(m.diameterKm / 3475).toFixed(2)} × our Moon · ${((m.diameterKm / parent.diameterKm) * 100).toFixed(1)}% of ${m.parent}`} />
            <Row label={`DISTANCE FROM ${m.parent.toUpperCase()}`} value={`${m.distanceKm.toLocaleString("en")} km`} sub="on average" />
            <Row label="ONE ORBIT" value={dayText(Math.abs(m.periodDays) * 24)} sub={m.periodDays < 0 ? "backwards, against the planet's spin" : undefined} />
            {d && <Row label="FROM EARTH NOW" value={kmText(d.earthAu * AU_KM)} sub={`light takes ${lightTime(d.earthAu * AU_LIGHT_S)}`} />}
            <Row
              label="POSITION ON THE MAP"
              value={m.source === "exact" ? "Computed exactly" : m.source === "horizons" ? "From NASA JPL Horizons" : "Approximate"}
              sub={m.source === "mean" ? "its real orbit and period; the place along it is not measured" : trackNote(m.name) ?? undefined}
            />
          </dl>
        </div>
      </div>
    );
  }

  const craft = CRAFT.find((c) => c.name === selected);
  if (craft) {
    const d = shown ? away(craft.name, shown) : null;
    const note = trackNote(craft.name);
    return (
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <header className="pb-12 pt-16 sm:pt-20">
          <p className="font-mono text-[10px] tracking-[0.24em] text-ink/50">SPACECRAFT · LAUNCHED {fmt(Date.parse(`${craft.launched}T12:00:00Z`), { day: "2-digit", month: "short", year: "numeric" })}</p>
          <h2 className="display mt-4 text-[clamp(2.6rem,7vw,6rem)] leading-[0.95] text-ink">{craft.name}</h2>
        </header>
        <div className="grid gap-12 border-t border-ink/10 py-12 lg:grid-cols-[1.35fr_1fr]">
          <p className="text-[clamp(1.05rem,1.6vw,1.3rem)] leading-relaxed text-ink/75">{craft.note}</p>
          <dl>
            {d ? (
              <>
                <Row label="FROM EARTH" value={kmText(d.earthAu * AU_KM)} sub={`${auText(d.earthAu)} · a radio signal takes ${lightTime(d.earthAu * AU_LIGHT_S)}`} />
                <Row label="FROM THE SUN" value={kmText(d.sunAu * AU_KM)} sub={auText(d.sunAu)} />
                {craftSpeed !== null && <Row label="SPEED AROUND THE SUN" value={`${craftSpeed.toFixed(1)} km/s`} sub={`${Math.round(craftSpeed * 3600).toLocaleString("en")} km/h`} />}
              </>
            ) : (
              <p className="text-[14px] text-gold">{note}</p>
            )}
            <Row label="TRAJECTORY" value="NASA JPL Horizons" />
          </dl>
        </div>
      </div>
    );
  }

  if (selected === "asteroid" && rockName) {
    const d = shown ? away("asteroid", shown) : null;
    return (
      <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <header className="pb-12 pt-16 sm:pt-20">
          <p className="font-mono text-[10px] tracking-[0.24em] text-ink/50">ASTEROID · FROM ASTEROID SENTINEL</p>
          <h2 className="display mt-4 text-[clamp(2.2rem,6vw,5rem)] leading-[0.95] text-ink">{rockName}</h2>
        </header>
        <div className="grid gap-12 border-t border-ink/10 py-12 lg:grid-cols-[1.35fr_1fr]">
          <p className="text-[16px] leading-relaxed text-ink/70">
            Its orbit comes from JPL and is propagated in your browser: close to the truth for months around today, approximate decades away.{" "}
            <Link href="/asteroid-sentinel" className="text-gold hover:underline">
              Asteroid Sentinel
            </Link>{" "}
            has its close passes.
          </p>
          {d && (
            <dl>
              <Row label="FROM EARTH" value={kmText(d.earthAu * AU_KM)} sub={`${(d.earthAu * AU_KM / 384_400).toFixed(1)} × the Moon's distance`} />
              <Row label="FROM THE SUN" value={kmText(d.sunAu * AU_KM)} sub={auText(d.sunAu)} />
            </dl>
          )}
        </div>
      </div>
    );
  }

  // Nothing chosen: every world at a glance.
  return (
    <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
      <header className="pb-10 pt-16 sm:pt-20">
        <p className="font-mono text-[10px] tracking-[0.24em] text-ink/50">THE SOLAR SYSTEM</p>
        <h2 className="display mt-4 text-[clamp(2.2rem,5.5vw,4.6rem)] leading-[0.98] text-ink">One star, eight planets, and a heart of ice.</h2>
        <p className="mt-5 max-w-[60ch] text-[16px] leading-relaxed text-ink/60">Choose a world to fly to it and read its full profile: what it is like, what to look for, its moons, and who has been there.</p>
      </header>
      <ul className="grid gap-4 border-t border-ink/10 pt-10 sm:grid-cols-2 lg:grid-cols-5">
        {BODIES.map((b) => {
          const p = PROFILES[b.name];
          return (
            <li key={b.name}>
              <button type="button" onClick={() => onSelect(b.name, true)} className="group flex h-full w-full flex-col rounded-2xl border border-ink/10 p-5 text-left transition-colors hover:border-ink/30 hover:bg-ink/[0.03]">
                <Thumb name={b.name} size={52} />
                <span className="mt-5 text-[17px] text-ink">{b.name}</span>
                <span className="mt-1 font-mono text-[9px] tracking-[0.16em] text-ink/45">{b.kind.toUpperCase()}</span>
                <span className="mt-3 flex-1 text-[13px] leading-relaxed text-ink/55">{p.tagline}.</span>
                <span className="mt-4 font-mono text-[10px] tracking-[0.18em] text-ink/45 transition-colors group-hover:text-gold">EXPLORE ↑</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
