// RideRash — things ON the road: oil slicks and gravel patches.
//
// Road Rash's courses had oil spills and loose gravel that took the grip away
// mid-corner. Each is a patch in the road frame (distance s, lateral centre,
// half-length along the road, half-width across), placed per course from a
// seed so a course is the same every time you ride it:
//
//   OIL     a dark, glossy smear -- most of the grip gone (x0.35); towns and
//           the night sectors, where the traffic is
//   GRAVEL  loose stones spilled from the verge -- grip x0.6 and a drag;
//           mountain, forest and scrub, on the outside of the lanes
//
// Kept off the start, the finish and the crossroads, and spaced so the next
// one is always a separate event.
import * as THREE from 'three';
import { centreAt, centreTangent } from './level.js';
import { edgeAt, crossingNear, medianAt, MEDIAN_HALF } from './lanes.js';

export const HAZ = {
  EVERY: [260, 520],        // m between patches
  OIL_GRIP: 0.35,
  GRAVEL_GRIP: 0.6,
  GRAVEL_DRAG: 3.0,         // m/s^2 of extra slowing on gravel
};
const OIL_BIOMES = new Set(['town', 'night', 'coast']);

let patches = [];

function prng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** Lay the course's patches (call per race, after lanes.setLanePlan). */
export function placeHazards(spine, finishS) {
  const r = prng(0xbad5eed ^ (spine.mapId || '').split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  patches = [];
  for (let s = 320 + r() * 200; s < finishS - 250; s += HAZ.EVERY[0] + r() * (HAZ.EVERY[1] - HAZ.EVERY[0])) {
    if (crossingNear(s, 60)) continue;
    const b = spine.bounds[spine.sectorAt(s)].biome;
    const oil = OIL_BIOMES.has(b) ? r() < 0.75 : r() < 0.2;
    const side = r() < 0.72 ? 1 : -1;                     // mostly the rider's own carriageway
    const e = edgeAt(s, side);
    // oil anywhere in the lanes; gravel toward the outside edge
    let lat = oil ? side * (0.9 + r() * (e - 2.2)) : side * (e - 1.1 - r() * 1.4);
    if (medianAt(s) && Math.abs(lat) < MEDIAN_HALF + 1) lat = side * (MEDIAN_HALF + 1.2);
    patches.push({ kind: oil ? 'oil' : 'gravel', s, lat, L: oil ? 2.4 + r() * 2.2 : 3.5 + r() * 4, W: oil ? 1.0 + r() * 0.8 : 1.2 + r() * 0.8, rot: r() * 6.28 });
  }
  return patches;
}
export function hazardPatches() { return patches; }

/** The patch under a body at (s, lateral), or null. Elliptical footprint. */
export function hazardAt(s, lat) {
  for (const p of patches) {
    const ds = (s - p.s) / p.L, dl = (lat - p.lat) / p.W;
    if (ds * ds + dl * dl <= 1) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The visible patches: one instanced mesh per kind, flat on the deck.
function oilTex() {
  const W = 64, d = new Uint8Array(W * W * 4);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const u = x / W - 0.5, v = y / W - 0.5, r = Math.hypot(u, v);
    const edge = 0.42 + 0.05 * Math.sin(Math.atan2(v, u) * 5) + 0.03 * Math.sin(Math.atan2(v, u) * 11);
    const a = r < edge ? 1 : 0;
    // a rainbow sheen ring near the edge, the way a slick catches the light
    const sheen = Math.max(0, 1 - Math.abs(r - edge * 0.8) * 25);
    const i = (y * W + x) * 4;
    d[i] = 12 + sheen * 90; d[i + 1] = 12 + sheen * 40; d[i + 2] = 16 + sheen * 120; d[i + 3] = a * 235;
  }
  const t = new THREE.DataTexture(d, W, W); t.needsUpdate = true; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function gravelTex() {
  const W = 64, d = new Uint8Array(W * W * 4);
  let st = 99;
  const rr = () => ((st = (Math.imul(st, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const u = x / W - 0.5, v = y / W - 0.5, r = Math.hypot(u, v);
    const i = (y * W + x) * 4;
    const inside = r < 0.44 + 0.04 * Math.sin(Math.atan2(v, u) * 7);
    const stone = rr() < 0.55;
    const k = 120 + rr() * 90;
    d[i] = k; d[i + 1] = k * 0.9; d[i + 2] = k * 0.75;
    d[i + 3] = inside && stone ? 255 * (1 - Math.max(0, (r - 0.3) / 0.14)) : 0;
  }
  const t = new THREE.DataTexture(d, W, W); t.needsUpdate = true; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class HazardView {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'hazards';
    scene.add(this.group);
    this.mats = {
      oil: new THREE.MeshStandardMaterial({ map: oilTex(), transparent: true, roughness: 0.05, metalness: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
      gravel: new THREE.MeshStandardMaterial({ map: gravelTex(), transparent: true, roughness: 1, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
    };
    this.geo = new THREE.PlaneGeometry(2, 2);
    this.geo.rotateX(-Math.PI / 2);
  }
  build() {
    for (const c of [...this.group.children]) { this.group.remove(c); c.dispose && c.dispose(); }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Vector3(), t = new THREE.Vector3();
    for (const kind of ['oil', 'gravel']) {
      const list = patches.filter((x) => x.kind === kind);
      if (!list.length) continue;
      const inst = new THREE.InstancedMesh(this.geo, this.mats[kind], list.length);
      inst.receiveShadow = true;
      list.forEach((x, i) => {
        centreAt(-x.s, c); centreTangent(-x.s, t);
        const nx = t.z, nz = -t.x;          // + lateral = the rider's right (traffic.js)
        p.set(c.x + nx * x.lat, c.y + 0.03, c.z + nz * x.lat);
        q.setFromEuler(new THREE.Euler(0, Math.atan2(t.x, t.z), 0));
        sc.set(x.W, 1, x.L);
        inst.setMatrixAt(i, m.compose(p, q, sc));
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      this.group.add(inst);
    }
  }
}
