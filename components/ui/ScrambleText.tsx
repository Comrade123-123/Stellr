"use client";

import { useEffect, useRef } from "react";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/#%+*";

/**
 * Text that decodes letter by letter when its parent (a link or button) is hovered
 * or focused. The real text stays available to assistive tech.
 */
export default function ScrambleText({ text, className = "" }: { text: string; className?: string }) {
  const el = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const span = el.current;
    const host = span?.parentElement;
    if (!span || !host || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const run = () => {
      cancelAnimationFrame(raf);
      const startTime = performance.now();
      const duration = 380 + text.length * 18;
      const tick = (now: number) => {
        const p = Math.min(1, (now - startTime) / duration);
        const settled = Math.floor(p * text.length);
        let out = "";
        for (let i = 0; i < text.length; i++) {
          const c = text[i];
          out += i < settled || c === " " ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0];
        }
        span.textContent = out;
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    host.addEventListener("mouseenter", run);
    host.addEventListener("focus", run);
    return () => {
      cancelAnimationFrame(raf);
      host.removeEventListener("mouseenter", run);
      host.removeEventListener("focus", run);
      span.textContent = text;
    };
  }, [text]);

  return (
    <>
      <span className="sr-only">{text}</span>
      <span ref={el} aria-hidden className={`inline-block whitespace-pre ${className}`}>
        {text}
      </span>
    </>
  );
}
