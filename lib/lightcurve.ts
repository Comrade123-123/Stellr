import { readTable } from "./fits";

/**
 * A TESS light-curve file turned into what Stellr searches: the pipeline's cleaned flux
 * (PDCSAP), good-quality points only, normalised to 1 and averaged into 10-minute bins.
 * Times are BTJD (BJD − 2457000). Shared by /api/exoplanets/lightcurve and the Wobble agent.
 */
const BIN_DAYS = 10 / 1440;

export function lightCurveFromFits(buffer: ArrayBuffer) {
  const { columns } = readTable(buffer, ["TIME", "PDCSAP_FLUX", "QUALITY"]);
  const { TIME: time, PDCSAP_FLUX: flux, QUALITY: quality } = columns;
  const good: number[] = [];
  for (let i = 0; i < time.length; i++) if (quality[i] === 0 && Number.isFinite(time[i]) && Number.isFinite(flux[i]) && flux[i] > 0) good.push(i);
  if (good.length < 100) throw new Error("too few good points");
  const sorted = good.map((i) => flux[i]).sort((a, b) => a - b);
  const med = sorted[sorted.length >> 1];

  const t: number[] = [];
  const f: number[] = [];
  let binStart = time[good[0]];
  let st = 0;
  let sf = 0;
  let k = 0;
  const flush = () => {
    if (k) {
      t.push(Math.round((st / k) * 1e5) / 1e5);
      f.push(Math.round((sf / k / med) * 1e6) / 1e6);
    }
    st = sf = k = 0;
  };
  for (const i of good) {
    if (time[i] - binStart >= BIN_DAYS) {
      flush();
      binStart = time[i];
    }
    st += time[i];
    sf += flux[i];
    k++;
  }
  flush();
  return { t, f };
}
