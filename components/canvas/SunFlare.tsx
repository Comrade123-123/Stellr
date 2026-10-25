"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SUNRISE_DIRECTION } from "@/lib/launch";
import { scroll, sceneIndex } from "@/lib/scroll";

const DISTANCE = 1450;

const vertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

/*
 * First light over Earth's limb, as a camera would record it: a white-hot point,
 * a warm halo, a short horizontal glint and a long vertical anamorphic beam.
 * Offsets are measured in the camera's own right/up axes so the streaks stay
 * screen-aligned however the camera is rolled.
 */
const fragment = /* glsl */ `
  uniform vec3 uSun;
  uniform vec3 uRight;
  uniform vec3 uUp;
  uniform float uOpacity;
  uniform float uTime;
  varying vec3 vWorld;

  void main() {
    vec3 ray = normalize(vWorld - cameraPosition);
    vec3 S = normalize(uSun);
    if (dot(ray, S) <= 0.0 || uOpacity <= 0.0) discard;
    vec3 off = ray / dot(ray, S) - S;   // tangent-plane offset (≈ radians)
    float dx = dot(off, uRight);
    float dy = dot(off, uUp);
    float r = length(vec2(dx, dy));

    float pulse = 0.94 + 0.06 * sin(uTime * 0.7);
    float core = exp(-r * r / 0.000025) * 7.0;
    float halo = exp(-r / 0.025) * 0.9 + exp(-r / 0.12) * 0.18;
    float beam = exp(-abs(dx) / 0.0016) * (0.25 + 1.6 * exp(-abs(dy) / 0.32));
    float glint = exp(-abs(dy) / 0.0015) * exp(-abs(dx) / 0.07) * 1.2;

    vec3 col = vec3(1.0, 0.93, 0.8) * core
             + vec3(1.0, 0.55, 0.18) * (halo + glint)
             + vec3(1.0, 0.36, 0.08) * beam;
    col *= pulse * uOpacity;
    float a = clamp(core + halo + beam + glint, 0.0, 1.0) * uOpacity;
    gl_FragColor = vec4(col, a);
  }
`;

/** The sunrise flare and light beam over Earth's horizon, shown around the Hero. */
export default function SunFlare({ reducedMotion }: { reducedMotion: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const hero = sceneIndex("hero");

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          uSun: { value: SUNRISE_DIRECTION },
          uRight: { value: new THREE.Vector3(1, 0, 0) },
          uUp: { value: new THREE.Vector3(0, 1, 0) },
          uOpacity: { value: 0 },
          uTime: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const fwd = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    // Rises in as the camera reaches orbit, fades as it moves on to Your Sky.
    const d = Math.abs(scroll.view - hero);
    const opacity = THREE.MathUtils.clamp(1 - (d - 0.15) / 0.45, 0, 1);
    material.uniforms.uOpacity.value = opacity * opacity * (3 - 2 * opacity);
    m.visible = opacity > 0.001;
    if (!m.visible) return;
    if (!reducedMotion) material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
    material.uniforms.uUp.value.setFromMatrixColumn(camera.matrixWorld, 1);

    camera.getWorldDirection(fwd);
    m.position.copy(camera.position).addScaledVector(fwd, DISTANCE);
    m.quaternion.copy(camera.quaternion);
    const h = 2 * DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.08;
    m.scale.set(h * camera.aspect, h, 1);
  });

  return (
    <mesh ref={mesh} material={material} frustumCulled={false} renderOrder={6}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}
