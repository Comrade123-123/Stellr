import { connection } from "next/server";
import { invoke } from "@/lib/mast";

/**
 * GET /api/exoplanets/sectors?tic=261136679 → the TESS sectors with a light curve for this
 * star: for each, the observation to fetch, preferring the mission's own 2-minute pipeline
 * (SPOC) and falling back to its full-frame-image light curves (TESS-SPOC). A day's cache:
 * new sectors arrive about monthly.
 */
export async function GET(request: Request) {
  await connection();
  const tic = new URL(request.url).searchParams.get("tic")?.replace(/^TIC\s*/i, "").trim() ?? "";
  if (!/^\d{1,12}$/.test(tic)) return new Response("Bad TIC number", { status: 400 });
  try {
    const rows = await invoke({
      service: "Mast.Caom.Filtered",
      params: {
        columns: "obsid,obs_id,sequence_number,provenance_name,t_exptime,target_name",
        filters: [
          { paramName: "obs_collection", values: ["TESS"] },
          { paramName: "dataproduct_type", values: ["timeseries"] },
          { paramName: "target_name", values: [String(Number(tic))] },
        ],
      },
    });
    const rank = (r: Record<string, unknown>) => {
      const p = String(r.provenance_name ?? "");
      const exp = Number(r.t_exptime);
      if (p === "SPOC") return exp === 120 ? 0 : exp === 20 ? 1 : 2;
      return p === "TESS-SPOC" ? 3 : 9;
    };
    const best = new Map<number, Record<string, unknown>>();
    for (const r of rows) {
      const sector = Number(r.sequence_number);
      if (!Number.isFinite(sector) || rank(r) > 3) continue;
      const have = best.get(sector);
      if (!have || rank(r) < rank(have)) best.set(sector, r);
    }
    const sectors = [...best.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([sector, r]) => ({ sector, obsid: String(r.obsid), cadence: Number(r.t_exptime), pipeline: String(r.provenance_name) }));
    return Response.json({ tic, sectors }, { headers: { "Cache-Control": "public, max-age=21600, s-maxage=86400, stale-while-revalidate=86400" } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[exoplanets] sectors", tic, detail);
    return Response.json({ error: true, detail }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
