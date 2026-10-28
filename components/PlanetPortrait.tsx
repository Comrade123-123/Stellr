"use client";

import { useEffect, useMemo, useRef } from "react";
import { describe, KIND_LABEL, starColor } from "@/lib/worlds";

/*
 * A planet's portrait, drawn from its numbers on a 2D canvas (no WebGL):
 *  - the transit as we see it: the star's disc, its colour from its temperature, and the
 *    planet's silhouette at its true size against it;
 *  - an illustration of the kind of world its size and temperature suggest; and
 *  - its orbit from above, with the star's habitable zone.
 * Only the first and last are to scale. No telescope can see these planets' surfaces: the
 * illustration shows a plausible world of this size and temperature, not this world.
 */

// --- A little seeded value noise on the sphere, for the illustration. ---
function hash(x: number, y: number, z: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144665) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
function noise(x: number, y: number, z: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const [fx, fy, fz] = [smooth(x - xi), smooth(y - yi), smooth(z - zi)];
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash(xi + dx, yi + dy, zi + dz, seed);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), fx), lerp(c(0, 1, 0), c(1, 1, 0), fx), fy),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), fx), lerp(c(0, 1, 1), c(1, 1, 1), fx), fy),
    fz,
  );
}
function fbm(x: number, y: number, z: number, seed: number, octaves = 5) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * f, y * f, z * f, seed + o * 17);
    amp *= 0.5;
    f *= 2.03;
  }
  return sum;
}

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Surface colour (0–1 RGB) and night-side glow for a point on the sphere. */
function surface(kind: string, teq: number, p: [number, number, number], lat: number, seed: number): { c: RGB; glow: RGB } {
  const [x, y, z] = p;
  const none: RGB = [0, 0, 0];
  if (kind === "giant" || kind === "too-big") {
    const warp = fbm(x * 2.2, y * 2.2, z * 2.2, seed) * 2.2;
    const bands = 0.5 + 0.5 * Math.sin(lat * 15 + warp * 3.2);
    const fine = fbm(x * 9, y * 22, z * 9, seed + 3, 3);
    let a: RGB, b: RGB;
    if (kind === "too-big" || teq > 1300) [a, b] = [[0.2, 0.08, 0.06], [0.42, 0.2, 0.12]];
    else if (teq > 400) [a, b] = [[0.62, 0.48, 0.34], [0.93, 0.86, 0.74]];
    else if (teq > 160) [a, b] = [[0.78, 0.7, 0.52], [0.92, 0.88, 0.74]];
    else [a, b] = [[0.45, 0.62, 0.72], [0.66, 0.8, 0.86]];
    const c = mix(a, b, clamp01(bands * 0.8 + fine * 0.35));
    const hot = clamp01((teq - 1200) / 1600);
    return { c, glow: [0.9 * hot, 0.25 * hot, 0.08 * hot] };
  }
  if (kind === "neptune") {
    const haze = fbm(x * 3, y * 6, z * 3, seed, 4);
    const bands = 0.5 + 0.5 * Math.sin(lat * 9 + haze * 4);
    const [a, b]: RGB[] = teq > 700 ? [[0.55, 0.52, 0.6], [0.72, 0.7, 0.76]] : teq > 250 ? [[0.32, 0.55, 0.7], [0.55, 0.75, 0.84]] : [[0.22, 0.38, 0.78], [0.42, 0.58, 0.9]];
    return { c: mix(a, b, clamp01(bands * 0.35 + haze * 0.65)), glow: none };
  }
  // Rocky and super-Earths: terrain.
  const h = fbm(x * 2.6, y * 2.6, z * 2.6, seed);
  if (teq > 1000) {
    // Lava world: dark crust, glowing seams.
    const seam = Math.abs(fbm(x * 4, y * 4, z * 4, seed + 9) - 0.5);
    const molten = clamp01(1 - seam / 0.035) * clamp01((teq - 1000) / 800 + 0.4);
    const crust: RGB = mix([0.08, 0.07, 0.07], [0.2, 0.16, 0.14], h);
    return { c: mix(crust, [1, 0.45, 0.1], molten * 0.85), glow: [molten * 1.1, molten * 0.38, molten * 0.06] };
  }
  if (teq < 200) {
    const crack = clamp01(1 - Math.abs(fbm(x * 5, y * 5, z * 5, seed + 4) - 0.5) / 0.025);
    return { c: mix(mix([0.78, 0.84, 0.9], [0.93, 0.95, 0.98], h), [0.45, 0.55, 0.68], crack * 0.6), glow: none };
  }
  const rock = mix([0.32, 0.27, 0.23], [0.62, 0.55, 0.47], clamp01((h - 0.3) * 1.8));
  return { c: kind === "super-earth" ? mix(rock, [0.72, 0.74, 0.78], 0.35) : rock, glow: none };
}

