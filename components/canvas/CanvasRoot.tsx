"use client";

import { Component, type ReactNode, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { appStore } from "@/lib/store";
import FallbackBackdrop from "./FallbackBackdrop";

// three.js and the scenes ship in their own chunk, fetched after first paint.
const Scene = dynamic(() => import("./Scene"), { ssr: false });

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("[stellr] 3D scene failed, continuing without it", error);
    appStore.set({ ready: true });
  }
  render() {
    return this.state.failed ? <FallbackBackdrop /> : this.props.children;
  }
}

function hasWebGL() {
  // `?fallback` forces the image backdrop, for testing it on machines where WebGL works.
  if (new URLSearchParams(location.search).has("fallback")) return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** The one persistent canvas, fixed behind every section. */
export default function CanvasRoot() {
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    const ok = hasWebGL();
    // Detection needs the DOM, so it can only happen after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(ok);
    if (!ok) appStore.set({ ready: true });
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
      {supported && (
        <SceneBoundary>
          <Scene />
        </SceneBoundary>
      )}
      {supported === false && <FallbackBackdrop />}
    </div>
  );
}
