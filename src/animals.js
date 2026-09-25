// RideRash — cows and deer on the road.
//
// Road Rash's rural courses had cows standing in the road and deer that
// bolted across it. Here:
//
//   COW   ambles slowly across (0.9 m/s), stops in the lane for a while,
//         then carries on. Big and heavy: hitting one at speed is a wipeout.
//   DEER  springs across at 6-8 m/s in bounds, from the verge on one side to
//         the other, and does not stop. Smaller, but still a wipeout.
//
// They appear only in rural biomes (valley and sierra for cows; forest,
// sierra, scrub for deer), only ahead of the player (spawned 220-380 m out so
// they are seen coming), and only one or two at a time. Code-built, a few
// boxes each, with the legs as joints for a walk / bound cycle.
import * as THREE from 'three';
import { centreAt, centreTangent } from './level.js';
import { edgeAt, crossingNear } from './lanes.js';

export const ANIMALS = {
  MAX: 2,
  AHEAD: [220, 380],          // m ahead of the player where one appears
  EVERY: [9, 18],             // s between spawns
  COW_SPEED: 0.9, COW_STOP: [3, 7],
  DEER_SPEED: [6, 8],
  HIT_WIPE: 7,                // m/s closing: above this a hit is a wipeout
};
const COW_BIOMES = new Set(['valley', 'sierra', 'scrub']);
const DEER_BIOMES = new Set(['forest', 'sierra', 'scrub', 'valley']);
const MOOSE_BIOMES = new Set(['forest', 'sierra']);

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
// ---- shaped parts -----------------------------------------------------------
const std = (color, rough = 0.85, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, flatShading: true, ...extra });
/** An ellipsoid (a sphere scaled), for bodies, heads and muzzles. */
function blob(rx, ry, rz, mat, x, y, z, seg = 12) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, seg, Math.max(6, seg * 0.7 | 0)), mat);
  m.scale.set(rx, ry, rz); m.position.set(x, y, z); m.castShadow = true;
  return m;
}
/** A tapered limb segment hanging DOWN from its origin (length len). */
function limb(r0, r1, len, mat, seg = 7) {
  const g = new THREE.CylinderGeometry(r0, r1, len, seg);
  g.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(g, mat); m.castShadow = true;
  return m;
}
/** A segment from point a to point b (for necks, horns, antler tines). */
function strut(a, b, r0, r1, mat, seg = 6) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, seg), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.castShadow = true;
  return m;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Holstein hide: irregular black patches painted over off-white. */
