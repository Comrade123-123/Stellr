"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls, useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  earthRotation,
  observerOnGlobe,
  stateAt,
  sunDirection,
  track,
  type Observer,
  type Satellite,
} from "@/lib/orbits";

const GOLD = new THREE.Color("#c9a46a");

const earthVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/* Day side from the day map, night side from the city-lights map, a soft terminator between. */
const earthFragment = /* glsl */ `
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform sampler2D uClouds;
  uniform vec3 uSun;
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vec3 N = normalize(vNormal);
    float ndl = dot(N, normalize(uSun));
    float day = smoothstep(-0.12, 0.18, ndl);
    float cloud = texture2D(uClouds, vUv).r;
    vec3 lit = texture2D(uDay, vUv).rgb * (1.0 - cloud * 0.4) * (max(ndl, 0.0) * 1.1 + 0.05) + vec3(cloud) * max(ndl, 0.0) * 0.8;
    vec3 night = pow(texture2D(uNight, vUv).rgb, vec3(1.4)) * vec3(1.0, 0.78, 0.5) * 2.2 * (1.0 - cloud * 0.7);
    gl_FragColor = vec4(mix(night, lit, day), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/* Thin blue limb, brightest on the sunlit side. */
const airFragment = /* glsl */ `
  uniform vec3 uSun;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 3.0);
    float lit = smoothstep(-0.3, 0.4, dot(normalize(vNormal), normalize(uSun)));
    gl_FragColor = vec4(vec3(0.35, 0.6, 1.0) * rim * lit * 1.2, rim * lit);
  }
`;
const airVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = cameraPosition - w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const pointVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  uniform float uPixelRatio;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio;
  }
`;
const pointFragment = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = 1.0 - smoothstep(0.55, 1.0, d);
    gl_FragColor = vec4(vColor * a, a);
  }
