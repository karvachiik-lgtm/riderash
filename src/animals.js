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

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function buildCow() {
  const g = new THREE.Group();
  // (a warm off-white: pure white blew out to a glowing blob under the sun + bloom)
  const hide = new THREE.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.95, flatShading: true });
  const patch = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.9, flatShading: true });
  const pink = new THREE.MeshStandardMaterial({ color: 0xd99a90, roughness: 0.8 });
  const horn = new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.6 });
  // body along +z (its front), 2.1 m long, withers at 1.4 m
  g.add(box(0.8, 0.75, 1.9, hide, 0, 1.05, 0));
  g.add(box(0.82, 0.4, 0.7, patch, 0.02, 1.2, 0.3));
  g.add(box(0.82, 0.35, 0.5, patch, -0.02, 1.0, -0.55));
  const head = new THREE.Group(); head.position.set(0, 1.25, 1.0); g.add(head);
  head.add(box(0.42, 0.42, 0.55, hide, 0, 0, 0.2));
  head.add(box(0.44, 0.24, 0.2, pink, 0, -0.12, 0.5));
  head.add(box(0.2, 0.16, 0.2, patch, 0.1, 0.12, 0.12));
  for (const s of [-1, 1]) {
    head.add(box(0.16, 0.06, 0.06, horn, s * 0.28, 0.24, 0.05));
    head.add(box(0.18, 0.1, 0.06, patch, s * 0.3, 0.1, 0.0));
  }
  g.add(box(0.3, 0.2, 0.3, pink, 0, 0.62, -0.3));        // udder
  const tail = box(0.05, 0.6, 0.05, hide, 0, 0.95, -0.98); g.add(tail);
  const legs = [];
  for (const [x, z] of [[-0.28, 0.72], [0.28, 0.72], [-0.28, -0.72], [0.28, -0.72]]) {
    const hip = new THREE.Group(); hip.position.set(x, 0.72, z); g.add(hip);
    hip.add(box(0.17, 0.72, 0.17, hide, 0, -0.36, 0));
    hip.add(box(0.19, 0.1, 0.2, patch, 0, -0.68, 0.01));
    legs.push(hip);
  }
  g.userData = { legs, head, tail, halfL: 1.15, halfW: 0.45, kind: 'cow' };
  return g;
}

function buildDeer() {
  const g = new THREE.Group();
  const coat = new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.85, flatShading: true });
  const pale = new THREE.MeshStandardMaterial({ color: 0xe8dcc4, roughness: 0.85, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.6 });
  g.add(box(0.42, 0.45, 1.25, coat, 0, 1.05, 0));
  g.add(box(0.36, 0.14, 1.0, pale, 0, 0.85, 0));
  const neck = new THREE.Group(); neck.position.set(0, 1.2, 0.55); neck.rotation.x = -0.6; g.add(neck);
  neck.add(box(0.18, 0.55, 0.2, coat, 0, 0.27, 0));
  const head = new THREE.Group(); head.position.set(0, 0.55, 0.05); neck.add(head);
  head.add(box(0.2, 0.2, 0.36, coat, 0, 0, 0.12));
  head.add(box(0.08, 0.08, 0.06, dark, 0, -0.02, 0.32));
  for (const s of [-1, 1]) {
    head.add(box(0.06, 0.16, 0.1, coat, s * 0.12, 0.14, -0.02));
    // antlers: a main beam with two tines
    const a = new THREE.Group(); a.position.set(s * 0.06, 0.12, 0.0); a.rotation.z = -s * 0.35; head.add(a);
    a.add(box(0.03, 0.34, 0.03, pale, 0, 0.17, 0));
    a.add(box(0.03, 0.16, 0.03, pale, s * 0.04, 0.26, 0.07));
    a.add(box(0.03, 0.14, 0.03, pale, -s * 0.03, 0.32, -0.05));
  }
  g.add(box(0.14, 0.1, 0.08, pale, 0, 1.15, -0.64));   // white tail
  const legs = [];
  for (const [x, z] of [[-0.14, 0.45], [0.14, 0.45], [-0.14, -0.45], [0.14, -0.45]]) {
    const hip = new THREE.Group(); hip.position.set(x, 0.85, z); g.add(hip);
    hip.add(box(0.08, 0.85, 0.08, coat, 0, -0.42, 0));
    hip.add(box(0.09, 0.06, 0.1, dark, 0, -0.83, 0.01));
    legs.push(hip);
  }
  g.userData = { legs, head: neck, halfL: 0.7, halfW: 0.25, kind: 'deer' };
  return g;
}

export class Animals {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'animals';
    scene.add(this.group);
    this.pool = [buildCow(), buildCow(), buildDeer(), buildDeer()];
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
    const kind = canCow && (!canDeer || Math.random() < 0.55) ? 'cow' : 'deer';
    const a = this.pool.find((x) => !x.userData.active && x.userData.kind === kind);
    if (!a) return;
    const u = a.userData;
    const from = Math.random() < 0.5 ? -1 : 1;           // the verge it comes from
    u.active = true; u.s = s; u.dir = -from;
    u.lat = from * (edgeAt(s, from) + (kind === 'cow' ? 2.5 : 6));
    u.speed = kind === 'cow' ? ANIMALS.COW_SPEED : ANIMALS.DEER_SPEED[0] + Math.random() * (ANIMALS.DEER_SPEED[1] - ANIMALS.DEER_SPEED[0]);
    // a cow stops for a while somewhere in the road
    u.stopAt = kind === 'cow' ? (Math.random() * 2 - 1) * 3 : null;
    u.stopT = kind === 'cow' ? ANIMALS.COW_STOP[0] + Math.random() * (ANIMALS.COW_STOP[1] - ANIMALS.COW_STOP[0]) : 0;
    u.t = 0; u.hit = false;
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
      const bound = u.kind === 'deer' && moving ? Math.abs(Math.sin(u.t * 9)) * 0.45 : 0;
      a.position.set(c.x + nx * u.lat, c.y + bound, c.z + nz * u.lat);
      // face the way it walks: across the road
      a.rotation.set(u.kind === 'deer' && moving ? Math.sin(u.t * 9) * 0.12 : 0, Math.atan2(nx * u.dir, nz * u.dir), 0);
      // legs: a walk (cow) or a gathered bound (deer)
      const w = u.kind === 'cow' ? u.t * 4 : u.t * 9;
      u.legs.forEach((leg, i) => {
        leg.rotation.x = !moving ? 0 : u.kind === 'cow' ? Math.sin(w + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * 0.35
          : (i < 2 ? -1 : 1) * (0.6 * Math.sin(w) + 0.2);
      });
      if (u.head) u.head.rotation.x = u.kind === 'cow' ? (moving ? 0.1 : 0.45 + Math.sin(u.t * 1.3) * 0.08) : -0.6;
      if (u.tail) u.tail.rotation.z = Math.sin(u.t * 3) * 0.3;
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
      u.speed = Math.max(u.speed, 3);                          // it bolts after being hit
      u.stopT = 0;
      return { animal: a, closing: p.speed || 0 };
    }
    return null;
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