function hideTex(seed = 5) {
  const W = 64, H = 32, d = new Uint8Array(W * H * 4);
  let st = seed;
  const rr = () => ((st = (Math.imul(st, 1664525) + 1013904223) >>> 0) / 4294967296);
  const spots = Array.from({ length: 9 }, () => [rr() * W, rr() * H, 4 + rr() * 7, 3 + rr() * 5]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let black = false;
    for (const [cx, cy, rx, ry] of spots) {
      for (const ox of [-W, 0, W]) {
        const dx = (x - cx - ox) / rx, dy = (y - cy) / ry;
        const wob = 0.25 * Math.sin(x * 0.9 + cy) * Math.cos(y * 1.1 + cx);
        if (dx * dx + dy * dy < 1 + wob) black = true;
      }
    }
    const i = (y * W + x) * 4, n = (rr() - 0.5) * 10;
    const c = black ? [34, 30, 28] : [205, 198, 184];
    d[i] = c[0] + n; d[i + 1] = c[1] + n; d[i + 2] = c[2] + n; d[i + 3] = 255;
  }
  const t = new THREE.DataTexture(d, W, H);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

/**
 * A two-joint leg: hip -> (upper) -> knee -> (cannon) -> hoof. The walk
 * cycle swings the hip and folds the knee, so a stride lifts the hoof.
 */
function buildLeg(parent, x, y, z, up, lo, rUp, rLo, mat, hoofMat, hind) {
  const hip = new THREE.Group(); hip.position.set(x, y, z); parent.add(hip);
  hip.add(limb(rUp, rUp * 0.7, up, mat));
  if (hind) hip.add(blob(rUp * 1.25, up * 0.45, rUp * 1.6, mat, 0, -up * 0.25, -rUp * 0.3, 8));   // haunch
  const knee = new THREE.Group(); knee.position.set(0, -up, 0); hip.add(knee);
  knee.add(blob(rLo * 1.3, rLo * 1.3, rLo * 1.3, mat, 0, 0, 0, 6));
  knee.add(limb(rLo, rLo * 0.85, lo, mat));
  const hoof = new THREE.Mesh(new THREE.CylinderGeometry(rLo * 1.05, rLo * 1.35, rLo * 1.6, 7), hoofMat);
  hoof.position.set(0, -lo - rLo * 0.8, rLo * 0.2); hoof.castShadow = true;
  knee.add(hoof);
  hip.userData.knee = knee;
  hip.userData.hind = hind;
  return hip;
}

function buildCow(seed = 5) {
  const g = new THREE.Group();
  const hide = std(0xffffff, 0.92, { map: hideTex(seed) });
  const white = std(0xcdc6b8, 0.92), black = std(0x221e1c, 0.9);
  const pink = std(0xd49a8f, 0.75), horn = std(0xd8cfb8, 0.55), hoof = std(0x2a2522, 0.6);
  const eye = std(0x0c0a09, 0.2);
  // BODY: a barrel, a deeper chest, a squarer rump, a spine line
  g.add(blob(0.42, 0.44, 0.98, hide, 0, 1.08, 0, 14));
  g.add(blob(0.40, 0.46, 0.42, hide, 0, 1.08, 0.58, 12));          // chest / shoulder
  g.add(blob(0.41, 0.40, 0.40, hide, 0, 1.14, -0.66, 12));         // rump
  for (const sd of [-1, 1]) g.add(blob(0.1, 0.08, 0.14, white, sd * 0.24, 1.46, -0.78, 6));   // hip bones
  g.add(blob(0.18, 0.2, 0.12, pink, 0, 0.68, -0.34, 10));          // udder
  for (const [tx, tz] of [[-0.07, -0.29], [0.07, -0.29], [-0.07, -0.4], [0.07, -0.4]]) {
    const t = limb(0.022, 0.018, 0.08, pink, 5); t.position.set(tx, 0.56, tz); g.add(t);
  }
  // NECK AND HEAD: a neck down and forward from the withers; a long face
  // tapering to a broad pink muzzle, poll between the horns, ears out sideways
  const neck = new THREE.Group(); neck.position.set(0, 1.28, 0.78); g.add(neck);
  neck.add(strut(V(0, 0, 0), V(0, -0.08, 0.34), 0.24, 0.18, hide, 8));
  const dewlap = blob(0.08, 0.2, 0.2, white, 0, -0.24, 0.12, 6); neck.add(dewlap);
  const head = new THREE.Group(); head.position.set(0, -0.08, 0.34); neck.add(head);
  head.add(blob(0.21, 0.23, 0.23, hide, 0, 0.02, 0.02, 10));          // skull
  head.add(strut(V(0, 0.0, 0.08), V(0, -0.18, 0.46), 0.19, 0.15, white, 8));   // face
  head.add(blob(0.18, 0.12, 0.13, pink, 0, -0.21, 0.5, 8));          // muzzle
  for (const sd of [-1, 1]) {
    head.add(blob(0.026, 0.02, 0.02, eye, sd * 0.055, -0.23, 0.62, 5));    // nostril
    head.add(blob(0.035, 0.035, 0.025, eye, sd * 0.18, 0.05, 0.16, 6));     // eye
    const ear = new THREE.Group(); ear.position.set(sd * 0.17, 0.1, -0.02); ear.rotation.z = -sd * 0.35; head.add(ear);
    ear.add(blob(0.13, 0.045, 0.07, black, sd * 0.12, 0, 0, 6));
    ear.userData.side = sd;
    (head.userData.ears = head.userData.ears || []).push(ear);
    // horns: out, then curving up and forward
    const h0 = V(sd * 0.12, 0.16, -0.02), h1 = V(sd * 0.25, 0.2, 0.0), h2 = V(sd * 0.31, 0.3, 0.06);
    head.add(strut(h0, h1, 0.035, 0.028, horn, 6));
    head.add(strut(h1, h2, 0.028, 0.012, horn, 6));
  }
  const jaw = new THREE.Group(); jaw.position.set(0, -0.24, 0.3); head.add(jaw);
  jaw.add(blob(0.1, 0.045, 0.12, white, 0, 0, 0.04, 6));
  // TAIL: pivots at the tailhead, hangs to the hocks, a dark switch
  const tail = new THREE.Group(); tail.position.set(0, 1.42, -1.02); g.add(tail);
  tail.add(limb(0.035, 0.02, 0.72, hide, 5));
  tail.add(blob(0.05, 0.12, 0.05, black, 0, -0.78, 0, 6));
  // LEGS: 4-beat walk needs knees
  const legs = [
    buildLeg(g, -0.24, 0.92, 0.62, 0.42, 0.44, 0.1, 0.055, hide, hoof, false),
    buildLeg(g, 0.24, 0.92, 0.62, 0.42, 0.44, 0.1, 0.055, hide, hoof, false),
    buildLeg(g, -0.24, 0.94, -0.7, 0.44, 0.44, 0.12, 0.055, hide, hoof, true),
    buildLeg(g, 0.24, 0.94, -0.7, 0.44, 0.44, 0.12, 0.055, hide, hoof, true),
  ];
  g.userData = { legs, head: neck, skull: head, jaw, tail, halfL: 1.2, halfW: 0.46, kind: 'cow' };
  return g;
}

function buildDeer() {
  const g = new THREE.Group();
  const coat = std(0x5a3e28, 0.92), dark = std(0x3e2a1a, 0.92), belly = std(0xb8a888, 0.92);
  const white = std(0xefe8dc, 0.85), nose = std(0x1a1210, 0.35), hoof = std(0x241a14, 0.6), eye = std(0x0a0807, 0.15);
  const antler = std(0xcdbb98, 0.6);
  // BODY: deep chest, tucked belly, a lighter underside and a white rump patch
  g.add(blob(0.2, 0.25, 0.56, coat, 0, 1.0, 0, 12));
  g.add(blob(0.2, 0.27, 0.24, coat, 0, 1.03, 0.36, 10));           // chest
  g.add(blob(0.2, 0.24, 0.24, coat, 0, 1.05, -0.36, 10));          // haunch
  g.add(blob(0.15, 0.1, 0.42, belly, 0, 0.84, 0.02, 10));          // belly
  g.add(blob(0.14, 0.15, 0.08, white, 0, 1.06, -0.56, 8));         // rump patch
  g.add(blob(0.05, 0.04, 0.5, dark, 0, 1.24, 0, 6));               // darker back line
  // NECK AND HEAD: a long neck held high, a narrow muzzle, big ears, antlers
  const neck = new THREE.Group(); neck.position.set(0, 1.18, 0.46); g.add(neck);
  neck.add(strut(V(0, 0, 0), V(0, 0.46, 0.2), 0.11, 0.075, coat, 8));
  neck.add(blob(0.07, 0.09, 0.05, white, 0, 0.28, 0.16, 6));       // throat patch
  const head = new THREE.Group(); head.position.set(0, 0.48, 0.22); neck.add(head);
  head.add(blob(0.09, 0.09, 0.12, coat, 0, 0, 0, 10));
  head.add(strut(V(0, -0.01, 0.06), V(0, -0.07, 0.26), 0.07, 0.04, coat, 8));
  head.add(blob(0.04, 0.035, 0.035, nose, 0, -0.07, 0.27, 6));
  head.add(blob(0.05, 0.02, 0.05, white, 0, -0.1, 0.2, 6));        // white chin
  head.userData.ears = [];
  for (const sd of [-1, 1]) {
    head.add(blob(0.022, 0.022, 0.018, eye, sd * 0.07, 0.02, 0.07, 5));
    const ear = new THREE.Group(); ear.position.set(sd * 0.07, 0.07, -0.03); ear.rotation.z = -sd * 0.7; head.add(ear);
    ear.add(blob(0.035, 0.1, 0.02, dark, 0, 0.09, 0, 6));
    ear.userData.side = sd;
    head.userData.ears.push(ear);
    // ANTLERS: a main beam sweeping back and out, then forward, with tines
    const b0 = V(sd * 0.04, 0.08, 0.0), b1 = V(sd * 0.14, 0.22, -0.06), b2 = V(sd * 0.2, 0.34, 0.02), b3 = V(sd * 0.17, 0.44, 0.12);
    head.add(strut(b0, b1, 0.018, 0.015, antler, 5));
    head.add(strut(b1, b2, 0.015, 0.012, antler, 5));
    head.add(strut(b2, b3, 0.012, 0.006, antler, 5));
    head.add(strut(b1, V(sd * 0.12, 0.34, -0.04), 0.011, 0.005, antler, 5));
    head.add(strut(b2, V(sd * 0.26, 0.46, 0.0), 0.01, 0.004, antler, 5));
    head.add(strut(b0.clone().add(V(sd * 0.03, 0.04, 0)), V(sd * 0.06, 0.14, 0.09), 0.01, 0.004, antler, 5));   // brow tine
  }
  // TAIL: a short flag, white underneath
  const tail = new THREE.Group(); tail.position.set(0, 1.16, -0.6); g.add(tail);
  tail.add(blob(0.05, 0.11, 0.03, coat, 0, -0.05, -0.02, 6));
  tail.add(blob(0.045, 0.1, 0.02, white, 0, -0.05, -0.045, 6));
  const legs = [
    buildLeg(g, -0.1, 0.92, 0.38, 0.36, 0.5, 0.055, 0.024, coat, hoof, false),
    buildLeg(g, 0.1, 0.92, 0.38, 0.36, 0.5, 0.055, 0.024, coat, hoof, false),
    buildLeg(g, -0.1, 0.96, -0.38, 0.4, 0.5, 0.07, 0.024, coat, hoof, true),
    buildLeg(g, 0.1, 0.96, -0.38, 0.4, 0.5, 0.07, 0.024, coat, hoof, true),
  ];
  g.userData = { legs, head: neck, skull: head, tail, halfL: 0.75, halfW: 0.26, kind: 'deer' };
  return g;
}

// THE MOOSE: the big one. 2.9 m long, 1.9 m at the shoulder hump, legs
// nearly as long as the body is deep; a long drooping muzzle, a hanging
// bell under the throat, and broad palmate antlers. It walks slowly, stops
// in the road and stares -- and hitting one is as bad as hitting a car.
function buildMoose() {
  const g = new THREE.Group();
  const coat = std(0x3a2a1e, 0.95), dark = std(0x241a13, 0.95), legC = std(0x6a5a48, 0.92);
  const nose = std(0x1a1310, 0.5), hoof = std(0x1c1612, 0.6), eye = std(0x0a0807, 0.15), antler = std(0xb8a684, 0.7);
  g.add(blob(0.44, 0.5, 1.05, coat, 0, 1.55, 0, 14));
  g.add(blob(0.46, 0.62, 0.5, coat, 0, 1.7, 0.55, 12));            // the shoulder hump
  g.add(blob(0.42, 0.46, 0.44, coat, 0, 1.52, -0.72, 12));
  g.add(blob(0.1, 0.12, 0.7, dark, 0, 2.2, 0.35, 6));              // mane ridge
  const neck = new THREE.Group(); neck.position.set(0, 1.9, 0.9); g.add(neck);
  neck.add(strut(V(0, 0, 0), V(0, -0.05, 0.42), 0.3, 0.22, coat, 8));
  neck.add(blob(0.06, 0.24, 0.08, dark, 0, -0.38, 0.3, 6));        // the bell
  const head = new THREE.Group(); head.position.set(0, -0.05, 0.42); neck.add(head);
  head.add(blob(0.2, 0.22, 0.24, coat, 0, 0, 0, 10));
  head.add(strut(V(0, -0.02, 0.1), V(0, -0.26, 0.62), 0.18, 0.15, coat, 8));   // long face
  head.add(blob(0.17, 0.15, 0.17, coat, 0, -0.3, 0.64, 8));        // overhanging muzzle
  head.add(blob(0.14, 0.05, 0.1, nose, 0, -0.36, 0.72, 6));
  head.userData.ears = [];
  for (const sd of [-1, 1]) {
    head.add(blob(0.03, 0.03, 0.025, eye, sd * 0.17, 0.04, 0.14, 5));
    const ear = new THREE.Group(); ear.position.set(sd * 0.16, 0.14, -0.06); ear.rotation.z = -sd * 0.9; head.add(ear);
    ear.add(blob(0.05, 0.14, 0.03, coat, 0, 0.12, 0, 6));
    ear.userData.side = sd; head.userData.ears.push(ear);
    // PALMATE ANTLERS: a short beam out to a broad flat palm, fringed with points
    const base = V(sd * 0.14, 0.18, -0.02), palm = V(sd * 0.55, 0.3, 0.02);
    head.add(strut(base, palm.clone().lerp(base, 0.5), 0.05, 0.045, antler, 6));
    const p = blob(0.3, 0.05, 0.2, antler, palm.x, palm.y, palm.z, 8);
    p.rotation.set(0.2, 0, sd * 0.35); head.add(p);
    for (let k = 0; k < 6; k++) {
      const a0 = -0.9 + k * 0.36;
      const from = V(palm.x + sd * Math.cos(a0) * 0.22, palm.y + 0.04 + Math.sin(a0 + 0.9) * 0.05, palm.z + Math.sin(a0) * 0.16);
      head.add(strut(from, from.clone().add(V(sd * 0.1, 0.14, Math.sin(a0) * 0.06)), 0.022, 0.006, antler, 5));
    }
  }
  const tail = new THREE.Group(); tail.position.set(0, 1.75, -1.1); g.add(tail);
  tail.add(blob(0.05, 0.08, 0.04, coat, 0, -0.05, 0, 6));
  const legs = [
    buildLeg(g, -0.26, 1.4, 0.62, 0.62, 0.72, 0.13, 0.068, legC, hoof, false),
    buildLeg(g, 0.26, 1.4, 0.62, 0.62, 0.72, 0.13, 0.068, legC, hoof, false),
    buildLeg(g, -0.26, 1.45, -0.72, 0.64, 0.72, 0.15, 0.068, legC, hoof, true),
    buildLeg(g, 0.26, 1.45, -0.72, 0.64, 0.72, 0.15, 0.068, legC, hoof, true),
  ];
  g.userData = { legs, head: neck, skull: head, tail, halfL: 1.45, halfW: 0.52, kind: 'moose' };
  return g;
}

export class Animals {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'animals';
    scene.add(this.group);
    this.pool = [buildCow(5), buildCow(23), buildDeer(), buildDeer(), buildMoose()];
    for (const a of this.pool) { a.visible = false; this.group.add(a); a.userData.active = false; }
    this.timer = 6;
  }
  reset() {
    for (const a of this.pool) { a.visible = false; a.userData.active = false; }
    this.timer = 5 + Math.random() * 5;
  }

  _spawn(spine, playerS, finishS) {
    const s = playerS + ANIMALS.AHEAD[0] + Math.random() * (ANIMALS.AHEAD[1] - ANIMALS.AHEAD[0]);
    if (s > finishS - 150 || crossingNear(s, 40)) return;
    const biome = spine.bounds[spine.sectorAt(s)].biome;
    const canCow = COW_BIOMES.has(biome), canDeer = DEER_BIOMES.has(biome);
    if (!canCow && !canDeer) return;
    let kind = canCow && (!canDeer || Math.random() < 0.55) ? 'cow' : 'deer';
    // the moose: rare, and only where the woods are
    if (MOOSE_BIOMES.has(biome) && Math.random() < 0.22) kind = 'moose';
    const a = this.pool.find((x) => !x.userData.active && x.userData.kind === kind);
    if (!a) return;
    const u = a.userData;
    const from = Math.random() < 0.5 ? -1 : 1;           // the verge it comes from
    u.active = true; u.s = s; u.dir = -from;
    const walker = kind !== 'deer';
    u.lat = from * (edgeAt(s, from) + (walker ? 2.5 : 6));
    u.speed = kind === 'cow' ? ANIMALS.COW_SPEED : kind === 'moose' ? 1.3 : ANIMALS.DEER_SPEED[0] + Math.random() * (ANIMALS.DEER_SPEED[1] - ANIMALS.DEER_SPEED[0]);
    // a cow (or a moose) stops for a while somewhere in the road
    u.stopAt = walker ? (Math.random() * 2 - 1) * 3 : null;
    u.stopT = walker ? ANIMALS.COW_STOP[0] + Math.random() * (ANIMALS.COW_STOP[1] - ANIMALS.COW_STOP[0]) : 0;
    u.t = 0; u.hit = false; u.stagger = 0; u.cyc = Math.random();
    a.visible = true;
  }

  update(dt, spine, playerS, finishS, racing) {
    if (racing) {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.pool.filter((x) => x.userData.active).length < ANIMALS.MAX) this._spawn(spine, playerS, finishS);
        this.timer = ANIMALS.EVERY[0] + Math.random() * (ANIMALS.EVERY[1] - ANIMALS.EVERY[0]);
      }
    }
    const c = new THREE.Vector3(), t = new THREE.Vector3();
    for (const a of this.pool) {
      const u = a.userData;
      if (!u.active) continue;
      u.t += dt;
      let moving = true;
      if (u.stopAt != null && !u.hit && Math.abs(u.lat - u.stopAt) < 0.2 && u.stopT > 0) { u.stopT -= dt; moving = false; }
      if (moving) u.lat += u.dir * u.speed * dt;
      // gone: off the far verge, or left far behind
      const far = edgeAt(u.s, u.dir) + 12;
      if (u.lat * u.dir > far || u.s < playerS - 80) { u.active = false; a.visible = false; continue; }
      centreAt(-u.s, c); centreTangent(-u.s, t);
      const nx = t.z, nz = -t.x;                           // + lateral = the rider's right
      const yaw = Math.atan2(nx * u.dir, nz * u.dir);        // facing across the road, the way it goes
      // ---- GAIT --------------------------------------------------------
      // COW: a four-beat lateral walk (LF, RH, RF, LH a quarter cycle apart);
      // each leg swings forward with its knee folded (hoof lifted) for 35% of
      // the cycle and pushes back straight for the rest.
      // DEER: a bound -- forelegs together, hindlegs together, half a cycle
      // apart -- the body rising and pitching with each leap.
      u.cyc = (u.cyc || 0) + (moving ? dt * (u.kind === 'deer' ? u.speed * 0.42 : u.speed * (u.kind === 'moose' ? 0.6 : 1.1)) : 0);
      const PH = u.kind !== 'deer' ? [0, 0.5, 0.75, 0.25] : [0, 0.08, 0.5, 0.58];
      let lift = 0, pitch = 0;
      u.legs.forEach((leg, i) => {
        const k = leg.userData.knee, ph = ((u.cyc + PH[i]) % 1 + 1) % 1;
        if (!moving) { leg.rotation.x += (0 - leg.rotation.x) * Math.min(1, dt * 6); k.rotation.x *= 0.8; return; }
        if (u.kind !== 'deer') {
          const A = u.kind === 'moose' ? 0.4 : 0.32, SW = 0.35;
          if (ph < SW) { const q = ph / SW; leg.rotation.x = A - 2 * A * q; k.rotation.x = Math.sin(Math.PI * q) * (leg.userData.hind ? 0.55 : 0.8); }
          else { const q = (ph - SW) / (1 - SW); leg.rotation.x = -A + 2 * A * q; k.rotation.x = 0; }
        } else {
          const A = leg.userData.hind ? 0.75 : 0.85;
          const sw = Math.sin(ph * Math.PI * 2);
          leg.rotation.x = -A * sw;                             // reach forward / drive back
          k.rotation.x = Math.max(0, Math.cos(ph * Math.PI * 2)) * (leg.userData.hind ? 0.5 : 1.2);   // tucked in the air
        }
      });
      if (moving && u.kind === 'deer') {
        const q = (u.cyc % 1 + 1) % 1;
        lift = Math.max(0, Math.sin(q * Math.PI * 2 + 0.6)) * 0.5;
        pitch = Math.sin(q * Math.PI * 2) * 0.18;
      } else if (moving) lift = Math.abs(Math.sin(u.cyc * Math.PI * 2)) * 0.02;
      // ---- HIT: stagger sideways and recover (then bolt) ----------------
      u.stagger = Math.max(0, (u.stagger || 0) - dt * 0.9);
      const tip = u.stagger > 0 ? Math.sin(u.stagger * 3.2) * u.stagger * 0.6 : 0;
      a.position.set(c.x + nx * u.lat, c.y + lift, c.z + nz * u.lat);
      a.rotation.set(-pitch, yaw, tip, 'YXZ');
      // ---- HEAD, EARS, JAW, TAIL -----------------------------------------
      // A rider approaching: the head comes up and turns to look at them.
      const toRider = u.s - playerS;
      const watch = !u.hit && toRider > 0 && toRider < 70 ? 1 - toRider / 70 : 0;
      // the rider is back down the road: in the animal's frame that is off to
      // one side of its heading
      const riderYaw = Math.atan2(-t.x, -t.z) - yaw;          // world bearing of -tangent, minus heading
      const look = Math.max(-1.1, Math.min(1.1, Math.atan2(Math.sin(riderYaw), Math.cos(riderYaw)))) * watch;
      const nk = u.head;
      if (u.kind === 'moose') {
        // a moose does not graze in the road: it stands, head high, and stares
        nk.rotation.x = moving ? 0.05 + Math.sin(u.cyc * Math.PI * 4) * 0.04 : -0.05;
        nk.rotation.y = (moving ? look * 0.6 : Math.max(-1, Math.min(1, look + (1 - watch) * Math.sin(u.t * 0.4) * 0.5)));
      } else if (u.kind === 'cow') {
        const graze = !moving ? 0.55 + Math.sin(u.t * 0.7) * 0.06 : 0.12 + Math.sin(u.cyc * Math.PI * 4) * 0.05;
        nk.rotation.x = graze * (1 - watch) - 0.1 * watch;
        nk.rotation.y = look * 0.8;
        if (u.jaw) u.jaw.rotation.x = !moving && !watch ? Math.max(0, Math.sin(u.t * 7)) * 0.25 : 0;   // chewing
        if (u.tail) { u.tail.rotation.z = Math.sin(u.t * 2.3) * 0.35 + Math.sin(u.t * 5.1) * 0.08; u.tail.rotation.x = 0.1; }
      } else {
        nk.rotation.x = moving ? -0.25 + Math.sin(u.cyc * Math.PI * 2) * 0.12 : -0.05;
        nk.rotation.y = look;
        if (u.tail) u.tail.rotation.x = moving ? -1.1 : -0.2;   // the white flag goes up when it runs
      }
      // ears: a flick now and then, pricked forward when watching
      for (const e of (u.skull && u.skull.userData.ears) || []) {
        e.userData.f = (e.userData.f || 0) - dt;
        if (e.userData.f < -2.5 - (e.userData.side > 0 ? 1.1 : 0) - Math.random() * 3) e.userData.f = 0.25;
        e.rotation.x = (e.userData.f > 0 ? Math.sin(e.userData.f * 25) * 0.4 : 0) - watch * 0.3;
      }
    }
  }

  /** A rider (BikePhys) against the animals: null or { animal, closing }. */
  contact(p) {
    for (const a of this.pool) {
      const u = a.userData;
      if (!u.active || u.hit) continue;
      if (Math.abs(p.s - u.s) > u.halfW + 0.9) continue;       // the animal is side-on to the road
      if (Math.abs(p.lateral - u.lat) > u.halfL + 0.35) continue;
      u.hit = true;
      u.speed = Math.max(u.speed, u.kind === 'cow' ? 2.2 : 8);    // it bolts after being hit
      u.stopT = 0;
      u.stagger = 1;
      // knocked the way the bike was going across it
      u.dir = Math.sign(p.lateralV || 0) || u.dir;
      return { animal: a, closing: p.speed || 0 };
    }
    return null;
  }

  /**
   * Developer mode: put an animal of `kind` in the road at s. A cow or moose
   * stands in the given lane; a deer bolts across from the right-hand verge.
   */
  spawnAt(kind, s, lat) {
    const a = this.pool.find((x) => !x.userData.active && x.userData.kind === kind);
    if (!a) return false;
    const u = a.userData, deer = kind === 'deer';
    Object.assign(u, {
      active: true, s, t: 0, hit: false, stagger: 0, cyc: Math.random(),
      dir: deer ? -1 : 1,
      lat: deer ? edgeAt(s, 1) + 4 : lat,
      speed: deer ? 7 : kind === 'moose' ? 1.3 : ANIMALS.COW_SPEED,
      stopAt: deer ? null : lat, stopT: deer ? 0 : 8,
    });
    a.visible = true;
    return true;
  }

  /**
   * As road obstacles for the AI's look (traffic.setTrafficExtras). The animal
   * stands side-on: its length runs ACROSS the road.
   */
  obstacles(s, back, fwd) {
    const out = [];
    for (const a of this.pool) {
      const u = a.userData;
      if (!u.active) continue;
      const d = u.s - s;
      if (d < -back || d > fwd) continue;
      out.push({ s: u.s, at: u.lat, halfL: u.halfW, halfW: u.halfL, vs: 0 });
    }
    return out;
  }

  /**
   * For the traffic's car-following: a stationary thing in the lane, which a
   * driver stops for and then goes round (traffic.js treats a DOWN rider so).
   */
  asRiders() {
    const out = [];
    for (const a of this.pool) {
      const u = a.userData;
      if (!u.active) continue;
      out.push({ phys: { s: u.s, lateral: u.lat, speed: 0 }, fighter: { down: true }, padW: u.halfL + 0.6 });
    }
    return out;
  }

  /**
   * VEHICLES AGAINST ANIMALS. Traffic cars (road frame: long along s) and
   * crossing cars (long across it) used to drive straight through a cow. A car
   * that reaches one now hits it: the animal staggers and bolts, the car stands
   * on its brakes (a moose stops it dead). Returns the hits, for sound.
   */
  vehicleContact(cars, crossCars) {
    const hits = [];
    for (const a of this.pool) {
      const u = a.userData;
      if (!u.active || u.hit) continue;
      const strike = (lat, v) => {
        u.hit = true;
        u.speed = Math.max(u.speed, u.kind === 'cow' ? 2.2 : 8);
        u.stopT = 0; u.stagger = 1;
        u.dir = Math.sign(u.lat - lat) || u.dir;
        hits.push({ animal: a, v });
      };
      for (const car of cars || []) {
        const c = car.userData;
        if (c.off || c.at === undefined) continue;
        if (Math.abs(c.s - u.s) > c.halfL + u.halfW || Math.abs(c.at - u.lat) > c.halfW + u.halfL) continue;
        strike(c.at, c.speed || 0); hits[hits.length - 1].car = car;
        c.stun = Math.max(c.stun || 0, 1.2);
        c.speed = (c.speed || 0) * (u.kind === 'moose' ? 0.15 : 0.6);
        break;
      }
      if (u.hit) continue;
      for (const car of crossCars || []) {
        const c = car.userData;
        if (!c.active) continue;
        if (Math.abs(c.cs + (c.sOff || 0) - u.s) > c.halfW + u.halfW || Math.abs(c.x - u.lat) > c.halfL + u.halfL) continue;
        strike(c.x, c.v || 0); hits[hits.length - 1].car = car; hits[hits.length - 1].cross = true;
        c.v = (c.v || 0) * (u.kind === 'moose' ? 0.1 : 0.5);
        break;
      }
    }
    return hits;
  }

  /** Near the rider's path ahead, for the HUD warning. */
  ahead(p, range = 120) {
    for (const a of this.pool) {
      const u = a.userData;
      if (!u.active) continue;
      const d = u.s - p.s;
      if (d > 0 && d < range && Math.abs(u.lat) < edgeAt(u.s, Math.sign(u.lat) || 1) + 1) return u.kind;
    }
    return null;
  }
}
