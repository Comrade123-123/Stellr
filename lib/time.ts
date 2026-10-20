"use client";

import { useEffect, useState } from "react";

/** Current time, ticking once a second. Null until mounted so SSR and client agree. */
export function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  return now;
}

const pad = (n: number) => String(n).padStart(2, "0");

export const formatUtc = (d: Date) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

/** Greenwich Mean Sidereal Time as HH:MM:SS (IAU 1982 approximation, good to ~0.1 s). */
export function gmst(d: Date): string {
  const daysSinceJ2000 = d.getTime() / 86_400_000 + 2440587.5 - 2451545.0;
  const hours = (((18.697374558 + 24.06570982441908 * daysSinceJ2000) % 24) + 24) % 24;
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  const s = Math.floor(((hours - h) * 60 - m) * 60);
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - start) / 86_400_000) + 1;
}
