"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A small canvas plot for Exoplanet Lab's light curves, periodograms and folded transits:
 * points and 2px lines on one shared pair of axes (never a second y-scale), hairline grid,
 * muted axis text, vertical marker lines, and a crosshair with a tooltip on hover. Canvas
 * rather than SVG because a light curve is tens of thousands of points.
 */

export interface Layer {
  kind: "points" | "line";
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  color: string;
  /** Point size in CSS pixels. */
  size?: number;
  alpha?: number;
}

export interface Marker {
  x: number;
  label?: string;
  color: string;
  dashed?: boolean;
}

const INK = "rgba(236,238,242,";
const PAD = { left: 68, right: 14, top: 12, bottom: 34 };

/** Round tick values for a range: 1, 2 or 5 times a power of ten. */
function ticks(a: number, b: number, count = 5) {
  const span = b - a;
  if (!(span > 0)) return [a];
  const raw = span / count;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => span / s <= count) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}

/** Log-axis ticks at 1, 2, 5 × powers of ten. */
function logTicks(a: number, b: number) {
  const out: number[] = [];
  for (let p = Math.floor(Math.log10(a)); p <= Math.ceil(Math.log10(b)); p++)
    for (const m of [1, 2, 5]) {
      const v = m * Math.pow(10, p);
      if (v >= a && v <= b) out.push(v);
    }
  return out;
}

/** The middle of the data, ignoring the extreme 0.5% at each end, padded a little. */
function robustRange(layers: Layer[], key: "x" | "y") {
  const all: number[] = [];
  for (const l of layers) for (let i = 0; i < l[key].length; i++) if (Number.isFinite(l[key][i])) all.push(l[key][i]);
  if (!all.length) return [0, 1] as [number, number];
  all.sort((a, b) => a - b);
  const lo = all[Math.floor(all.length * 0.003)];
  const hi = all[Math.min(all.length - 1, Math.ceil(all.length * 0.997))];
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.08;
  return [lo - pad, hi + pad] as [number, number];
}

