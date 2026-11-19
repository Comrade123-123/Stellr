"use client";

import { useMemo } from "react";
import * as THREE from "three";

/*
 * The four spacecraft as simple 3D models, built from their published dimensions (metres) and
 * then scaled so the main dish or shield is one unit across. +Z is the way the dish (Voyagers,
 * New Horizons) or the heat shield (Parker) faces; the scene turns each to Earth or the Sun.
 */

const mats = () => ({
  foil: new THREE.MeshStandardMaterial({ color: "#c9a24a", metalness: 0.45, roughness: 0.38 }),
  white: new THREE.MeshStandardMaterial({ color: "#ebe8e0", metalness: 0.05, roughness: 0.55, side: THREE.DoubleSide }),
  dark: new THREE.MeshStandardMaterial({ color: "#3a3b3f", metalness: 0.5, roughness: 0.5 }),
  grey: new THREE.MeshStandardMaterial({ color: "#8b8d92", metalness: 0.6, roughness: 0.4 }),
  panel: new THREE.MeshStandardMaterial({ color: "#1f2f57", metalness: 0.55, roughness: 0.3, side: THREE.DoubleSide }),
});

/** A parabolic dish `d` metres across and `depth` deep, opening towards +Z with its vertex at z = 0. */
function dish(d: number, depth: number) {
  const r = d / 2;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const x = (i / 16) * r;
    pts.push(new THREE.Vector2(x, depth * (x / r) ** 2));
  }
  const g = new THREE.LatheGeometry(pts, 48);
  g.rotateX(Math.PI / 2);
  return g;
}

/** A thin rod from a to b. */
function rod(a: [number, number, number], b: [number, number, number], r = 0.03) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const g = new THREE.CylinderGeometry(r, r, va.distanceTo(vb), 6);
  g.translate(0, va.distanceTo(vb) / 2, 0);
  const m = new THREE.Matrix4().lookAt(va, vb, new THREE.Vector3(0, 0, 1));
  // lookAt aims -Z; the cylinder runs along +Y: turn it onto -Z first.
  g.rotateX(-Math.PI / 2);
  g.applyMatrix4(m.setPosition(va));
  return g;
}

function Voyager() {
  const parts = useMemo(() => {
    const m = mats();
    const list: [THREE.BufferGeometry, THREE.Material][] = [];
    // Ten-sided bus, 1.78 m across, under the 3.66 m high-gain antenna.
    const bus = new THREE.CylinderGeometry(0.89, 0.89, 0.47, 10);
    bus.rotateX(Math.PI / 2);
    list.push([bus, m.foil]);
    const hga = dish(3.66, 0.48);
    hga.translate(0, 0, 0.3);
    list.push([hga, m.white]);
    const sub = new THREE.CylinderGeometry(0.22, 0.22, 0.04, 20);
    sub.rotateX(Math.PI / 2);
    sub.translate(0, 0, 1.65);
    list.push([sub, m.white]);
    for (const a of [0, 2.1, 4.2]) list.push([rod([Math.cos(a) * 1.4, Math.sin(a) * 1.4, 0.65], [0, 0, 1.65], 0.015), m.grey]);
    // RTG boom with three stacked, finned generators.
    list.push([rod([-0.85, 0, -0.1], [-3.6, 0, -0.35], 0.035), m.grey]);
    for (let i = 0; i < 3; i++) {
      const x = -2.2 - i * 0.55;
      const rtg = new THREE.CylinderGeometry(0.2, 0.2, 0.5, 12);
      rtg.rotateZ(Math.PI / 2);
      rtg.translate(x, 0, -0.25);
      list.push([rtg, m.dark]);
      for (let k = 0; k < 6; k++) {
        const fin = new THREE.BoxGeometry(0.46, 0.32, 0.02);
        fin.translate(0, 0.24, 0);
        fin.rotateX((k / 6) * Math.PI * 2);
        fin.translate(x, 0, -0.25);
        list.push([fin, m.dark]);
      }
    }
    // Science boom with the scan platform (cameras and spectrometers).
    list.push([rod([0.85, 0, -0.1], [2.6, 0, -0.3], 0.035), m.grey]);
    const plat = new THREE.BoxGeometry(0.5, 0.45, 0.45);
    plat.translate(2.85, 0, -0.3);
    list.push([plat, m.foil]);
    for (const [dy, len] of [[-0.1, 0.55], [0.12, 0.4]] as const) {
      const cam = new THREE.CylinderGeometry(0.08, 0.08, len, 12);
      cam.rotateX(Math.PI / 2);
      cam.translate(2.95, dy, -0.3 + len / 2 + 0.2);
      list.push([cam, m.dark]);
    }
    // The 13 m magnetometer boom, and the two 10 m plasma-wave antennas.
    list.push([rod([0.2, -0.85, -0.1], [3.2, -12.6, -1.2], 0.025), m.grey]);
    list.push([rod([-0.3, 0.5, -0.2], [-4.2, 6.8, -6.6], 0.012), m.grey]);
    list.push([rod([0.3, 0.5, -0.2], [4.2, 6.8, -6.6], 0.012), m.grey]);
    return list;
  }, []);
  return (
    <group scale={1 / 3.66}>
      {parts.map(([g, mat], i) => (
        <mesh key={i} geometry={g} material={mat} />
      ))}
    </group>
  );
}

