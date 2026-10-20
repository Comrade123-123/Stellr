"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html, useTexture } from "@react-three/drei";
import * as THREE from "three";
import { scroll, sceneIndex } from "@/lib/scroll";
import { EARTH_ORBIT, ORBIT_PLANE, PLANETS, SUN_POSITION, orbitPoint, orbitRadius } from "@/lib/solar";

const SUN_RADIUS = 6;
const GOLD = new THREE.Color("#c9a46a");
const INK = new THREE.Color("#eceef2");

// Spread used until today's real longitudes arrive (radians prograde of Earth).
const FALLBACK_ANGLES = [1.1, 2.6, -0.7, 2.1, -2.4, 0.4, -1.5];

const coronaVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const coronaFragment = /* glsl */ `
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float glow = pow(max(1.0 - d, 0.0), 3.0);
    gl_FragColor = vec4(vec3(1.0, 0.78, 0.45) * glow * 1.4, glow);
  }
`;

/** Planet names sit above their planet; Earth's sits below so close neighbours never collide. */
function Label({ text, accent = false, below = false }: { text: string; accent?: boolean; below?: boolean }) {
  return (
    <Html center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
      <span
        className={`block whitespace-nowrap ${below ? "pt-9" : "pb-9"} font-mono text-[10px] tracking-[0.22em] ${accent ? "text-gold" : "text-ink/60"}`}
      >
        {text}
      </span>
    </Html>
  );
}

/** The Sun and planets at today's real heliocentric longitudes, shown around the Cosmoscope section. */
export default function SolarSystem({ reducedMotion }: { reducedMotion: boolean }) {
  const root = useRef<THREE.Group>(null);
  const corona = useRef<THREE.Mesh>(null);
  const spinners = useRef<THREE.Mesh[]>([]);
  const camera = useThree((s) => s.camera);
  const cosmo = sceneIndex("cosmoscope");
  const [angles, setAngles] = useState(FALLBACK_ANGLES);
  const [labels, setLabels] = useState(false);

  const textures = useTexture([
    "/textures/2k_sun.jpg",
    ...PLANETS.map((p) => p.texture),
    "/textures/2k_saturn_ring_alpha.png",
  ]);

  useEffect(() => {
    let cancelled = false;
    import("astronomy-engine").then(({ Body, EclipticLongitude }) => {
      if (cancelled) return;
      const now = new Date();
      const earth = EclipticLongitude(Body.Earth, now);
      setAngles(
        PLANETS.map((p) =>
          THREE.MathUtils.degToRad(EclipticLongitude(Body[p.body as keyof typeof Body], now) - earth),
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const scene = useMemo(() => {
    for (const t of textures) t.colorSpace = THREE.SRGBColorSpace;
    const [sunMap, ...rest] = textures;
    const ringMap = rest.pop()!;

    const sun = new THREE.MeshBasicMaterial({ map: sunMap, color: new THREE.Color(2.4, 2.0, 1.5), toneMapped: false });
    const coronaMaterial = new THREE.ShaderMaterial({
      vertexShader: coronaVertex,
      fragmentShader: coronaFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const planetMaterials = rest.map((map) => new THREE.MeshLambertMaterial({ map }));

    // Ring UVs run radially so the 1-D ring texture maps inner → outer edge.
    const ringGeometry = new THREE.RingGeometry(1.25, 2.3, 96, 1);
    const pos = ringGeometry.attributes.position;
    const uv = ringGeometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i));
      uv.setXY(i, (r - 1.25) / (2.3 - 1.25), 0.5);
    }
    const ringMaterial = new THREE.MeshLambertMaterial({
      map: ringMap,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const orbitLines = [EARTH_ORBIT, ...PLANETS.map((p) => orbitRadius(p.au))].map((radius, i) => {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k < 256; k++) {
        const a = (k / 256) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
      }
      const material = new THREE.LineBasicMaterial({
        color: i === 0 ? GOLD : INK,
        transparent: true,
        opacity: i === 0 ? 0.55 : 0.14,
        depthWrite: false,
      });
      return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), material);
    });

    return { sun, coronaMaterial, planetMaterials, ringGeometry, ringMaterial, orbitLines };
  }, [textures]);

  const positions = useMemo(
    () => PLANETS.map((p, i) => orbitPoint(orbitRadius(p.au), angles[i])),
    [angles],
  );

  useFrame((_, delta) => {
    const near = Math.abs(scroll.journey - cosmo) < 1.05;
    if (root.current) root.current.visible = near;
    if (near !== labels) setLabels(near);
    if (!near) return;
    corona.current?.quaternion.copy(camera.quaternion);
    if (!reducedMotion) for (const m of spinners.current) if (m) m.rotation.y += Math.min(delta, 0.1) * 0.15;
  });

  return (
    <group ref={root} visible={false}>
      <ambientLight intensity={0.05} />
      <pointLight position={SUN_POSITION} intensity={3.2} decay={0} />

      <group position={SUN_POSITION}>
        <mesh material={scene.sun}>
          <sphereGeometry args={[SUN_RADIUS, 48, 48]} />
        </mesh>
        <mesh ref={corona} material={scene.coronaMaterial} scale={SUN_RADIUS * 6}>
          <planeGeometry args={[1, 1]} />
        </mesh>
        {labels && <Label text="SUN" />}
      </group>

      <group position={SUN_POSITION} quaternion={ORBIT_PLANE}>
        {scene.orbitLines.map((line, i) => (
          <primitive key={i} object={line} />
        ))}
      </group>

      {PLANETS.map((p, i) => (
        <group key={p.name} position={positions[i]}>
          <mesh
            ref={(m) => {
              if (m) spinners.current[i] = m;
            }}
            material={scene.planetMaterials[i]}
            scale={p.radius}
          >
            <sphereGeometry args={[1, 40, 40]} />
          </mesh>
          {p.ring && (
            <mesh
              geometry={scene.ringGeometry}
              material={scene.ringMaterial}
              scale={p.radius}
              rotation={[-Math.PI / 2 + THREE.MathUtils.degToRad(26.7), 0, 0]}
            />
          )}
          {labels && <Label text={p.name.toUpperCase()} />}
        </group>
      ))}

      {labels && (
        <group position={[0, 0, 0]}>
          <Label text="EARTH · YOU ARE HERE" accent below />
        </group>
      )}
    </group>
  );
}
