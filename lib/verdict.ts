import { EARTH_PER_SUN, MAX_PLANET_RADIUS, longestTransit, relation, type BlsResult, type Checks } from "./exoplanets";

/**
 * What a transit signal most likely is, by the checks Stellr can run: shared by Exoplanet Lab
 * in the browser and the Wobble agent in GitHub Actions, so both judge alike. Never "confirmed":
 * at best a known planet recovered, or an unvetted candidate.
 */

/** A TESS Object of Interest on the target star, with the follow-up team's verdict. */
export interface Toi {
  toi: string;
  disposition: string;
  period: number | null;
  depthPpm: number | null;
  durationH: number | null;
}


export const DISPOSITIONS: Record<string, string> = {
  CP: "confirmed planet",
  KP: "known planet",
  PC: "planet candidate",
  APC: "ambiguous planet candidate",
  FP: "false positive",
  FA: "false alarm",
};

/** Thresholds for calling a peak a detection (common in TESS searches). */
export const MIN_SDE = 9;
export const MIN_SNR = 7;
/** Below this ML score a signal that passes the checks is only a weak candidate. */
export const WEAK_SCORE = 0.2;

/** What a signal most likely is, by the checks this lab can run. Never "confirmed". */
export function verdict(s: { result: BlsResult | null; checks: Checks | null }, known: { name: string; period: number | null }[], tois: Toi[] = [], starRadius: number | null = null, score: number | null = null) {
  const r = s.result;
  const c = s.checks;
  if (!r || !c || r.sde < MIN_SDE || r.snr < MIN_SNR) {
    return { kind: "none" as const, title: "NO SIGNIFICANT SIGNAL", notes: [`The strongest peak (SDE ${r ? r.sde.toFixed(1) : "—"}, SNR ${r ? r.snr.toFixed(1) : "—"}) is below the usual detection bar of SDE ${MIN_SDE} and SNR ${MIN_SNR}.`] };
  }
  for (const k of known) {
    if (!k.period) continue;
    const rel = relation(r.period, k.period);
    if (rel === "same period") return { kind: "known" as const, title: `KNOWN PLANET RECOVERED · ${k.name.toUpperCase()}`, notes: [`Same period as ${k.name} (${k.period.toFixed(4)} d) in the NASA Exoplanet Archive.`] };
    if (rel) return { kind: "alias" as const, title: `RELATED TO ${k.name.toUpperCase()}`, notes: [`At ${rel} of ${k.name}: most likely the same planet, seen at a multiple of its period.`] };
  }
  const notes: string[] = [];
  const toi = tois.find((x) => x.period && relation(r.period, x.period) === "same period");
  if (toi && (toi.disposition === "CP" || toi.disposition === "KP")) {
    return { kind: "known" as const, title: `KNOWN PLANET RECOVERED · TOI-${toi.toi}`, notes: [`Same period as TOI-${toi.toi}, which the TESS follow-up team lists as a ${DISPOSITIONS[toi.disposition]}.`] };
  }
  if (toi && (toi.disposition === "FP" || toi.disposition === "FA")) notes.push(`The TESS follow-up team has already ruled this signal out: TOI-${toi.toi}, a ${DISPOSITIONS[toi.disposition]}.`);
  const oe = Math.abs(c.odd.depth - c.even.depth) / Math.hypot(c.odd.err, c.even.err);
  if (c.odd.n && c.even.n && oe > 3) notes.push("Odd and even transits differ in depth: the mark of an eclipsing binary star at half its true period.");
  if (c.secondary.n && c.secondary.depth / c.secondary.err > 3) notes.push("A dip half an orbit later (a secondary eclipse): a glowing companion star, not a planet.");
  if (r.depth > 0.03) notes.push("Over 3% deep: more likely a small star than a planet.");
  if (c.shape.core > 0 && c.shape.edge < 0.5 * c.shape.core && (c.shape.core - c.shape.edge) / c.shape.err > 3)
    notes.push("V-shaped rather than flat-bottomed: typical of two stars grazing each other.");
  if (starRadius) {
    const longest = longestTransit(r.period, starRadius);
    if (r.duration > 1.5 * longest) notes.push(`Lasts ${r.duration.toFixed(1)} h, longer than a planet's transit can across this star (about ${longest.toFixed(1)} h at most).`);
    if (Math.sqrt(r.depth) * starRadius * EARTH_PER_SUN > MAX_PLANET_RADIUS) notes.push("Too large for a planet: over twice Jupiter's size for this star.");
  }
  if (c.variability.amplitude > Math.max(0.5 * r.depth, c.variability.noise))
    notes.push("The star brightens and dims on this same period away from the dip too: more like spots, pulsation or a close binary star than a transit.");
  if (r.transits < 3) notes.push("Fewer than three transits: the period is uncertain.");
  if (notes.length) return { kind: "doubt" as const, title: "SIGNAL · PROBABLY NOT A PLANET", notes };
  if (toi) {
    return {
      kind: "toi" as const,
      title: `ALREADY UNDER STUDY · TOI-${toi.toi}`,
      notes: [`The TESS team flagged this same signal as TOI-${toi.toi}, now a ${DISPOSITIONS[toi.disposition] ?? (toi.disposition || "signal under review")}. Follow-up observations decide whether it is a planet.`],
    };
  }
  // Passing every check yet unlike the planets the ML vetter learned from: worth less attention.
  if (score !== null && score < WEAK_SCORE) {
    return {
      kind: "weak" as const,
      title: "WEAK CANDIDATE · UNVETTED",
      notes: [`Passes the checks Stellr runs, but the ML vetter scores it only ${Math.round(score * 100)}% planet-like: most signals like this, in the Kepler and TESS records, were not planets.`],
    };
  }
  return {
    kind: "candidate" as const,
    title: "STELLR CANDIDATE · UNVETTED",
    notes: ["Passes the checks this lab runs, and matches no known planet of this star. That makes it a candidate, not a planet: confirming one needs follow-up this lab can't do yet (pixel-level checks for nearby stars, spectra of the star's wobble)."],
  };
}

