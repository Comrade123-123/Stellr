import * as THREE from "three";
import { OUTPOST_EYE, OUTPOST_EYE_TALL, lookFrom, lookFromEye } from "./outpost";
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
}

/** A pose expressed in the orbital plane's frame: offsets from the Sun along Sun→Earth, north and prograde. */
function inOrbitFrame(target: [number, number, number], eye: [number, number, number]): Pose {
  const toWorld = (v: [number, number, number]) =>
    new THREE.Vector3(v[0], v[1], -v[2]).applyQuaternion(ORBIT_PLANE).add(SUN_POSITION).toArray() as Vec3;
  return { target: toWorld(target), position: toWorld(eye) };
}

const EYE = OUTPOST_EYE.toArray() as Vec3;
const EYE_TALL = OUTPOST_EYE_TALL.toArray() as Vec3;

/** One waypoint per `data-scene` section, in page order. */
export const CAMERA_PATH: Waypoint[] = [
  {
    id: "intro",
    // Standing on the outpost planetoid, looking up into open sky; the black hole is below the frame.
    wide: { position: EYE, target: lookFromEye([0.12, 0.92, -0.4]) },
    tall: { position: EYE_TALL, target: lookFrom(OUTPOST_EYE_TALL, [0.25, 0.92, -0.4]) },
  },
  {
    id: "hero",
    // Tilt down to the horizon: the black hole rises centre-right over the astronaut.
    wide: { position: EYE, target: lookFromEye([0.1, -0.05, -1]) },
    // Portrait: lower eye, pitched up so the headline gets dark sky and the black hole
    // with the astronaut silhouetted against it fills the lower half.
    tall: { position: EYE_TALL, target: lookFrom(OUTPOST_EYE_TALL, [0.33, 0.21, -1]) },
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
    tall: inOrbitFrame([-26, 0, 0], [230, 400, 20]),
  },
  {
    id: "cta",
    // Earth rises again at the end, as in the opening.
    wide: { position: [0.4, -0.05, 2.3], target: [0.1, 1.62, 0] },
    tall: { position: [0.3, 0.0, 2.9], target: [0.1, 1.35, 0] },
  },
];

export const sceneIndex = (id: string) => CAMERA_PATH.findIndex((w) => w.id === id);

const smooth = (t: number) => t * t * (3 - 2 * t);
const a = new THREE.Vector3();
const b = new THREE.Vector3();

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
  const t = smooth(j - i);
  const from = CAMERA_PATH[i][framing];
  const to = CAMERA_PATH[Math.min(i + 1, max)][framing];

  outTarget.copy(a.fromArray(from.target).lerp(b.fromArray(to.target), t));
  outPosition.copy(a.fromArray(from.position).lerp(b.fromArray(to.position), t));

  // Poses are authored for ~16:10. Narrower landscape screens back the camera
  // off along its view line so the subject keeps the same horizontal footprint.
  if (framing === "wide") {
    const fit = THREE.MathUtils.clamp(1.6 / aspect, 1, 1.4);
    outPosition.sub(outTarget).multiplyScalar(fit).add(outTarget);
  }
}
