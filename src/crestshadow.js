// RideRash — the shadow over the crest.
//
// In Road Rash you could see a car coming before you could see the car: its
// shadow appeared on the road at the top of a rise while the car itself was
// still hidden behind it. That is the fair warning a blind crest needs.
//
// Each frame, for vehicles ahead of the player that are HIDDEN by the road
// surface (the rider's eye line to the car passes under the crest), a soft
// dark ellipse is laid on the road at the crest itself, in the car's lane,
// growing darker as the car gets closer. When the car comes into view the
// shadow fades out.
import * as THREE from 'three';
import { centreAt, centreTangent } from './level.js';

const POOL = 4;
const EYE = 1.3;            // rider's eye height over the road (m)
const LOOK = 260;           // m ahead to consider
const STEP = 6;             // m between terrain samples along the sight line

function shadowTex() {
  const W = 64, d = new Uint8Array(W * W * 4);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const u = x / W - 0.5, v = y / W - 0.5, r = Math.hypot(u * 1.0, v * 1.0) * 2;
    const i = (y * W + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = 0;
    d[i + 3] = Math.max(0, 1 - r) ** 1.5 * 255;
  }
  const t = new THREE.DataTexture(d, W, W); t.needsUpdate = true;
  return t;
}

export class CrestShadows {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'crestshadows';
    scene.add(this.group);
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    const tex = shadowTex();
    this.slots = [];
    for (let i = 0; i < POOL; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, color: 0x000000, fog: true }));
      m.renderOrder = 2;
      m.visible = false;
      this.group.add(m);
      this.slots.push({ mesh: m, car: null, a: 0 });
    }
    this._c = new THREE.Vector3(); this._t = new THREE.Vector3();
  }

  /** The crest between the rider (s0) and a car (s1), or null if the car is visible. */
  crestBetween(s0, s1) {
    const y0 = centreAt(-s0, this._c).y + EYE, y1 = centreAt(-s1, this._c).y + 1.0;
    let best = null, worst = 0;
    for (let s = s0 + STEP; s < s1 - STEP; s += STEP) {
      const k = (s - s0) / (s1 - s0);
      const sight = y0 + (y1 - y0) * k;
      const road = centreAt(-s, this._c).y;
      const over = road - sight;                 // > 0: the road is above the eye line here
      if (over > worst) { worst = over; best = s; }
    }
    // (the courses' crests are gentle -- at most ~0.8 m of a car ever drops
    // below the eye line -- so a car mostly hidden by a rise already counts)
    return worst > 0.5 ? { s: best, depth: worst } : null;
  }

  update(dt, playerS, cars) {
    // which cars are hidden behind a crest ahead
    const hidden = [];
    if (cars) for (const car of cars) {
      const u = car.userData;
      if (!car.visible || u.at === undefined) continue;
      const d = u.s - playerS;
      if (d < 40 || d > LOOK) continue;
      const cr = this.crestBetween(playerS, u.s);
      if (cr) hidden.push({ car, u, crest: cr.s, d });
    }
    hidden.sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.slots.length; i++) {
      const sl = this.slots[i], h = hidden[i];
      const target = h ? Math.min(0.55, 0.25 + (1 - h.d / LOOK) * 0.45) : 0;
      sl.a += (target - sl.a) * Math.min(1, dt * 5);
      if (h) sl.h = h;
      if (sl.a < 0.02 || !sl.h) { sl.mesh.visible = false; continue; }
      const { u, crest } = sl.h;
      // on the far side of the crest, where the car's shadow would first show
      const s = crest + 3;
      centreAt(-s, this._c); centreTangent(-s, this._t);
      const nx = this._t.z, nz = -this._t.x;            // + lateral = the rider's right
      sl.mesh.position.set(this._c.x + nx * u.at, this._c.y + 0.05, this._c.z + nz * u.at);
      sl.mesh.rotation.y = Math.atan2(this._t.x, this._t.z);
      sl.mesh.scale.set(u.halfW * 2.6, 1, u.halfL * 2.4);
      sl.mesh.material.opacity = sl.a;
      sl.mesh.visible = true;
    }
  }
}
