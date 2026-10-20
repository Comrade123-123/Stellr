"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import { scroll, sceneIndex } from "@/lib/scroll";
import { useAppStore } from "@/lib/store";

/** Sun direction in world space, shared by every lit surface around Earth. */
export const SUN_DIRECTION = new THREE.Vector3(0.9, 0.28, 0.65).normalize();

const ATMOSPHERE = new THREE.Color(0.3, 0.58, 1.0);
const AXIAL_TILT = THREE.MathUtils.degToRad(23.4);
const GOLD = new THREE.Color("#c9a46a");

const BASE_TILT = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, AXIAL_TILT));

/** Unit position of a lat/lon in SphereGeometry's own UV parameterisation. */
function surfacePoint(lat: number, lon: number) {
  const phi = ((lon + 180) / 360) * Math.PI * 2;
  const theta = ((90 - lat) / 180) * Math.PI;
  const position = new THREE.Vector3(
    -Math.cos(phi) * Math.sin(theta),
    Math.cos(theta),
    Math.sin(phi) * Math.sin(theta),
  );
  return position;
}

const surfaceVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const earthFragment = /* glsl */ `
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform sampler2D uClouds;
  uniform vec3 uSun;
  uniform vec3 uAtmosphere;
  uniform float uCloudShift;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorld;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 L = normalize(uSun);
    float ndl = dot(N, L);
    float dayMix = smoothstep(-0.2, 0.3, ndl);

    // Clouds rotate a little faster than the ground; shadow follows them.
    float cloud = texture2D(uClouds, vUv - vec2(uCloudShift, 0.0)).r;

    vec3 day = texture2D(uDay, vUv).rgb;
    day *= 1.0 - cloud * 0.45;
    vec3 lit = day * (max(ndl, 0.0) * 1.2 + 0.02);

    // Sun glint on water: oceans are the pixels where blue beats red.
    float ocean = smoothstep(0.0, 0.06, day.b - day.r);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 160.0) * ocean * (1.0 - cloud);
    lit += vec3(1.0, 0.92, 0.8) * spec * 0.45 * smoothstep(0.0, 0.25, ndl);

    vec3 night = texture2D(uNight, vUv).rgb;
    night = pow(night, vec3(1.35)) * vec3(1.0, 0.76, 0.48) * 2.6 * (1.0 - cloud * 0.75);

    vec3 color = lit * dayMix + night * (1.0 - dayMix);

    // Thin atmospheric scattering along the limb, only where the sun reaches.
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    float sunSide = smoothstep(-0.25, 0.55, ndl);
    color += uAtmosphere * fresnel * sunSide * 1.3;

    // Warm band along the terminator.
    float dusk = smoothstep(-0.18, 0.0, ndl) * smoothstep(0.22, 0.0, ndl);
    color += vec3(1.0, 0.42, 0.12) * dusk * fresnel * 0.3;

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const cloudFragment = /* glsl */ `
  uniform sampler2D uClouds;
  uniform vec3 uSun;
  uniform vec3 uAtmosphere;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorld;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorld);
    float ndl = dot(N, normalize(uSun));
    float light = smoothstep(-0.15, 0.4, ndl);
    float density = texture2D(uClouds, vUv).r;

    vec3 color = vec3(0.03) + vec3(1.0, 0.98, 0.96) * max(ndl, 0.0) * 1.05;
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.5);
    color += uAtmosphere * fresnel * light * 0.35;

    gl_FragColor = vec4(color, density * (0.12 + 0.88 * light));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const atmosphereFragment = /* glsl */ `
  uniform vec3 uSun;
  uniform vec3 uAtmosphere;
  varying vec3 vNormal;
  varying vec3 vWorld;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorld);
    // Back faces only: 0 at the outer silhouette, rising towards Earth's limb.
    float depth = clamp(-dot(N, V), 0.0, 1.0);
    float glow = pow(smoothstep(0.0, 0.42, depth), 3.2);
    float ndl = dot(N, normalize(uSun));
    float sunSide = smoothstep(-0.12, 0.6, ndl);
    float dusk = smoothstep(-0.05, 0.05, ndl) * smoothstep(0.3, 0.05, ndl);
    vec3 tint = mix(uAtmosphere, vec3(1.0, 0.6, 0.35), dusk * 0.3);

    gl_FragColor = vec4(tint * glow * sunSide * 1.5, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

interface EarthProps {
  segments: number;
  reducedMotion: boolean;
}

export default function Earth({ segments, reducedMotion }: EarthProps) {
  const surface = useRef<THREE.Mesh>(null);
  const cloudLayer = useRef<THREE.Mesh>(null);
  const tilt = useRef<THREE.Group>(null);
  const pin = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  const observer = useAppStore((s) => s.observer);
  const skyIndex = sceneIndex("sky");
  const scratch = useMemo(
    () => ({ pin: new THREE.Vector3(), cam: new THREE.Vector3(), align: new THREE.Quaternion(), goal: new THREE.Quaternion() }),
    [],
  );

  const marker = useMemo(() => {
    if (!observer) return null;
    const position = surfacePoint(observer.lat, observer.lon);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), position);
    return { position: position.clone().multiplyScalar(1.004), quaternion };
  }, [observer]);

  const pinMaterials = useMemo(
    () => ({
      dot: new THREE.MeshBasicMaterial({ color: GOLD.clone().multiplyScalar(2.2), transparent: true, opacity: 0, toneMapped: false }),
      ring: new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
    }),
    [],
  );
  const anisotropy = useThree((s) => Math.min(8, s.gl.capabilities.getMaxAnisotropy()));

  const [day, night, clouds] = useTexture([
    "/textures/2k_earth_daymap.jpg",
    "/textures/2k_earth_nightmap.jpg",
    "/textures/2k_earth_clouds.jpg",
  ]);

  const materials = useMemo(() => {
    day.colorSpace = THREE.SRGBColorSpace;
    night.colorSpace = THREE.SRGBColorSpace;
    for (const t of [day, night, clouds]) {
      t.anisotropy = anisotropy;
      t.needsUpdate = true;
    }

    const shared = { uSun: { value: SUN_DIRECTION }, uAtmosphere: { value: ATMOSPHERE } };
    return {
      earth: new THREE.ShaderMaterial({
        vertexShader: surfaceVertex,
        fragmentShader: earthFragment,
        uniforms: {
          ...shared,
          uDay: { value: day },
          uNight: { value: night },
          uClouds: { value: clouds },
          uCloudShift: { value: 0 },
        },
      }),
      clouds: new THREE.ShaderMaterial({
        vertexShader: surfaceVertex,
        fragmentShader: cloudFragment,
        uniforms: { ...shared, uClouds: { value: clouds } },
        transparent: true,
        depthWrite: false,
      }),
      atmosphere: new THREE.ShaderMaterial({
        vertexShader: surfaceVertex,
        fragmentShader: atmosphereFragment,
        uniforms: shared,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    };
  }, [day, night, clouds, anisotropy]);

  useFrame(({ clock }, delta) => {
    if (!surface.current || !cloudLayer.current) return;
    const speed = reducedMotion ? 0.25 : 1;
    const dt = Math.min(delta, 0.1) * speed;
    surface.current.rotation.y += dt * 0.035;
    cloudLayer.current.rotation.y += dt * 0.042;

    // Around the "Your sky" section, swing the whole globe so the visitor's pin points
    // straight at the camera; elsewhere it eases back to the normal axial tilt.
    const near = THREE.MathUtils.clamp(1 - Math.abs(scroll.journey - skyIndex) / 0.75, 0, 1);
    const focus = near * near * (3 - 2 * near);
    if (tilt.current) {
      const { goal } = scratch;
      goal.copy(BASE_TILT);
      if (marker && pin.current && focus > 0) {
        pin.current.getWorldPosition(scratch.pin).normalize();
        scratch.cam.copy(camera.position).normalize();
        scratch.align.setFromUnitVectors(scratch.pin, scratch.cam).multiply(tilt.current.quaternion);
        goal.slerp(scratch.align, focus);
      }
      tilt.current.quaternion.slerp(goal, 1 - Math.exp(-Math.min(delta, 0.1) * 3));
    }
    const pulse = reducedMotion ? 0.5 : (clock.elapsedTime * 0.6) % 1;
    pinMaterials.dot.opacity = focus;
    pinMaterials.ring.opacity = focus * (1 - pulse) * 0.9;
    if (pin.current) {
      pin.current.visible = focus > 0.001;
      pin.current.children[1]?.scale.setScalar(1 + pulse * 2.5);
    }
    const shift = (cloudLayer.current.rotation.y - surface.current.rotation.y) / (Math.PI * 2);
    materials.earth.uniforms.uCloudShift.value = shift;
  });

  return (
    <group ref={tilt} quaternion={BASE_TILT}>
      <mesh ref={surface} material={materials.earth} rotation={[0, -1.9, 0]}>
        <sphereGeometry args={[1, segments, segments]} />
        {marker && (
          <group ref={pin} position={marker.position} quaternion={marker.quaternion} visible={false}>
            <mesh material={pinMaterials.dot}>
              <circleGeometry args={[0.02, 24]} />
            </mesh>
            <mesh material={pinMaterials.ring}>
              <ringGeometry args={[0.028, 0.033, 40]} />
            </mesh>
          </group>
        )}
      </mesh>
      <mesh ref={cloudLayer} material={materials.clouds} rotation={[0, -1.9, 0]}>
        <sphereGeometry args={[1.007, segments, segments]} />
      </mesh>
      <mesh material={materials.atmosphere} scale={1.1}>
        <sphereGeometry args={[1, 64, 64]} />
      </mesh>
    </group>
  );
}
