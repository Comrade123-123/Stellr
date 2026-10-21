"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import { BLACK_HOLE_DIRECTION, BLACK_HOLE_DIRECTION_TALL } from "@/lib/outpost";
import { scroll, sceneIndex } from "@/lib/scroll";
import { SKY_ROTATION, SKY_TINT } from "./Starfield";

const DISTANCE = 1450; // inside the far plane, behind the starfield shell

const vertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

/*
 * Analytic, Gargantua-style black hole. Each fragment's view ray is projected
 * onto a plane facing the black hole's direction (a gnomonic projection), so
 * it sits at infinity and the camera can tilt towards it. In units of the
 * shadow radius:
 *   - the near half of a thin, slightly inclined accretion disk crosses in
 *     front of the shadow;
 *   - the far half is bent up over the top (and faintly under the bottom) of
 *     the shadow by lensing;
 *   - a thin photon ring hugs the shadow's edge;
 *   - the side moving towards us is brighter (Doppler beaming).
 */
const fragment = /* glsl */ `
  uniform vec3 uDir;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uShadow;   // angular radius (gnomonic units)
  uniform sampler2D uSky;  // the same Milky Way image the backdrop uses
  uniform mat3 uSkyInv;    // world → backdrop-local rotation
  uniform vec3 uSkyTint;
  varying vec3 vWorld;

  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }

  // The sky in a given direction: the Milky Way image (same mapping as the backdrop
  // sphere) plus fine procedural stars, so lensed light is the real background.
  vec3 skyColor(vec3 dir) {
    vec3 d = uSkyInv * dir;
    float theta = acos(clamp(d.y, -1.0, 1.0));
    float phi = atan(d.z, -d.x);
    if (phi < 0.0) phi += 6.2831853;
    vec3 mw = texture2D(uSky, vec2(phi / 6.2831853, 1.0 - theta / 3.14159265)).rgb * uSkyTint;
    vec3 c = dir * 420.0;
    float h = hash(floor(c));
    float star = 0.0;
    if (h > 0.988) {
      vec3 f = fract(c) - 0.5;
      star = exp(-dot(f, f) * 60.0) * pow((h - 0.988) / 0.012, 2.0) * 3.2;
    }
    return mw * 2.2 + vec3(star) * vec3(1.0, 0.94, 0.86);
  }

  // Disk emission at disk radius R and orbital angle a: hot inner edge, streaky gas,
  // inner gas orbiting faster, approaching side brighter.
  vec3 disk(float R, float a) {
    float profile = smoothstep(1.55, 2.05, R) * pow(2.0 / max(R, 1.0), 1.5) * (1.0 - smoothstep(6.0, 10.0, R));
    if (profile <= 0.0) return vec3(0.0);
    float spin = a + uTime * 0.55 / pow(max(R, 1.6), 1.5);
    // Domain-warped gas so structure clumps and shears instead of forming clean rings,
    // fine filaments stretched along the orbit, and dark dust lanes.
    vec3 q = vec3(R * 2.4, cos(spin) * 1.7, sin(spin) * 1.7);
    float warp = fbm(q * 0.9 + 4.7);
    float gas = fbm(q + vec3(warp * 1.6, warp, -warp));
    float fil = fbm(vec3(R * 13.0 + warp * 4.0, cos(spin) * 2.6, sin(spin) * 2.6));
    float lanes = smoothstep(0.3, 0.62, fbm(vec3(R * 4.2 + gas * 2.5, cos(spin) * 1.1, sin(spin) * 1.1)));
    float tex = (0.45 + 0.9 * gas + 0.22 * fil) * mix(0.55, 1.05, lanes);
    float doppler = 1.0 - 0.5 * cos(a);
    vec3 cool = vec3(0.9, 0.34, 0.07);
    vec3 warm = vec3(1.0, 0.64, 0.26);
    vec3 hot = vec3(1.0, 0.95, 0.86);
    vec3 col = mix(cool, warm, smoothstep(7.5, 3.5, R));
    col = mix(col, hot, smoothstep(3.2, 1.8, R));
    // Only the hot inner edge goes past the bloom threshold; the rest stays crisp.
    return col * profile * tex * doppler * 1.2;
  }

  void main() {
    vec3 ray = normalize(vWorld - cameraPosition);
    vec3 D = normalize(uDir);
    float facing = dot(ray, D);
    if (facing <= 0.02 || uOpacity <= 0.0) discard;

    vec3 R = normalize(cross(D, vec3(0.0, 1.0, 0.0)));
    vec3 U = cross(R, D);
    vec2 p = vec2(dot(ray, R), dot(ray, U)) / facing / uShadow;
    // A slight roll, like a cinematic camera.
    float roll = -0.12;
    p = mat2(cos(roll), -sin(roll), sin(roll), cos(roll)) * p;

    float r = length(p);
    float phi = atan(p.y, p.x);
    const float k = 0.17; // sin(inclination): how flat the disk looks

    vec3 col = vec3(0.0);

    // Gravitational lensing of the background: light passing close to the hole is
    // bent, so each pixel shows the sky from a direction pulled toward the centre
    // (point-lens mapping, source = image·(1 − 1/r²)). Stars and the Milky Way
    // smear into arcs and pile up into a bright Einstein ring near the shadow.
    float lens = smoothstep(9.0, 2.4, r) * step(0.985, r);
    if (lens > 0.001) {
      vec2 s = p * (1.0 - 1.0 / (r * r));
      s = mat2(cos(roll), sin(roll), -sin(roll), cos(roll)) * s; // undo the roll
      vec3 src = normalize(D + (s.x * R + s.y * U) * uShadow);
      vec3 bg = skyColor(src) * (1.0 + 2.2 * exp(-pow((r - 1.18) / 0.16, 2.0)));
      col += bg * lens;
    }

    // Far half of the disk, where it peeks out beside the shadow.
    vec2 dp = vec2(p.x, p.y / k);
    float Rd = length(dp);
    float ad = atan(dp.y, dp.x);
    if (dp.y > 0.0 && r > 1.0) col += disk(Rd, ad);

    // Primary lensed image of the far disk, arching over the top of the shadow.
    if (r > 1.0) {
      float Rl = 1.6 + (r - 1.06) * 2.9;
      float over = smoothstep(-0.55, 0.3, sin(phi));
      col += disk(Rl, phi) * over * 0.95;
      // Secondary image, thin and faint, under the shadow.
      float Rs = 1.6 + (r - 1.02) * 11.0;
      float under = smoothstep(0.1, -0.7, sin(phi));
      col += disk(Rs, -phi) * under * 0.4;
    }

    // The shadow itself: swallows everything behind it, including the stars.
    float shadow = 1.0 - smoothstep(0.985, 1.015, r);
    col *= 1.0 - shadow;

    // Photon ring.
    col += vec3(1.0, 0.86, 0.66) * exp(-pow((r - 1.02) / 0.014, 2.0)) * 1.5;

    // Near half of the disk, crossing in front of the shadow.
    float front = 0.0;
    if (dp.y <= 0.0) {
      vec3 near = disk(Rd, ad);
      col += near;
      front = clamp(dot(near, vec3(0.3, 0.5, 0.2)) * 1.4, 0.0, 1.0);
    }

    // Warm haze around the whole system.
    col += vec3(1.0, 0.55, 0.22) * 0.05 * exp(-max(r - 1.0, 0.0) * 0.4) * (1.0 - shadow);

    // Inside the lensing zone the bent sky replaces the real stars behind it.
    float alpha = clamp(max(max(max(shadow, front), lens), dot(col, vec3(0.3, 0.5, 0.2))), 0.0, 1.0);
    gl_FragColor = vec4(col, alpha) * uOpacity; // premultiplied
    #include <colorspace_fragment>
  }
`;