function drawWorld(canvas: HTMLCanvasElement, kind: string, teq: number, star: RGB, seed: number) {
  const N = 300;
  canvas.width = N;
  canvas.height = N;
  const g = canvas.getContext("2d");
  if (!g) return;
  const img = g.createImageData(N, N);
  const R = N * 0.4;
  const cx = N / 2;
  const cy = N / 2;
  const L = [-0.72, 0.28, 0.63];
  const ll = Math.hypot(...L);
  const light = L.map((v) => v / ll);
  const tint: RGB = [star[0] / 255, star[1] / 255, star[2] / 255];
  const atmosphere = kind === "giant" || kind === "neptune" || kind === "super-earth";
  const tilt = 0.25;
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      const nx = (px - cx) / R;
      const ny = (cy - py) / R;
      const d2 = nx * nx + ny * ny;
      const o = (py * N + px) * 4;
      if (d2 > 1) {
        // A thin halo of lit atmosphere around the limb.
        if (atmosphere && d2 < 1.06) {
          const rim = clamp01((1.06 - d2) / 0.06) * clamp01(-nx * 0.8 + 0.3);
          img.data[o] = 255 * tint[0] * 0.55;
          img.data[o + 1] = 255 * tint[1] * 0.6;
          img.data[o + 2] = 255 * Math.min(1, tint[2] * 0.75 + 0.2);
          img.data[o + 3] = 255 * rim * 0.35;
        }
        continue;
      }
      const nz = Math.sqrt(1 - d2);
      // Tilt the spin axis a little, then find latitude on the body.
      const ry = ny * Math.cos(tilt) - nz * Math.sin(tilt);
      const rz = ny * Math.sin(tilt) + nz * Math.cos(tilt);
      const lat = Math.asin(Math.max(-1, Math.min(1, ry)));
      const { c, glow } = surface(kind, teq, [nx, ry, rz], lat, seed);
      const diffuse = Math.max(0, nx * light[0] + ny * light[1] + nz * light[2]);
      const lit = 0.02 + Math.pow(diffuse, 0.9) * 1.05;
      const limb = atmosphere ? 0.55 + 0.45 * Math.pow(nz, 0.5) : 1;
      const night = 1 - clamp01(diffuse * 3);
      for (let k = 0; k < 3; k++) {
        const v = c[k] * tint[k] * lit * limb + glow[k] * (0.35 + 0.65 * night);
        img.data[o + k] = Math.min(255, v * 255);
      }
      // Soft edge.
      img.data[o + 3] = 255 * clamp01((1 - d2) * R * 0.5);
    }
  }
  g.putImageData(img, 0, 0);
}