`;

const toPoint = new THREE.Vector3();
/** True when Earth (the unit sphere) stands between the camera and `point`. */
function behindEarth(camera: THREE.Vector3, point: THREE.Vector3) {
  const d = toPoint.subVectors(point, camera);
  const len = d.length();
  d.divideScalar(len);
  const b = camera.dot(d);
  const c = camera.lengthSq() - 1;
  const disc = b * b - c;
  if (disc <= 0) return false;
  const t = -b - Math.sqrt(disc);
  return t > 0 && t < len - 1e-3;
}

function Earth({ observer }: { observer: Observer | null }) {
  const spin = useRef<THREE.Group>(null);
  const [day, night, clouds] = useTexture([
    "/textures/2k_earth_daymap.jpg",
    "/textures/2k_earth_nightmap.jpg",
    "/textures/2k_earth_clouds.jpg",
  ]);
  const sun = useMemo(() => new THREE.Vector3(1, 0, 0), []);
  const materials = useMemo(() => {
    day.colorSpace = THREE.SRGBColorSpace;
    night.colorSpace = THREE.SRGBColorSpace;
    return {
      earth: new THREE.ShaderMaterial({
        vertexShader: earthVertex,
        fragmentShader: earthFragment,
        uniforms: { uDay: { value: day }, uNight: { value: night }, uClouds: { value: clouds }, uSun: { value: sun } },
      }),
      air: new THREE.ShaderMaterial({
        vertexShader: airVertex,
        fragmentShader: airFragment,
        uniforms: { uSun: { value: sun } },
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    };
  }, [day, night, clouds, sun]);
  const pin = useMemo(() => (observer ? new THREE.Vector3(...observerOnGlobe(observer)) : null), [observer]);
  const pinGroup = useRef<THREE.Group>(null);
  const pinLabel = useRef<HTMLSpanElement>(null);
  const pinWorld = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera }) => {
    const now = new Date();
    sun.set(...sunDirection(now));
    if (spin.current) spin.current.rotation.y = earthRotation(now);
    // HTML labels draw over the canvas, so hide the pin's label while it is round the far side.
    if (pinGroup.current && pinLabel.current) {
      pinGroup.current.getWorldPosition(pinWorld);
      pinLabel.current.style.opacity = behindEarth(camera.position, pinWorld) ? "0" : "1";
    }
  });

  return (
    <>
      <group ref={spin}>
        <mesh material={materials.earth}>
          <sphereGeometry args={[1, 96, 96]} />
        </mesh>
        {pin && (
          <group ref={pinGroup} position={pin.clone().multiplyScalar(1.003)}>
            <mesh>
              <sphereGeometry args={[0.008, 12, 12]} />
              <meshBasicMaterial color={GOLD} toneMapped={false} />
            </mesh>
            <Html center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
              <span ref={pinLabel} className="block whitespace-nowrap pt-7 font-mono text-[10px] tracking-[0.22em] text-gold">
                YOU
              </span>
            </Html>
          </group>
        )}
      </group>
      <mesh material={materials.air} scale={1.045}>
        <sphereGeometry args={[1, 64, 64]} />
      </mesh>
    </>
  );
}

function Stars() {
  const geometry = useMemo(() => {
    const n = 2500;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.randomDirection().multiplyScalar(90);
      v.toArray(pos, i * 3);
      const b = 0.25 + Math.random() ** 4 * 0.75;
      col.set([b, b, b * 1.05], i * 3);
      size[i] = 1 + Math.random() ** 6 * 1.5;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    return g;
  }, []);
  const material = usePointMaterial();
  return <points geometry={geometry} material={material} />;
}

function usePointMaterial() {
  const dpr = useThree((s) => s.viewport.dpr);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: pointVertex,
        fragmentShader: pointFragment,
        uniforms: { uPixelRatio: { value: 1 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  useEffect(() => {
    material.uniforms.uPixelRatio.value = dpr;
  }, [dpr, material]);
  return material;
}

/** Every satellite as a dot, moved ten times a second; the tracked one gold and larger. */
function Satellites({ sats, tracked }: { sats: Satellite[]; tracked: Satellite | null }) {
  const material = usePointMaterial();
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(sats.length * 3), 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(sats.length * 3), 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(sats.length), 1));
    return g;
  }, [sats]);
  const last = useRef(0);

  useEffect(() => {
    const color = geometry.attributes.aColor as THREE.BufferAttribute;
    const size = geometry.attributes.aSize as THREE.BufferAttribute;
    sats.forEach((s, i) => {
      const isTracked = s === tracked;
      const c = isTracked ? GOLD.clone().multiplyScalar(1.6) : new THREE.Color(0.75, 0.82, 0.95);
      color.setXYZ(i, c.r, c.g, c.b);
      size.setX(i, isTracked ? 9 : 3.5);
    });
    color.needsUpdate = true;
    size.needsUpdate = true;
    last.current = 0;
  }, [geometry, sats, tracked]);

  useFrame(() => {
    const t = performance.now();
    if (t - last.current < 100) return;
    last.current = t;
    const now = new Date();
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    sats.forEach((s, i) => {
      const st = stateAt(s, now);
      if (st) pos.setXYZ(i, ...st.scene);
      else pos.setXYZ(i, 0, 0, 0);
    });
    pos.needsUpdate = true;
    geometry.computeBoundingSphere();
  });

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={2} />;
}

/** The tracked satellite's path: the last half orbit dim, the next orbit bright. Redrawn every 30 s. */
function OrbitTrail({ sat, name }: { sat: Satellite; name: string }) {
  const past = useMemo(() => new THREE.BufferGeometry(), []);
  const ahead = useMemo(() => new THREE.BufferGeometry(), []);
  const label = useRef<THREE.Group>(null);
  const labelText = useRef<HTMLSpanElement>(null);
  const last = useRef(-Infinity);
  const lines = useMemo(
    () => ({
      past: new THREE.Line(past, new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.22, depthWrite: false })),
      ahead: new THREE.Line(ahead, new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.7, depthWrite: false })),
    }),
    [past, ahead],
  );

  useEffect(() => {
    last.current = -Infinity;
  }, [sat]);

  useFrame(({ camera }) => {
    const t = performance.now();
    const now = new Date();
    if (t - last.current > 30_000) {
      last.current = t;
      past.setFromPoints(track(sat, now, -46, 0).map((p) => new THREE.Vector3(...p)));
      ahead.setFromPoints(track(sat, now, 0, 93).map((p) => new THREE.Vector3(...p)));
    }
    const st = stateAt(sat, now);
    if (st && label.current) {
      label.current.position.set(...st.scene);
      if (labelText.current) labelText.current.style.opacity = behindEarth(camera.position, label.current.position) ? "0" : "1";
    }
  });

  return (
    <>
      <primitive object={lines.past} />
      <primitive object={lines.ahead} />
      <group ref={label}>
        <Html center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
          <span ref={labelText} className="block whitespace-nowrap pb-8 font-mono text-[10px] tracking-[0.22em] text-gold">
            {name.toUpperCase()}
          </span>
        </Html>
      </group>
    </>
  );
}

/** Keeps the camera over the tracked satellite until the visitor drags the globe. */
/** On wide screens the panel covers the right of the canvas, so centre the globe in the space left of it. */
export type SwarmStatus = { state: "off" | "loading" | "error" } | { state: "on"; count: number };

/**
 * Every active satellite as a faint dot. A Web Worker loads and propagates them every 4 s,
 * so the thousands of SGP4 runs never stall the page; mounting starts it, unmounting stops it.
 */
function Swarm({ onStatus }: { onStatus: (s: SwarmStatus) => void }) {
  const geometry = useMemo(() => new THREE.BufferGeometry(), []);
  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        color: new THREE.Color(0.62, 0.72, 0.9),
        size: 1.6,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    [],
  );
  const status = useRef(onStatus);
  useEffect(() => {
    status.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    const worker = new Worker(new URL("../../lib/swarm.worker.ts", import.meta.url), { type: "module" });
    status.current({ state: "loading" });
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type: "loaded"; count: number } | { type: "positions"; positions: Float32Array } | { type: "error" };
      if (msg.type === "loaded") status.current({ state: "on", count: msg.count });
      if (msg.type === "error") status.current({ state: "error" });
      if (msg.type === "positions") {
        geometry.setAttribute("position", new THREE.BufferAttribute(msg.positions, 3));
        geometry.computeBoundingSphere();
      }
    };
    worker.onerror = () => status.current({ state: "error" });
    worker.postMessage({ type: "start" });
    return () => {
      worker.terminate();
      status.current({ state: "off" });
    };
  }, [geometry]);

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={1} />;
}

function MakeRoomForPanel() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  useEffect(() => {
    const shift = size.width >= 1024 ? 200 : 0;
    if (shift) camera.setViewOffset(size.width, size.height, shift, 0, size.width, size.height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

function Follow({ sat, follow, controls }: { sat: Satellite | null; follow: boolean; controls: React.RefObject<OrbitControlsImpl | null> }) {
  const camera = useThree((s) => s.camera);
  const goal = useMemo(() => new THREE.Vector3(), []);
  const next = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, delta) => {
    if (!follow || !sat) return;
    const now = new Date();
    const st = stateAt(sat, now);
    const ahead = stateAt(sat, new Date(now.getTime() + 60_000));
    if (!st || !ahead) return;
    const distance = camera.position.length();
    // Above the satellite but leaning off its orbital plane, so the orbit reads as a curve, not an edge-on line.
    goal.set(...st.scene);
    next.set(...ahead.scene).cross(goal).normalize();
    goal.normalize().addScaledVector(next, -0.55).normalize().multiplyScalar(distance);
    // Lerping across the sphere cuts the chord, so put the camera back at its distance afterwards.
    camera.position.lerp(goal, 1 - Math.exp(-Math.min(delta, 0.1) * 2)).setLength(distance);
    controls.current?.update();
  });
  return null;
}

export default function OrbitScene({
  sats,
  tracked,
  trackedName,
  observer,
  follow,
  onUserMove,
  swarm,
  onSwarmStatus,
}: {
  sats: Satellite[];
  tracked: Satellite | null;
  trackedName: string;
  observer: Observer | null;
  follow: boolean;
  onUserMove: () => void;
  swarm: boolean;
  onSwarmStatus: (s: SwarmStatus) => void;
}) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ fov: 40, near: 0.01, far: 200, position: [0, 1.6, 3.6] }}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      onCreated={({ gl, camera, size }) => {
        gl.setClearColor("#000000");
        // Portrait screens show the globe in a short strip, so start further out.
        if (size.width / size.height < 0.9) camera.position.setLength(5.6);
      }}
    >
      <Stars />
      <Earth observer={observer} />
      {swarm && <Swarm onStatus={onSwarmStatus} />}
      {sats.length > 0 && <Satellites sats={sats} tracked={tracked} />}
      {tracked && <OrbitTrail sat={tracked} name={trackedName} />}
      <MakeRoomForPanel />
      <Follow sat={tracked} follow={follow} controls={controls} />
      <OrbitControls
        ref={controls}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.5}
        minDistance={1.35}
        maxDistance={9}
        onStart={onUserMove}
      />
    </Canvas>
  );
}
