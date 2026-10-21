"use client";

import { useEffect, useRef } from "react";

let texture: Promise<ImageData> | null = null;

/** Lunar surface map, decoded once and shared by every MoonSphere on the page. */
function loadTexture() {
  texture ??= new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, c.width, c.height));
    };
    img.onerror = reject;
    img.src = "/textures/1k_moon.jpg";
  });
  return texture;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface MoonSphereProps {
  /** Sun–Moon elongation in degrees: 0 new, 90 first quarter, 180 full. */
  phaseAngle: number;
  /** Southern-hemisphere observers see the Moon rotated 180°. */
  southern?: boolean;
  size?: number;
}

/**
 * The Moon as a lit sphere, shaded per pixel on a 2D canvas (no WebGL, so it
 * also works in the no-WebGL fallback): real surface texture, a terminator
 * placed by the actual phase, limb darkening and faint earthshine.
 */
export default function MoonSphere({ phaseAngle, southern = false, size = 168 }: MoonSphereProps) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadTexture()
      .then((tex) => {
        const el = canvas.current;
        if (cancelled || !el) return;
        const px = Math.round(size * Math.min(2, window.devicePixelRatio || 1));
        el.width = px;
        el.height = px;
        const ctx = el.getContext("2d")!;
        const out = ctx.createImageData(px, px);

        // Light comes from the Sun: behind the Moon at new, from the viewer at full,
        // from the right while waxing.
        const p = (phaseAngle * Math.PI) / 180;
        const lx = Math.sin(p);
        const lz = -Math.cos(p);
        const { width: tw, height: th, data: td } = tex;
        const r = px / 2;

        for (let j = 0; j < px; j++) {
          for (let i = 0; i < px; i++) {
            const x = (i + 0.5 - r) / r;
            const y = (r - (j + 0.5)) / r;
            const d = Math.hypot(x, y);
            if (d > 1) continue;
            const z = Math.sqrt(1 - d * d);

            const lon = Math.atan2(x, z);
            const lat = Math.asin(y);
            const u = Math.min(tw - 1, ((0.5 + lon / (2 * Math.PI)) * tw) | 0);
            const v = Math.min(th - 1, ((0.5 - lat / Math.PI) * th) | 0);
            const ti = (v * tw + u) * 4;

            const ndl = x * lx + z * lz;
            const day = smoothstep(-0.05, 0.14, ndl);
            const light = day * (0.32 + 0.8 * Math.sqrt(Math.max(ndl, 0))) * (0.82 + 0.18 * z) + 0.045;
            // Cool rim on the night side so the full disc still reads as a sphere.
            const rim = (1 - day) * Math.pow(1 - z, 3) * 38;

            const o = (j * px + i) * 4;
            out.data[o] = Math.min(255, td[ti] * light * 1.12 + rim * 0.75);
            out.data[o + 1] = Math.min(255, td[ti + 1] * light * 1.12 + rim * 0.85);
            out.data[o + 2] = Math.min(255, td[ti + 2] * light * 1.12 + rim);
            out.data[o + 3] = Math.round(255 * Math.min(1, (1 - d) * r)); // anti-aliased edge
          }
        }
        ctx.putImageData(out, 0, 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [phaseAngle, size]);

  return (
    <canvas
      ref={canvas}
      aria-hidden
      className="moon-sphere block shrink-0"
      style={{ width: size, height: size, transform: southern ? "rotate(180deg)" : undefined }}
    />
  );
}
