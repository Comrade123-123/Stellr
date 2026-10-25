"use client";

import { useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html, useTexture } from "@react-three/drei";
import * as THREE from "three";
import { GALAXY_CENTER } from "@/lib/galaxy";
import { scroll, sceneIndex } from "@/lib/scroll";
import { SKY_ROTATION, SKY_TINT } from "./Starfield";

const DISTANCE = 1450; // inside the far plane, behind everything else
const INCLINATION = THREE.MathUtils.degToRad(2.2);
const SHADOW = 2.6; // apparent shadow radius in Schwarzschild radii: the critical impact parameter, 3√3/2

type Anchor = (dist: number) => [number, number];

/** Where, in the virtual camera's tangent plane, a point of the hole's own frame appears (straight-line view). */
function seen(x: number, y: number, z: number): Anchor {
  return (dist) => {
    const s = Math.sin(INCLINATION), c = Math.cos(INCLINATION);
    const rx = x, ry = y - s * dist, rz = z + c * dist;
    const forward = -s * ry + c * rz;
    return [rx / forward, (c * ry + s * rz) / forward];
  };
}
/** A point inside the shadow, in shadow radii from its centre. */
const inside = (x: number, y: number): Anchor => (dist) => [(x * SHADOW) / dist, (y * SHADOW) / dist];
const onShadow = (angle: number): Anchor => (dist) => [
  (Math.cos(angle) * SHADOW) / dist,
  (Math.sin(angle) * SHADOW) / dist,
];

/**
 * Callouts for the parts of the hole, HUD-style. On wide screens an elbowed leader runs out
 * to the side; on portrait screens, where there is no room beside the hole, it runs straight
 * up or down and the text sits at its end (`align` says which way the text runs from there).
 */
interface Side {
  at: Anchor;
  up: boolean;
}
interface Wide extends Side {
  right: boolean;
}
interface Tall extends Side {
  length: number;
  align: "center" | "left" | "right";
}
const LABELS: { text: string; wide: Wide; tall: Tall }[] = [
  {
    text: "EVENT HORIZON",
    wide: { at: onShadow(2.45), right: false, up: true },
    tall: { at: onShadow(Math.PI / 2), up: true, length: 62, align: "center" },
  },
  {
    text: "PHOTON RING",
    wide: { at: onShadow(-0.75), right: true, up: false },
    tall: { at: onShadow(-1.0), up: false, length: 46, align: "right" },
  },
  {
    text: "ACCRETION DISK",
    wide: { at: seen(10, 0, 0), right: true, up: true },
    tall: { at: seen(10, 0, 0), up: false, length: 30, align: "left" },
  },
  {
    text: "INTERIOR SPACETIME",
    wide: { at: inside(-0.45, -0.25), right: false, up: false },
    tall: { at: inside(-0.4, -0.2), up: false, length: 84, align: "left" },
  },
];

const vertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

/*
 * A Schwarzschild black hole, ray-traced per pixel. Lengths are in Schwarzschild
 * radii. Each pixel's ray starts at a virtual camera a few dozen radii out,
 * slightly above a thin accretion disk; near the hole it is bent by the
 * photon-orbit equation (acceleration −1.5·h²·r̂/r⁴, exact for null geodesics),
 * stepped with a step that shrinks near the hole. Every crossing of the disk
 * plane adds that point's light, so the lensed far side arching over the shadow,
 * the thin secondary image below it and the photon ring all come out of the
 * physics, not from drawn shapes. Far from the hole rays are straight, which is
 * where the wide, dusty outer disk is drawn.
 */
