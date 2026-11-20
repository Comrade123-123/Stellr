import { readTable } from "./fits";

/**
 * A TESS light-curve file turned into what Stellr searches: good-quality points only,
 * normalised to 1 and averaged into 10-minute bins (longer cadences pass through as they are).
 * Times are BTJD (BJD − 2457000). Shared by /api/exoplanets/lightcurve and the Wobble agent.
 *
 * Reads the mission's own 2-minute and 20-second light curves (SPOC) and the full-frame-image
 * ones (TESS-SPOC, both with PDCSAP_FLUX) and MIT's Quick-Look Pipeline (QLP, KSPSAP_FLUX).
 * Where the file has the star's flux-weighted centroid (MOM_CENTR1/2, or QLP's SAP_X/Y), it
 * comes along as `cx` and `cy`, in pixels from its median: a dip that moves the light's centre
 * may come from a neighbouring star rather than the target.
 */
const BIN_DAYS = 10 / 1440;

export interface FileCurve {
  t: number[];
  f: number[];
  cx?: number[];
  cy?: number[];
}

const FLUX = ["PDCSAP_FLUX", "KSPSAP_FLUX", "SAP_FLUX"];
const CENTROID: [string, string][] = [
  ["MOM_CENTR1", "MOM_CENTR2"],
  ["SAP_X", "SAP_Y"],
];

function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  return s[s.length >> 1];
}

export function lightCurveFromFits(buffer: ArrayBuffer): FileCurve {
  const { columns, names } = readTable(buffer, ["TIME", "QUALITY"], [...FLUX, ...CENTROID.flat()]);
  const fluxName = FLUX.find((n) => columns[n]);
  if (!fluxName) throw new Error(`FITS: no flux column (has ${names.slice(0, 12).join(", ")})`);
  const { TIME: time, QUALITY: quality } = columns;
  const flux = columns[fluxName];
  const pair = CENTROID.find(([a, b]) => columns[a] && columns[b]);
  const c1 = pair ? columns[pair[0]] : null;
  const c2 = pair ? columns[pair[1]] : null;

  const good: number[] = [];
  for (let i = 0; i < time.length; i++) {
    if (quality[i] !== 0 || !Number.isFinite(time[i]) || !Number.isFinite(flux[i]) || flux[i] <= 0) continue;
    if (c1 && c2 && !(Number.isFinite(c1[i]) && Number.isFinite(c2[i]))) continue;
    good.push(i);
  }
  if (good.length < 100) throw new Error("too few good points");
  const med = median(good.map((i) => flux[i]));
  const mx = c1 ? median(good.map((i) => c1[i])) : 0;
  const my = c2 ? median(good.map((i) => c2[i])) : 0;

  const t: number[] = [];
  const f: number[] = [];
  const cx: number[] = [];
  const cy: number[] = [];
  let binStart = time[good[0]];
  let st = 0;
  let sf = 0;
  let sx = 0;
  let sy = 0;
  let k = 0;
  const flush = () => {
    if (k) {
      t.push(Math.round((st / k) * 1e5) / 1e5);
      f.push(Math.round((sf / k / med) * 1e6) / 1e6);
      if (c1) {
        cx.push(Math.round((sx / k - mx) * 1e5) / 1e5);
        cy.push(Math.round((sy / k - my) * 1e5) / 1e5);
      }
    }
    st = sf = sx = sy = k = 0;
  };
  for (const i of good) {
    if (time[i] - binStart >= BIN_DAYS) {
      flush();
      binStart = time[i];
    }
    st += time[i];
    sf += flux[i];
    if (c1 && c2) {
      sx += c1[i];
      sy += c2[i];
    }
    k++;
  }
  flush();
  return c1 ? { t, f, cx, cy } : { t, f };
}