export default function Plot({
  layers,
  height = 220,
  xLabel,
  yLabel,
  xDomain,
  yDomain,
  xLog = false,
  yLog = false,
  markers = [],
  formatX = (v) => String(v),
  formatY = (v) => String(v),
  tooltip,
  ariaLabel,
}: {
  layers: Layer[];
  height?: number;
  xLabel: string;
  yLabel: string;
  xDomain?: [number, number];
  yDomain?: [number, number];
  xLog?: boolean;
  yLog?: boolean;
  markers?: Marker[];
  formatX?: (v: number) => string;
  formatY?: (v: number) => string;
  /** Text for the crosshair at data-x `x`, or null for none. */
  tooltip?: (x: number) => string | null;
  ariaLabel: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ px: number; text: string } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const xr = xDomain ?? robustRange(layers, "x");
  const yr = yDomain ?? robustRange(layers, "y");
  const innerW = Math.max(10, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const lx = (v: number) => (xLog ? Math.log10(Math.max(v, 1e-9)) : v);
  const [x0, x1] = [lx(xLog ? Math.max(xr[0], 1e-3) : xr[0]), lx(xr[1])];
  const sx = (v: number) => PAD.left + ((lx(v) - x0) / (x1 - x0 || 1)) * innerW;
  const ly = (v: number) => (yLog ? Math.log10(Math.max(v, 1e-9)) : v);
  const [y0, y1] = [ly(yr[0]), ly(yr[1])];
  const sy = (v: number) => PAD.top + (1 - (ly(v) - y0) / (y1 - y0 || 1)) * innerH;
  const invX = (px: number) => {
    const v = x0 + ((px - PAD.left) / innerW) * (x1 - x0);
    return xLog ? Math.pow(10, v) : v;
  };

  useEffect(() => {
    const c = canvas.current;
    if (!c || !width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = width * dpr;
    c.height = height * dpr;
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const font = getComputedStyle(c).fontFamily;
    g.font = `10px ${font}`;

    // Grid and axes: hairlines, recessive.
    g.strokeStyle = `${INK}0.08)`;
    g.lineWidth = 1;
    g.fillStyle = `${INK}0.45)`;
    g.textAlign = "right";
    g.textBaseline = "middle";
    for (const v of yLog ? logTicks(yr[0], yr[1]) : ticks(yr[0], yr[1], 4)) {
      const y = Math.round(sy(v)) + 0.5;
      g.beginPath();
      g.moveTo(PAD.left, y);
      g.lineTo(width - PAD.right, y);
      g.stroke();
      g.fillText(formatY(v), PAD.left - 8, y);
    }
    g.textAlign = "center";
    g.textBaseline = "top";
    const xt = xLog ? logTicks(Math.max(xr[0], 1e-3), xr[1]) : ticks(xr[0], xr[1], Math.max(3, Math.floor(innerW / 90)));
    for (const v of xt) {
      const x = Math.round(sx(v)) + 0.5;
      g.beginPath();
      g.moveTo(x, PAD.top);
      g.lineTo(x, height - PAD.bottom);
      g.stroke();
      g.fillText(formatX(v), x, height - PAD.bottom + 6);
    }
    g.fillStyle = `${INK}0.4)`;
    g.textAlign = "right";
    g.fillText(xLabel, width - PAD.right, height - 12);
    g.save();
    g.translate(11, PAD.top);
    g.rotate(-Math.PI / 2);
    g.textAlign = "right";
    g.fillText(yLabel, 0, 0);
    g.restore();

    // Data, clipped to the plot area.
    g.save();
    g.beginPath();
    g.rect(PAD.left, PAD.top, innerW, innerH);
    g.clip();
    for (const m of markers) {
      g.strokeStyle = m.color;
      g.lineWidth = 1;
      g.setLineDash(m.dashed ? [4, 4] : []);
      const x = Math.round(sx(m.x)) + 0.5;
      g.beginPath();
      g.moveTo(x, PAD.top);
      g.lineTo(x, height - PAD.bottom);
      g.stroke();
    }
    g.setLineDash([]);
    for (const l of layers) {
      g.globalAlpha = l.alpha ?? 1;
      if (l.kind === "points") {
        g.fillStyle = l.color;
        const s = l.size ?? 1.6;
        for (let i = 0; i < l.x.length; i++) {
          const y = l.y[i];
          if (!Number.isFinite(y)) continue;
          g.fillRect(sx(l.x[i]) - s / 2, sy(y) - s / 2, s, s);
        }
      } else {
        g.strokeStyle = l.color;
        g.lineWidth = 2;
        g.lineJoin = "round";
        g.lineCap = "round";
        g.beginPath();
        let started = false;
        for (let i = 0; i < l.x.length; i++) {
          const y = l.y[i];
          if (!Number.isFinite(y)) {
            started = false;
            continue;
          }
          if (started) g.lineTo(sx(l.x[i]), sy(y));
          else g.moveTo(sx(l.x[i]), sy(y));
          started = true;
        }
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    g.restore();
    // Marker labels sit above the plot area's top edge, in text ink.
    g.fillStyle = `${INK}0.7)`;
    g.textAlign = "left";
    g.textBaseline = "top";
    for (const m of markers) if (m.label) g.fillText(m.label, Math.min(sx(m.x) + 4, width - PAD.right - g.measureText(m.label).width), PAD.top + 2);
    // Recomputing on every layer change is the point; the scale helpers are derived from these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, markers, width, height, xr[0], xr[1], yr[0], yr[1], xLog, yLog, xLabel, yLabel]);

  return (
    <div ref={wrap} className="relative w-full select-none" style={{ height }}>
      <canvas
        ref={canvas}
        role="img"
        aria-label={ariaLabel}
        className="absolute inset-0 h-full w-full font-mono"
        style={{ width: "100%", height }}
        onPointerMove={(e) => {
          if (!tooltip) return;
          const r = e.currentTarget.getBoundingClientRect();
          const px = e.clientX - r.left;
          if (px < PAD.left || px > width - PAD.right) return setHover(null);
          const text = tooltip(invX(px));
          setHover(text ? { px, text } : null);
        }}
        onPointerLeave={() => setHover(null)}
      />
      {hover && (
        <>
          <div className="pointer-events-none absolute w-px bg-ink/30" style={{ left: hover.px, top: PAD.top, height: height - PAD.top - PAD.bottom }} />
          <div
            className="pointer-events-none absolute z-10 whitespace-nowrap rounded border border-ink/15 bg-void/90 px-2 py-1 font-mono text-[10px] tracking-[0.08em] text-ink"
            style={{ left: Math.min(hover.px + 10, Math.max(PAD.left, width - 220)), top: PAD.top }}
          >
            {hover.text}
          </div>
        </>
      )}
    </div>
  );
}
