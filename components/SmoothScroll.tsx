"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { getQuality } from "@/lib/quality";
import { measureScenes, updateJourney } from "@/lib/scroll";
import { appStore } from "@/lib/store";

gsap.registerPlugin(ScrollTrigger);

/** Lenis smooth scroll driving both ScrollTrigger and the 3D journey. Locked until the scene is ready. */
export default function SmoothScroll() {
  useEffect(() => {
    const root = document.documentElement;
    const { reducedMotion } = getQuality();
    const lenis = reducedMotion ? null : new Lenis({ lerp: 0.085, wheelMultiplier: 0.9 });

    const sync = () => {
      updateJourney(lenis ? lenis.scroll : window.scrollY);
      ScrollTrigger.update();
    };
    const tick = (time: number) => lenis?.raf(time * 1000);

    if (lenis) {
      lenis.on("scroll", sync);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
    } else {
      window.addEventListener("scroll", sync, { passive: true });
    }

    const remeasure = () => {
      measureScenes();
      sync();
    };
    const resize = new ResizeObserver(remeasure);
    resize.observe(document.body);
    remeasure();

    const lock = (locked: boolean) => {
      root.classList.toggle("is-loading", locked);
      if (locked) lenis?.stop();
      else lenis?.start();
    };
    lock(!appStore.get().ready);
    const unsubscribe = appStore.subscribe(() => {
      if (appStore.get().ready) lock(false);
    });

    return () => {
      unsubscribe();
      resize.disconnect();
      gsap.ticker.remove(tick);
      window.removeEventListener("scroll", sync);
      lenis?.destroy();
      root.classList.remove("is-loading");
    };
  }, []);

  return null;
}
