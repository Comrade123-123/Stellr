import * as THREE from "three";
import { INTRO_CLIMB_TALL, INTRO_CLIMB_WIDE, INTRO_TALL, INTRO_WIDE, sunrisePose } from "./launch";
import { ENDING_TALL, ENDING_WIDE, ROADMAP_TALL, ROADMAP_WIDE } from "./galaxy";
import { ORBIT_PLANE, SUN_POSITION } from "./solar";

/**
 * Scroll → journey → camera.
 *
 * Every HTML section carrying `data-scene` is an anchor. `journey` is a float
 * where the integer part is the index of the section at the top of the
 * viewport and the fractional part is how far we've scrolled towards the
 * next one. The canvas reads it every frame; nothing here touches React.
 */
export const scroll = {
  y: 0,
  journey: 0,
  /** The journey the canvas is showing: `journey` eased over time, so the 3D never jumps with the scrollbar. */
  view: 0,
};

let anchors: number[] = [];

export function measureScenes() {
  anchors = Array.from(document.querySelectorAll<HTMLElement>("[data-scene]")).map(
    (el) => el.getBoundingClientRect().top + window.scrollY,
  );
}

export function updateJourney(y: number) {
  scroll.y = y;
  if (anchors.length < 2) {
    scroll.journey = 0;
    return;
  }
  const last = anchors.length - 1;
  if (y >= anchors[last]) {
    scroll.journey = last;
    return;
  }
  for (let i = 0; i < last; i++) {
    if (y < anchors[i + 1]) {
      const span = anchors[i + 1] - anchors[i];
      scroll.journey = i + Math.max(0, (y - anchors[i]) / span);
      return;
    }
  }
}

type Vec3 = [number, number, number];
interface Pose {
  position: Vec3;
  target: Vec3;
}
interface Waypoint {
  id: string;
  /** Landscape / desktop framing. */
  wide: Pose;
  /** Portrait / phone framing. */
  tall: Pose;
  /** An extra pose part-way (`at`, 0–1) towards the next waypoint, to steer the move around something. */
  via?: { at: number; wide: Pose; tall: Pose };
}

/** A pose expressed in the orbital plane's frame: offsets from the Sun along Sun→Earth, north and prograde. */
function inOrbitFrame(target: [number, number, number], eye: [number, number, number]): Pose {
  const toWorld = (v: [number, number, number]) =>
    new THREE.Vector3(v[0], v[1], -v[2]).applyQuaternion(ORBIT_PLANE).add(SUN_POSITION).toArray() as Vec3;
  return { target: toWorld(target), position: toWorld(eye) };
}

