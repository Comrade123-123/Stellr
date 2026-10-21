"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { scroll } from "@/lib/scroll";

const SKY_RADIUS = 60;
const POOL = 3;
const DURATION = 0.75;

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// uv.x runs tail (0) → head (1); bright head, fading tail, thin across.
const fragment = /* glsl */ `
  uniform float uLife;
  varying vec2 vUv;
  void main() {
    float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
    float trail = pow(vUv.x, 2.2);
    float head = smoothstep(0.92, 1.0, vUv.x) * 1.5;
    float envelope = sin(uLife * 3.14159);
    float a = (trail + head) * pow(across, 2.5) * envelope;
    gl_FragColor = vec4(vec3(1.0, 0.92, 0.78) * a * 3.0, a);
  }
`;

interface Streak {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  wait: number;
  life: number;
  start: THREE.Vector3;
  dir: THREE.Vector3;
  span: number;
  length: number;
}

/** Occasional shooting stars across the sky in the opening sections, near where the camera looks. */
export default function Meteors({ reducedMotion }: { reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);

  const streaks = useMemo<Streak[]>(() => {
    const geometry = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);
    return Array.from({ length: POOL }, (_, i) => {
      const material = new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: { uLife: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      return {
        mesh,
        material,
        wait: 1.5 + i * 3.2,
        life: -1,
        start: new THREE.Vector3(),
        dir: new THREE.Vector3(),
        span: 0,
        length: 0,
      };
    });
  }, []);

  const scratch = useMemo(
    () => ({
      fwd: new THREE.Vector3(),
      head: new THREE.Vector3(),
      x: new THREE.Vector3(),
      y: new THREE.Vector3(),
      z: new THREE.Vector3(),
      m: new THREE.Matrix4(),
    }),
    [],
  );

  useFrame((_, delta) => {
    if (!group.current) return;
    // Pinned to the camera like the starfield, so streaks read as infinitely far away.
    group.current.position.copy(camera.position);
    const active = !reducedMotion && scroll.journey < 2.5;
    const dt = Math.min(delta, 0.1);

    for (const s of streaks) {
      if (s.life < 0) {
        s.mesh.visible = false;
        if (!active) continue;
        s.wait -= dt;
        if (s.wait > 0) continue;
        // Spawn somewhere in the upper part of the current view, travelling down and across.
        camera.getWorldDirection(scratch.fwd);
        s.start
          .copy(scratch.fwd)
          .add(new THREE.Vector3((Math.random() - 0.5) * 0.9, 0.15 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4))
          .normalize()
          .multiplyScalar(SKY_RADIUS);
        const side = Math.random() < 0.5 ? -1 : 1;
        s.dir.set(side, -0.35 - Math.random() * 0.3, 0).normalize();
        s.dir.addScaledVector(s.start, -s.dir.dot(s.start) / s.start.lengthSq()).normalize(); // tangent to the sky
        s.span = 10 + Math.random() * 8;
        s.length = 4 + Math.random() * 3;
        s.life = 0;
        continue;
      }

      s.life += dt / DURATION;
      if (s.life >= 1) {
        s.life = -1;
        s.wait = 3 + Math.random() * 6;
        continue;
      }
      s.mesh.visible = true;
      s.material.uniforms.uLife.value = s.life;
      scratch.head.copy(s.start).addScaledVector(s.dir, s.span * s.life);
      // Orient the strip along its motion, facing the camera (at the group origin).
      scratch.x.copy(s.dir);
      scratch.z.copy(scratch.head).negate().normalize();
      scratch.y.crossVectors(scratch.z, scratch.x).normalize();
      scratch.m.makeBasis(scratch.x, scratch.y, scratch.z);
      s.mesh.quaternion.setFromRotationMatrix(scratch.m);
      s.mesh.position.copy(scratch.head).addScaledVector(s.dir, -s.length);
      s.mesh.scale.set(s.length, 0.22, 1);
    }
  });

  return (
    <group ref={group}>
      {streaks.map((s, i) => (
        <primitive key={i} object={s.mesh} />
      ))}
    </group>
  );
}
