import { connection } from "next/server";
import { readTable } from "@/lib/fits";
import { invoke, MAST } from "@/lib/mast";

/**
 * GET /api/exoplanets/lightcurve?obsid=… → one TESS sector's light curve: the pipeline's
 * cleaned flux (PDCSAP), good-quality points only, normalised to 1 and averaged into
 * 10-minute bins so a sector is a few thousand points rather than twenty thousand.
 * Times are BTJD (BJD − 2457000). Archived data never changes: a week's cache.
 */
export const maxDuration = 60;

const BIN_DAYS = 10 / 1440;

export async function GET(request: Request) {
  await connection();
  const obsid = new URL(request.url).searchParams.get("obsid") ?? "";
  if (!/^\d{1,15}$/.test(obsid)) return new Response("Bad observation id", { status: 400 });
  try {
    const products = await invoke({ service: "Mast.Caom.Products", params: { obsid } });
    const lc = products.find((p) => /_lc\.fits$/i.test(String(p.productFilename ?? "")) && String(p.productSubGroupDescription ?? "LC") === "LC")
      ?? products.find((p) => /lc\.fits$/i.test(String(p.productFilename ?? "")));
    if (!lc) throw new Error("no light-curve file for this observation");
    const res = await fetch(`${MAST}/api/v0.1/Download/file?uri=${encodeURIComponent(String(lc.dataURI))}`, {
      cache: "no-store",
      headers: { "User-Agent": "Stellr Exoplanet Lab" },
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) throw new Error(`MAST download ${res.status}`);
    const { columns, header } = readTable(await res.arrayBuffer(), ["TIME", "PDCSAP_FLUX", "QUALITY"]);
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
    return Response.json(
      { obsid, sector: header.get("SECTOR") ?? null, t, f },
      { headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[exoplanets] lightcurve", obsid, detail);
    return Response.json({ error: true, detail }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