/** One waypoint per `data-scene` section, in page order. */
export const CAMERA_PATH: Waypoint[] = [
  {
    id: "intro",
    // The launch pad at night: rocket centred, its plume filling the lower frame.
    wide: INTRO_WIDE,
    tall: INTRO_TALL,
    // Rise with the rocket first, so the smoke drops out of frame instead of the camera flying through it.
    via: { at: 0.4, wide: INTRO_CLIMB_WIDE, tall: INTRO_CLIMB_TALL },
  },
  {
    id: "hero",
    // In orbit over Earth's night side, the Sun breaking over the horizon.
    wide: sunrisePose(1.9, 0.08),
    tall: sunrisePose(2.4, 0.12),
  },
  {
    id: "sky",
    // Earth on the left, turned so the visitor's pin faces us; panel on the right.
    wide: { position: [2.2, 0.45, 3.9], target: [1.95, 0.05, 0] },
    // Globe (and pin) fill the top of the screen, above the stacked panel.
    tall: { position: [0, -0.9, 8], target: [0, -1.73, 0] },
  },
  {
    id: "manifesto",
    // Back off and rise; the whole planet sits low and small under the copy.
    wide: { position: [0.6, 1.1, 6.8], target: [0.2, 2.45, 0] },
    tall: { position: [0.4, 1.2, 8.5], target: [0.1, 3.4, 0] },
  },
  {
    id: "tools",
    // Earth and its orbits to the right of the tool panels.
    wide: { position: [-2.6, 1.3, 5.2], target: [-2.5, 0.15, 0] },
    tall: { position: [0, 2.4, 7.5], target: [0, 2.2, 0] },
  },
  {
    id: "telemetry",
    // High over the orbital plane: the globe sits under the readout grid, rings sweep across.
    wide: { position: [0.6, 5.5, 7.5], target: [0.2, 2.6, 0] },
    tall: { position: [0.4, 4.8, 8.5], target: [0.1, 2.65, 0] },
  },
  {
    id: "cosmoscope",
    // Far above the orbital plane: the inner system sits right of the copy, Earth's gold orbit and label below,
    // the giants' orbits sweeping off-frame. Coordinates are (toward Earth, north, prograde).
    wide: inOrbitFrame([20, 0, -42], [190, 190, -26]),
    // The system sits in the lower part of the screen, under the copy.
    tall: inOrbitFrame([-110, 0, 0], [230, 400, 20]),
  },
  {
    id: "roadmap",
    // Out past the planets and above the galaxy: the whole Milky Way, the Sun marked on one arm.
    wide: ROADMAP_WIDE,
    tall: ROADMAP_TALL,
  },
  {
    id: "cta",
    // Down into the galactic centre, face to face with its black hole.
    wide: ENDING_WIDE,
    tall: ENDING_TALL,
  },
];

export const sceneIndex = (id: string) => CAMERA_PATH.findIndex((w) => w.id === id);

const smooth = (t: number) => t * t * (3 - 2 * t);
const a = new THREE.Vector3();
const b = new THREE.Vector3();

/**
 * Moves between two poses around Earth (at the origin) rather than through it:
 * the eye's direction from Earth swings along a great circle while its distance
 * eases geometrically, so a move from orbit to far out (or back) never cuts
 * through the planet and covers near and far ranges at an even pace.
 */
function blendPose(from: Pose, to: Pose, t: number, outPosition: THREE.Vector3, outTarget: THREE.Vector3) {
  outTarget.fromArray(from.target).lerp(b.fromArray(to.target), t);
  a.fromArray(from.position);
  b.fromArray(to.position);
  const ra = a.length();
  const rb = b.length();
  a.divideScalar(ra);
  b.divideScalar(rb);
  const angle = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
  if (angle < 1e-4) outPosition.copy(a);
  else {
    const s = Math.sin(angle);
    outPosition.copy(a).multiplyScalar(Math.sin((1 - t) * angle) / s).addScaledVector(b, Math.sin(t * angle) / s);
  }
  outPosition.multiplyScalar(ra * Math.pow(rb / ra, t));
}

export function sampleCamera(
  journey: number,
  aspect: number,
  outPosition: THREE.Vector3,
  outTarget: THREE.Vector3,
) {
  const framing = aspect < 0.9 ? "tall" : "wide";
  const max = CAMERA_PATH.length - 1;
  const j = THREE.MathUtils.clamp(journey, 0, max);
  const i = Math.max(0, Math.min(Math.floor(j), max - 1));
  // Eased over the whole section-to-section move, so the camera settles at each section.
  const t = smooth(j - i);
  const from = CAMERA_PATH[i];
  const to = CAMERA_PATH[Math.min(i + 1, max)];
  const via = from.via;

  if (!via) blendPose(from[framing], to[framing], t, outPosition, outTarget);
  else if (t < via.at) blendPose(from[framing], via[framing], t / via.at, outPosition, outTarget);
  else blendPose(via[framing], to[framing], (t - via.at) / (1 - via.at), outPosition, outTarget);

  // Poses are authored for ~16:10. Narrower landscape screens back the camera
  // off along its view line so the subject keeps the same horizontal footprint.
  if (framing === "wide") {
    const fit = THREE.MathUtils.clamp(1.6 / aspect, 1, 1.4);
    outPosition.sub(outTarget).multiplyScalar(fit).add(outTarget);
  }
}
