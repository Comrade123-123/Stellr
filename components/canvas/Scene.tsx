"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import { DefaultLoadingManager } from "three";
import { getQuality } from "@/lib/quality";
import { scroll } from "@/lib/scroll";
import { appStore, useAppStore } from "@/lib/store";
import CameraRig from "./CameraRig";
import Earth from "./Earth";
import Effects from "./Effects";
import Orbits from "./Orbits";
import SolarSystem from "./SolarSystem";
import Starfield from "./Starfield";

// Fires from image load callbacks, never during a React render.
DefaultLoadingManager.onProgress = (_url, loaded, total) => {
  if (!appStore.get().ready) appStore.set({ progress: (loaded / total) * 100 });
};

/**
 * Mounted inside Suspense, so it only exists once every texture has resolved.
 * Counts real frames rather than scheduling rAFs, which survives dev double-mounts.
 */
function Ready() {
  const frames = useRef(0);
  useFrame(() => {
    frames.current += 1;
    if (frames.current === 3 && !appStore.get().ready) {
      appStore.set({ ready: true, progress: 100 });
    }
  });
  return null;
}

/**
 * Development only: `window.__stellrCapture(journey)` steps the scene ~2 s at a
 * given scroll position and returns a JPEG of the canvas. Used to check camera
 * framing from browser automation, where rAF is often throttled.
 */
function DevCapture() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __stellrCapture?: (journey?: number) => string };
    w.__stellrCapture = (journey) => {
      const state = get();
      const previous = state.frameloop;
      if (journey !== undefined) scroll.journey = journey;
      state.setFrameloop("never");
      let t = state.clock.elapsedTime;
      for (let i = 0; i < 120; i++) {
        t += 1 / 60;
        state.advance(t, true);
      }
      const image = state.gl.domElement.toDataURL("image/jpeg", 0.85);
      state.setFrameloop(previous);
      return image;
    };
    return () => {
      delete w.__stellrCapture;
    };
  }, [get]);
  return null;
}

export default function Scene() {
  const [quality] = useState(getQuality);
  const degraded = useAppStore((s) => s.degraded);
  const postprocessing = quality.postprocessing && !degraded;

  return (
    <Canvas
      dpr={degraded ? 1 : quality.dpr}
      gl={{
        antialias: !postprocessing,
        alpha: false,
        stencil: false,
        powerPreference: "high-performance",
      }}
      camera={{ fov: 40, near: 0.1, far: 4000, position: [0, 0.3, 3.3] }}
      onCreated={({ gl }) => {
        gl.setClearColor("#000000");
        // A lost context (GPU reset) usually means the effects were too heavy:
        // drop to the degraded path so the restored context renders lighter.
        gl.domElement.addEventListener("webglcontextlost", () => appStore.set({ degraded: true }));
      }}
    >
      <PerformanceMonitor
        onDecline={() => appStore.set({ degraded: true })}
        flipflops={2}
      />
      <Suspense fallback={null}>
        <Starfield count={degraded ? Math.round(quality.starCount / 2) : quality.starCount} reducedMotion={quality.reducedMotion} />
        <Earth segments={quality.sphereSegments} reducedMotion={quality.reducedMotion} />
        <Orbits reducedMotion={quality.reducedMotion} />
        <Ready />
      </Suspense>
      {/* Loads after first paint and never holds up the loader. */}
      <Suspense fallback={null}>
        <SolarSystem reducedMotion={quality.reducedMotion} />
      </Suspense>
      <DevCapture />
      <CameraRig parallax={!quality.reducedMotion && !quality.isMobile} />
      {postprocessing && <Effects multisampling={quality.multisampling} />}
    </Canvas>
  );
}
