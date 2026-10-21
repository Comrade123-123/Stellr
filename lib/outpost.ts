import * as THREE from "three";

/**
 * The opening "outpost": a dark planetoid some way behind Earth, where the
 * Intro and Hero cameras stand, with a black hole hanging over its horizon.
 * The camera later lifts off and flies forward (−z) to Earth at the origin.
 */

/** Where the Intro/Hero camera stands, just above the planetoid's surface. */
export const OUTPOST_EYE = new THREE.Vector3(0, 1.2, 52);

/** The planetoid: big enough that its horizon reads as a gentle curve. */
export const PLANETOID_CENTER = new THREE.Vector3(0, -60, 40);
export const PLANETOID_RADIUS = 60;

/** World direction of the black hole (it's at infinity): ahead, a little right and up. */
export const BLACK_HOLE_DIRECTION = new THREE.Vector3(0.33, 0.17, -1).normalize();

/**
 * Portrait screens are too narrow for the black hole and the headline side by
 * side, so there the camera stands lower and the black hole sits lower in the
 * sky: headline in the dark sky above, astronaut silhouetted against the disk.
 */
export const OUTPOST_EYE_TALL = new THREE.Vector3(0, -0.6, 52);
export const BLACK_HOLE_DIRECTION_TALL = new THREE.Vector3(0.33, 0.035, -1).normalize();

/** A point on the planetoid's surface plus its outward normal ("up" for anything standing there). */
export function surfaceAt(x: number, z: number) {
  const dx = x - PLANETOID_CENTER.x;
  const dz = z - PLANETOID_CENTER.z;
  const y = PLANETOID_CENTER.y + Math.sqrt(PLANETOID_RADIUS ** 2 - dx * dx - dz * dz);
  const position = new THREE.Vector3(x, y, z);
  const up = position.clone().sub(PLANETOID_CENTER).normalize();
  return { position, up };
}

/** The astronaut stands under the black hole, seen from behind, facing it. */
export const ASTRONAUT = surfaceAt(2.75, 43.5);

/** A camera target `distance` units from an eye along a direction. */
export const lookFrom = (eye: THREE.Vector3, dir: [number, number, number], distance = 20) =>
  eye
    .clone()
    .add(new THREE.Vector3(...dir).normalize().multiplyScalar(distance))
    .toArray() as [number, number, number];

export const lookFromEye = (dir: [number, number, number], distance = 20) => lookFrom(OUTPOST_EYE, dir, distance);
