"use client";

import { useEffect, useState } from "react";
import { gsap } from "gsap";
import { CAMERA_PATH, scroll } from "@/lib/scroll";

const IDS = CAMERA_PATH.map((w) => w.id);
const TALL = "(max-aspect-ratio: 9/10)";

/**
 * Used when WebGL is unavailable (disabled GPU, blocked driver, old device):
 * pre-rendered frames of each section's 3D scene, cross-fading with scroll and
 * drifting slowly so the page keeps its sense of place and motion.
 * Frames come from public/fallback/<id>-<wide|tall>.jpg.
 */
export default function FallbackBackdrop() {
  const [current, setCurrent] = useState(0);
  const [tall, setTall] = useState(false);

  useEffect(() => {
    const mq = matchMedia(TALL);
    const onChange = () => setTall(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);

    let last = -1;
    const tick = () => {
      const i = Math.max(0, Math.min(IDS.length - 1, Math.round(scroll.journey)));
      if (i !== last) {
        last = i;
        setCurrent(i);
      }
    };
    gsap.ticker.add(tick);
    return () => {
      mq.removeEventListener("change", onChange);
      gsap.ticker.remove(tick);
    };
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden bg-void">
      {IDS.map((id, i) =>
        // Only the current frame and its neighbours are ever requested.
        Math.abs(i - current) <= 1 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={id}
            src={`/fallback/${id}-${tall ? "tall" : "wide"}.jpg`}
            alt=""
            decoding="async"
            className={`fallback-drift absolute inset-0 h-full w-full object-cover transition-opacity duration-[1200ms] ease-out ${
              i === current ? "opacity-100" : "opacity-0"
            }`}
          />
        ) : null,
      )}
    </div>
  );
}
