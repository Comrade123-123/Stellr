/**
 * Server-side access to MAST, the Mikulski Archive for Space Telescopes, where TESS data
 * lives (https://mast.stsci.edu/api/v0/). Requests go to its `invoke` endpoint as a JSON
 * "request" form field. MAST_BASE exists only so tests can point this at a local stand-in.
 */
export const MAST = process.env.MAST_BASE ?? "https://mast.stsci.edu";

export async function invoke(request: Record<string, unknown>, timeoutMs = 25_000): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${MAST}/api/v0/invoke`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": "Stellr Exoplanet Lab" },
    body: `request=${encodeURIComponent(JSON.stringify({ format: "json", pagesize: 2000, ...request }))}`,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`MAST ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = (await res.json()) as { status?: string; msg?: string; data?: Record<string, unknown>[] };
  if (data.status && data.status !== "COMPLETE") throw new Error(`MAST ${data.status}: ${String(data.msg ?? "").slice(0, 160)}`);
  return Array.isArray(data.data) ? data.data : [];
}

export interface Sector {
  sector: number;
  obsid: string;
  cadence: number;
  pipeline: string;
}

/** Light-curve pipelines Stellr reads, best first: the mission's 2-minute and 20-second light curves, then two full-frame-image pipelines. */
const PIPELINES = ["SPOC", "TESS-SPOC", "QLP"] as const;

/**
 * The TESS sectors with a light curve for a star: for each, the observation to fetch,
 * preferring the mission's own 2-minute pipeline (SPOC), then its full-frame-image light
 * curves (TESS-SPOC), then MIT's Quick-Look Pipeline (QLP). The full-frame ones are high-level
 * science products (MAST's HLSP collection), and cover far more stars and sectors than SPOC.
 */
export async function tessSectors(tic: string, timeoutMs?: number): Promise<Sector[]> {
  const rows = await invoke(
    {
      service: "Mast.Caom.Filtered",
      params: {
        columns: "obsid,obs_id,sequence_number,provenance_name,t_exptime,target_name",
        filters: [
          { paramName: "obs_collection", values: ["TESS", "HLSP"] },
          { paramName: "dataproduct_type", values: ["timeseries"] },
          { paramName: "provenance_name", values: [...PIPELINES] },
          { paramName: "target_name", values: [String(Number(tic))] },
        ],
      },
    },
    timeoutMs,
  );
  const rank = (r: Record<string, unknown>) => {
    const p = String(r.provenance_name ?? "");
    const exp = Number(r.t_exptime);
    if (p === "SPOC") return exp === 120 ? 0 : exp === 20 ? 1 : 2;
    if (p === "TESS-SPOC") return 3;
    return p === "QLP" ? 4 : 9;
  };
  const best = new Map<number, Record<string, unknown>>();
  for (const r of rows) {
    const sector = Number(r.sequence_number);
    // Multi-sector validation reports (an obs_id spanning sectors, e.g. "-s0014-s0086-") carry no light curve.
    if (!Number.isFinite(sector) || rank(r) > 4 || /-s\d{4}-s\d{4}-/.test(String(r.obs_id ?? ""))) continue;
    const have = best.get(sector);
    if (!have || rank(r) < rank(have)) best.set(sector, r);
  }
  return [...best.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([sector, r]) => ({ sector, obsid: String(r.obsid), cadence: Number(r.t_exptime), pipeline: String(r.provenance_name) }));
}

/** One observation's light-curve file, downloaded from MAST. */
export async function lightCurveFile(obsid: string, agent = "Stellr Exoplanet Lab"): Promise<ArrayBuffer> {
  // MAST can take twenty seconds or more to list an observation's files.
  const products = await invoke({ service: "Mast.Caom.Products", params: { obsid } }, 55_000);
  const lc =
    products.find((p) => /_lc\.fits$/i.test(String(p.productFilename ?? "")) && String(p.productSubGroupDescription ?? "LC") === "LC") ??
    products.find((p) => /lc\.fits$/i.test(String(p.productFilename ?? "")));
  if (!lc) {
    const names = products.map((p) => String(p.productFilename ?? "")).filter(Boolean);
    throw new Error(`no light-curve file for this observation (${names.length} products${names.length ? `: ${names.slice(0, 3).join(", ")}` : ""})`);
  }
  const res = await fetch(`${MAST}/api/v0.1/Download/file?uri=${encodeURIComponent(String(lc.dataURI))}`, {
    cache: "no-store",
    headers: { "User-Agent": agent },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`MAST download ${res.status}`);
  return res.arrayBuffer();
}

export interface TicStar {
  /** Solar radii. */
  radius: number | null;
  /** Kelvin. */
  teff: number | null;
  logg: number | null;
  /** Solar masses. */
  mass: number | null;
  /** TESS-band magnitude. */
  tmag: number | null;
  /** Parsecs. */
  distance: number | null;
}

/** A star's entry in the TESS Input Catalog, or null if it has none. */
export async function ticStar(tic: string): Promise<TicStar | null> {
  const rows = await invoke({
    service: "Mast.Catalogs.Filtered.Tic",
    params: { columns: "ID,Teff,logg,rad,mass,Tmag,d", filters: [{ paramName: "ID", values: [String(Number(tic))] }] },
  }, 45_000);
  const r = rows[0];
  if (!r) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return { radius: num(r.rad), teff: num(r.Teff), logg: num(r.logg), mass: num(r.mass), tmag: num(r.Tmag), distance: num(r.d) };
}
