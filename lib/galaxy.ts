import * as THREE from "three";
import { ORBIT_PLANE, SUN_POSITION } from "./solar";

/**
 * The Milky Way, for the roadmap and the ending. Stylised to fit the scene's
 * compressed scale, but laid out like the real one: the Sun sits a little over
 * halfway out from the centre, and the galactic plane is tilted about 60° to
 * the plane of the planets.
 */

/** Disk radius in scene units (Earth's radius is 1; Neptune's orbit is ~310). */
export const GALAXY_RADIUS = 1500;

const eclipticNorth = new THREE.Vector3(0, 1, 0).applyQuaternion(ORBIT_PLANE);
const prograde = new THREE.Vector3(0, 0, -1).applyQuaternion(ORBIT_PLANE);

/** Normal of the galactic plane. */
export const GALAXY_NORMAL = eclipticNorth.clone().applyAxisAngle(prograde, THREE.MathUtils.degToRad(60)).normalize();

/** In-plane direction from the galactic centre out to the Sun. */
const toSun = new THREE.Vector3(1, -0.2, 0.4)
  .projectOnPlane(GALAXY_NORMAL)
  .normalize();

/** Galactic centre: where Sagittarius A*, the ending's black hole, sits. */
export const GALAXY_CENTER = SUN_POSITION.clone().addScaledVector(toSun, -0.56 * GALAXY_RADIUS);

/** Orientation that turns a disk built in the local x–z plane (+y up) into the galactic plane. */
const side = new THREE.Vector3().crossVectors(toSun, GALAXY_NORMAL).normalize();
export const GALAXY_QUATERNION = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(toSun, GALAXY_NORMAL, side),
);

/** A point in the galaxy's own frame: along the centre→Sun line, up the normal, and across. */
export function galaxyPoint(out: number, up: number, across: number) {
  return GALAXY_CENTER.clone()
    .addScaledVector(toSun, out)
    .addScaledVector(GALAXY_NORMAL, up)
    .addScaledVector(side, across);
}

type Vec3 = [number, number, number];

/**
 * A pose looking at `at` from `eye`, with the aim nudged straight up or down the screen
 * so `at` lands `shift` half-screen-heights below the middle (negative: above).
 */
function framed(eye: THREE.Vector3, at: THREE.Vector3, shift = 0) {
  const forward = at.clone().sub(eye);
  const distance = forward.length();
  forward.normalize();
  const up = new THREE.Vector3(0, 1, 0).addScaledVector(forward, -forward.y).normalize();
  const target = at.clone().addScaledVector(up, shift * distance * Math.tan(THREE.MathUtils.degToRad(20)));
  return { position: eye.toArray() as Vec3, target: target.toArray() as Vec3 };
}

/** Roadmap: high above the disk, tilted about 30°; on wide screens it sits right of the copy, the Sun's pin near the middle. */
export const ROADMAP_WIDE = framed(galaxyPoint(800, 3200, -1500), galaxyPoint(796, -291, -195));
/** On portrait screens the galaxy sits above the heading and the list. */
export const ROADMAP_TALL = framed(galaxyPoint(1400, 2900, 300), GALAXY_CENTER.clone(), -0.42);

/** Ending: deep in the bulge, just above the plane, facing the black hole at the centre, which sits just below the middle. */
export const ENDING_WIDE = framed(galaxyPoint(210, 70, 120), GALAXY_CENTER.clone(), 0.12);
export const ENDING_TALL = framed(galaxyPoint(240, 80, 140), GALAXY_CENTER.clone(), 0.05);
