"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { sampleCamera, scroll } from "@/lib/scroll";

interface CameraRigProps {
  parallax: boolean;
}

/** Follows the scroll-driven camera path, with a little pointer parallax on top. */
export default function CameraRig({ parallax }: CameraRigProps) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const goalPosition = useRef(new THREE.Vector3());
  const goalTarget = useRef(new THREE.Vector3());
  const target = useRef(new THREE.Vector3());
  const pointer = useRef({ x: 0, y: 0, sx: 0, sy: 0 });

  useEffect(() => {
    scroll.view = scroll.journey;
    sampleCamera(scroll.view, size.width / size.height, goalPosition.current, goalTarget.current);
    camera.position.copy(goalPosition.current);
    target.current.copy(goalTarget.current);
    camera.lookAt(target.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  useEffect(() => {
    if (!parallax) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [parallax]);

  // Runs before the scene's other frame callbacks, so everything this frame reads the same eased journey.
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    // Ease the journey itself rather than the camera's position: the camera then always sits
    // on the authored path (never cutting a corner through Earth), and fades stay in step with it.
    scroll.view += (scroll.journey - scroll.view) * (1 - Math.exp(-dt * 5));
    if (Math.abs(scroll.journey - scroll.view) < 1e-5) scroll.view = scroll.journey;
    sampleCamera(scroll.view, size.width / size.height, goalPosition.current, goalTarget.current);

    const p = pointer.current;
    const ease = 1 - Math.exp(-dt * 2.5);
    p.sx += (p.x - p.sx) * ease;
    p.sy += (p.y - p.sy) * ease;
    goalPosition.current.x += p.sx * 0.08;
    goalPosition.current.y -= p.sy * 0.05;

    camera.position.copy(goalPosition.current);
    target.current.copy(goalTarget.current);
    camera.lookAt(target.current);
  }, -1);

  return null;
}