function drawTransit(canvas: HTMLCanvasElement, ratio: number, star: RGB, width: number) {
  const W = width;
  const H = 200;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const g = canvas.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const R = 82;
  const cx = W / 2;
  const cy = H / 2;
  // Glow, then the disc with limb darkening (quadratic law, u1 = 0.4, u2 = 0.25).
  const halo = g.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.6);
  halo.addColorStop(0, `rgba(${star.join(",")},0.25)`);
  halo.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = halo;
  g.fillRect(0, 0, W, H);
  const disc = g.createRadialGradient(cx, cy, 0, cx, cy, R);
  for (let k = 0; k <= 10; k++) {
    const r = k / 10;
    const mu = Math.sqrt(Math.max(0, 1 - r * r));
    const i = 1 - 0.4 * (1 - mu) - 0.25 * (1 - mu) ** 2;
    disc.addColorStop(r, `rgb(${star.map((v) => Math.round(v * i)).join(",")})`);
  }
  g.fillStyle = disc;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fill();
  // The planet's silhouette, true to size, crossing a little below the centre.
  const pr = Math.max(ratio * R, 0.8);
  g.fillStyle = "#000";
  g.beginPath();
  g.arc(cx - R * 0.15, cy + R * 0.25, pr, 0, Math.PI * 2);
  g.fill();
}

function drawOrbit(canvas: HTMLCanvasElement, au: number, zone: { innerAu: number; outerAu: number }, star: RGB) {
  const N = 300;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = N * dpr;
  canvas.height = N * dpr;
  const g = canvas.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, N, N);
  const c = N / 2;
  const reach = Math.max(au * 1.25, zone.outerAu * 1.1);
  const s = (N * 0.46) / reach;
  // Habitable zone as a soft ring.
  g.fillStyle = "rgba(127,212,255,0.14)";
  g.beginPath();
  g.arc(c, c, zone.outerAu * s, 0, Math.PI * 2);
  g.arc(c, c, zone.innerAu * s, 0, Math.PI * 2, true);
  g.fill();
  // Earth's orbit for scale, when it fits.
  const font = getComputedStyle(canvas).fontFamily;
  g.font = `9px ${font}`;
  if (1 < reach) {
    g.setLineDash([3, 4]);
    g.strokeStyle = "rgba(236,238,242,0.3)";
    g.beginPath();
    g.arc(c, c, s, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = "rgba(236,238,242,0.45)";
    g.fillText("EARTH'S ORBIT", c + 4, c - s - 4);
  }
  // The planet's orbit and the planet.
  g.strokeStyle = "#c9a46a";
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(c, c, Math.max(au * s, 2), 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "#c9a46a";
  g.beginPath();
  g.arc(c + Math.max(au * s, 2) * Math.cos(-0.6), c + Math.max(au * s, 2) * Math.sin(-0.6), 4, 0, Math.PI * 2);
  g.fill();
  // The star.
  g.fillStyle = `rgb(${star.join(",")})`;
  g.beginPath();
  g.arc(c, c, 3.5, 0, Math.PI * 2);
  g.fill();
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] tracking-[0.2em] text-ink/45">{label}</dt>
      <dd className="mt-1 font-mono text-sm text-ink">{value}</dd>
      {sub && <dd className="mt-0.5 font-mono text-[10px] tracking-[0.12em] text-ink/45">{sub}</dd>}
    </div>
  );
}