function NewHorizons() {
  const parts = useMemo(() => {
    const m = mats();
    const list: [THREE.BufferGeometry, THREE.Material][] = [];
    // A triangular body about 2.1 by 2.7 m and 0.7 m thick, wrapped in gold foil.
    const tri = new THREE.Shape([new THREE.Vector2(-1.05, -0.9), new THREE.Vector2(1.05, -0.9), new THREE.Vector2(0, 1.8)]);
    const body = new THREE.ExtrudeGeometry(tri, { depth: 0.7, bevelEnabled: false });
    body.translate(0, -0.2, -0.75);
    list.push([body, m.foil]);
    const hga = dish(2.1, 0.32);
    hga.translate(0, 0, -0.02);
    list.push([hga, m.white]);
    const sub = new THREE.CylinderGeometry(0.12, 0.12, 0.04, 16);
    sub.rotateX(Math.PI / 2);
    sub.translate(0, 0, 0.9);
    list.push([sub, m.white]);
    for (const a of [0.5, 2.6, 4.7]) list.push([rod([Math.cos(a) * 0.8, Math.sin(a) * 0.8, 0.2], [0, 0, 0.9], 0.012), m.grey]);
    // The single RTG, jutting from one corner.
    const rtg = new THREE.CylinderGeometry(0.21, 0.21, 1.1, 14);
    rtg.rotateZ(Math.PI / 2.6);
    rtg.translate(-1.35, -1.3, -0.45);
    list.push([rtg, m.dark]);
    return list;
  }, []);
  return (
    <group scale={1 / 2.1}>
      {parts.map(([g, mat], i) => (
        <mesh key={i} geometry={g} material={mat} />
      ))}
    </group>
  );
}

function Parker() {
  const parts = useMemo(() => {
    const m = mats();
    const list: [THREE.BufferGeometry, THREE.Material][] = [];
    // The 2.3 m, 11.4 cm carbon heat shield, white on the Sun's side.
    const shield = new THREE.CylinderGeometry(1.15, 1.15, 0.114, 48);
    shield.rotateX(Math.PI / 2);
    list.push([shield, m.white]);
    for (const a of [0.4, 2.5, 4.6]) list.push([rod([Math.cos(a) * 0.9, Math.sin(a) * 0.9, -0.06], [Math.cos(a) * 0.35, Math.sin(a) * 0.35, -0.7], 0.025), m.grey]);
    // The hexagonal spacecraft body, sheltering in the shield's shadow.
    const bus = new THREE.CylinderGeometry(0.5, 0.5, 1.0, 6);
    bus.rotateX(Math.PI / 2);
    bus.translate(0, 0, -1.2);
    list.push([bus, m.foil]);
    // Two small water-cooled solar arrays, folded back near the Sun.
    for (const s of [-1, 1]) {
      const arm = rod([s * 0.45, 0, -1.0], [s * 0.9, 0, -0.95], 0.02);
      list.push([arm, m.grey]);
      const panel = new THREE.BoxGeometry(0.03, 0.75, 0.45);
      panel.rotateY(s * 0.5);
      panel.translate(s * 1.05, 0, -1.0);
      list.push([panel, m.panel]);
    }
    const hga = dish(0.6, 0.1);
    hga.rotateX(Math.PI);
    hga.translate(0, 0.35, -1.75);
    list.push([hga, m.white]);
    return list;
  }, []);
  return (
    <group scale={1 / 2.3}>
      {parts.map(([g, mat], i) => (
        <mesh key={i} geometry={g} material={mat} />
      ))}
    </group>
  );
}

export default function CraftModel({ name }: { name: string }) {
  if (name === "New Horizons") return <NewHorizons />;
  if (name === "Parker Solar Probe") return <Parker />;
  return <Voyager />;
}
