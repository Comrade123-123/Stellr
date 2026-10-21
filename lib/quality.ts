export type Tier = "high" | "medium" | "low";

export interface Quality {
  tier: Tier;
  reducedMotion: boolean;
  isMobile: boolean;
  dpr: [number, number];
  postprocessing: boolean;
  multisampling: number;
  starCount: number;
  /** Particles in the launch plume (smoke column + ground cloud). */
  plumeCount: number;
  /** Particles drawing the ground at the launch site. */
  groundCount: number;
  sphereSegments: number;
}

const PRESETS: Record<Tier, Omit<Quality, "tier" | "reducedMotion" | "isMobile">> = {
  high: { dpr: [1, 1.75], postprocessing: true, multisampling: 4, starCount: 9000, plumeCount: 110000, groundCount: 60000, sphereSegments: 128 },
  medium: { dpr: [1, 1.5], postprocessing: true, multisampling: 0, starCount: 5000, plumeCount: 64000, groundCount: 36000, sphereSegments: 96 },
  low: { dpr: [1, 1.25], postprocessing: false, multisampling: 0, starCount: 2500, plumeCount: 26000, groundCount: 14000, sphereSegments: 64 },
};

const SOFTWARE_GPU = /swiftshader|llvmpipe|software|basic render|mali-4|adreno \(tm\) [1-4]\d\d/i;
// Integrated laptop GPUs (AMD APUs report a bare "Radeon(TM) Graphics"; Intel UHD/Iris)
// fault on multisampled post-processing, so they top out at the medium tier.
const INTEGRATED_GPU = /radeon\(tm\) graphics|radeon graphics|intel|uhd|iris/i;

function gpuName(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return "";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return String(name ?? "");
  } catch {
    return "";
  }
}

let cached: Quality | null = null;

/** Picks a render tier once per page load from cheap device signals. */
export function getQuality(): Quality {
  if (cached) return cached;
  if (typeof window === "undefined") {
    return { tier: "medium", reducedMotion: false, isMobile: false, ...PRESETS.medium };
  }

  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isMobile = matchMedia("(pointer: coarse)").matches || innerWidth < 768;
  const cores = nav.hardwareConcurrency ?? 4;
  const memory = nav.deviceMemory ?? 8;
  const saveData = nav.connection?.saveData ?? false;
  const gpu = gpuName();

  let tier: Tier = "high";
  if (isMobile || cores <= 4 || memory <= 4 || INTEGRATED_GPU.test(gpu)) tier = "medium";
  if (
    reducedMotion ||
    saveData ||
    cores <= 2 ||
    memory <= 2 ||
    SOFTWARE_GPU.test(gpu) ||
    (isMobile && (cores <= 4 || memory <= 3))
  ) {
    tier = "low";
  }

  const params = new URLSearchParams(location.search).get("quality");
  if (params === "high" || params === "medium" || params === "low") tier = params;

  cached = { tier, reducedMotion, isMobile, ...PRESETS[tier] };
  return cached;
}
