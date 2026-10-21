"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { scroll } from "@/lib/scroll";
import { SUN_DIRECTION } from "@/lib/solar";

/** Volume the rocks drift through: the open sky the Intro and Hero cameras look into. */
const CENTER = new THREE.Vector3(0, 4.2, -3.4);
const HALF = new THREE.Vector3(7.5, 3.8, 3.6);
const SHAPES = 3;

// Deterministic pseudo-random so the field looks the same on every load.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A lumpy, flat-shaded rock: an icosphere pushed in and out along its normals. */
function rockGeometry(seed: number) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const rand = rng(seed);
  const bumps = Array.from({ length: 6 }, () => ({
    dir: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
    amp: 0.12 + rand() * 0.22,
  }));
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let r = 1;
    for (const b of bumps) r += b.amp * Math.pow(Math.max(v.dot(b.dir), 0), 3) - b.amp * 0.35;
    v.multiplyScalar(r);
    v.y *= 0.72;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

interface Rock {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  axis: THREE.Vector3;
  spin: number;
  angle: number;
  scale: number;
}

/** Slow-tumbling asteroids drifting through the sky of the Intro and Hero, gone by Your Sky. */
export default function AsteroidField({ count, reducedMotion }: { count: number; reducedMotion: boolean }) {
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  const group = useRef<THREE.Group>(null);

  const { geometries, material, rocks } = useMemo(() => {
    const rand = rng(7);
    const rocks: Rock[][] = Array.from({ length: SHAPES }, () => []);
    for (let i = 0; i < count; i++) {
      rocks[i % SHAPES].push({
        position: new THREE.Vector3(
          CENTER.x + (rand() * 2 - 1) * HALF.x,
          CENTER.y + (rand() * 2 - 1) * HALF.y,
          CENTER.z + (rand() * 2 - 1) * HALF.z,
        ),
        velocity: new THREE.Vector3(0.05 + rand() * 0.12, -0.01 - rand() * 0.02, (rand() - 0.5) * 0.04),
        axis: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
        spin: 0.1 + rand() * 0.5,
        angle: rand() * Math.PI * 2,
        // Mostly pebbles, a few larger boulders.
        scale: 0.03 + Math.pow(rand(), 3) * 0.16,
      });
    }
    return {
      geometries: Array.from({ length: SHAPES }, (_, i) => rockGeometry(11 + i * 17)),
      material: new THREE.MeshStandardMaterial({ color: "#8a8178", roughness: 1, metalness: 0, flatShading: true }),
      rocks,
    };
  }, [count]);

  const scratch = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3() }), []);

  useFrame((_, delta) => {
    const dt = reducedMotion ? 0 : Math.min(delta, 0.1);
    // Full in Intro and Hero, shrinking away while the camera heads to Your Sky.
    const t = THREE.MathUtils.clamp((scroll.journey - 1.15) / 0.6, 0, 1);
    const presence = 1 - t * t * (3 - 2 * t);
    if (group.current) group.current.visible = presence > 0.001;
    if (presence <= 0.001) return;

    rocks.forEach((set, k) => {
      const mesh = meshes.current[k];
      if (!mesh) return;
      set.forEach((rock, i) => {
        rock.position.addScaledVector(rock.velocity, dt);
        // Wrap around the volume so the field never empties.
        if (rock.position.x > CENTER.x + HALF.x) rock.position.x = CENTER.x - HALF.x;
        if (rock.position.y < CENTER.y - HALF.y) rock.position.y = CENTER.y + HALF.y;
        rock.angle += rock.spin * dt;
        scratch.q.setFromAxisAngle(rock.axis, rock.angle);
        scratch.s.setScalar(rock.scale * presence);
        scratch.m.compose(rock.position, scratch.q, scratch.s);
        mesh.setMatrixAt(i, scratch.m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    });
  });

  return (
    <group ref={group}>
      {/* Sunlight for the rocks only; Earth and the sky use their own shaders. */}
      <directionalLight position={SUN_DIRECTION.clone().multiplyScalar(10)} intensity={2.4} />
      <ambientLight intensity={0.06} />
      {rocks.map((set, k) => (
        <instancedMesh
          key={k}
          ref={(m) => {
            meshes.current[k] = m;
          }}
          args={[geometries[k], material, set.length]}
          frustumCulled={false}
        />
      ))}
    </group>
  );
}
