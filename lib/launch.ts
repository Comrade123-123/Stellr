import * as THREE from "three";
import { SUN_DIRECTION } from "./solar";

/**
 * The opening: a night launch at a site some way from Earth's model (Earth sits
 * at the origin with radius 1 for the rest of the journey), then a sunrise over
 * Earth's night-side horizon seen from orbit.
 */

/** Centre of the launch pad; the plume rises from here along +y. */
export const LAUNCH_BASE = new THREE.Vector3(0, 0, 60);

/** Rocket altitude above the pad: on the pad's plume at the top of the page, climbing away as you scroll. */
export const rocketAltitude = (journey: number) => 12 + Math.max(0, journey) ** 1.6 * 34;

/** Intro camera: back from the pad, rocket about a quarter down the frame, plume and ground cloud filling below. */
export const INTRO_WIDE = {
  position: [0, 2, 92] as [number, number, number],
  target: [0, 6.5, 60] as [number, number, number],
};
export const INTRO_TALL = {
  position: [0, 2.5, 104] as [number, number, number],
  target: [0, 7, 60] as [number, number, number],
};

/**
 * Hero camera: in orbit over Earth's night side with the Sun exactly on the
 * horizon. For a unit sphere, a camera at (−S·a + U·h) sees the Sun at the limb
 * when h = 1 for any distance a; h slightly under 1 keeps the Sun just hidden,
 * so only its first light (the flare) shows.
 */
const UP = new THREE.Vector3(0, 1, 0);
export const SUNRISE_UP = UP.clone().addScaledVector(SUN_DIRECTION, -SUN_DIRECTION.dot(UP)).normalize();

export function sunrisePose(distance: number, tilt: number) {
  const eye = SUN_DIRECTION.clone().multiplyScalar(-distance).addScaledVector(SUNRISE_UP, 0.985);
  const target = eye.clone().add(SUN_DIRECTION.clone().addScaledVector(SUNRISE_UP, tilt).multiplyScalar(10));
  return {
    position: eye.toArray() as [number, number, number],
    target: target.toArray() as [number, number, number],
  };
}

/** Where on screen-space the sunrise flare sits: on the limb, along the Sun's direction. */
export const SUNRISE_DIRECTION = SUN_DIRECTION;