const fragment = /* glsl */ `
  uniform vec3 uDir;       // world direction from the scene camera to the hole
  uniform vec3 uUp;        // the scene camera's up, so the disk stays level on screen
  uniform float uDist;     // virtual camera distance (sets the apparent size)
  uniform float uIncl;     // camera elevation above the disk plane, radians
  uniform float uTime;
  uniform float uOpacity;
  uniform sampler2D uSky;
  uniform mat3 uSkyInv;
  uniform vec3 uSkyTint;
  varying vec3 vWorld;

  const float BOUND = 16.0;   // inside this radius rays are bent; outside they're straight
  const int STEPS = __STEPS__;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }

  // Fine stars on a ~3 px screen grid, each a soft dot at a random spot in its cell.
  float sparkle() {
    vec2 g = gl_FragCoord.xy / 3.0;
    vec2 cell = floor(g);
    float h = hash(cell);
    if (h < 0.93) return 0.0;
    vec2 at = vec2(hash(cell + 17.0), hash(cell + 43.0)) * 0.6 + 0.2;
    float d = length(fract(g) - at);
    return exp(-d * d * 30.0) * (h - 0.93) / 0.07 * (0.6 + 0.4 * sin(uTime * 2.0 + h * 90.0));
  }

  // Light emitted at disk radius r, orbital angle a, seen along ray direction d; foot is
  // the pixel's footprint there, used to fade detail too fine to show. Returns rgb and
  // an opacity for that crossing.
  vec4 disk(float r, float a, vec3 d, float foot) {
    // Lit from above: seen from underneath (ray travelling upwards) the disk is dimmer, which
    // keeps the image bent under the shadow a thin ring rather than a second bright lobe.
    float side = d.y > 0.0 ? 0.18 : 1.0;
    // Hot inner disk, combed into fine streaks that orbit as Kepler says: faster further in
    // (angular speed ∝ r^-1.5), so the gas visibly shears as it goes round.
    float omega = 0.9 * pow(max(r, 2.6) / 3.0, -1.5);
    float spin = a - uTime * omega;
    // Lensing squeezes radii hard near the shadow, so the streaks stay coarse enough not to alias there.
    float streak = n2(vec2(r * 6.0, spin * 2.0)) * 0.55 + n2(vec2(r * 13.0, spin * 3.0 + 7.0)) * 0.45;
    streak = mix(0.7, 0.1 + 1.6 * streak * streak, (1.0 - smoothstep(0.06, 0.2, foot)) * smoothstep(2.2, 3.6, r));
    // Gas keeps glowing, fainter, as it plunges inside the innermost stable orbit towards the horizon.
    float inner = smoothstep(1.3, 2.9, r) * mix(0.4, 1.0, smoothstep(2.6, 3.4, r))
                * pow(3.2 / max(r, 2.0), 1.3) * (1.0 - smoothstep(8.0, 15.0, r));

    // Beaming: the side orbiting towards the camera is a little brighter.
    vec3 vel = normalize(vec3(-sin(a), 0.0, cos(a)));
    float beam = 1.0 + 0.35 * dot(vel, -d);

    vec3 hot = vec3(1.0, 0.93, 0.78);
    vec3 warm = vec3(1.0, 0.62, 0.24);
    vec3 col = mix(warm, hot, smoothstep(9.0, 3.5, r)) * inner * streak * beam * side * 2.4;

    // A few hot clumps of gas riding their orbits, the easiest way to see the disk turn.
    float spots = 0.0;
    for (int k = 0; k < 3; k++) {
      float rk = 3.7 + float(k) * 1.3;
      float wk = 0.9 * pow(rk / 3.0, -1.5);
      float dang = mod(a - uTime * wk - float(k) * 2.4 + 3.14159265, 6.2831853) - 3.14159265;
      spots += exp(-pow(r - rk, 2.0) / 0.12 - pow(dang * rk, 2.0) / 0.9);
    }
    col += hot * spots * beam * side * 3.5;

    // The wide outer disk: a faint haze of dust and loose stars, gold near the middle, cooling to teal.
    // The stars are placed on a screen grid (sparkle()), so the grazing view doesn't smear them into dashes.
    float outer = smoothstep(4.0, 9.0, r) * exp(-r / 22.0);
    vec3 dust = mix(vec3(0.95, 0.74, 0.45), vec3(0.2, 0.42, 0.55), smoothstep(6.0, 28.0, r));
    col += dust * outer * (0.06 + sparkle() * 1.2);

    float alpha = clamp(inner * 0.75 + outer * 0.08 + spots * 0.4, 0.0, 0.85);
    return vec4(col, alpha);
  }

  // Inside the shadow nothing escapes, so this is a picture, not a measurement: faint rings
  // that drift inwards and wind as they go, standing for space itself falling through the
  // horizon towards the centre. Kept dim so the hole still reads as black.
  vec3 interior(vec2 sp, float pixel) {
    float rho = length(sp) * uDist / __SHADOW__;
    if (rho >= 1.0) return vec3(0.0);
    float a = atan(sp.y, sp.x);
    float flow = log(max(rho, 0.02)) * 3.2 + uTime * 0.35 + a * 0.16;
    float w = max(3.4 * pixel / max(length(sp), 1e-4), 0.02);   // flow changes this much per pixel
    float ring = 1.0 - smoothstep(w * 0.5, w * 1.6, abs(fract(flow + 0.5) - 0.5));
    float fade = smoothstep(1.0, 0.82, rho) * smoothstep(0.05, 0.4, rho);
    return vec3(0.16, 0.36, 0.44) * ring * fade * 0.16;
  }

  vec3 skyColor(vec3 dir) {
    vec3 d = uSkyInv * dir;
    float theta = acos(clamp(d.y, -1.0, 1.0));
    float phi = atan(d.z, -d.x);
    if (phi < 0.0) phi += 6.2831853;
    vec3 mw = texture2D(uSky, vec2(phi / 6.2831853, 1.0 - theta / 3.14159265)).rgb * uSkyTint;
    return mw * 0.6;
  }

  void main() {
    vec3 ray = normalize(vWorld - cameraPosition);
    vec3 D = normalize(uDir);
    float facing = dot(ray, D);
    if (facing <= 0.05 || uOpacity <= 0.0) discard;
    vec3 R = normalize(cross(D, uUp));
    vec3 U = cross(R, D);
    vec2 sp = vec2(dot(ray, R), dot(ray, U)) / facing;

    // Virtual camera in the hole's frame (disk in the x–z plane).
    float s = sin(uIncl), c = cos(uIncl);
    vec3 pos = vec3(0.0, s, -c) * uDist;
    vec3 f = vec3(0.0, -s, c);
    vec3 r = vec3(1.0, 0.0, 0.0);
    vec3 u = vec3(0.0, c, s);
    vec3 dir = normalize(f + sp.x * r + sp.y * u);
    float pixel = fwidth(sp.x);   // angular size of a pixel

    vec3 col = vec3(0.0);
    float alpha = 0.0;
    bool captured = false;
    bool bent = false;

    // Straight run to the bending sphere.
    float b = dot(pos, dir);
    float disc = b * b - (dot(pos, pos) - BOUND * BOUND);
    float tIn = -b - sqrt(max(disc, 0.0));
    vec3 start = pos;
    if (disc > 0.0 && tIn > 0.0) {
      bent = true;
      // A crossing of the disk before reaching the sphere (the outer disk in front).
      if (pos.y * (pos + dir * tIn).y < 0.0) {
        float t = -pos.y / dir.y;
        vec3 h = pos + dir * t;
        vec4 e = disk(length(h.xz), atan(h.z, h.x), dir, pixel * t);
        col += (1.0 - alpha) * e.rgb;
        alpha += (1.0 - alpha) * e.a;
      }
      vec3 p = pos + dir * tIn;
      vec3 v = dir;
      vec3 hv = cross(p, v);
      float k = -1.5 * dot(hv, hv);
      float rr = length(p);
      vec3 acc = k * p / (rr * rr * rr * rr * rr);
      for (int i = 0; i < STEPS; i++) {
        if (rr < 1.0) { captured = true; break; }
        if (rr > BOUND + 0.01 && dot(p, v) > 0.0) break;
        float dt = clamp(0.075 * (rr - 0.6), 0.02, 0.9);
        // Leapfrog (kick, drift, kick); the closing kick's force is reused to open the next step.
        v += acc * dt * 0.5;
        vec3 q = p + v * dt;
        float rq = length(q);
        acc = k * q / (rq * rq * rq * rq * rq);
        v += acc * dt * 0.5;
        if (p.y * q.y < 0.0) {
          vec3 h = mix(p, q, p.y / (p.y - q.y));
          float hr = length(h.xz);
          if (hr > 1.0) {
            vec4 e = disk(hr, atan(h.z, h.x), normalize(v), pixel * uDist);
            col += (1.0 - alpha) * e.rgb;
            alpha += (1.0 - alpha) * e.a;
          }
        }
        p = q;
        rr = rq;
        if (alpha > 0.995) break;
      }
      start = p;
      dir = normalize(v);
    }

    if (captured) {
      col += (1.0 - alpha) * interior(sp, pixel);
      alpha = 1.0;   // the shadow swallows whatever is behind it
    } else {
      // Straight from here on: one more possible crossing of the outer disk.
      if (start.y * dir.y < 0.0) {
        float t = -start.y / dir.y;
        vec3 h = start + dir * t;
        vec4 e = disk(length(h.xz), atan(h.z, h.x), dir, pixel * (uDist + t));
        col += (1.0 - alpha) * e.rgb;
        alpha += (1.0 - alpha) * e.a;
      }
      if (bent) {
        // Lensed background, blended out towards the sphere's edge where the bending fades.
        vec3 world = normalize(R * dot(dir, r) + U * dot(dir, u) + D * dot(dir, f));
        float edge = 1.0 - smoothstep(0.55, 1.0, length(sp) * uDist / BOUND);
        col += (1.0 - alpha) * skyColor(world) * edge;
        alpha += (1.0 - alpha) * edge;
      }
    }

    gl_FragColor = vec4(col, alpha) * uOpacity;   // premultiplied
    #include <colorspace_fragment>
  }
`;

