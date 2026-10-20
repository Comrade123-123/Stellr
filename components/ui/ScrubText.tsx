"use client";

import { Fragment, useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useAppStore } from "@/lib/store";

gsap.registerPlugin(ScrollTrigger);

/** Uppercase copy whose words brighten one by one as it scrolls through the viewport. */
export default function ScrubText({ text, className = "" }: { text: string; className?: string }) {
  const root = useRef<HTMLParagraphElement>(null);
  const ready = useAppStore((s) => s.ready);

  useEffect(() => {
    if (!ready) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".scrub-word",
        { opacity: 0.16 },
        {
          opacity: 1,
          ease: "none",
          stagger: 0.05,
          scrollTrigger: { trigger: root.current, start: "top 82%", end: "bottom 45%", scrub: true },
        },
      );
    }, root);
    return () => ctx.revert();
  }, [ready]);

  return (
    <p ref={root} className={`caps ${className}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {text.split(" ").map((word, i) => (
          <Fragment key={i}>
            <span className="scrub-word opacity-[0.16]">{word}</span>{" "}
          </Fragment>
        ))}
      </span>
    </p>
  );
}
