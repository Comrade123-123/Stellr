"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";

const starVertex = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aPhase;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uTwinkle;
  varying vec3 vColor;

  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    float twinkle = 1.0 + uTwinkle * 0.3 * sin(uTime * (0.5 + aPhase * 1.8) + aPhase * 40.0);
    gl_PointSize = max(1.0, aSize * uPixelRatio * twinkle);
    // Only the largest few stars get pushed past the bloom threshold.
    vColor = aColor * (0.55 + 0.45 * twinkle) * (1.0 + step(2.8, aSize) * 1.6);
  }
`;

const starFragment = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float core = exp(-d * d * 5.0) * (1.0 - smoothstep(0.85, 1.0, d));
    gl_FragColor = vec4(vColor * core, core);
    #include <colorspace_fragment>
  }
`;

/** Orientation and tint of the Milky Way backdrop; the black hole lenses the same sky. */
export const SKY_ROTATION = new THREE.Euler(0.5, 0.3, -1.05);
export const SKY_TINT = new THREE.Color(0.22, 0.22, 0.25);

const PALETTE = [
  new THREE.Color("#ffffff"),
  new THREE.Color("#dfe8ff"),
  new THREE.Color("#bcd0ff"),
  new THREE.Color("#fff2dc"),
  new THREE.Color("#ffd9a6"),
];

interface StarfieldProps {
  count: number;
  reducedMotion: boolean;
}

/** Point stars plus a dim Milky Way sky, both pinned to the camera so they read as infinitely far. */
export default function Starfield({ count, reducedMotion }: StarfieldProps) {
  const group = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  const pixelRatio = useThree((s) => s.viewport.dpr);
  const sky = useTexture("/textures/2k_stars_milky_way.jpg");

  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      v.randomDirection().multiplyScalar(700 + Math.random() * 600);
      v.toArray(positions, i * 3);
      PALETTE[Math.floor(Math.random() ** 1.6 * PALETTE.length)].toArray(colors, i * 3);
      sizes[i] = 0.7 + Math.random() ** 7 * 3.2;
      phases[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    g.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    return g;
  }, [count]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: starVertex,
        fragmentShader: starFragment,
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: 1 },
          uTwinkle: { value: reducedMotion ? 0 : 1 },
        },
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    [reducedMotion],
  );

  const skyMaterial = useMemo(() => {
    sky.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({
      map: sky,
      color: SKY_TINT,
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
    });
  }, [sky]);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uPixelRatio.value = pixelRatio;
    group.current?.position.copy(camera.position);
  });

  return (
    <group ref={group}>
      <mesh material={skyMaterial} rotation={SKY_ROTATION} renderOrder={-2}>
        <sphereGeometry args={[1600, 48, 32]} />
      </mesh>
      <points geometry={geometry} material={material} frustumCulled={false} renderOrder={-1} />
    </group>
  );
}