export default function PlanetPortrait({
  name,
  radiusEarth,
  period,
  starRadius,
  starTeff,
  starMass = null,
  seed,
  compact = false,
  sizeNote,
}: {
  name: string;
  radiusEarth: number;
  period: number;
  starRadius: number;
  starTeff: number;
  starMass?: number | null;
  seed: number;
  compact?: boolean;
  /** How the size was found, when it wasn't measured from a transit. */
  sizeNote?: string;
}) {
  const world = useRef<HTMLCanvasElement>(null);
  const transit = useRef<HTMLCanvasElement>(null);
  const orbit = useRef<HTMLCanvasElement>(null);
  const d = useMemo(() => describe({ radiusEarth, period, starRadius, starTeff, starMass }), [radiusEarth, period, starRadius, starTeff, starMass]);
  const star = useMemo(() => starColor(starTeff), [starTeff]);

  useEffect(() => {
    if (world.current) drawWorld(world.current, d.kind, d.teq, star, seed);
    if (orbit.current) drawOrbit(orbit.current, d.au, d.zone, star);
    const t = transit.current;
    if (t) drawTransit(t, d.ratio, star, Math.max(240, Math.floor(t.getBoundingClientRect().width) || 300));
  }, [d, star, seed]);

  // Near an edge, say so: the zone's limits are model estimates, not sharp lines.
  const hz = d.zone;
  const zoneText = d.inZone
    ? "INSIDE"
    : d.au < hz.innerAu
      ? d.au > hz.innerAu * 0.9
        ? "JUST PAST THE HOT EDGE"
        : "TOO CLOSE, TOO HOT"
      : d.au < hz.outerAu * 1.1
        ? "JUST BEYOND THE COLD EDGE"
        : "TOO FAR, TOO COLD";
  const temp = `${Math.round(d.teq).toLocaleString("en")} K · ${Math.round(d.teq - 273.15).toLocaleString("en")} °C`;

  return (
    <div>
      <div className={`grid gap-4 ${compact ? "" : "md:grid-cols-[1fr_1fr_1fr]"}`}>
        <figure>
          <canvas ref={world} role="img" aria-label={`Illustration of ${name}: a ${KIND_LABEL[d.kind].toLowerCase()} at about ${Math.round(d.teq)} K`} className="mx-auto block aspect-square w-full max-w-[260px]" />
          <figcaption className="mt-2 text-center font-mono text-[10px] tracking-[0.14em] text-ink/45">ILLUSTRATION · {KIND_LABEL[d.kind].toUpperCase()}</figcaption>
        </figure>
        {!compact && (
          <figure>
            <canvas ref={transit} role="img" aria-label={`The transit to scale: the planet is ${(d.ratio * 100).toFixed(1)}% of its star's width`} className="block h-[200px] w-full font-mono" />
            <figcaption className="mt-2 text-center font-mono text-[10px] tracking-[0.14em] text-ink/45">
              THE TRANSIT, TO SCALE · PLANET {(d.ratio * 100).toFixed(1)}% OF THE STAR&apos;S WIDTH
            </figcaption>
          </figure>
        )}
        {!compact && (
          <figure>
            <canvas ref={orbit} role="img" aria-label={`Orbit from above: ${d.au.toFixed(3)} AU from its star; the habitable zone spans ${d.zone.innerAu.toFixed(2)} to ${d.zone.outerAu.toFixed(2)} AU`} className="mx-auto block aspect-square w-full max-w-[260px] font-mono" />
            <figcaption className="mt-2 text-center font-mono text-[10px] tracking-[0.14em] text-ink/45">ORBIT FROM ABOVE, TO SCALE · BLUE: HABITABLE ZONE</figcaption>
          </figure>
        )}
      </div>
      <dl className={`mt-5 grid gap-4 ${compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4"}`}>
        <Fact label="KIND" value={KIND_LABEL[d.kind].toUpperCase()} sub={sizeNote ?? `${radiusEarth.toFixed(1)} × EARTH'S SIZE`} />
        <Fact label="ORBIT" value={`${d.au < 0.1 ? d.au.toFixed(3) : d.au.toFixed(2)} AU`} sub="× EARTH–SUN DISTANCE" />
        <Fact label="STARLIGHT" value={`${d.insolation < 10 ? d.insolation.toFixed(2) : Math.round(d.insolation).toLocaleString("en")} × EARTH'S`} />
        <Fact label="TEMPERATURE" value={temp} sub="IF IT REFLECTED 30% LIKE EARTH" />
        <Fact label="HABITABLE ZONE" value={zoneText} sub={`CONSERVATIVE: ${d.zone.innerAu.toFixed(2)}–${d.zone.outerAu.toFixed(2)} AU HERE`} />
      </dl>
      <p className="caps mt-4 text-[11px] leading-relaxed text-ink/50">
        An illustration, not an image: no telescope can see this planet&apos;s surface. It shows the kind of world this size and warmth
        suggest; the real colours, clouds and surface are unknown.{compact ? "" : " The transit and the orbit are to scale."}
        {d.inZone && d.kind !== "giant" ? " In the habitable zone means liquid water could exist on a suitable surface, not that it does." : ""}
      </p>
    </div>
  );
}
