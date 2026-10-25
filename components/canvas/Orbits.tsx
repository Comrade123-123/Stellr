"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { scroll, sceneIndex } from "@/lib/scroll";

const GOLD = new THREE.Color("#c9a46a");
const INK = new THREE.Color("#eceef2");

/** radius, inclination (deg), node (deg), angular speed, satellites on the ring */
const RINGS: [number, number, number, number, number][] = [
  [1.32, 51.6, 0, 0.42, 3],
  [1.55, 97.5, 40, 0.3, 2],
  [1.85, 28, 120, 0.22, 2],
  [2.6, 5, 200, 0.09, 1],
];

const satVertex = /* glsl */ `
  attribute float aSize;
  uniform float uPixelRatio;
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // Perspective-scaled, but capped: a satellite skimming the camera must not
    // become a screen-filling point (costly overdraw on integrated GPUs).
    gl_PointSize = clamp(aSize * uPixelRatio * (36.0 / max(-mv.z, 0.1)), 1.0, 24.0 * uPixelRatio);
    vAlpha = uOpacity;
  }
`;

const satFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float core = exp(-d * d * 7.0);
    gl_FragColor = vec4(uColor * core * 2.4, core * vAlpha);
    #include <colorspace_fragment>
  }
`;

/** Orbit rings and satellites around Earth; fade in as the tools section arrives. */
export default function Orbits({ reducedMotion }: { reducedMotion: boolean }) {
  const pixelRatio = useThree((s) => s.viewport.dpr);
  const satellites = useRef<THREE.Points>(null);
  const start = sceneIndex("tools") - 0.6;

  const { rings, basis, phases, speeds, geometry, ringMaterial, satMaterial } = useMemo(() => {
    const ringMaterial = new THREE.LineBasicMaterial({
      color: INK,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const rings: THREE.LineLoop[] = [];
    const basis: THREE.Quaternion[] = [];
    const phases: number[] = [];
    const speeds: number[] = [];
    const radii: number[] = [];

    for (const [radius, inc, node, speed, count] of RINGS) {
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(THREE.MathUtils.degToRad(inc), THREE.MathUtils.degToRad(node), 0, "YXZ"),
      );
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 192; i++) {
        const a = (i / 192) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius).applyQuaternion(q));
      }
      rings.push(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), ringMaterial));
      for (let s = 0; s < count; s++) {
        basis.push(q);
        phases.push((s / count) * Math.PI * 2 + Math.random());
        speeds.push(speed * (0.9 + Math.random() * 0.2));
        radii.push(radius);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(basis.length * 3), 3));
    geometry.setAttribute(
      "aSize",
      new THREE.BufferAttribute(new Float32Array(basis.map((_, i) => (i % 3 === 0 ? 1.4 : 1))), 1),
    );
    geometry.userData.radii = radii;

    const satMaterial = new THREE.ShaderMaterial({
      vertexShader: satVertex,
      fragmentShader: satFragment,
      uniforms: { uColor: { value: GOLD }, uPixelRatio: { value: 1 }, uOpacity: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    return { rings, basis, phases, speeds, geometry, ringMaterial, satMaterial };
  }, []);

  const v = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }) => {
    const t = THREE.MathUtils.clamp((scroll.view - start) / 0.6, 0, 1);
    const fade = t * t * (3 - 2 * t);
    ringMaterial.opacity = fade * 0.14;
    satMaterial.uniforms.uOpacity.value = fade;
    satMaterial.uniforms.uPixelRatio.value = pixelRatio;
    if (satellites.current) satellites.current.visible = fade > 0.001;

    const time = reducedMotion ? 0 : clock.elapsedTime;
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const radii = geometry.userData.radii as number[];
    for (let i = 0; i < basis.length; i++) {
      const a = phases[i] + time * speeds[i];
      v.set(Math.cos(a) * radii[i], 0, Math.sin(a) * radii[i]).applyQuaternion(basis[i]);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
  });

  return (
    <group>
      {rings.map((ring, i) => (
        <primitive key={i} object={ring} />
      ))}
      <points ref={satellites} geometry={geometry} material={satMaterial} frustumCulled={false} />
    </group>
  );
}