/**
 * The ending's black hole, Sagittarius A* at the centre of the galaxy. Drawn on a
 * camera-facing quad far away and placed by direction, so it reads as distant and
 * costs one shader pass. It looms larger as the camera dives in.
 */
export default function BlackHole({
  steps,
  reducedMotion,
  dpr,
  maxDpr,
}: {
  steps: number;
  reducedMotion: boolean;
  /** The canvas's usual pixel-ratio range, restored once the hole is out of view. */
  dpr: number | [number, number];
  /** Pixel-ratio ceiling while the hole is on screen: it is the heaviest thing the site draws. */
  maxDpr: number;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const setDpr = useThree((s) => s.setDpr);
  const capped = useRef(false);
  const ending = sceneIndex("cta");
  const milkyWay = useTexture("/textures/2k_stars_milky_way.jpg");

  const material = useMemo(() => {
    milkyWay.colorSpace = THREE.SRGBColorSpace;
    const skyInverse = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromEuler(SKY_ROTATION).invert());
    return new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment.replace("__STEPS__", String(steps)).replace("__SHADOW__", SHADOW.toFixed(3)),
      uniforms: {
        uDir: { value: new THREE.Vector3(0, 0, -1) },
        uUp: { value: new THREE.Vector3(0, 1, 0) },
        uDist: { value: 40 },
        uIncl: { value: INCLINATION },
        uTime: { value: 0 },
        uOpacity: { value: 0 },
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
      depthTest: false,
    });
  }, [milkyWay, steps]);

  const fwd = useMemo(() => new THREE.Vector3(), []);
  const basis = useMemo(() => ({ r: new THREE.Vector3(), u: new THREE.Vector3(), d: new THREE.Vector3() }), []);
  const anchors = useRef<(THREE.Group | null)[]>([]);
  const [labels, setLabels] = useState<"wide" | "tall" | null>(null);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const t = THREE.MathUtils.clamp((scroll.view - (ending - 0.7)) / 0.7, 0, 1);
    const near = t * t * (3 - 2 * t);
    material.uniforms.uOpacity.value = near;
    m.visible = near > 0.001;
    if (m.visible !== capped.current) {
      capped.current = m.visible;
      setDpr(m.visible ? Math.min(window.devicePixelRatio, maxDpr) : dpr);
    }
    if (!m.visible) return;
    if (!reducedMotion) material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uDir.value.copy(GALAXY_CENTER).sub(camera.position).normalize();
    material.uniforms.uUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
    // Grows from a distant speck to its full size as the camera arrives; a bit smaller on portrait screens.
    const tall = size.width / size.height < 0.9;
    const full = tall ? 72 : 46;
    const dist = THREE.MathUtils.lerp(260, full, near);
    material.uniforms.uDist.value = dist;

    // Callouts once the camera has arrived, pinned to the same directions the shader uses.
    const show = near > 0.97 ? (tall ? "tall" : "wide") : null;
    if (show !== labels) setLabels(show);
    if (show) {
      basis.d.copy(material.uniforms.uDir.value);
      basis.r.crossVectors(basis.d, material.uniforms.uUp.value).normalize();
      basis.u.crossVectors(basis.r, basis.d);
      LABELS.forEach((label, i) => {
        const g = anchors.current[i];
        if (!g) return;
        const [x, y] = label[show].at(dist);
        g.position.copy(basis.d).addScaledVector(basis.r, x).addScaledVector(basis.u, y).normalize();
        g.position.multiplyScalar(100).add(camera.position);
      });
    }

    camera.getWorldDirection(fwd);
    m.position.copy(camera.position).addScaledVector(fwd, DISTANCE);
    m.quaternion.copy(camera.quaternion);
    const h = 2 * DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.08;
    m.scale.set(h * camera.aspect, h, 1);
  });

  return (
    <>
      <mesh ref={mesh} material={material} frustumCulled={false} renderOrder={8}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      {labels &&
        LABELS.map((label, i) => (
          <group
            key={label.text}
            ref={(g) => {
              anchors.current[i] = g;
            }}
          >
            <Html zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
              {labels === "wide" ? (
                <Callout text={label.text} right={label.wide.right} up={label.wide.up} />
              ) : (
                <TallCallout text={label.text} {...label.tall} />
              )}
            </Html>
          </group>
        ))}
    </>
  );
}

