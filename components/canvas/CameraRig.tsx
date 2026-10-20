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
    sampleCamera(scroll.journey, size.width / size.height, goalPosition.current, goalTarget.current);
    camera.position.copy(goalPosition.current);
    target.current.copy(goalTarget.current);
    camera.lookAt(target.current);
    // Snap only on mount; resizes ease in through useFrame.
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

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    sampleCamera(scroll.journey, size.width / size.height, goalPosition.current, goalTarget.current);

    const p = pointer.current;
    const ease = 1 - Math.exp(-dt * 2.5);
    p.sx += (p.x - p.sx) * ease;
    p.sy += (p.y - p.sy) * ease;
    goalPosition.current.x += p.sx * 0.08;
    goalPosition.current.y -= p.sy * 0.05;

    const follow = 1 - Math.exp(-dt * 6);
    camera.position.lerp(goalPosition.current, follow);
    target.current.lerp(goalTarget.current, follow);
    camera.lookAt(target.current);
  });

  return null;
}
