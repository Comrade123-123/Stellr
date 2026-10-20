"use client";

import { type RefObject, useEffect, useLayoutEffect } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useAppStore } from "@/lib/store";

gsap.registerPlugin(ScrollTrigger);

/**
 * Animates `.reveal-word` (masked words rising) and `.reveal-fade` (soft fade-up)
 * inside `root` the first time it scrolls into view, once the scene is ready.
 */
export function useReveal(root: RefObject<HTMLElement | null>, start = "top 70%") {
  const ready = useAppStore((s) => s.ready);

  useLayoutEffect(() => {
    const ctx = gsap.context((self) => {
      const words = self.selector?.(".reveal-word") ?? [];
      const fades = self.selector?.(".reveal-fade") ?? [];
      if (words.length) gsap.set(words, { yPercent: 115 });
      if (fades.length) gsap.set(fades, { autoAlpha: 0, y: 24 });
    }, root);
    return () => ctx.revert();
  }, [root]);

  useEffect(() => {
    if (!ready) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = gsap.context((self) => {
      const words = self.selector?.(".reveal-word") ?? [];
      const fades = self.selector?.(".reveal-fade") ?? [];
      const tl = gsap.timeline({
        defaults: { ease: "expo.out" },
        scrollTrigger: { trigger: root.current, start, once: true },
      });
      if (words.length) tl.to(words, { yPercent: 0, duration: reduced ? 0.01 : 1.5, stagger: 0.05 }, 0);
      if (fades.length) {
        tl.to(fades, { autoAlpha: 1, y: 0, duration: reduced ? 0.4 : 1.2, stagger: 0.1 }, reduced || !words.length ? 0 : 0.25);
      }
    }, root);
    return () => ctx.revert();
  }, [ready, root, start]);
}