/** A gold ring on the feature, an elbowed hairline out to the label. */
function Callout({ text, right, up }: { text: string; right: boolean; up: boolean }) {
  const w = 72;
  const h = 28;
  const x0 = right ? 0 : w;
  const y0 = up ? h : 0;
  const elbow = right ? 22 : w - 22;
  const yEnd = up ? 0 : h;
  return (
    <div className="callout relative h-0 w-0">
      <span className="absolute -left-[4px] -top-[4px] block h-[8px] w-[8px] rounded-full border border-gold" />
      <svg
        width={w}
        height={h}
        className="absolute overflow-visible"
        style={{ left: right ? 0 : -w, top: up ? -h : 0 }}
        aria-hidden
      >
        <polyline points={`${x0},${y0} ${elbow},${yEnd} ${right ? w : 0},${yEnd}`} fill="none" stroke="rgba(201,164,106,0.7)" strokeWidth="1" />
      </svg>
      <span
        className="absolute whitespace-nowrap font-mono text-[9px] tracking-[0.22em] text-ink/75 sm:text-[10px]"
        style={{ [right ? "left" : "right"]: w + 6, top: (up ? -h : h) - 6 }}
      >
        {text}
      </span>
    </div>
  );
}

/** The portrait version: a straight hairline up or down, the label at its end. */
function TallCallout({ text, up, length, align }: { text: string; up: boolean; length: number; align: Tall["align"] }) {
  const x = align === "center" ? "-50%" : align === "left" ? "-100%" : "0%";
  return (
    <div className="callout relative h-0 w-0">
      <span className="absolute -left-[4px] -top-[4px] block h-[8px] w-[8px] rounded-full border border-gold" />
      <span
        className="absolute left-0 block w-px bg-gold/70"
        style={{ height: length, top: up ? -length : 0 }}
      />
      <span
        className="absolute whitespace-nowrap font-mono text-[9px] tracking-[0.22em] text-ink/75"
        style={{ top: up ? -length - 14 : length + 4, left: 0, transform: `translateX(${x})` }}
      >
        {text}
      </span>
    </div>
  );
}