/**
 * A black hole hanging over the outpost's horizon. Drawn on a camera-facing
 * quad far away, so it's cheap (one analytic pass, no ray-marching) and works
 * on integrated GPUs. Visible in the Intro/Hero, fading out on the way to Earth.
 */
export default function BlackHole({ reducedMotion }: { reducedMotion: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const sky = sceneIndex("sky");
  const milkyWay = useTexture("/textures/2k_stars_milky_way.jpg");

  const material = useMemo(() => {
    milkyWay.colorSpace = THREE.SRGBColorSpace;
    const skyInverse = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(SKY_ROTATION).invert());
    return new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          uDir: { value: BLACK_HOLE_DIRECTION },
          uTime: { value: 0 },
          uOpacity: { value: 1 },
          uShadow: { value: 0.075 },
          uSky: { value: milkyWay },
          uSkyInv: { value: skyInverse },
          uSkyTint: { value: SKY_TINT },
        },
        transparent: true,
        premultipliedAlpha: true,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        depthWrite: false,
      });
  }, [milkyWay]);

  const fwd = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const t = THREE.MathUtils.clamp((scroll.journey - (sky - 0.85)) / 0.55, 0, 1);
    const opacity = 1 - t * t * (3 - 2 * t);
    material.uniforms.uOpacity.value = opacity;
    m.visible = opacity > 0.001;
    if (!m.visible) return;
    if (!reducedMotion) material.uniforms.uTime.value = clock.elapsedTime;
    // Same rule as the camera's tall framing: lower and a touch smaller on portrait screens.
    const tall = size.width / size.height < 0.9;
    material.uniforms.uDir.value = tall ? BLACK_HOLE_DIRECTION_TALL : BLACK_HOLE_DIRECTION;
    material.uniforms.uShadow.value = tall ? 0.06 : 0.075;

    // Keep a quad filling the view, far behind everything else.
    camera.getWorldDirection(fwd);
    m.position.copy(camera.position).addScaledVector(fwd, DISTANCE);
    m.quaternion.copy(camera.quaternion);
    const h = 2 * DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.08;
    m.scale.set(h * camera.aspect, h, 1);
  });

  return (
    <mesh ref={mesh} material={material} frustumCulled={false} renderOrder={0}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}
