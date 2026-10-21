"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF, useTexture } from "@react-three/drei";
import * as THREE from "three";
import {
  ASTRONAUT,
  BLACK_HOLE_DIRECTION,
  PLANETOID_CENTER,
  PLANETOID_RADIUS,
  surfaceAt,
} from "@/lib/outpost";
import { scroll, sceneIndex } from "@/lib/scroll";

const MODEL = "/models/astronaut-z2.glb";
const DISK_LIGHT = new THREE.Color(1.0, 0.7, 0.38);

const groundVertex = /* glsl */ `
  varying vec3 vWorld;

  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }

  void main() {
    vec3 n = normalize(normal);
    // Rolling relief so the horizon isn't a perfect arc.
    float relief = noise(position * 0.12) * 0.7 + noise(position * 0.45) * 0.3;
    vec4 w = modelMatrix * vec4(position + n * (relief - 0.5) * 1.4, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

/*
 * Regolith lit almost entirely by the black hole's disk, low on the horizon:
 * a real lunar-surface photo texture + normal map at two scales (hides tiling),
 * grazing gold key light, a faint cool fill, a bright rim along the horizon,
 * and warm dust haze thickening with distance.
 */
const groundFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform sampler2D uNormal;
  uniform vec3 uLight;
  uniform vec3 uLightColor;
  uniform vec3 uCenter;
  varying vec3 vWorld;

  vec3 sampleNormal(vec2 uv) { return texture2D(uNormal, uv).xyz * 2.0 - 1.0; }

  void main() {
    vec3 Ng = normalize(vWorld - uCenter);
    vec3 T = normalize(cross(vec3(0.0, 0.0, 1.0), Ng));
    vec3 B = cross(Ng, T);

    vec2 uvA = vWorld.xz * 0.32;
    vec2 uvB = vWorld.xz * 0.061 + 0.37;
    vec3 albedo = mix(texture2D(uMap, uvA).rgb, texture2D(uMap, uvB).rgb, 0.45);
    vec3 nt = normalize(mix(sampleNormal(uvA), sampleNormal(uvB), 0.4) * vec3(1.6, 1.6, 1.0));
    vec3 N = normalize(T * nt.x + B * nt.y + Ng * nt.z);

    vec3 V = normalize(cameraPosition - vWorld);
    vec3 L = normalize(uLight);
    float dist = length(cameraPosition - vWorld);

    float key = max(dot(N, L), 0.0);
    float lit = smoothstep(-0.05, 0.25, dot(Ng, L) + 0.18);
    vec3 col = albedo * albedo * (uLightColor * key * 0.75 * lit + vec3(0.012, 0.013, 0.016));

    // The horizon catches the disk's light edge-on.
    float rim = pow(1.0 - max(dot(Ng, V), 0.0), 42.0);
    col += uLightColor * rim * 2.4;

    // Dust haze: warmer and brighter toward the black hole, thickening with distance.
    float toward = pow(max(dot(-V, L), 0.0), 3.0);
    vec3 haze = mix(vec3(0.03, 0.022, 0.016), uLightColor * 0.42, toward);
    col = mix(col, haze, 1.0 - exp(-dist * 0.012));

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function rockGeometry(seed: number) {
  const g = new THREE.IcosahedronGeometry(1, 3);
  let s = seed;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const bumps = Array.from({ length: 7 }, () => ({
    d: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
    a: 0.1 + rand() * 0.28,
  }));
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let r = 1;
    for (const b of bumps) r += b.a * Math.pow(Math.max(v.dot(b.d), 0), 2.5) - b.a * 0.3;
    v.multiplyScalar(r);
    v.y *= 0.62;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Boulders around the astronaut, half-buried, catching the disk light: x, z, size, yaw. */
const BOULDERS: [number, number, number, number][] = [
  [-3.6, 41.5, 0.32, 0.4],
  [4.9, 42.6, 0.26, 2.6],
  [-6.5, 37.0, 0.55, 1.2],
  [8.2, 36.5, 0.5, 0.1],
  [3.9, 40.2, 0.14, 2.2],
  [-1.8, 38.6, 0.22, 3.0],
  [1.5, 44.6, 0.09, 0.3],
];

/** The dark planetoid the opening cameras stand on, and NASA's Z2 suit facing the black hole. */
export default function Outpost({ segments }: { segments: number }) {
  const group = useRef<THREE.Group>(null);
  const sky = sceneIndex("sky");
  const anisotropy = useThree((s) => Math.min(8, s.gl.capabilities.getMaxAnisotropy()));

  const [map, normal] = useTexture(["/textures/regolith_diff_1k.jpg", "/textures/regolith_nor_gl_1k.jpg"]);
  const { scene: suit } = useGLTF(MODEL, false, true);

  const ground = useMemo(() => {
    map.colorSpace = THREE.SRGBColorSpace;
    for (const t of [map, normal]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = anisotropy;
      t.needsUpdate = true;
    }
    return new THREE.ShaderMaterial({
      vertexShader: groundVertex,
      fragmentShader: groundFragment,
      uniforms: {
        uMap: { value: map },
        uNormal: { value: normal },
        uLight: { value: BLACK_HOLE_DIRECTION },
        uLightColor: { value: DISK_LIGHT },
        uCenter: { value: PLANETOID_CENTER },
      },
    });
  }, [map, normal, anisotropy]);

  const rocks = useMemo(() => {
    const material = new THREE.MeshStandardMaterial({ map, normalMap: normal, roughness: 0.95, metalness: 0 });
    const geometries = [rockGeometry(11), rockGeometry(29), rockGeometry(47)];
    return BOULDERS.map(([x, z, size, yaw], i) => {
      const { position, up } = surfaceAt(x, z);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
      return { geometry: geometries[i % 3], material, position: position.addScaledVector(up, size * 0.15), quaternion: q, size };
    });
  }, [map, normal]);

  // Stand the suit on the surface, facing the black hole (its back to the camera).
  const astronaut = useMemo(() => {
    const up = ASTRONAUT.up;
    const ahead = BLACK_HOLE_DIRECTION.clone().addScaledVector(up, -BLACK_HOLE_DIRECTION.dot(up)).normalize();
    const side = new THREE.Vector3().crossVectors(up, ahead).normalize();
    const basis = new THREE.Matrix4().makeBasis(side, up, ahead);
    return { position: ASTRONAUT.position, quaternion: new THREE.Quaternion().setFromRotationMatrix(basis) };
  }, []);

  useEffect(() => {
    suit.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = mesh.material as THREE.MeshStandardMaterial;
      // Dusty fabric, not plastic: kill most of the baked shine.
      m.roughness = Math.max(m.roughness ?? 1, 0.85);
      m.envMapIntensity = 0;
    });
  }, [suit]);

  const keyLight = useMemo(() => {
    const light = new THREE.DirectionalLight(DISK_LIGHT, 3.4);
    light.position.copy(ASTRONAUT.position).addScaledVector(BLACK_HOLE_DIRECTION, 30);
    light.target.position.copy(ASTRONAUT.position);
    return light;
  }, []);

  useFrame(() => {
    // Here for the Intro and Hero; gone once the camera has lifted off towards Earth.
    if (group.current) group.current.visible = scroll.journey < sky - 0.25;
  });

  return (
    <group ref={group}>
      {/* The disk is the only real light source out here: warm, low, from the black hole. */}
      <primitive object={keyLight} />
      <primitive object={keyLight.target} />
      {/* Faint cool starlight from behind the camera so the suit isn't a flat cut-out. */}
      <directionalLight
        position={[ASTRONAUT.position.x - 6, ASTRONAUT.position.y + 4, ASTRONAUT.position.z + 14]}
        color="#9fb3d1"
        intensity={0.55}
      />
      <ambientLight color="#ffcf9a" intensity={0.18} />

      <mesh material={ground} position={PLANETOID_CENTER}>
        <sphereGeometry args={[PLANETOID_RADIUS, segments * 3, segments * 2]} />
      </mesh>

      {rocks.map((r, i) => (
        <mesh key={i} geometry={r.geometry} material={r.material} position={r.position} quaternion={r.quaternion} scale={r.size} />
      ))}

      <group position={astronaut.position} quaternion={astronaut.quaternion}>
        {/* NASA Z2 suit (public domain), ~1.9 units tall at scale 1. */}
        <primitive object={suit} scale={0.4} />
      </group>
    </group>
  );
}

useGLTF.preload(MODEL, false, true);
