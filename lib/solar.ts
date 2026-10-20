import * as THREE from "three";

/**
 * Shared solar-system geometry. Earth sits at the world origin (it is the
 * hero of every other scene), so the Sun is placed along the direction that
 * already lights Earth, and the orbital plane is the plane through both.
 */

/** Direction from Earth to the Sun; also the light direction for Earth's shaders. */
export const SUN_DIRECTION = new THREE.Vector3(0.9, 0.28, 0.65).normalize();

/** Earth–Sun distance in scene units (Earth's radius is 1). */
export const EARTH_ORBIT = 40;

export const SUN_POSITION = SUN_DIRECTION.clone().multiplyScalar(EARTH_ORBIT);

/**
 * Orbital-plane basis, centred on the Sun: local +x points from the Sun to
 * Earth, +z is the prograde direction, +y the north ecliptic pole.
 */
const toEarth = SUN_DIRECTION.clone().negate();
const prograde = new THREE.Vector3().crossVectors(SUN_DIRECTION, new THREE.Vector3(0, 1, 0)).normalize();
const north = new THREE.Vector3().crossVectors(prograde, SUN_DIRECTION).normalize();
export const ORBIT_PLANE = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(toEarth, north, prograde.clone().negate()),
);

/** Compressed distances: real AU raised to 0.6 keeps Neptune on screen with Mercury. */
export const orbitRadius = (au: number) => EARTH_ORBIT * au ** 0.6;

export interface PlanetSpec {
  name: string;
  body: string;
  au: number;
  radius: number;
  texture: string;
  ring?: string;
}

/** Sizes are exaggerated and not to scale with distances. */
export const PLANETS: PlanetSpec[] = [
  { name: "Mercury", body: "Mercury", au: 0.387, radius: 0.5, texture: "/textures/2k_mercury.jpg" },
  { name: "Venus", body: "Venus", au: 0.723, radius: 0.9, texture: "/textures/2k_venus_atmosphere.jpg" },
  { name: "Mars", body: "Mars", au: 1.524, radius: 0.6, texture: "/textures/2k_mars.jpg" },
  { name: "Jupiter", body: "Jupiter", au: 5.203, radius: 4, texture: "/textures/2k_jupiter.jpg" },
  {
    name: "Saturn",
    body: "Saturn",
    au: 9.537,
    radius: 3.4,
    texture: "/textures/2k_saturn.jpg",
    ring: "/textures/2k_saturn_ring_alpha.png",
  },
  { name: "Uranus", body: "Uranus", au: 19.19, radius: 2, texture: "/textures/2k_uranus.jpg" },
  { name: "Neptune", body: "Neptune", au: 30.07, radius: 2, texture: "/textures/2k_neptune.jpg" },
];

/** World position for a body `angle` radians prograde of Earth around the Sun. */
export function orbitPoint(radius: number, angle: number, out = new THREE.Vector3()) {
  out.set(Math.cos(angle) * radius, 0, -Math.sin(angle) * radius);
  return out.applyQuaternion(ORBIT_PLANE).add(SUN_POSITION);
}
