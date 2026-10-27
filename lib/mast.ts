/**
 * Server-side access to MAST, the Mikulski Archive for Space Telescopes, where TESS data
 * lives (https://mast.stsci.edu/api/v0/). Requests go to its `invoke` endpoint as a JSON
 * "request" form field. MAST_BASE exists only so tests can point this at a local stand-in.
 */
export const MAST = process.env.MAST_BASE ?? "https://mast.stsci.edu";

export async function invoke(request: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${MAST}/api/v0/invoke`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": "Stellr Exoplanet Lab" },
    body: `request=${encodeURIComponent(JSON.stringify({ format: "json", pagesize: 2000, ...request }))}`,
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`MAST ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = (await res.json()) as { status?: string; msg?: string; data?: Record<string, unknown>[] };
  if (data.status && data.status !== "COMPLETE") throw new Error(`MAST ${data.status}: ${String(data.msg ?? "").slice(0, 160)}`);
  return Array.isArray(data.data) ? data.data : [];
}
